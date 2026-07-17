#!/usr/bin/env python3
"""
Translation quality checker for vBookmarks.
Checks all locale files for:
1. UI compact strings (menu/button) that are too long for their containers
2. Obviously wrong or suspicious translations (wrong script, empty values, etc.)

Usage:
    python3 scripts/check_translations.py
    python3 scripts/check_translations.py --locale zh    # Check specific locale only
"""

import json, os, re, argparse

LOCALES_DIR = '_locales'

# --- Key classification ---
# UI compact: menu items, buttons, labels - need to be short
UI_COMPACT = {
    'addBookmarkAfter', 'addBookmarkBefore', 'addBookmarkBottom', 'addBookmarkTop',
    'addNewFolder', 'addNewFolderAfter', 'addNewFolderBefore', 'addSeparator',
    'removeSeparator', 'replaceUrl',
    'openNewTab', 'openNewWindow', 'openIncognitoWindow',
    'openBookmarks', 'openBookmarksNewWindow', 'openBookmarksIncognitoWindow',
    'copyTitleAndUrl', 'copyAllTitlesAndUrls',
    'delete', 'deleteEllipsis', 'edit', 'editBookmark', 'editFolder',
    'open', 'save', 'nope', 'ignore',
    'resetButton', 'reportError',
    'general', 'options', 'advancedOptions', 'accessibility',
    'customIcon', 'customStyles', 'defaultIconButton', 'defaultIconButtonOr',
    'searchBookmarks', 'name', 'url', 'noTitle',
    'resetSettings',
    'errorOccured', 'reportedToDeveloper',
    'donationGo', 'donationDismiss',
}

# Option descriptions (medium length acceptable)
OPTION_DESC = {
    'optionClickNewTab', 'optionCloseUnusedFolders', 'optionConfirmOpenFolder',
    'optionOnlyShowBookmarkBar', 'optionSearchAfterEnter', 'optionOpenNewTab',
    'optionPopupStays', 'optionRememberPrevState', 'optionZoom',
    'optionAutoResizePopup',
}

# Dialog/long text (any length OK)
DIALOG_TEXT = {
    'confirmDeleteFolderBookmarks', 'confirmDeleteFolderSubfolders',
    'confirmDeleteFolderSubfoldersBookmarks',
    'confirmOpenBookmarks', 'confirmOpenBookmarksNewIncognitoWindow',
    'confirmOpenBookmarksNewWindow',
    'customIconDescription', 'customStylesDescription',
    'customSeparatorColorDescription', 'customSeparatorTitleDescription',
    'customSeparatorUrlDescription', 'customSeparatorStringDescription',
    'resetSettingsDescription',
    'versionMessage', 'donationMessage',
    'optionsFooterText', 'parentFolder',
    'extName', 'extDesc',
}

# Max UI string length (Latin script)
UI_MAX_LEN = 35
# Max UI string length for CJK scripts (about half since they're ~2x wider)
UI_MAX_LEN_CJK = 18


def is_cjk(s):
    """Return True if string is primarily CJK characters."""
    cjk = sum(1 for c in s if '一' <= c <= '鿿'
              or '぀' <= c <= 'ゟ'
              or '゠' <= c <= 'ヿ'
              or '가' <= c <= '힯')
    return cjk > len(s) * 0.3


def check_script(text, lang):
    """Check if the translation uses the expected script for its language."""
    issues = []

    if len(text) < 2:
        issues.append('TOO_SHORT')
        return issues

    if text.startswith('[TODO'):
        issues.append('TODO_PLACEHOLDER')
        return issues

    lang_checks = {
        'ar': (r'[؀-ۿ]', 'ARABIC'),
        'he': (r'[֐-׿]', 'HEBREW'),
        'el': (r'[Ͱ-Ͽ]', 'GREEK'),
        'th': (r'[฀-๿]', 'THAI'),
        'hi': (r'[ऀ-ॿ]', 'DEVANAGARI'),
        'bn': (r'[ঀ-৿]', 'BENGALI'),
    }

    if lang in lang_checks:
        pattern, name = lang_checks[lang]
        if not re.search(pattern, text):
            # Only flag if the entire string looks like Latin script
            if re.match(r'^[A-Za-z0-9\s\.\-\(\)\'\"]+$', text) and len(text) > 5:
                issues.append(f'NO_{name}')
        return issues

    # CJK languages
    cjk_langs = {'zh', 'zh_HK', 'zh_TW', 'ja', 'ko'}
    if lang in cjk_langs:
        cjk_pattern = re.compile(r'[一-鿿぀-ゟ゠-ヿ가-힯]')
        if not cjk_pattern.search(text):
            if re.match(r'^[A-Za-z0-9\s\.\-\(\)\'\"]+$', text) and len(text) > 5:
                issues.append('NO_CJK')

    return issues


