use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tracing::info;

use gateway_config::{GatewayConfig, ProviderKind, RouteConfig, RoutingStrategy};
use crate::{
    anthropic::AnthropicProvider,
    gemini::GeminiProvider,
    openai::OpenAIProvider,
    types::Provider,
};

/// Exponential moving average for latency tracking (α = 0.2).
struct LatencyEma {
    value_ms: f64,
}

impl LatencyEma {
    fn new() -> Self { Self { value_ms: f64::MAX } }
    fn update(&mut self, sample_ms: f64) {
        if self.value_ms == f64::MAX {
            self.value_ms = sample_ms;
        } else {
            self.value_ms = 0.2 * sample_ms + 0.8 * self.value_ms;
        }
    }
    fn get(&self) -> f64 { self.value_ms }
}

pub struct ProviderRegistry {
    providers:   HashMap<String, Arc<dyn Provider>>,
    /// provider-name → serde-lowercase ProviderKind (e.g. "openai", "anthropic"),
    /// so the routing layer can filter out providers whose vendor was disabled
    /// from the dashboard without each Provider implementation exposing a kind.
    kinds:       HashMap<String, String>,
    routes:      Vec<RouteConfig>,
    rr_counter:  AtomicUsize,
    latency:     Mutex<HashMap<String, LatencyEma>>,
}

impl ProviderRegistry {
    pub fn from_config(config: &GatewayConfig) -> anyhow::Result<Self> {
        let mut providers = HashMap::new();
        let mut kinds = HashMap::new();

        for cfg in &config.providers {
            let api_key = resolve_api_key(cfg);
            let kind_str = serde_json::to_value(&cfg.kind)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_else(|| "custom".to_string());
            kinds.insert(cfg.name.clone(), kind_str);
            let provider: Arc<dyn Provider> = match cfg.kind {
                ProviderKind::OpenAI
                | ProviderKind::Groq
                | ProviderKind::Together
                | ProviderKind::Perplexity
                | ProviderKind::DeepSeek
                | ProviderKind::Fireworks
                | ProviderKind::Azure
                | ProviderKind::Custom => Arc::new(OpenAIProvider::new(
                    cfg.name.clone(), api_key, cfg.base_url.clone(), cfg.models.clone(),
                )),
                ProviderKind::Anthropic => Arc::new(AnthropicProvider::new(
                    cfg.name.clone(), api_key, cfg.base_url.clone(), cfg.models.clone(),
                )),
                ProviderKind::Gemini | ProviderKind::VertexAI => Arc::new(GeminiProvider::new(
                    cfg.name.clone(), api_key, cfg.base_url.clone(), cfg.models.clone(),
                )),
                ProviderKind::Mistral | ProviderKind::Cohere => Arc::new(OpenAIProvider::new(
                    cfg.name.clone(), api_key, cfg.base_url.clone(), cfg.models.clone(),
                )),
                ProviderKind::Bedrock => {
                    tracing::warn!("Bedrock not yet implemented, using OpenAI-compat adapter");
                    Arc::new(OpenAIProvider::new(
                        cfg.name.clone(), api_key, cfg.base_url.clone(), cfg.models.clone(),
                    ))
                }
            };

            info!("Registered provider: {}", cfg.name);
            providers.insert(cfg.name.clone(), provider);
        }

        Ok(Self {
            providers,
            kinds,
            routes:     config.routes.clone(),
            rr_counter: AtomicUsize::new(0),
            latency:    Mutex::new(HashMap::new()),
        })
    }

