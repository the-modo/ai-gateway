CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    key_value TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    rate_enabled INTEGER NOT NULL DEFAULT 0,
    rate_requests INTEGER NOT NULL DEFAULT 60,
    rate_window TEXT NOT NULL DEFAULT 'minute',
    spend_enabled INTEGER NOT NULL DEFAULT 0,
    spend_cap_usd REAL NOT NULL DEFAULT 0.0,
    spend_period TEXT NOT NULL DEFAULT 'month',
    spend_used REAL NOT NULL DEFAULT 0.0,
    allowed_models TEXT NOT NULL DEFAULT '"all"',
    allowed_routes TEXT NOT NULL DEFAULT '"all"',
    allowed_ips TEXT NOT NULL DEFAULT '[]',
    total_requests INTEGER NOT NULL DEFAULT 0,
    total_spend_usd REAL NOT NULL DEFAULT 0.0,
    last_used_at INTEGER,
    status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS config_entries (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