def get_repo_root():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def main():
    parser = argparse.ArgumentParser(description='Check translation quality for vBookmarks locales.')
    parser.add_argument('--locale', '-l', help='Check only a specific locale')
    parser.add_argument('--ui-only', action='store_true', help='Only check UI length issues')
    args = parser.parse_args()

    root = get_repo_root()
    locales_path = os.path.join(root, LOCALES_DIR)

    with open(os.path.join(locales_path, 'en', 'messages.json'), encoding='utf-8') as f:
        en_data = json.load(f)

    locales = sorted([d for d in os.listdir(locales_path)
                      if os.path.isdir(os.path.join(locales_path, d)) and d != 'en'])
    if args.locale:
        locales = [args.locale]

    all_classified = UI_COMPACT | OPTION_DESC | DIALOG_TEXT
    unclassified = set(en_data.keys()) - all_classified
    if unclassified:
        print(f'WARNING: {len(unclassified)} unclassified keys: {sorted(unclassified)}')

    # Keys in en that require placeholders for $variable$ substitution
    en_placeholders = {k: v['placeholders'] for k, v in en_data.items() if 'placeholders' in v}

    total_ui_long = 0
    total_suspect = 0
    total_missing_ph = 0

    for loc in locales:
        with open(os.path.join(locales_path, loc, 'messages.json'), encoding='utf-8') as f:
            data = json.load(f)

        loc_ui_long = []
        loc_suspect = []

        # 1. UI length check
        for key in sorted(UI_COMPACT):
            if key not in data:
                continue
            msg = data[key].get('message', '')
            if not msg:
                loc_ui_long.append(f'  EMPTY: {key}')
                continue

            en_msg = en_data[key]['message']
            en_len = len(en_msg)
            cjk = is_cjk(msg)
            max_len = UI_MAX_LEN_CJK if cjk else UI_MAX_LEN

            if len(msg) > max_len:
                loc_ui_long.append(
                    f'  LONG_UI: {key} ({len(msg)}ch, en={en_len}ch): "{msg}"'
                )

        # 2. Script/sanity check
        if not args.ui_only:
            for key in sorted(en_data.keys()):
                if key not in data:
                    continue
                msg = data[key].get('message', '')
                for issue in check_script(msg, loc):
                    loc_suspect.append(f'  SUSPECT: {key} [{issue}]: "{msg}"')

        # 3. Placeholder integrity check
        for key, ph in en_placeholders.items():
            if key not in data:
                continue
            if 'placeholders' not in data[key]:
                loc_suspect.append(f'  MISSING_PLACEHOLDERS: {key} (requires: {sorted(ph.keys())})')
                total_missing_ph += 1

        if loc_ui_long or loc_suspect:
            print(f'\n--- {loc} ---')
            for item in loc_ui_long:
                print(item)
                total_ui_long += 1
            for item in loc_suspect:
                print(item)
                total_suspect += 1

    print(f'\n{"=" * 60}')
    print(f'Checked {len(locales)} locales against {len(en_data.keys())} en keys')
    print(f'UI compact keys checked: {len(UI_COMPACT)}')
    print(f'UI too-long issues: {total_ui_long}')
    print(f'Suspicious translation issues: {total_suspect}')
    print(f'Missing placeholder issues: {total_missing_ph}')


if __name__ == '__main__':
    main()
