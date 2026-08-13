#!/usr/bin/env python3
"""
Package vBookmarks extension into a zip file for Chrome Web Store submission
or offline distribution.

Reads manifest.json for the version number and produces:
    tmp/vBookmarks_[ver].zip        (--target chrome, the default)
    tmp/vBookmarks_edge_[ver].zip   (--target edge; same content, see
                                     docs/browser-compat.md — Edge is
                                     Chromium MV3 and runs the same package)

Only files needed at runtime or for store listing are included.
Dev tools, IDE config, screenshots, and source design files are excluded.

Usage:
    python3 scripts/package.py
    python3 scripts/package.py --target edge
    python3 scripts/package.py --output my-build.zip
"""

import json
import os
import re
import sys
import zipfile
import argparse

# --- Explicit file lists ---

# HTML pages referenced from manifest.json (or linked from other pages)
HTML_PAGES = [
    'pages/popup.html',
    'pages/sidepanel.html',
    'pages/options.html',
    'pages/advanced-options.html',
]

# JavaScript files referenced by HTML pages (or imported by other modules)
JS_FILES = [
    'src/background.js',
    'src/panel-behavior.js',
    'src/fuzzy.js',
    'src/sort-utils.js',
    'src/neat.js',
    'src/popup.js',
    'src/options.js',
    'src/advanced-options.js',
    'src/store.js',
    'src/sync-engine.js',
    'src/sync-manager.js',
    'src/search-core.js',
    'src/separators.js',
    'src/search.js',
    'src/actions.js',
    'src/context-menu.js',
    'src/dialogs.js',
    'src/keyboard.js',
    'src/dnd.js',
    'src/tree-render.js',
    'src/tree-view.js',
    'src/sync-ui.js',
    'src/palette.js',
    'src/palette-commands.js',
    'src/options-palette-commands.js',
    'src/options-proxy.js',
    'src/dupes.js',
    'src/dead-links.js',
    'src/dead-proxy.js',
    'src/dead-scan-sw.js',
    'src/tab-group-utils.js',
    'src/tab-groups-sw.js',
    'src/session.js',
    'src/undo.js',
    'src/userstyle.js',
    'src/icons.js',
    'src/view-manager.js',
    'src/view-recent.js',
    'src/view-dupes.js',
    'src/view-dead.js',
    'src/risk-banner.js',
    'src/version.js',
    'src/visit-stats.js',
    'src/visit-stats-sw.js',
    'src/view-stats.js',
    'vendor/codemirror.js',
]

# CSS files referenced by HTML pages
CSS_FILES = [
    'css/neat.css',
    'css/options.css',
    'css/sync-styles.css',
    'vendor/codemirror.css',
]

# Icon/image files referenced in manifest.json, HTML pages, or JS code
# (manifest/action icons must stay PNG — Chrome rejects SVG there; icon.svg
# is the vector master used by the extension pages' <img> tags)
IMAGES = [
    'assets/icons/icon.png',
    'assets/icons/icon16.png',
    'assets/icons/icon32.png',
    'assets/icons/icon48.png',
    'assets/icons/icon128.png',
    'assets/icons/icon.svg',
]

# Metadata files for store listing and user reference
META_FILES = [
    'license.txt',
    'docs/README.md',
    'docs/README.zh.md',
]

# --- Exclusion patterns ---

EXCLUDE_DIRS = {
    '.git',
    '.idea',
    '.claude',
    'scripts',
    'donation',
    'release',
    'docs',
    'tests',
    'node_modules',
    'tmp',  # local dev artifacts (screenshots, zips), git-ignored
    '_locales',  # handled separately below
}

