#!/usr/bin/env bash
# Re-shoot the WebStore image candidates (shots-store.js) and sync the six
# composites into assets/store/. Release Step 1 companion: run whenever the
# visuals touched by the release affect the captured views, BEFORE tagging —
# the store images ship from this repo, so they must match the tagged code.
# Requires the local font downloads (scripts/screenshots/fonts/fetch.sh) for
# the Inter / Noto Sans SC typography; without them the shots still work but
# fall back to the base image's CJK font.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
"$REPO_ROOT/scripts/harness/rerun.sh" shots-store.js
for f in strip promo promo2 promo3 themes options; do
    cp "$REPO_ROOT/tmp/shots/store/$f.png" "$REPO_ROOT/assets/store/vBookmarks-$f.png"
done
echo "Store assets synced to assets/store/ — review the diff, then commit together with the release."
