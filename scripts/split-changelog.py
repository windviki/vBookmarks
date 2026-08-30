#!/usr/bin/env python3
"""One-off (2026-08-30): split the pre-4.0 changelog out of both READMEs.

4.0+ entries stay full-text in the READMEs; every older version's release
note moves to its own file under docs/changelog/ (EN: vX.Y.md, ZH:
vX.Y.zh.md — the repo's language-suffix convention), and the README keeps a
table (version / date / link). The trailing "Attentions" section is dropped
per maintainer request. Old announce/donation anchors (#v4xx) are unaffected:
4.0+ entries stay in the READMEs.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
CHLOG = DOCS / 'changelog'
CHLOG.mkdir(exist_ok=True)

SPECS = [
    {
        'readme': DOCS / 'README.md',
        'lang': 'en',
        'old_start': '### v3.7',
        'attentions': '# Attentions',
        'dev_old': """# Release zip (version read from manifest.json)
python3 scripts/package.py         # \u2192 tmp/vBookmarks_<version>.zip""",
        'dev_new': """# Release build & store zip (version read from manifest.json; esbuild bundle + Terser into dist/)
npm run build                     # \u2192 dist/ (build-time self-checks included)
npm run package                   # build + zip \u2192 tmp/vBookmarks_<version>.zip
python3 scripts/package.py --root dist   # zip an existing dist/ (no rebuild)""",
        'table_title': '### Earlier versions (pre-4.0)',
        'table_intro': "Each release note lives in its own file under [`docs/changelog/`](changelog/) (Chinese: the `.zh.md` twin). Newer entries may migrate into that table over time \u2014 the files are the permalink home for shipped release notes.",
        'cols': ('Version', 'Date', 'Changelog'),
    },
    {
        'readme': DOCS / 'README.zh.md',
        'lang': 'zh',
        'old_start': '### v3.7',
        'attentions': '# 注意事项',
        'dev_old': """# 发布打包（版本号读自 manifest.json）
python3 scripts/package.py         # \u2192 tmp/vBookmarks_<版本>.zip""",
        'dev_new': """# 发布构建与商店 zip（版本号读自 manifest.json；esbuild 打包 + Terser 压缩进 dist/）
npm run build                     # \u2192 dist/（含构建期自检）
npm run package                   # 构建 + 打 zip \u2192 tmp/vBookmarks_<版本>.zip
python3 scripts/package.py --root dist   # 对已有 dist/ 直接打 zip（不重建）""",
        'table_title': '### 更早的版本（4.0 之前）',
        'table_intro': "每个版本的发布说明独立成文件，放在 [`docs/changelog/`](changelog/)（中文为 `.zh.md` 同名文件）。后续版本也可能逐步迁入本表——该目录是已发布版本说明的永久链接归宿。",
        'cols': ('版本', '发布时间', '更新日志'),
    },
]

DATE_RE = re.compile(r'^\*(\d{4}-\d{2}-\d{2})\*\s*$', re.M)

for spec in SPECS:
    text = spec['readme'].read_text(encoding='utf-8')

    # 1) developer packaging block
    assert spec['dev_old'] in text, f"dev block not found in {spec['readme'].name}"
    text = text.replace(spec['dev_old'], spec['dev_new'])

    # 2) split the pre-4.0 changelog + trailing attentions
    start = text.index(spec['old_start'])
    att = text.index(spec['attentions'])
    old_block = text[start:att].rstrip() + '\n'
    tail_after_attentions = text[att:]
    # keep anything after the attentions section? (the store link line moves
    # nowhere per maintainer: the section is deleted wholesale)
    _ = tail_after_attentions

    # 3) per-version files
    parts = re.split(r'(?m)^(?=### )', old_block)
    rows = []
    for part in parts:
        if not part.startswith('### '):
            continue
        ver = part[4:part.index('\n')].strip()
        m = DATE_RE.search(part)
        date = m.group(1) if m else ''
        slug = ver  # v3.7 etc.
        suffix = '.zh.md' if spec['lang'] == 'zh' else '.md'
        fname = f'{slug}{suffix}'
        header = (f'# Changelog \u2014 {ver}\n\n' if spec['lang'] == 'en'
                  else f'# 更新日志 \u2014 {ver}\n\n')
        note = ('> Moved verbatim from `docs/README.md` (2026-08-30 restructure); '
                '4.0-and-later entries remain in the README.\n\n' if spec['lang'] == 'en'
                else '> 2026-08-30 整理时自 `docs/README.zh.md` 原文迁出；4.0 及之后的条目仍保留在 README 内。\n\n')
        (CHLOG / fname).write_text(header + note + part.rstrip() + '\n', encoding='utf-8')
        rows.append((ver, date, fname))

    # 4) the table replacing the old block
    v, d, c = spec['cols']
    lines = [
        spec['table_title'],
        '',
        spec['table_intro'],
        '',
        f'| {v} | {d} | {c} |',
        '| --- | --- | --- |',
    ]
    for ver, date, fname in rows:
        lines.append(f'| [{ver}](changelog/{fname}) | {date} | [release notes](changelog/{fname}) |')
    lines.append('')
    text = text[:start] + '\n'.join(lines) + '\n'

    spec['readme'].write_text(text, encoding='utf-8')
    print(f"{spec['readme'].name}: {len(rows)} version files -> docs/changelog/, attentions dropped")

# cross-check: every en file has a zh twin
en = sorted(p.name for p in CHLOG.glob('v*.md') if not p.name.endswith('.zh.md'))
zh = sorted(p.name.replace('.zh.md', '.md') for p in CHLOG.glob('v*.zh.md'))
assert en == zh, f'language twins mismatch: {set(en) ^ set(zh)}'
print(f'changelog/ holds {len(en)} EN + {len(zh)} ZH files, aligned')
