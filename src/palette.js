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
 * panel to commands) and the keyboard/mouse dispatch (arrows with rollover,
 * Enter, Ctrl/Cmd+Enter for a new tab, Escape, click = Enter).
 *
 * v4 task-2 §3.5/§4.4 ("视图即命令"): the dupes/dead sub-modes are retired —
 * that cleanup UI now lives in the dupes/dead views (src/view-dupes.js /
 * src/view-dead.js) and the palette goes back to a single flat command list.
 * Every view is a Go command whose slash alias is the view id (execution =
 * close + views.activate(id)); every clickable command carries a slash name
 * plus alternate aliases (/add /new /folder /sep /session /options — e.g.
 * the dupes view answers to /dupes /dups /dedup /clear). All forms match by
 * prefix and show as the row's muted suffix. The dupes/dead cleanup flows
 * (ConfirmDialog-guarded batch deletion, the in-popup scan) moved out with
 * the modes, which removes the "Escape has no nested back" wart the old
 * mode switch had. A plain (non-slash) query appends a bridge row —
 * paletteCmdSearchInView — that jumps into the search view with the query;
 * the slash form `/search foo` carries the words along the same way.
 *
 * P3.2's session-save command (slash name /session) stays: it snapshots
 * the current window's tabs into a new bookmark folder under
 * ctx.rootFolderId (session.js does the scheme filtering, dedup and the
 * sequential creation), then alerts the saved count and repaints the tree
 * through ctx.onChanged. A window with nothing bookmarkable gets the
 * sessionEmpty alert and the panel stays open.
 *
 * initPalette(ctx) is called once by neat.js after treeView/actions init.
 * ctx.store        — settings store (reserved; the palette reads nothing yet)
 * ctx.actions      — actions.js API (openBookmark/openBookmarkNewTab/
 *                    addNewBookmarkNode/addSeparator/deleteBookmark/
 *                    deleteBookmarks/editBookmarkFolder)
 * ctx.treeView     — tree-view.js API (revealFolder)
 * ctx.views        — view-manager.js API (activate) for the Go commands
 * ctx.search       — search.js API (run) for the /search words + bridge row
 * ctx.quickAdd     — neat.js's quickAddCurrentTab
 * ctx.rootFolderId — folder the create-style commands drop new nodes into
 *                    (neat.js passes store.get('quickAddFolderId', '1'))
 * ctx.dialogs      — dialogs.js API (AlertDialog), used by the session-save
 *                    alerts
 * ctx.onChanged    — re-pulls the bookmark tree into the tree view after a
 *                    session save added a folder
 *
 * Returns { open, close, isOpen }. neat.js wires the global-wake auto-open
 * (URL ?palette=1 / storage.session flag) on top of open().
 *
 * chrome.bookmarks/tabs/runtime, chrome.i18n.getMessage, document and
 * window.VBMFuzzy remain page globals. No neatools helpers: getElementById/
 * classList and the module-private htmlspecialchars below (same
 * implementation as tree-render.js's, modules stay self-contained).
 */

import { sessionFolderName, tabsToBookmarks, saveSession } from './session.js';
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
    const views = ctx.views;
    const search = ctx.search;
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

    // Flatten a bookmark tree: a node with children is a folder, everything
    // else a bookmark; the synthetic root ('0') is skipped.
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

    // --- Session save (P3.2) ------------------------------------------------
    // Snapshot the current window's tabs into a fresh folder under
    // rootFolderId. keepOpen so the nothing-bookmarkable case can alert
    // without dropping the panel; the success path closes explicitly before
    // alerting, mirroring the old close-then-alert order.
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

    // --- Command set (v4 task-2 §3.5) ----------------------------------------
    // Names resolve through i18n at render time; fn runs on Enter/click and
    // receives the slash rest words ('/search foo' → 'foo'). "New folder"
    // rides actions.addNewBookmarkNode with an empty url — addNewNode routes
    // an empty newUrl into the NewFolderDialog flow, the same idiom the
    // context menu's add-folder-* entries use. "New bookmark" mirrors
    // quickAddCurrentTab's silent no-op when there is no current tab.
    // Every view is a Go command (slash alias = view id; execution = close +
    // views.activate). The search command and the bridge row close the panel
    // themselves before running — search.run() focuses the header input and
    // close()'s focus-handback would steal it afterwards.
    // Every command also carries alternate slash names (`aliases`, item 8):
    // '/dups', '/dedup' and '/clear' all land on the duplicates view, etc.
    // All forms match by prefix and render as the row's muted suffix.
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
    const goView = id => () => views.activate(id);
    const commands = [
        { slash: 'add', aliases: ['quickadd', 'star'], name: () => _m('paletteCmdQuickAdd'), fn: () => quickAdd() },
        { slash: 'new', aliases: ['bookmark', 'bm'], name: () => _m('paletteCmdNewBookmark'), fn: newBookmarkFromTab },
        { slash: 'folder', aliases: ['newfolder', 'mkdir'], name: () => _m('paletteCmdNewFolder'), fn: () => actions.addNewBookmarkNode(rootFolderId, 'bottom', '', '') },
        { slash: 'sep', aliases: ['separator', 'divider'], name: () => _m('paletteCmdNewSeparator'), fn: () => actions.addSeparator(rootFolderId, 'bottom') },
        { slash: 'session', aliases: ['save', 'snapshot'], keepOpen: true, name: () => _m('paletteCmdSaveSession'), fn: saveWindowSession },
        { slash: 'tree', aliases: ['home', 'main'], name: () => _m('paletteCmdGoTree'), fn: goView('tree') },
        {
            slash: 'search', aliases: ['find', 'query'], keepOpen: true, name: () => _m('paletteCmdGoSearch'),
            fn: rest => {
                close();
                if (rest)
                    search.run(rest); // activates the search view itself
                else
                    views.activate('search');
            }
        },
        { slash: 'recent', aliases: ['latest', 'newest'], name: () => _m('paletteCmdGoRecent'), fn: goView('recent') },
        { slash: 'stats', aliases: ['visits', 'statistics'], name: () => _m('paletteCmdGoStats'), fn: goView('stats') },
        { slash: 'dead', aliases: ['broken', 'scan'], name: () => _m('paletteCmdGoDead'), fn: goView('dead') },
        { slash: 'dupes', aliases: ['dups', 'dedup', 'clear'], name: () => _m('paletteCmdGoDupes'), fn: goView('dupes') },
        { slash: 'options', aliases: ['settings', 'prefs'], name: () => _m('paletteCmdOptions'), fn: () => chrome.runtime.openOptionsPage() }
    ];
    // All slash forms of a command — the canonical name plus its aliases.
    const slashNames = cmd => [cmd.slash].concat(cmd.aliases || []);

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
            li.innerHTML = `<span class="palette-kind">▸</span><span class="palette-title">${htmlspecialchars(row.name)}</span>` +
                (row.slash ? `<span class="palette-slash">${row.slash}</span>` : '');
        } else if (row.kind === 'folder') {
            li.id = row.id ? `results-item-${row.id}` : '';
            li.innerHTML = `<a href="" class="link-folder tree-item-link"><div class="favicon-container">${FOLDER_ICON}</div><i>${htmlspecialchars(row.title)}</i></a>`;
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

    const render = () => {
        rows = [];
        selected = -1;
        $results.innerHTML = '';
        const query = $input.value.trim();
        const slashMode = query.charAt(0) === '/';
        const q = slashMode ? query.slice(1) : query;
        // A slash query's first word matches every command's slash name AND
        // its aliases by prefix ('/d' surfaces /dead and /dupes, '/ded' hits
        // the /dedup alias); the rest rides along to the command's fn
        // ('/search foo' → 'foo', §4.4).
        const slashWord = slashMode ? q.split(/\s+/)[0] : '';
        const slashRest = slashMode ? q.slice(slashWord.length).trim() : '';
        // Commands: all on an empty query, fuzzy-filtered otherwise. A '/'
        // prefix restricts the panel to commands (omni-style slash frame).
        for (let i = 0, l = commands.length; i < l; i++) {
            const cmd = commands[i];
            const name = cmd.name();
            if (!q || window.VBMFuzzy.score(q, name) ||
                (slashMode && slashNames(cmd).some(s => s.indexOf(slashWord) === 0)))
                addRow({
                    kind: 'command', name,
                    slash: slashNames(cmd).map(s => `/${s}`).join(' '),
                    fn: () => cmd.fn(slashRest),
                    keepOpen: !!cmd.keepOpen
                });
        }
        if (!slashMode && q) {
            const hits = window.VBMFuzzy.rank(q, index).slice(0, 50);
            for (let i = 0, l = hits.length; i < l; i++) {
                const hit = hits[i];
                addRow(hit.isFolder ?
                    { kind: 'folder', id: hit.id, title: hit.title } :
                    { kind: 'bookmark', id: hit.id, title: hit.title, url: hit.url });
            }
            // §4.4 bridge row: a non-empty plain query always ends with the
            // jump into the search view carrying the query — it doubles as
            // the "no results" fallback, so paletteNoResults stays a
            // slash-only state.
            addRow({
                kind: 'command',
                name: _m('paletteCmdSearchInView', q),
                fn: () => {
                    close();
                    search.run(q);
                },
                keepOpen: true
            });
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
    // /session saves across an async gap; the search commands close
    // themselves first, see the command set comment).
    const leftClickNewTab = ctx.leftClickNewTab;

    const execute = (i, newTab) => {
        const row = rows[i];
        if (!row)
            return;
        if (row.kind === 'command') {
            row.fn();
            if (row.keepOpen)
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
                // Close the context menu if one is open over the palette.
                if (clearMenu && document.body.querySelector('.active'))
                    clearMenu();
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
                // Only bookmark and folder rows (not commands)
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
                // a result row), just dismiss the menu — don't close the panel.
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

    // Losing keyboard focus dismisses the panel too (round-3): the mousedown
    // guard covers pointer users, this covers Tab / arrow-key navigation
    // away from the input. Focus moving INTO the panel, a context menu open
    // over a palette row, or a dialog owning the modal layer all keep it
    // open — the same guards the mousedown path and the Escape rung use.
    $palette.addEventListener('focusout', e => {
        if (!openState) return;
        if (e.relatedTarget && $palette.contains(e.relatedTarget)) return;
        if (anyDialogOpen()) return;
        if (clearMenu && document.body.querySelector('.active')) return;
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
