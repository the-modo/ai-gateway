//! Marketing endpoints — contact form + download-request emails.
//!
//! Configured entirely via environment variables (so we don't ship SMTP
//! credentials in source). Inbound requests are rate-limited per-IP-per-hour
//! to keep the form from being abused.

use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use axum::{extract::ConnectInfo, http::StatusCode, response::IntoResponse, Json};
use lettre::{
    message::{header::ContentType, Mailbox, Message},
    transport::smtp::{authentication::Credentials, AsyncSmtpTransport},
    AsyncTransport, Tokio1Executor,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::Mutex;
use tracing::{info, warn};

/* ─── Config from env ────────────────────────────────────────────────────── */

#[derive(Clone)]
struct SmtpConfig {
    host: String,
    port: u16,
    user: String,
    pass: String,
    from: Mailbox,
    /// Where contact-form submissions are forwarded.
    sales_to: Mailbox,
    /// Download URL included in the welcome email.
    download_url: String,
}

fn smtp_config() -> Option<&'static SmtpConfig> {
    static CFG: OnceLock<Option<SmtpConfig>> = OnceLock::new();
    CFG.get_or_init(|| {
        let host = std::env::var("SMTP_HOST").ok()?;
        let user = std::env::var("SMTP_USER").ok()?;
        let pass = std::env::var("SMTP_PASS").ok()?;
        let from_str = std::env::var("SMTP_FROM").unwrap_or_else(|_| user.clone());
        let sales_str = std::env::var("MARKETING_SALES_TO").unwrap_or_else(|_| from_str.clone());
        let port = std::env::var("SMTP_PORT").ok().and_then(|s| s.parse().ok()).unwrap_or(587u16);
        let download_url = std::env::var("MARKETING_DOWNLOAD_URL")
            .unwrap_or_else(|_| "http://dilans.duckdns.org:4893/modo-latest.zip".to_string());
        Some(SmtpConfig {
            host,
            port,
            user,
            pass,
            from: from_str.parse().ok()?,
            sales_to: sales_str.parse().ok()?,
            download_url,
        })
    })
    .as_ref()
}

async fn send_email(to: Mailbox, subject: &str, html: String) -> anyhow::Result<()> {
    let cfg = smtp_config().ok_or_else(|| anyhow::anyhow!("SMTP not configured"))?;
    let email = Message::builder()
        .from(cfg.from.clone())
        .to(to)
        .subject(subject)
        .header(ContentType::TEXT_HTML)
        .body(html)?;
    let creds = Credentials::new(cfg.user.clone(), cfg.pass.clone());
    let mailer: AsyncSmtpTransport<Tokio1Executor> = AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.host)?
        .port(cfg.port)
        .credentials(creds)
        .build();
    mailer.send(email).await?;
    Ok(())
}

/* ─── Rate limiting (per IP, per hour) ───────────────────────────────────── */

fn rate_state() -> &'static Mutex<HashMap<String, Vec<Instant>>> {
    static S: OnceLock<Mutex<HashMap<String, Vec<Instant>>>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn rate_check(ip: String, max: usize) -> bool {
    let mut map = rate_state().lock().await;
    let now = Instant::now();
    let window = Duration::from_secs(3600);
    let entry = map.entry(ip).or_default();
    entry.retain(|t| now.duration_since(*t) < window);
    if entry.len() >= max { return false; }
    entry.push(now);
    true
}

/* ─── Validators ─────────────────────────────────────────────────────────── */

fn valid_email(s: &str) -> bool {
    s.len() >= 5 && s.len() <= 254
        && s.contains('@')
        && s.split('@').nth(1).map_or(false, |d| d.contains('.'))
        && !s.contains(' ')
}

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/* ─── /marketing/download-request ────────────────────────────────────────── */

#[derive(Deserialize)]
pub struct DownloadRequest {
    pub email: String,
    #[serde(default)]
    pub name: String,
}

#[derive(Serialize)]
struct OkResp { ok: bool }

pub async fn download_request(
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(req): Json<DownloadRequest>,
) -> impl IntoResponse {
    if !valid_email(&req.email) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid email" }))).into_response();
    }
    if !rate_check(addr.ip().to_string(), 5).await {
        return (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "too many requests — try again later" }))).into_response();
    }

    let cfg = match smtp_config() {
        Some(c) => c,
        None => {
            warn!(email = %req.email, "Download request received but SMTP is not configured");
            return (StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "email delivery temporarily unavailable" }))).into_response();
        }
    };

    let recipient: Mailbox = match req.email.parse() {
        Ok(m) => m,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid email" }))).into_response(),
    };

    let first_name = req.name.split_whitespace().next().unwrap_or("there");
    let html = welcome_email_html(first_name, &cfg.download_url);

    match send_email(recipient, "Your Modo AI Gateway download", html).await {
        Ok(()) => {
            info!(email = %req.email, "Download email sent");
            (StatusCode::OK, Json(OkResp { ok: true })).into_response()
        }
        Err(e) => {
            warn!(email = %req.email, error = %e, "Failed to send download email");
            (StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "could not send email — please try again" }))).into_response()
        }
    }
}

