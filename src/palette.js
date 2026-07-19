/**
 * Command palette (P2) — a Ctrl/Cmd+K overlay unifying "search bookmarks /
 * jump to folder / run a command" behind one input, in the spirit of
 * alyssaxuu/omni but mapped onto the capabilities the popup already has.
 *
 * The overlay markup lives in popup.html/sidepanel.html (#command-palette >
 * #palette-input + #palette-results); this module owns its behavior: the
 * open/close state machine, the per-open fuzzy index rebuild (flattened from
 * chrome.bookmarks.getTree — a node with children is a folder, everything
 * else a bookmark), result composition (commands first, then
 * window.VBMFuzzy-ranked bookmarks/folders; a leading '/' restricts the
 * panel to commands so P3 can register /dupes, /dead & co. later) and the
 * keyboard/mouse dispatch (arrows with rollover, Enter, Ctrl/Cmd+Enter for a
 * new tab, Escape, click = Enter).
 *
 * initPalette(ctx) is called once by neat.js after treeView/actions init.
 * ctx.store        — settings store (reserved; the palette reads nothing yet)
 * ctx.actions      — actions.js API (openBookmark/openBookmarkNewTab/
 *                    addNewBookmarkNode/addSeparator; deleteBookmark for the
 *                    /dead row disposal, undo capture + toast included)
 * ctx.treeView     — tree-view.js API (revealFolder)
 * ctx.quickAdd     — neat.js's quickAddCurrentTab
 * ctx.rootFolderId — folder the create-style commands drop new nodes into
 *                    (neat.js passes store.get('quickAddFolderId', '1'))
 * ctx.dialogs      — dialogs.js API (ConfirmDialog/AlertDialog), used by the
 *                    /dupes cleanup confirmations and the session-save alerts
 * ctx.onChanged    — re-pulls the bookmark tree into the tree view after a
 *                    cleanup removed nodes or a session save added a folder
 * ctx.separatorManager — separators.js API (isSeparator); /dead filters
 *                    separators out of the scan set
 *
 * P3.1 adds a second panel mode: running the "dupes" command (slash name
 * /dupes) switches the result list to duplicate-bookmark groups — one row
 * per normalized-URL collision plus a clean-all row on top — with
 * ConfirmDialog-guarded batch deletion behind each. Escape closes the
 * panel outright; the mode resets on close, there is no nested "back".
 *
 * P3.2 adds the session-save command (slash name /session): it snapshots
 * the current window's tabs into a new bookmark folder under
 * ctx.rootFolderId (session.js does the scheme filtering, dedup and the
 * sequential creation), then alerts the saved count and repaints the tree
 * through ctx.onChanged. A window with nothing bookmarkable gets the
 * sessionEmpty alert and the panel stays open.
 *
 * P3.5 adds the dead-link scan (slash name /dead): the flattened tree
 * (bookmarks only, separators filtered out through ctx.separatorManager —
 * their URLs are http(s) and would be probed otherwise) goes through
 * dead-links.js's concurrency-pooled fetch scan right inside the popup.
 * While it runs, the result list is a single progress line; afterwards it
 * is a rescan row plus one row per dead bookmark, badged with the HTTP
 * status (or 'timeout'/'error'). Enter on a dead row confirms through
 * ConfirmDialog and deletes via ctx.actions.deleteBookmark, so the undo
 * capture + toast + tree-row removal ride along; Escape aborts the scan.
 * The scan deliberately lives in the popup, not an offscreen document:
 * disposal is interactive (the user watches progress, then acts on rows),
 * and <all_urls> host permission already covers the cross-origin fetches.
 *
 * Returns { open, close, isOpen }. neat.js wires the global-wake auto-open
 * (URL ?palette=1 / storage.session flag) on top of open().
 *
 * chrome.bookmarks/tabs, chrome.i18n.getMessage, document and window.VBMFuzzy
 * remain page globals. No neatools helpers: getElementById/classList and the
 * module-private htmlspecialchars below (same implementation as
 * tree-render.js's, modules stay self-contained).
 */

import { normalizeUrl, findDupes, planDeletion } from './dupes.js';
import { sessionFolderName, tabsToBookmarks, saveSession } from './session.js';
import { filterScannable, startDeadScan, collectDead, statusLabel } from './dead-links.js';
import { FOLDER_ICON } from './icons.js';

