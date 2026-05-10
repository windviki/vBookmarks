#!/usr/bin/env python3
"""
Package vBookmarks extension into a zip file for Chrome Web Store submission
or offline distribution.

Reads manifest.json for the version number and produces:
    release/vBookmarks_[ver].zip

Only files needed at runtime or for store listing are included.
Dev tools, IDE config, screenshots, and source design files are excluded.

Usage:
    python3 scripts/package.py
    python3 scripts/package.py --output my-build.zip
"""

import json
import os
import sys
import zipfile
import argparse

# --- Explicit file lists ---

# HTML pages referenced from manifest.json (or linked from other pages)
HTML_PAGES = [
    'popup.html',
    'options.html',
    'advanced-options.html',
]

# JavaScript files referenced by HTML pages
JS_FILES = [
    'background.js',
    'neat.js',
    'neatools.js',
    'popup.js',
    'options.js',
    'advanced-options.js',
    'codemirror.js',
]

# CSS files referenced by HTML pages
CSS_FILES = [
    'neat.css',
    'options.css',
    'codemirror.css',
]

# Icon/image files referenced in manifest.json, HTML pages, or JS code
IMAGES = [
    'icon.png',
    'icon16.png',
    'icon32.png',
    'icon48.png',
    'icon128.png',
    'folder.png',
    'document-code.png',
]

# Metadata files for store listing and user reference
META_FILES = [
    'license.txt',
    'README.md',
    'README.zh.md',
]

# --- Exclusion patterns ---

EXCLUDE_DIRS = {
    '.git',
    '.idea',
    '.claude',
    'scripts',
    'donation',
    'release',
    '_locales',  # handled separately below
}

EXCLUDE_FILES = {
    # Source design files
    'icon.psd',
    # Alternative icons not in manifest
    'icon-2.png',
    'icon-3.png',
    # Old omnibox icon (not referenced)
    'omni-icon.png',
    # Screenshots for README
    'vbookmarks.png',
    'vbookmarks-menu.png',
    # Old MV2 background page (not in manifest)
    'background.html',
    # Disabled update checking
    'checkupdate.json',
    # Source archive
    'neat.xar',
    # Dev/CI files
    'PLAN.md',
    'CLAUDE.md',
}

# Locale directories to exclude (not in the supported set)
# All subdirectories under _locales/ are included by default;
# exclude any that should not ship.
EXCLUDE_LOCALES = set()


def get_repo_root():
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')


def load_manifest(root):
    path = os.path.join(root, 'manifest.json')
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def collect_files(root, manifest):
    """Return sorted list of (arcname, filepath) tuples to include in the zip."""
    included = {}

    def add(name):
        """Add a file relative to repo root."""
        if name in included:
            return
        path = os.path.join(root, name)
        if os.path.isfile(path):
            included[name] = path
        else:
            print(f'WARNING: file not found, skipping: {name}')

    def add_dir(name):
        """Add all files under a directory recursively."""
        dirpath = os.path.join(root, name)
        if not os.path.isdir(dirpath):
            print(f'WARNING: directory not found, skipping: {name}')
            return
        for dirpath2, _, filenames in os.walk(dirpath):
            for fn in filenames:
                full = os.path.join(dirpath2, fn)
                arc = os.path.relpath(full, root).replace('\\', '/')
                if arc not in included:
                    included[arc] = full

    # Always include manifest
    add('manifest.json')

    # HTML pages
    for name in HTML_PAGES:
        add(name)

    # JavaScript
    for name in JS_FILES:
        add(name)

    # CSS
    for name in CSS_FILES:
        add(name)

    # Images/icons
    for name in IMAGES:
        add(name)

    # Metadata
    for name in META_FILES:
        add(name)

    # All locale files
    add_dir('_locales')

    # Remove excluded locales
    to_remove = []
    for arc in included:
        if arc.startswith('_locales/'):
            parts = arc.split('/')
            if len(parts) >= 2:
                locale_dir = parts[1]
                if locale_dir in EXCLUDE_LOCALES:
                    to_remove.append(arc)
    for arc in to_remove:
        del included[arc]

    return sorted(included.items())


def verify_no_strays(root, included):
    """Warn about files in the repo that are not in the zip and not excluded."""
    arcnames = {arc for arc, _ in included}
    stray = []

    for dirpath, dirnames, filenames in os.walk(root):
        # Prune excluded directories
        rel_dir = os.path.relpath(dirpath, root).replace('\\', '/')
        top_dir = rel_dir.split('/')[0] if rel_dir != '.' else ''

        if top_dir in EXCLUDE_DIRS or rel_dir.startswith('.git'):
            dirnames[:] = []
            continue

        for fn in filenames:
            arc = os.path.relpath(os.path.join(dirpath, fn), root).replace('\\', '/')
            if arc not in arcnames and arc not in EXCLUDE_FILES:
                # Check if file is in an excluded locale
                if arc.startswith('_locales/'):
                    parts = arc.split('/')
                    if len(parts) >= 2 and parts[1] in EXCLUDE_LOCALES:
                        continue
                stray.append(arc)

    if stray:
        print(f'\nWARNING: {len(stray)} file(s) in repo but not in zip:')
        for s in sorted(stray):
            print(f'  {s}')
        print('Review the exclusion lists in scripts/package.py if these should be included.\n')


def main():
    parser = argparse.ArgumentParser(
        description='Package vBookmarks extension into a zip file.'
    )
    parser.add_argument(
        '--output', '-o',
        help='Output zip path (default: release/vBookmarks_[ver].zip)'
    )
    args = parser.parse_args()

    root = get_repo_root()
    manifest = load_manifest(root)
    version = manifest.get('version', 'unknown')

    if args.output:
        output_path = args.output
    else:
        release_dir = os.path.join(root, 'release')
        os.makedirs(release_dir, exist_ok=True)
        output_path = os.path.join(release_dir, f'vBookmarks_{version}.zip')

    included = collect_files(root, manifest)

    print(f'Packaging vBookmarks v{version}')
    print(f'Files to include: {len(included)}')
    print(f'Output: {output_path}')

    with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for arcname, filepath in included:
            zf.write(filepath, arcname)

    # Show size
    size_kb = os.path.getsize(output_path) / 1024
    print(f'Done: {size_kb:.1f} KB')

    # Warn about stray files
    verify_no_strays(root, included)


if __name__ == '__main__':
    main()
