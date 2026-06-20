# Setup guide

This is the longer-form install + configure walkthrough. For a 60-second taste,
see the [Quick start](README.md#quick-start) in the README.

> **Reminder:** Modo AI Gateway is licensed for non-commercial use only. Routing
> live customer traffic, processing paid services, or any commercial deployment
> requires a separate commercial license — please [reach out](https://the-modo.github.io/#contact)
> *before* going to production. See [LICENSE](LICENSE) for the full text.

---

## 1. Prerequisites

| Tool | Version | Why |
|---|---|---|
| Rust | 1.76+ (`rustup`) | building the gateway and mock server |
| Node.js | 20+ | building the dashboard |
| SQLite | 3.40+ | bundled storage backend (no separate install needed on most distros) |

For air-gapped or read-only servers, prebuilt binaries arrive in your inbox via
the [download form](https://the-modo.github.io/download/) — skip to [§5 Configure](#5-configure).

---

## 2. Get the source

```bash
git clone https://github.com/the-modo/ai-gateway
cd ai-gateway
```

---

## 3. Build

```bash
# Gateway + mock server (release profile)
cargo build --release --bin ai-gateway --bin mock-server

# Dashboard (static export)
cd dashboard
npm ci
npm run build
cd ..
```

The gateway binary lands at `target/release/ai-gateway` (~12 MB, fully static).
The dashboard static export lands at `dashboard/out/`.

---

## 4. Layout

A minimal install needs three things side by side:

```
/your/install/dir/
├── ai-gateway          ← the binary
├── gateway.toml        ← config
└── dashboard/          ← static export from `dashboard/out/`
```

For a production setup add:

```
├── gateway.db          ← SQLite (auto-created on first run)
└── logs/               ← stdout/stderr captures
```

---

## 5. Configure

`gateway.toml` is the single source of truth.

```toml
[server]
host = "0.0.0.0"
port = 4891

[storage]
url        = "sqlite://./gateway.db"
log_bodies = true                    # capture request + response bodies in logs
retention_days = 30

[cache.exact_match]
enabled     = true
ttl_seconds = 3600
max_entries = 10000

[dashboard_auth]
username = "admin"
password = "change-me"               # change me!

# A provider — repeat the block for each.
[[providers]]
name        = "openai-primary"
kind        = "openai"               # openai | anthropic | gemini
base_url    = "https://api.openai.com"
api_key_env = "OPENAI_API_KEY"
models      = ["gpt-4o", "gpt-4o-mini"]
```

Provider API keys come from environment variables (`api_key_env = "OPENAI_API_KEY"`
means the gateway reads `$OPENAI_API_KEY` at startup). They never live in the
config file.

---

## 6. Run

```bash
export OPENAI_API_KEY=sk-…
export ANTHROPIC_API_KEY=sk-ant-…
./ai-gateway
```

The gateway prints `Listening on 0.0.0.0:4891` and starts the API + analytics
endpoints. Serve the dashboard with anything that handles static files — Caddy,
nginx, or just Python's stdlib:

```bash
python3 -m http.server 4892 --directory dashboard
```

Open `http://localhost:4892` and sign in with the credentials from
`[dashboard_auth]`.

---

## 7. Point your client

The gateway is OpenAI-compatible — drop it in instead of api.openai.com:

```python
client = OpenAI(
    base_url="http://localhost:4891/v1",
    api_key="sk-gw-…",   # a gateway key, not an upstream one
)
client.chat.completions.create(model="gpt-4o", messages=[...])
```

Gateway keys are managed in the **Access** page of the dashboard. Each key can
have per-minute / per-hour rate limits, spend caps, model and route allowlists,
IP filters, and a TTL after which it auto-revokes.

---

## 8. Run as a service

A minimal systemd unit:

```ini
# /etc/systemd/system/modo-gateway.service
[Unit]
Description=Modo AI Gateway
After=network-online.target

[Service]
Type=simple
User=modo
WorkingDirectory=/opt/modo
EnvironmentFile=/etc/modo-gateway.env       # OPENAI_API_KEY=…, etc.
ExecStart=/opt/modo/ai-gateway
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now modo-gateway
```

---

## 9. Updating

Two paths, depending on whether the host can reach the public internet:

**Online** — `Settings → Updates → Check for updates` in the dashboard polls the
release manifest (configurable URL). When a newer version is published you get a
banner with the release notes. Publishers use the
[Modo Update Manager](https://github.com/the-modo/ai-gateway-update-manager)
to write the manifest into place — a tiny shell script that lives in its own
repo so the gateway tree stays focused on the runtime.

**Air-gapped** — `Settings → Updates → Upload package`. Drop in a release `.zip`
and it's staged on disk with the sha256 recorded. Applying remains a manual
operator step — the gateway never executes uploaded content automatically.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `accept error: Too many open files` | systemd default `LimitNOFILE` | Add `LimitNOFILE=65535` to the unit |
| `cannot create regular file ... Text file busy` on redeploy | binary still running while you copy | Stop the service first; force-kill if needed |
| Browser shows mixed-content error in dev tools | dashboard on HTTPS but gateway on HTTP | Put both behind the same Caddy / nginx, or run both on HTTP for local dev |
| Semantic cache never hits | threshold too high | Lower `Settings → Cache → Semantic threshold` (default 0.85 — try 0.78 for very fuzzy match) |
| Guardrail blocks legitimate prompts | overly broad keyword | Add a more specific regex on the same category and remove the broad keyword |

---

## More info

- **Live demo:** [the-modo.github.io](https://the-modo.github.io/)
- **Commercial license:** [contact us](https://the-modo.github.io/#contact)

---

© Modo AI Gateway. All rights reserved. Free for non-commercial use.
