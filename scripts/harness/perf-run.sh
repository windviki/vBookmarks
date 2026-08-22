#!/usr/bin/env bash
# Dedicated perf-only runner — compares ANY extension root (master source,
# master dist, a v4.0.8 worktree) under the SAME probe, without the
# smoke/keyboard/scrollbar layers. The probe file always comes from THIS
# checkout, so both sides measure identical seed logic and phases.
#
#   scripts/harness/perf-run.sh <ext-root> [--dist] [--out <dir>]
#
# Env knobs (forwarded into the container):
#   VBM_PERF_BOOKMARKS   total bookmarks to seed (default 6000)
#   VBM_PERF_DUP_RATIO   duplicate-copy ratio (default 0.25 — copies land at
#                        FOUR different depths: L3/L2/L1/dups-root)
#   VBM_PERF_RUNS        popup cold-open runs (default 10)
#   VBM_PERF_DUPES_RUNS  dupes-view activation runs (default 5)
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "usage: scripts/harness/perf-run.sh <ext-root> [--dist] [--out <dir>]" >&2
    exit 2
fi
EXT_ROOT="$(cd "$1" && pwd)"
shift
DIST_MODE=0
OUT_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dist) DIST_MODE=1 ;;
        --out) OUT_DIR="$2"; shift ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
done

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$REPO_ROOT/tmp/perf}"
CTX="$(mktemp -d /tmp/vbm-perf-ctx.XXXXXX)"
IMAGE="vbm-perf:local"
NAME="vbm-perf-$$"

cleanup() { rm -rf "$CTX"; }
trap cleanup EXIT

mkdir -p "$CTX/vBookmarks" "$OUT_DIR"
if [[ "$DIST_MODE" == "1" ]]; then
    if [[ ! -f "$EXT_ROOT/manifest.json" ]]; then
        echo "ERROR: --dist root has no manifest.json: $EXT_ROOT" >&2
        exit 1
    fi
    (cd "$EXT_ROOT" && tar cf - .) | tar xf - -C "$CTX/vBookmarks"
else
    (cd "$EXT_ROOT" && tar cf - --exclude=./.git --exclude=./node_modules --exclude=./tmp --exclude=./dist --exclude=./.env --exclude=./.claude --exclude=./.qoder .) \
        | tar xf - -C "$CTX/vBookmarks"
fi

cat > "$CTX/Dockerfile" <<'DOCKER'
FROM zenika/alpine-chrome:with-puppeteer
ENV NODE_PATH=/usr/src/app/node_modules
COPY vBookmarks /ext
COPY perf-popup.js /work/
WORKDIR /work
CMD ["node", "/work/perf-popup.js"]
DOCKER

cp "$HERE/perf-popup.js" "$CTX/perf-popup.js"
docker build -q -t "$IMAGE" "$CTX" >/dev/null

ENV_ARGS=()
for k in VBM_PERF_MODE VBM_PERF_BOOKMARKS VBM_PERF_DUP_RATIO VBM_PERF_RUNS VBM_PERF_DUPES_RUNS VBM_PERF_SETTLE_MS; do
    if [[ -n "${!k:-}" ]]; then
        ENV_ARGS+=(-e "$k=${!k}")
    fi
done
if [[ "$DIST_MODE" == "1" ]]; then
    ENV_ARGS+=(-e "VBM_PERF_MODE=dist")
else
    ENV_ARGS+=(-e "VBM_PERF_MODE=source")
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker create --name "$NAME" "${ENV_ARGS[@]}" "$IMAGE" node /work/perf-popup.js >/dev/null
docker start -a "$NAME"
code=$?
docker cp "$NAME":/tmp/shots/perf/. "$OUT_DIR/" 2>/dev/null || true
docker rm "$NAME" >/dev/null
exit "$code"