// neatools' String.prototype.htmlspecialchars as a pure function: escape
// >, then <, then " (order matters, ">" first so "&gt;" is not re-escaped).
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function initPalette(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const actions = ctx.actions;
    const treeView = ctx.treeView;
    const quickAdd = ctx.quickAdd;
    const dialogs = ctx.dialogs;
    const onChanged = ctx.onChanged || (() => {});
    const rootFolderId = ctx.rootFolderId || '1';
    const clearMenu = ctx.clearMenu; // context-menu.js's clearMenu (Escape layering)

    const $palette = $('command-palette');
    const $input = $('palette-input');
    const $results = $('palette-results');

    // A dialog (confirm/edit/alert/new-folder/sort) owns the popup's modal
    // layer; the palette must not open over or steal keys from it.
    const DIALOG_CLASSES = ['needConfirm', 'needEdit', 'needAlert', 'needInputName', 'needSort'];
    const anyDialogOpen = () =>
        DIALOG_CLASSES.some(c => document.body.classList.contains(c));

    // --- State --------------------------------------------------------------
    let openState = false;
    let index = [];          // flattened { id, title, url, dateAdded, isFolder }
    let rows = [];           // rendered rows: { kind, el, id, url, name, fn }
    let selected = -1;       // index into rows, -1 = nothing highlighted
    let mode = 'normal';     // 'normal' | 'dupes' | 'dead'
    let dupeGroups = [];     // findDupes() result backing the dupes-mode rows
    let deadScan = null;     // startDeadScan() controller while a scan runs
    let deadItems = [];      // scannable bookmarks of the current scan
    let deadResults = null;  // Map id → checkUrl result (null = scan in flight)
    let deadProgress = 0;    // settled checks, for the deadChecking line

    // /dead must never probe separators (their URLs are http(s)); the manager
    // is injected by neat.js, tests may leave it out.
    const separatorManager = ctx.separatorManager;
    const isSeparator = separatorManager
        ? (title, url) => separatorManager.isSeparator(title, url)
        : null;

    // Flatten a bookmark tree: a node with children is a folder, everything
    // else a bookmark; the synthetic root ('0') is skipped. Shared by the
    // fuzzy index and the dupes scan.
    const flattenTree = tree => {
        const items = [];
        const walk = nodes => {
            for (let i = 0, l = nodes.length; i < l; i++) {
                const node = nodes[i];
                if (node.children) {
                    if (node.id !== '0') {
                        items.push({
                            id: node.id,
                            title: node.title || '',
                            url: '',
                            dateAdded: node.dateAdded || 0,
                            isFolder: true
                        });
                    }
                    walk(node.children);
                } else {
                    items.push({
                        id: node.id,
                        title: node.title || '',
                        url: node.url || '',
                        dateAdded: node.dateAdded || 0,
                        isFolder: false
                    });
                }
            }
        };
        walk(tree || []);
        return items;
    };

    // Rebuild the fuzzy index from a fresh bookmark tree (called on every
    // open so entries never go stale while the popup lives).
    const rebuildIndex = () => {
        chrome.bookmarks.getTree(tree => {
            index = flattenTree(tree);
            render(); // re-render with the fresh index (input may hold a query)
        });
    };

    // --- Dupes mode (P3.1) ----------------------------------------------------
    // chrome.bookmarks.remove is callback-only; chain the ids so the deletions
    // hit the backend strictly one after another, then report done.
    const removeSequentially = items =>
        items.reduce((chain, item) => chain.then(() =>
            new Promise(resolve => chrome.bookmarks.remove(item.id, resolve))),
            Promise.resolve());

    const refreshDupes = () => {
        chrome.bookmarks.getTree(tree => {
            dupeGroups = findDupes(flattenTree(tree).filter(b => !b.isFolder));
            render();
        });
    };

    const enterDupesMode = () => {
        mode = 'dupes';
        $input.value = '';
        refreshDupes();
    };

    const cleanGroup = group => {
        const doomed = planDeletion(group); // keep the oldest entry
        dialogs.ConfirmDialog.open({
            dialog: _m('dupesConfirmGroup', `${doomed.length}`),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                removeSequentially(doomed).then(() => {
                    onChanged();
                    refreshDupes(); // stay in dupes mode with the rebuilt list
                });
            }
        });
    };

    const cleanAll = () => {
        const doomed = dupeGroups.reduce((all, g) => all.concat(planDeletion(g)), []);
        const groupCount = dupeGroups.length;
        dialogs.ConfirmDialog.open({
            dialog: _m('dupesConfirmAll', [`${doomed.length}`, `${groupCount}`]),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                removeSequentially(doomed).then(() => {
                    onChanged();
                    close();
                    dialogs.AlertDialog.open(_m('dupesDone', `${doomed.length}`));
                });
            }
        });
    };

    // --- Dead-link scan (P3.5) ----------------------------------------------
    // The scan runs in the popup itself (see the module header). Every stage
    // re-checks `mode`: the panel may close — and abort the scan — while the
    // tree read or a check is in flight, and late resolutions must not paint.
    const startDeadModeScan = () => {
        deadResults = null;
        deadProgress = 0;
        chrome.bookmarks.getTree(tree => {
            if (mode !== 'dead')
                return;
            deadItems = filterScannable(flattenTree(tree), isSeparator);
            render(); // progress line at 0/total
            deadScan = startDeadScan(deadItems, {
                onProgress: done => {
                    deadProgress = done;
                    if (mode === 'dead')
                        render();
                }
            });
            deadScan.promise.then(results => {
                deadScan = null;
                if (mode !== 'dead') // closed mid-scan: drop the partials
                    return;
                deadResults = results;
                render();
            });
        });
    };

    const enterDeadMode = () => {
        mode = 'dead';
        $input.value = '';
        startDeadModeScan();
    };

    const removeDeadItem = item => {
        actions.deleteBookmark(item.id);
        deadResults.delete(item.id);
        deadItems = deadItems.filter(b => b.id !== item.id);
        render();
    };

    const removeAllDead = () => {
        const dead = collectDead(deadItems, deadResults);
        dialogs.ConfirmDialog.open({
            dialog: _m('deadConfirmAll', `${dead.length}`),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                const ids = dead.map(b => b.id);
                // Delete sequentially so undo captures stack per-item
                ids.reduce((chain, id) => chain.then(() =>
                    new Promise(resolve => {
                        actions.deleteBookmark(id);
                        deadResults.delete(id);
                        resolve();
                    })), Promise.resolve()).then(() => {
                    deadItems = deadItems.filter(b => !ids.includes(b.id));
                    render();
                });
            }
        });
    };

    // Dead mode: the query box is inert — while scanning, one progress line;
    // afterwards a "delete all" row + rescan row + one badged row per dead
    // bookmark, or the deadNone empty-state when everything resolved ok.
    const renderDead = () => {
        if (!deadResults) {
            const li = document.createElement('li');
            li.className = 'palette-empty';
            li.textContent = _m('deadChecking', [`${deadProgress}`, `${deadItems.length}`]);
            $results.appendChild(li);
            return;
        }
        const dead = collectDead(deadItems, deadResults);
        if (!dead.length) {
            const li = document.createElement('li');
            li.className = 'palette-empty';
            li.textContent = _m('deadNone');
            $results.appendChild(li);
            return;
        }
        addRow({ kind: 'dead-all', fn: removeAllDead, name: _m('deadDeleteAll', `${dead.length}`) });
        addRow({ kind: 'dead-rescan', fn: startDeadModeScan, name: _m('deadRescan') });
        for (let i = 0, l = dead.length; i < l; i++) {
            const item = dead[i];
            addRow({
                kind: 'dead',
                fn: () => removeDeadItem(item),
                title: item.title || item.url,
                url: item.url,
                badge: statusLabel(deadResults.get(item.id))
            });
        }
    };

    // --- Session save (P3.2) ------------------------------------------------
    // Snapshot the current window's tabs into a fresh folder under
    // rootFolderId. keepOpen so the nothing-bookmarkable case can alert
    // without dropping the panel; the success path closes explicitly before
    // alerting, mirroring cleanAll's close-then-alert order.
    const saveWindowSession = () => {
        chrome.tabs.query({ 'currentWindow': true }, tabs => {
            const bookmarks = tabsToBookmarks(tabs);
            if (!bookmarks.length) {
                dialogs.AlertDialog.open(_m('sessionEmpty'));
                return;
            }
            saveSession({
                rootFolderId,
                folderName: sessionFolderName(new Date(), _m('sessionFolderName')),
                tabs: bookmarks
            }).then(({ count }) => {
                close();
                dialogs.AlertDialog.open(_m('sessionSaved', `${count}`));
                onChanged();
            });
        });
    };

    // --- Command set v1 -----------------------------------------------------
    // Names resolve through i18n at render time; fn runs on Enter/click.
    // "New folder" rides actions.addNewBookmarkNode with an empty url —
    // addNewNode routes an empty newUrl into the NewFolderDialog flow, the
    // same idiom the context menu's add-folder-* entries use. "New bookmark"
    // mirrors quickAddCurrentTab's silent no-op when there is no current tab.
    // The dupes command carries keepOpen: it switches the panel into dupes
    // mode instead of closing it; `slash` is its omni-style alias, matched
    // as a prefix of a '/'-prefixed query. The session command keeps the
    // panel open across its async save the same way, closing explicitly on
    // success so the empty-window alert can leave the panel up.
    const newBookmarkFromTab = () => {
        chrome.tabs.query({
            'active': true,
            'windowId': chrome.windows.WINDOW_ID_CURRENT
        }, tabs => {
            const tab = tabs && tabs[0];
            if (!tab || !tab.url)
                return;
            actions.addNewBookmarkNode(rootFolderId, 'bottom', tab.url, tab.title || '');
        });
    };
    const commands = [
        { name: () => _m('paletteCmdQuickAdd'), fn: () => quickAdd() },
        { name: () => _m('paletteCmdNewBookmark'), fn: newBookmarkFromTab },
        { name: () => _m('paletteCmdNewFolder'), fn: () => actions.addNewBookmarkNode(rootFolderId, 'bottom', '', '') },
        { name: () => _m('paletteCmdNewSeparator'), fn: () => actions.addSeparator(rootFolderId, 'bottom') },
        { slash: 'dupes', keepOpen: true, name: () => _m('paletteCmdDupes'), fn: enterDupesMode },
        { slash: 'dead', keepOpen: true, name: () => _m('paletteCmdDead'), fn: enterDeadMode },
        { slash: 'session', keepOpen: true, name: () => _m('paletteCmdSaveSession'), fn: saveWindowSession }
    ];

    // --- Rendering ------------------------------------------------------------
    const faviconUrl = url =>
        `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;

    const addRow = row => {
        const li = document.createElement('li');
        li.className = `palette-row palette-${row.kind}`;
        // Bookmark/folder rows carry <a> tags and results-item-${id} IDs so the
        // existing context-menu.js handler (which walks up to nearest a/span and
        // strips the results-item- prefix) can open bookmark/folder context menus
        // on palette rows — no special-casing needed.
        if (row.kind === 'command') {
            li.innerHTML = `<span class="palette-kind">▸</span><span class="palette-title">${htmlspecialchars(row.name)}</span>`;
        } else if (row.kind === 'folder') {
            li.id = row.id ? `results-item-${row.id}` : '';
            li.innerHTML = `<a href="" class="link-folder tree-item-link"><div class="favicon-container">${FOLDER_ICON}</div><i>${htmlspecialchars(row.title)}</i></a>`;
        } else if (row.kind === 'dupes-all' || row.kind === 'dead-all' || row.kind === 'dead-rescan') {
            li.innerHTML = `<span class="palette-kind">▸</span><span class="palette-title">${htmlspecialchars(row.name)}</span>`;
        } else if (row.kind === 'dupe') {
            li.innerHTML = `<span class="palette-title">${htmlspecialchars(row.title)} <span class="palette-url">${htmlspecialchars(row.count)}</span></span><span class="palette-url">${htmlspecialchars(row.url)}</span>`;
        } else if (row.kind === 'dead') {
            li.innerHTML = `<span class="palette-title">${htmlspecialchars(row.title)} <span class="palette-badge">${htmlspecialchars(row.badge)}</span></span><span class="palette-url">${htmlspecialchars(row.url)}</span>`;
        } else {
            // bookmark row: <a> tag so context-menu.js recognises it
            const title = row.title || row.url;
            li.id = row.id ? `results-item-${row.id}` : '';
            li.innerHTML = `<a href="${htmlspecialchars(row.url)}" class="tree-item-link"><div class="favicon-container"><img src="${faviconUrl(row.url)}" width="16" height="16" alt=""></div><i>${htmlspecialchars(title)}</i></a>`;
        }
        const i = rows.length;
        li.addEventListener('click', e => {
            e.preventDefault(); // prevent <a> navigation, let execute() drive
            execute(i, false);
        });
        $results.appendChild(li);
        row.el = li;
        rows.push(row);
    };

    const updateSelection = () => {
        for (let i = 0, l = rows.length; i < l; i++) {
            if (i === selected)
                rows[i].el.classList.add('selected');
            else
                rows[i].el.classList.remove('selected');
        }
    };

    // Dupes mode: the query box is inert — rows are the clean-all command
    // (with the totals spelled out) plus one row per colliding group, or a
    // single empty-state line when the tree has no duplicates.
    const renderDupes = () => {
        if (!dupeGroups.length) {
            const li = document.createElement('li');
            li.className = 'palette-empty';
            li.textContent = _m('dupesNone');
            $results.appendChild(li);
            return;
        }
        const extra = dupeGroups.reduce((n, g) => n + g.items.length - 1, 0);
        addRow({
            kind: 'dupes-all',
            fn: cleanAll,
            name: _m('dupesCleanAll', [`${dupeGroups.length}`, `${extra}`])
        });
        for (let i = 0, l = dupeGroups.length; i < l; i++) {
            const group = dupeGroups[i];
            addRow({
                kind: 'dupe',
                fn: () => cleanGroup(group),
                title: group.title || group.key,
                count: _m('dupesGroupCount', `${group.items.length}`),
                url: group.key
            });
        }
    };

    const render = () => {
        rows = [];
        selected = -1;
        $results.innerHTML = '';
        if (mode === 'dupes') {
            renderDupes();
            updateSelection();
            return;
        }
        if (mode === 'dead') {
            renderDead();
            updateSelection();
            return;
        }
        const query = $input.value.trim();
        const slashMode = query.charAt(0) === '/';
        const q = slashMode ? query.slice(1) : query;
        // Commands: all on an empty query, fuzzy-filtered otherwise. A '/'
        // prefix restricts the panel to commands (omni-style slash frame) and
        // also matches each command's slash alias by prefix, so '/d' already
        // surfaces /dupes.
        for (let i = 0, l = commands.length; i < l; i++) {
            const cmd = commands[i];
            const name = cmd.name();
            if (!q || window.VBMFuzzy.score(q, name) ||
                (slashMode && cmd.slash && cmd.slash.indexOf(q) === 0))
                addRow({ kind: 'command', name, fn: cmd.fn, keepOpen: !!cmd.keepOpen });
        }
        if (!slashMode && q) {
            const hits = window.VBMFuzzy.rank(q, index).slice(0, 50);
            for (let i = 0, l = hits.length; i < l; i++) {
                const hit = hits[i];
                addRow(hit.isFolder ?
                    { kind: 'folder', id: hit.id, title: hit.title } :
                    { kind: 'bookmark', id: hit.id, title: hit.title, url: hit.url });
            }
        }
        if (!rows.length) {
            const li = document.createElement('li');
            li.className = 'palette-empty';
            li.textContent = _m('paletteNoResults');
            $results.appendChild(li);
        }
        updateSelection();
    };

    // --- Execution ------------------------------------------------------------
    // Command rows run their fn and close (unless they opt into keepOpen —
    // /dupes swaps the panel into dupes mode instead). Dupe rows open a
    // ConfirmDialog over the panel; the actual deletion runs from its
    // callback, so the panel itself stays put.
    const leftClickNewTab = ctx.leftClickNewTab;

    const execute = (i, newTab) => {
        const row = rows[i];
        if (!row)
            return;
        if (row.kind === 'command') {
            row.fn();
            if (row.keepOpen)
                return;
        } else if (row.kind === 'dupes-all' || row.kind === 'dupe' ||
                   row.kind === 'dead-rescan' || row.kind === 'dead' ||
                   row.kind === 'dead-all') {
            row.fn();
            return;
        } else if (row.kind === 'folder') {
            treeView.revealFolder(row.id);
        } else if (newTab) {
            actions.openBookmarkNewTab(row.url, true);
        } else if (leftClickNewTab) {
            // 遵从 options 里 tree 视图的单击设置：新标签页后台打开
            actions.openBookmarkNewTab(row.url, true, true);
        } else {
            actions.openBookmark(row.url);
        }
        close();
    };

    const moveSelection = delta => {
        if (!rows.length)
            return;
        if (selected < 0)
            selected = delta > 0 ? 0 : rows.length - 1;
        else
            selected = (selected + delta + rows.length) % rows.length;
        updateSelection();
    };

    $input.addEventListener('input', render);
    $input.addEventListener('keydown', e => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                moveSelection(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                moveSelection(-1);
                break;
            case 'ArrowRight': {
                e.preventDefault();
                // Dispatch a synthetic contextmenu event on the selected row
                // so the existing context-menu.js handler opens the appropriate
                // bookmark/folder/separator menu — same pattern as tree view
                // (keyboard.js ArrowRight → contextmenu dispatch).
                const row = rows[selected >= 0 ? selected : 0];
                if (!row)
                    break;
                const el = row.el.querySelector('a') || row.el;
                const rect = el.getBoundingClientRect();
                const ev = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rect.right,
                    clientY: rect.bottom
                });
                el.dispatchEvent(ev);
                break;
            }
            case 'ArrowLeft':
                e.preventDefault();
                // Close context menu if one is open over the palette, otherwise
                // go back from dupes/dead sub-mode to normal mode.
                if (clearMenu && document.body.querySelector('.active')) {
                    clearMenu();
                } else if (mode === 'dupes' || mode === 'dead') {
                    mode = 'normal';
                    $input.value = '';
                    render();
                }
                break;
            case 'Home':
                e.preventDefault();
                if (rows.length) {
                    selected = 0;
                    updateSelection();
                }
                break;
            case 'End':
                e.preventDefault();
                if (rows.length) {
                    selected = rows.length - 1;
                    updateSelection();
                }
                break;
            case 'Delete': {
                e.preventDefault();
                const row = rows[selected >= 0 ? selected : 0];
                if (!row)
                    break;
                // Only bookmark and folder rows (not commands/dupes/dead)
                if (row.kind === 'bookmark') {
                    actions.deleteBookmark(row.id);
                    close();
                } else if (row.kind === 'folder') {
                    // Delete a folder — needs children count for the toast.
                    // chrome.bookmarks API must be called; we keep it simple:
                    // fall back to context-menu delete which does the full flow.
                    chrome.bookmarks.getChildren(row.id, children => {
                        const urlsLen = children.map(c => c.url).filter(Boolean).length;
                        actions.deleteBookmarks(row.id, urlsLen, children.length - urlsLen);
                    });
                    close();
                }
                break;
            }
            case 'F2':
                e.preventDefault();
                // F2 renames (non-Mac only, matching tree view's F2 behavior)
                {
                    const row = rows[selected >= 0 ? selected : 0];
                    if (!row)
                        break;
                    if (row.kind === 'bookmark' || row.kind === 'folder') {
                        actions.editBookmarkFolder(row.id);
                        close();
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                execute(selected >= 0 ? selected : 0, e.ctrlKey || e.metaKey);
                break;
            case 'Escape':
                e.preventDefault();
                e.stopImmediatePropagation();
                // If a context menu is open over the palette (e.g. right-clicked
                // a dead-link row), just dismiss the menu — don't close the panel.
                if (clearMenu && document.body.querySelector('.active')) {
                    clearMenu();
                    return;
                }
                close();
                break;
        }
    });

    // --- Open / close -----------------------------------------------------------
    const open = () => {
        if (openState || anyDialogOpen())
            return;
        openState = true;
        $palette.hidden = false;
        $input.value = '';
        $input.placeholder = _m('palettePlaceholder');
        rebuildIndex(); // async; re-renders when the fresh index lands
        render();       // paint the command rows immediately
        $input.focus();
    };

    const close = () => {
        if (!openState)
            return;
        openState = false;
        mode = 'normal'; // dupes/dead mode never survives a close
        dupeGroups = [];
        if (deadScan) { // abort an in-flight dead-link scan
            deadScan.abort();
            deadScan = null;
        }
        deadItems = [];
        deadResults = null;
        $palette.hidden = true;
        // Hand focus back to the tree: the focused row, else its first row,
        // else just drop focus from the input.
        const row = document.querySelector('#tree .focus')
            || document.querySelector('#tree a, #tree span');
        if (row)
            row.focus();
        else
            $input.blur();
    };

    const isOpen = () => openState;

    // Close the palette on outside clicks (tree, search bar). Keep it open
    // when clicking inside the palette or on a context menu / dialog.
    document.addEventListener('mousedown', e => {
        if (!openState) return;
        if ($palette.contains(e.target)) return;
        if (e.target.closest('menu[type=context]')) return;
        if (anyDialogOpen()) return;
        close();
    });

    // Ctrl/Cmd+K toggles the palette. Capture phase so the tree's type-ahead
    // never sees the 'k'; no-op while a dialog owns the modal layer. Distinct
    // from keyboard.js's Ctrl/Cmd+F and neat.js's Ctrl/Cmd+D.
    document.addEventListener('keydown', e => {
        if (!(e.metaKey || e.ctrlKey) || (e.key !== 'k' && e.key !== 'K'))
            return;
        if (anyDialogOpen())
            return;
        e.preventDefault();
        if (openState)
            close();
        else
            open();
    }, true);

    return { open, close, isOpen };
}
