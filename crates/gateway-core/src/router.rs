use axum::{
    middleware,
    routing::{get, post, put},
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

use crate::{
    handlers, mcp, perf,
    middleware::{auth, dashboard_auth, login_rate_limit},
    state::AppState,
};

pub fn build(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = Router::new()
        .route("/v1/chat/completions", post(handlers::chat_completions))
        .route("/v1/models", get(handlers::list_models))
        .layer(middleware::from_fn_with_state(state.clone(), auth));

    let analytics = Router::new()
        .route("/analytics/summary", get(handlers::analytics_summary))
        .route("/analytics/timeseries", get(handlers::analytics_timeseries))
        .route("/analytics/breakdown", get(handlers::analytics_breakdown))
        .route("/logs", get(handlers::logs_list).delete(handlers::logs_delete))
        .route("/logs/:id", get(handlers::logs_get))
        .route("/storage/status", get(handlers::storage_status))
        .route("/config/storage", get(handlers::storage_config_get).patch(handlers::storage_config_patch))
        .route("/config/cache", get(handlers::cache_config_get).patch(handlers::cache_config_patch))
        .route("/config/guardrails", get(handlers::guardrails_config_get).put(handlers::guardrails_config_put))
        .route("/config/content-shield", get(handlers::content_shield_config_get).put(handlers::content_shield_config_put))
        .route("/config/api-keys", get(handlers::api_keys_list).post(handlers::api_keys_create))
        .route("/config/api-keys/:id", put(handlers::api_keys_update).delete(handlers::api_keys_delete))
        .route("/config/models", get(handlers::models_config_get).put(handlers::models_config_put))
        .route("/config/providers", get(handlers::providers_config_get))
        .route("/config/mcp", get(mcp::mcp_config_get).put(mcp::mcp_config_put))
        .route("/mcp/tools", get(mcp::mcp_tools_get))
        // Performance evaluation — same admin auth gate as /config/*.
        .route("/perf/run",      post(perf::perf_run))
        .route("/perf/runs",     get(perf::perf_runs_list))
        .route("/perf/runs/:id", get(perf::perf_run_get))
        // Update status/upload are admin surfaces — keep them behind the same gate.
        .route("/updates/status", get(crate::updates::updates_status))
        .route("/updates/upload", post(crate::updates::updates_upload)
            .layer(axum::extract::DefaultBodyLimit::max(512 * 1024 * 1024)))
        // Dashboard session token required for every route above. Without this,
        // analytics/logs/storage/config were reachable unauthenticated.
        .layer(middleware::from_fn_with_state(state.clone(), dashboard_auth));

    Router::new()
        .merge(api)
        .merge(analytics)
        .route("/mcp", post(mcp::mcp_endpoint))
        .route("/mcp-test", post(mcp::mcp_test_endpoint))
        .route("/health", get(handlers::health))
        .route("/marketing/contact", post(crate::marketing::contact))
        .route("/marketing/download-request", post(crate::marketing::download_request))
        .route("/metrics", get(handlers::metrics))
        .route("/dashboard/login", post(handlers::dashboard_login)
            .layer(middleware::from_fn_with_state(state.clone(), login_rate_limit)))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}
