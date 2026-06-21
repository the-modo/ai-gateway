//! Update receiver — checks a remote manifest published by the update
//! manager (`tools/update-manager/publish.sh`) and reports whether a newer
//! gateway version is available. Notification-only: applying updates stays
//! a deliberate operator action.

use std::sync::OnceLock;
use std::time::Duration;

use axum::{body::Bytes, extract::Query, http::StatusCode, response::IntoResponse, Json};
use sha2::{Digest, Sha256};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::RwLock;

pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn manifest_url() -> String {
    std::env::var("UPDATE_MANIFEST_URL")
        .unwrap_or_else(|_| "http://dilans.duckdns.org:4893/manifest.json".to_string())
}

/// Numeric dotted-version comparison: returns true when `latest` > `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim_start_matches('v')
            .split('.')
            .map(|p| p.chars().take_while(|c| c.is_ascii_digit()).collect::<String>()
                .parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (l, c) = (parse(latest), parse(current));
    for i in 0..l.len().max(c.len()) {
        let (a, b) = (*l.get(i).unwrap_or(&0), *c.get(i).unwrap_or(&0));
        if a != b { return a > b; }
    }
    false
}

struct CachedStatus {
    fetched_at: std::time::Instant,
    manifest: Option<Value>,
    error: Option<String>,
}

fn cache() -> &'static RwLock<Option<CachedStatus>> {
    static CACHE: OnceLock<RwLock<Option<CachedStatus>>> = OnceLock::new();
    CACHE.get_or_init(|| RwLock::new(None))
}

/// Reject plain-HTTP update sources (except loopback) so an update manifest
/// can't be served/forged by a network attacker over an unauthenticated channel.
fn is_transport_allowed(url: &str) -> bool {
    if url.starts_with("https://") {
        return true;
    }
    url.starts_with("http://127.0.0.1")
        || url.starts_with("http://localhost")
        || url.starts_with("http://[::1]")
}

async fn fetch_manifest() -> (Option<Value>, Option<String>) {
    let url = manifest_url();
    if !is_transport_allowed(&url) {
        return (
            None,
            Some("refusing to fetch update manifest over insecure transport; set UPDATE_MANIFEST_URL to an https:// URL".to_string()),
        );
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .expect("reqwest client");
    match client.get(&url).send().await {
        Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
            Ok(v) => (Some(v), None),
            Err(e) => (None, Some(format!("invalid manifest: {e}"))),
        },
        Ok(resp) => (None, Some(format!("update server returned {}", resp.status()))),
        Err(e) => (None, Some(format!("update server unreachable: {e}"))),
    }
}

/* ─── Air-gapped staged updates ──────────────────────────────────────────── */

#[derive(Clone, serde::Serialize)]
struct StagedPackage {
    file: String,
    size_bytes: u64,
    sha256: String,
    version: Option<String>,
    uploaded_at: String,
}

fn staged() -> &'static RwLock<Option<StagedPackage>> {
    static STAGED: OnceLock<RwLock<Option<StagedPackage>>> = OnceLock::new();
    STAGED.get_or_init(|| RwLock::new(None))
}

#[derive(Deserialize)]
pub struct UploadQuery {
    pub version: Option<String>,
}

/// Accept a release package (zip) for air-gapped environments. The package is
/// staged on disk next to the gateway binary; applying it remains a deliberate
/// operator action — the gateway never executes uploaded content.
pub async fn updates_upload(
    Query(q): Query<UploadQuery>,
    body: Bytes,
) -> impl IntoResponse {
    if body.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "empty upload" }))).into_response();
    }
    // Zip magic check — refuse arbitrary files.
    if body.len() < 4 || &body[..2] != b"PK" {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "not a zip archive" }))).into_response();
    }

    let file = "staged-update.zip".to_string();
    if let Err(e) = tokio::fs::write(&file, &body).await {
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": format!("write failed: {e}") }))).into_response();
    }

    let mut hasher = Sha256::new();
    hasher.update(&body);
    let pkg = StagedPackage {
        file,
        size_bytes: body.len() as u64,
        sha256: hex::encode(hasher.finalize()),
        version: q.version,
        uploaded_at: chrono::Utc::now().to_rfc3339(),
    };
    {
        let mut s = staged().write().await;
        *s = Some(pkg.clone());
    }
    tracing::info!(size = pkg.size_bytes, sha256 = %pkg.sha256, "Update package staged");
    Json(json!({ "ok": true, "staged": pkg })).into_response()
}

#[derive(Deserialize)]
pub struct UpdateQuery {
    /// Force a fresh manifest fetch instead of the 10-minute cache.
    pub check: Option<u8>,
}

pub async fn updates_status(Query(q): Query<UpdateQuery>) -> Json<Value> {
    let force = q.check.unwrap_or(0) == 1;

    let needs_fetch = {
        let c = cache().read().await;
        match &*c {
            Some(s) if !force => s.fetched_at.elapsed() > Duration::from_secs(600),
            _ => true,
        }
    };

    if needs_fetch {
        let (manifest, error) = fetch_manifest().await;
        let mut c = cache().write().await;
        *c = Some(CachedStatus { fetched_at: std::time::Instant::now(), manifest, error });
    }

    let c = cache().read().await;
    let s = c.as_ref().unwrap();

    let latest = s.manifest.as_ref()
        .and_then(|m| m.get("version"))
        .and_then(|v| v.as_str());

    Json(json!({
        "current_version": CURRENT_VERSION,
        "latest_version": latest,
        "update_available": latest.map(|l| is_newer(l, CURRENT_VERSION)).unwrap_or(false),
        "notes": s.manifest.as_ref().and_then(|m| m.get("notes")).cloned().unwrap_or(Value::Null),
        "published_at": s.manifest.as_ref().and_then(|m| m.get("published_at")).cloned().unwrap_or(Value::Null),
        "url": s.manifest.as_ref().and_then(|m| m.get("url")).cloned().unwrap_or(Value::Null),
        "error": s.error,
        "manifest_url": manifest_url(),
        "staged": &*staged().read().await,
    }))
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn version_comparison() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(is_newer("v0.2.0", "0.1.0"));
    }
}
