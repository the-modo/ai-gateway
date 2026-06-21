//! Performance evaluation harness for the Modo AI Gateway.
//!
//! This crate spins up an in-process gateway (using the same test harness
//! used by the integration tests), points it at a synthetic mock provider,
//! and drives load through it. It then reports throughput, latency
//! percentiles, and pass/fail behaviour for guardrail rules of varying
//! complexity.
//!
//! It is intentionally separate from `cargo test` so that:
//!   1. CI tests stay fast (this crate's runs take seconds-to-minutes).
//!   2. Performance numbers don't pollute test output.
//!   3. The same code is invoked from CLI (`gateway-eval`) and from the
//!      dashboard's *Settings → Performance* panel.

use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

use gateway_test_utils::{HarnessBuilder, MockConfig, TestHarness};

/// Complexity of a single guardrail rule.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RegexEffort {
    /// No rules at all.
    None,
    /// Plain case-insensitive substring keyword. Cheapest.
    Keyword,
    /// A single anchored alternation regex — moderate.
    SimpleRegex,
    /// Multiple alternation groups + lookahead-free backtracking. Heavy.
    HeavyRegex,
}

impl RegexEffort {
    pub fn as_str(&self) -> &'static str {
        match self {
            RegexEffort::None => "none",
            RegexEffort::Keyword => "keyword",
            RegexEffort::SimpleRegex => "simple_regex",
            RegexEffort::HeavyRegex => "heavy_regex",
        }
    }
}

/// One scenario in a run. Each scenario produces one row in the report.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scenario {
    pub label: String,
    pub effort: RegexEffort,
    pub rule_count: usize,
    pub concurrency: usize,
    pub total_requests: usize,
}

/// Configuration for a complete evaluation run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalConfig {
    /// Mock provider artificial latency (ms). Sub-millisecond by default so
    /// the gateway's own overhead dominates.
    pub mock_latency_ms: u64,
    /// Optional override of the prompt text shipped to the gateway.
    pub prompt: String,
    /// The full list of scenarios to run.
    pub scenarios: Vec<Scenario>,
}

impl Default for EvalConfig {
    fn default() -> Self {
        Self {
            mock_latency_ms: 0,
            prompt: "evaluate this prompt for the gateway".to_string(),
            scenarios: Self::default_sweep(),
        }
    }
}

impl EvalConfig {
    /// A small, fast-to-run sweep suitable for CI and for the dashboard's
    /// "run once" button. Heavier sweeps are CLI-only.
    pub fn default_sweep() -> Vec<Scenario> {
        let mut out = vec![];
        let req = 400;
        for &concurrency in &[1usize, 8, 32] {
            for &(effort, rules) in &[
                (RegexEffort::None, 0usize),
                (RegexEffort::Keyword, 5),
                (RegexEffort::SimpleRegex, 5),
                (RegexEffort::HeavyRegex, 5),
            ] {
                out.push(Scenario {
                    label: format!(
                        "c={concurrency:>2} {} x{rules}",
                        effort.as_str(),
                    ),
                    effort,
                    rule_count: rules,
                    concurrency,
                    total_requests: req,
                });
            }
        }
        out
    }

    /// A deeper sweep that takes longer but produces a marketing-grade table.
    pub fn marketing_sweep() -> Vec<Scenario> {
        let mut out = vec![];
        let req = 1_000;
        for &concurrency in &[1usize, 4, 16, 64, 128] {
            for &(effort, rules) in &[
                (RegexEffort::None,        0usize),
                (RegexEffort::Keyword,     5),
                (RegexEffort::Keyword,     20),
                (RegexEffort::SimpleRegex, 5),
                (RegexEffort::SimpleRegex, 20),
                (RegexEffort::HeavyRegex,  5),
                (RegexEffort::HeavyRegex,  20),
            ] {
                out.push(Scenario {
                    label: format!(
                        "c={concurrency:>3} {} x{rules:>2}",
                        effort.as_str(),
                    ),
                    effort,
                    rule_count: rules,
                    concurrency,
                    total_requests: req,
                });
            }
        }
        out
    }
}

