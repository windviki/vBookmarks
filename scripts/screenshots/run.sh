#!/usr/bin/env bash
# vBookmarks visual capture — Docker, screenshots ONLY.
#
# Builds the shared harness image (scripts/harness/Dockerfile) with the
# extension baked in, then runs ONLY the screenshot suites into tmp/shots/
# (git-ignored). The real-browser verify gate is a separate concern — that is
# scripts/harness/run.sh.
#
#   shots.js         — 11 interaction states, light + dark themes
#   shots-matrix.js  — 4 themes (light/dark/ink/paper) × the full surface:
#                      six views, bookmark/folder menus + their collapsed
#                      flyouts, edit/new-folder/sort/confirm dialogs, wide
#                      (640) + narrow (280) popup variants, options (top /
#                      backup / styles), side panel — 21 shots per theme
#   shots-i18n.js    — tree/tabs/menus/flyouts/dialogs/options per UI
#                      language (7 × 15, light)
#   shots-palette.js — the v4 view system: palette table + recent/stats/
#                      dupes/dead views + live dead rescan
#   shots-guide.js   — guide-only states (search dual zone with history,
#                      the options Views group card) for docs/guide-v4*.md
#   shots-tabgroups.js — tab-group surface: folder/bookmark menus, the
#                      new-group dialog (title + 9 colors), the existing-group
#                      picker, plus functional assertions that the SW actually
#                      forms the group / joins it (popup-closing-safe)
#   shots-tabgroups-view.js — the tab-groups VIEW (4.1.0): current-window
#                      tabs + groups, selection mode, group-head context menu
#   shots-store.js    — WebStore assets: five 1280×800 screenshots (promo
#                      sheets / four-theme strip / options panorama) + spare
#                      themes split + brand marquee 1400×560 + small tile 440×280
#
# Usage: scripts/screenshots/run.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CTX="$(mktemp -d /tmp/vbm-shots-ctx.XXXXXX)"
OUT="$REPO_ROOT/tmp/shots"
IMAGE="vbm-smoke:local"

cleanup() { rm -rf "$CTX"; }
trap cleanup EXIT

mkdir -p "$CTX/vBookmarks" "$OUT"
(cd "$REPO_ROOT" && tar cf - --exclude=./.git --exclude=./node_modules --exclude=./tmp --exclude=./.env --exclude=./.claude --exclude=./.env.example .) \
    | tar xf - -C "$CTX/vBookmarks"
cp "$REPO_ROOT"/scripts/harness/{Dockerfile,smoke.js,verify-keyboard.js,verify-scrollbars.js,verify-menu-overflow.js,verify-menu-collapse.js,verify-menu-extreme.js,verify-menu-overlong.js,verify-rightclick-repeat.js,verify-bmlet.js,perf-popup.js} "$CTX/"
cp "$REPO_ROOT"/scripts/screenshots/{shots.js,shots-matrix.js,shots-i18n.js,shots-palette.js,shots-guide.js,shots-tabgroups.js,shots-tabgroups-view.js,shots-store.js} "$CTX/"
mkdir -p "$CTX/fonts"
if [ -d "$REPO_ROOT/scripts/screenshots/fonts" ]; then
    cp -r "$REPO_ROOT"/scripts/screenshots/fonts/. "$CTX/fonts/"
fi
cp -r "$REPO_ROOT"/scripts/harness/diag "$CTX/diag"

docker build -q -t "$IMAGE" "$CTX" >/dev/null

for suite in shots.js shots-matrix.js shots-i18n.js shots-palette.js shots-guide.js shots-tabgroups.js shots-tabgroups-view.js shots-store.js; do
    name="vbm-shots-$$-${suite%.js}"
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker create --name "$name" "$IMAGE" node "/work/$suite" >/dev/null
    docker start -a "$name"
    docker cp "$name":/tmp/shots/. "$OUT/"
    docker rm "$name" >/dev/null
done
echo "Screenshots written to $OUT"
