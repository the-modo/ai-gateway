use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use sqlx::{Any, Pool};
use tokio::net::TcpListener;
use tokio::sync::watch;

use gateway_config::{
    ApiKeyConfig, AuthConfig, CacheConfig, DashboardAuthConfig, ExactCacheConfig, GatewayConfig,
    LogFormat, ProviderConfig, ProviderKind, ProviderRoute, RouteConfig, RoutingStrategy,
    SemanticCacheConfig, ServerConfig, StorageConfig, TelemetryConfig,
};
use gateway_core::{build_app, AppState};
use gateway_storage::run_migrations;

use crate::mock_provider::{MockConfig, MockProvider};

// ─── Public harness ───────────────────────────────────────────────────────────

pub struct TestHarness {
    /// HTTP base URL for the running gateway, e.g. `http://127.0.0.1:9001`
    pub base_url: String,
    /// Pre-configured reqwest client (no auth header by default)
    pub client: reqwest::Client,
    /// Direct pool access for asserting DB state
    pub db: Arc<Pool<Any>>,
    /// Ordered list of mock providers as supplied to the builder
    pub mocks: Vec<MockProvider>,
    // Keep the config sender alive so the watch channel is not closed.
    _config_tx: watch::Sender<Arc<GatewayConfig>>,
    _server: tokio::task::JoinHandle<()>,
}

impl TestHarness {
    /// Sleep long enough for the async logger to flush (200 ms flush interval + buffer).
    pub async fn wait_for_db_flush(&self) {
        tokio::time::sleep(Duration::from_millis(400)).await;
    }

    /// Convenience accessor into the mock slice.
    pub fn mock(&self, i: usize) -> &MockProvider {
        &self.mocks[i]
    }

    /// POST /v1/chat/completions with a minimal request body.
    pub async fn chat(
        &self,
        model: &str,
        content: &str,
    ) -> reqwest::Response {
        self.client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .json(&serde_json::json!({
                "model": model,
                "messages": [{ "role": "user", "content": content }]
            }))
            .send()
            .await
            .expect("chat request failed")
    }

    /// POST /v1/chat/completions with an explicit Bearer token.
    pub async fn chat_with_key(
        &self,
        model: &str,
        content: &str,
        key: &str,
    ) -> reqwest::Response {
        self.client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .bearer_auth(key)
            .json(&serde_json::json!({
                "model": model,
                "messages": [{ "role": "user", "content": content }]
            }))
            .send()
            .await
            .expect("chat_with_key request failed")
    }

    /// POST /v1/chat/completions requesting streaming (SSE).
    pub async fn chat_stream(&self, model: &str, content: &str) -> reqwest::Response {
        self.client
            .post(format!("{}/v1/chat/completions", self.base_url))
            .json(&serde_json::json!({
                "model": model,
                "messages": [{ "role": "user", "content": content }],
                "stream": true
            }))
            .send()
            .await
            .expect("chat_stream request failed")
    }
}

// ─── Provider spec used by the builder ───────────────────────────────────────

struct ProviderSpec {
    name: String,
    kind: ProviderKind,
    config: MockConfig,
    weight: u32,
    is_fallback: bool,
}

// ─── Builder ──────────────────────────────────────────────────────────────────

pub struct HarnessBuilder {
    providers: Vec<ProviderSpec>,
    strategy: RoutingStrategy,
    auth_enabled: bool,
    auth_keys: Vec<ApiKeyConfig>,
    cache_enabled: bool,
    cache_ttl_seconds: u64,
    retries: u32,
    retry_delay_ms: u64,
}

impl Default for HarnessBuilder {
    fn default() -> Self {
        Self::new()
    }
}

impl HarnessBuilder {
    pub fn new() -> Self {
        Self {
            providers: vec![],
            strategy: RoutingStrategy::Sequential,
            auth_enabled: false,
            auth_keys: vec![],
            cache_enabled: false,
            cache_ttl_seconds: 3600,
            retries: 0,
            retry_delay_ms: 50,
        }
    }

    /// Add a primary provider with OpenAI-compatible (Custom) kind.
    pub fn with_openai_mock(self, name: &str, config: MockConfig) -> Self {
        self.with_provider(name, ProviderKind::Custom, config, 100, false)
    }

    /// Add a primary provider with Anthropic kind.
    pub fn with_anthropic_mock(self, name: &str, config: MockConfig) -> Self {
        self.with_provider(name, ProviderKind::Anthropic, config, 100, false)
    }

    /// Add a fallback provider (appended after all primaries in every strategy).
    pub fn with_fallback_mock(self, name: &str, config: MockConfig) -> Self {
        self.with_provider(name, ProviderKind::Custom, config, 100, true)
    }

    /// Low-level provider addition.
    pub fn with_provider(
        mut self,
        name: &str,
        kind: ProviderKind,
        config: MockConfig,
        weight: u32,
        is_fallback: bool,
    ) -> Self {
        self.providers.push(ProviderSpec {
            name: name.to_string(),
            kind,
            config,
            weight,
            is_fallback,
        });
        self
    }

    pub fn with_strategy(mut self, strategy: RoutingStrategy) -> Self {
        self.strategy = strategy;
        self
    }

    pub fn with_auth(mut self, keys: Vec<ApiKeyConfig>) -> Self {
        self.auth_enabled = true;
        self.auth_keys = keys;
        self
    }

