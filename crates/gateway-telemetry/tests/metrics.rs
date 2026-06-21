// NOTE: prometheus metrics are GLOBAL singletons — once incremented in one
// test, the counter is visible to every other test. To stay deterministic we
// pick label values unique to each test so different tests don't collide.

use gateway_telemetry::Metrics;

fn extract_total(prom_text: &str, metric_name: &str, label_substring: &str) -> Option<f64> {
    for line in prom_text.lines() {
        if line.starts_with('#') { continue; }
        if !line.starts_with(metric_name) { continue; }
        if !line.contains(label_substring) { continue; }
        let val = line.rsplit_once(' ')?.1;
        return val.parse::<f64>().ok();
    }
    None
}

#[test]
fn record_request_increments_total_counter() {
    Metrics::record_request("metric-test-model", "metric-test-provider", "200", 0.1);
    Metrics::record_request("metric-test-model", "metric-test-provider", "200", 0.2);
    Metrics::record_request("metric-test-model", "metric-test-provider", "500", 1.5);

    let out = Metrics::render().unwrap();
    // labels are alphabetised in prometheus text output: model,provider,status
    let success = extract_total(&out, "gateway_requests_total", "model=\"metric-test-model\",provider=\"metric-test-provider\",status=\"200\"")
        .expect("counter present");
    assert!(success >= 2.0, "200 counter must reflect both successes: {success}");
    let error = extract_total(&out, "gateway_requests_total", "status=\"500\"")
        .expect("error counter present");
    assert!(error >= 1.0);
}

#[test]
fn record_cache_hit_increments() {
    Metrics::record_cache_hit("test-exact-A");
    Metrics::record_cache_hit("test-exact-A");
    Metrics::record_cache_hit("test-semantic-A");

    let out = Metrics::render().unwrap();
    let exact = extract_total(&out, "gateway_cache_hits_total", "cache_type=\"test-exact-A\"").unwrap_or(0.0);
    assert!(exact >= 2.0, "exact cache counter saw 2 hits: {exact}");
    let sem = extract_total(&out, "gateway_cache_hits_total", "cache_type=\"test-semantic-A\"").unwrap_or(0.0);
    assert!(sem >= 1.0);
}

#[test]
fn record_tokens_splits_prompt_and_completion() {
    Metrics::record_tokens("tok-test-model", "tok-test-provider", 100, 25);
    Metrics::record_tokens("tok-test-model", "tok-test-provider", 50,  10);

    let out = Metrics::render().unwrap();
    // prometheus text format orders labels alphabetically: direction, model, provider.
    let prompt = extract_total(&out, "gateway_tokens_total",
        "direction=\"prompt\",model=\"tok-test-model\",provider=\"tok-test-provider\"")
        .expect("prompt token counter");
    let completion = extract_total(&out, "gateway_tokens_total",
        "direction=\"completion\",model=\"tok-test-model\",provider=\"tok-test-provider\"")
        .expect("completion token counter");
    assert!(prompt >= 150.0, "prompt counter: {prompt}");
    assert!(completion >= 35.0, "completion counter: {completion}");
}

#[test]
fn duration_histogram_buckets_observed() {
    for d in &[0.05, 0.3, 1.2, 3.0] {
        Metrics::record_request("hist-test", "hist-test", "200", *d);
    }
    let out = Metrics::render().unwrap();

    // The largest finite bucket boundary is 30 — every sample (≤ 3.0s) must land in it.
    let bucket_30 = out
        .lines()
        .find(|l| l.contains("gateway_request_duration_seconds_bucket")
            && l.contains("model=\"hist-test\"")
            && l.contains("le=\"30\""))
        .and_then(|l| l.rsplit_once(' ').and_then(|(_, v)| v.parse::<f64>().ok()))
        .expect("le=30 bucket present");
    assert!(bucket_30 >= 4.0, "all 4 samples are ≤ 30s: {bucket_30}\nrender:\n{out}");

    let count_line = out
        .lines()
        .find(|l| l.starts_with("gateway_request_duration_seconds_count")
            && l.contains("model=\"hist-test\""))
        .expect("count line present");
    let count: f64 = count_line.rsplit_once(' ').unwrap().1.parse().unwrap();
    assert!(count >= 4.0, "count = {count}");
}

#[test]
fn render_returns_valid_prometheus_text() {
    // Force each Lazy to register before we render, since other tests run in parallel
    // and prometheus only emits HELP/TYPE for families that have been touched.
    Metrics::record_request("render-test", "render-test", "200", 0.1);
    Metrics::record_cache_hit("render-test");
    Metrics::record_tokens("render-test", "render-test", 1, 1);

    let out = Metrics::render().expect("render");
    assert!(out.contains("# HELP gateway_requests_total"), "missing requests HELP: {out}");
    assert!(out.contains("# TYPE gateway_requests_total counter"));
    assert!(out.contains("# HELP gateway_cache_hits_total"));
    assert!(out.contains("# HELP gateway_tokens_total"));
    assert!(out.contains("# HELP gateway_request_duration_seconds"));
}
