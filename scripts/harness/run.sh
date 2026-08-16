#!/usr/bin/env bash
# vBookmarks real-browser verify gate (Docker).
#
# Builds a Docker image with the extension baked in (bind mounts do not work
# in some DinD setups, so the repo is tarred into the build context), then runs
# the blocking hard-assertion checks in order. Visual capture is NOT part of
# this gate — that is scripts/screenshots/run.sh (which builds the same image
# and runs only the screenshot suites).
#
#   smoke.js              — zero console errors + v4 behavioral assertions
#   verify-keyboard.js    — keyboard/view hard assertions (132)
#   verify-scrollbars.js  — horizontal-scrollbar matrix probe (752)
#   verify-menu-overflow.js — #48: tall menu stays open, no focus-scroll dismiss
#   verify-menu-collapse.js — collapsed submenus open/dispatch/clamp
#   verify-menu-extreme.js  — DPR × zoom × size sweep (menus never clip/dismiss)
# diag/ holds manual diagnostic probes (run on demand, see rerun.sh).
#
# Usage: scripts/harness/run.sh [--smoke-only]
#   --smoke-only  run only smoke.js (zero console errors + v4 behavior) —
#                 the release gate for "the extension loads without crashing".
#                 The full run adds the keyboard/scrollbar/menu verify layers.
SMOKE_ONLY=0
if [[ "${1:-}" == "--smoke-only" ]]; then
    SMOKE_ONLY=1
fi
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CTX="$(mktemp -d /tmp/vbm-harness-ctx.XXXXXX)"
OUT="$REPO_ROOT/tmp/shots"
IMAGE="vbm-smoke:local"

cleanup() { rm -rf "$CTX"; }
trap cleanup EXIT

mkdir -p "$CTX/vBookmarks" "$OUT"
(cd "$REPO_ROOT" && tar cf - --exclude=./.git --exclude=./node_modules --exclude=./tmp --exclude=./.env --exclude=./.claude --exclude=./.env.example .) \
    | tar xf - -C "$CTX/vBookmarks"
cp "$REPO_ROOT"/scripts/harness/{Dockerfile,smoke.js,verify-keyboard.js,verify-scrollbars.js,verify-menu-overflow.js,verify-menu-collapse.js,verify-menu-extreme.js,verify-menu-overlong.js,verify-rightclick-repeat.js} "$CTX/"
cp "$REPO_ROOT"/scripts/screenshots/{shots.js,shots-matrix.js,shots-i18n.js,shots-palette.js,shots-guide.js,shots-tabgroups.js} "$CTX/"
cp -r "$REPO_ROOT"/scripts/harness/diag "$CTX/diag"

docker build -q -t "$IMAGE" "$CTX" >/dev/null

# Run one /work script and copy anything it wrote under /tmp/shots/ into the
# repo's tmp/shots/. Every verify step (and smoke) goes through here — a plain
# `docker run --rm` would discard the screenshots with the container.
run_verify() {
    local script="$1"
    local name="vbm-verify-$$-${script%.js}"
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker create --name "$name" "$IMAGE" node "/work/$script" >/dev/null
    docker start -a "$name"
    docker cp "$name":/tmp/shots/. "$OUT/" 2>/dev/null || true
    docker rm "$name" >/dev/null
}

# Layer 1 — smoke (zero console errors + v4 behavior; captures smoke/* shots).
run_verify smoke.js
if [[ "$SMOKE_ONLY" == "1" ]]; then
    echo "Harness gate (smoke-only): PASS — captures in $OUT"
    exit 0
fi
# Layer 2a — keyboard/view (blocking). Esc chains stay in vitest
# (docs/cdp-escape-limitation.md).
run_verify verify-keyboard.js
# Layer 2b — scrollbar matrix (blocking, ~2-3 min; captures verify-scrollbars/*).
run_verify verify-scrollbars.js
# Layer 2c — context-menu overflow (#48): tall menu stays open, not dismissed
# by the focus-induced document scroll (captures verify-menu/*).
run_verify verify-menu-overflow.js
# Layer 2d — collapsed submenus: flyouts open inside the viewport, dispatch
# works, tab-group collapse applies to both menus (captures verify-menu/*).
run_verify verify-menu-collapse.js
# Layer 2e — extreme zoom/resolution sweep: DPR × page zoom × popup size;
# menus + flyouts must open, stay open and never clip or cover their entry
# (captures verify-menu-extreme/*).
run_verify verify-menu-extreme.js
# Layer 2f — overlong localized menu items (the i18n.py "菜单项过长" warnings):
# fi 48ch tab-group labels under the 320px popup at zoom 100/150 must open and
# stay inside the viewport (captures verify-menu-overlong/*).
run_verify verify-menu-overlong.js
# Layer 2g — zoom > 100 right-click repeat: the zoom-scaled menu must not grow
# tall enough to cover the triggered row (which turned every follow-up
# right-click into a dismiss), so a folder row right-clicked repeatedly still
# reopens the menu each time.
run_verify verify-rightclick-repeat.js
echo "Harness gate: ALL PASS — captures in $OUT"
