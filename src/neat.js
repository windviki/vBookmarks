import { SeparatorManager } from './separators.js';
import { initDialogs } from './dialogs.js';
import { initSearch } from './search.js';
import { initActions } from './actions.js';
import { initContextMenu } from './context-menu.js';
import { initKeyboard } from './keyboard.js';
import { initDnd } from './dnd.js';
import { initTreeRender } from './tree-render.js';

(window => {
    const store = window.store;
    // Phase 2b: the popup page doubles as the side panel page (sidepanel.html,
    // or the ?panel=1 query form). popup.js tags body with the panel-mode
    // class; here we only need the flag.
    const IS_PANEL = window.location.search.includes('panel=1')
        || window.document.body.classList.contains('panel-mode');
    // Storage mirror must be ready (chrome.storage.local loaded + migrated)
    // before any of the settings below are read
    store.ready.then(() => {
    const document = window.document;
    const chrome = window.chrome;
    const navigator = window.navigator;
    const body = document.body;
    const _m = chrome.i18n.getMessage;

    // StringList / SeparatorManager 已剥离至 src/separators.js（P1，ES module 见顶部 import）
    const separatorManager = new SeparatorManager(store);

    //regex for color expressions
    const hexColorRegex = /^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/;
    // RGB -> HEX 转换已随 generateSeparatorHTML 剥离至 src/tree-render.js（模块内纯函数）

    //HEX -> RGB
    String.prototype.colorRgb = function () {
        let sColor = this.toLowerCase();
        if (sColor && hexColorRegex.test(sColor)) {
            if (sColor.length === 4) {
                let sColorNew = "#";
                for (let i = 1; i < 4; i += 1) {
                    sColorNew += sColor.slice(i, i + 1).concat(sColor.slice(i, i + 1));
                }
                sColor = sColorNew;
            }
            //6 bit
            const sColorChange = [];
            for (let i = 1; i < 7; i += 2) {
                sColorChange.push(parseInt(`0x${sColor.slice(i, i + 2)}`));
            }
            return `RGB(${sColorChange.join(",")})`;
        } else {
            return '';
        }
    };

    // Private array of chars to use
    const UUIDCHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');

    Math.uuid = (len, radix) => {
        let chars = UUIDCHARS,
            uuid = [],
            i;
        radix = radix || chars.length;

        if (len) {
            // Compact form
            for (i = 0; i < len; i++) uuid[i] = chars[0 | Math.random() * radix];
        } else {
            // rfc4122, version 4 form
            let r;

            // rfc4122 requires these characters
            uuid[8] = uuid[13] = uuid[18] = uuid[23] = '-';
            uuid[14] = '4';

            // Fill in random data.  At i==19 set the high bits of clock sequence as
            // per rfc4122, sec. 4.1.5
            for (i = 0; i < 36; i++) {
                if (!uuid[i]) {
                    r = 0 | Math.random() * 16;
                    uuid[i] = chars[(i === 19) ? (r & 0x3) | 0x8 : r];
                }
            }
        }

        return uuid.join('');
    };

    // A more performant, but slightly bulkier, RFC4122v4 solution.  We boost performance
    // by minimizing calls to random()
    Math.uuidFast = () => {
        let uuid = new Array(36),
            rnd = 0,
            r;
        for (let i = 0; i < 36; i++) {
            if (i === 8 || i === 13 || i === 18 || i === 23) {
                uuid[i] = '-';
            } else if (i === 14) {
                uuid[i] = '4';
            } else {
                if (rnd <= 0x02) rnd = 0x2000000 + (Math.random() * 0x1000000) | 0;
                r = rnd & 0xf;
                rnd = rnd >> 4;
                uuid[i] = UUIDCHARS[(i === 19) ? (r & 0x3) | 0x8 : r];
            }
        }
        return uuid.join('');
    };

    // copyToClipboard / TreeText 已剥离至 src/actions.js（P1）

    // Platform detection
    const os = (navigator.platform.toLowerCase().match(/mac|win|linux/i) || ['other'])[0];
    body.addClass(os);

    // Chrome version detection
    const version = (() => {
        const v = {};
        const keys = ['major', 'minor', 'build', 'patch'];
        const matches = navigator.userAgent.match(/chrome\/([\d]+)\.([\d]+)\.([\d]+)\.([\d]+)/i);
        if (!matches)
            return null;
        matches.slice(1).forEach((m, i) => {
            v[keys[i]] = m.toInt();
        });
        return v;
    })();

    // Some i18n
    $('search-input').placeholder = _m('searchBookmarks');
    $('edit-dialog-name').placeholder = _m('name');
    $('edit-dialog-url').placeholder = _m('url');
    $('new-folder-dialog-name').placeholder = _m('name');
    $('quick-add-btn').title = _m('quickAddBookmark');
    $each({
        'bookmark-new-tab': 'openNewTab',
        'bookmark-new-window': 'openNewWindow',
        'bookmark-new-incognito-window': 'openIncognitoWindow',
        'bookmark-edit': 'edit',
        'bookmark-delete': 'delete',
        'add-bookmark-top': 'addBookmarkTop',
        'add-bookmark-bottom': 'addBookmarkBottom',
        'add-bookmark-before-bookmark': 'addBookmarkBefore',
        'add-bookmark-after-bookmark': 'addBookmarkAfter',
        'add-folder-before-bookmark': 'addNewFolderBefore',
        'add-folder-after-bookmark': 'addNewFolderAfter',
        'add-bookmark-before-folder': 'addBookmarkBefore',
        'add-bookmark-after-folder': 'addBookmarkAfter',
        'add-folder-before-folder': 'addNewFolderBefore',
        'add-folder-after-folder': 'addNewFolderAfter',
        'add-new-folder': 'addNewFolder',
        'add-separator': 'addSeparator',
        'remove-separator': 'removeSeparator',
        'add-folder-separator': 'addSeparator',
        'copy-title-and-url': 'copyTitleAndUrl',
        // 'copy-all-titles-and-urls' : 'copyAllTitlesAndUrls',
        'replace-url': 'replaceUrl',
        'folder-window': 'openBookmarks',
        'folder-new-window': 'openBookmarksNewWindow',
        'folder-new-incognito-window': 'openBookmarksIncognitoWindow',
        'folder-edit': 'edit',
        'folder-delete': 'deleteEllipsis',
        'sort-folder-contents': 'sortFolderContents',
        'sort-dialog-text': 'sortFolderContents',
        'sort-by-title-label': 'sortByTitle',
        'sort-by-date-label': 'sortByDateAdded',
        'sort-folders-first-label': 'sortFoldersFirst',
        'sort-recursive-label': 'sortRecursive',
        'sort-recursive-warning': 'sortRecursiveWarning',
        'edit-dialog-button': 'save',
        'edit-dialog-cancel-button': 'nope',
        'new-folder-dialog-button': 'save',
        'new-folder-dialog-cancel-button': 'nope',
        'sort-dialog-ok-button': 'save',
        'sort-dialog-cancel-button': 'nope'
    }, (msg, id) => {
        const el = $(id);
        const m = _m(msg);
        el.textContent = m;
    });

    // RTL indicator
    const rtl = (body.getComputedStyle('direction') === 'rtl');
    if (rtl)
        body.addClass('rtl');

    // Init some variables
    let opens = store.get('opens') ? JSON.parse(store.get('opens')) : [];
    let rememberState = !store.get('dontRememberState');
    const httpsPattern = /^https?:\/\//i;
    const onlyShowBMBar = !!store.get('onlyShowBMBar');

    // Adaptive bookmark tooltips
    const adaptBookmarkTooltips = () => {
        const bookmarks = document.querySelectorAll('li.child a');
        for (let i = 0, l = bookmarks.length; i < l; i++) {
            const bookmark = bookmarks[i];
            if (bookmark.querySelector('hr')) {
                bookmark.title = '';
            } else {
                if (bookmark.hasClass('titled')) {
                    if (bookmark.scrollWidth <= bookmark.offsetWidth) {
                        bookmark.title = bookmark.href;
                        bookmark.removeClass('titled');
                    }
                } else if (bookmark.scrollWidth > bookmark.offsetWidth) {
                    const text = bookmark.querySelector('i').textContent;
                    const title = bookmark.title;
                    if (text !== title) {
                        bookmark.title = `${text}\n${title}`;
                        bookmark.addClass('titled');
                    }
                }
            }
        }
    };

    // addSeparator / deleteSeparator 已剥离至 src/actions.js（P1，经 actions 表调用）

    separatorManager.clear();
    const $tree = $('tree');

    // 树 HTML 生成与树数据辅助已剥离至 src/tree-render.js（P1，ES module 见
    // 顶部 import）。opens/rememberState 状态仍在这里（8b 再迁），模块经
    // getter 在调用时读取。
    const treeRender = initTreeRender({
        store,
        separatorManager,
        getOpens: () => opens,
        getRememberState: () => rememberState
    });

    const nodeTrees = {};

    // Phase 3 (issue #34): virtual "recently added" section pinned to the top
    // of the tree. Entries come from chrome.bookmarks.getRecent and are real
    // bookmarks, so opening, the context menu and Delete all operate on the
    // real bookmark id (matching Chrome's bookmark manager). To avoid
    // duplicate element ids with the real tree items below, the <li> uses a
    // 'neat-recent-item-' id prefix; the anchors carry data-virtual="1" so
    // drag-and-drop rejects them as drag sources and drop targets.
    const RECENT_BOOKMARKS_COUNT = 20;
    const recentBookmarksEnabled = () => !!store.get('showRecentBookmarks', '1');
    const generateRecentSectionHTML = () => {
        if (!recentBookmarksEnabled())
            return '';
        const header = _m('recentBookmarks').htmlspecialchars();
        return `<div id="recent-section"><div id="recent-header">${header}</div><ul id="recent-list" role="group"></ul></div>`;
    };
    const refreshRecentSection = () => {
        const list = $('recent-list');
        if (!list)
            return;
        chrome.bookmarks.getRecent(RECENT_BOOKMARKS_COUNT, items => {
            let html = '';
            for (let i = 0, l = items.length; i < l; i++) {
                const d = items[i];
                if (!d.url || separatorManager.isSeparator(d.title, d.url))
                    continue;
                html += `<li class="child" id="neat-recent-item-${d.id}" level="0" role="treeitem" data-parentid="${d.parentId}">` +
                    treeRender.generateBookmarkHTML(d.title, d.url, 'style="-webkit-padding-start: 0px" data-virtual="1"', d.id) +
                    '</li>';
            }
            list.innerHTML = html;
        });
    };
    // Keep the section fresh while the popup stays open; debounced so bulk
    // imports don't make it flicker. onRemoved is covered too, otherwise a
    // just-deleted bookmark would linger in the list.
    let refreshRecentTimer = null;
    const scheduleRecentRefresh = () => {
        if (!recentBookmarksEnabled())
            return;
        clearTimeout(refreshRecentTimer);
        refreshRecentTimer = setTimeout(refreshRecentSection, 300);
    };
    chrome.bookmarks.onCreated.addListener(scheduleRecentRefresh);
    chrome.bookmarks.onRemoved.addListener(scheduleRecentRefresh);

    const generateTree = tree => {
        let subTree;
        if (onlyShowBMBar) {
            // Find the bookmarks bar folder using folderType instead of fixed position
            const bookmarksBarFolder = treeRender.findFolderByType(tree, 'bookmarks-bar');
            if (bookmarksBarFolder) {
                subTree = bookmarksBarFolder.children || [];
            } else {
                // Fallback to old logic if folderType not available
                subTree = tree[0].children[0].children;
            }
        } else {
            // Use getEffectiveSubTree to handle dual-storage Chrome
            subTree = treeRender.getEffectiveSubTree(tree);
        }
        const html = treeRender.generateHTML(subTree);
        treeRender.generateNodeTrees(subTree, nodeTrees);
        // Keep the fuzzy-search index in sync with the freshly loaded tree
        search.updateIndex(tree);

        $tree.innerHTML = generateRecentSectionHTML() + html;
        refreshRecentSection();

        // Refresh sync indicators after tree is generated
        if (store.getSyncSetting('showSyncStatus', 'true') === 'true') {
            setTimeout(() => {
                refreshSyncIndicators();
            }, 100);
        }

        if (rememberState) {
            $tree.scrollTop = store.get('scrollTop') ? store.get('scrollTop') : 0;
        }

        const focusID = store.get('focusID');
        if (typeof focusID !== 'undefined' && focusID !== null) {
            const focusEl = $(`neat-tree-item-${focusID}`);
            if (focusEl) {
                const oriOverflow = $tree.style.overflow;
                $tree.style.overflow = 'hidden';
                focusEl.style.width = '100%';
                focusEl.firstElementChild.addClass('focus');
                setTimeout(() => {
                    $tree.style.overflow = oriOverflow;
                }, 1);
                setTimeout(() => {
                    store.remove('focusID');
                }, 4000);
            }
        }

        setTimeout(adaptBookmarkTooltips, 100);

        // try to load local separator list used in last version
        const sm = new SeparatorManager(store);
        sm.load();
        const seps = sm.getAll();
        for (let i = 0; i < seps.length; i++) {
            if (seps[i]) {
                actions.addSeparator(seps[i], 'after');
            }
        }
        // and discard this setting from now on
        sm.clear();
        sm.save();

        tree = null;
    };

    chrome.bookmarks.getTree(generateTree);

    // Events for the tree
    $tree.addEventListener('scroll', () => {
        store.set('scrollTop', $tree.scrollTop);
    });
    $tree.addEventListener('focus', e => {
        const el = e.target;
        const tagName = el.tagName;
        const focusEl = $tree.querySelector('.focus');
        if (focusEl)
            focusEl.removeClass('focus');
        if (tagName === 'A' || tagName === 'SPAN') {
            store.set('focusID', el.parentNode.id.replace('neat-tree-item-', ''));
        } else {
            store.set('focusID', null);
        }
    }, true);
    const closeUnusedFolders = store.get('closeUnusedFolders');
    $tree.addEventListener('click', e => {
        if (e.button !== 0)
            return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName !== 'SPAN')
            return;
        if (e.shiftKey || e.ctrlKey)
            return;
        const parent = el.parentNode;
        parent.toggleClass('open');
        const expanded = parent.hasClass('open');
        parent.setAttribute('aria-expanded', expanded);
        const children = parent.querySelector('ul');
        // expand children for unexpanded folder node
        if (!children) {
            const id = parent.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id, children => {
                const html = treeRender.generateHTML(children, parseInt(parent.parentNode.dataset.level) + 1);
                const div = document.createElement('div');
                div.innerHTML = html;
                const ul = div.querySelector('ul');
                ul.inject(parent);
                div.destroy();
                setTimeout(adaptBookmarkTooltips, 100);
            });
        }
        if (closeUnusedFolders && expanded) {
            const siblings = parent.getSiblings('li');
            for (let i = 0, l = siblings.length; i < l; i++) {
                const li = siblings[i];
                if (li.hasClass('parent')) {
                    li.removeClass('open').setAttribute('aria-expanded', false);
                }
            }
        }
        let opens = $tree.querySelectorAll('li.open');
        opens = Array.map(li => li.id.replace('neat-tree-item-', ''), opens);
        store.set('opens', JSON.stringify(opens));
    });
    // Force middle clicks to trigger the focus event
    $tree.addEventListener('mouseup', e => {
        if (e.button !== 1)
            return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName !== 'A' && tagName !== 'SPAN')
            return;
        el.focus();
    });

    // parse version to dictionary
    const parseVersion = function(strversion) {
        let v = {};
        const keys = [ 'major', 'minor' ];
        let matches = strversion.match(/([\d]+)\.([\d]+)/i);
        if (!matches)
            return null;
        matches.slice(1).forEach(function(m, i) {
            v[keys[i]] = m.toInt();
        });
        return v;
    };

    // Donation
    let newOrUpgrade = true;
    const mf = chrome.runtime.getManifest();
    const currentVer = parseVersion(mf["version"]);
    if (!store.get('currentVersion')) {
        store.set('currentVersion', mf["version"]);
    } else {
        let recordVer = parseVersion(store.get('currentVersion'));
        store.set('currentVersion', mf["version"]);
        if (recordVer && currentVer && recordVer['major'] && recordVer['minor'] && currentVer['major'] && currentVer['minor']) {     
            if ( (recordVer['major'] > currentVer['major']) ||
                ((recordVer['major'] == currentVer['major']) && (recordVer['minor'] >= currentVer['minor'])) ){
                newOrUpgrade = false;
            }
        }
    }
    if (!store.get('openCount')) {
        store.set('openCount', 1);
    } else {
        store.set('openCount', parseInt(store.get('openCount'), 10) + 1);
    }
    if (!store.get('donationKey')) {
        store.set('donationKey', 1);
    }

    const $donation = $('donation');
    const showDonation = (show) => {
        if (show) {
            if (newOrUpgrade) {
                $('new-version-text').innerHTML = _m('versionMessage', 
                    [mf["version"], 'Github']);
            }
            $('donation-text').innerHTML = _m('donationMessage');
            $donation.style.display = 'block';
            let seconds = store.get('donationCountDown') > 0 ? store.get('donationCountDown') : 10;
            let countDown = setInterval(() => {
                store.set('donationCountDown', seconds);
                if (seconds <= 0) {
                    $('donation-go').innerHTML = _m('donationGo');
                    $('donation-go').disabled = false;
                    clearInterval(countDown);
                    store.set('donationCountDown', 0);
                } else {
                    $('donation-go').innerHTML = `${seconds}s`;
                    $('donation-go').disabled = true;
                    $('donation-go').focus();
                }
                seconds--;
            }, 1000);
        } else {
            $donation.style.display = 'none';
        }
    }

    if (newOrUpgrade || store.get('donationCountDown') > 0
        || !store.get('donationFactor')
        || parseInt(store.get('donationFactor'), 10) >= parseInt(store.get('donationKey'), 10)) {
        showDonation(true);
    } else {
        store.set('donationFactor', parseInt(store.get('donationFactor'), 10) + 1);
    }

    // Context menus live in src/context-menu.js (P1): the three menus, the
    // body contextmenu handler (position math, hide-editables/hide-sort on
    // root folders, the mac right-click-hold quirk) and every menu-item
    // dispatch. This must init before initSearch, because search calls
    // switchBookmarkMenu synchronously when it restores a saved query — but
    // actions/dialogs init further below (actions needs the search API), so
    // they reach the menus module through getters that only run at dispatch
    // time, when every const below is long initialized.
    const menus = initContextMenu({
        tree: $tree,
        os,
        rtl,
        get actions() { return actions; },
        get dialogs() { return dialogs; }
    });

    // Search lives in src/search.js (P1): it owns searchMode, the flat fuzzy
    // index, the results pane and every searchInput listener. generateTree
    // refreshes the index via search.updateIndex; everything else goes
    // through the returned API. switchBookmarkMenu comes from the menus
    // module (it hides the add-* menu entries while search is active).
    const search = initSearch({
        store,
        separatorManager,
        switchBookmarkMenu: menus.switchBookmarkMenu,
        generateBookmarkHTML: treeRender.generateBookmarkHTML,
        highlightTitlePositions: treeRender.highlightTitlePositions,
        rememberState
    });

    // Popup auto-height
    const resetHeight = () => {
        // The side panel is naturally full height; never resize it
        if (IS_PANEL)
            return;
        // Check if auto-resize is enabled (default to true for backward compatibility)
        const autoResizeEnabled = store.get('autoResizePopup') !== 'false';

        if (!autoResizeEnabled) {
            // If auto-resize is disabled, use the stored height or default to 600px
            const storedHeight = store.get('popupHeight') || '600';
            body.style.height = `${storedHeight}px`;
            return;
        }

        const zoomLevel = store.get('zoom') ? parseInt(store.get('zoom'), 10) / 100 : 1;
        const neatTree = $tree.firstElementChild;
        if (neatTree) {
            const fullHeight = (neatTree.offsetHeight + $tree.offsetTop + 16) * zoomLevel;
            // console.log(`fullHeight = ${fullHeight}`);
            chrome.tabs.getZoom(zoomFactor => {
                // zoomFactor is the zoom factor in chrome setting. e.g. 125%
                // left 50px at bottom if the screen is too short
                const maxHeight = Math.min(screen.height - window.screenY - 50, (600 / zoomFactor) - 1);
                // console.log(`zoomFactor = ${zoomFactor}, maxHeight = ${maxHeight}`);
                // 300 <= height <= maxHeight
                const height = Math.max(300 / zoomFactor, Math.min(fullHeight, maxHeight));
                // console.log(`height = ${height}`);
                const newHeightStyle = `${height}px`;
                // Slide up faster than down
                body.style.transitionDuration = (fullHeight < window.innerHeight) ? '.3s' : '.1s';
                body.style.height = newHeightStyle;
                store.set('popupHeight', height);
            });
        }
    };

    if (!search.isActive())
        resetHeight();

    $tree.addEventListener('click', resetHeight);
    $tree.addEventListener('keyup', resetHeight);

    // Reorder the children of folderId with serial bookmarks.move calls, then
    // rebuild the tree (the opens memory restores the expanded state).
    const sortFolderContents = (folderId, opts) => {
        chrome.bookmarks.getSubTree(folderId, nodes => {
            if (!nodes || !nodes.length)
                return;
            const sorted = window.VBMSort.sortNodes(nodes[0].children || [], opts);
            // Moving every node to its target index in ascending order leaves
            // the parent sorted, because positions before i are already final.
            const moveAll = list => list.reduce((chain, node, i) =>
                chain.then(() => new Promise(resolve => {
                    chrome.bookmarks.move(node.id, { index: i }, () => resolve());
                })), Promise.resolve());
            const applyLevel = list => moveAll(list).then(() => {
                if (!opts.recursive)
                    return Promise.resolve();
                return list.reduce((chain, node) =>
                    (node.children && node.children.length) ?
                        chain.then(() => applyLevel(node.children)) : chain,
                    Promise.resolve());
            });
            applyLevel(sorted).then(() => {
                chrome.bookmarks.getTree(generateTree);
            });
        });
    };

    // Dialogs live in src/dialogs.js (P1); onSort reorders a folder's children.
    const dialogs = initDialogs({ onSort: sortFolderContents });

    // Actions live in src/actions.js (P1): the whole bookmark action layer —
    // open/add/edit/delete/copy plus addSeparator/deleteSeparator. generateTree
    // and the menu/keyboard handlers reach them through this table; generateTree
    // only runs from async chrome callbacks, so the const is always initialized
    // before actions.addSeparator can fire (same pattern as `search` above).
    const actions = initActions({
        store,
        dialogs,
        search,
        separatorManager,
        generateBookmarkHTML: treeRender.generateBookmarkHTML,
        generateFolderHTML: treeRender.generateFolderHTML,
        generateSeparatorHTML: treeRender.generateSeparatorHTML,
        httpsPattern
    });

    const middleClickBgTab = !!store.get('middleClickBgTab');
    const leftClickNewTab = !!store.get('leftClickNewTab');

    function generateTreeForTarget(trees) {
        generateTree(trees);
        // This must be put int chrome API handler function. 
        // Otherwise it may be called before generation completed.
        if (store.get('focusID')) {
            const item = $tree.querySelector(`#neat-tree-item-${store.get('focusID')}`);
            if (item) {
                item.scrollIntoView();
            }
        }
        store.set('scrollTop', $tree.scrollTop);
    }

    const bookmarkHandler = e => {
        e.preventDefault();
        if (e.button !== 0 && e.button !== 1)
            return;
        // only take left-click
        // noOpenBookmark 已收归 src/dnd.js：拖拽落点无效时吞掉随后的点击
        if (dnd.consumeNoOpen()) // flag that disables opening bookmark
            return;
        const el = e.target;
        const ctrlMeta = (e.ctrlKey || e.metaKey || (e.button === 1));
        const shift = e.shiftKey;
        if (el.tagName === 'A' && !el.querySelector('hr')) { // bookmark
            if (el.className === "link-folder") { // search result folder
                // switch to tree
                search.quit();
                // get folder id (el parent is li)
                const id = el.parentNode.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                // all parent folder ids
                // set them as opened folders
                opens = treeRender.getParentPath(id, nodeTrees);
                store.set('opens', JSON.stringify(opens));
                // force to recover from remember state (opened folders)
                rememberState = true;
                // focus on the target folder
                store.set('focusID', id);
                // new handler to handle the scrolling
                chrome.bookmarks.getTree(generateTreeForTarget);
            } else {
                const url = el.href;
                if (ctrlMeta) { // ctrl/meta click
                    actions.openBookmarkNewTab(url, middleClickBgTab ? shift : !shift);
                } else { // click
                    if (shift) {
                        actions.openBookmarkNewWindow(url);
                    } else {
                        leftClickNewTab ? actions.openBookmarkNewTab(url, true, true) : actions.openBookmark(url);
                    }
                }
                search.reset();
            }
        } else if (el.tagName === 'SPAN') { // folder
            const li = el.parentNode;
            const id = li.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id, children => {
                const urls = Array.map(c => c.url, children).clean();
                const urlsLen = urls.length;
                if (!urlsLen)
                    return;
                if (ctrlMeta) { // ctrl/meta click
                    actions.openBookmarks(urls, middleClickBgTab ? shift : !shift);
                } else if (shift) { // shift click
                    actions.openBookmarksNewWindow(urls);
                }
            });
        }
    };
    $tree.addEventListener('click', bookmarkHandler);
    search.results.addEventListener('click', bookmarkHandler);
    $tree.addEventListener('auxclick', bookmarkHandler);

    // donation
    $('donation-go').addEventListener('click', () => {  
        showDonation(false);
        store.set('donationCountDown', 0);
        store.set('donationFactor', 1);
        if (parseInt(store.get('donationKey'), 10) > 3200) {
            store.set('donationKey', 3200);
        } else {
            store.set('donationKey', parseInt(store.get('donationKey'), 10) + 800);
        }
        actions.openBookmarkNewTab("https://github.com/windviki/vBookmarks/blob/master/donation/donation.md", true, true);
    });

    $('new-version-text').addEventListener('click', () => {
        actions.openBookmarkNewTab("https://github.com/windviki/vBookmarks#changelogs", true, true);
    });

    // Phase 3 (issue #30): quick-add star button — one click bookmarks the
    // current tab; when the page is already bookmarked the star is solid and
    // clicking opens the edit dialog for the existing bookmark.
    const quickAddBtn = $('quick-add-btn');
    const quickAddToast = $('quick-add-toast');
    let quickAddToastTimer = null;
    const showQuickAddToast = () => {
        quickAddToast.textContent = _m('quickAdded');
        quickAddToast.addClass('show');
        clearTimeout(quickAddToastTimer);
        quickAddToastTimer = setTimeout(() => {
            quickAddToast.removeClass('show');
        }, 1500);
    };
    const withCurrentTabBookmark = callback => {
        chrome.tabs.query({
            'active': true,
            'windowId': chrome.windows.WINDOW_ID_CURRENT
        }, tabs => {
            const tab = tabs[0];
            if (!tab || !tab.url) {
                callback(null, null);
                return;
            }
            chrome.bookmarks.search({ url: tab.url }, results => {
                callback(tab, (results && results.length) ? results[0] : null);
            });
        });
    };
    const refreshQuickAddState = () => {
        withCurrentTabBookmark((tab, bookmark) => {
            // neatools' toggleClass forwards no `force` flag, so branch explicitly
            if (bookmark) {
                quickAddBtn.addClass('starred');
            } else {
                quickAddBtn.removeClass('starred');
            }
        });
    };
    const quickAddCurrentTab = () => {
        withCurrentTabBookmark((tab, bookmark) => {
            if (!tab)
                return;
            if (bookmark) { // already bookmarked: edit the existing one
                actions.editBookmarkFolder(bookmark.id);
            } else {
                chrome.bookmarks.create({
                    title: tab.title || tab.url,
                    url: tab.url,
                    parentId: store.get('quickAddFolderId', '1')
                }, () => {
                    quickAddBtn.addClass('starred');
                    showQuickAddToast();
                });
            }
        });
    };
    quickAddBtn.addEventListener('click', quickAddCurrentTab);
    refreshQuickAddState();
    // Ctrl/Cmd+D inside the popup does the same. Capture phase + stopPropagation
    // so the tree's type-ahead never sees the 'd'; skip while a dialog is open.
    document.addEventListener('keydown', e => {
        if (!(e.metaKey || e.ctrlKey) || (e.key !== 'd' && e.key !== 'D'))
            return;
        if (body.hasClass('needConfirm') || body.hasClass('needEdit') ||
            body.hasClass('needAlert') || body.hasClass('needInputName') ||
            body.hasClass('needSort'))
            return;
        e.preventDefault();
        e.stopPropagation();
        quickAddCurrentTab();
    }, true);

    // Disable Chrome auto-scroll feature
    window.addEventListener('mousedown', e => {
        if (e.button === 1) // middle-click
            e.preventDefault();
    });

    // Context menus live in src/context-menu.js (P1, init'd next to initSearch
    // above): the three menus, the body contextmenu handler and every
    // menu-item dispatch. What remains here is menus.* call sites: clearMenu
    // in the resizer code below, and the menu elements the context mousemove /
    // mouseout handlers bind to (menus.bookmarkMenu/folderMenu/separatorMenu).

    // Keyboard navigation lives in src/keyboard.js (P1): the tree/results
    // keydown+keyup handlers (arrow walking, Enter/Space, Home/End,
    // PageUp/PageDown, F2, Delete, type-ahead), the context menus' keydown
    // handler and the document-level Escape / Ctrl+F handler. menus, search,
    // actions and dialogs all init above, so they are passed straight in.
    initKeyboard({
        tree: $tree,
        search,
        actions,
        menus,
        dialogs,
        body,
        os,
        rtl
    });

    const contextMouseMove = e => {
        e.target.focus();
    };
    menus.bookmarkMenu.addEventListener('mousemove', contextMouseMove);
    menus.folderMenu.addEventListener('mousemove', contextMouseMove);
    menus.separatorMenu.addEventListener('mousemove', contextMouseMove);

    const contextMouseOut = function () {
        if (this.style.opacity.toInt())
            this.focus();
    };
    menus.bookmarkMenu.addEventListener('mouseout', contextMouseOut);
    menus.folderMenu.addEventListener('mouseout', contextMouseOut);
    menus.separatorMenu.addEventListener('mouseout', contextMouseOut);

    // Drag & drop ordering lives in src/dnd.js (P1): the tree mousedown drag
    // start, the document mousemove drop-target tracking (clone + overlay,
    // auto-scroll, drop-zone math) and the document mouseup drop
    // (chrome.bookmarks.move + DOM re-insertion). isDOMElementRootFolder and
    // canMoveBetweenStorage moved along (only dnd used them). resetSeparator
    // 是下方的 function 声明，hoist 到 store.ready.then 作用域顶部，此处注入
    // 安全；bookmarkHandler(上方) 与 zoom 块(下方) 经返回值引用 dnd，都只在
    // 用户事件时执行，TDZ 安全。
    const dnd = initDnd({
        tree: $tree,
        store,
        rtl,
        resetSeparator
    });

    // Resizer
    const $resizerx = $('resizer-x');
    const $resizery = $('resizer-y');
    let resizerXDown = false;
    let resizerYDown = false;
    let bodyWidth = 0,
        bodyHeight = 0, 
        screenX = 0, 
        screenY = 0;

    // Reset separators
    function resetSeparator() {
        const seps = separatorManager.getAll();
        for (let i = 0; i < seps.length; i++) {
            if (seps[i]) {
                const bmNode = $(`neat-tree-item-${seps[i]}`); //li
                if (!bmNode) {
                    return;
                }
                let lv = bmNode.getAttribute('level'); //getAttribute!
                if (!lv) {
                    lv = 1;
                }
                const paddingStart = lv * 14;
                const hrWidth = window.innerWidth - paddingStart - 40;
                bmNode.querySelector('hr').style.width = `${hrWidth}`; //li.a.hr
            }
        }
    }

    // Drag the edge
    $resizerx.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        resizerXDown = true;
        bodyWidth = body.offsetWidth;
        screenX = e.screenX;
    });
    $resizery.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        resizerYDown = true;
        bodyHeight = body.offsetHeight;
        screenY = e.screenY;
    });
    let currentMaxHeight = 0;
    function mouseMoveHandler(e) {
        if (!resizerXDown && !resizerYDown)
            return;
        e.preventDefault();
        const isX = resizerXDown;
        if (e.type === 'mouseup') {
            resizerXDown = false;
            resizerYDown = false;
            adaptBookmarkTooltips();
        }
        if (isX) {
            // record current width
            const changedWidth = rtl ? (e.screenX - screenX) : (screenX - e.screenX);
            let width = bodyWidth + changedWidth;
            // 320 < width < 640
            width = Math.min(640, Math.max(320, width));
            // if (!rtl && e.screenX < 640 || rtl && e.screenX > 640) {
            //     $resizerx.style.cursor = 'not-allowed';
            // } else {
            //     $resizerx.style.cursor = 'col-resize';
            // }
            body.style.width = `${width}px`;
            store.set('popupWidth', width);
            resetSeparator(); // Reset separators
            menus.clearMenu();
        } else {
            // record current height
            const changedHeight = e.screenY - screenY;
            let height = bodyHeight + changedHeight;
            // 240 < height < 600
            if (currentMaxHeight <= 0) {
                chrome.tabs.getZoom(zoomFactor => {
                    currentMaxHeight = (600 / zoomFactor) - 1;
                    height = Math.min(currentMaxHeight, Math.max(currentMaxHeight / 2, height));
                    body.style.height = `${height}px`;
                    store.set('popupHeight', height);
                    resetSeparator(); // Reset separators
                    menus.clearMenu();
                });
            } else {
                height = Math.min(currentMaxHeight, Math.max(currentMaxHeight / 2, height));
                body.style.height = `${height}px`;
                store.set('popupHeight', height);
                resetSeparator(); // Reset separators
                menus.clearMenu();
                if (e.type === 'mouseup') {
                    currentMaxHeight = 0;
                }
            }
        }
    }
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseMoveHandler);

    // Make webkit transitions work only after elements are settled down
    setTimeout(() => {
        body.addClass('transitional');
    }, 10);

    // Zoom
    if (store.get('zoom')) {
        body.dataset.zoom = store.get('zoom');
    }
    const zoom = val => {
        if (dnd.isDragging())
            return; // prevent zooming when drag-n-dropping
        const dataZoom = body.dataset.zoom;
        const currentZoom = dataZoom ? dataZoom.toInt() : 100;
        if (val === 0) {
            delete body.dataset.zoom;
            store.remove('zoom');
        } else {
            let z = (val > 0) ? currentZoom + 10 : currentZoom - 10;
            z = Math.min(150, Math.max(90, z));
            body.dataset.zoom = `${z}`;
            store.set('zoom', z);
        }
        body.addClass('dummy').removeClass('dummy'); // force redraw
        resetHeight();
    };
    //use 'wheel' event and 'e.deltaY' instead (>= Chrome 61)
    function wheelHandler(e) {
        if (!e.metaKey && !e.ctrlKey)
            return;
        e.preventDefault();
        zoom(e.deltaY || e.wheelDelta);
    }
    document.addEventListener('wheel', wheelHandler);
    document.addEventListener('mousewheel', wheelHandler);
    document.addEventListener('keydown', e => {
        if (!e.metaKey && !e.ctrlKey)
            return;
        switch (e.key) {
            case '+': // =/+ (plus)
            case '=': // =/+ (plus)
                e.preventDefault();
                zoom(1);
                break;
            case '-': // - (minus)
                e.preventDefault();
                zoom(-1);
                break;
            case '0': // 0 (zero)
                e.preventDefault();
                zoom(0);
                break;
        }
    });

    // Fix stupid Chrome build 536 bug
    if (version.build >= 536)
        body.addClass('chrome-536');

    // Fix stupid wrong offset of the page, on Chrome Mac
    if (os === 'mac') {
        setTimeout(() => {
            const top = body.scrollTop;
            if (top !== 0)
                body.scrollTop = 0;
        }, 1500);
    }

    if (store.get('userstyle')) {
        const style = document.createElement('style');
        style.textContent = store.get('userstyle');
        style.inject(document.body);
    }

    // document.addEventListener('DOMContentLoaded', () => {

    //     const reportError = (msg, url, line) => {
    //         const manifest = chrome.runtime.getManifest();
    //         const version = manifest.version;
    //         const txt = `_s=84615e81d50c4ddabff522aee3c4b734&_r=img&Msg=${escape(msg)}&URL=${escape(url)}&Line=${line}&Platform=${escape(navigator.platform)}&Version=${escape(version)}&UserAgent=${escape(navigator.userAgent)}`;
    //         const i = document.createElement('img');
    //         i.setAttribute('src', `${('https:' === document.location.protocol) ? 'https://errorstack.appspot.com'
    //             : 'http://www.errorstack.com'}/submit?${txt}`);
    //         document.body.appendChild(i);
    //         i.onload = () => {
    //             document.body.removeChild(i);
    //         };
    //     };

    //     window.onerror = reportError;

    //     chrome.extension.onRequest.addListener(request => {
    //         if (request.error) reportError.apply(null, request.error);
    //     });
    // });
    
    if (store.get('customIcon')) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const customIcon = JSON.parse(store.get('customIcon'));
        const imageData = ctx.getImageData(0, 0, 19, 19);
        for (const key in customIcon) imageData.data[key] = customIcon[key];
        chrome.action.setIcon({
            imageData: imageData
        });
    }

    // Initialize sync status event listeners
    function initializeSyncControls() {
        // Listen for sync status changes
        if (window.addEventListener && window.syncManager) {
            window.addEventListener('syncStatusChanged', (event) => {
                // Update UI based on sync status changes
                const { bookmarkId, status } = event.detail;
                if (bookmarkId && status) {
                    updateBookmarkSyncStatus(bookmarkId, status);
                }
            });
        }
    }

    // Update individual bookmark sync status
    function updateBookmarkSyncStatus(bookmarkId, syncStatus) {
        const treeItem = document.getElementById(`neat-tree-item-${bookmarkId}`);
        const resultsItem = document.getElementById(`results-item-${bookmarkId}`);

        [treeItem, resultsItem].forEach(item => {
            if (item) {
                const syncIndicator = item.querySelector('.sync-indicator');
                if (syncIndicator) {
                    syncIndicator.remove();
                }

                if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && window.syncManager) {
                    const statusClass = window.syncManager.getSyncStatusIndicator(bookmarkId);
                    const tooltip = window.syncManager.getSyncTooltip(bookmarkId);
                    if (statusClass) {
                        const newIndicator = document.createElement('span');
                        newIndicator.className = `sync-indicator ${statusClass}`;
                        newIndicator.title = tooltip;
                        newIndicator.innerHTML = `<span class="sync-tooltip">${tooltip}</span>`;

                        // Insert into the favicon container
                        const containerElement = item.querySelector('.tree-item-link') || item.querySelector('.tree-item-span');
                        const faviconContainer = containerElement ? containerElement.querySelector('.favicon-container') : null;
                        if (faviconContainer) {
                            faviconContainer.appendChild(newIndicator);
                        } else {
                            // Fallback to old logic
                            const fallbackContainer = item.querySelector('a') || item.querySelector('span');
                            const imgElement = fallbackContainer.querySelector('img');
                            if (imgElement && imgElement.nextSibling) {
                                fallbackContainer.insertBefore(newIndicator, imgElement.nextSibling);
                            } else {
                                fallbackContainer.appendChild(newIndicator);
                            }
                        }
                    }
                }
            }
        });
    }

    // Refresh all sync indicators in the UI
    function refreshSyncIndicators() {
        if (window.syncManager) {
            window.syncManager.refreshAllSyncStatus();
        }
        // Update existing UI elements
        const allTreeItems = document.querySelectorAll('[id^="neat-tree-item-"], [id^="results-item-"]');
        allTreeItems.forEach(item => {
            const bookmarkId = item.id.replace(/^neat-tree-item-/, '').replace(/^results-item-/, '');
            if (bookmarkId && window.syncManager) {
                const statusClass = window.syncManager.getSyncStatusIndicator(bookmarkId);
                const tooltip = window.syncManager.getSyncTooltip(bookmarkId);

                const syncIndicator = item.querySelector('.sync-indicator');
                if (syncIndicator) {
                    syncIndicator.remove();
                }

                if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && statusClass) {
                    const newIndicator = document.createElement('span');
                    newIndicator.className = `sync-indicator ${statusClass}`;
                    newIndicator.title = tooltip;
                    newIndicator.innerHTML = `<span class="sync-tooltip">${tooltip}</span>`;

                    // Insert into the favicon container
                    const containerElement = item.querySelector('.tree-item-link') || item.querySelector('.tree-item-span');
                    const faviconContainer = containerElement ? containerElement.querySelector('.favicon-container') : null;
                    if (faviconContainer) {
                        faviconContainer.appendChild(newIndicator);
                    } else {
                        // Fallback to old logic
                        const fallbackContainer = item.querySelector('a') || item.querySelector('span');
                        const imgElement = fallbackContainer.querySelector('img');
                        if (imgElement && imgElement.nextSibling) {
                            fallbackContainer.insertBefore(newIndicator, imgElement.nextSibling);
                        } else {
                            fallbackContainer.appendChild(newIndicator);
                        }
                    }
                }
            }
        });
    }

    // Expose neat functions to window
    window.neat = {
        refreshSyncIndicators: refreshSyncIndicators
    };

    // Initialize sync controls when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSyncControls);
    } else {
        initializeSyncControls();
    }
    });
})(window);
