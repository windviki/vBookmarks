/**
 * Popup context menus (P1 module extracted from neat.js).
 *
 * Owns the four right-click menus (bookmark / folder / separator /
 * search-history): opening them from the tree or results pane (active-row
 * tracking, the hide-editables
 * / hide-sort toggles on root folders, rtl-aware position math, the Mac
 * right-click-hold-to-close quirk), clearing them on outside clicks, scrolls
 * and focus moves, hiding the add-* entries while search is active
 * (switchBookmarkMenu) and dispatching every menu-item click to the action
 * layer. currentContext (the row the menu was opened on) stays private.
 * v4 task-2 adds the view-row entries: "reveal in tree" on out-of-tree
 * rows, and slice C's dead-mark toggle / dupes keeper pin on dead/dupes
 * view rows (their labels/APIs resolve at open/dispatch time).
 * Round-4 item 7 adds the search-history menu: rows of the upper search
 * pane are recorded queries, not bookmarks, so they get a dedicated minimal
 * menu (rerun / remove / clear-all) instead of the bookmark one.
 *
 * initContextMenu(ctx) is called once by neat.js BEFORE initSearch: search
 * needs menus.switchBookmarkMenu at init time (a restored query calls it
 * synchronously), while initActions/initDialogs need the search API. That
 * ordering means neither actions nor dialogs can exist yet when this module
 * initializes, so ctx exposes them through getters that are read at dispatch
 * time — menu handlers only run on user events, long after init finished.
 * ctx.tree                       — the #tree element (clearMenu focus compare + bindings)
 * ctx.os                         — 'mac' | 'win' | 'linux' | 'other'
 * ctx.rtl                        — true when the popup is right-to-left
 * ctx.actions                    — initActions API (read lazily, see above)
 * ctx.dialogs                    — initDialogs API (SortDialog, read lazily)
 * ctx.revealInTree               — view-row → tree jump (read lazily)
 * ctx.deadMenu                   — { isMarked, toggle } of the dead view (lazily)
 * ctx.dupesMenu                  — { setKeeper } of the dupes view (lazily)
 *
 * The #results element is looked up here directly (the same static node
 * search.js wraps and returns as search.results) — injecting the search API
 * would recreate the init cycle described above. chrome.tabs/bookmarks/
 * windows, document/window/setTimeout remain page globals. No neatools
 * helpers: plain getElementById/classList only (neatools'
 * Array.map(c => c.url, children).clean() is inlined as map + filter).
 */
