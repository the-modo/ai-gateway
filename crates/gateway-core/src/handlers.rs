use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use futures::StreamExt;
use serde::Deserialize;
use serde_json::json;
use tracing::{info, instrument, warn};
use uuid::Uuid;

use gateway_cache::{cache_key, semantic_parts};
use gateway_providers::{ChatRequest, ContentPart, MessageContent};
use gateway_storage::{
    LogEntry,
    queries::{
        self as storage_queries,
        delete_all_requests, delete_requests_by_ids, get_log_detail, get_storage_status,
        query_breakdown, query_logs, query_summary, query_timeseries,
    },
};
use gateway_telemetry::Metrics;

use crate::{
    error::GatewayError,
    state::{AppState, ContentShieldConfig, GuardrailConfig, ModelPricing, ModelPricingConfig},
};

// ─── Guardrail engine ─────────────────────────────────────────────────────────

pub(crate) enum GuardrailOutcome {
    Pass,
    Flagged(String),
    Blocked(String),
}

/// Extract all text content from a chat request's messages.
fn extract_request_text(req: &ChatRequest) -> String {
    req.messages
        .iter()
        .map(|m| match &m.content {
            MessageContent::Text(s) => s.clone(),
            MessageContent::Parts(parts) => parts
                .iter()
                .filter_map(|p| {
                    if let ContentPart::Text { text } = p {
                        Some(text.clone())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join(" "),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Check text against guardrail rules for the given scope ("request" or "response").
/// Returns the most severe outcome across all matching rules.
pub(crate) fn check_guardrails(text: &str, config: &GuardrailConfig, scope: &str) -> GuardrailOutcome {
    let lower = text.to_lowercase();
    let mut first_flag: Option<String> = None;

    for rule in &config.rules {
        if !rule.enabled || rule.action == "off" {
            continue;
        }
        if rule.scope != "both" && rule.scope != scope {
            continue;
        }

        let keyword_hit = rule
            .keywords
            .iter()
            .any(|kw| lower.contains(kw.to_lowercase().as_str()));

        let pattern_hit = !keyword_hit
            && rule.patterns.iter().any(|pat| {
                regex::RegexBuilder::new(pat)
                    .case_insensitive(true)
                    .build()
                    .ok()
                    .map(|re| re.is_match(text))
                    .unwrap_or(false)
            });

        if keyword_hit || pattern_hit {
            match rule.action.as_str() {
                "block" => return GuardrailOutcome::Blocked(rule.label.clone()),
                "flag" => {
                    first_flag = first_flag.or(Some(rule.label.clone()));
                }
                _ => {}
            }
        }
    }

    match first_flag {
        Some(label) => GuardrailOutcome::Flagged(label),
        None => GuardrailOutcome::Pass,
    }
}

// ─── Content Shield engine ────────────────────────────────────────────────────

use std::collections::HashMap;

pub(crate) fn builtin_shield_patterns() -> HashMap<&'static str, &'static str> {
    let mut m = HashMap::new();
    m.insert("cc",       r"\b(?:4[0-9]{3}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}|5[1-5][0-9]{2}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}|3[47][0-9]{2}[\s\-]?[0-9]{6}[\s\-]?[0-9]{5})\b");
    m.insert("ssn",      r"\b\d{3}-\d{2}-\d{4}\b");
    m.insert("email",    r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b");
    m.insert("phone",    r"(?:\+?1[.\-\s]?)?\(?[2-9]\d{2}\)?[.\-\s]?\d{3}[.\-\s]?\d{4}\b");
    m.insert("apikey",   r"\b(?:sk-proj-[a-zA-Z0-9_\-]{16,}|sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36}|xoxb-[a-zA-Z0-9\-]{40,})\b");
    m.insert("aws",      r"\bAKIA[0-9A-Z]{16}\b");
    m.insert("privkey",  r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----");
    m.insert("iban",     r"\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b");
    m.insert("passport", r"\b[A-Z]{1,2}\s?\d{7,9}\b");
    m.insert("health",   r"\b(?:NPI:\s*\d{10}|MRN[:\s]+\d{6,10})\b");
    m
}

pub(crate) fn shield_regex(
    rule: &crate::state::ContentShieldRule,
    builtin: &HashMap<&str, &str>,
) -> Option<regex::Regex> {
    let pattern = if !rule.pattern.is_empty() {
        rule.pattern.as_str()
    } else {
        builtin.get(rule.id.as_str()).copied().unwrap_or("")
    };
    if pattern.is_empty() { return None; }
    regex::Regex::new(pattern).ok()
}

fn extract_message_text(msg: &gateway_providers::Message) -> String {
    match &msg.content {
        MessageContent::Text(s) => s.clone(),
        MessageContent::Parts(parts) => parts
            .iter()
            .filter_map(|p| if let ContentPart::Text { text } = p { Some(text.as_str()) } else { None })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

fn redact_message_content(
    content: &mut MessageContent,
    re: &regex::Regex,
    replacement: &str,
) {
    match content {
        MessageContent::Text(s) => {
            *s = re.replace_all(s, replacement).into_owned();
        }
        MessageContent::Parts(parts) => {
            for part in parts.iter_mut() {
                if let ContentPart::Text { text } = part {
                    *text = re.replace_all(text, replacement).into_owned();
                }
            }
        }
    }
}

/// Run content shield against request messages.
/// Mutates messages in place for "redact" rules.
/// Returns the most severe outcome (Block > Flag > Pass).
fn apply_content_shield(
    messages: &mut Vec<gateway_providers::Message>,
    config: &ContentShieldConfig,
    scope: &str,
) -> GuardrailOutcome {
    let builtin = builtin_shield_patterns();
    let scope_ok = |s: &str| s == "both" || s == scope;

    // Pass 1: blocks — abort early on first match
    for msg in messages.iter() {
        let text = extract_message_text(msg);
        for rule in &config.rules {
            if !rule.enabled || rule.action != "block" || !scope_ok(&rule.scope) { continue; }
            if let Some(re) = shield_regex(rule, &builtin) {
                if re.is_match(&text) {
                    return GuardrailOutcome::Blocked(rule.label.clone());
                }
            }
        }
    }

    // Pass 2: collect flag labels from original content
    let mut first_flag: Option<String> = None;
    for msg in messages.iter() {
        let text = extract_message_text(msg);
        for rule in &config.rules {
            if !rule.enabled || rule.action != "flag" || !scope_ok(&rule.scope) { continue; }
            if first_flag.is_none() {
                if let Some(re) = shield_regex(rule, &builtin) {
                    if re.is_match(&text) {
                        first_flag = Some(rule.label.clone());
                    }
                }
            }
        }
    }

    // Pass 3: apply redactions (mutates messages in place). Redactions that
    // actually replaced something are reported so they appear in log traces.
    let mut redacted_label: Option<String> = None;
    for msg in messages.iter_mut() {
        for rule in &config.rules {
            if !rule.enabled || rule.action != "redact" || !scope_ok(&rule.scope) { continue; }
            if let Some(re) = shield_regex(rule, &builtin) {
                if re.is_match(&extract_message_text(msg)) {
                    redacted_label.get_or_insert_with(|| rule.label.clone());
                    redact_message_content(&mut msg.content, &re, &rule.replacement);
                }
            }
        }
    }

    match first_flag.or(redacted_label) {
        Some(label) => GuardrailOutcome::Flagged(label),
        None => GuardrailOutcome::Pass,
    }
}

// ─── Chat completions ─────────────────────────────────────────────────────────

#[instrument(skip_all, fields(model = %req.model))]
pub async fn chat_completions(
    State(state): State<AppState>,
    Json(mut req): Json<ChatRequest>,
) -> Result<Response, GatewayError> {
    let is_stream = req.stream.unwrap_or(false);
    let start = Instant::now();
    let log_bodies = state.log_bodies();

    // ── Guardrail check on the incoming request ──────────────────────────────
    let guardrail_flag: Option<String> = {
        let cfg = state.guardrail_config.read().await;
        if cfg.rules.is_empty() {
            None
        } else {
            let text = extract_request_text(&req);
            match check_guardrails(&text, &cfg, "request") {
                GuardrailOutcome::Blocked(label) => {
                    warn!(rule = %label, "Guardrail blocked request");
                    return Err(GatewayError::bad_request(format!(
                        "Request blocked by guardrail: {label}"
                    )));
                }
                GuardrailOutcome::Flagged(label) => {
                    warn!(rule = %label, "Guardrail flagged request");
                    Some(label)
                }
                GuardrailOutcome::Pass => None,
            }
        }
    };

    // ── Content Shield check on the incoming request ─────────────────────────
    let shield_flag: Option<String> = {
        let cfg = state.content_shield_config.read().await;
        if cfg.rules.is_empty() {
            None
        } else {
            match apply_content_shield(&mut req.messages, &cfg, "request") {
                GuardrailOutcome::Blocked(label) => {
                    warn!(pattern = %label, "Content Shield blocked request");
                    return Err(GatewayError::bad_request(format!(
                        "Request blocked by Content Shield: {label}"
                    )));
                }
                GuardrailOutcome::Flagged(label) => {
                    warn!(pattern = %label, "Content Shield flagged request");
                    Some(label)
                }
                GuardrailOutcome::Pass => None,
            }
        }
    };

    // Guardrail / Content Shield activations recorded with every log row.
    let log_flags: Option<String> = {
        let mut f: Vec<String> = Vec::new();
        if let Some(ref l) = guardrail_flag { f.push(format!("guardrail:{l}")); }
        if let Some(ref l) = shield_flag    { f.push(format!("shield:{l}")); }
        if f.is_empty() { None } else { Some(f.join(",")) }
    };

    // Serialise request body once — only when log_bodies is enabled (truncated at 8 KB).
    let req_body_json: Option<String> = if log_bodies {
        serde_json::to_string(&req).ok().map(|s| {
            if s.len() > 8192 { format!("{}…", &s[..8192]) } else { s }
        })
    } else {
        None
    };

    // Exact cache (non-streaming only, and only when cache is enabled at runtime)
    if !is_stream && state.cache_enabled() {
        let key = cache_key(&req);
        if let Some(cached) = state.cache.get(&key).await {
            Metrics::record_cache_hit("exact");
            info!(model = %req.model, "Cache hit");

            if let Some(ref logger) = state.logger {
                let resp_json = if log_bodies {
                    serde_json::to_string(&*cached).ok().map(|s| {
                        if s.len() > 8192 { format!("{}…", &s[..8192]) } else { s }
                    })
                } else { None };
                let pricing_snapshot = state.model_pricing.read().await.models.clone();
                logger.log(make_log(
                    &req.model, "cache", 200, start.elapsed().as_millis() as i64,
                    0, 0, true, is_stream, None, log_flags.clone(),
                    req_body_json.clone(), resp_json,
                    &pricing_snapshot,
                ));
            }

            let mut resp = Json((*cached).clone()).into_response();
            add_guardrail_flag_header(&mut resp, &guardrail_flag);
            add_shield_flag_header(&mut resp, &shield_flag);
            return Ok(resp);
        }
    }

    // Semantic cache — similarity match on the last user message, scoped to
    // identical model + conversation context (non-streaming only).
    let semantic_settings = state.semantic_settings.read().await.clone();
    let semantic_req = if !is_stream && state.cache_enabled() && semantic_settings.enabled {
        semantic_parts(&req)
    } else {
        None
    };

    if let Some((scope, ref text)) = semantic_req {
        if let Some((cached, sim)) =
            state.semantic_cache.get(scope, text, semantic_settings.threshold)
        {
            Metrics::record_cache_hit("semantic");
            info!(model = %req.model, similarity = sim, "Semantic cache hit");

            if let Some(ref logger) = state.logger {
                let resp_json = if log_bodies {
                    serde_json::to_string(&*cached).ok().map(|s| {
                        if s.len() > 8192 { format!("{}…", &s[..8192]) } else { s }
                    })
                } else { None };
                let pricing_snapshot = state.model_pricing.read().await.models.clone();
                logger.log(make_log(
                    &req.model, "cache", 200, start.elapsed().as_millis() as i64,
                    0, 0, true, is_stream, None, log_flags.clone(),
                    req_body_json.clone(), resp_json,
                    &pricing_snapshot,
                ));
            }

            let mut resp = Json((*cached).clone()).into_response();
            if let Ok(v) = "semantic".parse() {
                resp.headers_mut().insert("x-cache", v);
            }
            if let Ok(v) = format!("{sim:.4}").parse() {
                resp.headers_mut().insert("x-cache-similarity", v);
            }
            add_guardrail_flag_header(&mut resp, &guardrail_flag);
            add_shield_flag_header(&mut resp, &shield_flag);
            return Ok(resp);
        }
    }

    let providers = state.providers.ordered_providers(&req.model);
    if providers.is_empty() {
        return Err(GatewayError::not_found(format!(
            "No provider configured for model '{}'",
            req.model
        )));
    }

    let (retries, retry_delay_ms) = state.providers.route_params(&req.model);

    let mut last_err: Option<String> = None;
    for attempt in 0..=retries {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(retry_delay_ms)).await;
        }

        for provider in &providers {
            let req_start = Instant::now();

            if is_stream {
                match provider.chat_stream(req.clone()).await {
                    Ok(stream) => {
                        let latency = req_start.elapsed().as_millis() as i64;
                        state.providers.record_latency(provider.name(), latency as f64);
                        Metrics::record_request(
                            &req.model,
                            provider.name(),
                            "200",
                            start.elapsed().as_secs_f64(),
                        );

                        if let Some(ref logger) = state.logger {
                            let pricing_snapshot = state.model_pricing.read().await.models.clone();
                            logger.log(make_log(
                                &req.model, provider.name(), 200, latency,
                                0, 0, false, true, None, log_flags.clone(),
                                req_body_json.clone(), None,
                                &pricing_snapshot,
                            ));
                        }

                        let body = Body::from_stream(stream.map(|chunk| {
                            chunk.map_err(|e| std::io::Error::other(e.to_string()))
                        }));

                        let mut builder = Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "text/event-stream")
                            .header(header::CACHE_CONTROL, "no-cache")
                            .header(header::CONNECTION, "keep-alive")
                            .header("X-Gateway-Provider", provider.name())
                            .header("X-Gateway-Attempt", attempt.to_string());

                        if let Some(ref flag) = guardrail_flag {
                            builder = builder.header("X-Gateway-Guardrail-Flag", sanitize_header(flag));
                        }
                        if let Some(ref flag) = shield_flag {
                            builder = builder.header("X-Gateway-Shield-Flag", sanitize_header(flag));
                        }

                        return Ok(builder.body(body).unwrap());
                    }
                    Err(e) => {
                        warn!(provider = %provider.name(), attempt, "Stream failed: {e}");
                        last_err = Some(e.to_string());

                        if let Some(ref logger) = state.logger {
                            let pricing_snapshot = state.model_pricing.read().await.models.clone();
                            logger.log(make_log(
                                &req.model, provider.name(), 502,
                                req_start.elapsed().as_millis() as i64,
                                0, 0, false, true, Some(e.to_string()), log_flags.clone(),
                                req_body_json.clone(), None,
                                &pricing_snapshot,
                            ));
                        }
                    }
                }
            } else {
                match provider.chat(req.clone()).await {
                    Ok(response) => {
                        let latency = req_start.elapsed().as_millis() as i64;
                        state.providers.record_latency(provider.name(), latency as f64);
                        Metrics::record_request(
                            &req.model,
                            provider.name(),
                            "200",
                            start.elapsed().as_secs_f64(),
                        );
                        Metrics::record_tokens(
                            &req.model,
                            provider.name(),
                            response.usage.prompt_tokens,
                            response.usage.completion_tokens,
                        );

                        let resp_json = if log_bodies {
                            serde_json::to_string(&response).ok().map(|s| {
                                if s.len() > 8192 { format!("{}…", &s[..8192]) } else { s }
                            })
                        } else { None };

                        if let Some(ref logger) = state.logger {
                            let pricing_snapshot = state.model_pricing.read().await.models.clone();
                            logger.log(make_log(
                                &req.model,
                                provider.name(),
                                200,
                                latency,
                                response.usage.prompt_tokens as i64,
                                response.usage.completion_tokens as i64,
                                false,
                                false,
                                None,
                                log_flags.clone(),
                                req_body_json.clone(),
                                resp_json,
                                &pricing_snapshot,
                            ));
                        }

                        if state.cache_enabled() {
                            let key = cache_key(&req);
                            state.cache.insert(key, response.clone()).await;
                        }
                        if let Some((scope, ref text)) = semantic_req {
                            state.semantic_cache.insert(
                                scope, text, response.clone(),
                                Duration::from_secs(semantic_settings.ttl_seconds),
                                semantic_settings.max_entries,
                            );
                        }

                        let mut resp = Json(response).into_response();
                        if let Ok(v) = provider.name().parse() {
                            resp.headers_mut().insert("X-Gateway-Provider", v);
                        }
                        if let Ok(v) = attempt.to_string().parse() {
                            resp.headers_mut().insert("X-Gateway-Attempt", v);
                        }
                        add_guardrail_flag_header(&mut resp, &guardrail_flag);
                        add_shield_flag_header(&mut resp, &shield_flag);
                        return Ok(resp);
                    }
                    Err(e) => {
                        warn!(provider = %provider.name(), attempt, "Request failed: {e}");
                        last_err = Some(e.to_string());

                        if let Some(ref logger) = state.logger {
                            let pricing_snapshot = state.model_pricing.read().await.models.clone();
                            logger.log(make_log(
                                &req.model, provider.name(), 502,
                                req_start.elapsed().as_millis() as i64,
                                0, 0, false, false, Some(e.to_string()), log_flags.clone(),
                                req_body_json.clone(), None,
                                &pricing_snapshot,
                            ));
                        }
                    }
                }
            }
        }
    }

    Metrics::record_request(&req.model, "none", "502", start.elapsed().as_secs_f64());
    Err(GatewayError::upstream(
        last_err.unwrap_or_else(|| "All providers and retries exhausted".to_string()),
    ))
}

fn sanitize_header(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_graphic() || c == ' ' { c } else { '_' })
        .collect()
}

fn add_guardrail_flag_header(resp: &mut Response, flag: &Option<String>) {
    if let Some(ref label) = flag {
        let val = sanitize_header(label);
        if let Ok(v) = val.parse() {
            resp.headers_mut().insert("X-Gateway-Guardrail-Flag", v);
        }
    }
}

fn add_shield_flag_header(resp: &mut Response, flag: &Option<String>) {
    if let Some(ref label) = flag {
        let val = sanitize_header(label);
        if let Ok(v) = val.parse() {
            resp.headers_mut().insert("X-Gateway-Shield-Flag", v);
        }
    }
}

pub(crate) fn make_log(
    model: &str,
    provider: &str,
    status: i32,
    latency_ms: i64,
    prompt_tokens: i64,
    completion_tokens: i64,
    cached: bool,
    stream: bool,
    error: Option<String>,
    flags: Option<String>,
    request_body: Option<String>,
    response_body: Option<String>,
    pricing: &[ModelPricing],
) -> LogEntry {
    let total = prompt_tokens + completion_tokens;
    // Test/mock providers and internal sources never incur real spend.
    let free_source = provider.to_lowercase().starts_with("mock")
        || provider == "cache"
        || provider == "mcp";
    let cost = if free_source {
        0.0
    } else {
        estimate_cost_dynamic(model, prompt_tokens, completion_tokens, pricing)
    };
    LogEntry {
        id: Uuid::new_v4().to_string(),
        ts: chrono::Utc::now().timestamp_millis(),
        model: model.to_string(),
        provider: provider.to_string(),
        status,
        latency_ms,
        prompt_tokens,
        completion_tokens,
        total_tokens: total,
        cost_usd: cost,
        cached,
        stream,
        error,
        flags,
        request_body,
        response_body,
    }
}

fn estimate_cost_dynamic(model: &str, prompt: i64, completion: i64, pricing: &[ModelPricing]) -> f64 {
    // Try to find in config first (exact match or suffix match)
    if let Some(m) = pricing.iter().find(|m| m.enabled && (model == m.id || model.ends_with(&*m.id) || m.id.ends_with(model))) {
        return prompt as f64 * m.input_per_1m / 1_000_000.0 + completion as f64 * m.output_per_1m / 1_000_000.0;
    }
    // Fall back to built-in defaults
    estimate_cost(model, prompt, completion)
}

fn estimate_cost(model: &str, prompt: i64, completion: i64) -> f64 {
    let (p, c) = if model.contains("gpt-4o-mini") {
        (0.15, 0.60)
    } else if model.contains("gpt-4o") {
        (5.0, 15.0)
    } else if model.contains("claude-opus") {
        (15.0, 75.0)
    } else if model.contains("claude-sonnet") {
        (3.0, 15.0)
    } else if model.contains("claude-haiku") {
        (0.25, 1.25)
    } else if model.contains("gemini-1.5-pro") {
        (3.5, 10.5)
    } else if model.contains("gemini") {
        (0.075, 0.30)
    } else if model.contains("o1") {
        (15.0, 60.0)
    } else {
        (1.0, 3.0)
    };
    prompt as f64 * p / 1_000_000.0 + completion as f64 * c / 1_000_000.0
}

// ─── Models / health / metrics ────────────────────────────────────────────────

pub async fn list_models(State(state): State<AppState>) -> Json<serde_json::Value> {
    let providers = state.providers.all();
    let models: Vec<_> = providers
        .iter()
        .flat_map(|p| {
            p.supported_models()
                .iter()
                .map(|m| json!({ "id": m, "object": "model", "owned_by": p.name() }))
        })
        .collect();
    Json(json!({ "object": "list", "data": models }))
}

pub async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

pub async fn metrics() -> Result<String, GatewayError> {
    Metrics::render().map_err(|e| GatewayError::upstream(e.to_string()))
}

// ─── Analytics ───────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RangeParams {
    pub from: Option<i64>,
    pub to: Option<i64>,
}

#[derive(Deserialize)]
pub struct TimeseriesParams {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub interval: Option<i64>,
}

#[derive(Deserialize)]
pub struct BreakdownParams {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub group_by: Option<String>,
}

#[derive(Deserialize)]
pub struct LogsParams {
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub exclude_provider: Option<String>,
    pub status: Option<i32>,
    pub search: Option<String>,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
    pub page: Option<i64>,
    pub per_page: Option<i64>,
}

fn default_range() -> (i64, i64) {
    let now = chrono::Utc::now().timestamp_millis();
    (now - 24 * 3600 * 1000, now)
}

pub async fn analytics_summary(
    State(state): State<AppState>,
    Query(p): Query<RangeParams>,
) -> Result<Json<serde_json::Value>, GatewayError> {
    let db = require_db(&state)?;
    let (from, to) = range(p.from, p.to);
    let summary = query_summary(db, from, to)
        .await
        .map_err(|e| GatewayError::upstream(e.to_string()))?;
    Ok(Json(serde_json::to_value(summary).unwrap()))
}

pub async fn analytics_timeseries(
    State(state): State<AppState>,
    Query(p): Query<TimeseriesParams>,
) -> Result<Json<serde_json::Value>, GatewayError> {
    let db = require_db(&state)?;
    let (from, to) = range(p.from, p.to);
    let interval = p.interval.unwrap_or(3_600_000);
    let points = query_timeseries(db, from, to, interval)
        .await
        .map_err(|e| GatewayError::upstream(e.to_string()))?;
    Ok(Json(serde_json::to_value(points).unwrap()))
}

pub async fn analytics_breakdown(
    State(state): State<AppState>,
    Query(p): Query<BreakdownParams>,
) -> Result<Json<serde_json::Value>, GatewayError> {
    let db = require_db(&state)?;
    let (from, to) = range(p.from, p.to);
    let group_by = p.group_by.as_deref().unwrap_or("model");
    let items = query_breakdown(db, from, to, group_by)
        .await
        .map_err(|e| GatewayError::upstream(e.to_string()))?;
    Ok(Json(serde_json::to_value(items).unwrap()))
}

pub async fn logs_list(
    State(state): State<AppState>,
    Query(p): Query<LogsParams>,
) -> Result<Json<serde_json::Value>, GatewayError> {
    let db = require_db(&state)?;
    let (from, to) = range(p.from, p.to);
    let page = p.page.unwrap_or(1).max(1);
    let per_page = p.per_page.unwrap_or(50).clamp(1, 200);
    let result = query_logs(
        db, from, to,
        p.model.as_deref(), p.provider.as_deref(), p.exclude_provider.as_deref(), p.status,
        p.search.as_deref(), p.sort_by.as_deref(), p.sort_dir.as_deref(),
        page, per_page,
    )
    .await
    .map_err(|e| GatewayError::upstream(e.to_string()))?;
    Ok(Json(serde_json::to_value(result).unwrap()))
}

pub async fn logs_get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, GatewayError> {
    let db = require_db(&state)?;
    match get_log_detail(db, &id)
        .await
        .map_err(|e| GatewayError::upstream(e.to_string()))?
    {
        Some(detail) => Ok(Json(serde_json::to_value(detail).unwrap())),
        None => Err(GatewayError::not_found(format!("Log {id} not found"))),
    }
}

#[derive(Deserialize)]
pub struct DeleteLogsBody {
    pub ids: Option<Vec<String>>,
}

pub async fn logs_delete(
    State(state): State<AppState>,
    body: Option<Json<DeleteLogsBody>>,
) -> Result<Json<serde_json::Value>, GatewayError> {
    let db = require_db(&state)?;
    let deleted = match body.and_then(|b| b.ids.clone()) {
        Some(ids) if !ids.is_empty() => {
            let id_refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
            delete_requests_by_ids(db, &id_refs)
                .await
                .map_err(|e| GatewayError::upstream(e.to_string()))?
        }
        _ => delete_all_requests(db)
            .await
            .map_err(|e| GatewayError::upstream(e.to_string()))?,
    };
    Ok(Json(json!({ "deleted": deleted })))
}

pub async fn storage_status(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, GatewayError> {
    let db = require_db(&state)?;
    let backend = state.db_backend.as_deref().unwrap_or("sqlite");
    let url = state.config().storage.database_url.clone();
    let status = get_storage_status(db, backend, &url)
        .await
        .map_err(|e| GatewayError::upstream(e.to_string()))?;
    Ok(Json(serde_json::to_value(status).unwrap()))
}

fn require_db(state: &AppState) -> Result<&sqlx::Pool<sqlx::Any>, GatewayError> {
    state
        .db
        .as_deref()
        .ok_or_else(|| GatewayError::upstream("Storage not initialised".to_string()))
}

// ─── Runtime config ───────────────────────────────────────────────────────────

pub async fn storage_config_get(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.config();
    Json(json!({
        "log_bodies":      state.log_bodies(),
        "retention_days":  cfg.storage.retention_days,
    }))
}

#[derive(Deserialize)]
pub struct StorageConfigPatch {
    pub log_bodies: Option<bool>,
}

pub async fn storage_config_patch(
    State(state): State<AppState>,
    Json(patch): Json<StorageConfigPatch>,
) -> Json<serde_json::Value> {
    if let Some(v) = patch.log_bodies {
        state.set_log_bodies(v);
    }
    let cfg = state.config();
    Json(json!({
        "log_bodies":     state.log_bodies(),
        "retention_days": cfg.storage.retention_days,
    }))
}

pub async fn cache_config_get(State(state): State<AppState>) -> Json<serde_json::Value> {
    let sem = state.semantic_settings.read().await.clone();
    Json(json!({
        "enabled": state.cache_enabled(),
        "semantic": {
            "enabled": sem.enabled,
            "threshold": sem.threshold,
            "ttl_seconds": sem.ttl_seconds,
            "max_entries": sem.max_entries,
            "entry_count": state.semantic_cache.len(),
        },
    }))
}

#[derive(Deserialize)]
pub struct SemanticCachePatch {
    pub enabled: Option<bool>,
    pub threshold: Option<f32>,
    pub ttl_seconds: Option<u64>,
    pub max_entries: Option<usize>,
}

#[derive(Deserialize)]
pub struct CacheConfigPatch {
    pub enabled: Option<bool>,
    pub semantic: Option<SemanticCachePatch>,
}

pub async fn cache_config_patch(
    State(state): State<AppState>,
    Json(patch): Json<CacheConfigPatch>,
) -> Json<serde_json::Value> {
    if let Some(v) = patch.enabled {
        state.set_cache_enabled(v);
    }

    if let Some(sem_patch) = patch.semantic {
        let mut sem = state.semantic_settings.write().await;
        if let Some(v) = sem_patch.enabled {
            sem.enabled = v;
            if !v {
                state.semantic_cache.clear();
            }
        }
        if let Some(v) = sem_patch.threshold {
            sem.threshold = v.clamp(0.5, 0.999);
        }
        if let Some(v) = sem_patch.ttl_seconds {
            sem.ttl_seconds = v.max(1);
        }
        if let Some(v) = sem_patch.max_entries {
            sem.max_entries = v.clamp(1, 1_000_000);
        }
        let snapshot = sem.clone();
        drop(sem);

        if let Some(pool) = &state.db {
            if let Ok(json) = serde_json::to_string(&snapshot) {
                let _ = storage_queries::config_save(pool, "semantic-cache", &json).await;
            }
        }
        info!(
            enabled = snapshot.enabled, threshold = snapshot.threshold,
            ttl = snapshot.ttl_seconds, max_entries = snapshot.max_entries,
            "Semantic cache config updated"
        );
    }

    let sem = state.semantic_settings.read().await.clone();
    Json(json!({
        "enabled": state.cache_enabled(),
        "semantic": {
            "enabled": sem.enabled,
            "threshold": sem.threshold,
            "ttl_seconds": sem.ttl_seconds,
            "max_entries": sem.max_entries,
            "entry_count": state.semantic_cache.len(),
        },
    }))
}

// ─── Guardrails config API ────────────────────────────────────────────────────

pub async fn guardrails_config_get(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.guardrail_config.read().await;
    Json(json!({ "rules": cfg.rules }))
}

pub async fn guardrails_config_put(
    State(state): State<AppState>,
    Json(body): Json<GuardrailConfig>,
) -> Json<serde_json::Value> {
    let rule_count = body.rules.len();
    let block_count = body.rules.iter().filter(|r| r.enabled && r.action == "block").count();
    let flag_count  = body.rules.iter().filter(|r| r.enabled && r.action == "flag").count();

    {
        let mut cfg = state.guardrail_config.write().await;
        *cfg = body;
    }

    if let Some(pool) = &state.db {
        if let Ok(json) = serde_json::to_string(&*state.guardrail_config.read().await) {
            let _ = storage_queries::config_save(pool, "guardrails", &json).await;
        }
    }

    info!(rules = rule_count, blocking = block_count, flagging = flag_count, "Guardrail config updated");
    Json(json!({
        "ok": true,
        "rules": rule_count,
        "blocking": block_count,
        "flagging": flag_count,
    }))
}

// ─── Content Shield config API ────────────────────────────────────────────────

pub async fn content_shield_config_get(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.content_shield_config.read().await;
    Json(json!({ "rules": cfg.rules }))
}

pub async fn content_shield_config_put(
    State(state): State<AppState>,
    Json(body): Json<ContentShieldConfig>,
) -> Json<serde_json::Value> {
    let block_count  = body.rules.iter().filter(|r| r.enabled && r.action == "block").count();
    let redact_count = body.rules.iter().filter(|r| r.enabled && r.action == "redact").count();
    let flag_count   = body.rules.iter().filter(|r| r.enabled && r.action == "flag").count();
    let rule_count   = body.rules.len();

    {
        let mut cfg = state.content_shield_config.write().await;
        *cfg = body;
    }

    if let Some(pool) = &state.db {
        if let Ok(json) = serde_json::to_string(&*state.content_shield_config.read().await) {
            let _ = storage_queries::config_save(pool, "content-shield", &json).await;
        }
    }

    info!(
        rules = rule_count,
        blocking = block_count,
        redacting = redact_count,
        flagging = flag_count,
        "Content Shield config updated"
    );
    Json(json!({
        "ok": true,
        "rules": rule_count,
        "blocking": block_count,
        "redacting": redact_count,
        "flagging": flag_count,
    }))
}

// ─── Dashboard login ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

pub async fn dashboard_login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> impl IntoResponse {
    let cfg = state.config();
    if req.username == cfg.dashboard_auth.username && req.password == cfg.dashboard_auth.password {
        let token = Uuid::new_v4().to_string();
        (StatusCode::OK, Json(json!({ "token": token, "username": req.username }))).into_response()
    } else {
        (StatusCode::UNAUTHORIZED, Json(json!({ "error": "Invalid credentials" }))).into_response()
    }
}

// ─── API Keys CRUD ────────────────────────────────────────────────────────────

pub async fn api_keys_list(State(state): State<AppState>) -> Json<serde_json::Value> {
    let keys = state.api_keys.read().await;
    Json(json!({ "keys": *keys }))
}

pub async fn api_keys_create(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    if let Some(pool) = &state.db {
        let _ = storage_queries::api_key_upsert(pool, &body).await;
    }
    let mut keys = state.api_keys.write().await;
    // Remove if already exists (by id), then push
    if let Some(id) = body["id"].as_str() {
        keys.retain(|k| k["id"].as_str() != Some(id));
    }
    keys.insert(0, body.clone());
    Json(json!({ "ok": true, "key": body }))
}

pub async fn api_keys_update(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Json<serde_json::Value> {
    if let Some(pool) = &state.db {
        let _ = storage_queries::api_key_upsert(pool, &body).await;
    }
    let mut keys = state.api_keys.write().await;
    if let Some(pos) = keys.iter().position(|k| k["id"].as_str() == Some(&id)) {
        keys[pos] = body;
    }
    Json(json!({ "ok": true }))
}

pub async fn api_keys_delete(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    if let Some(pool) = &state.db {
        let _ = storage_queries::api_key_delete(pool, &id).await;
    }
    let mut keys = state.api_keys.write().await;
    keys.retain(|k| k["id"].as_str() != Some(&id));
    Json(json!({ "ok": true }))
}

// ─── Model pricing config API ─────────────────────────────────────────────────

pub async fn models_config_get(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.model_pricing.read().await;
    Json(json!({ "models": cfg.models }))
}

pub async fn models_config_put(
    State(state): State<AppState>,
    Json(body): Json<ModelPricingConfig>,
) -> Json<serde_json::Value> {
    let count = body.models.len();
    {
        let mut cfg = state.model_pricing.write().await;
        *cfg = body;
    }
    if let Some(pool) = &state.db {
        if let Ok(json) = serde_json::to_string(&*state.model_pricing.read().await) {
            let _ = storage_queries::config_save(pool, "models", &json).await;
        }
    }
    info!(count, "Model pricing config updated");
    Json(json!({ "ok": true, "models": count }))
}

// ─── Configured providers API ─────────────────────────────────────────────────

pub async fn providers_config_get(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.config.borrow().clone();
    let providers: Vec<serde_json::Value> = cfg
        .providers
        .iter()
        .map(|p| {
            let is_mock = p.api_key_env.as_deref() == Some("MOCK_KEY")
                || p.name.to_lowercase().starts_with("mock")
                || p.base_url.as_deref().map(|u| u.contains(":9090")).unwrap_or(false);
            json!({
                "name": p.name,
                "kind": p.kind,
                "base_url": p.base_url,
                "models": p.models,
                "is_mock": is_mock,
            })
        })
        .collect();
    Json(json!({ "providers": providers }))
}

fn range(from: Option<i64>, to: Option<i64>) -> (i64, i64) {
    let (df, dt) = default_range();
    (from.unwrap_or(df), to.unwrap_or(dt))
}
