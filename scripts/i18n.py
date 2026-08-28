#!/usr/bin/env python3
"""
Unified i18n tool for vBookmarks (replaces sync_locales.py + check_translations.py).

Subcommands:
  audit     Scan code for i18n key references; report undefined / unreferenced
            keys and classify every key by usage context (menu/dialog/option/
            manifest/ui).
  missing   Report per-locale missing / untranslated ([TODO:key]) / extra keys
            against the en baseline.
  translate Translate missing + [TODO:] keys through an LLM (one request per
            locale, chunked at 40 keys) and write locale files back.
  verify    Full check: key-set alignment, placeholder integrity, menu-item
            length overflow. --fix shortens overflowing menu items via LLM.

LLM configuration (translate / verify --fix):
  VBM_LLM_BASE_URL  default https://api.moonshot.cn/v1
  VBM_LLM_API_KEY   required; clear error when unset
  VBM_LLM_MODEL     default kimi-k2-0905-preview
  VBM_LLM_API_TYPE  'openai' (default, /chat/completions + Bearer) or
                    'anthropic_messages' (/v1/messages + x-api-key)
  All four may also live in a git-ignored .env file at the repo root
  (KEY=VALUE lines); real environment variables win over .env values.

Usage:
  python3 scripts/i18n.py audit [--verbose]
  python3 scripts/i18n.py missing [--locale fr] [--json]
  python3 scripts/i18n.py translate [--locale fr] [--dry-run | --apply]
  python3 scripts/i18n.py verify [--locale fr] [--fix] [--strict]
"""

import argparse
import glob
import json
import os
import re
import sys
import urllib.error
import urllib.request

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
LOCALES_DIR = os.path.join(REPO_ROOT, '_locales')
EN_LOCALE = 'en'


def load_dotenv():
    """Minimal .env loader (KEY=VALUE lines, # comments); existing
    environment variables always win. Silently ignored when absent."""
    path = os.path.join(REPO_ROOT, '.env')
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#') or '=' not in line:
                    continue
                key, _, value = line.partition('=')
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


load_dotenv()

# ---------------------------------------------------------------------------
# Key usage classification (audit output; translate prompt; verify length check)
# Rules are evaluated top to bottom, first hit wins; unmatched keys fall back
# to 'ui'. A key is classified 'menu' when it is referenced in
# src/context-menu.js OR mapped (via the Object.entries id->key table in
# src/neat.js) to an element id that appears as a menu item inside a <menu>
# block of pages/*.html.
# ---------------------------------------------------------------------------
MENU_SOURCE_FILES = {'src/context-menu.js'}
DIALOG_SOURCE_FILES = {'src/dialogs.js'}
OPTION_SOURCE_FILES = {
    'src/options.js', 'src/advanced-options.js',
    'pages/options.html', 'pages/advanced-options.html',
}
MANIFEST_SOURCE_FILES = {'manifest.json'}
CATEGORY_ORDER = ('menu', 'dialog', 'option', 'manifest', 'ui')
CATEGORY_LABELS_ZH = {
    'menu': '右键菜单项',
    'dialog': '对话框文本',
    'option': '设置选项',
    'manifest': '扩展清单描述',
    'ui': '一般界面元素',
}

# Menu-item length limits (same thresholds as the old check_translations.py)
UI_MAX_LEN = 35       # Latin script
UI_MAX_LEN_CJK = 18   # CJK-dominated strings (~2x wider glyphs)

# Locales whose translations are expected to use a non-Latin script; a
# message byte-identical to en there is flagged as "suspect untranslated".
NON_LATIN_LOCALES = {
    'ar', 'he', 'el', 'th', 'hi', 'bn', 'fa',
    'ja', 'ko', 'zh', 'zh_CN', 'zh_HK', 'zh_TW',
    'ru', 'uk', 'bg', 'mk',
}

# Keys that legitimately stay byte-identical to en in every locale: brand
# name, the word "URL" as a UI term, and a pure "$1 / $2" usage-count format.
# They are NOT "suspect untranslated" and must not be flagged as such.
SUSPECT_ALLOWLIST = {
    'extName',
    'url',
    'paletteCustomUrl',
    'paletteCustomUsage',
    # velvet staging: the format names themselves are universal technical
    # terms — "Markdown" and "JSON" are not translated in any locale.
    'folderCopyMarkdown',
    'folderCopyJson',
    # 2026-08-28 审阅轮扩充：品牌/链接文字与技术词在多数语言保留原形
    # （fr/es 等已真正翻译的 locale 不会 == en，不受影响）。
    'optionsGithubLink',   # the visible link text is just "GitHub"
    'versionDialogTitle',  # "vBookmarks" brand
    'versionMetaOS',       # "OS:" value label
    'versionMetaUserAgent',
    'optionZoom',          # "Zoom"
    'deadPause',           # "Pause"
    'favSrcProxy',         # "Proxy"
    'deadProxyLabel',      # "Proxy: $server$" (prefix untranslated by convention)
    'stagingShortcutAlias',  # "Alias"
    'optionLanguageAuto',  # "auto" enum-style value
    'favSrcDirect',        # "Direct"
}

