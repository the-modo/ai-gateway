use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};

use crate::state::AppState;

pub async fn auth(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let cfg = state.config();

    if !cfg.auth.enabled {
        return Ok(next.run(request).await);
    }

    let token = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");

    // Check static config keys first
    let valid_static = cfg.auth.keys.iter().any(|k| k.key == token);

    // Check dynamic DB keys
    let valid_dynamic = if !valid_static {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let db_keys = state.api_keys.read().await;
        db_keys.iter().any(|k| {
            k["key"].as_str() == Some(token)
                && k["status"].as_str() == Some("active")
                && k["expiresAt"].as_i64().map_or(true, |exp| exp > now)
        })
    } else {
        false
    };

    if !valid_static && !valid_dynamic {
        return Err(StatusCode::UNAUTHORIZED);
    }

    Ok(next.run(request).await)
}