/// Per-scenario result row.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScenarioResult {
    pub label: String,
    pub effort: RegexEffort,
    pub rule_count: usize,
    pub concurrency: usize,
    pub total_requests: usize,
    pub successful_requests: usize,
    pub failed_requests: usize,
    pub wall_clock_ms: u64,
    pub throughput_tps: f64,
    pub p50_ms: f64,
    pub p95_ms: f64,
    pub p99_ms: f64,
    pub max_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalReport {
    pub started_at_unix_ms: i64,
    pub finished_at_unix_ms: i64,
    pub config: EvalConfig,
    pub results: Vec<ScenarioResult>,
}

impl EvalReport {
    /// Render the report as a markdown table.
    pub fn to_markdown(&self) -> String {
        let mut s = String::new();
        s.push_str("# Modo AI Gateway — performance evaluation\n\n");
        s.push_str(&format!(
            "Run: started {} ms, finished {} ms (wall-clock {:.1}s total)\n\n",
            self.started_at_unix_ms,
            self.finished_at_unix_ms,
            (self.finished_at_unix_ms - self.started_at_unix_ms) as f64 / 1000.0,
        ));
        s.push_str("| scenario | requests | conc | TPS | p50 (ms) | p95 (ms) | p99 (ms) | errors |\n");
        s.push_str("|---|---:|---:|---:|---:|---:|---:|---:|\n");
        for r in &self.results {
            s.push_str(&format!(
                "| {} | {} | {} | {:.1} | {:.2} | {:.2} | {:.2} | {} |\n",
                r.label,
                r.total_requests,
                r.concurrency,
                r.throughput_tps,
                r.p50_ms,
                r.p95_ms,
                r.p99_ms,
                r.failed_requests,
            ));
        }
        s.push_str("\n*p50/p95/p99 are gateway round-trip times measured client-side, with a zero-latency mock upstream so the numbers reflect gateway-induced overhead only.*\n");
        s
    }
}

/// Build the guardrail rule list for a given (effort, count) pair.
fn build_rules(effort: RegexEffort, count: usize) -> Vec<serde_json::Value> {
    let mut rules = Vec::with_capacity(count);
    for i in 0..count {
        let (keywords, patterns): (Vec<String>, Vec<String>) = match effort {
            RegexEffort::None => (vec![], vec![]),
            RegexEffort::Keyword => (vec![format!("__nomatch_kw_{i}__")], vec![]),
            RegexEffort::SimpleRegex => (
                vec![],
                vec![format!(r"(?i)\bnomatch{i}|secret{i}|topsecret{i}\b")],
            ),
            RegexEffort::HeavyRegex => (
                vec![],
                vec![format!(
                    // Backtracking-prone alternation across many classes.
                    r"(?i)(?:nomatch|kepler|orbital|trajectory|propulsion){i}\d+\W+(?:alpha|beta|gamma|delta){i}\d+\W+\w{{4,12}}",
                    i = i
                )],
            ),
        };
        rules.push(serde_json::json!({
            "id":       format!("rule-{i}"),
            "label":    format!("rule-{i}"),
            "keywords": keywords,
            "patterns": patterns,
            "action":   "flag",
            "scope":    "request",
            "enabled":  true,
        }));
    }
    rules
}

async fn install_rules(h: &TestHarness, rules: Vec<serde_json::Value>) -> anyhow::Result<()> {
    let body = serde_json::json!({ "rules": rules });
    let res = h.client.put(format!("{}/config/guardrails", h.base_url))
        .json(&body)
        .send()
        .await?;
    anyhow::ensure!(res.status() == 200, "guardrail PUT failed: {}", res.status());
    Ok(())
}