# 2026-08-28 审阅轮新增机检 --------------------------------------------------
# 1) 串语检测：这些 locale 之外的 messages 出现 CJK 统一表文字即 ERROR
#    （th/vi/id/tr 曾整句混入中文——verify 当时只查占位符与长度，全放行了）。
CJK_SCRIPT_LOCALES = {'zh', 'zh_CN', 'zh_HK', 'zh_TW', 'ja'}
CJK_CHAR_RE = re.compile(r'[\u4e00-\u9fff]')
# 2) 简繁检测：zh_TW/zh_HK 里出现简体专属字形即 ERROR（当轮 25+ 键中招）。
#    只列简繁字形确实不同的常用对，避免简繁同形字误报。
SIMPLIFIED_TRADITIONAL_PAIRS = (
    '暂暫 删刪 设設 为為 后後 记記 区區 线線 击擊 选選 环環 闭閉 从從 发發'
    '变變 见見 观觀 规規 检檢 体體 备備 书書 档檔 页頁 签簽 开開 问問 题題'
    '访訪 统統 项項 组組 视視 隐隱 认認 样樣 边邊 门門 过過 还還 进進 当當'
    '执執 扫掃 测測 类類 无無 标標 读讀 怀懷 号號 码碼 单單 张張 级級 联聯'
    '时時 间間 风風 终終 语語 华華 层層 浅淺 识識 货貨 复復 确确 个個'
).split()

def simplified_hits(text):
    hits = []
    for pair in SIMPLIFIED_TRADITIONAL_PAIRS:
        s = pair[0]
        if s in text:
            hits.append(s)
    return hits

# locale -> language name used in the translation prompt
LOCALE_NAMES = {
    'ar': '阿拉伯语（Arabic）',
    'bg': '保加利亚语（Bulgarian）',
    'bn': '孟加拉语（Bengali）',
    'cs': '捷克语（Czech）',
    'da': '丹麦语（Danish）',
    'de': '德语（German）',
    'el': '希腊语（Greek）',
    'en': '英语（English）',
    'es': '西班牙语（Spanish）',
    'et': '爱沙尼亚语（Estonian）',
    'fa': '波斯语（Persian）',
    'fi': '芬兰语（Finnish）',
    'fr': '法语（French）',
    'he': '希伯来语（Hebrew）',
    'hi': '印地语（Hindi）',
    'hr': '克罗地亚语（Croatian）',
    'hu': '匈牙利语（Hungarian）',
    'id': '印度尼西亚语（Indonesian）',
    'it': '意大利语（Italian）',
    'ja': '日语（Japanese）',
    'ko': '韩语（Korean）',
    'lt': '立陶宛语（Lithuanian）',
    'lv': '拉脱维亚语（Latvian）',
    'mk': '马其顿语（Macedonian）',
    'nl': '荷兰语（Dutch）',
    'no': '挪威语（Norwegian）',
    'pl': '波兰语（Polish）',
    'pt': '葡萄牙语（Portuguese）',
    'pt_BR': '巴西葡萄牙语（Brazilian Portuguese）',
    'pt_PT': '欧洲葡萄牙语（European Portuguese）',
    'ro': '罗马尼亚语（Romanian）',
    'ru': '俄语（Russian）',
    'sk': '斯洛伐克语（Slovak）',
    'sl': '斯洛文尼亚语（Slovenian）',
    'sv': '瑞典语（Swedish）',
    'th': '泰语（Thai）',
    'tr': '土耳其语（Turkish）',
    'uk': '乌克兰语（Ukrainian）',
    'vi': '越南语（Vietnamese）',
    'zh': '简体中文（Simplified Chinese）',
    'zh_CN': '简体中文（中国大陆，Simplified Chinese）',
    'zh_HK': '繁体中文（香港，Traditional Chinese）',
    'zh_TW': '繁体中文（台湾，Traditional Chinese）',
}

# ---------------------------------------------------------------------------
# LLM configuration & prompts (Chinese by design; edit here when tuning)
# ---------------------------------------------------------------------------
LLM_BASE_URL_ENV = 'VBM_LLM_BASE_URL'
LLM_API_KEY_ENV = 'VBM_LLM_API_KEY'
LLM_MODEL_ENV = 'VBM_LLM_MODEL'
LLM_API_TYPE_ENV = 'VBM_LLM_API_TYPE'
LLM_DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1'
LLM_DEFAULT_MODEL = 'kimi-k2-0905-preview'
LLM_DEFAULT_API_TYPE = 'openai'  # or 'anthropic_messages'
LLM_TIMEOUT = 120          # seconds
LLM_RETRIES = 2            # retries after the first failed attempt
TRANSLATE_CHUNK_SIZE = 40  # max keys per LLM request

PROMPT_SYSTEM = (
    '你是一名专业的软件本地化翻译专家，精通多国语言，'
    '熟悉浏览器扩展产品的界面文案风格，译文准确、精炼、地道。'
)

# 2026-08-28 翻译审阅轮定案的术语表：staging 在各语言的既定译法（维护者人工
# 校订）。translate 时拼进 prompt——上次大面积"舞台/剧本/试验阶段"错译与
# 同 locale 多键漂移的根因就是缺这张表。新增语言/改译法时同步维护这里。
STAGING_TERMS = {
    'fr': 'zone de préparation', 'es': 'área de preparación',
    'it': 'area di preparazione', 'pt': 'área de preparação',
    'pt_BR': 'área de preparação', 'pt_PT': 'área de preparação',
    'de': 'Staging-Bereich', 'nl': 'wachtruimte',
    'ru': 'область подготовки', 'uk': 'область підготовки',
    'pl': 'poczekalnia', 'ar': 'منطقة الإعداد',
    'bg': 'подготвителна зона', 'el': 'περιοχή προετοιμασίας',
    'he': 'אזור ההכנה', 'tr': 'hazırlık alanı',
    'lt': 'paruošimo sritis', 'lv': 'sagatavošanas zona',
    'mk': 'подготвителна зона', 'hr': 'pripremno područje',
    'hu': 'előkészítő terület', 'ro': 'zona de pregătire',
    'da': 'staging-området', 'sv': 'mellanlagringen',
    'fi': 'odotusalue', 'et': 'ooteala', 'fa': 'منطقه موقت',
    'id': 'area penampungan', 'vi': 'vùng chờ',
    'th': 'พื้นที่จัดเตรียม', 'bn': 'স্টেজিং', 'hi': 'स्टेजिंग',
    'zh': '暂存区', 'zh_CN': '暂存区', 'zh_HK': '暫存區', 'zh_TW': '暫存區',
    'cs': 'staging', 'sk': 'staging', 'no': 'staging-området',
    'ja': 'ステージング', 'ko': '스테이징',
}

