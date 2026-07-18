vBookmarks
==============

[English Readme](README.md) | [中文说明](README.zh.md)

[![Donate me](https://img.shields.io/badge/donate-me-orange.svg)](../donation/donation.md) | [![捐赠](https://img.shields.io/badge/捐赠-支持-orange.svg)](../donation/donation.zh.md)

![Image of vBookmarks](../assets/store/vbookmarks.png)

[Available on WebStore](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb) · [HomePage](http://windviki.github.com/vBookmarks/)

**vBookmarks** is a fast, keyboard-first bookmark manager for Chrome, living in the toolbar popup and — if you like — in Chrome's side panel. It grew out of the excellent [Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks) and has been refined for over a decade: hierarchical tree, instant fuzzy search, context menus, drag & drop, separators, and a modern, themeable UI.

Licensed under the [MIT License](http://www.opensource.org/licenses/mit-license.php). Read the [FAQ](https://github.com/windviki/vBookmarks/wiki/FAQ).


# Why vBookmarks

- **Modern, calm UI** — a full design-token system with five looks: follow-system, light, dark, plus two crafted "fable" themes: **Ink** (deep dark) and **Paper** (warm light).
- **Find anything instantly** — fzf-style fuzzy search with match highlighting (CJK-friendly), and a **command palette** (`Ctrl/Cmd+K`) unifying bookmark search, folder jumps and power commands.
- **Power tools built in** — duplicate cleaner (`/dupes`), dead-link scanner (`/dead`), session saver (`/session`), one-click undo for every delete.
- **Quick add everywhere** — star button in the popup, `Ctrl/Cmd+D`, or "Bookmark this page" from the page context menu.
- **Sync-aware** — on Chrome 138+ it understands Chrome's dual local/synced bookmark storage: local-only subtrees are gently dimmed, roots are labeled `(Local)` / `(Synced)`, and cross-storage drags are blocked with a polite toast instead of a hard failure.
- **43 languages**, all aligned to the English baseline and kept in sync by an LLM-assisted translation pipeline.
- **Private by design** — plain ES6+ JavaScript, no framework, no build step, no telemetry; the source you inspect is the code you run.


# Feature highlights

1. Bookmark current tab before/after a selected bookmark or folder, or to the top/bottom of a folder.
2. Add sub-folders, update a bookmark's URL with the current tab, copy title + URL to the clipboard.
3. Recently-added section: the 20 newest bookmarks on top of the tree, collapsible and can be disabled.
4. Folder content sorting: by title or date, folders-first option, optional recursion.
5. Synchronizable bookmark separators with customizable style.
6. Dark theme done right: light / dark / follow-system / ink / paper on shared design tokens.
7. Optional side-panel mode (opt-in setting; popup stays the default), with an `Alt+Shift+B` shortcut.
8. Command palette (`Ctrl/Cmd+K`, or `Ctrl/Cmd+Shift+K` globally) and omnibox search: type `*` + Space in the address bar.
9. Full keyboard support and drag & drop rearranging.
10. Sync-status awareness with quiet visuals (no green-dot noise): only local-only and unsyncable rows are marked.


![Image of vBookmarks features](../assets/store/vbookmarks-menu.png)


# What's new in 4.0

**Experience**

- The donation banner was redesigned into a gentle three-choice card (Donate / Later / Don't show again) — no more countdowns, focus traps or forced clicks.
- Search field fixed and modernized: click-through dead zone removed, a proper clear button that always appears when text is present.
- Adding a bookmark/folder/separator into a collapsed folder now works visibly: the folder expands and shows the new node immediately (previously it silently appeared only after reopening the popup).
- "Copy title and URL" works again — moved to the async Clipboard API (`clipboardWrite` permission) since `execCommand('copy')` was silently rejected outside user-gesture context.
- Sync presentation reworked: green-dot noise inverted (synced rows stay quiet), tooltips localized, dual-storage roots labeled `(Local)`/`(Synced)`, cross-storage drag blocking now shows a toast instead of a popup-killing `alert()`, and the long-dormant "highlight unsynced" option finally works (dims local-only subtrees).

**Platform & code**

- Repository reorganized for the v4 era: first-party JS in `src/`, pages in `pages/`, styles in `css/`, images split into `assets/icons` (shipped) vs `assets/store` + `assets/design` (not shipped); obsolete artifacts (old `release/*.crx`, MV2 leftovers) were dropped — they live on in git history.
- Inline SVG icons throughout (folder, bookmarklet, twisties, search, star); bitmap tree icons retired.
- 661 unit tests (Vitest) covering every module; headless Docker smoke + screenshot harness with multi-language captures.
- Unified locale tooling (`scripts/i18n.py`): audit key usage, diff locales against the English baseline, batch LLM translation, and a verify gate with menu-length warnings. Baseline grew from 75 to 139 keys, all 43 locales aligned.


# Notes for advanced features

1. **Omnibox search** — type `*` in the address bar, press Space, then enter your keywords.
2. **Full keyboard support** — ↑↓←→ to move, Space/Enter to open, Home/End, PageUp/PageDown, Delete all work as expected.
3. Press `F2` on a selected bookmark/folder to rename it.
4. Middle-click a folder to open all its bookmarks (as a color-coded tab group).
5. `Ctrl+F` focuses the search field; `Esc` clears the search.
6. Drag & drop to rearrange; dragging across synced/local storage is safely blocked with an explanation.
7. Decide whether the popup closes after opening a bookmark (option in settings).
8. Show only the Bookmark Bar (option in settings).
9. Open bookmarks in background tabs (option in settings).
10. Control the popup zoom level in settings.
11. **Advanced settings** (entry at the top right of the settings page): customize separator title/URL/style.
12. **Advanced settings**: custom CSS for the whole popup (CodeMirror editor), e.g. `* { font-family: Consolas; }`.
13. **Advanced settings**: replace the toolbar icon with your own.
14. Disable popup auto-resize to keep a fixed height.


# For developers

No build step — **Load unpacked** the repo root in `chrome://extensions/`.

```bash
# Unit tests (Vitest, 661 cases across 22 suites)
npm install
npm run test:run

# Headless smoke + screenshot harness (Docker; shots land in tmp/shots/)
scripts/screenshots/run.sh                # smoke + all suites
scripts/screenshots/run.sh --smoke-only   # zero-console-error check only
#   shots.js         interaction states (light/dark)
#   shots-themes.js  ink + paper themes
#   shots-i18n.js    tree/menus/edit-dialog/options × 8 UI languages

# Locale pipeline (scripts/i18n.py, stdlib only)
python3 scripts/i18n.py audit      # keys used in code vs en baseline
python3 scripts/i18n.py missing    # per-locale missing / [TODO] report
python3 scripts/i18n.py translate --apply   # LLM batch translation
python3 scripts/i18n.py verify     # gate: alignment, TODOs, menu lengths
# translate reads the LLM endpoint from a git-ignored repo-root .env:
#   VBM_LLM_API_KEY=...  VBM_LLM_BASE_URL=...  VBM_LLM_MODEL=...
#   VBM_LLM_API_TYPE=openai|anthropic_messages

# Release zip (version read from manifest.json)
python3 scripts/package.py         # → tmp/vBookmarks_<version>.zip
```

`tmp/` and `.env` are git-ignored. When adding runtime files, keep the include list in `scripts/package.py` in sync; see `AGENTS.md` for the full contributor guide.


# Technical details

- Powered by plain ES6+ JavaScript (no framework, no bundler); [CodeMirror](http://codemirror.net/) backs the Custom CSS editor.
- Successor of [Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks) — thanks to [cheeaun](https://github.com/cheeaun) for the original work.
- Old pre-4.0 releases (`release/*.crx`) were removed from the working tree and remain available in git history.


# Changelogs

**ver4.0 2026/07/18**

New: Ink & Paper "fable" themes; command palette (`Ctrl/Cmd+K`); quick-add star button; collapsible recently-added section; redesigned gentle donation card; sync status presentation rework (quiet dots, localized tooltips, `(Local)`/`(Synced)` root labels, blocked-drag toast, working "highlight unsynced" dimming).

Fixed: search field click-through and unreliable native clear button (custom clear button now); adding into collapsed folders is immediately visible; copy title/URL via the async Clipboard API (`clipboardWrite` permission added).

Changed: repository reorganized (`src/`, `pages/`, `css/`, `assets/`, `scripts/`); obsolete `release/` and MV2 leftovers removed (kept in git history); all icons are inline SVG now; locale baseline grew to 139 keys with all 43 locales re-aligned through the new `scripts/i18n.py` LLM pipeline; test suite grew to 661 cases; Docker smoke + screenshot harness extended with multi-language captures.


**ver3.7 2026/05/10**

New: [#36](https://github.com/windviki/vBookmarks/issues/36): Add auto-resize popup toggle option. Enable/disable automatic popup height adjustment in General settings.

Fixed: [#42](https://github.com/windviki/vBookmarks/issues/42): Extension broken in Chrome 148 due to deprecated `<command>` HTML element. Replaced with `<div>` elements for full compatibility.

New: Full 42-language support synced from cc-dev branch, all aligned with English baseline (75 keys). Languages: ar, bg, bn, cs, da, de, el, en, es, et, fa, fi, fr, he, hi, hr, hu, id, it, ja, ko, lt, lv, mk, nl, no, pl, pt, pt_BR, pt_PT, ro, ru, sk, sl, sv, th, tr, uk, vi, zh, zh_HK, zh_TW.


**ver3.6 2024/01/08**

Fixed: [#31](https://github.com/windviki/vBookmarks/issues/31): Custom icon not working.


**ver3.5 2023/09/04**

Fixed: [#29](https://github.com/windviki/vBookmarks/issues/29): cursor focus doesn't stay in search bar after clearing the search text.

Fix shortcut in manifest. Now the default shortcut is Ctrl+Shift+V (Ctrl+Shift+B cannot work in new Chrome.)


**ver3.4 2023/02/14**

Fixed: [#26](https://github.com/windviki/vBookmarks/issues/26): open directory in the background.

New: Key Right to open context menu (when focus on an opened dir or a bookmark) and key Left to close it (when context menu is showing).

Remove timeout of height reset. Speed up the popup.


**ver3.3 2023/02/02**

Fixed: [#23](https://github.com/windviki/vBookmarks/issues/23): Incorrect link on the options page.

Fixed: [#26](https://github.com/windviki/vBookmarks/issues/26): Middle/Ctrl click no longer opens bookmarks in the background in Chrome 107.

New: [#24](https://github.com/windviki/vBookmarks/issues/24): Add new option to disable incremental search (use ENTER to search).

Fixed: The stupid double scroll bar (finally).

Fixed: Focus lost when quit from search mode.

Fixed: Arrow down triggers an error in search mode.

Fix some undefined errors.

Update code to manifest V3. minimum_chrome_version = 88.


**ver3.2 2020/09/12**

Fixed: [#19](https://github.com/windviki/vBookmarks/issues/19): "Add to the end of folder" feature does not work bugs.

New: [#15](https://github.com/windviki/vBookmarks/issues/15): Search for folders in bookmark search bar.

New: Resize the height of popup.

Added: Italy language.

Added: Russian language. Thanks for @Stanislav .

Fix some undefined errors.

Update code to ecmascript version 6. minimum_chrome_version = 61.



**ver3.1 2020/07/03**

Fixed: [#12](https://github.com/windviki/vBookmarks/issues/12): Focus lost when clear the menu.

Fixed: [#18](https://github.com/windviki/vBookmarks/issues/18): Tree does not scroll when drag to top or bottom.

Fix an undefined error when pressing key DOWN.

Fix the support of bookmarklet. Thanks for @ZG-nico.

Added: France language. Thanks for @Fab-fr.

Added: Chinese Hong Kong language.


**ver3.0 2019/08/22**

Fixed: New icons.


**ver2.9 2019/08/22**

Fixed: Double scrollbar since Chrome version 77+.


**ver2.8 2019/05/06**

Fixed: Open URL twice when clicked by middle button of mouse. https://github.com/windviki/vBookmarks/issues/9

Fixed: Sometimes search will fail. https://github.com/windviki/vBookmarks/issues/7

Fixed: Context menu position.

Improved: Scrollbar CSS style.

Added: Placeholder "\_\_VBM_CURRENT_TAB_URL\_\_" in bookmark URL to make some bookmarklets work (Chrome does not allow _document.location.href_ in BMlet). It will be replaced with URL of current active tab when you click BMlet from vBookmarks.


**ver2.6 2013/10/21**

Fixed: Remove double scroll bars.


**ver2.5 2013/08/30**

Fixed: Remove HTML notifications because it is not available now. https://bugs.webkit.org/show_bug.cgi?id=98388.


**ver2.4 2013/08/29**

Fixed: "Unexpected end of input" in js.


**ver2.3 2013/04/09**

Fixed: Context menu will be dismissed when scrolling up/down (broken again in previous version).

Fixed: Remember position of scroll bar (broken again in previous version).


**ver2.2 2013/04/02**

Fixed: Scroll bar does not work above chrome 26+ (not well tested).


**ver2.1 2012/12/12**

Fixed: Now it can remember and restore position of scroll bar correctly.

Improved: Position of context menu. And context menu will be dismissed when scrolling up/down.

Added: Cancel button for dialogs in vbookmarks.


**ver2.0 2012/11/01**

Fixed: Version checking in background.js.

Improved: Synchronizable separators.

Added: Advanced options for separator.


- "The real title of bookmark which is shown as a separator": By default it is "|". That means the separators you added in vbookmarks will be shown as a normal bookmark in Chrome bookmark manager or bookmark menu, with this title value. You can modify it to "------------" so that you can split your bookmarks horizontally even if you check your bookmarks in Chrome bookmark menu.


- "The real URL of bookmark which is shown as a separator": By default it is "http://separatethis.com/". It's a "online separator". The separators you added in vbookmarks will be shown as a normal bookmark in Chrome bookmark manager or bookmark menu, with this URL value.


- "If URL of a bookmark contains this string, it will be shown as a separator": If you set this value (you can set several URLs joined by ";"), all bookmarks whose URL contains any of them will be shown as real separators in vbookmarks. e.g. if you set it to google.com, all google services in your bookmarks will be shown as separators.


**ver1.9 2012/08/19**

Fixed: Neatbookmarks bug: Scrollbar will be reset to the top when opening and scrolling the popup down.

Updated: Color of ICON.

Updated: Style of separator.


**ver1.8 2012/08/01**

Added: Separators for bookmarks/folders. But it is a local record and cannot be synchronized between different devices. see https://github.com/windviki/vBookmarks/issues/3

Fixed: Neatbookmarks bug: Wrong position of dragged bookmark when vertical scrollbar is scrolled down (since Chrome18).

Added: Color of icon is changed to red.

Added: Simple update checking and desktop notification.

Removed: Several languages. Only 4 locales are left: en, ja, zh, zh_TW. Cannot maintain many translations any more.


**ver1.7 2012/06/26**

Fixed: Double scrollbars in Chrome 19. Sorry for the previous untest release. I do not have many different Chromes in different versions :)

Fixed: Width resetting occured when expanding root folder. https://github.com/windviki/vBookmarks/issues/2


**ver1.6 2012/06/24**

Fixed: Cannot search bookmarks in Omnibox (*+space). [Content Security Policy]

Fixed: Restore width of the popup window. [Content Security Policy]

Fixed: Dialogs cannot submit their forms. [Content Security Policy]


**ver1.5 2012/06/21**

Fixed: manifest problem in Chrome 20+.

Fixed: separated script file instead of inline scripts. see Content Security Policy http://code.google.com/chrome/extensions/contentSecurityPolicy.html


**ver1.4 2012/06/20**

Fixed: Scrollbar problem in Chrome 18,19. https://github.com/windviki/vBookmarks/issues/2


**ver1.3 2012/05/25**

Fixed: Scrollbar glitch. https://github.com/windviki/vBookmarks/issues/1


**ver1.2 2011/11/30**

Added: update selected bookmark with current URL.

Added: copy title and URL of selected bookmark to clipboard.

Fixed: after adding new bookmark or folder to a closed folder, its original children cannot be shown correctly.

Fixed: make up some missing translations for cs(Czech).


**ver1.1 2011/11/16**

Added: option for only displaying bookmarks in Bookmark Bar.

Added: context menu for adding folder before/after bookmark/folder.

Fixed: some translations in multi-language support.


**ver1.0 2011/11/15**

First version.


# Attentions

Installing from source ("Load unpacked") or the Web Store build is recommended. Legacy crx sideloading notes: above Chrome 20+, drag the crx file to `chrome://chrome/extensions/`; above Chrome 22+, add `--enable-easy-off-store-extension-install` to accept extensions from outside the Web Store (see [details](http://www.howtogeek.com/120743/how-to-install-extensions-from-outside-the-chrome-web-store/)).

Available on [WebStore](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb) — the recommended way to use this extension.
