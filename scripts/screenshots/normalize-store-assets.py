#!/usr/bin/env python3
"""normalize-store-assets.py — 把 assets/store/ 的上传图片规范化到 CWS 规格。

对清单里的每张图:
  1. 校验精确尺寸(截图一律 1280×800;小型宣传图块 440×280;marquee 1400×560);
  2. RGBA → RGB 扁平化(CWS 要求 24 位 PNG 无 alpha):以图的左上角色
     (各合成页自身的底色,全画幅铺满)为底做 alpha 合成,可见像素不变;
  3. 覆写为 optimize 的 RGB PNG。

任一张尺寸不符即报错退出(exit 1)—— 尺寸问题必须回 shots-store.js 修版式,
而不是在这里拉伸变形。

依赖 Pillow(发版维护者本机工具;pip install Pillow)。纯校验门禁另见
scripts/webstore/publish.js listing-draft(pngInfo,无需 Pillow)。
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("✖ 需要 Pillow:pip install Pillow(或用仓库 .venv 的 python3)")

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
STORE = REPO_ROOT / "assets" / "store"

# 与 scripts/webstore/publish.js 的 UPLOAD_ROSTER 对齐;themes 是候选图
# (商店截图最多五张,不上传它时无需理会),存在即同样规范化。
ROSTER = [
    ("vBookmarks-promo.png", "截图 1 · 入口总览", 1280, 800, True),
    ("vBookmarks-promo2.png", "截图 2 · 暂存工作台", 1280, 800, True),
    ("vBookmarks-promo3.png", "截图 3 · 清理(死链/重复)", 1280, 800, True),
    ("vBookmarks-strip.png", "截图 4 · 四主题", 1280, 800, True),
    ("vBookmarks-options.png", "截图 5 · 设置全景", 1280, 800, True),
    ("vBookmarks-tile-small.png", "小型宣传图块", 440, 280, True),
    ("vBookmarks-marquee.png", "顶部宣传图块", 1400, 560, True),
    ("vBookmarks-themes.png", "候选 · 双主题 split", 1280, 800, False),
]


def normalize(path: Path, width: int, height: int, label: str) -> bool:
    """规范化单张图。返回是否通过(尺寸不符返回 False)。"""
    im = Image.open(path)
    im.load()
    if im.size != (width, height):
        print(f"  ✗ {path.name} — {im.size[0]}×{im.size[1]} ≠ {width}×{height}"
              f"({label})— 回 shots-store.js 修版式,不做拉伸")
        return False
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        rgba = im.convert("RGBA")
        bg = Image.new("RGBA", rgba.size, rgba.getpixel((0, 0))[:3] + (255,))
        flat = Image.alpha_composite(bg, rgba).convert("RGB")
        flat.save(path, "PNG", optimize=True)
        print(f"  ✓ {path.name} — {width}×{height},alpha 已扁平化为 RGB({label})")
    else:
        im.convert("RGB").save(path, "PNG", optimize=True)
        print(f"  ✓ {path.name} — {width}×{height} RGB({label})")
    return True


def main() -> int:
    failures = 0
    for name, label, width, height, required in ROSTER:
        path = STORE / name
        if not path.exists():
            if required:
                print(f"  ✗ {name} — 缺失({label},需 {width}×{height});"
                      f"先跑 scripts/screenshots/update-store-assets.sh")
                failures += 1
            continue
        if not normalize(path, width, height, label):
            failures += 1
    if failures:
        print(f"\n✗ {failures} 张不合规")
        return 1
    print("\n全部合规(尺寸精确 + RGB 无 alpha)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
