//! Performance evaluation endpoints.
//!
//! Spawns the `gateway-eval` binary as a child process and captures its
//! JSON report. Surfaced in the dashboard's Settings → Performance panel.
//!
//! We shell out (rather than depending on `gateway-eval` as a library) to
//! avoid a dependency cycle: `gateway-eval -> gateway-test-utils ->
//! gateway-core`.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::RwLock;
use tracing::{error, info, warn};

use crate::state::AppState;

const SUPPORTED_SWEEPS: &[&str] = &["default", "marketing"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus { Running, Completed, Failed }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerfRun {
    pub id: String,
    pub sweep: String,
    pub mock_latency_ms: u64,
    pub status: RunStatus,
    pub started_at_unix_ms: i64,
    pub finished_at_unix_ms: Option<i64>,
    pub error: Option<String>,
    pub report: Option<Value>,
}

#[derive(Debug, Clone, Default)]
pub struct PerfStore {
    runs: Arc<RwLock<std::collections::HashMap<String, PerfRun>>>,
    order: Arc<RwLock<Vec<String>>>,
}

impl PerfStore {
    pub async fn insert(&self, run: PerfRun) {
        let id = run.id.clone();
        self.runs.write().await.insert(id.clone(), run);
        self.order.write().await.push(id);
    }

    pub async fn update<F: FnOnce(&mut PerfRun)>(&self, id: &str, f: F) -> bool {
        if let Some(r) = self.runs.write().await.get_mut(id) { f(r); true } else { false }
    }

    pub async fn get(&self, id: &str) -> Option<PerfRun> {
        self.runs.read().await.get(id).cloned()
    }

    pub async fn list(&self) -> Vec<PerfRun> {
        let runs = self.runs.read().await;
        let order = self.order.read().await;
        order.iter().rev()
            .filter_map(|id| runs.get(id).cloned())
            .collect()
    }
}

#[derive(Debug, Deserialize)]
pub struct RunRequest {
    /// "default" (~10s, 12 scenarios) or "marketing" (~3-5min, deeper).
    #[serde(default = "default_sweep")]
    pub sweep: String,
    /// Simulated mock upstream latency in ms. 0 = gateway-overhead-only.
    #[serde(default)]
    pub mock_latency_ms: u64,
}

fn default_sweep() -> String { "default".into() }

/// Locate the `gateway-eval` binary. Honoured in order:
///   1. $MODO_EVAL_BIN
///   2. Sibling of the current executable named `gateway-eval-linux` (prod layout) or `gateway-eval`.
///   3. `target/release/gateway-eval` relative to cwd (dev fallback).
///   4. PATH lookup.
fn locate_eval_binary() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("MODO_EVAL_BIN") {
        let pb = PathBuf::from(p);
        if pb.is_file() { return Some(pb); }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for name in ["gateway-eval-linux", "gateway-eval", "gateway-eval.exe"] {
                let cand = dir.join(name);
                if cand.is_file() { return Some(cand); }
            }
        }
    }
    for cand in [
        "target/release/gateway-eval",
        "target/debug/gateway-eval",
    ] {
        let pb = PathBuf::from(cand);
        if pb.is_file() { return Some(pb); }
    }
    // PATH fallback.
    if let Ok(path) = std::env::var("PATH") {
        for p in path.split(':') {
            let cand = PathBuf::from(p).join("gateway-eval");
            if cand.is_file() { return Some(cand); }
        }
    }
    None
}

fn unix_now_ms() -> i64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_run_id() -> String {
    format!("perf-{}", uuid::Uuid::new_v4().simple())
}