PROMPT_USER_TEMPLATE = """以下是 Chrome 书签管理扩展 vBookmarks 的界面文案，请从英文翻译为{language}。

下面以 JSON 数组逐条给出待翻译条目，每项包含：key（键名）、english（英文原文）、category（用途类别：右键菜单项 / 对话框文本 / 设置选项 / 扩展清单描述 / 一般界面元素）；右键菜单项额外带 budget（字符上限，CJK 文字减半），译文必须在 budget 之内。

翻译要求：
1. 输出语言只能是{language}——严禁输出中文、英文或任何第三种语言（品牌 vBookmarks、以及 Proxy / Zoom / Alias / Markdown / JSON 这类目标语言惯例保留的技术词除外）。
2. 术语必须遵循下表（本扩展的核心概念，已人工定案；同批所有条目必须使用同一译法）：
   - staging（暂存区/工作台概念）= {staging_term}
   - tab group = 目标语言中 Chrome 浏览器的官方术语
   - separator = 目标语言中的"分隔线/分隔符"术语；bookmark 一律按"书签"概念翻译，不得译成"收藏/favorite"
3. 准确但精炼，符合目标语言的软件界面表达习惯。
4. 右键菜单项必须短促：不超过 budget 字符（参考英文原文长度）。
5. 设置选项与对话框文本可自然完整，但避免冗余。
6. 大小写遵循目标语言惯例：非英语语言一律句式大小写（仅句首/专有名词大写），严禁模仿英文 Title Case。
7. {script_note}保留 $name$、$1 等占位符原样不动，不得翻译、改写或增删；品牌名 vBookmarks 不翻译。
8. 输出严格的 JSON 对象，格式为 {{"key": "译文", ...}}，键集合必须与输入完全一致；不要输出任何其他内容（不要解释、不要使用 Markdown 代码块）。

待翻译条目（JSON 数组）：
{items}
"""

# zh_TW/zh_HK 批次附加的字形叮嘱（2026-08-28 简繁混排事故后常驻）
SCRIPT_NOTES = {
    'zh_TW': '必须使用台湾正体字形与用语（暂存/刪除/新增/分隔線/設定/書籤），严禁任何简体字形（暂→暫、删→刪、添加→新增、分隔符→分隔線）；',
    'zh_HK': '必須使用香港繁體字形與用語，嚴禁任何簡體字形；',
}

PROMPT_SHORTEN_TEMPLATE = """以下是 Chrome 书签管理扩展 vBookmarks 的右键菜单项文案（{language}），现有译文过长，超出了菜单宽度限制，需要缩短。

下面以 JSON 数组给出条目，每项包含：key（键名）、english（英文原文）、current（当前译文）。

要求：
1. 在保持含义的前提下缩短译文，每条不超过 {max_len} 个字符。
2. 保留 $name$、$1 等占位符原样不动。
3. 品牌名 vBookmarks 不翻译。
4. 输出严格的 JSON 对象，格式为 {{"key": "缩短后的译文", ...}}，键集合必须与输入完全一致；不要输出任何其他内容。

待缩短条目（JSON 数组）：
{items}
"""

# ---------------------------------------------------------------------------
# Basic IO helpers
# ---------------------------------------------------------------------------

def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    """Write messages.json: UTF-8, keep dict key order, trailing newline
    (same shape the old sync script produced)."""
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def locale_dirs():
    return sorted(d for d in os.listdir(LOCALES_DIR)
                  if os.path.isdir(os.path.join(LOCALES_DIR, d)) and d != EN_LOCALE)


def load_en():
    return load_json(os.path.join(LOCALES_DIR, EN_LOCALE, 'messages.json'))


def load_locale(loc):
    return load_json(os.path.join(LOCALES_DIR, loc, 'messages.json'))


def is_todo_message(msg):
    return msg.startswith('[TODO:')


def is_cjk(s):
    """True when over 30% of chars are CJK/hiragana/katakana/hangul
    (same heuristic as the old check_translations.py)."""
    cjk = sum(1 for c in s if '一' <= c <= '鿿'
              or '぀' <= c <= 'ゟ'
              or '゠' <= c <= 'ヿ'
              or '가' <= c <= '힯')
    return cjk > len(s) * 0.3


def max_len_for(text):
    return UI_MAX_LEN_CJK if is_cjk(text) else UI_MAX_LEN