fn welcome_email_html(first_name: &str, download_url: &str) -> String {
    format!(r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f5f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0a0c1c;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 4px 32px rgba(20,30,80,0.08)">
  <tr><td style="padding:36px 40px 24px;background:linear-gradient(135deg,#4338ca 0%,#6366f1 50%,#22d3ee 100%);color:#fff">
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.3px">Modo AI Gateway</div>
    <div style="font-size:13px;opacity:0.85;margin-top:4px">Welcome aboard, {name}.</div>
  </td></tr>
  <tr><td style="padding:32px 40px 8px">
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
      Thanks for downloading <strong>Modo AI Gateway</strong> — the fastest open-source
      AI gateway, written in Rust.
    </p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.6">
      Your download is below. Unzip, run the included <code>modo</code> binary, point any
      OpenAI client at <code>http://localhost:4891/v1</code>, and you're done.
    </p>
    <table cellpadding="0" cellspacing="0" style="margin:0 auto 16px">
      <tr><td style="background:linear-gradient(135deg,#4338ca 0%,#6366f1 100%);border-radius:12px;box-shadow:0 4px 16px rgba(99,102,241,0.35)">
        <a href="{url}" style="display:inline-block;padding:14px 28px;color:#fff;font-weight:700;text-decoration:none;font-size:14px">⬇  Download Modo AI Gateway (.zip)</a>
      </td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:12px;color:#62687a;text-align:center">
      Or copy this link: <a href="{url}" style="color:#4f46e5">{url}</a>
    </p>
  </td></tr>
  <tr><td style="padding:8px 40px 24px"><div style="height:1px;background:#e6e9f2"></div></td></tr>
  <tr><td style="padding:0 40px 28px">
    <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#62687a;text-transform:uppercase;margin-bottom:10px">License &amp; usage</div>
    <div style="background:#fef7eb;border:1px solid #fde0a8;border-radius:12px;padding:14px 16px;margin-bottom:12px">
      <div style="font-size:13px;font-weight:700;color:#9a3412;margin-bottom:6px">⚖  Intellectual property</div>
      <div style="font-size:12px;line-height:1.6;color:#693813">
        Modo AI Gateway and all included source code are © Modo, all rights reserved.
        This download is distributed for non-commercial use only under the included license.
      </div>
    </div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:14px 16px">
      <div style="font-size:13px;font-weight:700;color:#991b1b;margin-bottom:6px">⚠  Not for production use</div>
      <div style="font-size:12px;line-height:1.6;color:#7f1d1d">
        Personal, evaluation, research and educational use is fully permitted.
        Routing live customer traffic, processing paid services, or any commercial
        deployment <strong>requires a separate commercial license</strong>.
        Reach out before going to production — we'll set you up.
      </div>
    </div>
  </td></tr>
  <tr><td style="padding:0 40px 32px">
    <div style="font-size:11px;font-weight:700;letter-spacing:1px;color:#62687a;text-transform:uppercase;margin-bottom:10px">What you get</div>
    <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.8;color:#1f2335">
      <li>Single static Rust binary — sub-2µs gateway overhead</li>
      <li>Unified OpenAI-compatible API across 7+ providers</li>
      <li>Visual routing canvas with conditions and fallbacks</li>
      <li>Semantic cache, guardrails, content shield, MCP gateway</li>
      <li>Real-time analytics, audit logs, key management</li>
    </ul>
  </td></tr>
  <tr><td style="padding:24px 40px 32px;background:#fafbff;border-top:1px solid #eef0f7;text-align:center">
    <div style="font-size:11px;color:#8089a0">© Modo AI Gateway · Free for non-commercial use</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>"#,
        name = escape_html(first_name),
        url = download_url,
    )
}

/* ─── /marketing/contact ─────────────────────────────────────────────────── */

#[derive(Deserialize)]
pub struct ContactRequest {
    pub name: String,
    pub email: String,
    #[serde(default)]
    pub company: String,
    pub intent: String,
    pub message: String,
}

pub async fn contact(
    ConnectInfo(addr): ConnectInfo<std::net::SocketAddr>,
    Json(req): Json<ContactRequest>,
) -> impl IntoResponse {
    if req.name.trim().is_empty() || !valid_email(&req.email) || req.message.trim().len() < 10 {
        return (StatusCode::BAD_REQUEST,
            Json(json!({ "error": "name, valid email and a message (10+ chars) are required" }))).into_response();
    }
    if !rate_check(addr.ip().to_string(), 5).await {
        return (StatusCode::TOO_MANY_REQUESTS,
            Json(json!({ "error": "too many requests — try again later" }))).into_response();
    }

    let cfg = match smtp_config() {
        Some(c) => c,
        None => {
            warn!("Contact form submission received but SMTP is not configured");
            return (StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "error": "email delivery temporarily unavailable" }))).into_response();
        }
    };

    let html = format!(r#"<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;color:#0a0c1c;padding:24px">
<h2 style="margin:0 0 12px">New Modo contact form submission</h2>
<table cellpadding="6" style="font-size:13px;border-collapse:collapse">
<tr><td style="color:#666">Name</td><td><strong>{name}</strong></td></tr>
<tr><td style="color:#666">Email</td><td><a href="mailto:{email}">{email}</a></td></tr>
<tr><td style="color:#666">Company</td><td>{company}</td></tr>
<tr><td style="color:#666">Intent</td><td><strong>{intent}</strong></td></tr>
</table>
<div style="margin-top:16px;padding:16px;background:#f5f6fa;border-radius:10px;white-space:pre-wrap;font-size:13px;line-height:1.6">{message}</div>
</body></html>"#,
        name = escape_html(req.name.trim()),
        email = escape_html(req.email.trim()),
        company = escape_html(if req.company.trim().is_empty() { "—" } else { req.company.trim() }),
        intent = escape_html(&req.intent),
        message = escape_html(req.message.trim()),
    );

    let subject = format!("Modo contact — {} ({})", req.intent, req.name.trim());
    match send_email(cfg.sales_to.clone(), &subject, html).await {
        Ok(()) => {
            info!(email = %req.email, intent = %req.intent, "Contact form forwarded");
            (StatusCode::OK, Json(OkResp { ok: true })).into_response()
        }
        Err(e) => {
            warn!(email = %req.email, error = %e, "Failed to forward contact form");
            (StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": "could not send — please try again" }))).into_response()
        }
    }
}
