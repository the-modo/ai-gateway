-- Pre-aggregated 1-minute buckets for fast dashboard queries.
-- Integer division bucketing: (ts / 60000) * 60000 = floor to minute.
CREATE TABLE IF NOT EXISTS metrics_1m (
    bucket            INTEGER NOT NULL,
    model             TEXT    NOT NULL,
    provider          TEXT    NOT NULL,
    request_count     INTEGER NOT NULL DEFAULT 0,
    error_count       INTEGER NOT NULL DEFAULT 0,
    total_latency_ms  INTEGER NOT NULL DEFAULT 0,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd          REAL    NOT NULL DEFAULT 0.0,
    PRIMARY KEY (bucket, model, provider)
);

CREATE INDEX IF NOT EXISTS idx_metrics_bucket ON metrics_1m(bucket);
