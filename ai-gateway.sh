#!/usr/bin/env bash
# ai-gateway.sh — Manage the AI Gateway + Dashboard stack
# Usage: ./ai-gateway.sh {start|dev|stop|restart|status|logs|build|health}
set -euo pipefail

# Ensure Rust's cargo is on PATH (added last so user's existing PATH takes precedence)
export PATH="$PATH:$HOME/.cargo/bin"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$ROOT/dashboard"
LOG_DIR="$ROOT/logs"
RUN_DIR="$ROOT/run"

GW_PID_FILE="$RUN_DIR/gateway.pid"
UI_PID_FILE="$RUN_DIR/dashboard.pid"
GW_LOG="$LOG_DIR/gateway.log"
UI_LOG="$LOG_DIR/dashboard.log"

GATEWAY_PORT="${GATEWAY_PORT:-4891}"
DASHBOARD_PORT="${DASHBOARD_PORT:-4892}"
STARTUP_TIMEOUT="${STARTUP_TIMEOUT:-45}"
BINARY="$ROOT/target/release/ai-gateway"

# ── Colours ──────────────────────────────────────────────────────────────────
C='\033[0;36m'; M='\033[0;35m'; G='\033[0;32m'
R='\033[0;31m'; Y='\033[1;33m'; B='\033[1m'; D='\033[2m'; X='\033[0m'

log()  { printf "${B}[ai-gateway]${X} %s\n" "$*"; }
ok()   { printf "  ${G}✓${X} %s\n" "$*"; }
warn() { printf "  ${Y}⚠${X}  %s\n" "$*"; }
err()  { printf "  ${R}✗${X} %s\n" "$*" >&2; }
die()  { err "$*"; exit 1; }
hr()   { printf "${D}%s${X}\n" "────────────────────────────────────────"; }

# ── Dependency checks ────────────────────────────────────────────────────────
check_deps() {
  command -v cargo &>/dev/null || die "cargo not found — install Rust: https://rustup.rs"
  command -v node  &>/dev/null || die "node not found — install Node.js ≥ 18"
  command -v npm   &>/dev/null || die "npm not found"
  command -v curl  &>/dev/null || die "curl not found"
  [[ -f "$ROOT/gateway.toml" ]] || die "gateway.toml not found in $ROOT"
  local node_ver; node_ver=$(node -e 'process.stdout.write(process.versions.node)')
  local node_major="${node_ver%%.*}"
  (( node_major >= 18 )) || die "Node.js ≥ 18 required (found $node_ver)"
  ok "Dependencies OK (node $node_ver)"
}

# ── Port checks ──────────────────────────────────────────────────────────────
port_free() { ! lsof -i ":$1" -sTCP:LISTEN -t &>/dev/null; }

check_ports() {
  port_free "$GATEWAY_PORT"   || die "Port $GATEWAY_PORT already in use — set GATEWAY_PORT to override"
  port_free "$DASHBOARD_PORT" || die "Port $DASHBOARD_PORT already in use — set DASHBOARD_PORT to override"
  ok "Ports $GATEWAY_PORT and $DASHBOARD_PORT are free"
}

# ── PID helpers ──────────────────────────────────────────────────────────────
pid_alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

graceful_stop() {
  local pidfile="$1" label="$2" timeout="${3:-10}"
  [[ -f "$pidfile" ]] || return 0
  local pid; pid=$(cat "$pidfile")
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null
    local i=0
    while kill -0 "$pid" 2>/dev/null && (( i < timeout )); do
      sleep 1; (( i++ ))
    done
    # Force-kill if still alive
    kill -0 "$pid" 2>/dev/null && { kill -KILL "$pid" 2>/dev/null; warn "$label did not stop gracefully — force killed"; } || ok "Stopped $label (pid $pid)"
  fi
  rm -f "$pidfile"
}

