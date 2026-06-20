use serde::{Deserialize, Serialize};

// ─── Write-path ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct LogEntry {
    pub id: String,
    pub ts: i64,
    pub model: String,
    pub provider: String,
    pub status: i32,
    pub latency_ms: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub cached: bool,
    pub stream: bool,
    pub error: Option<String>,
    pub flags: Option<String>,
    pub request_body: Option<String>,
    pub response_body: Option<String>,
}

// ─── Read-path / API responses ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestSummary {
    pub total_requests: i64,
    pub success_requests: i64,
    pub error_requests: i64,
    pub total_tokens: i64,
    pub total_cost_usd: f64,
    pub avg_latency_ms: f64,
    pub cache_hits: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeseriesPoint {
    pub bucket: i64,
    pub request_count: i64,
    pub error_count: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub avg_latency_ms: f64,
    pub cache_hits: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BreakdownItem {
    pub key: String,
    pub request_count: i64,
    pub error_count: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub avg_latency_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogRow {
    pub id: String,
    pub ts: i64,
    pub model: String,
    pub provider: String,
    pub status: i32,
    pub latency_ms: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub total_tokens: i64,
    pub cost_usd: f64,
    pub cached: bool,
    pub stream: bool,
    pub error: Option<String>,
    pub flags: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogDetail {
    #[serde(flatten)]
    pub row: LogRow,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub request_body: Option<String>,
    pub response_body: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogsPage {
    pub items: Vec<LogRow>,
    pub total: i64,
    pub page: i64,
    pub per_page: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageStatus {
    pub enabled: bool,
    pub backend: String,
    pub database_url_masked: String,
    pub total_requests: i64,
    pub db_size_bytes: Option<i64>,
}
