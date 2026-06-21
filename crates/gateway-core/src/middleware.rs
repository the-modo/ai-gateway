use std::time::{SystemTime, UNIX_EPOCH};

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};

use crate::state::AppState;

/// Data-independent byte comparison. The length check leaks only the secret's
/// length; the byte loop never short-circuits, so a mismatch position is not
/// timing-observable.
pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn bearer_token(headers: &HeaderMap) -> &str {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("")
}

/// Add baseline security headers to every response. Defense-in-depth for the
/// API; the static dashboard HTML is served by the reverse proxy, which should
/// set these too (#4).
pub async fn security_headers(request: Request, next: Next) -> Response {
    use axum::http::HeaderValue;
    let mut resp = next.run(request).await;
    let h = resp.headers_mut();
    h.insert("X-Content-Type-Options", HeaderValue::from_static("nosniff"));
    h.insert("X-Frame-Options", HeaderValue::from_static("DENY"));
    h.insert("Referrer-Policy", HeaderValue::from_static("no-referrer"));
    resp
}

/// Require a valid dashboard session token (issued by `/dashboard/login`) on
/// the analytics / logs / storage / config endpoints. Without this, those
/// routes were reachable by anyone — the login was cosmetic.
pub async fn dashboard_auth(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    let token = bearer_token(&headers);
    if state.validate_dashboard_token(token).await {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
}

/// Per-client sliding-window rate limit for the dashboard login endpoint, to
/// blunt online brute-force against the dashboard password.
pub async fn login_rate_limit(
    State(state): State<AppState>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<Response, StatusCode> {
    const WINDOW_MS: i64 = 60_000;
    const MAX_ATTEMPTS: u32 = 10;

    // Behind a reverse proxy the real client is in X-Forwarded-For.
    let client = headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(',').next())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    {
        let mut map = state.login_attempts.lock().unwrap();
        map.retain(|_, (start, _)| now - *start < WINDOW_MS);
        let entry = map.entry(client).or_insert((now, 0));
        if now - entry.0 >= WINDOW_MS {
            *entry = (now, 0);
        }
        entry.1 += 1;
        if entry.1 > MAX_ATTEMPTS {
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }
    }

    Ok(next.run(request).await)
}

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
