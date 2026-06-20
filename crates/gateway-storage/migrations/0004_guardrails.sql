-- Guardrail category configuration (mirrors built-in categories, allows overrides)
CREATE TABLE IF NOT EXISTS guardrail_categories (
    id             TEXT    PRIMARY KEY,
    label          TEXT    NOT NULL,
    enabled        INTEGER NOT NULL DEFAULT 1,
    default_action TEXT    NOT NULL DEFAULT 'flag',  -- 'flag' | 'block'
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Per-category keyword overrides (removed built-ins + custom additions)
CREATE TABLE IF NOT EXISTS guardrail_keywords (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id TEXT    NOT NULL REFERENCES guardrail_categories(id) ON DELETE CASCADE,
    keyword     TEXT    NOT NULL,
    is_builtin  INTEGER NOT NULL DEFAULT 0,  -- 0 = custom, 1 = built-in (used for removed-builtin tracking)
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    UNIQUE (category_id, keyword)
);

-- Custom regex patterns per category
CREATE TABLE IF NOT EXISTS guardrail_patterns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id TEXT    NOT NULL REFERENCES guardrail_categories(id) ON DELETE CASCADE,
    pattern     TEXT    NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Detection events linked to requests
CREATE TABLE IF NOT EXISTS guardrail_events (
    id              TEXT    PRIMARY KEY,
    request_id      TEXT    REFERENCES requests(id) ON DELETE SET NULL,
    ts              INTEGER NOT NULL,
    category_id     TEXT    NOT NULL,
    matched_keyword TEXT    NOT NULL,
    action          TEXT    NOT NULL,   -- 'flagged' | 'blocked'
    direction       TEXT    NOT NULL,   -- 'request' | 'response'
    model           TEXT    NOT NULL,
    provider        TEXT    NOT NULL DEFAULT '',
    preview         TEXT
);

CREATE INDEX IF NOT EXISTS idx_guardrail_events_ts         ON guardrail_events(ts);
CREATE INDEX IF NOT EXISTS idx_guardrail_events_request_id ON guardrail_events(request_id);
CREATE INDEX IF NOT EXISTS idx_guardrail_events_category   ON guardrail_events(category_id);

-- Seed default category rows
INSERT OR IGNORE INTO guardrail_categories (id, label, default_action) VALUES
    ('violence',   'Violence & Gore',          'block'),
    ('hate',       'Hate Speech',              'block'),
    ('sexual',     'Explicit Content',         'block'),
    ('harassment', 'Harassment & Bullying',    'flag'),
    ('self_harm',  'Self-harm & Suicide',      'block'),
    ('dangerous',  'Dangerous Information',    'flag'),
    ('illegal',    'Illegal Activity',         'flag');