# ---------------------------------------------------------------------------
# Reference scanning (audit)
# ---------------------------------------------------------------------------
# _m('key') / __m('key') / chrome.i18n.getMessage('key') with a string-literal
# first argument (may span lines).
CALL_RE = re.compile(r"""(?<![\w$])(?:__m|_m|getMessage)\s*\(\s*(['"])([\w@-]+)\1""")
# Same calls with a non-literal first argument (dynamic key; reported only
# under --verbose, never an error).
DYNAMIC_CALL_RE = re.compile(r"""(?<![\w$])(?:__m|_m|getMessage)\s*\(\s*([^'"\s)][^,)\n]*)""")
# __MSG_key__ tokens in manifest.json / css / html (skip __MSG_@@bidi_*).
MSG_TOKEN_RE = re.compile(r'__MSG_([A-Za-z0-9_@]+)__')
# The Object.entries({ 'element-id': 'messageKey', ... }) table in
# src/neat.js that binds menu/dialog element ids to message keys.
NEAT_TABLE_RE = re.compile(r'Object\.entries\(\{(.*?)\}\)', re.S)
NEAT_PAIR_RE = re.compile(r"'([^']+)'\s*:\s*'([^']+)'")
# <menu ...> ... </menu> blocks in pages/*.html; every id inside counts as a
# menu item id.
MENU_BLOCK_RE = re.compile(r'<menu\b[^>]*>(.*?)</menu>', re.S)
HTML_ID_RE = re.compile(r'id="([^"]+)"')


def source_files():
    """Files scanned for i18n references, repo-root-relative, sorted."""
    pats = ['src/**/*.js', 'pages/*.html', 'css/*.css', 'manifest.json']
    files = []
    for pat in pats:
        files.extend(glob.glob(os.path.join(REPO_ROOT, pat), recursive=True))
    return sorted(os.path.relpath(f, REPO_ROOT) for f in files)


def scan_references(files):
    """Return (refs, dynamic_calls).
    refs:          key -> list of dicts {file, line, kind, element_id?}
                   kind: 'call' | 'msg_token' | 'id_map'
    dynamic_calls: list of dicts {file, line, expr} (unresolvable statically)
    """
    refs = {}
    dynamic = []

    def add(key, file, lineno, kind, element_id=None):
        entry = {'file': file, 'line': lineno, 'kind': kind}
        if element_id is not None:
            entry['element_id'] = element_id
        refs.setdefault(key, []).append(entry)

    for rel in files:
        path = os.path.join(REPO_ROOT, rel)
        with open(path, encoding='utf-8') as f:
            text = f.read()
        for m in CALL_RE.finditer(text):
            add(m.group(2), rel, text.count('\n', 0, m.start()) + 1, 'call')
        for m in MSG_TOKEN_RE.finditer(text):
            token = m.group(1)
            if token.startswith('@@'):
                continue
            add(token, rel, text.count('\n', 0, m.start()) + 1, 'msg_token')
        if rel.endswith('.js'):
            for m in DYNAMIC_CALL_RE.finditer(text):
                expr = m.group(1).strip()
                if expr:
                    dynamic.append({
                        'file': rel,
                        'line': text.count('\n', 0, m.start()) + 1,
                        'expr': expr,
                    })
        if rel == 'src/neat.js':
            for block in NEAT_TABLE_RE.finditer(text):
                # drop // line comments so commented-out entries are ignored
                block_text = re.sub(r'//[^\n]*', '', block.group(1))
                for pm in NEAT_PAIR_RE.finditer(block_text):
                    element_id, key = pm.group(1), pm.group(2)
                    add(key, rel,
                        text.count('\n', 0, block.start(1) + pm.start()) + 1,
                        'id_map', element_id=element_id)
    return refs, dynamic


def find_menu_item_ids(files):
    """Element ids appearing inside <menu> blocks of pages/*.html."""
    ids = set()
    for rel in files:
        if not rel.startswith('pages/') or not rel.endswith('.html'):
            continue
        with open(os.path.join(REPO_ROOT, rel), encoding='utf-8') as f:
            text = f.read()
        for block in MENU_BLOCK_RE.finditer(text):
            ids.update(HTML_ID_RE.findall(block.group(1)))
    return ids


def classify_keys(en_keys, refs, menu_ids):
    """key -> category, first matching rule in CATEGORY_ORDER wins."""
    categories = {}
    for key in en_keys:
        entries = refs.get(key, [])
        files = {e['file'] for e in entries}
        category = 'ui'
        if (files & MENU_SOURCE_FILES
                or any(e['kind'] == 'id_map' and e.get('element_id') in menu_ids
                       for e in entries)):
            category = 'menu'
        elif files & DIALOG_SOURCE_FILES:
            category = 'dialog'
        elif files & OPTION_SOURCE_FILES:
            category = 'option'
        elif files & MANIFEST_SOURCE_FILES:
            category = 'manifest'
        categories[key] = category
    return categories


# ---------------------------------------------------------------------------
# Locale analysis (missing / verify / translate share this)
# ---------------------------------------------------------------------------

def analyze_locale(en_data, data, locale):
    """Return dict with missing/todo/suspect/extra key lists (en order)."""
    en_keys = set(en_data)
    loc_keys = set(data)
    missing = [k for k in en_data if k not in loc_keys]
    extra = [k for k in data if k not in en_keys]
    todo = [k for k in en_data
            if k in data and is_todo_message(data[k].get('message', ''))]
    suspect = []
    if locale in NON_LATIN_LOCALES:
        for k in en_data:
            if k in data and k not in todo and k not in SUSPECT_ALLOWLIST:
                msg = data[k].get('message', '')
                if msg and msg == en_data[k].get('message', ''):
                    suspect.append(k)
    return {'missing': missing, 'todo': todo, 'suspect': suspect, 'extra': extra}


def placeholder_names(en_entry):
    return set(en_entry.get('placeholders', {}).keys())


# ---------------------------------------------------------------------------
# audit
# ---------------------------------------------------------------------------

