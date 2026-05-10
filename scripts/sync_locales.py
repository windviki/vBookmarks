#!/usr/bin/env python3
"""
Locale synchronization tool for vBookmarks.

Syncs all language message.json files against the English (en) baseline.
Supports importing translations from another git branch to fill in missing keys.

Usage:
    python3 scripts/sync_locales.py                      # Sync all locales against en
    python3 scripts/sync_locales.py --branch cc-dev       # Import from cc-dev branch first
    python3 scripts/sync_locales.py --check-only          # Only report differences, no changes
    python3 scripts/sync_locales.py --locale fr           # Only process a specific locale
"""

import json
import os
import subprocess
import sys
import argparse

LOCALES_DIR = '_locales'
EN_LOCALE = 'en'


def load_json(path):
    """Load a JSON file with UTF-8 encoding."""
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save_json(path, data):
    """Save a JSON file with UTF-8 encoding, preserving key order."""
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_cc_dev_translations(locale, branch='cc-dev'):
    """Fetch translations for a locale from a git branch."""
    try:
        result = subprocess.run(
            ['git', 'show', f'{branch}:_locales/{locale}/messages.json'],
            capture_output=True, text=True, encoding='utf-8'
        )
        if result.returncode == 0:
            return json.loads(result.stdout)
    except Exception:
        pass
    return {}


def get_locale_dirs():
    """Return sorted list of locale directory names."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', LOCALES_DIR)
    return sorted([d for d in os.listdir(path)
                   if os.path.isdir(os.path.join(path, d)) and d != EN_LOCALE])


def get_repo_root():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def analyze(en_keys, locale_keys, name):
    """Return a dict with missing/extra/todo analysis."""
    missing = sorted(en_keys - locale_keys)
    extra = sorted(locale_keys - en_keys)
    return {
        'name': name,
        'total': len(locale_keys),
        'missing': missing,
        'extra': extra,
        'ok': len(missing) == 0 and len(extra) == 0
    }


def main():
    parser = argparse.ArgumentParser(description='Sync locale files against en baseline.')
    parser.add_argument('--branch', '-b', help='Git branch to import translations from')
    parser.add_argument('--check-only', '-c', action='store_true', help='Only report, do not modify files')
    parser.add_argument('--locale', '-l', help='Only process a specific locale')
    args = parser.parse_args()

    root = get_repo_root()
    locales_path = os.path.join(root, LOCALES_DIR)

    # Load en baseline
    en_data = load_json(os.path.join(locales_path, EN_LOCALE, 'messages.json'))
    en_keys = set(en_data.keys())

    locales = get_locale_dirs()
    if args.locale:
        if args.locale in locales:
            locales = [args.locale]
        else:
            print(f"Error: locale '{args.locale}' not found")
            sys.exit(1)

    if args.check_only:
        print(f"EN baseline: {len(en_keys)} keys")
        print(f"{'Locale':<16} {'Keys':>5} {'Missing':>8} {'Extra':>6} {'Status':>8}")
        print("-" * 55)

    all_ok = True
    for loc in locales:
        filepath = os.path.join(locales_path, loc, 'messages.json')
        locale_data = load_json(filepath)
        loc_keys = set(locale_data.keys())

        if args.check_only:
            info = analyze(en_keys, loc_keys, loc)
            status = 'OK' if info['ok'] else 'FAIL'
            all_ok = all_ok and info['ok']
            print(f"{info['name']:<16} {info['total']:>5} {len(info['missing']):>8} {len(info['extra']):>6} {status:>8}")
            if info['missing']:
                print(f"  MISSING: {info['missing']}")
            if info['extra']:
                print(f"  EXTRA: {info['extra']}")
            continue

        # Import from branch if specified
        cc_dev = {}
        if args.branch:
            cc_dev = get_cc_dev_translations(loc, args.branch)
            if cc_dev:
                print(f'{loc}: loaded {len(cc_dev)} keys from {args.branch}')

        # Build new data with only en keys
        new_data = {}
        missing = []
        for key in en_keys:
            if key in cc_dev:
                new_data[key] = cc_dev[key]
            elif key in locale_data:
                new_data[key] = locale_data[key]
            else:
                new_data[key] = {'message': f'[TODO:{key}]'}
                missing.append(key)

        save_json(filepath, new_data)

        source = args.branch if (args.branch and cc_dev) else 'existing'
        status = 'OK' if len(missing) == 0 else f'{len(missing)} TODO'
        print(f'{loc}: {len(en_keys)} keys [{source}] {status}')
        if missing:
            print(f'  TODO: {missing}')

    if args.check_only:
        if all_ok:
            print("\nAll locales consistent with en baseline!")
        else:
            print("\nIssues found - see above")

    print(f"\nTotal locales: {len(locales)}")
    print(f"Keys per locale: {len(en_keys)}")


if __name__ == '__main__':
    main()
