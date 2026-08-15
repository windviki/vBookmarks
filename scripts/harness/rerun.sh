#!/usr/bin/env bash
# Fast rebuild of the vbm-smoke image with the current repo + run a diag or
# screenshot script inside it, then copy any screenshots it wrote under
# /tmp/shots/ into the repo's tmp/shots/ for review.
# Usage: scripts/harness/rerun.sh diag/diag-environment.js [extra node args...]
#        scripts/harness/rerun.sh shots-matrix.js
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$REPO_ROOT/tmp/shots"
CTX="$(mktemp -d /tmp/vbm-rerun-ctx.XXXXXX)"
trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/vBookmarks" "$OUT"
(cd "$REPO_ROOT" && tar cf - --exclude=./.git --exclude=./node_modules --exclude=./tmp --exclude=./.env --exclude=./.claude --exclude=./.env.example .) | tar xf - -C "$CTX/vBookmarks"
cp "$REPO_ROOT"/scripts/harness/{Dockerfile,smoke.js,verify-keyboard.js,verify-scrollbars.js,verify-menu-overflow.js,verify-menu-collapse.js,verify-menu-extreme.js,verify-rightclick-repeat.js,verify-bmlet.js} "$CTX/"
cp "$REPO_ROOT"/scripts/screenshots/{shots.js,shots-matrix.js,shots-i18n.js,shots-palette.js,shots-guide.js,shots-tabgroups.js} "$CTX/"
cp -r "$REPO_ROOT"/scripts/harness/diag "$CTX/diag"
docker build -q -t vbm-smoke:local "$CTX" >/dev/null
SCRIPT="$1"; shift || true
name="vbm-rerun-$$"
docker rm -f "$name" >/dev/null 2>&1 || true
docker create --name "$name" vbm-smoke:local node "/work/$SCRIPT" "$@" >/dev/null
docker start -a "$name"
code=$?
docker cp "$name":/tmp/shots/. "$OUT/" 2>/dev/null || true
docker rm "$name" >/dev/null
exit "$code"