# ── Build ────────────────────────────────────────────────────────────────────
cmd_build() {
  hr
  log "Building release binaries…"
  hr

  printf "${D}  cargo build --release --bin ai-gateway${X}\n"
  if ! cargo build --release --bin ai-gateway --manifest-path "$ROOT/Cargo.toml" 2>&1 \
      | grep -E "^error|Compiling gateway-core|Finished|^warning\[" \
      | sed 's/^/  /'; then
    die "Rust build failed — run 'cargo build --release --bin ai-gateway' for full output"
  fi
  [[ -x "$BINARY" ]] || die "Binary not found at $BINARY after build"
  ok "Gateway binary: $BINARY"

  printf "${D}  npm run build${X}\n"
  if ! npm --prefix "$DASHBOARD_DIR" run build 2>&1 \
      | grep -E "✓|Route|Error|error TS" \
      | sed 's/^/  /'; then
    die "Dashboard build failed — run 'npm run build' in dashboard/ for full output"
  fi
  ok "Dashboard production build ready"
  hr
}

# ── Health check (with spinner) ──────────────────────────────────────────────
wait_http() {
  local url="$1" label="$2" pidfile="${3:-}"
  local i=0
  printf "  Waiting for %-12s" "$label"
  while ! curl -sf -o /dev/null --max-time 2 "$url" 2>/dev/null; do
    # Bail early if the process already died
    if [[ -n "$pidfile" ]] && [[ -f "$pidfile" ]] && ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then
      printf " ${R}crashed${X}\n"
      die "$label process exited unexpectedly — check logs: $LOG_DIR/"
    fi
    (( i++ ))
    (( i > STARTUP_TIMEOUT )) && { printf " ${R}timeout${X}\n"; die "$label did not respond within ${STARTUP_TIMEOUT}s"; }
    printf "."
    sleep 1
  done
  printf " ${G}ready${X} (%ds)\n" "$i"
}

# ── Start (production) ───────────────────────────────────────────────────────
cmd_start() {
  mkdir -p "$LOG_DIR" "$RUN_DIR"
  pid_alive "$GW_PID_FILE" && die "Gateway already running — use 'restart' or 'stop' first"
  pid_alive "$UI_PID_FILE" && die "Dashboard already running — use 'restart' or 'stop' first"
  check_deps
  check_ports
  cmd_build

  log "Starting production services…"

  # Rotate logs
  [[ -f "$GW_LOG" ]] && mv "$GW_LOG" "${GW_LOG}.$(date +%Y%m%d-%H%M%S)"
  [[ -f "$UI_LOG" ]] && mv "$UI_LOG" "${UI_LOG}.$(date +%Y%m%d-%H%M%S)"

  "$BINARY" >> "$GW_LOG" 2>&1 &
  echo $! > "$GW_PID_FILE"

  NODE_ENV=production npm --prefix "$DASHBOARD_DIR" run start >> "$UI_LOG" 2>&1 &
  echo $! > "$UI_PID_FILE"

  wait_http "http://localhost:$GATEWAY_PORT/health" "Gateway"   "$GW_PID_FILE"
  wait_http "http://localhost:$DASHBOARD_PORT"      "Dashboard" "$UI_PID_FILE"

  _print_running_banner "production"
}

# ── Dev (foreground, with live prefixed output) ───────────────────────────────
cmd_dev() {
  mkdir -p "$LOG_DIR" "$RUN_DIR"
  pid_alive "$GW_PID_FILE" && die "Gateway already running — run './ai-gateway.sh stop' first"
  pid_alive "$UI_PID_FILE" && die "Dashboard already running — run './ai-gateway.sh stop' first"
  check_deps
  check_ports

  printf "\n${B}AI Gateway — dev mode${X}  ${D}(Ctrl-C to stop)${X}\n"
  printf "  ${C}Gateway${X}   → http://localhost:$GATEWAY_PORT\n"
  printf "  ${M}Dashboard${X} → http://localhost:$DASHBOARD_PORT\n\n"

  _prefix() { local color="$1" label="$2"; while IFS= read -r line; do printf "${color}[%s]${X} %s\n" "$label" "$line"; done; }

  cargo run --bin ai-gateway --manifest-path "$ROOT/Cargo.toml" 2>&1 | _prefix "$C" "gateway"   &
  GW_BG=$!; echo $GW_BG > "$GW_PID_FILE"

  npm --prefix "$DASHBOARD_DIR" run dev 2>&1 | _prefix "$M" "dashboard" &
  UI_BG=$!; echo $UI_BG > "$UI_PID_FILE"

  _cleanup_dev() {
    printf "\n${B}Shutting down…${X}\n"
    kill "$GW_BG" "$UI_BG" 2>/dev/null || true
    wait "$GW_BG" "$UI_BG" 2>/dev/null || true
    rm -f "$GW_PID_FILE" "$UI_PID_FILE"
    ok "All services stopped"
  }
  trap _cleanup_dev INT TERM
  wait "$GW_BG" "$UI_BG"
}

