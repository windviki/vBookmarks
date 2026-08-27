#!/usr/bin/env bash
# One-time fetch of the store-shot fonts (git-ignored, OFL licensed):
#   Inter        — dense-UI Latin (google/fonts, variable)
#   Noto Sans SC — 思源黑体 Google build (google/fonts, variable)
# Run through the usual proxy env; the Dockerfile installs whatever is in
# this directory into the image (fonts absent → suites fall back to system).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR"
curl -fL --max-time 120 -o "$DIR/Inter.ttf" \
    "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf"
curl -fL --max-time 300 -o "$DIR/NotoSansSC.ttf" \
    "https://github.com/google/fonts/raw/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
ls -la "$DIR"
