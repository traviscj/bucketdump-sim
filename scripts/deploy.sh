#!/usr/bin/env bash
# Build, test and publish to https://tcj.io/bigbucket/ (static files on noether).
# Usage: scripts/deploy.sh [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="traviscj@tcj.io:/var/www/tcj.io/bigbucket/"
RSYNC_FLAGS=(-avz --delete --exclude '*.map')
[[ "${1:-}" == "--dry-run" ]] && RSYNC_FLAGS+=(--dry-run)

npm test
npm run build
rsync "${RSYNC_FLAGS[@]}" dist/ "$DEST"
echo "→ https://tcj.io/bigbucket/"