# ── Stop ─────────────────────────────────────────────────────────────────────
cmd_stop() {
  log "Stopping AI Gateway stack…"
  graceful_stop "$GW_PID_FILE" "Gateway"
  graceful_stop "$UI_PID_FILE" "Dashboard"
  log "All services stopped."
}

# ── Restart ──────────────────────────────────────────────────────────────────
cmd_restart() {
  cmd_stop
  sleep 1
  cmd_start
}

# ── Status ───────────────────────────────────────────────────────────────────
cmd_status() {
  printf "\n${B}AI Gateway status${X}\n\n"

  if pid_alive "$GW_PID_FILE"; then
    local pid; pid=$(cat "$GW_PID_FILE")
    local mem; mem=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.0fMB", $1/1024}' || echo "?")
    printf "  ${G}●${X} Gateway    ${G}running${X}   pid=%-6s mem=%-8s http://localhost:%s\n" "$pid" "$mem" "$GATEWAY_PORT"
  else
    printf "  ${R}●${X} Gateway    ${R}stopped${X}\n"
  fi

  if pid_alive "$UI_PID_FILE"; then
    local pid; pid=$(cat "$UI_PID_FILE")
    local mem; mem=$(ps -o rss= -p "$pid" 2>/dev/null | awk '{printf "%.0fMB", $1/1024}' || echo "?")
    printf "  ${G}●${X} Dashboard  ${G}running${X}   pid=%-6s mem=%-8s http://localhost:%s\n" "$pid" "$mem" "$DASHBOARD_PORT"
  else
    printf "  ${R}●${X} Dashboard  ${R}stopped${X}\n"
  fi

  printf "\n  ${D}Logs: $LOG_DIR/${X}\n\n"
}

# ── Health ───────────────────────────────────────────────────────────────────
cmd_health() {
  printf "\n${B}Health check${X}\n\n"
  local exit_code=0

  if curl -sf "http://localhost:$GATEWAY_PORT/health" -o /tmp/.gw_health 2>/dev/null; then
    printf "  ${G}✓${X} Gateway    http://localhost:$GATEWAY_PORT/health\n"
    cat /tmp/.gw_health | python3 -m json.tool 2>/dev/null | sed 's/^/    /' || true
    rm -f /tmp/.gw_health
  else
    printf "  ${R}✗${X} Gateway    not responding at http://localhost:$GATEWAY_PORT/health\n"
    exit_code=1
  fi

  if curl -sf -o /dev/null "http://localhost:$DASHBOARD_PORT" 2>/dev/null; then
    printf "  ${G}✓${X} Dashboard  http://localhost:$DASHBOARD_PORT\n"
  else
    printf "  ${R}✗${X} Dashboard  not responding at http://localhost:$DASHBOARD_PORT\n"
    exit_code=1
  fi

  printf "\n"
  return $exit_code
}