export function initContextMenu(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const body = document.body;
    const $tree = ctx.tree;
    const os = ctx.os;
    const rtl = ctx.rtl;

    const $bookmarkContextMenu = $('bookmark-context-menu');
    const $folderContextMenu = $('folder-context-menu');
    const $separatorContextMenu = $('separator-context-menu');
    const $searchHistoryContextMenu = $('search-history-context-menu');
    const $results = $('results');

    // The row element (a/span) the open menu belongs to; cleared by clearMenu.
    let currentContext = null;

    // v4 task-2: unified row-id extraction — data-node-id first (the row id
    // every list view shares), the legacy prefix strip as fallback.
    const rowId = li =>
        (li.dataset && li.dataset.nodeId) || li.id.replace(/(neat-tree|neat-recent|results|recent)-item-/, '');

    const clearMenu = e => {
        currentContext = null;
        const active = body.querySelector('.active');
        if (active) {
            if (e) {
                active.classList.remove('active');
                const el = e.target;
                if (el === $tree || el === $results) {
                    active.focus();
                }
            } else {
                // When menu is closed, do not lost focus
                active.focus();
            }
        }
        $bookmarkContextMenu.style.left = '-999px';
        $bookmarkContextMenu.style.opacity = '0';
        $bookmarkContextMenu.style.transform = 'scale(.98)';
        $folderContextMenu.style.left = '-999px';
        $folderContextMenu.style.opacity = '0';
        $folderContextMenu.style.transform = 'scale(.98)';
        $separatorContextMenu.style.left = '-999px';
        $separatorContextMenu.style.opacity = '0';
        $separatorContextMenu.style.transform = 'scale(.98)';
        if ($searchHistoryContextMenu) {
            $searchHistoryContextMenu.style.left = '-999px';
            $searchHistoryContextMenu.style.opacity = '0';
            $searchHistoryContextMenu.style.transform = 'scale(.98)';
        }
    };

    body.addEventListener('click', clearMenu);
    //body.addEventListener('scroll', clearMenu);
    $tree.addEventListener('scroll', clearMenu);
    //invalid event handler?
    window.addEventListener('scroll', clearMenu);
    $results.addEventListener('scroll', clearMenu);
    // Palette results (dead-link list etc.) scroll must also dismiss menus,
    // otherwise a right-click menu opened inside the palette stays frozen
    // while the list scrolls underneath it.
    const $paletteResults = $('palette-results');
    if ($paletteResults)
        $paletteResults.addEventListener('scroll', clearMenu);
    $tree.addEventListener('focus', clearMenu, true);
    $results.addEventListener('focus', clearMenu, true);
    // Round-3 item 3: the feature-view lists follow the same contract —
    // scrolling the content or moving focus into the list dismisses an open
    // menu (previously only the tree/results/palette panes did).
    for (const id of ['recent-list', 'stats-list', 'dead-list', 'dupes-list', 'search-history-area']) {
        const listEl = $(id);
        if (listEl) {
            listEl.addEventListener('scroll', clearMenu);
            listEl.addEventListener('focus', clearMenu, true);
        }
    }

    let macCloseContextMenu = false;
    body.addEventListener('contextmenu', e => {
        e.preventDefault();
        clearMenu();
        if (os === 'mac') {
            macCloseContextMenu = false;
            setTimeout(() => {
                macCloseContextMenu = true;
            }, 500);
        }
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        // Walk up to the nearest a/span when a child element (img, i, div, …)
        // captured the event — covers recent-view bookmarks and tree rows
        // whose ::after / favicon / sync-indicator received the click.
        if (el.tagName !== 'A' && el.tagName !== 'SPAN' && el.closest) {
            const nearest = el.closest('a, span');
            if (nearest) el = nearest;
        }
        let menu;
        // Round-4 item 7: a search-history row (the recorded-query rows of
        // the upper search pane) is not a bookmark — its li carries no
        // bookmark id, so the bookmark menu's open/edit/delete entries would
        // act on a bogus id. Give the row its own minimal menu instead.
        const onHistoryRow = el.tagName === 'A'
            && el.dataset && typeof el.dataset.q !== 'undefined'
            && el.parentNode && el.parentNode.classList
            && el.parentNode.classList.contains('search-history-row');
        if (onHistoryRow && $searchHistoryContextMenu) {
            menu = $searchHistoryContextMenu;
        } else if (el.tagName === 'A') {
            if (el.classList.contains('link-folder')) {
                // Folder link (search results / palette folder rows) — show
                // folder context menu. Root-level folder detection (hide-sort)
                // isn't needed here; these are never root folders.
                menu = $folderContextMenu;
                menu.classList.remove('hide-sort');
            } else if (el.querySelector('hr')) {
                menu = $separatorContextMenu;
                if (el.parentNode.dataset.parentid === '0') {
                    menu.classList.add('hide-editables');
                } else {
                    menu.classList.remove('hide-editables');
                }
            } else {
                menu = $bookmarkContextMenu;
                // v4 task-2: "Reveal in tree" only makes sense for rows that
                // live outside the tree view (recent list / search results);
                // on a tree row the entry would be a no-op, so hide it there.
                const revealItem = $('reveal-in-tree');
                if (revealItem) {
                    const inTree = el.parentNode.id.startsWith('neat-tree-item-');
                    revealItem.style.display = inTree ? 'none' : 'block';
                    const revealSep = $('reveal-in-tree-sep');
                    if (revealSep)
                        revealSep.style.display = inTree ? 'none' : 'block';
                }
                // v4 task-2 slice C: dead/dupes view rows get their view-
                // specific entries — the mark toggle (label follows the
                // row's current mark state) and the dupes keeper pin. Both
                // APIs are injected lazily (view modules init after menus).
                const liId = el.parentNode.id || '';
                const markItem = $('dead-mark-toggle');
                if (markItem) {
                    const onDeadRow = liId.startsWith('dead-item-') && ctx.deadMenu;
                    markItem.style.display = onDeadRow ? 'block' : 'none';
                    if (onDeadRow) {
                        const marked = ctx.deadMenu.isMarked(rowId(el.parentNode));
                        markItem.textContent = _m(marked ? 'deadUnmark' : 'deadMark');
                    }
                }
                const keeperItem = $('dupes-set-keeper');
                if (keeperItem) {
                    const onDupesRow = liId.startsWith('dupes-item-') && ctx.dupesMenu;
                    keeperItem.style.display = onDupesRow ? 'block' : 'none';
                }
            }
        } else if (el.tagName === 'SPAN') {
            menu = $folderContextMenu;
            // Sorting applies to a folder's contents, never to the root
            // folders themselves (issue #33 excludes the bookmarks bar root)
            if (el.parentNode.dataset.parentid === '0') {
                menu.classList.add('hide-sort');
            } else {
                menu.classList.remove('hide-sort');
            }
        } else {
        }
        if (menu) {
            currentContext = el;
            const active = body.querySelector('.active');
            if (active)
                active.classList.remove('active');
            el.classList.add('active');
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;
            const pageX = rtl ? Math.max(0, e.pageX - menuWidth) :
                Math.min(e.pageX, body.offsetWidth - menuWidth);
            // The search bar (z-index:10) renders above context menus; the
            // menu's top must never land inside the search row or the top
            // entries will be unreadable / unreachable.
            const searchBar = document.getElementById('search');
            const menuMinY = searchBar ? (searchBar.offsetTop + searchBar.offsetHeight) : 0;
            let pageY;
            const boundY = window.innerHeight - e.clientY;
            if (boundY > menuHeight) {
                pageY = e.pageY;
            } else {
                pageY = Math.max(e.pageY - menuHeight, menuMinY);
            }
            // Clamp to the search-bar baseline regardless of the branch above
            pageY = Math.max(pageY, menuMinY);
            menu.style.left = `${pageX}px`;
            menu.style.top = `${pageY}px`;
            menu.style.opacity = '1';
            menu.style.transform = 'scale(1)';
            menu.focus();
        }
    });
    // on Mac, holding down right-click for a period of time closes the context menu
    // Not a complete implementation, but it works :)
    if (os === 'mac')
        body.addEventListener('mouseup', e => {
            if (e.button === 2 && macCloseContextMenu) {
                macCloseContextMenu = false;
                clearMenu();
            }
        });

    const bookmarkContextHandler = e => {
        e.stopPropagation();
        if (!currentContext)
            return;
        const actions = ctx.actions;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        const url = currentContext.href;
        const li = currentContext.parentNode;
        const id = rowId(li);
        switch (el.id) {
            // ++++++++ modified by windviki@gmail.com ++++++++
            case 'add-bookmark-before-bookmark':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        const curTab = tabs[0];
                        actions.addNewBookmarkNode(id, 'before', curTab.url, curTab.title);
                    });
                break;
            case 'add-bookmark-after-bookmark':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        const curTab = tabs[0];
                        actions.addNewBookmarkNode(id, 'after', curTab.url, curTab.title);
                    });
                break;
            case 'add-folder-before-bookmark':
                actions.addNewBookmarkNode(id, 'before', '', '');
                break;
            case 'add-folder-after-bookmark':
                actions.addNewBookmarkNode(id, 'after', '', '');
                break;
            case 'add-separator':
                actions.addSeparator(id, 'after');
                break;
            case 'copy-title-and-url':
                actions.copyAllTitlesAndUrls(id);
                break;
            case 'replace-url':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        actions.replaceUrl(id, tabs[0].url);
                    });
                break;
            // ++++++++ end ++++++++
            case 'bookmark-new-tab':
                actions.openBookmarkNewTab(url);
                break;
            case 'bookmark-new-window':
                actions.openBookmarkNewWindow(url);
                break;
            case 'bookmark-new-incognito-window':
                actions.openBookmarkNewWindow(url, true);
                break;
            case 'reveal-in-tree':
                // v4 task-2: jump from a recent-list / search-results row to
                // the same bookmark inside the tree view.
                ctx.revealInTree(rowId(li));
                break;
            case 'dead-mark-toggle':
                // v4 task-2 slice C: dead-view row — flip its dead mark.
                ctx.deadMenu.toggle(rowId(li));
                break;
            case 'dupes-set-keeper':
                // v4 task-2 slice C: dupes-view row — pin it as the keeper.
                ctx.dupesMenu.setKeeper(rowId(li));
                break;
            case 'bookmark-edit': {
                actions.editBookmarkFolder(rowId(li));
            }
                break;
            case 'bookmark-delete': {
                actions.deleteBookmark(rowId(li));
            }
                break;
        }
        clearMenu();
    };
    // On Mac, all three mouse clicks work; on Windows, middle-click doesn't work
    $bookmarkContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            bookmarkContextHandler(e);
    });
    $bookmarkContextMenu.addEventListener('contextmenu', bookmarkContextHandler);
    $bookmarkContextMenu.addEventListener('click', e => {
        e.stopPropagation();
    });

    const folderContextHandler = e => {
        if (!currentContext)
            return;
        const actions = ctx.actions;
        const dialogs = ctx.dialogs;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        const li = currentContext.parentNode;
        const id = rowId(li);
        chrome.bookmarks.getChildren(id, children => {
            // neatools' Array.map(c => c.url, children).clean(): urls of the
            // children that have one (folders have none, null/undefined dropped)
            const urls = children.map(c => c.url).filter(url => url != undefined);
            const urlsLen = urls.length;
            const noURLS = !urlsLen;
            switch (el.id) {
                // ++++++++ modified by windviki@gmail.com ++++++++
                case 'add-bookmark-top':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'top', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-bottom':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'bottom', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-before-folder':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'before', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-after-folder':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'after', curTab.url, curTab.title);
                        });
                    break;
                case 'add-folder-before-folder':
                    actions.addNewBookmarkNode(id, 'before', '', '');
                    break;
                case 'add-folder-after-folder':
                    actions.addNewBookmarkNode(id, 'after', '', '');
                    break;
                case 'add-new-folder':
                    actions.addNewBookmarkNode(id, 'top', '', '');
                    break;
                case 'add-folder-separator':
                    actions.addSeparator(id, 'after');
                    break;
                case 'copy-all-titles-and-urls':
                    actions.copyAllTitlesAndUrls(id);
                    break;
                // ++++++++ end ++++++++
                case 'folder-window':
                    if (noURLS)
                        return;
                    actions.openBookmarks(urls);
                    break;
                // P3.4: batch-open as a named tab group. The folder's <i>
                // carries the displayed title (the span's own textContent
                // would include the sync-tooltip text).
                case 'open-bookmarks-in-group': {
                    if (noURLS)
                        return;
                    const titleNode = currentContext.querySelector('i');
                    actions.openBookmarksInGroup(urls, titleNode ? titleNode.textContent.trim() : '');
                    break;
                }
                case 'folder-new-window':
                    if (noURLS)
                        return;
                    actions.openBookmarksNewWindow(urls);
                    break;
                case 'folder-new-incognito-window':
                    if (noURLS)
                        return;
                    actions.openBookmarksNewWindow(urls, true);
                    break;
                case 'folder-edit':
                    actions.editBookmarkFolder(id);
                    break;
                case 'folder-delete':
                    actions.deleteBookmarks(id, urlsLen, children.length - urlsLen);
                    break;
                case 'sort-folder-contents':
                    dialogs.SortDialog.open(id);
                    break;
            }
        });
        clearMenu();
    };
    $folderContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            folderContextHandler(e);
    });
    $folderContextMenu.addEventListener('contextmenu', folderContextHandler);
    $folderContextMenu.addEventListener('click', e => {
        e.stopPropagation();
    });


    const separatorContextHandler = e => {
        if (!currentContext)
            return;
        const actions = ctx.actions;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        const li = currentContext.parentNode;
        const id = rowId(li);
        switch (el.id) {
            case 'remove-separator':
                actions.deleteSeparator(id);
                break;
        }
        clearMenu();
    };
    $separatorContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            separatorContextHandler(e);
    });
    $separatorContextMenu.addEventListener('contextmenu', separatorContextHandler);

    // Round-4 item 7: the search-history menu. Dispatch reuses the history
    // area's own click affordances — search.js's delegated handlers own the
    // rerun / removal / clear-all logic, so this module needs no search API
    // (the same decoupling as the #results lookup described in the header).
    if ($searchHistoryContextMenu) {
        // neat.js's id→message map predates this menu, so the labels are
        // assigned here (same _m helper; searchHistoryRerun is a new key,
        // with a fallback while the locale files catch up).
        $('search-history-menu-rerun').textContent = _m('searchHistoryRerun') || 'Search again';
        $('search-history-menu-remove').textContent = _m('searchHistoryRemove');
        $('search-history-menu-clear').textContent = _m('searchHistoryClear');
    }
    const searchHistoryContextHandler = e => {
        if (!currentContext)
            return;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        switch (el.id) {
            case 'search-history-menu-rerun':
                // Activating the row anchor reruns its query.
                currentContext.click();
                break;
            case 'search-history-menu-remove': {
                const removeBtn = currentContext.parentNode.querySelector('.search-history-remove');
                if (removeBtn)
                    removeBtn.click();
                break;
            }
            case 'search-history-menu-clear': {
                const clearBtn = $('search-history-clear');
                if (clearBtn)
                    clearBtn.click();
                break;
            }
        }
        clearMenu();
    };
    if ($searchHistoryContextMenu) {
        $searchHistoryContextMenu.addEventListener('mouseup', e => {
            e.stopPropagation();
            if (e.button === 0 || (os === 'mac' && e.button === 1))
                searchHistoryContextHandler(e);
        });
        $searchHistoryContextMenu.addEventListener('contextmenu', searchHistoryContextHandler);
    }

    const switchBookmarkMenu = disable => {
        if (disable) {
            $('add-bookmark-before-bookmark').style.display = 'none';
            $('add-bookmark-after-bookmark').style.display = 'none';
            $('bookmark-context-menu-sep1').style.display = 'none';
            $('add-folder-before-bookmark').style.display = 'none';
            $('add-folder-after-bookmark').style.display = 'none';
            $('bookmark-context-menu-sep2').style.display = 'none';
            $('add-separator').style.display = 'none';
            $('bookmark-context-menu-sep3').style.display = 'none';
        } else {
            $('add-bookmark-before-bookmark').style.display = 'block';
            $('add-bookmark-after-bookmark').style.display = 'block';
            $('bookmark-context-menu-sep1').style.display = 'block';
            $('add-folder-before-bookmark').style.display = 'block';
            $('add-folder-after-bookmark').style.display = 'block';
            $('bookmark-context-menu-sep2').style.display = 'block';
            $('add-separator').style.display = 'block';
            $('bookmark-context-menu-sep3').style.display = 'block';
        }
    };

    return {
        clearMenu,
        switchBookmarkMenu,
        // The keyboard/mouse bindings that stay in neat.js
        // (contextKeyDown/contextMouseMove/contextMouseOut) attach through
        // these element references.
        bookmarkMenu: $bookmarkContextMenu,
        folderMenu: $folderContextMenu,
        separatorMenu: $separatorContextMenu,
        // fourth-round item 7: dedicated menu for search-history rows; may be
        // absent in minimal test setups, so consumers must null-check
        searchHistoryMenu: $searchHistoryContextMenu || null
    };
}