def cmd_audit(args):
    en_data = load_en()
    files = source_files()
    refs, dynamic = scan_references(files)
    menu_ids = find_menu_item_ids(files)
    categories = classify_keys(en_data.keys(), refs, menu_ids)

    en_keys = set(en_data)
    ref_keys = set(refs)
    undefined = sorted(ref_keys - en_keys)
    unreferenced = [k for k in en_data if k not in ref_keys]

    print('== i18n audit ==')
    print(f'扫描源文件: {len(files)} 个 (src/**/*.js, pages/*.html, css/*.css, manifest.json)')
    print(f'静态引用键: {len(ref_keys)} 个; 动态拼接引用: {len(dynamic)} 处 (仅 --verbose 显示，不计错误)')
    print()

    if undefined:
        print(f'[错误] 代码引用但 en 中未定义的键 ({len(undefined)}):')
        for key in undefined:
            locs = ', '.join(f"{e['file']}:{e['line']}" for e in refs[key][:3])
            print(f'  {key}  ({locs})')
    else:
        print('[OK] 代码引用的键全部在 en 中定义')
    print()

    print(f'[信息] en 已定义但代码未静态引用的键 ({len(unreferenced)})，不算错误：')
    for key in unreferenced:
        print(f'  {key}')
    print()

    print('== 键用途分类（供 translate/verify 使用）==')
    by_cat = {c: [] for c in CATEGORY_ORDER}
    for key in en_data:
        by_cat[categories[key]].append(key)
    for cat in CATEGORY_ORDER:
        keys = by_cat[cat]
        print(f'{cat:<9} ({len(keys):>3}): {", ".join(sorted(keys))}')
    print('注：未被代码引用的键默认归入 ui。')

    if args.verbose:
        print()
        print('== 引用位置明细 ==')
        for key in sorted(ref_keys):
            for e in refs[key]:
                via = f" via #{e['element_id']}" if 'element_id' in e else ''
                print(f'  {key}  <-  {e["file"]}:{e["line"]} [{e["kind"]}]{via}')
        if dynamic:
            print()
            print('== 动态拼接的引用（无法静态判定，未计入）==')
            for d in dynamic:
                print(f'  {d["file"]}:{d["line"]}  ({d["expr"]})')

    if undefined:
        print(f'\naudit 失败: {len(undefined)} 个未定义键')
        return 1
    print('\naudit 通过')
    return 0


# ---------------------------------------------------------------------------
# missing
# ---------------------------------------------------------------------------

def cmd_missing(args):
    en_data = load_en()
    locales = locale_dirs()
    if args.locale:
        if args.locale not in locales:
            print(f"错误: locale '{args.locale}' 不存在", file=sys.stderr)
            return 2
        locales = [args.locale]

    report = {}
    for loc in locales:
        report[loc] = analyze_locale(en_data, load_locale(loc), loc)

    if args.json:
        print(json.dumps({'en_keys': len(en_data), 'locales': report},
                         ensure_ascii=False, indent=2))
        return 0

    print(f'en 基准键数: {len(en_data)}')
    print(f'{"Locale":<8} {"Total":>5} {"Missing":>7} {"TODO":>5} {"Suspect":>7} {"Extra":>5}')
    print('-' * 46)
    tot_missing = tot_todo = tot_suspect = tot_extra = 0
    for loc in locales:
        r = report[loc]
        data_len = len(load_locale(loc))
        tot_missing += len(r['missing'])
        tot_todo += len(r['todo'])
        tot_suspect += len(r['suspect'])
        tot_extra += len(r['extra'])
        print(f'{loc:<8} {data_len:>5} {len(r["missing"]):>7} {len(r["todo"]):>5} '
              f'{len(r["suspect"]):>7} {len(r["extra"]):>5}')
    print('-' * 46)
    print(f'合计: {len(locales)} 个 locale, missing={tot_missing}, '
          f'todo={tot_todo}, suspect={tot_suspect}, extra={tot_extra}')

    if args.locale:
        r = report[args.locale]
        for label, keys in (('缺失键 (en 有 locale 无)', r['missing']),
                            ('未翻译键 [TODO:key]', r['todo']),
                            ('疑似未译（与 en 完全相同）', r['suspect']),
                            ('多余键 (locale 有 en 无)', r['extra'])):
            if keys:
                print(f'\n{label} ({len(keys)}):')
                for k in keys:
                    print(f'  {k}')
    return 0


# ---------------------------------------------------------------------------
# LLM client
# ---------------------------------------------------------------------------

def get_llm_config():
    """Read env config; exit(2) with a clear hint when the API key is unset."""
    base_url = os.environ.get(LLM_BASE_URL_ENV, '').strip() or LLM_DEFAULT_BASE_URL
    model = os.environ.get(LLM_MODEL_ENV, '').strip() or LLM_DEFAULT_MODEL
    api_type = os.environ.get(LLM_API_TYPE_ENV, '').strip() or LLM_DEFAULT_API_TYPE
    if api_type not in ('openai', 'anthropic_messages'):
        print(f'错误: {LLM_API_TYPE_ENV} 仅支持 openai / anthropic_messages，'
              f'当前为 {api_type!r}', file=sys.stderr)
        sys.exit(2)
    api_key = os.environ.get(LLM_API_KEY_ENV, '').strip()
    if not api_key:
        print(f'错误: 未设置环境变量 {LLM_API_KEY_ENV}，无法调用 LLM。', file=sys.stderr)
        print('请先设置 API key（或写入仓库根目录的 .env 文件），例如：', file=sys.stderr)
        print(f'  export {LLM_API_KEY_ENV}="sk-..."', file=sys.stderr)
        print('可选环境变量：', file=sys.stderr)
        print(f'  {LLM_BASE_URL_ENV}  默认 {LLM_DEFAULT_BASE_URL}', file=sys.stderr)
        print(f'  {LLM_MODEL_ENV}  默认 {LLM_DEFAULT_MODEL}', file=sys.stderr)
        print(f'  {LLM_API_TYPE_ENV}  默认 {LLM_DEFAULT_API_TYPE}（可选 anthropic_messages）',
              file=sys.stderr)
        sys.exit(2)
    return {'base_url': base_url.rstrip('/'), 'api_key': api_key,
            'model': model, 'api_type': api_type}


