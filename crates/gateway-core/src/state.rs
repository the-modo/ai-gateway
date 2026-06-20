use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use serde::{Deserialize, Serialize};
use sqlx::{Any, Pool};
use tokio::sync::{watch, RwLock};

use gateway_cache::{ExactCache, SemanticCache, SemanticCacheSettings};
use gateway_config::GatewayConfig;
use gateway_providers::ProviderRegistry;
use gateway_storage::RequestLogger;

/* ─── Guardrail types ────────────────────────────────────────────────────── */


#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GuardrailRule {
    pub id: String,
    pub label: String,
    /// Case-insensitive substrings to match.
    pub keywords: Vec<String>,
    /// Regex patterns (case-insensitive).
    pub patterns: Vec<String>,
    /// "off" | "flag" | "block"
    pub action: String,
    /// "request" | "response" | "both"
    pub scope: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GuardrailConfig {
    pub rules: Vec<GuardrailRule>,
}

/* ─── Content Shield types ───────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContentShieldRule {
    pub id: String,
    pub label: String,
    /// Regex string — empty means use the built-in pattern for this id.
    pub pattern: String,
    /// "flag" | "redact" | "block"
    pub action: String,
    /// Replacement token used when action == "redact".
    pub replacement: String,
    /// "request" | "response" | "both"
    pub scope: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ContentShieldConfig {
    pub rules: Vec<ContentShieldRule>,
}

/* ─── Model pricing types ────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelPricing {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub input_per_1m: f64,
    pub output_per_1m: f64,
    pub enabled: bool,
    #[serde(default)]
    pub custom: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ModelPricingConfig {
    pub models: Vec<ModelPricing>,
}

/* ─── AppState ───────────────────────────────────────────────────────────── */

#[derive(Clone)]
pub struct AppState {
    pub config: watch::Receiver<Arc<GatewayConfig>>,
    pub providers: Arc<ProviderRegistry>,
    pub cache: Arc<ExactCache>,
    /// None when storage is disabled.
    pub logger: Option<RequestLogger>,
    /// Direct pool access for analytics query handlers.
    pub db: Option<Arc<Pool<Any>>>,
    pub db_backend: Option<String>,
    /// Runtime-toggleable flag — avoids a gateway restart to change body logging.
    pub log_bodies: Arc<AtomicBool>,
    /// Runtime-toggleable flag — bypasses exact-match cache when false.
    pub cache_enabled: Arc<AtomicBool>,
    /// Semantic (similarity-matched) response cache.
    pub semantic_cache: Arc<SemanticCache>,
    /// Runtime-tunable semantic cache settings (threshold, TTL, capacity).
    pub semantic_settings: Arc<RwLock<SemanticCacheSettings>>,
    /// Guardrail rules applied to every request/response.
    pub guardrail_config: Arc<RwLock<GuardrailConfig>>,
    /// Content Shield PII/secret patterns applied to every request.
    pub content_shield_config: Arc<RwLock<ContentShieldConfig>>,
    /// Dynamic API keys stored in the database.
    pub api_keys: Arc<RwLock<Vec<serde_json::Value>>>,
    /// Model pricing catalog used for cost analytics.
    pub model_pricing: Arc<RwLock<ModelPricingConfig>>,
    /// Registered upstream MCP servers exposed via /mcp.
    pub mcp_config: Arc<RwLock<crate::mcp::McpConfig>>,
}

impl AppState {
    pub async fn new(
        config: watch::Receiver<Arc<GatewayConfig>>,
        db: Option<Arc<Pool<Any>>>,
        db_backend: Option<String>,
    ) -> anyhow::Result<Self> {
        let cfg = config.borrow().clone();

        let providers = Arc::new(ProviderRegistry::from_config(&cfg)?);

        let cache_on = cfg.cache.enabled && cfg.cache.exact_match.enabled;
        let cache = if cache_on {
            Arc::new(ExactCache::new(
                cfg.cache.exact_match.max_entries,
                cfg.cache.exact_match.ttl_seconds,
            ))
        } else {
            Arc::new(ExactCache::new(0, 0))
        };

        let logger = db
            .as_ref()
            .map(|pool| RequestLogger::new(Arc::clone(pool)));

        let log_bodies = Arc::new(AtomicBool::new(cfg.storage.log_bodies));
        let cache_enabled = Arc::new(AtomicBool::new(cache_on));
        let semantic_cache = Arc::new(SemanticCache::new());
        let semantic_settings = Arc::new(RwLock::new(SemanticCacheSettings::default()));
        let guardrail_config = Arc::new(RwLock::new(GuardrailConfig::default()));
        let content_shield_config = Arc::new(RwLock::new(ContentShieldConfig::default()));
        let model_pricing = Arc::new(RwLock::new(ModelPricingConfig::default()));
        let mcp_config = Arc::new(RwLock::new(crate::mcp::McpConfig::default()));

        // Load persisted API keys and runtime configs from DB
        let api_keys_vec = if let Some(pool) = &db {
            gateway_storage::queries::api_keys_list(pool).await.unwrap_or_default()
        } else {
            vec![]
        };
        let api_keys = Arc::new(RwLock::new(api_keys_vec));

        // Load persisted guardrail config from DB
        if let Some(pool) = &db {
            if let Ok(Some(json)) = gateway_storage::queries::config_load(pool, "guardrails").await {
                if let Ok(cfg) = serde_json::from_str::<GuardrailConfig>(&json) {
                    let mut guard = guardrail_config.write().await;
                    *guard = cfg;
                }
            }
            if let Ok(Some(json)) = gateway_storage::queries::config_load(pool, "content-shield").await {
                if let Ok(cfg) = serde_json::from_str::<ContentShieldConfig>(&json) {
                    let mut guard = content_shield_config.write().await;
                    *guard = cfg;
                }
            }
            if let Ok(Some(json)) = gateway_storage::queries::config_load(pool, "models").await {
                if let Ok(cfg) = serde_json::from_str::<ModelPricingConfig>(&json) {
                    let mut guard = model_pricing.write().await;
                    *guard = cfg;
                }
            }
            if let Ok(Some(json)) = gateway_storage::queries::config_load(pool, "semantic-cache").await {
                if let Ok(cfg) = serde_json::from_str::<SemanticCacheSettings>(&json) {
                    let mut guard = semantic_settings.write().await;
                    *guard = cfg;
                }
            }
            if let Ok(Some(json)) = gateway_storage::queries::config_load(pool, "mcp").await {
                if let Ok(cfg) = serde_json::from_str::<crate::mcp::McpConfig>(&json) {
                    let mut guard = mcp_config.write().await;
                    *guard = cfg;
                }
            }
        }

        Ok(Self {
            config, providers, cache, logger, db, db_backend,
            log_bodies, cache_enabled, semantic_cache, semantic_settings,
            guardrail_config, content_shield_config, api_keys,
            model_pricing, mcp_config,
        })
    }

    pub fn config(&self) -> Arc<GatewayConfig> {
        self.config.borrow().clone()
    }

    pub fn log_bodies(&self) -> bool {
        self.log_bodies.load(Ordering::Relaxed)
    }

    pub fn set_log_bodies(&self, val: bool) {
        self.log_bodies.store(val, Ordering::Relaxed);
    }

    pub fn cache_enabled(&self) -> bool {
        self.cache_enabled.load(Ordering::Relaxed)
    }

    pub fn set_cache_enabled(&self, val: bool) {
        self.cache_enabled.store(val, Ordering::Relaxed);
    }
}