    /// Vendor kind string (lowercase, e.g. "openai") for a configured
    /// provider name, or `None` if the name isn't registered.
    pub fn kind_of(&self, provider_name: &str) -> Option<&str> {
        self.kinds.get(provider_name).map(String::as_str)
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Provider>> {
        self.providers.get(name).cloned()
    }

    pub fn all(&self) -> Vec<Arc<dyn Provider>> {
        self.providers.values().cloned().collect()
    }

    /// Update the EMA latency for a provider after a completed request.
    pub fn record_latency(&self, provider_name: &str, latency_ms: f64) {
        let mut map = self.latency.lock().unwrap();
        map.entry(provider_name.to_string())
            .or_insert_with(LatencyEma::new)
            .update(latency_ms);
    }

    /// Find the best-matching route for a model, falling back to a wildcard route.
    fn find_route(&self, model: &str) -> Option<&RouteConfig> {
        // Exact / prefix match first
        if let Some(r) = self.routes.iter().find(|r| {
            r.models.iter().any(|p| p != "*" && r.matches_model(model))
        }) {
            return Some(r);
        }
        // Wildcard fallback
        self.routes.iter().find(|r| r.models.iter().any(|p| p == "*"))
    }

    /// Return the ordered provider list to try for this model request.
    /// Includes both primary (strategy-ordered) and fallback providers.
    pub fn ordered_providers(&self, model: &str) -> Vec<Arc<dyn Provider>> {
        if let Some(route) = self.find_route(model) {
            self.apply_strategy(route)
        } else {
            // No route configured: use any provider that supports this model
            self.providers.values()
                .filter(|p| {
                    p.supported_models().is_empty()
                        || p.supported_models().iter().any(|m| m == model || m == "*")
                })
                .cloned()
                .collect()
        }
    }

    /// Return retries + delay configured for this model's route.
    pub fn route_params(&self, model: &str) -> (u32, u64) {
        self.find_route(model)
            .map(|r| (r.retries, r.retry_delay_ms))
            .unwrap_or((2, 500))
    }

    fn apply_strategy(&self, route: &RouteConfig) -> Vec<Arc<dyn Provider>> {
        let primary: Vec<Arc<dyn Provider>> = match route.strategy {
            RoutingStrategy::Sequential => {
                route.providers.iter()
                    .filter_map(|pr| self.get(&pr.name))
                    .collect()
            }
            RoutingStrategy::RoundRobin => {
                let providers: Vec<_> = route.providers.iter()
                    .filter_map(|pr| self.get(&pr.name))
                    .collect();
                if providers.is_empty() { return vec![]; }
                let idx = self.rr_counter.fetch_add(1, Ordering::Relaxed) % providers.len();
                // Start from idx and wrap around
                let mut ordered = providers[idx..].to_vec();
                ordered.extend_from_slice(&providers[..idx]);
                ordered
            }
            RoutingStrategy::Weighted => {
                self.weighted_order(route)
            }
            RoutingStrategy::Latency => {
                let mut with_latency: Vec<(Arc<dyn Provider>, f64)> = route.providers.iter()
                    .filter_map(|pr| {
                        let p = self.get(&pr.name)?;
                        let lat = {
                            let map = self.latency.lock().unwrap();
                            map.get(&pr.name).map(|e| e.get()).unwrap_or(f64::MAX)
                        };
                        Some((p, lat))
                    })
                    .collect();
                with_latency.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
                with_latency.into_iter().map(|(p, _)| p).collect()
            }
            RoutingStrategy::Cost => {
                // Cost ordering is provider-config order for now (user sets it by cost)
                route.providers.iter()
                    .filter_map(|pr| self.get(&pr.name))
                    .collect()
            }
        };

        // Append fallbacks (deduped)
        let mut all = primary;
        for name in &route.fallbacks {
            if let Some(p) = self.get(name) {
                if !all.iter().any(|x| x.name() == p.name()) {
                    all.push(p);
                }
            }
        }
        all
    }

    /// Weighted random ordering: draw providers proportionally to their weight.
    fn weighted_order(&self, route: &RouteConfig) -> Vec<Arc<dyn Provider>> {
        use std::time::SystemTime;
        let seed = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(42);

        let mut pairs: Vec<(Arc<dyn Provider>, u32)> = route.providers.iter()
            .filter_map(|pr| self.get(&pr.name).map(|p| (p, pr.weight)))
            .collect();

        if pairs.is_empty() { return vec![]; }

        let mut ordered = Vec::with_capacity(pairs.len());
        let mut rng = seed as u64;

        while !pairs.is_empty() {
            let total: u32 = pairs.iter().map(|(_, w)| w).sum();
            rng = rng.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let pick = ((rng >> 33) as u32) % total.max(1);
            let mut acc = 0u32;
            let mut chosen = 0;
            for (i, (_, w)) in pairs.iter().enumerate() {
                acc += w;
                if pick < acc { chosen = i; break; }
            }
            ordered.push(pairs.remove(chosen).0);
        }
        ordered
    }
}

fn resolve_api_key(cfg: &gateway_config::ProviderConfig) -> String {
    if let Some(key) = &cfg.api_key {
        return key.clone();
    }
    if let Some(env_var) = &cfg.api_key_env {
        match std::env::var(env_var) {
            Ok(key) => return key,
            Err(_) => tracing::warn!(
                "Provider '{}': env var '{}' not set — requests will fail",
                cfg.name, env_var
            ),
        }
    }
    String::new()
}
