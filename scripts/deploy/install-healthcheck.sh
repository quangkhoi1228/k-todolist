#!/bin/bash
# Cài đặt launchd agent chạy healthcheck Teams + Zalo mỗi giờ.
# Usage: bash scripts/deploy/install-healthcheck.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST_SRC="$PROJECT_DIR/scripts/deploy/com.kflow.healthcheck.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.kflow.healthcheck.plist"

# Update project path in plist if the repo moved
sed -e "s|/Volumes/home/Project/k-todolist|$PROJECT_DIR|g" "$PLIST_SRC" > "$PLIST_DST"

plutil -lint "$PLIST_DST" > /dev/null

launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "Installed: $PLIST_DST"
echo "Healthcheck will run every hour (and once at install)."
echo "Logs: /tmp/kflow-healthcheck.log, /tmp/kflow-healthcheck.err.log"
