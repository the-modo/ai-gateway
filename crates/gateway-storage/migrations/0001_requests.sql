CREATE TABLE IF NOT EXISTS requests (
    id                TEXT PRIMARY KEY,
    ts                INTEGER NOT NULL,
    model             TEXT NOT NULL,
    provider          TEXT NOT NULL,
    status            INTEGER NOT NULL,
    latency_ms        INTEGER NOT NULL,
    prompt_tokens     INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens      INTEGER NOT NULL DEFAULT 0,
    cost_usd          REAL    NOT NULL DEFAULT 0.0,
    cached            INTEGER NOT NULL DEFAULT 0,
    stream            INTEGER NOT NULL DEFAULT 0,
    error             TEXT,
    request_body      TEXT,
    response_body     TEXT
);

CREATE INDEX IF NOT EXISTS idx_requests_ts       ON requests(ts);
CREATE INDEX IF NOT EXISTS idx_requests_model    ON requests(model);
CREATE INDEX IF NOT EXISTS idx_requests_provider ON requests(provider);
