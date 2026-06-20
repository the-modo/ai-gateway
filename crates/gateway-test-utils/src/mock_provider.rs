use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::{
    Router,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json,
};
use serde_json::json;
use tokio::net::TcpListener;

/// Per-mock configuration.  Clone-friendly so it can be moved into Axum state.
#[derive(Debug, Clone)]
pub struct MockConfig {
    /// Artificial latency added to every request.
    pub latency_ms: u64,
    /// When true, every request returns `error_status`.
    pub always_fail: bool,
    /// Fail the first N calls (by count), then succeed.
    pub fail_n_times: u32,
    /// HTTP status code used when failing (default 500).
    pub error_status: u16,
    /// Text content of the assistant reply in success responses.
    pub response_text: String,
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
}

impl Default for MockConfig {
    fn default() -> Self {
        Self {
            latency_ms: 5,
            always_fail: false,
            fail_n_times: 0,
            error_status: 500,
            response_text: "Hello from mock!".to_string(),
            prompt_tokens: 10,
            completion_tokens: 5,
        }
    }
}

impl MockConfig {
    pub fn always_fail() -> Self {
        Self { always_fail: true, ..Default::default() }
    }

    pub fn fail_first(n: u32) -> Self {
        Self { fail_n_times: n, ..Default::default() }
    }

    pub fn with_latency(ms: u64) -> Self {
        Self { latency_ms: ms, ..Default::default() }
    }
}

// ─── Internal Axum state ──────────────────────────────────────────────────────

#[derive(Clone)]
struct MockState {
    config: Arc<MockConfig>,
    call_count: Arc<AtomicUsize>,
}

// ─── Public handle ────────────────────────────────────────────────────────────

pub struct MockProvider {
    /// HTTP base URL, e.g. `http://127.0.0.1:54321`
    pub base_url: String,
    call_count: Arc<AtomicUsize>,
    _handle: tokio::task::JoinHandle<()>,
}

impl MockProvider {
    pub async fn start(config: MockConfig) -> anyhow::Result<Self> {
        let call_count = Arc::new(AtomicUsize::new(0));

        let state = MockState {
            config: Arc::new(config),
            call_count: Arc::clone(&call_count),
        };

        let app = Router::new()
            // OpenAI-compatible (Custom / Groq / Together / …)
            .route("/v1/chat/completions", post(handle_openai))
            // Anthropic
            .route("/v1/messages", post(handle_anthropic))
            // Gemini  –  model name + method are part of the path
            .route("/v1beta/models/*path", post(handle_gemini))
            .with_state(state);

        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let addr = listener.local_addr()?;
        let base_url = format!("http://{}", addr);

        let handle = tokio::spawn(async move {
            axum::serve(listener, app).await.ok();
        });

        Ok(Self { base_url, call_count, _handle: handle })
    }

    pub fn calls(&self) -> usize {
        self.call_count.load(Ordering::SeqCst)
    }

    pub fn reset_calls(&self) {
        self.call_count.store(0, Ordering::SeqCst);
    }
}

// ─── Shared request logic ─────────────────────────────────────────────────────

/// Increments the call counter, checks failure rules, sleeps for latency.
/// Returns `Err(status)` when the request should be rejected.
async fn handle_call(state: &MockState) -> Result<(), StatusCode> {
    let n = state.call_count.fetch_add(1, Ordering::SeqCst);

    let fail = state.config.always_fail || (n < state.config.fail_n_times as usize);
    if fail {
        return Err(StatusCode::from_u16(state.config.error_status)
            .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR));
    }

    if state.config.latency_ms > 0 {
        tokio::time::sleep(Duration::from_millis(state.config.latency_ms)).await;
    }

    Ok(())
}

// ─── Endpoint handlers ────────────────────────────────────────────────────────

async fn handle_openai(State(s): State<MockState>) -> Response {
    match handle_call(&s).await {
        Err(status) => (
            status,
            Json(json!({"error": {"message": "mock error", "type": "mock_error", "code": status.as_u16()}})),
        )
            .into_response(),
        Ok(()) => Json(json!({
            "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
            "object": "chat.completion",
            "created": chrono::Utc::now().timestamp(),
            "model": "mock-gpt-4o",
            "choices": [{
                "index": 0,
                "message": { "role": "assistant", "content": s.config.response_text },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens":     s.config.prompt_tokens,
                "completion_tokens": s.config.completion_tokens,
                "total_tokens":      s.config.prompt_tokens + s.config.completion_tokens
            }
        }))
        .into_response(),
    }
}

async fn handle_anthropic(State(s): State<MockState>) -> Response {
    match handle_call(&s).await {
        Err(status) => (
            status,
            Json(json!({"error": {"type": "api_error", "message": "mock error"}})),
        )
            .into_response(),
        Ok(()) => Json(json!({
            "id": format!("msg_{}", uuid::Uuid::new_v4()),
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "text", "text": s.config.response_text }],
            "model": "claude-mock",
            "stop_reason": "end_turn",
            "usage": {
                "input_tokens":  s.config.prompt_tokens,
                "output_tokens": s.config.completion_tokens
            }
        }))
        .into_response(),
    }
}

async fn handle_gemini(State(s): State<MockState>, Path(_path): Path<String>) -> Response {
    match handle_call(&s).await {
        Err(status) => (
            status,
            Json(json!({"error": {"code": status.as_u16(), "message": "mock error"}})),
        )
            .into_response(),
        Ok(()) => Json(json!({
            "candidates": [{
                "content": {
                    "parts": [{ "text": s.config.response_text }],
                    "role": "model"
                },
                "finishReason": "STOP",
                "index": 0
            }],
            "usageMetadata": {
                "promptTokenCount":     s.config.prompt_tokens,
                "candidatesTokenCount": s.config.completion_tokens,
                "totalTokenCount":      s.config.prompt_tokens + s.config.completion_tokens
            }
        }))
        .into_response(),
    }
}