/// POST /perf/run — start a new evaluation, return the run id immediately.
pub async fn perf_run(
    State(state): State<AppState>,
    body: Option<Json<RunRequest>>,
) -> impl IntoResponse {
    let req = body.map(|b| b.0).unwrap_or_else(|| RunRequest {
        sweep: "default".into(), mock_latency_ms: 0,
    });

    if !SUPPORTED_SWEEPS.contains(&req.sweep.as_str()) {
        return (StatusCode::BAD_REQUEST, Json(json!({
            "error": format!("unknown sweep '{}'. Supported: {:?}", req.sweep, SUPPORTED_SWEEPS),
        }))).into_response();
    }

    let bin = match locate_eval_binary() {
        Some(b) => b,
        None => {
            return (StatusCode::SERVICE_UNAVAILABLE, Json(json!({
                "error": "gateway-eval binary not found. Build it with `cargo build --release --bin gateway-eval`, or set MODO_EVAL_BIN.",
            }))).into_response();
        }
    };

    let id = new_run_id();
    let run = PerfRun {
        id: id.clone(),
        sweep: req.sweep.clone(),
        mock_latency_ms: req.mock_latency_ms,
        status: RunStatus::Running,
        started_at_unix_ms: unix_now_ms(),
        finished_at_unix_ms: None,
        error: None,
        report: None,
    };
    state.perf_runs.insert(run).await;

    // Spawn the eval. Max 10 minutes — marketing sweep can be slow.
    let store = state.perf_runs.clone();
    let id_for_task = id.clone();
    tokio::spawn(async move {
        let mut cmd = tokio::process::Command::new(&bin);
        cmd.arg("--sweep").arg(&req.sweep)
            .arg("--mock-latency-ms").arg(req.mock_latency_ms.to_string())
            .arg("--json").arg("-")
            .arg("--md").arg("/dev/null")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        info!(run_id = %id_for_task, sweep = %req.sweep, "Spawning gateway-eval");

        let result = tokio::time::timeout(
            Duration::from_secs(600),
            async {
                let child = cmd.spawn()?;
                let output = child.wait_with_output().await?;
                anyhow::Ok(output)
            },
        ).await;

        match result {
            Ok(Ok(out)) if out.status.success() => {
                match serde_json::from_slice::<Value>(&out.stdout) {
                    Ok(report) => {
                        store.update(&id_for_task, |r| {
                            r.status = RunStatus::Completed;
                            r.finished_at_unix_ms = Some(unix_now_ms());
                            r.report = Some(report);
                        }).await;
                        info!(run_id = %id_for_task, "Eval completed");
                    }
                    Err(e) => {
                        store.update(&id_for_task, |r| {
                            r.status = RunStatus::Failed;
                            r.finished_at_unix_ms = Some(unix_now_ms());
                            r.error = Some(format!("JSON parse failed: {e}"));
                        }).await;
                    }
                }
            }
            Ok(Ok(out)) => {
                let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
                let msg = format!("gateway-eval exited with status {:?}: {stderr}", out.status);
                warn!(run_id = %id_for_task, "{msg}");
                store.update(&id_for_task, |r| {
                    r.status = RunStatus::Failed;
                    r.finished_at_unix_ms = Some(unix_now_ms());
                    r.error = Some(msg);
                }).await;
            }
            Ok(Err(e)) => {
                error!(run_id = %id_for_task, error = ?e, "Failed to spawn gateway-eval");
                store.update(&id_for_task, |r| {
                    r.status = RunStatus::Failed;
                    r.finished_at_unix_ms = Some(unix_now_ms());
                    r.error = Some(format!("Spawn error: {e}"));
                }).await;
            }
            Err(_) => {
                store.update(&id_for_task, |r| {
                    r.status = RunStatus::Failed;
                    r.finished_at_unix_ms = Some(unix_now_ms());
                    r.error = Some("Timed out (>10 minutes)".into());
                }).await;
            }
        }
    });

    (StatusCode::ACCEPTED, Json(json!({ "id": id, "status": "running" }))).into_response()
}

/// GET /perf/runs — list all runs (most recent first).
pub async fn perf_runs_list(State(state): State<AppState>) -> Json<Value> {
    let runs = state.perf_runs.list().await;
    Json(json!({ "runs": runs }))
}

/// GET /perf/runs/:id — fetch a single run.
pub async fn perf_run_get(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match state.perf_runs.get(&id).await {
        Some(r) => Json(json!(r)).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({
            "error": format!("run '{id}' not found"),
        }))).into_response(),
    }
}
