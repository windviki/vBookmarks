#!/usr/bin/env bash
# One-time fetch of the store-shot fonts (git-ignored, OFL licensed):
#   Inter        — Inter.ttc static collection (rsms/inter v4.1 release zip)
#   Noto Sans SC — static OTF weights (notofonts/noto-cjk SubsetOTF/SC)
# Static instances, not the variable builds: fontconfig/Chromium on Linux only
# ever resolves a variable font's default instance (wght 400 renders thin and,
# when the file is missing entirely, the suite silently falls back to the base
# image's WenQuanYi Zen Hei — the "ugly CJK" failure mode). Run through the
# usual proxy env; the Dockerfile installs whatever is in this directory into
# the image (fonts absent → suites fall back to system).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Inter: the v4.1 release zip carries Inter.ttc (every static weight in one
# collection; fontconfig reads .ttc fine).
curl -fL --max-time 300 -o "$TMP/inter.zip" \
    "https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip"
python3 - "$TMP/inter.zip" "$DIR" <<'EOF'
import sys, zipfile
zip_path, out_dir = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(zip_path) as z:
    data = z.read("Inter.ttc")
with open(f"{out_dir}/Inter.ttc", "wb") as f:
    f.write(data)
EOF

# Noto Sans SC static weights — Medium 当正文、Bold 当标题粗体。刻意不装
# Regular:UI 字号(12–13px,合成后再缩到 ~8px)下 Regular 笔画发虚,
# 只装 Medium/Bold 后 fontconfig 对 'Noto Sans SC' 的常规字重请求会落到
# 最接近的 Medium —— 中文正文因此更挺括。(试过 family 别名 'Noto Sans SC
# Medium' 引用,Chromium 解析不到,等于没换 —— 只能用缺席 Regular 的方式。)
for w in Medium Bold; do
    curl -fL --max-time 300 -o "$DIR/NotoSansSC-$w.otf" \
        "https://github.com/notofonts/noto-cjk/raw/main/Sans/SubsetOTF/SC/NotoSansSC-$w.otf"
done

# 退役旧的 variable 版本(存在即删,避免 fontconfig 继续命中细默认实例)。
rm -f "$DIR/Inter.ttf" "$DIR/NotoSansSC.ttf"
ls -la "$DIR"