def llm_chat(messages, cfg):
    """Call the configured LLM via urllib.
    api_type 'openai': POST {base}/chat/completions (Bearer auth).
    api_type 'anthropic_messages': POST {base}/v1/messages (x-api-key auth,
    system messages lifted into the top-level `system` field).
    Retries LLM_RETRIES times on failure; raises RuntimeError afterwards."""
    if cfg['api_type'] == 'anthropic_messages':
        url = cfg['base_url'] + '/v1/messages'
        system = '\n'.join(m['content'] for m in messages if m['role'] == 'system')
        body = json.dumps({
            'model': cfg['model'],
            'max_tokens': 8192,
            'temperature': 0.2,
            'system': system,
            'messages': [m for m in messages if m['role'] != 'system'],
            # DeepSeek 的 anthropic 兼容端点默认开启 reasoning（thinking），
            # 长任务会把全部 max_tokens 花在 thinking 上而不产出 text。
            # 翻译任务不需要推理——显式禁用，保证输出直接是 JSON 文本。
            'thinking': {'type': 'disabled'},
        }).encode('utf-8')
        headers = {
            'Content-Type': 'application/json',
            'x-api-key': cfg['api_key'],
            'anthropic-version': '2023-06-01',
        }

        def extract(payload):
            return ''.join(part.get('text', '') for part in payload['content'])
    else:
        url = cfg['base_url'] + '/chat/completions'
        body = json.dumps({
            'model': cfg['model'],
            'messages': messages,
            'temperature': 0.2,
        }).encode('utf-8')
        headers = {
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {cfg['api_key']}",
        }

        def extract(payload):
            return payload['choices'][0]['message']['content']

    last_err = None
    for attempt in range(1 + LLM_RETRIES):
        req = urllib.request.Request(url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=LLM_TIMEOUT) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
            return extract(payload)
        except (urllib.error.URLError, urllib.error.HTTPError,
                TimeoutError, json.JSONDecodeError, KeyError, IndexError) as e:
            last_err = e
            print(f'  LLM 请求失败（第 {attempt + 1}/{1 + LLM_RETRIES} 次）: {e}',
                  file=sys.stderr)
    raise RuntimeError(f'LLM 请求连续失败: {last_err}')


def parse_llm_json(content):
    """Parse the model output as a JSON object, tolerating code fences and
    surrounding prose."""
    text = content.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    start, end = text.find('{'), text.rfind('}')
    if start == -1 or end == -1 or end < start:
        raise ValueError('LLM 输出中找不到 JSON 对象')
    result = json.loads(text[start:end + 1])
    if not isinstance(result, dict):
        raise ValueError('LLM 输出不是 JSON 对象')
    return result


def extract_en_placeholder_tokens(message):
    """$name$ / $1 tokens inside an en message that must survive translation."""
    return re.findall(r'\$[A-Za-z_][A-Za-z0-9_]*\$|\$\d+', message)


def validate_translations(requested_keys, result, en_data):
    """Raise ValueError unless the result exactly covers the requested keys,
    has no [TODO: residue and preserves en placeholder tokens."""
    requested = set(requested_keys)
    got = set(result)
    if got != requested:
        raise ValueError(
            f'键集合不一致: 多出 {sorted(got - requested)}, 缺少 {sorted(requested - got)}')
    for key, text in result.items():
        if not isinstance(text, str) or not text.strip():
            raise ValueError(f'{key}: 译文为空或不是字符串')
        if '[TODO' in text:
            raise ValueError(f'{key}: 译文残留 [TODO 标记')
        for token in extract_en_placeholder_tokens(en_data[key]['message']):
            if token not in text:
                raise ValueError(f'{key}: 译文丢失占位符 {token}')


def llm_translate_chunk(items, language, cfg, template=PROMPT_USER_TEMPLATE,
                        extra_format=None):
    """One LLM request for a chunk of items; returns {key: translation}."""
    payload = json.dumps(items, ensure_ascii=False, indent=2)
    user = template.format(language=language, items=payload,
                           staging_term='(未在术语表中——按"暂存/准备区"概念意译并保持全批一致)',
                           script_note='',
                           **(extra_format or {}))
    messages = [
        {'role': 'system', 'content': PROMPT_SYSTEM},
        {'role': 'user', 'content': user},
    ]
    content = llm_chat(messages, cfg)
    return parse_llm_json(content)


# ---------------------------------------------------------------------------
# Write-back helpers (translate / verify --fix)
# ---------------------------------------------------------------------------