# ── Logs ─────────────────────────────────────────────────────────────────────
cmd_logs() {
  local svc="${1:-all}"
  mkdir -p "$LOG_DIR"
  case "$svc" in
    gateway)   [[ -f "$GW_LOG" ]] || die "No gateway log at $GW_LOG"; tail -f "$GW_LOG" ;;
    dashboard) [[ -f "$UI_LOG" ]] || die "No dashboard log at $UI_LOG"; tail -f "$UI_LOG" ;;
    *)
      [[ -f "$GW_LOG" ]] || [[ -f "$UI_LOG" ]] || die "No logs found in $LOG_DIR — start the stack first"
      ( [[ -f "$GW_LOG" ]] && tail -f "$GW_LOG" | sed "s/^/${C}[gateway]${X} /" ) &
      ( [[ -f "$UI_LOG" ]] && tail -f "$UI_LOG" | sed "s/^/${M}[dashboard]${X} /" ) &
      trap 'kill 0' INT TERM; wait
      ;;
  esac
}

# ── Release ──────────────────────────────────────────────────────────────────
cmd_release() {
  local VERSION
  VERSION=$(grep '^version' "$ROOT/Cargo.toml" | head -1 | sed 's/.*= "\(.*\)"/\1/')
  local RELEASE_NAME="ai-gateway-v${VERSION}"
  local RELEASE_DIR="$ROOT/releases/$RELEASE_NAME"
  local ARCHIVE="$ROOT/releases/${RELEASE_NAME}.zip"

  hr
  log "Building release v${VERSION}…"
  hr

  # 1a. Rust binary — macOS (native)
  printf "${D}  cargo build --release (macOS)${X}\n"
  if ! cargo build --release --bin ai-gateway --manifest-path "$ROOT/Cargo.toml" 2>&1 \
      | grep -E "^error|Compiling gateway-core|Finished" | sed 's/^/  /'; then
    die "Rust build failed"
  fi
  [[ -x "$BINARY" ]] || die "Binary not found at $BINARY"
  ok "Gateway binary built (macOS)"

  # 1b. Rust binary — Linux x86_64 static (via cargo-zigbuild + musl)
  local LINUX_BINARY="$ROOT/target/x86_64-unknown-linux-musl/release/ai-gateway"
  printf "${D}  cargo zigbuild --release (Linux x86_64 musl)${X}\n"
  if ! cargo zigbuild --release --bin ai-gateway \
         --target x86_64-unknown-linux-musl \
         --manifest-path "$ROOT/Cargo.toml" 2>&1 \
      | grep -E "^error|Compiling gateway-core|Finished" | sed 's/^/  /'; then
    die "Linux cross-compile failed — ensure zig and cargo-zigbuild are installed"
  fi
  [[ -f "$LINUX_BINARY" ]] || die "Linux binary not found at $LINUX_BINARY"
  ok "Gateway binary built (Linux x86_64)"

  # 1c. Rust binary — Windows x86_64 (.exe via mingw)
  local WIN_BINARY="$ROOT/target/x86_64-pc-windows-gnu/release/ai-gateway.exe"
  printf "${D}  cargo build --release (Windows x86_64)${X}\n"
  if ! CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc \
       cargo build --release --bin ai-gateway \
         --target x86_64-pc-windows-gnu \
         --manifest-path "$ROOT/Cargo.toml" 2>&1 \
      | grep -E "^error|Compiling gateway-core|Finished" | sed 's/^/  /'; then
    die "Windows cross-compile failed"
  fi
  [[ -f "$WIN_BINARY" ]] || die "Windows binary not found at $WIN_BINARY"
  ok "Gateway binary built (Windows x86_64)"

  # 2. Dashboard static export
  printf "${D}  npm run build (dashboard)${X}\n"
  if ! npm --prefix "$DASHBOARD_DIR" run build 2>&1 \
      | grep -E "✓|Route|Error|error TS" | sed 's/^/  /'; then
    die "Dashboard build failed"
  fi
  [[ -d "$DASHBOARD_DIR/out" ]] || die "Dashboard out/ directory not found after build"
  ok "Dashboard static export built"

  # 3. Assemble release directory
  rm -rf "$RELEASE_DIR"
  mkdir -p "$RELEASE_DIR/dashboard"

  cp "$BINARY"        "$RELEASE_DIR/ai-gateway-darwin"
  cp "$LINUX_BINARY"  "$RELEASE_DIR/ai-gateway-linux"
  cp "$WIN_BINARY"    "$RELEASE_DIR/ai-gateway.exe"
  cp -r "$DASHBOARD_DIR/out/." "$RELEASE_DIR/dashboard/"
  cp "$ROOT/gateway.toml"         "$RELEASE_DIR/gateway.toml"
  cp "$ROOT/serve-dashboard.ps1"  "$RELEASE_DIR/serve-dashboard.ps1"
  # Never ship the database — it's created fresh on first run via migrations

  # 4. Write the customer run script
  cat > "$RELEASE_DIR/ai-gateway.sh" << 'RUNSCRIPT'
#!/usr/bin/env bash
# AI Gateway — start the gateway and dashboard
# Usage: ./ai-gateway.sh [--gateway-port 4891] [--dashboard-port 4892]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GATEWAY_PORT="${GATEWAY_PORT:-4891}"
DASHBOARD_PORT="${DASHBOARD_PORT:-4892}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --gateway-port)   GATEWAY_PORT="$2";   shift 2 ;;
    --dashboard-port) DASHBOARD_PORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