EXCLUDE_FILES = {
    # Design sources and unused alternative icons (assets/design/)
    'assets/design/icon.psd',
    'assets/design/neat.xar',
    'assets/design/icon-2.png',
    'assets/design/icon-3.png',
    'assets/design/omni-icon.png',
    # Screenshots for store listing / README (assets/store/)
    'assets/store/vbookmarks.png',
    'assets/store/vbookmarks-menu.png',
    'assets/store/vBookmarks-v4.png',
    'assets/store/vBookmarks-v4-options.png',
    'assets/store/vBookmarks-v4-sidepanel.png',
    # Dev/tooling files
    'AGENTS.md',
    'package.json',
    'package-lock.json',
    '.gitignore',
    '.env',  # local LLM credentials, git-ignored
    '.env.example',
    'eslint.config.js',
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

    # Recursively resolve every relative `./x.js` / `'./x.js'` import of the
    # packaged modules — the explicit JS_FILES list alone silently ships a
    # broken zip when a module is added (e.g. src/tab-groups-sw.js) but
    # forgotten here: the service worker would fail to import it at runtime.
    resolve_js_imports(root, included)

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


# Matches the repo's ESM import forms: `import { x } from './a.js'`,
# `import './b.js'` (double or single quotes), and dynamic `import('./c.js')`.
IMPORT_RE = re.compile(r"""(?:(?:from|import)\s+['"]|import\s*\(\s*['"])([^'"]+\.js)['"]""")


def resolve_js_imports(root, included):
    """Add every relative JS import referenced by the packaged modules.

    Walks the packaged .js files until no new file appears; a relative target
    is resolved against the importing file's directory. Non-relative targets
    (bare specifiers) and non-.js imports are ignored. This makes the
    explicit JS_FILES list a seed rather than the whole truth, so a forgotten
    module can no longer produce a zip that fails to load.
    """
    arcnames = set(included)
    changed = True
    while changed:
        changed = False
        for arc in list(arcnames):
            if not arc.endswith('.js'):
                continue
            try:
                with open(os.path.join(root, arc), encoding='utf-8') as f:
                    text = f.read()
            except OSError:
                continue
            for target in IMPORT_RE.findall(text):
                if not target.startswith('.'):
                    continue
                resolved = os.path.normpath(
                    os.path.join(os.path.dirname(arc), target)).replace('\\', '/')
                if resolved in arcnames:
                    continue
                full = os.path.join(root, resolved)
                if os.path.isfile(full):
                    included[resolved] = full
                    arcnames.add(resolved)
                    changed = True
                else:
                    print(f'WARNING: import target not found: {arc} -> {resolved}')


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
        help='Output zip path (default: tmp/vBookmarks_[ver].zip)'
    )
    parser.add_argument(
        '--target', '-t',
        choices=['chrome', 'edge', 'firefox'],
        default='chrome',
        help='Target browser (default: chrome). See docs/browser-compat.md.'
    )
    args = parser.parse_args()

    if args.target == 'firefox':
        # Not packageable without a build step — see docs/browser-compat.md
        # for the full evaluation (module service worker, sidePanel,
        # tabGroups, /_favicon/, chrome.proxy PAC all lack Firefox MV3
        # equivalents as-is).
        print('Firefox is not supported by this package: the extension uses a')
        print('module service worker, chrome.sidePanel, tab groups, the')
        print('/_favicon/ endpoint and a chrome.proxy PAC hook, none of which a')
        print('Firefox MV3 build can run without a bundling + feature-degrade')
        print('pass. See docs/browser-compat.md for the full evaluation.')
        sys.exit(1)

    root = get_repo_root()
    manifest = load_manifest(root)
    version = manifest.get('version', 'unknown')

    if args.output:
        output_path = args.output
    else:
        out_dir = os.path.join(root, 'tmp')
        os.makedirs(out_dir, exist_ok=True)
        name = f'vBookmarks_{version}.zip' if args.target == 'chrome' \
            else f'vBookmarks_{args.target}_{version}.zip'
        output_path = os.path.join(out_dir, name)

    included = collect_files(root, manifest)

    print(f'Packaging vBookmarks v{version} (target: {args.target})')
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