def insert_missing_positions(existing_order, missing_keys, en_data):
    """Final key order: existing keys keep their current relative order;
    each missing key is inserted right after its nearest en-order predecessor
    already present in the file (missing keys chain in en order); keys without
    any present predecessor go to the head of the file."""
    en_order = list(en_data)
    en_index = {k: i for i, k in enumerate(en_order)}
    result = list(existing_order)
    present = set(result)
    for key in sorted(missing_keys, key=en_index.get):
        i = en_index[key] - 1
        while i >= 0 and en_order[i] not in present:
            i -= 1
        pos = result.index(en_order[i]) + 1 if i >= 0 else 0
        result.insert(pos, key)
        present.add(key)
    return result


def apply_translations(data, en_data, translations):
    """Return a new locale dict with translations applied.
    Existing keys keep their position and entry fields; missing keys are
    inserted per en order; placeholders are copied from en."""
    missing_keys = [k for k in translations if k not in data]
    order = insert_missing_positions(list(data), missing_keys, en_data)
    new_data = {}
    for key in order:
        if key in translations:
            entry = dict(data.get(key, {}))
            entry['message'] = translations[key]
            if 'placeholders' in en_data[key]:
                entry['placeholders'] = en_data[key]['placeholders']
            new_data[key] = entry
        else:
            new_data[key] = data[key]
    return new_data


# ---------------------------------------------------------------------------
# translate
# ---------------------------------------------------------------------------

def cmd_translate(args):
    en_data = load_en()
    locales = locale_dirs()
    if args.locale:
        if args.locale == EN_LOCALE:
            print('错误: en 是基准语言，无需翻译', file=sys.stderr)
            return 2
        if args.locale not in locales:
            print(f"错误: locale '{args.locale}' 不存在", file=sys.stderr)
            return 2
        locales = [args.locale]

    cfg = get_llm_config()
    print(f'LLM: {cfg["model"]} @ {cfg["base_url"]}')
    print(f'模式: {"DRY-RUN（不写文件，加 --apply 落盘）" if args.dry_run else "APPLY（写回 locale 文件）"}')

    categories = None  # lazily computed once
    failures = 0
    for loc in locales:
        data = load_locale(loc)
        analysis = analyze_locale(en_data, data, loc)
        pending = analysis['missing'] + analysis['todo']
        if not pending:
            print(f'\n[{loc}] 无需翻译，跳过')
            continue
        if categories is None:
            files = source_files()
            refs, _ = scan_references(files)
            categories = classify_keys(en_data.keys(), refs, find_menu_item_ids(files))

        language = LOCALE_NAMES.get(loc, loc)
        print(f'\n[{loc}] 待译 {len(pending)} 键 '
              f'(缺失 {len(analysis["missing"])}, TODO {len(analysis["todo"])}), 目标语言: {language}')

        translations = {}
        # per-locale prompt context: the settled staging term + script notes
        extra_format = {
            'staging_term': STAGING_TERMS.get(loc, '（未定案——意译为"暂存/准备区"概念并保持全批一致）'),
            'script_note': SCRIPT_NOTES.get(loc, ''),
        }
        try:
            for start in range(0, len(pending), TRANSLATE_CHUNK_SIZE):
                chunk = pending[start:start + TRANSLATE_CHUNK_SIZE]
                items = [{
                    'key': key,
                    'english': en_data[key]['message'],
                    'category': CATEGORY_LABELS_ZH[categories[key]],
                    # menu items carry their character budget up front so the
                    # FIRST translation fits (verify --fix used to clean up
                    # after — now it should have nothing to do)
                    **({'budget': max_len_for(en_data[key]['message'])}
                       if categories[key] == 'menu' else {}),
                } for key in chunk]
                print(f'  请求 LLM: 键 {start + 1}-{start + len(chunk)}/{len(pending)} ...')
                result = llm_translate_chunk(items, language, cfg,
                                             extra_format=extra_format)
                validate_translations(chunk, result, en_data)
                translations.update(result)
        except (RuntimeError, ValueError) as e:
            print(f'  [错误] {loc}: {e}', file=sys.stderr)
            failures += 1
            continue

        new_data = apply_translations(data, en_data, translations)
        if args.dry_run:
            print(f'  [dry-run] 将更新 {len(translations)} 键，示例（前 5 条）:')
            for key in pending[:5]:
                print(f'    {key}: {en_data[key]["message"]!r} -> {translations[key]!r}')
        else:
            save_json(os.path.join(LOCALES_DIR, loc, 'messages.json'), new_data)
            print(f'  已写回 {len(translations)} 键 -> _locales/{loc}/messages.json')

    if failures:
        print(f'\ntranslate 完成，{failures} 个 locale 失败')
        return 1
    print('\ntranslate 完成')
    return 0


# ---------------------------------------------------------------------------
# verify
# ---------------------------------------------------------------------------