    pub fn with_cache(mut self, ttl_seconds: u64) -> Self {
        self.cache_enabled = true;
        self.cache_ttl_seconds = ttl_seconds;
        self
    }

    pub fn with_retries(mut self, retries: u32, delay_ms: u64) -> Self {
        self.retries = retries;
        self.retry_delay_ms = delay_ms;
        self
    }

    pub async fn build(self) -> anyhow::Result<TestHarness> {
        init_test_tracing();

        // ── Start mock HTTP servers ───────────────────────────────────────────
        let mut mocks = Vec::new();
        let mut provider_cfgs = Vec::new();
        let mut primary_routes = Vec::new();
        let mut fallback_names = Vec::new();

        for spec in self.providers {
            let mock = MockProvider::start(spec.config)
                .await
                .context("Failed to start mock provider")?;

            provider_cfgs.push(ProviderConfig {
                name: spec.name.clone(),
                kind: spec.kind,
                api_key: Some("test-key-unused".to_string()),
                api_key_env: None,
                base_url: Some(mock.base_url.clone()),
                weight: spec.weight,
                timeout_ms: 5_000,
                models: vec!["*".to_string()],
            });

            if spec.is_fallback {
                fallback_names.push(spec.name.clone());
            } else {
                primary_routes.push(ProviderRoute {
                    name: spec.name.clone(),
                    weight: spec.weight,
                });
            }

            mocks.push(mock);
        }

        // ── Build GatewayConfig ───────────────────────────────────────────────
        // Use SQLite in-memory with a single connection so every caller in
        // the same pool sees the same database.
        let db_url = "sqlite::memory:".to_string();

        let config = GatewayConfig {
            server: ServerConfig {
                host: "127.0.0.1".to_string(),
                port: 0, // we bind the listener ourselves
                request_timeout_ms: 10_000,
                max_connections: 128,
            },
            providers: provider_cfgs,
            routes: vec![RouteConfig {
                id: "test-route".to_string(),
                models: vec!["*".to_string()],
                strategy: self.strategy,
                providers: primary_routes,
                fallbacks: fallback_names,
                retries: self.retries,
                retry_delay_ms: self.retry_delay_ms,
                timeout_ms: None,
                rate_limit: None,
            }],
            cache: CacheConfig {
                enabled: self.cache_enabled,
                exact_match: ExactCacheConfig {
                    enabled: self.cache_enabled,
                    ttl_seconds: self.cache_ttl_seconds,
                    max_entries: 1_000,
                },
                semantic: SemanticCacheConfig {
                    enabled: false,
                    similarity_threshold: 0.95,
                    ttl_seconds: 3_600,
                },
                redis_url: None,
            },
            telemetry: TelemetryConfig {
                metrics_enabled: false,
                metrics_path: "/metrics".to_string(),
                tracing_enabled: false,
                otlp_endpoint: None,
                log_level: "error".to_string(),
                log_format: LogFormat::Text,
            },
            auth: AuthConfig {
                enabled: self.auth_enabled,
                keys: self.auth_keys,
            },
            dashboard_auth: DashboardAuthConfig::default(),
            storage: StorageConfig {
                database_url: db_url.clone(),
                log_bodies: false,
                retention_days: 30,
            },
        };

        // ── Initialise storage ────────────────────────────────────────────────
        // max_connections(1) ensures all callers share the same in-memory DB.
        sqlx::any::install_default_drivers();
        let pool = sqlx::any::AnyPoolOptions::new()
            .max_connections(1)
            .connect(&db_url)
            .await
            .context("Failed to connect to test SQLite")?;
        let pool = Arc::new(pool);
        run_migrations(&pool).await.context("Failed to run migrations")?;

        // ── Build AppState ────────────────────────────────────────────────────
        let (config_tx, config_rx) = watch::channel(Arc::new(config));
        let state = AppState::new(config_rx, Some(Arc::clone(&pool)), Some("sqlite".to_string()))
            .await
            .context("Failed to build AppState")?;

        let app = build_app(state);

        // ── Start the gateway on a random port ────────────────────────────────
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let base_url = format!("http://{}", addr);

        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });

        // Give the server a tick to come up
        tokio::time::sleep(Duration::from_millis(10)).await;

        // Dashboard data/config routes now require a session token. Log in once
        // with the (default) dashboard credentials and attach the token as a
        // default header so existing test requests are authenticated.
        let bootstrap = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()?;
        let token: String = bootstrap
            .post(format!("{}/dashboard/login", base_url))
            .json(&serde_json::json!({ "username": "admin", "password": "admin" }))
            .send()
            .await?
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| v["token"].as_str().map(String::from))
            .unwrap_or_default();

        let mut headers = reqwest::header::HeaderMap::new();
        if let Ok(val) = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}")) {
            headers.insert(reqwest::header::AUTHORIZATION, val);
        }
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .default_headers(headers)
            .build()?;

        Ok(TestHarness {
            base_url,
            client,
            db: pool,
            mocks,
            _config_tx: config_tx,
            _server: server,
        })
    }
}

// ─── Tracing initialisation (once per process) ────────────────────────────────

static TRACING: std::sync::Once = std::sync::Once::new();

fn init_test_tracing() {
    TRACING.call_once(|| {
        tracing_subscriber::fmt()
            .with_env_filter("error")
            .try_init()
            .ok();
    });
}
