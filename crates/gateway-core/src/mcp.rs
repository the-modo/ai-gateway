//! MCP gateway — exposes registered upstream MCP servers through a single
//! unified `/mcp` endpoint (Streamable HTTP, JSON-RPC 2.0).
//!
//! Tools from upstream servers are namespaced as `{server_id}__{tool_name}`
//! in `tools/list`, and `tools/call` routes to the owning server. Upstream
//! sessions are established per request (initialize → initialized → call),
//! which keeps the gateway stateless.

use std::sync::OnceLock;
use std::time::Duration;

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tracing::{info, warn};

use gateway_storage::queries as storage_queries;

use std::collections::HashMap;

use crate::handlers::{builtin_shield_patterns, check_guardrails, make_log, shield_regex, GuardrailOutcome};
use crate::state::{AppState, ContentShieldRule};

pub const MCP_PROTOCOL_VERSION: &str = "2025-03-26";

/* ─── Config types ───────────────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub id: String,
    pub name: String,
    pub url: String,
    /// Raw `Authorization` header value forwarded upstream. Empty = none.
    #[serde(default)]
    pub auth_header: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct McpConfig {
    pub servers: Vec<McpServerConfig>,
}

/* ─── Upstream JSON-RPC client ───────────────────────────────────────────── */

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .expect("reqwest client")
    })
}

/// Parse a Streamable-HTTP response body: plain JSON, or SSE frames where
/// each `data:` line is a JSON-RPC message — return the one carrying a result
/// or error.
fn parse_rpc_body(content_type: &str, body: &str) -> Option<Value> {
    if content_type.contains("text/event-stream") {
        for line in body.lines() {
            let Some(data) = line.strip_prefix("data:") else { continue };
            if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                if v.get("result").is_some() || v.get("error").is_some() {
                    return Some(v);
                }
            }
        }
        None
    } else {
        serde_json::from_str(body).ok()
    }
}

/// Marks gateway-originated MCP calls so a misconfigured upstream pointing
/// back at this gateway cannot cause infinite recursion.
const HOP_HEADER: &str = "x-nh3-mcp-hop";

async fn upstream_post(
    client: &reqwest::Client,
    server: &McpServerConfig,
    session: Option<&str>,
    payload: &Value,
) -> anyhow::Result<(Option<String>, Option<Value>)> {
    let mut req = client
        .post(&server.url)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .header("MCP-Protocol-Version", MCP_PROTOCOL_VERSION)
        .header(HOP_HEADER, "1");
    if !server.auth_header.is_empty() {
        req = req.header("Authorization", &server.auth_header);
    }
    if let Some(sid) = session {
        req = req.header("Mcp-Session-Id", sid);
    }

    let resp = req.json(payload).send().await?;
    let new_session = resp
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();

    if !status.is_success() && status != reqwest::StatusCode::ACCEPTED {
        anyhow::bail!("upstream {} returned {status}: {}", server.name, body.chars().take(200).collect::<String>());
    }
    Ok((new_session, parse_rpc_body(&content_type, &body)))
}

/// Full stateless round-trip: initialize → initialized → `method`.
async fn upstream_rpc(server: &McpServerConfig, method: &str, params: Value) -> anyhow::Result<Value> {
    let client = http_client().clone();
    let client = &client;

    let init = json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "modo-ai-gateway", "version": env!("CARGO_PKG_VERSION") },
        },
    });
    let (session, init_resp) = upstream_post(&client, server, None, &init).await?;
    if init_resp.as_ref().and_then(|v| v.get("result")).is_none() {
        anyhow::bail!("upstream {} failed MCP initialize", server.name);
    }

    let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    let _ = upstream_post(&client, server, session.as_deref(), &initialized).await;

    let call = json!({ "jsonrpc": "2.0", "id": 2, "method": method, "params": params });
    let (_, resp) = upstream_post(&client, server, session.as_deref(), &call).await?;
    let resp = resp.ok_or_else(|| anyhow::anyhow!("upstream {} returned no JSON-RPC response", server.name))?;

    if let Some(err) = resp.get("error") {
        anyhow::bail!("upstream {} error: {err}", server.name);
    }
    resp.get("result")
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("upstream {} response missing result", server.name))
}

/// `tools/list` for one server, with names namespaced `{server_id}__{tool}`.
async fn list_server_tools(server: &McpServerConfig) -> anyhow::Result<Vec<Value>> {
    let result = upstream_rpc(server, "tools/list", json!({})).await?;
    let tools = result
        .get("tools")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    Ok(tools
        .into_iter()
        .map(|mut t| {
            if let Some(name) = t.get("name").and_then(|n| n.as_str()) {
                let ns = format!("{}__{}", server.id, name);
                t["name"] = json!(ns);
            }
            t
        })
        .collect())
}