fn percentile(samples: &mut [f64], p: f64) -> f64 {
    if samples.is_empty() { return 0.0; }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((p / 100.0) * (samples.len() as f64 - 1.0)).round() as usize;
    samples[idx.min(samples.len() - 1)]
}

/// Run a single scenario. Spins up a fresh in-process gateway so rules
/// don't bleed between scenarios.
pub async fn run_scenario(scn: &Scenario, prompt: &str, mock_latency_ms: u64) -> anyhow::Result<ScenarioResult> {
    let h = HarnessBuilder::new()
        .with_openai_mock("p", MockConfig {
            latency_ms: mock_latency_ms,
            ..Default::default()
        })
        .build()
        .await?;

    let rules = build_rules(scn.effort, scn.rule_count);
    install_rules(&h, rules).await?;

    // Warmup — single call to wake everything up.
    let _ = h.chat("gpt-4o", prompt).await;

    let base_url = h.base_url.clone();
    let client = h.client.clone();
    let permits = Arc::new(Semaphore::new(scn.concurrency));
    let prompt = prompt.to_string();

    let mut handles = Vec::with_capacity(scn.total_requests);
    let wall_start = Instant::now();

    for _ in 0..scn.total_requests {
        let permit = permits.clone().acquire_owned().await.unwrap();
        let base = base_url.clone();
        let cl   = client.clone();
        let pr   = prompt.clone();
        handles.push(tokio::spawn(async move {
            let _p = permit;
            let t = Instant::now();
            let res = cl.post(format!("{base}/v1/chat/completions"))
                .json(&serde_json::json!({
                    "model": "gpt-4o",
                    "messages": [{ "role": "user", "content": pr }],
                }))
                .send()
                .await;
            let ms = t.elapsed().as_secs_f64() * 1_000.0;
            let ok = matches!(&res, Ok(r) if r.status().is_success());
            (ms, ok)
        }));
    }

    let mut latencies: Vec<f64> = Vec::with_capacity(scn.total_requests);
    let mut ok_count = 0usize;
    let mut err_count = 0usize;
    for h in handles {
        match h.await {
            Ok((ms, true))  => { latencies.push(ms); ok_count += 1; }
            Ok((ms, false)) => { latencies.push(ms); err_count += 1; }
            Err(_)          => { err_count += 1; }
        }
    }

    let wall_ms = wall_start.elapsed().as_millis() as u64;
    let max = latencies.iter().cloned().fold(0.0_f64, f64::max);
    let p50 = percentile(&mut latencies.clone(), 50.0);
    let p95 = percentile(&mut latencies.clone(), 95.0);
    let p99 = percentile(&mut latencies.clone(), 99.0);
    let tps = if wall_ms == 0 { 0.0 } else {
        (ok_count as f64) * 1_000.0 / wall_ms as f64
    };

    Ok(ScenarioResult {
        label: scn.label.clone(),
        effort: scn.effort,
        rule_count: scn.rule_count,
        concurrency: scn.concurrency,
        total_requests: scn.total_requests,
        successful_requests: ok_count,
        failed_requests: err_count,
        wall_clock_ms: wall_ms,
        throughput_tps: tps,
        p50_ms: p50,
        p95_ms: p95,
        p99_ms: p99,
        max_ms: max,
    })
}

/// Run every scenario in the config and assemble a report.
pub async fn run(config: EvalConfig) -> anyhow::Result<EvalReport> {
    let started = unix_now_ms();
    let mut results = Vec::with_capacity(config.scenarios.len());
    for scn in &config.scenarios {
        let r = run_scenario(scn, &config.prompt, config.mock_latency_ms).await?;
        results.push(r);
    }
    let finished = unix_now_ms();
    Ok(EvalReport {
        started_at_unix_ms: started,
        finished_at_unix_ms: finished,
        config,
        results,
    })
}

fn unix_now_ms() -> i64 {
    use std::time::SystemTime;
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