C='\033[0;36m'; M='\033[0;35m'; G='\033[0;32m'
R='\033[0;31m'; B='\033[1m'; D='\033[2m'; X='\033[0m'

log() { printf "${B}[ai-gateway]${X} %s\n" "$*"; }
ok()  { printf "  ${G}✓${X} %s\n" "$*"; }
err() { printf "  ${R}✗${X} %s\n" "$*" >&2; }

# Pick the right binary for the current OS
case "$(uname -s)" in
  Darwin) BINARY="$ROOT/ai-gateway-darwin" ;;
  Linux)  BINARY="$ROOT/ai-gateway-linux"  ;;
  *)      err "Unsupported OS: $(uname -s)"; exit 1 ;;
esac

[[ -f "$ROOT/gateway.toml" ]] || { err "gateway.toml not found"; exit 1; }
[[ -f "$BINARY" ]]            || { err "Binary not found: $BINARY"; exit 1; }
[[ -d "$ROOT/dashboard" ]]    || { err "dashboard/ directory not found"; exit 1; }
chmod +x "$BINARY"

log "Starting AI Gateway…"

# Serve the static dashboard — try python3, then npx
serve_dashboard() {
  if command -v python3 &>/dev/null; then
    python3 -m http.server "$DASHBOARD_PORT" --directory "$ROOT/dashboard" 2>/dev/null
  elif command -v npx &>/dev/null; then
    npx --yes serve "$ROOT/dashboard" -p "$DASHBOARD_PORT" -s 2>/dev/null
  else
    err "Need python3 or npx to serve the dashboard — install either and retry"
    return 1
  fi
}

export GATEWAY_CONFIG="$ROOT/gateway.toml"
cd "$ROOT"
# Pre-touch the DB file — musl-linked SQLite can open existing files but
# fails to create new ones on some Linux filesystems.
touch "$ROOT/gateway.db" 2>/dev/null || true
"$BINARY" &
GW_PID=$!

serve_dashboard &
UI_PID=$!

_stop() {
  printf "\n${B}Shutting down…${X}\n"
  kill "$GW_PID" "$UI_PID" 2>/dev/null || true
  wait "$GW_PID" "$UI_PID" 2>/dev/null || true
  ok "Stopped"
}
trap _stop INT TERM

# Wait up to 30 s for the gateway
GW_OK=0
printf "  Waiting for gateway"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null --max-time 1 "http://localhost:$GATEWAY_PORT/health" 2>/dev/null; then
    GW_OK=1; printf " ${G}ready${X}\n"; break
  fi
  printf "."; sleep 1
done

if (( GW_OK == 0 )); then
  printf " ${R}timeout${X}\n"
  err "Gateway did not start — check output above for errors"
  kill "$GW_PID" "$UI_PID" 2>/dev/null || true
  exit 1
fi

