use once_cell::sync::Lazy;
use prometheus::{
    register_counter_vec, register_histogram_vec, CounterVec, HistogramVec,
};

pub static REQUEST_TOTAL: Lazy<CounterVec> = Lazy::new(|| {
    register_counter_vec!(
        "gateway_requests_total",
        "Total number of requests",
        &["model", "provider", "status"]
    )
    .unwrap()
});

pub static REQUEST_DURATION: Lazy<HistogramVec> = Lazy::new(|| {
    register_histogram_vec!(
        "gateway_request_duration_seconds",
        "Request duration in seconds",
        &["model", "provider"],
        vec![0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0]
    )
    .unwrap()
});

pub static CACHE_HITS: Lazy<CounterVec> = Lazy::new(|| {
    register_counter_vec!(
        "gateway_cache_hits_total",
        "Cache hit count by type",
        &["cache_type"]
    )
    .unwrap()
});

pub static TOKENS_TOTAL: Lazy<CounterVec> = Lazy::new(|| {
    register_counter_vec!(
        "gateway_tokens_total",
        "Total tokens processed",
        &["model", "provider", "direction"]
    )
    .unwrap()
});

pub struct Metrics;

impl Metrics {
    pub fn record_request(model: &str, provider: &str, status: &str, duration_secs: f64) {
        REQUEST_TOTAL
            .with_label_values(&[model, provider, status])
            .inc();
        REQUEST_DURATION
            .with_label_values(&[model, provider])
            .observe(duration_secs);
    }

    pub fn record_cache_hit(cache_type: &str) {
        CACHE_HITS.with_label_values(&[cache_type]).inc();
    }

    pub fn record_tokens(model: &str, provider: &str, prompt: u32, completion: u32) {
        TOKENS_TOTAL
            .with_label_values(&[model, provider, "prompt"])
            .inc_by(prompt as f64);
        TOKENS_TOTAL
            .with_label_values(&[model, provider, "completion"])
            .inc_by(completion as f64);
    }

    pub fn render() -> anyhow::Result<String> {
        use prometheus::Encoder;
        let encoder = prometheus::TextEncoder::new();
        let metric_families = prometheus::gather();
        let mut buffer = Vec::new();
        encoder.encode(&metric_families, &mut buffer)?;
        Ok(String::from_utf8(buffer)?)
    }
}
