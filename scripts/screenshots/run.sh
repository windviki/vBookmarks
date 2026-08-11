#!/usr/bin/env bash
# vBookmarks headless smoke + screenshot harness.
#
# Builds a Docker image with the extension baked in (bind mounts do not
# work in some DinD setups, so the repo is tarred into the build context),
# runs the zero-console-error smoke check (smoke.js, the image CMD), the
# real-browser keyboard/view verification (verify-keyboard.js, blocking) and
# the scrollbar matrix probe (verify-scrollbars.js, blocking: screen ×
# browser-zoom × in-extension zoom sweep, no horizontal scrollbar on any pane),
# then captures the screenshot suites (suites/):
#   shots.js         — 11 interaction states, light + dark themes
#   shots-themes.js  — view tab strip + full-state view rows on all 5 themes
#                      (options/advanced keep ink + paper)
#   shots-i18n.js    — tree/tabs/menus/edit-dialog/options per UI language (8x6)
#   shots-palette.js — the v4 view system: palette table + recent/stats/
#                      dupes/dead views + live dead rescan
#   shots-guide.js   — guide-only states (search dual zone with history,
#                      the options Views group card) for docs/guide-v4*.md
#   shots-tabgroups.js — tab-group surface: folder/bookmark menus, the
#                      new-group dialog (title + 9 colors), the existing-group
#                      picker, plus functional assertions that the SW actually
#                      forms the group / joins it (popup-closing-safe)
# diag/ holds manual diagnostic probes (diag.js, diag-dead.js, diag-v4t3.js),
# run on demand: docker run --rm vbm-smoke:local node /work/diag/diag.js
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
cp "$REPO_ROOT"/scripts/screenshots/{Dockerfile,smoke.js,verify-keyboard.js,verify-scrollbars.js,verify-menu-overflow.js,verify-menu-collapse.js,verify-menu-extreme.js} "$CTX/"
cp -r "$REPO_ROOT"/scripts/screenshots/suites "$CTX/suites"
cp -r "$REPO_ROOT"/scripts/screenshots/diag "$CTX/diag"

docker build -q -t "$IMAGE" "$CTX" >/dev/null
docker run --rm "$IMAGE"
# Real-browser keyboard/view verification (view-system absorption): blocking,
# non-zero exit stops the run. Covers the tab strip's bubble-phase keyboard
# model, focus zones, search dual-zone persistence and per-view rendering —
# Esc chains stay in vitest (see docs/cdp-escape-limitation.md).
docker run --rm "$IMAGE" node /work/verify-keyboard.js
# Layer 2b — scrollbar matrix (blocking): screen × browser-zoom × in-extension
# zoom × popup-size sweep, no horizontal scrollbar on any pane. ~2-3 min.
docker run --rm "$IMAGE" node /work/verify-scrollbars.js
# Layer 2c — context-menu overflow (#48): a tall folder menu must stay open in
# a short viewport (clamped with internal scroll), not be dismissed by the
# focus-induced document scroll. Blocking.
docker run --rm "$IMAGE" node /work/verify-menu-overflow.js
# Layer 2d — collapsed submenus (#48 follow-up): sort collapse shortens the
# folder menu, the flyout opens inside the viewport, dispatch works, and the
# tab-group collapse applies to both menus. Blocking.
docker run --rm "$IMAGE" node /work/verify-menu-collapse.js
# Layer 2e — extreme zoom/resolution menu sweep (#48 follow-up): DPR × page
# zoom × popup size; menus + flyouts must open, stay open and never clip or
# cover their collapse entry. Blocking.
docker run --rm "$IMAGE" node /work/verify-menu-extreme.js
[ "${1:-}" = "--smoke-only" ] && exit 0

for suite in shots.js shots-themes.js shots-i18n.js shots-palette.js shots-guide.js shots-tabgroups.js; do
    name="vbm-shots-$$-${suite%.js}"
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker create --name "$name" "$IMAGE" node "/work/suites/$suite" >/dev/null
    docker start -a "$name"
    docker cp "$name":/tmp/shots/. "$OUT/"
    docker rm "$name" >/dev/null
done
echo "Screenshots written to $OUT"
