use std::collections::HashMap;
use std::sync::Arc;

use sqlx::{Any, Pool};
use tokio::sync::mpsc;
use tokio::time::{interval, Duration};

use crate::models::LogEntry;
use crate::queries;

const CHANNEL_CAP: usize = 8_192;
const FLUSH_INTERVAL_MS: u64 = 200;
const BATCH_MAX: usize = 100;

// ─── In-memory metric accumulator ─────────────────────────────────────────────

/// Grouping key: (minute-bucket timestamp ms, model, provider)
type MetricKey = (i64, String, String);

#[derive(Default)]
struct MetricAccum {
    request_count:     i64,
    error_count:       i64,
    total_latency_ms:  i64,
    prompt_tokens:     i64,
    completion_tokens: i64,
    cost_usd:          f64,
    cache_hits:        i64,
}

// ─── Public logger handle ─────────────────────────────────────────────────────

#[derive(Clone)]
pub struct RequestLogger {
    tx: mpsc::Sender<LogEntry>,
}

impl RequestLogger {
    pub fn new(pool: Arc<Pool<Any>>) -> Self {
        let (tx, rx) = mpsc::channel(CHANNEL_CAP);
        tokio::spawn(logger_task(rx, pool));
        Self { tx }
    }

    /// Fire-and-forget. Never blocks the request path.
    pub fn log(&self, entry: LogEntry) {
        let _ = self.tx.try_send(entry);
    }
}

// ─── Background task ──────────────────────────────────────────────────────────

async fn logger_task(mut rx: mpsc::Receiver<LogEntry>, pool: Arc<Pool<Any>>) {
    let mut batch: Vec<LogEntry> = Vec::with_capacity(BATCH_MAX);
    let mut ticker = interval(Duration::from_millis(FLUSH_INTERVAL_MS));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            entry = rx.recv() => {
                match entry {
                    Some(e) => {
                        batch.push(e);
                        if batch.len() >= BATCH_MAX {
                            flush(&pool, &mut batch).await;
                        }
                    }
                    None => {
                        if !batch.is_empty() {
                            flush(&pool, &mut batch).await;
                        }
                        break;
                    }
                }
            }
            _ = ticker.tick() => {
                if !batch.is_empty() {
                    flush(&pool, &mut batch).await;
                }
            }
        }
    }
}

// ─── Flush: aggregate → single transaction → commit ──────────────────────────

async fn flush(pool: &Pool<Any>, batch: &mut Vec<LogEntry>) {
    // ── 1. Aggregate metrics in memory ───────────────────────────────────────
    // Reduces N upserts (one per request) to at most 1 per unique
    // (bucket, model, provider) combination — typically 1-5 rows per batch.
    let mut metrics: HashMap<MetricKey, MetricAccum> = HashMap::new();
    for e in batch.iter() {
        let bucket = (e.ts / 60_000) * 60_000;
        let acc = metrics
            .entry((bucket, e.model.clone(), e.provider.clone()))
            .or_default();
        acc.request_count     += 1;
        acc.error_count       += i64::from(e.status >= 400);
        acc.total_latency_ms  += e.latency_ms;
        acc.prompt_tokens     += e.prompt_tokens;
        acc.completion_tokens += e.completion_tokens;
        acc.cost_usd          += e.cost_usd;
        acc.cache_hits        += i64::from(e.cached);
    }

    // ── 2. Open one transaction — everything below is one fsync on commit ─────
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::warn!("storage: begin transaction failed: {e}");
            batch.clear();
            return;
        }
    };

    // ── 3. Insert all request log rows ────────────────────────────────────────
    for entry in batch.drain(..) {
        if let Err(e) = queries::insert_log(&mut *tx, &entry).await {
            tracing::warn!("storage: insert_log failed: {e}");
        }
    }

    // ── 4. One upsert per unique (bucket, model, provider) group ─────────────
    for ((bucket, ref model, ref provider), acc) in &metrics {
        if let Err(e) = queries::upsert_metric_batch(
            &mut *tx,
            *bucket,
            model,
            provider,
            acc.request_count,
            acc.error_count,
            acc.total_latency_ms,
            acc.prompt_tokens,
            acc.completion_tokens,
            acc.cost_usd,
            acc.cache_hits,
        )
        .await
        {
            tracing::warn!("storage: upsert_metric_batch failed: {e}");
        }
    }

    // ── 5. Commit — single fsync for the entire batch ─────────────────────────
    if let Err(e) = tx.commit().await {
        tracing::warn!("storage: commit failed: {e}");
    }
}
