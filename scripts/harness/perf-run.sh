#!/usr/bin/env bash
# Dedicated perf-only runner — compares ANY extension root (master source,
# master dist, a v4.0.8 worktree) under the SAME probe, without the
# smoke/keyboard/scrollbar layers. The probe file always comes from THIS
# checkout, so both sides measure identical seed logic and phases.
#
#   scripts/harness/perf-run.sh <ext-root> [--dist] [--out <dir>]
#                              [--probe <harness-rel-path>] [--seed <dir>]
#
#   --probe  probe script relative to scripts/harness/ (default
#            perf-popup.js; e.g. diag/diag-perf-user.js — the real-user-
#            data probe)
#   --seed   seed dir copied to /work/seed/ in the container (the real-data
#            probe reads settings-user.json + favorites-user.html from there)
#
# Env knobs (forwarded into the container):
#   VBM_PERF_BOOKMARKS   total bookmarks to seed (default 6000)
#   VBM_PERF_DUP_RATIO   duplicate-copy ratio (default 0.25 — copies land at
#                        FOUR different depths: L3/L2/L1/dups-root)
#   VBM_DUP_COPIES       copies per dup group (default 3; 1 = 2-item groups, 2500+)
#   VBM_PERF_RUNS        popup cold-open runs (default 10)
#   VBM_PERF_DUPES_RUNS  dupes-view activation runs (default 5)
set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "usage: scripts/harness/perf-run.sh <ext-root> [--dist] [--out <dir>] [--probe <path>] [--seed <dir>]" >&2
    exit 2
fi
EXT_ROOT="$(cd "$1" && pwd)"
shift
HERE="$(cd "$(dirname "$0")" && pwd)"
DIST_MODE=0
OUT_DIR=""
PROBE="perf-popup.js"
SEED_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dist) DIST_MODE=1 ;;
        --out) OUT_DIR="$2"; shift ;;
        --probe) PROBE="$2"; shift ;;
        --seed) SEED_DIR="$2"; shift ;;
        *) echo "unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
done
if [[ ! -f "$HERE/$PROBE" ]]; then
    echo "ERROR: probe not found: $HERE/$PROBE" >&2
    exit 2
fi

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

SEED_LINE=""
if [[ -n "$SEED_DIR" ]]; then
    if [[ ! -d "$SEED_DIR" ]]; then
        echo "ERROR: --seed dir not found: $SEED_DIR" >&2
        exit 2
    fi
    SEED_DIR="$(cd "$SEED_DIR" && pwd)"
    mkdir -p "$CTX/seed"
    cp -r "$SEED_DIR"/. "$CTX/seed/"
    SEED_LINE="COPY seed /work/seed/"
fi

cat > "$CTX/Dockerfile" <<DOCKER
FROM zenika/alpine-chrome:with-puppeteer
ENV NODE_PATH=/usr/src/app/node_modules
COPY vBookmarks /ext
COPY probe.js /work/probe.js
${SEED_LINE}
WORKDIR /work
CMD ["node", "/work/probe.js"]
DOCKER

cp "$HERE/$PROBE" "$CTX/probe.js"
docker build -q -t "$IMAGE" "$CTX" >/dev/null

ENV_ARGS=()
for k in VBM_PERF_MODE VBM_PERF_BOOKMARKS VBM_PERF_DUP_RATIO VBM_DUP_COPIES VBM_PERF_RUNS VBM_PERF_DUPES_RUNS VBM_PERF_SETTLE_MS VBM_PERF_PROFILE VBM_PERF_TRACE VBM_PERF_VIRTUAL VBM_PERF_NO_TREETAILS; do
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
docker create --name "$NAME" "${ENV_ARGS[@]}" "$IMAGE" node /work/probe.js >/dev/null
docker start -a "$NAME"
code=$?
docker cp "$NAME":/tmp/shots/perf/. "$OUT_DIR/" 2>/dev/null || true
docker rm "$NAME" >/dev/null
exit "$code"