printf "\n${B}${G}AI Gateway is running${X}\n\n"
printf "  ${C}API${X}        → http://localhost:${GATEWAY_PORT}\n"
printf "  ${M}Dashboard${X}  → http://localhost:${DASHBOARD_PORT}\n\n"
printf "  ${D}Press Ctrl-C to stop${X}\n\n"

wait "$GW_PID" "$UI_PID"
RUNSCRIPT

  chmod +x "$RELEASE_DIR/ai-gateway.sh" \
            "$RELEASE_DIR/ai-gateway-darwin" \
            "$RELEASE_DIR/ai-gateway-linux"

  # Write the Windows customer batch script (simple runner, no build step)
  cat > "$RELEASE_DIR/ai-gateway.bat" << 'BATSCRIPT'
@echo off
:: AI Gateway — start the gateway and dashboard
:: Edit gateway.toml to add your API keys, then run this file
setlocal enabledelayedexpansion
set ROOT=%~dp0
set ROOT=%ROOT:~0,-1%
set GATEWAY_PORT=4891
set DASHBOARD_PORT=4892
if not "%1"=="" set GATEWAY_PORT=%1
if not "%2"=="" set DASHBOARD_PORT=%2

if not exist "%ROOT%\gateway.toml"   ( echo   x gateway.toml not found   & exit /b 1 )
if not exist "%ROOT%\ai-gateway.exe" ( echo   x ai-gateway.exe not found & exit /b 1 )
if not exist "%ROOT%\dashboard"      ( echo   x dashboard\ not found     & exit /b 1 )

echo [ai-gateway] Starting...

:: GATEWAY_CONFIG must be an absolute path so the gateway can locate gateway.toml
:: and resolve the SQLite database path relative to it (not the working directory).
set GATEWAY_CONFIG=%ROOT%\gateway.toml
cd /d "%ROOT%"
:: Pre-create the DB file so SQLite can open it (avoids CANTOPEN on first run)
type nul >> "%ROOT%\gateway.db" 2>nul
start "" /B /D "%ROOT%" "%ROOT%\ai-gateway.exe"

:: Serve dashboard — try python, python3, then node/npx in order
where python >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" /B python -m http.server %DASHBOARD_PORT% --directory "%ROOT%\dashboard"
    goto serve_ok
)
where python3 >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" /B python3 -m http.server %DASHBOARD_PORT% --directory "%ROOT%\dashboard"
    goto serve_ok
)
where node >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" /B npx --yes serve "%ROOT%\dashboard" -p %DASHBOARD_PORT% -s
    goto serve_ok
)
:: PowerShell is built into every modern Windows — use it as the final fallback
start "" /B powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\serve-dashboard.ps1" -Port %DASHBOARD_PORT% -Root "%ROOT%\dashboard"
:serve_ok

:: Wait up to 30 s for the gateway health endpoint
set GW_OK=0
for /L %%i in (1,1,30) do (
    curl -sf -o nul --max-time 1 "http://localhost:%GATEWAY_PORT%/health" >nul 2>&1
    if !ERRORLEVEL!==0 ( set GW_OK=1 & goto ready )
    <nul set /p ="."
    timeout /t 1 /nobreak >nul
)
:ready
echo.
if !GW_OK!==0 (
    echo   x Gateway did not start — check that nothing else is using port %GATEWAY_PORT%
    echo     and look for error output above.
    pause >nul
    exit /b 1
)
echo   + AI Gateway is running
echo.
echo   API        -^> http://localhost:%GATEWAY_PORT%
echo   Dashboard  -^> http://localhost:%DASHBOARD_PORT%
echo.
echo   Press any key to stop...
pause >nul
taskkill /F /IM ai-gateway.exe >nul 2>&1
echo [ai-gateway] Stopped.
BATSCRIPT

  # 5. Create zip (customers can open on any OS without extra tools)
  command -v zip &>/dev/null || die "zip not found — install zip and retry"
  rm -f "$ARCHIVE"
  ( cd "$(dirname "$RELEASE_DIR")" && zip -qr "$ARCHIVE" "$(basename "$RELEASE_DIR")" --exclude "*.db" --exclude "*.db-shm" --exclude "*.db-wal" )

  hr
  ok "Release ready: releases/${RELEASE_NAME}.zip"
  printf "\n"
  printf "  ${D}Contents:${X}\n"
  printf "  ${D}  ai-gateway-darwin  — gateway binary (macOS)${X}\n"
  printf "  ${D}  ai-gateway-linux   — gateway binary (Linux x86_64)${X}\n"
  printf "  ${D}  ai-gateway.exe     — gateway binary (Windows x86_64)${X}\n"
  printf "  ${D}  dashboard/         — UI static files${X}\n"
  printf "  ${D}  gateway.toml       — configuration${X}\n"
  printf "  ${D}  ai-gateway.sh      — start everything (macOS/Linux)${X}\n"
  printf "  ${D}  ai-gateway.bat     — start everything (Windows)${X}\n"
  printf "\n"
  printf "  ${B}Customer usage:${X}\n"
  printf "  ${D}  unzip ${RELEASE_NAME}.zip${X}\n"
  printf "  ${D}  cd ${RELEASE_NAME}${X}\n"
  printf "  ${D}  # edit gateway.toml — add your provider API keys${X}\n"
  printf "  ${D}  ./ai-gateway.sh${X}\n"
  printf "\n"
  hr
}