/// Walk a JSON value, redacting string contents per Content Shield rules.
/// Returns `Err(label)` when a `block`-action rule matches.
fn shield_json(
    value: &mut Value,
    rules: &[ContentShieldRule],
    builtin: &HashMap<&str, &str>,
) -> Result<(), String> {
    match value {
        Value::String(s) => {
            for rule in rules {
                let Some(re) = shield_regex(rule, builtin) else { continue };
                if re.is_match(s) {
                    match rule.action.as_str() {
                        "block" => return Err(rule.label.clone()),
                        "redact" => {
                            let replacement = if rule.replacement.is_empty() { "[REDACTED]" } else { rule.replacement.as_str() };
                            *s = re.replace_all(s, replacement).to_string();
                        }
                        _ => warn!(rule = %rule.label, "Content Shield flagged MCP payload"),
                    }
                }
            }
            Ok(())
        }
        Value::Array(items) => {
            for v in items { shield_json(v, rules, builtin)?; }
            Ok(())
        }
        Value::Object(map) => {
            for (_, v) in map.iter_mut() { shield_json(v, rules, builtin)?; }
            Ok(())
        }
        _ => Ok(()),
    }
}

/* ─── /mcp — the unified gateway endpoint ────────────────────────────────── */

fn rpc_result(id: Value, result: Value) -> Json<Value> {
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn rpc_error(id: Value, code: i64, message: String) -> Json<Value> {
    Json(json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }))
}

