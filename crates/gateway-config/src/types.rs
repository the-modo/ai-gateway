use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GatewayConfig {
    pub server: ServerConfig,
    #[serde(default)]
    pub providers: Vec<ProviderConfig>,
    #[serde(default)]
    pub routes: Vec<RouteConfig>,
    pub cache: CacheConfig,
    pub telemetry: TelemetryConfig,
    pub auth: AuthConfig,
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default)]
    pub dashboard_auth: DashboardAuthConfig,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            providers: vec![],
            routes: vec![],
            cache: CacheConfig::default(),
            telemetry: TelemetryConfig::default(),
            auth: AuthConfig::default(),
            storage: StorageConfig::default(),
            dashboard_auth: DashboardAuthConfig::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub request_timeout_ms: u64,
    pub max_connections: usize,
    /// Allowed CORS origins. Empty = permissive (`*`, legacy behaviour); set to
    /// the dashboard origin(s) to lock down cross-origin access (#3).
    #[serde(default)]
    pub cors_allowed_origins: Vec<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: "0.0.0.0".to_string(),
            port: 8080,
            request_timeout_ms: 30_000,
            max_connections: 10_000,
            cors_allowed_origins: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderConfig {
    pub name: String,
    pub kind: ProviderKind,
    pub api_key: Option<String>,
    pub api_key_env: Option<String>,
    pub base_url: Option<String>,
    #[serde(default = "default_weight")]
    pub weight: u32,
    #[serde(default = "default_timeout")]
    pub timeout_ms: u64,
    #[serde(default)]
    pub models: Vec<String>,
}

fn default_weight() -> u32 { 100 }
fn default_timeout() -> u64 { 30_000 }

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    OpenAI,
    Anthropic,
    Gemini,
    Mistral,
    Cohere,
    Groq,
    Bedrock,
    VertexAI,
    Azure,
    Together,
    Perplexity,
    DeepSeek,
    Fireworks,
    Custom,
}

// ─── Routing ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RouteConfig {
    pub id: String,
    /// Model patterns this route applies to. Supports glob "*" and prefix "claude-*".
    #[serde(default = "match_all")]
    pub models: Vec<String>,
    pub strategy: RoutingStrategy,
    /// Primary providers with weights.
    pub providers: Vec<ProviderRoute>,
    /// Ordered fallback provider names tried after all primaries fail.
    #[serde(default)]
    pub fallbacks: Vec<String>,
    /// Total retry attempts across the whole provider list.
    #[serde(default = "default_retries")]
    pub retries: u32,
    /// Delay between retry rounds (ms).
    #[serde(default = "default_retry_delay")]
    pub retry_delay_ms: u64,
    pub timeout_ms: Option<u64>,
    pub rate_limit: Option<RateLimitConfig>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderRoute {
    pub name: String,
    #[serde(default = "default_weight")]
    pub weight: u32,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RoutingStrategy {
    /// Try providers left-to-right; move to next on failure.
    Sequential,
    /// Evenly distribute across providers.
    RoundRobin,
    /// Distribute by configured weight.
    Weighted,
    /// Always route to the provider with lowest observed latency.
    Latency,
    /// Always route to the provider with lowest cost-per-token.
    Cost,
}

impl Default for RoutingStrategy {
    fn default() -> Self { Self::Sequential }
}

fn match_all() -> Vec<String> { vec!["*".to_string()] }
fn default_retries() -> u32 { 2 }
fn default_retry_delay() -> u64 { 500 }

impl RouteConfig {
    /// Returns true if this route handles the given model name.
    pub fn matches_model(&self, model: &str) -> bool {
        self.models.iter().any(|pat| {
            if pat == "*" { return true; }
            if let Some(prefix) = pat.strip_suffix('*') {
                return model.starts_with(prefix);
            }
            pat == model
        })
    }
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RateLimitConfig {
    pub requests_per_minute: u32,
    pub tokens_per_minute: Option<u32>,
}

// ─── Cache ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CacheConfig {
    pub enabled: bool,
    pub exact_match: ExactCacheConfig,
    pub semantic: SemanticCacheConfig,
    pub redis_url: Option<String>,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            exact_match: ExactCacheConfig::default(),
            semantic: SemanticCacheConfig::default(),
            redis_url: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExactCacheConfig {
    pub enabled: bool,
    pub ttl_seconds: u64,
    pub max_entries: u64,
}

impl Default for ExactCacheConfig {
    fn default() -> Self {
        Self { enabled: true, ttl_seconds: 3600, max_entries: 10_000 }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SemanticCacheConfig {
    pub enabled: bool,
    pub similarity_threshold: f32,
    pub ttl_seconds: u64,
}

impl Default for SemanticCacheConfig {
    fn default() -> Self {
        Self { enabled: false, similarity_threshold: 0.95, ttl_seconds: 3600 }
    }
}

// ─── Telemetry ───────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TelemetryConfig {
    pub metrics_enabled: bool,
    pub metrics_path: String,
    pub tracing_enabled: bool,
    pub otlp_endpoint: Option<String>,
    pub log_level: String,
    pub log_format: LogFormat,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            metrics_enabled: true,
            metrics_path: "/metrics".to_string(),
            tracing_enabled: false,
            otlp_endpoint: None,
            log_level: "info".to_string(),
            log_format: LogFormat::Text,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LogFormat { Text, Json }

// ─── Storage ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StorageConfig {
    /// SQLite: "sqlite://./gateway.db"  PostgreSQL: "postgres://user:pass@host/db"
    pub database_url: String,
    /// Store request + response bodies (can be large).
    pub log_bodies: bool,
    /// Delete log entries older than this many days (0 = keep forever).
    pub retention_days: u32,
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            database_url: "sqlite://./gateway.db".to_string(),
            log_bodies: true,
            retention_days: 30,
        }
    }
}

// ─── Dashboard auth ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DashboardAuthConfig {
    #[serde(default = "default_dashboard_user")]
    pub username: String,
    #[serde(default = "default_dashboard_pass")]
    pub password: String,
}

fn default_dashboard_user() -> String { "admin".to_string() }
fn default_dashboard_pass() -> String { "admin".to_string() }

impl Default for DashboardAuthConfig {
    fn default() -> Self {
        Self { username: default_dashboard_user(), password: default_dashboard_pass() }
    }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct AuthConfig {
    pub enabled: bool,
    #[serde(default)]
    pub keys: Vec<ApiKeyConfig>,
}

impl Default for AuthConfig {
    fn default() -> Self { Self { enabled: false, keys: vec![] } }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ApiKeyConfig {
    pub key: String,
    pub name: String,
    pub allowed_models: Option<Vec<String>>,
    pub monthly_budget_usd: Option<f64>,
}