# ── Running banner ────────────────────────────────────────────────────────────
_print_running_banner() {
  local mode="${1:-production}"
  printf "\n${B}${G}AI Gateway running${X}  ${D}(${mode})${X}\n\n"
  printf "  ${C}Gateway${X}   → http://localhost:$GATEWAY_PORT\n"
  printf "  ${M}Dashboard${X} → http://localhost:$DASHBOARD_PORT\n"
  printf "  ${D}Logs      → $LOG_DIR/${X}\n\n"
  printf "  ${D}./ai-gateway.sh status   — process status + memory\n"
  printf "  ./ai-gateway.sh logs     — tail combined logs\n"
  printf "  ./ai-gateway.sh health   — HTTP health checks\n"
  printf "  ./ai-gateway.sh stop     — graceful shutdown${X}\n\n"
}

# ── Help ─────────────────────────────────────────────────────────────────────
cmd_help() {
  printf "\n${B}Usage:${X} ./ai-gateway.sh <command> [args]\n\n"
  printf "Commands:\n"
  printf "  ${G}start${X}              Build release binaries, then start in background\n"
  printf "  ${C}dev${X}                Start in dev mode with live reload (foreground)\n"
  printf "  ${Y}stop${X}               Gracefully stop all running services\n"
  printf "  ${Y}restart${X}            Stop → build → start\n"
  printf "  ${D}status${X}             Show running services, PIDs, and memory usage\n"
  printf "  ${D}health${X}             HTTP health checks against running services\n"
  printf "  ${D}logs [svc]${X}         Tail logs (gateway | dashboard | all)\n"
  printf "  ${D}build${X}              Build release binaries without starting\n"
  printf "  ${G}release${X}            Build + package distributable release tarball\n\n"
  printf "Environment:\n"
  printf "  ${D}GATEWAY_PORT${X}       Gateway port        (default: 4891)\n"
  printf "  ${D}DASHBOARD_PORT${X}     Dashboard port      (default: 4892)\n"
  printf "  ${D}STARTUP_TIMEOUT${X}    Health check timeout in seconds (default: 45)\n\n"
}

# ── Dispatch ─────────────────────────────────────────────────────────────────
CMD="${1:-help}"
shift 2>/dev/null || true
case "$CMD" in
  start)   cmd_start   ;;
  dev)     cmd_dev     ;;
  stop)    cmd_stop    ;;
  restart) cmd_restart ;;
  status)  cmd_status  ;;
  health)  cmd_health  ;;
  logs)    cmd_logs "${1:-all}" ;;
  build)   cmd_build   ;;
  release) cmd_release ;;
  help|-h|--help) cmd_help ;;
  *) err "Unknown command: $CMD"; cmd_help; exit 1 ;;
esac
