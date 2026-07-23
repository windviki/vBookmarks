#!/usr/bin/env bash
# vBookmarks headless smoke + screenshot harness.
#
# Builds a Docker image with the extension baked in (bind mounts do not
# work in some DinD setups, so the repo is tarred into the build context),
# runs the zero-console-error smoke check (smoke.js, the image CMD), then
# captures the two screenshot suites:
#   shots.js         — 11 interaction states, light + dark themes
#   shots-themes.js  — popup/options/advanced in the ink + paper themes
#   shots-i18n.js    — tree/menus/edit-dialog/options per UI language (8x5)
# Screenshots land in tmp/shots/ (git-ignored).
#
# Usage: scripts/screenshots/run.sh [--smoke-only]
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CTX="$(mktemp -d /tmp/vbm-shots-ctx.XXXXXX)"
OUT="$REPO_ROOT/tmp/shots"
IMAGE="vbm-smoke:local"

cleanup() { rm -rf "$CTX"; }
trap cleanup EXIT

mkdir -p "$CTX/vBookmarks" "$OUT"
(cd "$REPO_ROOT" && tar cf - --exclude=./.git --exclude=./node_modules --exclude=./tmp .) \
    | tar xf - -C "$CTX/vBookmarks"
cp "$REPO_ROOT"/scripts/screenshots/{Dockerfile,smoke.js,diag.js,shots.js,shots-themes.js,shots-i18n.js,shots-palette.js,verify-keyboard.js} "$CTX/"

docker build -q -t "$IMAGE" "$CTX" >/dev/null
docker run --rm "$IMAGE"
[ "${1:-}" = "--smoke-only" ] && exit 0

# v4 task 2: keyboard / focus-model / search-flow verification
echo "── keyboard verification ──"
name="vbm-verify-kb-$$"
docker rm -f "$name" >/dev/null 2>&1 || true
docker create --name "$name" "$IMAGE" node /work/verify-keyboard.js >/dev/null
docker start -a "$name"
docker rm "$name" >/dev/null

for suite in shots.js shots-themes.js shots-i18n.js shots-palette.js; do
    name="vbm-shots-$$-${suite%.js}"
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker create --name "$name" "$IMAGE" node "/work/$suite" >/dev/null
    docker start -a "$name"
    docker cp "$name":/tmp/shots/. "$OUT/"
    docker rm "$name" >/dev/null
done
echo "Screenshots written to $OUT"