pub async fn mcp_endpoint(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<Value>,
) -> Response {
    let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    let params = body.get("params").cloned().unwrap_or(json!({}));

    // Notifications get an empty 202.
    if body.get("id").is_none() {
        return StatusCode::ACCEPTED.into_response();
    }

    // Loop protection: a gateway-originated call hitting this gateway again
    // (e.g. an upstream entry pointing at ourselves) must not fan out.
    let looped = headers.contains_key(HOP_HEADER);
    if looped && matches!(method, "tools/list") {
        return rpc_result(id, json!({ "tools": [] })).into_response();
    }
    if looped && matches!(method, "tools/call") {
        return rpc_error(id, -32603, "MCP loop detected — upstream server points back at this gateway".into()).into_response();
    }

    match method {
        "initialize" => rpc_result(id, json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "Modo AI Gateway", "version": env!("CARGO_PKG_VERSION") },
        }))
        .into_response(),

        "ping" => rpc_result(id, json!({})).into_response(),

        "tools/list" => {
            let servers: Vec<McpServerConfig> = state
                .mcp_config
                .read()
                .await
                .servers
                .iter()
                .filter(|s| s.enabled)
                .cloned()
                .collect();

            let results = futures::future::join_all(
                servers.iter().map(list_server_tools),
            )
            .await;

            let mut tools = Vec::new();
            for (server, result) in servers.iter().zip(results) {
                match result {
                    Ok(mut t) => tools.append(&mut t),
                    Err(e) => warn!(server = %server.name, "MCP tools/list failed: {e}"),
                }
            }
            rpc_result(id, json!({ "tools": tools })).into_response()
        }

        "tools/call" => {
            let call_start = std::time::Instant::now();
            let mut flag_label: Option<String> = None;
            let log_call = |state: &AppState, tool: &str, status: i32, latency: i64,
                            err: Option<String>, flags: Option<String>,
                            req_body: Option<String>, resp_body: Option<String>| {
                if let Some(ref logger) = state.logger {
                    logger.log(make_log(
                        tool, "mcp", status, latency, 0, 0, false, false,
                        err, flags, req_body, resp_body, &[],
                    ));
                }
            };
            let Some(full_name) = params.get("name").and_then(|n| n.as_str()) else {
                return rpc_error(id, -32602, "missing tool name".into()).into_response();
            };
            let full_name_owned = full_name.to_string();
            let args_body: Option<String> = if state.log_bodies() {
                serde_json::to_string(params.get("arguments").unwrap_or(&json!({}))).ok()
            } else { None };
            let Some((server_id, tool_name)) = full_name.split_once("__") else {
                return rpc_error(id, -32602, format!("unknown tool '{full_name}' — expected '{{server}}__{{tool}}'")).into_response();
            };
            let server = state
                .mcp_config
                .read()
                .await
                .servers
                .iter()
                .find(|s| s.enabled && s.id == server_id)
                .cloned();
            let Some(server) = server else {
                return rpc_error(id, -32602, format!("no enabled MCP server '{server_id}'")).into_response();
            };

            let mut upstream_params = params.clone();
            upstream_params["name"] = json!(tool_name);

            // Guardrails on tool arguments (same rules as chat traffic).
            let args_text = serde_json::to_string(
                upstream_params.get("arguments").unwrap_or(&json!({})),
            ).unwrap_or_default();
            {
                let gcfg = state.guardrail_config.read().await;
                match check_guardrails(&args_text, &gcfg, "request") {
                    GuardrailOutcome::Blocked(label) => {
                        warn!(rule = %label, tool = tool_name, "Guardrail blocked MCP tool call");
                        log_call(&state, &full_name_owned, 400, call_start.elapsed().as_millis() as i64,
                            Some(format!("Blocked by guardrail: {label}")), None, args_body.clone(), None);
                        return rpc_error(id, -32600, format!("Blocked by guardrail: {label}")).into_response();
                    }
                    GuardrailOutcome::Flagged(label) => {
                        warn!(rule = %label, tool = tool_name, "Guardrail flagged MCP tool call");
                        flag_label = Some(format!("guardrail:{label}"));
                    }
                    GuardrailOutcome::Pass => {}
                }
            }

            // Content Shield on tool arguments — redact or block before forwarding.
            let builtin = builtin_shield_patterns();
            let req_rules: Vec<ContentShieldRule> = state
                .content_shield_config.read().await.rules.iter()
                .filter(|r| r.enabled && (r.scope == "both" || r.scope == "request"))
                .cloned().collect();
            if let Some(args) = upstream_params.get_mut("arguments") {
                if let Err(label) = shield_json(args, &req_rules, &builtin) {
                    warn!(rule = %label, tool = tool_name, "Content Shield blocked MCP tool call");
                    log_call(&state, &full_name_owned, 400, call_start.elapsed().as_millis() as i64,
                        Some(format!("Blocked by Content Shield: {label}")), None, args_body.clone(), None);
                    return rpc_error(id, -32600, format!("Blocked by Content Shield: {label}")).into_response();
                }
            }

            info!(server = %server.name, tool = tool_name, "MCP tool call");
            match upstream_rpc(&server, "tools/call", upstream_params).await {
                Ok(mut result) => {
                    // Response-scope guardrails on the tool result.
                    let result_text = serde_json::to_string(&result).unwrap_or_default();
                    {
                        let gcfg = state.guardrail_config.read().await;
                        match check_guardrails(&result_text, &gcfg, "response") {
                            GuardrailOutcome::Blocked(label) => {
                                warn!(rule = %label, tool = tool_name, "Guardrail blocked MCP tool result");
                                log_call(&state, &full_name_owned, 400, call_start.elapsed().as_millis() as i64,
                                    Some(format!("Response blocked by guardrail: {label}")), None, args_body.clone(), None);
                                return rpc_error(id, -32603, format!("Response blocked by guardrail: {label}")).into_response();
                            }
                            GuardrailOutcome::Flagged(label) => {
                                warn!(rule = %label, tool = tool_name, "Guardrail flagged MCP tool result");
                                flag_label = Some(format!("guardrail:{label}"));
                            }
                            GuardrailOutcome::Pass => {}
                        }
                    }
                    // Response-scope Content Shield — redact tool results.
                    let resp_rules: Vec<ContentShieldRule> = state
                        .content_shield_config.read().await.rules.iter()
                        .filter(|r| r.enabled && (r.scope == "both" || r.scope == "response"))
                        .cloned().collect();
                    if let Err(label) = shield_json(&mut result, &resp_rules, &builtin) {
                        warn!(rule = %label, tool = tool_name, "Content Shield blocked MCP tool result");
                        log_call(&state, &full_name_owned, 400, call_start.elapsed().as_millis() as i64,
                            Some(format!("Response blocked by Content Shield: {label}")), None, args_body.clone(), None);
                        return rpc_error(id, -32603, format!("Response blocked by Content Shield: {label}")).into_response();
                    }
                    let resp_body: Option<String> = if state.log_bodies() {
                        serde_json::to_string(&result).ok().map(|s| {
                            if s.len() > 8192 { format!("{}…", &s[..8192]) } else { s }
                        })
                    } else { None };
                    log_call(&state, &full_name_owned, 200, call_start.elapsed().as_millis() as i64,
                        None, flag_label.clone(), args_body.clone(), resp_body);
                    rpc_result(id, result).into_response()
                }
                Err(e) => {
                    log_call(&state, &full_name_owned, 502, call_start.elapsed().as_millis() as i64,
                        Some(e.to_string()), None, args_body.clone(), None);
                    rpc_error(id, -32603, e.to_string()).into_response()
                }
            }
        }

        _ => rpc_error(id, -32601, format!("method '{method}' not supported")).into_response(),
    }
}

