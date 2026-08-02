#!/usr/bin/env bash
# Fast rebuild of the vbm-smoke image with the current repo + run a diag/suite script.
# Usage: scripts/screenshots/rerun.sh diag/diag-v4t4.js [extra node args...]
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CTX="$(mktemp -d /tmp/vbm-rerun-ctx.XXXXXX)"
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/vBookmarks"
(cd "$REPO_ROOT" && tar cf - --exclude=./.git --exclude=./node_modules --exclude=./tmp .) | tar xf - -C "$CTX/vBookmarks"
cp "$REPO_ROOT"/scripts/screenshots/{Dockerfile,smoke.js,verify-keyboard.js,verify-scrollbars.js} "$CTX/"
cp -r "$REPO_ROOT"/scripts/screenshots/suites "$CTX/suites"
cp -r "$REPO_ROOT"/scripts/screenshots/diag "$CTX/diag"
docker build -q -t vbm-smoke:local "$CTX" >/dev/null
SCRIPT="$1"; shift || true
docker run --rm vbm-smoke:local node "/work/$SCRIPT" "$@"
