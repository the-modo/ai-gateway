#!/usr/bin/env python3
"""Seed the gateway SQLite DB with realistic mock analytics data."""
import sqlite3, random, time, uuid
from datetime import datetime

DB_PATH = '/Users/dilanperera/Desktop/ai-gateway/gateway.db'

# (model, provider, price_in_per_1M, price_out_per_1M, weight)
MODELS = [
    ('gpt-4o',                    'openai-primary',     5.0,   15.0,  20),
    ('gpt-4o-mini',               'openai-primary',     0.15,   0.60, 35),
    ('claude-sonnet-4-6',         'anthropic-primary',  3.0,   15.0,  18),
    ('claude-haiku-4-5-20251001', 'anthropic-primary',  0.25,   1.25, 15),
    ('gemini-2.0-flash',          'gemini-primary',     0.075,  0.30, 12),
]

LATENCY_RANGE = {
    'gpt-4o':                    (1200, 5000),
    'gpt-4o-mini':               (300,  1800),
    'claude-sonnet-4-6':         (1800, 6000),
    'claude-haiku-4-5-20251001': (600,  2200),
    'gemini-2.0-flash':          (400,  1600),
}

ERRORS = [
    'Connection timeout after 30s',
    'Provider returned 500: Internal Server Error',
    'Rate limit exceeded upstream',
    'Invalid API key',
    'Model overloaded, try again later',
]

def make_requests(n=2500, days=7):
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - days * 86400 * 1000
    weights = [m[4] for m in MODELS]
    rows = []

    for _ in range(n):
        # Timestamp with business-hours bias
        ts = random.randint(start_ms, now_ms)
        dt = datetime.fromtimestamp(ts / 1000)
        # Boost 9am–7pm traffic 3×
        if not (9 <= dt.hour <= 19):
            if random.random() > 0.25:
                ts = random.randint(start_ms, now_ms)
                dt = datetime.fromtimestamp(ts / 1000)

        model, provider, pin, pout, _ = random.choices(MODELS, weights=weights)[0]

        prompt_tokens     = random.randint(80, 2500)
        completion_tokens = random.randint(40, 900)
        total_tokens      = prompt_tokens + completion_tokens

        lo, hi = LATENCY_RANGE[model]
        latency_ms = random.randint(lo, hi)

        # Status: 92% 200, 4% 502, 4% 429
        r = random.random()
        if r < 0.92:   status = 200
        elif r < 0.96: status = 502
        else:          status = 429

        # Cache: ~22% hit rate for successful non-stream requests
        cached = 1 if (status == 200 and random.random() < 0.22) else 0
        if cached:
            latency_ms = random.randint(1, 8)

        stream = 1 if random.random() < 0.28 else 0

        if status == 200:
            cost_usd = prompt_tokens * pin / 1e6 + completion_tokens * pout / 1e6
        else:
            prompt_tokens = completion_tokens = total_tokens = 0
            cost_usd = 0.0

        error = None
        if status >= 400:
            error = random.choice(ERRORS)

        rows.append((
            str(uuid.uuid4()), ts, model, provider, status, latency_ms,
            prompt_tokens, completion_tokens, total_tokens, cost_usd,
            cached, stream, error,
        ))

    return rows

def build_metrics(rows):
    buckets = {}
    for r in rows:
        _, ts, model, provider, status, latency_ms, pt, ct, _, cost, cached, _, _ = r
        bucket = (ts // 60_000) * 60_000
        key = (bucket, model, provider)
        if key not in buckets:
            buckets[key] = [bucket, model, provider, 0, 0, 0, 0, 0, 0.0, 0]
        b = buckets[key]
        b[3] += 1                              # request_count
        if status >= 400: b[4] += 1            # error_count
        b[5] += latency_ms                     # total_latency_ms
        b[6] += pt                             # prompt_tokens
        b[7] += ct                             # completion_tokens
        b[8] += cost                           # cost_usd
        b[9] += cached                         # cache_hits
    return list(buckets.values())

def seed():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute('DELETE FROM requests')
    c.execute('DELETE FROM metrics_1m')

    rows = make_requests(2500)
    metrics = build_metrics(rows)

    c.executemany(
        'INSERT INTO requests'
        '(id,ts,model,provider,status,latency_ms,prompt_tokens,completion_tokens,'
        'total_tokens,cost_usd,cached,stream,error) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        rows,
    )
    c.executemany(
        'INSERT OR REPLACE INTO metrics_1m'
        '(bucket,model,provider,request_count,error_count,total_latency_ms,'
        'prompt_tokens,completion_tokens,cost_usd,cache_hits) VALUES(?,?,?,?,?,?,?,?,?,?)',
        metrics,
    )

    conn.commit()

    row = c.execute(
        'SELECT COUNT(*), SUM(cost_usd), AVG(latency_ms), SUM(cached) FROM requests'
    ).fetchone()
    print(f'✓ {row[0]} requests  |  ${row[1]:.4f} cost  |  {row[2]:.0f}ms avg lat  |  {row[3]} cache hits')
    print(f'✓ {len(metrics)} metric buckets written')
    conn.close()

seed()
