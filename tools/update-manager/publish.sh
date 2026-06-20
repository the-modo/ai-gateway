#!/usr/bin/env bash
# NH3 AI Gateway — update manager
#
# Publishes a release manifest to the update server. Gateways poll this
# manifest via GET /updates/status and surface available updates in the
# dashboard (Settings → Updates).
#
# Usage:
#   ./publish.sh <version> "<release notes>" [download-url]
#
# Server target (no credentials stored here — use env vars or ssh config):
#   UPDATE_SSH_HOST   e.g. dilans.duckdns.org   (required)
#   UPDATE_SSH_USER   e.g. dilan                (required)
#   UPDATE_SSH_PASS   optional — used via sshpass when set
#   UPDATE_DIR        default /DATA/Documents/ai-gateway-updates
#
# Example:
#   UPDATE_SSH_HOST=dilans.duckdns.org UPDATE_SSH_USER=dilan \
#     ./publish.sh 0.2.0 "Semantic cache + MCP gateway"

set -euo pipefail

VERSION="${1:?usage: publish.sh <version> \"<notes>\" [url]}"
NOTES="${2:?usage: publish.sh <version> \"<notes>\" [url]}"
URL="${3:-https://github.com/theaigateway/aigateway/releases/tag/v$VERSION}"

HOST="${UPDATE_SSH_HOST:?set UPDATE_SSH_HOST}"
USER="${UPDATE_SSH_USER:?set UPDATE_SSH_USER}"
DIR="${UPDATE_DIR:-/DATA/Documents/ai-gateway-updates}"

MANIFEST=$(cat <<EOF
{
  "version": "$VERSION",
  "notes": "$NOTES",
  "url": "$URL",
  "published_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
)

run_ssh() {
  if [[ -n "${UPDATE_SSH_PASS:-}" ]] && command -v sshpass >/dev/null; then
    sshpass -p "$UPDATE_SSH_PASS" ssh -o StrictHostKeyChecking=no "$USER@$HOST" "$@"
  else
    ssh "$USER@$HOST" "$@"
  fi
}

echo "Publishing v$VERSION to $HOST:$DIR/manifest.json"
run_ssh "mkdir -p '$DIR' && cat > '$DIR/manifest.json'" <<< "$MANIFEST"
echo "Published. Gateways will pick it up on their next update check."
