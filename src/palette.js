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
 *                    addNewBookmarkNode/addSeparator)
 * ctx.treeView     — tree-view.js API (revealFolder)
 * ctx.quickAdd     — neat.js's quickAddCurrentTab
 * ctx.rootFolderId — folder the create-style commands drop new nodes into
 *                    (neat.js passes store.get('quickAddFolderId', '1'))
 * ctx.dialogs      — dialogs.js API (ConfirmDialog/AlertDialog), used by the
 *                    /dupes cleanup confirmations
 * ctx.onChanged    — re-pulls the bookmark tree into the tree view after a
 *                    cleanup removed nodes
 *
 * P3.1 adds a second panel mode: running the "dupes" command (slash name
 * /dupes) switches the result list to duplicate-bookmark groups — one row
 * per normalized-URL collision plus a clean-all row on top — with
 * ConfirmDialog-guarded batch deletion behind each. Escape closes the
 * panel outright; the mode resets on close, there is no nested "back".
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
    let mode = 'normal';     // 'normal' | 'dupes'
    let dupeGroups = [];     // findDupes() result backing the dupes-mode rows

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

    // --- Command set v1 -----------------------------------------------------
    // Names resolve through i18n at render time; fn runs on Enter/click.
    // "New folder" rides actions.addNewBookmarkNode with an empty url —
    // addNewNode routes an empty newUrl into the NewFolderDialog flow, the
    // same idiom the context menu's add-folder-* entries use. "New bookmark"
    // mirrors quickAddCurrentTab's silent no-op when there is no current tab.
    // The dupes command carries keepOpen: it switches the panel into dupes
    // mode instead of closing it; `slash` is its omni-style alias, matched
    // as a prefix of a '/'-prefixed query.
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
        { slash: 'dupes', keepOpen: true, name: () => _m('paletteCmdDupes'), fn: enterDupesMode }
    ];

    // --- Rendering ------------------------------------------------------------
    const faviconUrl = url =>
        `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;

    const addRow = row => {
        const li = document.createElement('li');
        li.className = `palette-row palette-${row.kind}`;
        if (row.kind === 'command') {
            li.innerHTML = `<span class="palette-kind">▸</span><span class="palette-title">${htmlspecialchars(row.name)}</span>`;
        } else if (row.kind === 'folder') {
            li.innerHTML = `<img class="palette-icon" src="/assets/icons/folder.png" width="16" height="16" alt=""><span class="palette-title">${htmlspecialchars(row.title)}</span>`;
        } else if (row.kind === 'dupes-all') {
            li.innerHTML = `<span class="palette-kind">▸</span><span class="palette-title">${htmlspecialchars(row.name)}</span>`;
        } else if (row.kind === 'dupe') {
            li.innerHTML = `<span class="palette-title">${htmlspecialchars(row.title)} <span class="palette-url">${htmlspecialchars(row.count)}</span></span><span class="palette-url">${htmlspecialchars(row.url)}</span>`;
        } else {
            const title = row.title || row.url;
            li.innerHTML = `<img class="palette-icon" src="${faviconUrl(row.url)}" width="16" height="16" alt=""><span class="palette-title">${htmlspecialchars(title)}</span><span class="palette-url">${htmlspecialchars(row.url)}</span>`;
        }
        const i = rows.length;
        li.addEventListener('click', () => execute(i, false));
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
    const execute = (i, newTab) => {
        const row = rows[i];
        if (!row)
            return;
        if (row.kind === 'command') {
            row.fn();
            if (row.keepOpen)
                return;
        } else if (row.kind === 'dupes-all' || row.kind === 'dupe') {
            row.fn();
            return;
        } else if (row.kind === 'folder') {
            treeView.revealFolder(row.id);
        } else if (newTab) {
            actions.openBookmarkNewTab(row.url, true);
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
            case 'Enter':
                e.preventDefault();
                execute(selected >= 0 ? selected : 0, e.ctrlKey || e.metaKey);
                break;
            case 'Escape':
                e.preventDefault();
                e.stopPropagation(); // keep keyboard.js's document Escape handler out
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
        mode = 'normal'; // dupes mode never survives a close
        dupeGroups = [];
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
