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
 * Every view is a Go command whose slash name is the view id (execution =
 * close + views.activate(id)); every command carries a slash name plus at
 * most one memorable alias (/add /new /folder /session /options — e.g. the
 * dupes view answers to /dupes /dedup). All forms match by prefix and show
 * as the row's muted suffix. The dupes/dead cleanup flows
 * (ConfirmDialog-guarded batch deletion, the in-popup scan) moved out with
 * the modes, which removes the "Escape has no nested back" wart the old
 * mode switch had. A plain (non-slash) query appends a bridge row —
 * paletteCmdSearchInView — that jumps into the search view with the query;
 * the slash form `/search foo` carries the words along the same way.
 *
 * Round-4 (item 2): the /sep command is retired — a position-dependent
 * creation read as "added nowhere sensible" from an overlay panel; adding
 * separators stays in the tree's context menu (src/separators.js).
 *
 * v4 task-4 #5 (alias cleanup): the command table converged on 13 entries —
 * one slash name plus at most one memorable alias each (semantic, short).
 * The themeauto…themepaper five-pack collapsed into a single parameterized
 * '/theme <name>' (any unique prefix: '/theme d' = dark; a bare or ambiguous
 * rest shows the usage alert); round-5 adds the four direct theme switches
 * '/dark' '/light' '/ink' '/paper' (same apply path as a resolved /theme,
 * no rest word — Enter applies and closes). '/path' (itempath) confused
 * more than it helped — the toggle lives on the options page only. The full
 * reserved word list (every built-in slash + alias) is exported from
 * src/palette-commands.js as PALETTE_RESERVED for the custom-command
 * validation (v4 task-4 #6); palette.test.js pins the two in sync.
 *
 * P3.2's session-save command (slash name /session) stays: it snapshots
 * the current window's tabs into a new bookmark folder under
 * ctx.rootFolderId (session.js does the scheme filtering, dedup and the
 * sequential creation), then alerts the saved count and repaints the tree
 * through ctx.onChanged. A window with nothing bookmarkable gets the
 * sessionEmpty alert and the panel stays open.
 *
 * initPalette(ctx) is called once by neat.js after treeView/actions init.
 * ctx.store        — settings store: the /theme command writes 'theme', the
 *                    /tabs toggle flips 'showViewTabs'; the sync mirror holds
 *                    the custom commands (paletteCustomCommands)
 * ctx.actions      — actions.js API (openBookmark/openBookmarkNewTab/
 *                    addNewBookmarkNode/deleteBookmark/deleteBookmarks/
 *                    editBookmarkFolder)
 * ctx.treeView     — tree-view.js API (revealFolder)
 * ctx.views        — view-manager.js API (activate) for the Go commands
 * ctx.search       — search.js API (run) for the /search words + bridge row;
 *                    its record(q, n) logs palette-driven plain-query bookmark
 *                    opens into the search history (v4 task-4 #3)
 * ctx.quickAdd     — neat.js's quickAddCurrentTab
 * ctx.rootFolderId — folder the create-style commands drop new nodes into
 *                    (neat.js passes store.get('quickAddFolderId', '1'))
 * ctx.dialogs      — dialogs.js API (AlertDialog/ConfirmDialog): the
 *                    session-save alerts, the /theme usage alert and the
 *                    custom-command delete confirm
 * ctx.onChanged    — re-pulls the bookmark tree into the tree view after a
 *                    session save added a folder
 *
 * Returns { open, close, isOpen, refocus, customMenu }. neat.js wires the
 * global-wake auto-open (URL ?palette=1 / storage.session flag) on top of
 * open(); the customMenu pair (edit/remove) is context-menu.js's dispatch
 * target for custom-command rows; refocus is keyboard.js's delegation
 * target for Esc over a menu opened on a palette row (K2).
 *
 * chrome.bookmarks/tabs/runtime, chrome.i18n.getMessage, document and
 * window.VBMFuzzy remain page globals. No neatools helpers: getElementById/
 * classList and the module-private htmlspecialchars below (same
 * implementation as tree-render.js's, modules stay self-contained).
 */

import { sessionFolderName, tabsToBookmarks, saveSession } from './session.js';
import { FOLDER_ICON } from './icons.js';
import { loadCustomCommands, saveCustomCommands, sortCustoms, matchCustom, executeCustom, SLASH_RE } from './palette-commands.js';
import { htmlspecialchars } from './escape.js';
import { highlightTitlePositions } from './tree-render.js';

export function initPalette(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const actions = ctx.actions;
    const treeView = ctx.treeView;
    const views = ctx.views;
    const search = ctx.search;
    const quickAdd = ctx.quickAdd;
    const dialogs = ctx.dialogs;
    const onChanged = ctx.onChanged || (() => {});
    const rootFolderId = ctx.rootFolderId || '1';
    const clearMenu = ctx.clearMenu; // context-menu.js's clearMenu (Escape layering)
    // v4 task-4 #3: a plain-query palette search that ends in a bookmark open
    // is recorded into the search view's history (search.record) — it used to
    // vanish with the panel, which read as "palette searches never reach the
    // history". Optional so minimal test doubles keep working.
    const recordSearch = (search && search.record) ? (q, n) => search.record(q, n) : () => {};

    const $palette = $('command-palette');
    const $input = $('palette-input');
    const $results = $('palette-results');
    // Final polish: the clear (×) affordance inside the field and the visible
    // footer close button — both are mouse affordances (tabindex="-1" in the
    // markup): the keyboard paths stay Esc (close) and plain editing (clear),
    // mirroring the search box's #search-clear contract.
    const $clear = $('palette-clear');
    const $close = $('palette-close');

    // A dialog (confirm/edit/alert/new-folder/sort/tab-group/group-pick)
    // owns the popup's modal layer; the palette must not open over or steal
    // keys from it. Mirrors dialogs.js's anyOpen() class set (T3).
    const DIALOG_CLASSES = ['needConfirm', 'needEdit', 'needAlert', 'needInputName', 'needSort',
        'needTabGroup', 'needGroupPick'];
    const anyDialogOpen = () =>
        DIALOG_CLASSES.some(c => document.body.classList.contains(c));

    // --- State --------------------------------------------------------------
    let openState = false;
    let index = [];          // flattened { id, title, url, dateAdded, isFolder }
    let rows = [];           // rendered rows: { kind, el, id, url, name, fn }
    let selected = -1;       // index into rows, -1 = nothing highlighted
    let plainQuery = '';     // last rendered plain (non-slash) query
    let plainHitCount = 0;   // bookmark+folder hit rows of that query
    let customs = [];        // v4 task-4 #6: paletteCustomCommands, loaded per open
    let opener = null;       // element that owned focus before the panel opened

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
    // Aliases follow v4 task-4 #5's cleanup: at most one memorable alias per
    // command ('/dedup' lands on the duplicates view, '/home' on the tree).
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
    // Round-4 (item 2) direct switches. setTheme mirrors the options page's
    // theme <select>: store.set persists through the mirror, the localStorage
    // copy keeps store.js's synchronous pre-fill correct on the next popup
    // open (the same reason options.js writes it), and body[data-theme]
    // applies the new theme immediately — the same path popup.js reads on
    // load, not a second mechanism.
    const setTheme = name => () => {
        store.set('theme', name);
        localStorage.setItem('theme', name);
        document.body.dataset.theme = name;
    };
    // v4 task-4 #5: one parameterized /theme command replaced the
    // themeauto…themepaper five-pack — '/theme dark' (any unique prefix)
    // sets it; a bare, ambiguous or unknown rest shows the usage alert
    // (keepOpen, so the panel survives the alert like /search does).
    const THEMES = ['auto', 'light', 'dark', 'ink', 'paper'];
    const themeFromRest = rest => {
        const word = (rest || '').toLowerCase();
        const hits = word ? THEMES.filter(t => t.indexOf(word) === 0) : [];
        if (hits.length !== 1) {
            dialogs.AlertDialog.open(_m('paletteCmdThemeUsage'));
            return;
        }
        setTheme(hits[0])();
        close();
    };
    // Round-5: the four direct theme commands (/dark /light /ink /paper)
    // sit next to the parameterized /theme — the same three-write apply
    // path, no rest word, and Enter applies + closes (as a resolved /theme
    // does). Names reuse the options page's optionTheme* labels, already
    // present in every locale.
    const switchTheme = name => () => {
        setTheme(name)();
        close();
    };
    // showViewTabs flips a '1'/'' setting (default on) and is applied the
    // way view-manager.js applies it — the no-view-tabs body class.
    const toggleViewTabs = () => {
        const on = !store.get('showViewTabs', '1');
        store.set('showViewTabs', on ? '1' : '');
        document.body.classList.toggle('no-view-tabs', !on);
    };
    // v4 task-4 #5: the cleaned table — 17 commands (round-5 added the four
    // direct theme switches), one slash name plus at most one memorable alias
    // each. PALETTE_RESERVED (palette-commands.js) carries every slash +
    // alias as custom-command reserved words; the two are pinned in sync by
    // palette.test.js.
    const commands = [
        { slash: 'add', aliases: ['star'], name: () => _m('paletteCmdQuickAdd'), fn: () => quickAdd() },
        { slash: 'new', aliases: [], name: () => _m('paletteCmdNewBookmark'), fn: newBookmarkFromTab },
        { slash: 'folder', aliases: ['mkdir'], name: () => _m('paletteCmdNewFolder'), fn: () => actions.addNewBookmarkNode(rootFolderId, 'bottom', '', '') },
        { slash: 'session', aliases: ['save'], keepOpen: true, name: () => _m('paletteCmdSaveSession'), fn: saveWindowSession },
        { slash: 'tree', aliases: ['home'], name: () => _m('paletteCmdGoTree'), fn: goView('tree') },
        {
            slash: 'search', aliases: ['find'], keepOpen: true, name: () => _m('paletteCmdGoSearch'),
            fn: rest => {
                close();
                if (rest)
                    search.run(rest); // activates the search view itself
                else
                    views.activate('search');
            }
        },
        { slash: 'recent', aliases: ['latest'], name: () => _m('paletteCmdGoRecent'), fn: goView('recent') },
        { slash: 'stats', aliases: ['visits'], name: () => _m('paletteCmdGoStats'), fn: goView('stats') },
        { slash: 'dead', aliases: ['broken'], name: () => _m('paletteCmdGoDead'), fn: goView('dead') },
        { slash: 'dupes', aliases: ['dedup'], name: () => _m('paletteCmdGoDupes'), fn: goView('dupes') },
        { slash: 'theme', aliases: [], keepOpen: true, name: () => _m('paletteCmdTheme'), fn: themeFromRest },
        { slash: 'dark', aliases: [], name: () => _m('optionThemeDark'), fn: switchTheme('dark') },
        { slash: 'light', aliases: [], name: () => _m('optionThemeLight'), fn: switchTheme('light') },
        { slash: 'ink', aliases: [], name: () => _m('optionThemeInk'), fn: switchTheme('ink') },
        { slash: 'paper', aliases: [], name: () => _m('optionThemePaper'), fn: switchTheme('paper') },
        { slash: 'tabs', aliases: [], name: () => _m('paletteCmdToggleViewTabs'), fn: toggleViewTabs },
        { slash: 'options', aliases: ['settings'], name: () => _m('paletteCmdOptions'), fn: () => chrome.runtime.openOptionsPage() }
    ];
    // All slash forms of a command — the canonical name plus its aliases.
    const slashNames = cmd => [cmd.slash].concat(cmd.aliases || []);

    // --- Custom commands (v4 task-4 #6, docs/palette-commands-design.md) -----
    // User-defined entries of paletteCustomCommands merge into the command
    // area. The management UI lives on the options page; the palette hands
    // over through the options URL hash (create prefill / edit by id).
    const openCustomEditor = prefill => {
        const hash = `#palette-cmd=${encodeURIComponent(JSON.stringify(prefill))}`;
        chrome.tabs.create({ url: chrome.runtime.getURL('pages/options.html') + hash });
    };
    const customDeps = {
        store, actions, views, dialogs, _m,
        onChanged: () => {
            customs = loadCustomCommands(store);
        }
    };
    // Context-menu entries (→ or right-click on a custom row): edit rides
    // the options-page editor, delete asks once (it syncs to every device).
    const editCustom = id => openCustomEditor({ edit: id });
    const removeCustom = id => {
        const list = loadCustomCommands(store);
        const cmd = list.find(c => c.id === id);
        if (!cmd)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('paletteCustomDeleteConfirm', htmlspecialchars(cmd.name)),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                saveCustomCommands(store, list.filter(c => c.id !== id));
                customs = loadCustomCommands(store);
                if (openState)
                    render();
            }
        });
    };

    // --- Rendering ------------------------------------------------------------
    const faviconUrl = url =>
        `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(url)}&size=32`;

    const addRow = row => {
        const li = document.createElement('li');
        li.className = `palette-row palette-${row.kind}${row.custom ? ' palette-command-custom' : ''}`;
        // Bookmark/folder rows carry <a> tags and results-item-${id} IDs so the
        // existing context-menu.js handler (which walks up to nearest a/span and
        // strips the results-item- prefix) can open bookmark/folder context menus
        // on palette rows — no special-casing needed.
        // The <a>s are tabindex="-1" like every other bookmark row in the app:
        // the palette's keyboard model is anchored on the input, so a Tab-focusable
        // row would strand the ↑↓/Space keys on a link (native scroll + a frozen
        // .selected highlight). The $results keydown guard below is the safety net
        // for any path that still focuses a row (context-menu refocus, future code).
        if (row.kind === 'command') {
            li.innerHTML = `<span class="palette-kind">▸</span><span class="palette-title">${htmlspecialchars(row.name)}</span>` +
                (row.slash ? `<span class="palette-slash">${row.slash}</span>` : '');
            // v4 task-4 #6: custom commands carry the "custom" tag and their
            // id (the → / right-click context menu's edit/delete act on it).
            if (row.custom) {
                li.dataset.ccId = row.custom.id;
                li.innerHTML += `<span class="palette-custom-tag">${_m('paletteCustomTag')}</span>`;
            }
        } else if (row.kind === 'folder') {
            li.id = row.id ? `results-item-${row.id}` : '';
            // match-char <mark> highlight, same as the search view (#results)
            const titleHtml = highlightTitlePositions(row.title, row.positions);
            li.innerHTML = `<a href="" tabindex="-1" class="link-folder tree-item-link"><div class="favicon-container">${FOLDER_ICON}</div><i>${titleHtml}</i></a>`;
        } else {
            // bookmark row: <a> tag so context-menu.js recognises it
            li.id = row.id ? `results-item-${row.id}` : '';
            // title hit positions get <mark>; a missing title falls back to the url
            const titleHtml = row.title
                ? highlightTitlePositions(row.title, row.positions)
                : htmlspecialchars(row.url);
            li.innerHTML = `<a href="${htmlspecialchars(row.url)}" tabindex="-1" class="tree-item-link"><div class="favicon-container"><img src="${faviconUrl(row.url)}" width="16" height="16" alt="" loading="lazy"></div><i>${titleHtml}</i></a>`;
        }
        const i = rows.length;
        // Keep the input focused through the click: preventing the mousedown
        // default stops the blur that the round-3 focusout guard would read
        // as "focus lost → close the palette", which ate the following click
        // (mouse users got nothing; Enter worked all along). The click event
        // itself still fires normally.
        li.addEventListener('mousedown', e => e.preventDefault());
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
        // Keep the highlighted row inside the scrollport — ↑/↓/Home/End used
        // to move the selection off-screen without the list following.
        const sel = selected >= 0 && rows[selected];
        if (sel && sel.el.scrollIntoView)
            sel.el.scrollIntoView({ block: 'nearest' });
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
        // v4 task-4 #3: remember the plain query + its hit count so executing
        // a bookmark row can record the search (slash/command rows never do).
        plainQuery = slashMode ? '' : q;
        plainHitCount = 0;
        // Commands: all on an empty query, fuzzy-filtered otherwise. A '/'
        // prefix restricts the panel to commands (omni-style slash frame).
        // Slash mode renders in two passes so the exact slash match wins the
        // Enter row — '/ink' must apply the Ink theme, not the "Go to Dead
        // links view" name collision (round-5 direct theme commands). Pass 0
        // is the slash-prefix matches (the command the user asked for, table
        // order among themselves); pass 1 the remaining name-fuzzy matches.
        // Plain/empty queries skip pass 0, so they keep pure table order.
        const slashHit = cmd => slashNames(cmd).some(s => s.indexOf(slashWord) === 0);
        const nameHit = name => !q || window.VBMFuzzy.score(q, name);
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0, l = commands.length; i < l; i++) {
                const cmd = commands[i];
                const name = cmd.name();
                const slash = slashMode && slashHit(cmd);
                if ((pass === 0 && slash) || (pass === 1 && !slash && nameHit(name)))
                    addRow({
                        kind: 'command', name,
                        slash: slashNames(cmd).map(s => `/${s}`).join(' '),
                        fn: () => cmd.fn(slashRest),
                        keepOpen: !!cmd.keepOpen
                    });
            }
        }
        // v4 task-4 #6: custom commands merge into the command area right
        // after the built-ins (those keep their table order — muscle memory);
        // customs order among themselves by usage (sortCustoms). Slash mode
        // prefix-matches their slash/aliases, plain mode fuzzy-matches the
        // display name, and the slash rest rides along as the parameter.
        for (const cmd of sortCustoms(customs)) {
            const hit = slashMode
                ? matchCustom(cmd, slashWord)
                : (!q || window.VBMFuzzy.score(q, cmd.name));
            if (!hit)
                continue;
            addRow({
                kind: 'command', name: cmd.name, custom: cmd,
                slash: slashNames(cmd).map(s => `/${s}`).join(' '),
                fn: () => executeCustom(cmd, slashRest, customDeps)
            });
        }
        if (!slashMode && q) {
            const hits = window.VBMFuzzy.rank(q, index).slice(0, 50);
            plainHitCount = hits.length;
            for (let i = 0, l = hits.length; i < l; i++) {
                const hit = hits[i];
                addRow(hit.isFolder ?
                    { kind: 'folder', id: hit.id, title: hit.title, positions: hit.positions } :
                    { kind: 'bookmark', id: hit.id, title: hit.title, url: hit.url, positions: hit.positions });
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
            // v4 task-4 #6: a hitless plain query also offers to become a
            // custom command — the "查不到" → "可定义" closure (design §6).
            // A slash-conformant query prefills the slash field, anything
            // else just carries the name.
            if (!plainHitCount)
                addRow({
                    kind: 'command',
                    name: _m('paletteCmdSaveAsCommand', q),
                    fn: () => openCustomEditor({
                        name: q,
                        slash: SLASH_RE.test(q.toLowerCase()) ? q.toLowerCase() : ''
                    })
                });
        }
        // Slash mode with zero matching commands offers the same closure —
        // here the word is the future slash by construction.
        if (slashMode && slashWord && !rows.length && SLASH_RE.test(slashWord))
            addRow({
                kind: 'command',
                name: _m('paletteCmdSaveAsCommand', `/${slashWord}`),
                fn: () => openCustomEditor({ slash: slashWord })
            });
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
        } else {
            // v4 task-4 #3: opening a bookmark off a plain query = a finished
            // search — record it (the search view's own folder-jump contract
            // stays: folder rows above never record).
            recordSearch(plainQuery, plainHitCount);
            if (newTab) {
                actions.openBookmarkNewTab(row.url, true);
            } else if (leftClickNewTab) {
                // 遵从 options 里 tree 视图的单击设置：新标签页后台打开
                actions.openBookmarkNewTab(row.url, true, true);
            } else {
                actions.openBookmark(row.url);
            }
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

    // Safety net for a focused result ROW (the input owns the keyboard model,
    // but a context-menu refocus or future code can still put focus on a row —
    // e.g. the pre-tabindex Tab path). Without this, ↑↓/Home/End and Space
    // degrade to Chrome's native link defaults: arrow keys and Space scroll
    // the list under the stationary mouse, so the CSS :hover follows the mouse
    // while the .selected highlight (input-driven) stays frozen — the focus
    // ownership bug. Delegated on the list so re-renders can't drop it.
    $results.addEventListener('keydown', e => {
        let li = e.target;
        while (li && li.parentNode !== $results)
            li = li.parentNode;
        if (!li)
            return; // focus on the input / a menu / a toolbar, not a row
        const idx = rows.findIndex(r => r.el === li);
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                moveSelection(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                moveSelection(-1);
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
            case ' ':   // Chrome activates links on Enter only — kill the scroll
            case 'Enter':
                e.preventDefault();
                execute(idx >= 0 ? idx : (selected >= 0 ? selected : 0), e.ctrlKey || e.metaKey);
                break;
        }
    });

    $input.addEventListener('input', () => {
        // The × affordance appears only with a query (search box contract).
        $palette.classList.toggle('has-query', !!$input.value);
        render();
    });
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
                        // A stale row (folder gone meanwhile) fails getChildren
                        // — suppress the warning and skip, guard the map too.
                        if (chrome.runtime.lastError)
                            return;
                        const kids = children || [];
                        const urlsLen = kids.map(c => c.url).filter(Boolean).length;
                        actions.deleteBookmarks(row.id, urlsLen, kids.length - urlsLen);
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
                close({ back: true });
                break;
        }
    });

    // --- Clear / close affordances (final polish) ------------------------------
    // Labels resolve once here (the placeholder still resolves per open).
    $clear.setAttribute('aria-label', _m('searchClear'));
    $clear.title = _m('searchClear');
    $close.setAttribute('aria-label', _m('paletteClose'));
    const closeLabel = $close.querySelector('.palette-close-label');
    if (closeLabel)
        closeLabel.textContent = _m('paletteClose');
    // preventDefault on mousedown keeps the input's focus through the click —
    // the same trick the result rows use against the focusout guard.
    $clear.addEventListener('mousedown', e => e.preventDefault());
    $clear.addEventListener('click', e => {
        e.preventDefault();
        $input.value = '';
        $palette.classList.remove('has-query');
        render();
        $input.focus();
    });
    $close.addEventListener('mousedown', e => e.preventDefault());
    $close.addEventListener('click', e => {
        e.preventDefault();
        close({ back: true });
    });

    // --- Open / close -----------------------------------------------------------
    // A context menu opened over the palette (ArrowRight / right-click) steals
    // focus to the menu; closing it (← / Esc) hands focus back to the .active
    // ROW — which strands palette navigation, because the ↑↓ handlers live on
    // the input. Intercept the close key while the menu is up, clear it and
    // return focus to the input. Capture: runs before the menu's own keydown
    // (contextKeyDown's ArrowLeft/Escape would drop focus on the row).
    const onDocKey = e => {
        const closeKey = document.body.classList.contains('rtl') ? 'ArrowRight' : 'ArrowLeft';
        if (e.key !== closeKey && e.key !== 'Escape')
            return;
        if (!clearMenu || !document.body.querySelector('.active'))
            return;
        e.preventDefault();
        e.stopImmediatePropagation();
        clearMenu();
        // clearMenu() (no arg) keeps the .active marker and refocuses the row;
        // the palette must drop both and hand focus to its input instead.
        const act = document.body.querySelector('.active');
        if (act)
            act.classList.remove('active');
        $input.focus();
    };

    // The same close-the-menu-over-the-palette dance as onDocKey's, exposed
    // for keyboard.js's document Escape chain (K2): that capture handler
    // registered before this module's open-time one can ever run, so Esc over
    // a palette menu reaches it first and it delegates here. Dropping the
    // marker BEFORE clearMenu() keeps clearMenu from refocusing the row —
    // the panel's focus anchor is the input, never a result row.
    const refocus = () => {
        const act = document.body.querySelector('.active');
        if (act)
            act.classList.remove('active');
        if (clearMenu)
            clearMenu();
        $input.focus();
    };

    const open = () => {
        if (openState || anyDialogOpen())
            return;
        // v4 task-3 #20: the palette can be switched off entirely (classic
        // experience) — one guard here covers Ctrl/Cmd+K, the tool button
        // and the global wake path alike.
        if (store && !store.get('paletteEnabled', '1'))
            return;
        // A context menu must not float over the panel (menus sit one layer
        // above the palette) — pointer paths clear it via the body click,
        // the Ctrl/Cmd+K path needs this.
        if (clearMenu)
            clearMenu();
        // Remember the element that owned focus before the panel opened, so a
        // keyboard dismiss (Esc / close button / Ctrl+K) can hand it back —
        // the keyboard-only continuity contract: open from the search box or
        // a header tool button, dismiss, and the keys resume there instead of
        // landing on the view's first/remembered row. Skipped for body, the
        // input itself and anything inside a context menu (the menu just
        // closed, its items sit hidden and must never be refocused).
        const ae = document.activeElement;
        opener = (ae && ae !== document.body && ae !== $input
            && !(ae.closest && ae.closest('menu[type=context]'))
            && typeof ae.focus === 'function') ? ae : null;
        openState = true;
        document.addEventListener('keydown', onDocKey, true);
        $palette.hidden = false;
        $palette.classList.remove('has-query'); // fresh panel: no query, no ×
        $input.value = '';
        $input.placeholder = _m('palettePlaceholder');
        customs = loadCustomCommands(store); // v4 task-4 #6: sync-mirror read
        rebuildIndex(); // async; re-renders when the fresh index lands
        render();       // paint the command rows immediately
        $input.focus();
    };

    // Visibility as the popup drives it: a `hidden` section/property or an
    // inline display:none up the ancestor chain (doubles without layout APIs
    // count as visible — tests).
    const isVisible = el => {
        for (let n = el; n; n = n.parentNode) {
            if (n.hidden)
                return false;
            if (n.style && n.style.display === 'none')
                return false;
        }
        return true;
    };

    // close(opts): dismiss the panel. A `back: true` close (Esc / close
    // button / Ctrl+K) returns focus to the element that owned it before the
    // open — the search box or a header tool button stay where keyboard-only
    // users left them. Pointer and command paths close without `back`: the
    // click target or the running command decides where focus goes, so the
    // tree/view handback below is theirs. A gone or hidden opener falls
    // through to that same handback.
    const close = (opts = {}) => {
        if (!openState)
            return;
        openState = false;
        document.removeEventListener('keydown', onDocKey, true);
        $palette.hidden = true;
        const back = opts.back ? opener : null;
        opener = null;
        if (back && back.isConnected !== false && isVisible(back)) {
            back.focus();
            return;
        }
        // Hand focus back to the tree: the focused row, else its first row.
        // The palette opens over ANY view, though — outside the tree view the
        // #tree section is hidden and focus() into it is a no-op that strands
        // the keys on the hidden input (K13), so an invisible target falls
        // back to the ACTIVE view's own anchor (its remembered/first row, the
        // list container, or the search box — view-manager's focusDefault).
        const row = document.querySelector('#tree .focus')
            || document.querySelector('#tree a, #tree span');
        if (row && isVisible(row))
            row.focus();
        else if (views && views.focusActive)
            views.focusActive();
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
            close({ back: true });
        else
            open();
    }, true);

    return {
        open, close, isOpen, refocus,
        // v4 task-4 #6: context-menu.js dispatches the custom-command row
        // menu (edit / delete) through here (lazy getter on its ctx).
        customMenu: { edit: editCustom, remove: removeCustom }
    };
}