def cmd_verify(args):
    en_data = load_en()
    locales = locale_dirs()
    if args.locale:
        if args.locale not in locales:
            print(f"错误: locale '{args.locale}' 不存在", file=sys.stderr)
            return 2
        locales = [args.locale]

    files = source_files()
    refs, _ = scan_references(files)
    categories = classify_keys(en_data.keys(), refs, find_menu_item_ids(files))
    menu_keys = [k for k in en_data if categories[k] == 'menu']

    errors = []    # (locale, message)
    warnings = []  # (locale, message)
    overflow = {}  # locale -> list of (key, current_text, max_len) for --fix

    for loc in locales:
        data = load_locale(loc)
        analysis = analyze_locale(en_data, data, loc)
        for key in analysis['missing']:
            errors.append((loc, f'缺失键: {key}'))
        for key in analysis['extra']:
            errors.append((loc, f'多余键: {key}'))
        for key in analysis['todo']:
            errors.append((loc, f'未翻译 [TODO]: {key}'))

        # placeholder integrity: same name set as en, $name$ used in message
        for key, en_entry in en_data.items():
            names = placeholder_names(en_entry)
            if not names or key not in data:
                continue
            entry = data[key]
            loc_names = placeholder_names(entry)
            if loc_names != names:
                errors.append((loc, f'placeholders 结构不一致: {key} '
                                    f'(期望 {sorted(names)}, 实际 {sorted(loc_names)})'))
                continue
            if not is_todo_message(entry.get('message', '')):
                for name in names:
                    if f'${name}$' not in entry.get('message', ''):
                        errors.append((loc, f'译文缺少占位符 ${name}$: {key}'))

        # menu-item length overflow (WARNING only)
        for key in menu_keys:
            if key not in data:
                continue
            msg = data[key].get('message', '')
            if not msg or is_todo_message(msg):
                continue
            limit = max_len_for(msg)
            if len(msg) > limit:
                warnings.append((loc, f'菜单项过长: {key} ({len(msg)}ch > {limit}ch): "{msg}"'))
                overflow.setdefault(loc, []).append((key, msg, limit))

        # 2026-08-28 机检 1 — 串语：非 CJK 语系的译文里出现汉字即错
        # （th/vi/id/tr 曾整句混入中文而旧 verify 全放行）。
        if loc not in CJK_SCRIPT_LOCALES:
            for key, entry in data.items():
                msg = entry.get('message', '')
                if msg and not is_todo_message(msg) and CJK_CHAR_RE.search(msg):
                    errors.append((loc, f'串语（译文含汉字）: {key}: "{msg[:40]}"'))
        # 机检 2 — 简繁：zh_TW/zh_HK 出现简体专属字形即错（当轮 25+ 键中招）。
        if loc in ('zh_TW', 'zh_HK'):
            for key, entry in data.items():
                msg = entry.get('message', '')
                if msg and not is_todo_message(msg):
                    hits = simplified_hits(msg)
                    if hits:
                        errors.append((loc, f'简体字形混入繁体: {key} '
                                            f'({" ".join(sorted(set(hits)))}): "{msg[:40]}"'))

    for loc, msg in errors:
        print(f'[ERROR]   {loc}: {msg}')
    for loc, msg in warnings:
        print(f'[WARNING] {loc}: {msg}')
    print(f'\n校验 {len(locales)} 个 locale, en 键数 {len(en_data)}, '
          f'menu 键数 {len(menu_keys)}')
    print(f'错误 {len(errors)} 个, 警告 {len(warnings)} 个')

    if args.fix and overflow:
        cfg = get_llm_config()
        print(f'\n--fix: 通过 LLM 缩短 {sum(len(v) for v in overflow.values())} 个溢出菜单项')
        for loc, items in overflow.items():
            data = load_locale(loc)
            language = LOCALE_NAMES.get(loc, loc)
            payload = [{
                'key': key,
                'english': en_data[key]['message'],
                'current': current,
            } for key, current, _ in items]
            max_len = max(limit for _, _, limit in items)
            try:
                result = llm_translate_chunk(
                    payload, language, cfg,
                    template=PROMPT_SHORTEN_TEMPLATE,
                    extra_format={'max_len': max_len})
                validate_translations([k for k, _, _ in items], result, en_data)
            except (RuntimeError, ValueError) as e:
                print(f'  [错误] {loc}: 缩短失败: {e}', file=sys.stderr)
                return 1
            for key, _, _ in items:
                data[key]['message'] = result[key]
            save_json(os.path.join(LOCALES_DIR, loc, 'messages.json'), data)
            print(f'  [{loc}] 已重写 {len(items)} 个菜单项')

    if errors or (args.strict and warnings):
        print('verify 未通过')
        return 1
    print('verify 通过')
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description='vBookmarks i18n 统一管理工具（audit/missing/translate/verify）')
    sub = parser.add_subparsers(dest='command', required=True)

    p_audit = sub.add_parser('audit', help='扫描代码引用，报告未定义/未引用键与用途分类')
    p_audit.add_argument('--verbose', '-v', action='store_true',
                         help='显示每个键的引用位置与动态拼接引用')
    p_audit.set_defaults(func=cmd_audit)

    p_missing = sub.add_parser('missing', help='以 en 为基准报告缺失/未翻译/多余键')
    p_missing.add_argument('--locale', '-l', help='只报告指定 locale 并列出键名')
    p_missing.add_argument('--json', action='store_true', help='机器可读 JSON 输出')
    p_missing.set_defaults(func=cmd_missing)

    p_translate = sub.add_parser('translate', help='调用 LLM 翻译缺失与 [TODO:] 键')
    p_translate.add_argument('--locale', '-l', help='只处理指定 locale')
    mode = p_translate.add_mutually_exclusive_group()
    mode.add_argument('--dry-run', action='store_true', default=True,
                      help='只打印将写入的内容摘要（默认）')
    mode.add_argument('--apply', action='store_true', help='实际写回 locale 文件')
    p_translate.set_defaults(func=cmd_translate)

    p_verify = sub.add_parser('verify', help='全量校验：键集对齐/placeholders/菜单长度')
    p_verify.add_argument('--locale', '-l', help='只校验指定 locale')
    p_verify.add_argument('--fix', action='store_true',
                          help='对长度溢出的菜单项调用 LLM 缩短并重写')
    p_verify.add_argument('--strict', action='store_true',
                          help='WARNING 也使退出码为 1')
    p_verify.set_defaults(func=cmd_verify)

    args = parser.parse_args()
    if args.command == 'translate':
        args.dry_run = not args.apply
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
