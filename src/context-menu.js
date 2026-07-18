/**
 * Popup context menus (P1 module extracted from neat.js).
 *
 * Owns the three right-click menus (bookmark / folder / separator): opening
 * them from the tree or results pane (active-row tracking, the hide-editables
 * / hide-sort toggles on root folders, rtl-aware position math, the Mac
 * right-click-hold-to-close quirk), clearing them on outside clicks, scrolls
 * and focus moves, hiding the add-* entries while search is active
 * (switchBookmarkMenu) and dispatching every menu-item click to the action
 * layer. currentContext (the row the menu was opened on) stays private.
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
    const body = document.body;
    const $tree = ctx.tree;
    const os = ctx.os;
    const rtl = ctx.rtl;

    const $bookmarkContextMenu = $('bookmark-context-menu');
    const $folderContextMenu = $('folder-context-menu');
    const $separatorContextMenu = $('separator-context-menu');
    const $results = $('results');

    // The row element (a/span) the open menu belongs to; cleared by clearMenu.
    let currentContext = null;

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
        $folderContextMenu.style.left = '-999px';
        $folderContextMenu.style.opacity = '0';
        $separatorContextMenu.style.left = '-999px';
        $separatorContextMenu.style.opacity = '0';
    };

    body.addEventListener('click', clearMenu);
    //body.addEventListener('scroll', clearMenu);
    $tree.addEventListener('scroll', clearMenu);
    //invalid event handler?
    window.addEventListener('scroll', clearMenu);
    $results.addEventListener('scroll', clearMenu);
    $tree.addEventListener('focus', clearMenu, true);
    $results.addEventListener('focus', clearMenu, true);

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
        let menu;
        if (el.tagName === 'A') {
            if (el.querySelector('hr')) {
                menu = $separatorContextMenu;
                if (el.parentNode.dataset.parentid === '0') {
                    menu.classList.add('hide-editables');
                } else {
                    menu.classList.remove('hide-editables');
                }
            } else {
                menu = $bookmarkContextMenu;
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
            let pageY;
            const boundY = window.innerHeight - e.clientY;
            if (boundY > menuHeight) {
                pageY = e.pageY;
            } else {
                pageY = Math.max(e.pageY - menuHeight, 0);
            }
            menu.style.left = `${pageX}px`;
            menu.style.top = `${pageY}px`;
            menu.style.opacity = '1';
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
        const id = li.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
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
            case 'bookmark-edit': {
                const li = currentContext.parentNode;
                const id = li.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                actions.editBookmarkFolder(id);
            }
                break;
            case 'bookmark-delete': {
                const li = currentContext.parentNode;
                const id = li.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                actions.deleteBookmark(id);
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
        const id = li.id.replace('neat-tree-item-', '');
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
                    actions.addSeparator(id, 'after', true);
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
        const id = li.id.replace('neat-tree-item-', '');
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
        separatorMenu: $separatorContextMenu
    };
}