/* ─── Config + discovery API (dashboard) ─────────────────────────────────── */

pub async fn mcp_config_get(State(state): State<AppState>) -> Json<Value> {
    let cfg = state.mcp_config.read().await;
    Json(json!({ "servers": cfg.servers }))
}

pub async fn mcp_config_put(
    State(state): State<AppState>,
    Json(body): Json<McpConfig>,
) -> Json<Value> {
    let count = body.servers.len();
    {
        let mut cfg = state.mcp_config.write().await;
        *cfg = body;
    }
    if let Some(pool) = &state.db {
        if let Ok(json) = serde_json::to_string(&*state.mcp_config.read().await) {
            let _ = storage_queries::config_save(pool, "mcp", &json).await;
        }
    }
    info!(servers = count, "MCP config updated");
    Json(json!({ "ok": true, "servers": count }))
}

/// Per-server connectivity + discovered tools, for the dashboard.
pub async fn mcp_tools_get(State(state): State<AppState>) -> Json<Value> {
    let servers: Vec<McpServerConfig> =
        state.mcp_config.read().await.servers.clone();

    let results = futures::future::join_all(servers.iter().map(|s| async move {
        if !s.enabled {
            return json!({ "id": s.id, "name": s.name, "status": "disabled", "tools": [] });
        }
        match list_server_tools(s).await {
            Ok(tools) => json!({ "id": s.id, "name": s.name, "status": "online", "tools": tools }),
            Err(e) => json!({ "id": s.id, "name": s.name, "status": "error", "error": e.to_string(), "tools": [] }),
        }
    }))
    .await;

    Json(json!({ "servers": results }))
}

/* ─── Built-in test MCP server (/mcp-test) ───────────────────────────────── */
//
// A tiny demo server so users can try the MCP gateway without any external
// dependency: register `{gateway}/mcp-test` as an upstream and its tools
// appear through the unified /mcp endpoint.

fn tool_text(text: String) -> Json<Value> {
    Json(json!({
        "jsonrpc": "2.0", "id": 2,
        "result": { "content": [{ "type": "text", "text": text }], "isError": false },
    }))
}

pub async fn mcp_test_endpoint(Json(body): Json<Value>) -> Response {
    let method = body.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let id = body.get("id").cloned().unwrap_or(Value::Null);

    if body.get("id").is_none() {
        return StatusCode::ACCEPTED.into_response();
    }

    match method {
        "initialize" => rpc_result(id, json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "Modo Test MCP Server", "version": env!("CARGO_PKG_VERSION") },
        }))
        .into_response(),

        "ping" => rpc_result(id, json!({})).into_response(),

        "tools/list" => rpc_result(id, json!({
            "tools": [
                {
                    "name": "echo",
                    "description": "Echo the provided text back — proves the full client → gateway → server round trip.",
                    "inputSchema": { "type": "object", "properties": { "text": { "type": "string", "description": "Text to echo" } }, "required": ["text"] },
                },
                {
                    "name": "current_time",
                    "description": "Current UTC time from the gateway host (RFC 3339).",
                    "inputSchema": { "type": "object", "properties": {} },
                },
                {
                    "name": "add",
                    "description": "Add two numbers and return the sum.",
                    "inputSchema": { "type": "object", "properties": { "a": { "type": "number" }, "b": { "type": "number" } }, "required": ["a", "b"] },
                },
            ],
        }))
        .into_response(),

        "tools/call" => {
            let params = body.get("params").cloned().unwrap_or(json!({}));
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(json!({}));
            match name {
                "echo" => {
                    let text = args.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
                    let mut r = tool_text(format!("echo: {text}")).into_response();
                    *r.status_mut() = StatusCode::OK;
                    r
                }
                "current_time" => tool_text(chrono::Utc::now().to_rfc3339()).into_response(),
                "add" => {
                    let a = args.get("a").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let b = args.get("b").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    tool_text(format!("{}", a + b)).into_response()
                }
                _ => rpc_error(id, -32602, format!("unknown tool '{name}'")).into_response(),
            }
        }

        _ => rpc_error(id, -32601, format!("method '{method}' not supported")).into_response(),
    }
}
