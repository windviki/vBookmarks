import { SeparatorManager } from './separators.js';
import { initDialogs } from './dialogs.js';
import { initSearch } from './search.js';
import { initActions } from './actions.js';
import { initContextMenu } from './context-menu.js';

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
    //RGB -> HEX
    String.prototype.colorHex = function () {
        const that = this;
        if (/^(rgb|RGB)/.test(that)) {
            const aColor = that.replace(/(?:\(|\)|rgb|RGB)*/g, "").split(",");
            let strHex = "#";
            for (let i = 0; i < aColor.length; i++) {
                let hex = Number(aColor[i]).toString(16);
                if (hex === "0") {
                    hex += hex;
                }
                strHex += hex;
            }
            if (strHex.length !== 7) {
                strHex = that;
            }
            return strHex;
        } else if (hexColorRegex.test(that)) {
            const aNum = that.replace(/#/, "").split("");
            if (aNum.length === 6) {
                return that;
            } else if (aNum.length === 3) {
                let numHex = "#";
                for (let i = 0; i < aNum.length; i += 1) {
                    numHex += (aNum[i] + aNum[i]);
                }
                return numHex;
            }
        } else {
            return '';
        }
    };

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

    const getFaviconUrl = (url) => {
        // return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
        // return chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`);
        const favUrl = new URL(chrome.runtime.getURL("/_favicon/"));
        favUrl.searchParams.set("pageUrl", url);
        favUrl.searchParams.set("size", "32");
        return favUrl.toString();
    };

    // Escape a title and wrap the characters at the given (pre-escape) indices
    // in <mark> tags. Built one character at a time so escaping never shifts
    // the indices. Used to highlight fuzzy-search matches (Phase 2b).
    const highlightTitlePositions = (title, positions) => {
        if (!positions || !positions.length)
            return title.htmlspecialchars();
        const posSet = new Set(positions);
        let html = '';
        let inMark = false;
        for (let i = 0; i < title.length; i++) {
            const hit = posSet.has(i);
            if (hit && !inMark) {
                html += '<mark>';
                inMark = true;
            } else if (!hit && inMark) {
                html += '</mark>';
                inMark = false;
            }
            html += title.charAt(i).htmlspecialchars();
        }
        if (inMark)
            html += '</mark>';
        return html;
    };

    const generateBookmarkHTML = (title, url, extras, bookmarkId, titlePositions) => {
        if (!extras)
            extras = '';
        const u = url.htmlspecialchars();
        // let favicon = `chrome://favicon/${u}`;
        // let favicon = 'assets/design/icon-2.png';
        let favicon = getFaviconUrl(url);
        let tooltipURL = url;
        if (/^javascript:/i.test(url)) {
            if (url.length > 140)
                tooltipURL = `${url.slice(0, 140)}...`;
            favicon = '/assets/icons/document-code.png';
        }
        tooltipURL = tooltipURL.htmlspecialchars();
        const name = (title && titlePositions && titlePositions.length)
            ? highlightTitlePositions(title, titlePositions)
            : (title.htmlspecialchars() || (httpsPattern.test(url) ? url.replace(httpsPattern, '') : _m('noTitle')));

        // Add sync status indicator if enabled
        let syncIndicator = '';
        if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && window.syncManager && bookmarkId) {
            const syncStatus = window.syncManager.getSyncStatusIndicator(bookmarkId);
            const syncTooltip = window.syncManager.getSyncTooltip(bookmarkId);
            if (syncStatus) {
                syncIndicator = `<span class="sync-indicator ${syncStatus}" title="${syncTooltip}">
                    <span class="sync-tooltip">${syncTooltip}</span>
                </span>`;
            }
        }

        return `<a href="${u}" title="${tooltipURL}" tabindex="0" ${extras} class="tree-item-link">
                <div class="favicon-container">
                    <img src="${favicon}" width="16" height="16" alt="">
                    ${syncIndicator}
                </div>
                <i>${name}</i>
                </a>`;
    };

    const generateFolderHTML = (title, extras, folderId, folderNode) => {
        if (!extras)
            extras = '';

        // Handle dual storage folders - add suffix for non-syncing folders
        let displayTitle = title || _m('noTitle');
        if (folderNode && folderNode.syncing === false && folderNode.folderType) {
            // Add suffix to distinguish between syncing and non-syncing folders
            const suffix = ' (Local)';
            displayTitle += suffix;
        }

        // Add sync status indicator if enabled
        let syncIndicator = '';
        if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && window.syncManager && folderId) {
            const syncStatus = window.syncManager.getSyncStatusIndicator(folderId);
            const syncTooltip = window.syncManager.getSyncTooltip(folderId);
            if (syncStatus) {
                syncIndicator = `<span class="sync-indicator ${syncStatus}" title="${syncTooltip}">
                    <span class="sync-tooltip">${syncTooltip}</span>
                </span>`;
            }
        }

        return `<span tabindex="0" ${extras} class="tree-item-span">
		   <b class="twisty"></b>
		   <div class="favicon-container">
		       <img src="/assets/icons/folder.png" width="16" height="16" alt="">
		       ${syncIndicator}
		   </div>
		   <i>${displayTitle}</i>
		   </span>`;
    };

    const generateSeparatorHTML = paddingStart => {
        let color = '#888888';
        if (store.get('separatorcolor')) {
            color = store.get('separatorcolor').colorHex();
        }
        const aStyle = `style="-webkit-padding-start: ${paddingStart}px"`;
        const hrWidth = window.innerWidth - paddingStart - 40;
        const hrStyle = `style="width: ${hrWidth}px; border: 1px dotted ${color};"`;
        return `<a href="#" tabindex="0" ${aStyle} class="tree-item-link">
                <div class="favicon-container">
                    <img width="16" height="16" style="display:none;" alt="">
                </div>
                <i></i>
                <hr class="child" role="treeitem" ${hrStyle}>
                </a>`;
    };

    const generateHTML = (data, level) => {
        if (!level)
            level = 0;
        const paddingStart = 14 * level;
        const group = (level === 0) ? 'tree' : 'group';
        // Phase 2b: an expanded folder with no children renders a muted
        // "(Empty)" row. It contains no focusable a/span element, so keyboard
        // navigation and the click handlers ignore it. This covers both child
        // loading paths (pre-rendered open folders and lazy expand), which
        // both funnel through generateHTML.
        if (!data.length) {
            return `<ul role="${group}" data-level="${level}"><li class="empty-folder" style="-webkit-padding-start: ${paddingStart}px"><i>${_m('folderEmpty')}</i></li></ul>`;
        }
        let html = `<ul role="${group}" data-level="${level}">`;

        for (let i = 0, l = data.length; i < l; i++) {
            const d = data[i];
            const children = d.children;
            const title = d.title.htmlspecialchars();
            const url = d.url;
            const id = d.id;
            const parentID = d.parentId;
            const idHTML = id ? `id="neat-tree-item-${id}"` : '';
            const isFolder = d.dateGroupModified || children || typeof url === 'undefined';
            const stylePad = `style="-webkit-padding-start: ${paddingStart}px"`;
            const classStr = isFolder ? 'parent' : 'child';
            const isOpen = rememberState && opens.contains(id);
            const open = isOpen ? 'open' : '';
            const ariaStr = isFolder ? `aria-expanded="${isOpen}"` : '';
            html += `<li class="${classStr} ${open}" ${idHTML} level="${level}" role="treeitem" ${ariaStr} data-parentid="${parentID}">`;
            if (isFolder) { // folder node
                html += generateFolderHTML(title, stylePad, id, d);
                // only generate children for opened folder
                if (isOpen) {
                    if (children) {
                        html += generateHTML(children, level + 1);
                    } else {
                        (_id => {
                            chrome.bookmarks.getChildren(_id, children => {
                                const html = generateHTML(children, level + 1);
                                const div = document.createElement('div');
                                div.innerHTML = html;
                                const ul = div.querySelector('ul');
                                ul.inject($(`neat-tree-item-${_id}`));
                                div.destroy();
                            });
                        })(id);
                    }
                }
            } else { // bookmark node
                if (separatorManager.isSeparator(title, url)) {
                    html += generateSeparatorHTML(paddingStart);
                    separatorManager.add(id);
                } else {
                    html += generateBookmarkHTML(title, url, stylePad, id);
                }
            }
            html += '</li>';
        }
        html += '</ul>';
        return html;
    };

    // addSeparator / deleteSeparator 已剥离至 src/actions.js（P1，经 actions 表调用）

    separatorManager.clear();
    const $tree = $('tree');

    const nodeTrees = {};
    const generateNodeTrees = (data, list) => {
        if (data) {
            for (let i = 0, l = data.length; i < l; i++) {
                const d = data[i];
                if (!d.url) {
                    // Use isRootFolder to properly identify root folders in dual-storage Chrome
                    if (!isRootFolder(d)) {
                        list[d.id] = d.parentId;
                    }
                    generateNodeTrees(d.children, list);
                }
            }
        }
    };

    const getParentPath = (nodeID, list) => {
        const nodePath = [];
        nodePath.push(nodeID);
        let lastID = nodeID;
        while (nodeID) {
            if (nodeID in list) {
                if (lastID === list[nodeID]) {
                    break;
                }
                nodePath.push(list[nodeID]);
                nodeID = list[nodeID];
                lastID = nodeID;
            } else {
                break;
            }
        }
        return nodePath.reverse();
    };

    // Find folder by folderType in the tree (supports dual storage)
    const findFolderByType = (tree, folderType) => {
        if (!tree || !Array.isArray(tree)) return null;

        function searchFolder(nodes) {
            if (!nodes || !Array.isArray(nodes)) return null;

            for (const node of nodes) {
                if (node.folderType === folderType) {
                    return node;
                }
                if (node.children) {
                    const found = searchFolder(node.children);
                    if (found) return found;
                }
            }
            return null;
        }

        return searchFolder(tree);
    };

    // Get effective subtree handling dual-storage Chrome (multiple root nodes)
    const getEffectiveSubTree = (tree) => {
        if (!tree || !Array.isArray(tree) || tree.length === 0) {
            return [];
        }

        // Check if we have the new dual-storage structure (multiple root nodes)
        const hasFolderType = tree.some(node => node.folderType !== undefined);

        if (hasFolderType) {
            // New Chrome with dual storage: tree may have multiple root nodes
            // Return all root nodes' children combined
            const allChildren = [];
            tree.forEach(rootNode => {
                if (rootNode.children && Array.isArray(rootNode.children)) {
                    allChildren.push(...rootNode.children);
                }
            });
            return allChildren;
        } else {
            // Old Chrome: single root node structure
            // Legacy: tree[0].children contains the three main folders
            return tree[0].children || [];
        }
    };

    // Check if a node is a root folder (supports dual storage)
    const isRootFolder = (node) => {
        // Handle both object (from tree) and plain object with string properties
        const nodeParentId = node.parentId;
        const nodeFolderType = node.folderType;

        // Check for root folder indicators:
        // - parentId === "0" (string) or parentId === 0 (number)
        // - folderType is defined (bookmarks-bar/other/mobile)
        return nodeParentId === 0 || nodeParentId === "0" ||
               nodeFolderType !== undefined;
    };

    // Check if a DOM element represents a root folder (for drag/drop)
    const isDOMElementRootFolder = (el) => {
        if (!el || !el.dataset) return false;
        // Check dataset attributes which may contain folderType info
        const parentId = el.dataset.parentid;
        const folderType = el.dataset.foldertype;
        return parentId === "0" || parentId === 0 || folderType !== undefined;
    };

    // Check if a bookmark can be moved between storage spaces
    const canMoveBetweenStorage = (sourceId, targetParentId, callback) => {
        chrome.bookmarks.get(sourceId, (sourceNodes) => {
            if (!sourceNodes || !sourceNodes.length) {
                callback(true);
                return;
            }
            const sourceNode = sourceNodes[0];

            chrome.bookmarks.get(sourceNode.parentId, (sourceParentNodes) => {
                const sourceParent = sourceParentNodes && sourceParentNodes[0];

                chrome.bookmarks.get(targetParentId, (targetParentNodes) => {
                    const targetParent = targetParentNodes && targetParentNodes[0];

                    // If no sync info, allow (old Chrome or no sync enabled)
                    if (!sourceParent || !targetParent ||
                        sourceParent.syncing === undefined ||
                        targetParent.syncing === undefined) {
                        callback(true);
                        return;
                    }

                    // Block cross-storage moves in dual-storage Chrome
                    callback(sourceParent.syncing === targetParent.syncing);
                });
            });
        });
    };

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
                    generateBookmarkHTML(d.title, d.url, 'style="-webkit-padding-start: 0px" data-virtual="1"', d.id) +
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
            const bookmarksBarFolder = findFolderByType(tree, 'bookmarks-bar');
            if (bookmarksBarFolder) {
                subTree = bookmarksBarFolder.children || [];
            } else {
                // Fallback to old logic if folderType not available
                subTree = tree[0].children[0].children;
            }
        } else {
            // Use getEffectiveSubTree to handle dual-storage Chrome
            subTree = getEffectiveSubTree(tree);
        }
        const html = generateHTML(subTree);
        generateNodeTrees(subTree, nodeTrees);
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
                const html = generateHTML(children, parseInt(parent.parentNode.dataset.level) + 1);
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
        generateBookmarkHTML,
        highlightTitlePositions,
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
        generateBookmarkHTML,
        generateFolderHTML,
        generateSeparatorHTML,
        httpsPattern
    });

    const middleClickBgTab = !!store.get('middleClickBgTab');
    const leftClickNewTab = !!store.get('leftClickNewTab');
    let noOpenBookmark = false;

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
        if (noOpenBookmark) { // flag that disables opening bookmark
            noOpenBookmark = false;
            return;
        }
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
                opens = getParentPath(id, nodeTrees);
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
    // in the keyboard/drag code below, and the menu elements the keyboard
    // handlers bind to (menus.bookmarkMenu/folderMenu/separatorMenu).

    // Keyboard navigation
    let keyBuffer = '';
    let keyBufferTimer = null;
    const treeKeyDown = function (e) {
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName)) {
            item = $tree.querySelector('.focus') || $tree.querySelector('li:first-child>span');
        }
        let li = item.parentNode;
        let keyValue = e.key;
        const metaKey = e.metaKey;
        if (keyValue === 'ArrowDown' && metaKey)
            keyValue = 'End'; // cmd + down (Mac)
        if (keyValue === 'ArrowUp' && metaKey)
            keyValue = 'Home'; // cmd + up (Mac)
        switch (keyValue) {
            case 'ArrowDown': // down
                e.preventDefault();
                const liChild = li.querySelector('ul>li:first-child');
                // may be an "(Empty)" marker row, which has no focusable element
                const liChildFocus = liChild ? liChild.querySelector('a, span') : null;
                let nextLiSpan;
                if (li.hasClass('open') && liChildFocus) {
                    liChildFocus.focus();
                } else {
                    let nextLi = li.nextElementSibling;
                    if (nextLi) {
                        nextLiSpan = nextLi.querySelector('a, span');
                        if (nextLiSpan) {
                            nextLiSpan.focus();
                        }
                    } else if (!search.isActive()) {
                        nextLi = null;
                        do {
                            if (li)
                                li = li.parentNode.parentNode;
                            if (li)
                                nextLi = li.nextElementSibling;
                            if (nextLi)
                                nextLiSpan = nextLi.querySelector('a, span');
                            if (nextLiSpan) //fixed: pushed down "DOWN" when the focus was at the last node
                                nextLiSpan.focus();
                        } while (li && !nextLi);
                    }
                }
                break;
            case 'ArrowUp': // up
            {
                e.preventDefault();
                let prevLi = li.previousElementSibling;
                if (prevLi) {
                    while (prevLi.hasClass('open') && prevLi.querySelector('ul>li:last-child')) {
                        const lis = prevLi.querySelectorAll('ul>li:last-child');
                        prevLi = Array.filter(li => !!li.parentNode.offsetHeight, lis).getLast();
                    }
                    const prevLiFocus = prevLi && prevLi.querySelector('a, span');
                    if (prevLiFocus) {
                        prevLiFocus.focus();
                    } else if (prevLi) {
                        // "(Empty)" marker row: land on its folder instead
                        const markerParentLi = prevLi.parentNode.parentNode;
                        if (markerParentLi && markerParentLi.tagName === 'LI')
                            markerParentLi.querySelector('a, span').focus();
                    }
                } else {
                    const parentPrevLi = li.parentNode.parentNode;
                    if (parentPrevLi && parentPrevLi.tagName === 'LI') {
                        parentPrevLi.querySelector('a, span').focus();
                    } else {
                        search.input.focus();
                    }
                }
            }
                break;
            case 'ArrowRight': // right (left for RTL)
            {
                e.preventDefault();
                // open/close dir node
                if (li.hasClass('parent') && ((!rtl && !li.hasClass('open')) || (rtl && li.hasClass('open')))) {
                    let event = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    });
                    li.firstElementChild.dispatchEvent(event);
                } else {
                    if (rtl) {
                        // move back to parent node
                        const parentID = li.dataset.parentid;
                        if (parentID === '0')
                            return;
                        // fixed: check whether the parent item exists
                        const item = $(`neat-tree-item-${parentID}`);
                        if (item) {
                            item.querySelector('span').focus();
                        }
                    } else {
                        let elRect = e.target.getBoundingClientRect();
                        let event = new MouseEvent("contextmenu", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: elRect.right,
                            clientY: elRect.bottom,
                        });
                        e.target.dispatchEvent(event);
                    }
                }
            }
                break;
            case 'ArrowLeft': // left (right for RTL)
            {
                e.preventDefault();
                // open/close dir node
                if (li.hasClass('parent') && ((!rtl && li.hasClass('open')) || (rtl && !li.hasClass('open')))) {
                    let event = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    });
                    li.firstElementChild.dispatchEvent(event);
                } else {
                    if (!rtl) {
                        // move back to parent node
                        const parentID = li.dataset.parentid;
                        if (parentID === '0')
                            return;
                        // fixed: check whether the parent item exists
                        const item = $(`neat-tree-item-${parentID}`);
                        if (item) {
                            item.querySelector('span').focus();
                        }
                    } else {
                        let elRect = e.target.getBoundingClientRect();
                        let event = new MouseEvent("contextmenu", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: elRect.left,
                            clientY: elRect.bottom,
                        });
                        e.target.dispatchEvent(event);
                    }
                }
            }
                break;
            case ' ': // space
            case 'Enter': // enter
            {
                e.preventDefault();
                let event = new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey
                });
                li.firstElementChild.dispatchEvent(event);
            }
                break;
            case 'End': // end
                if (search.isActive()) {
                    // may be the no-results empty state, which has no focusable row
                    const lastResult = this.querySelector('li:last-child a');
                    if (lastResult)
                        lastResult.focus();
                } else {
                    const lis = this.querySelectorAll('ul>li:last-child');
                    const li = Array.filter(li => !!li.parentNode.offsetHeight, lis).getLast();
                    li.querySelector('span, a').focus();
                }
                break;
            case 'Home': // home
                if (search.isActive()) {
                    const firstResult = this.querySelector('ul>li:first-child a');
                    if (firstResult)
                        firstResult.focus();
                } else {
                    this.querySelector('ul>li:first-child').querySelector('span, a').focus();
                }
                break;
            case 'PageDown': // page down
            {
                const self = this;
                const getLastItem = () => {
                    const bound = self.offsetHeight + self.scrollTop;
                    const items = self.querySelectorAll('a, span');
                    return Array.filter(item => !!item.parentElement.offsetHeight && item.offsetTop < bound, items).getLast();
                };
                const item = getLastItem();
                if (item !== document.activeElement) {
                    e.preventDefault();
                    item.focus();
                } else {
                    setTimeout(() => {
                        getLastItem().focus();
                    }, 0);
                }
            }
                break;
            case 'PageUp': // page up
            {
                const self = this;
                const getFirstItem = () => {
                    const bound = self.scrollTop;
                    const items = self.querySelectorAll('a, span');
                    return Array.filter(item => !!item.parentElement.offsetHeight && ((item.offsetTop + item.offsetHeight) > bound), items)[0];
                };
                const item = getFirstItem();
                if (item !== document.activeElement) {
                    e.preventDefault();
                    item.focus();
                } else {
                    setTimeout(() => {
                        getFirstItem().focus();
                    }, 0);
                }
            }
                break;
            case 'F2': // F2, not for Mac
            {
                if (os === 'mac')
                    break;
                const id = li.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                actions.editBookmarkFolder(id);
            }
                break;
            case 'Delete': // delete
                break; // don't run 'default'
            default: {
                if (keyValue.length > 1)
                    return;
                const key = keyValue;
                if (key !== keyBuffer)
                    keyBuffer += key;
                clearTimeout(keyBufferTimer);
                keyBufferTimer = setTimeout(() => {
                    keyBuffer = '';
                }, 500);
                const lis = this.querySelectorAll('ul>li');
                const items = [];
                for (let i = 0, l = lis.length; i < l; i++) {
                    const li = lis[i];
                    if (li.parentNode.offsetHeight)
                        items.push(li.firstElementChild);
                }
                const pattern = new RegExp(`^${keyBuffer.escapeRegExp()}`, 'i');
                const batch = [];
                let startFind = false;
                let found = false;
                const activeElement = document.activeElement;
                for (let i = 0, l = items.length; i < l; i++) {
                    const item = items[i];
                    if (item === activeElement) {
                        startFind = true;
                    } else if (startFind) {
                        if (pattern.test(item.textContent.trim())) {
                            found = true;
                            item.focus();
                            break;
                        }
                    } else {
                        batch.push(item);
                    }
                }
                if (!found) {
                    for (let i = 0, l = batch.length; i < l; i++) {
                        const item = batch[i];
                        if (pattern.test(item.textContent.trim())) {
                            item.focus();
                            break;
                        }
                    }
                }
            }
        }
    };
    $tree.addEventListener('keydown', treeKeyDown);
    search.results.addEventListener('keydown', treeKeyDown);

    const treeKeyUp = e => {
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName))
            item = $tree.querySelector('.focus') || $tree.querySelector('li:first-child>span');
        const li = item.parentNode;
        switch (e.key) {
            case "Delete": // delete
                e.preventDefault();
                const id = li.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                if (li.hasClass('parent')) {
                    chrome.bookmarks.getChildren(id, children => {
                        const urlsLen = Array.map(c => c.url, children).clean().length;
                        actions.deleteBookmarks(id, urlsLen, children.length - urlsLen);
                    });
                } else {
                    actions.deleteBookmark(id);
                }
                break;
        }
    };
    $tree.addEventListener('keyup', treeKeyUp);
    search.results.addEventListener('keyup', treeKeyUp);

    //use keyboardEvent.key (>= Chrome 51)
    const contextKeyDown = function (e) {
        const menu = this;
        const item = document.activeElement;
        const metaKey = e.metaKey;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (metaKey) { // cmd + down (Mac)
                    menu.lastElementChild.focus();
                } else {
                    if (item.classList.contains('menu-item')) {
                        let nextItem = item.nextElementSibling;
                        if (nextItem && nextItem.tagName === 'HR')
                            nextItem = nextItem.nextElementSibling;
                        if (nextItem) {
                            nextItem.focus();
                        } else if (os !== 'mac') {
                            menu.firstElementChild.focus();
                        }
                    } else {
                        item.firstElementChild.focus();
                    }
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (metaKey) { // cmd + up (Mac)
                    menu.firstElementChild.focus();
                } else {
                    if (item.classList.contains('menu-item')) {
                        let prevItem = item.previousElementSibling;
                        if (prevItem && prevItem.tagName === 'HR')
                            prevItem = prevItem.previousElementSibling;
                        if (prevItem) {
                            prevItem.focus();
                        } else if (os !== 'mac') {
                            menu.lastElementChild.focus();
                        }
                    } else {
                        item.lastElementChild.focus();
                    }
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (!rtl) {
                    const active = body.querySelector('.active');
                    if (active)
                        active.removeClass('active').focus();
                    menus.clearMenu();
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (rtl) {
                    const active = body.querySelector('.active');
                    if (active)
                        active.removeClass('active').focus();
                    menus.clearMenu();
                }
                break;
            case " ": // space
            case 'Enter': // enter
                e.preventDefault();
                let event = new MouseEvent("mouseup", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                });
                item.dispatchEvent(event);
                break;
            case 'Escape': // esc
                e.preventDefault();
                const active = body.querySelector('.active');
                if (active)
                    active.removeClass('active').focus();
                menus.clearMenu();
                break;
        }
    };
    menus.bookmarkMenu.addEventListener('keydown', contextKeyDown);
    menus.folderMenu.addEventListener('keydown', contextKeyDown);
    //menus.separatorMenu.addEventListener('keydown', contextKeyDown);

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

    // Drag and drop, baby
    let draggedBookmark = null;
    let draggedOut = false;
    let canDrop = false;
    let zoomLevel = 1;
    const bookmarkClone = $('bookmark-clone');
    const dropOverlay = $('drop-overlay');
    $tree.addEventListener('mousedown', e => {
        if (e.button !== 0) //left-click
            return;
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        const elParent = el.parentNode; //li
        if (el.dataset && el.dataset.virtual) // recent-section entries can't be dragged
            return;
        // can move any bookmarks/folders except the default root folders
        if ((el.tagName === 'A' && elParent.hasClass('child')) ||
            (el.tagName === 'SPAN' && elParent.hasClass('parent') && !isDOMElementRootFolder(elParent))) {
            e.preventDefault();
            draggedOut = false;
            draggedBookmark = el; //a
            if (store.get('zoom'))
                zoomLevel = parseInt(store.get('zoom'), 10) / 100;
            bookmarkClone.innerHTML = el.innerHTML; //<a>..</a>
            el.focus();
        }
    });
    let scrollTree = null,
        scrollTreeInterval = 100,
        scrollTreeSpot = 10;
    const stopScrollTree = () => {
        clearInterval(scrollTree);
        scrollTree = null;
    };
    document.addEventListener('mousemove', e => {
        let top;
        let elRectBottom;
        let elRectTop;
        let elRect;
        if (e.button !== 0)
            return;
        if (!draggedBookmark)
            return;
        e.preventDefault();
        let el = e.target;
        let clientX = e.clientX;
        let clientY = e.clientY;
        //fixed clientY
        clientY += document.body.scrollTop;
        //hovering over the dragged element itself
        if (el === draggedBookmark) {
            bookmarkClone.style.left = '-999px';
            dropOverlay.style.left = '-999px';
            canDrop = false;
            return;
        }
        draggedOut = true;
        //cursor moves outside the tree
        const treeTop = $tree.offsetTop,
            treeBottom = window.innerHeight;
        if (clientX < 0 || clientY < treeTop || clientX > $tree.offsetWidth || clientY > treeBottom) {
            bookmarkClone.style.left = '-999px';
            dropOverlay.style.left = '-999px';
            canDrop = false;
        }
        // if hovering over the top or bottom edges of the tree,
        // scroll the tree
        const treeScrollHeight = $tree.scrollHeight,
            treeOffsetHeight = $tree.offsetHeight;
        if (treeScrollHeight > treeOffsetHeight) { // only scroll when it's scrollable
            const treeScrollTop = $tree.scrollTop;
            if (clientY <= treeTop + scrollTreeSpot) {
                if (treeScrollTop === 0) {
                    stopScrollTree();
                } else if (!scrollTree)
                    scrollTree = setInterval(() => {
                        $tree.scrollBy(0, -scrollTreeSpot);
                        dropOverlay.style.left = '-999px';
                    }, scrollTreeInterval);
            } else if (clientY >= treeBottom - scrollTreeSpot) {
                if (treeScrollTop === (treeScrollHeight - treeOffsetHeight)) {
                    stopScrollTree();
                } else if (!scrollTree)
                    scrollTree = setInterval(() => {
                        $tree.scrollBy(0, scrollTreeSpot);
                        dropOverlay.style.left = '-999px';
                    }, scrollTreeInterval);
            } else {
                stopScrollTree();
            }
        }
        // collapse the folder before moving it
        const draggedBookmarkParent = draggedBookmark.parentNode;
        if (draggedBookmark.tagName === 'SPAN' && draggedBookmarkParent.hasClass('open')) {
            draggedBookmarkParent.removeClass('open').setAttribute('aria-expanded', false);
        }
        clientX /= zoomLevel;
        clientY /= zoomLevel;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        if (el.dataset && el.dataset.virtual) {
            // recent-section entries are not valid drop targets
            canDrop = false;
            bookmarkClone.style.top = `${clientY}px`;
            bookmarkClone.style.left = `${rtl ? (clientX - bookmarkClone.offsetWidth) : clientX}px`;
            dropOverlay.style.left = '-999px';
            return;
        }
        if (el.tagName === 'A' /* || el.tagName === 'HR'*/) {
            canDrop = true;
            bookmarkClone.style.top = `${clientY}px`;
            bookmarkClone.style.left = `${rtl ? (clientX - bookmarkClone.offsetWidth) : clientX}px`;
            elRect = el.getBoundingClientRect();
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            //fixed elRectBottom
            elRectBottom = elRect.bottom + document.body.scrollTop;
            top = (clientY >= elRectTop + elRect.height / 2) ? elRectBottom : elRectTop;
            dropOverlay.className = 'bookmark';
            dropOverlay.style.top = `${top}px`;
            dropOverlay.style.left = rtl ? '0px' : `${el.style.webkitPaddingStart.toInt() + 16}px`;
            dropOverlay.style.width = `${el.getComputedStyle('width').toInt() - 12}px`;
            dropOverlay.style.height = null;
        } else if (el.tagName === 'SPAN') {
            canDrop = true;
            bookmarkClone.style.top = `${clientY}px`;
            bookmarkClone.style.left = `${clientX}px`;
            elRect = el.getBoundingClientRect();
            top = null;
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            //fixed elRectBottom
            elRectBottom = elRect.bottom + document.body.scrollTop;
            const elRectHeight = elRect.height;
            const elParent = el.parentNode;
            if (!isDOMElementRootFolder(elParent)) {
                if (clientY < elRectTop + elRectHeight * .3) {
                    top = elRectTop;
                } else if (clientY > elRectTop + elRectHeight * .7 && !elParent.hasClass('open')) {
                    top = elRectBottom;
                }
            }
            if (top === null) {
                dropOverlay.className = 'folder';
                dropOverlay.style.top = `${elRectTop}px`;
                dropOverlay.style.left = '0px';
                dropOverlay.style.width = `${elRect.width}px`;
                dropOverlay.style.height = `${elRect.height}px`;
            } else {
                dropOverlay.className = 'bookmark';
                dropOverlay.style.top = `${top}px`;
                dropOverlay.style.left = `${el.style.webkitPaddingStart.toInt() + 16}px`;
                dropOverlay.style.width = `${el.getComputedStyle('width').toInt() - 12}px`;
                dropOverlay.style.height = null;
            }
        }
    });
    const onDrop = () => {
        draggedBookmark = null;
        bookmarkClone.style.left = '-999px';
        dropOverlay.style.left = '-999px';
        canDrop = false;
        resetSeparator();
    };
    document.addEventListener('mouseup', e => {
        let moveBottom;
        let elRectTop;
        let elRect;
        if (e.button !== 0) //left-click
            return;
        if (!draggedBookmark)
            return;
        stopScrollTree();
        if (!canDrop) {
            if (draggedOut)
                noOpenBookmark = true;
            draggedOut = false;
            onDrop();
            return;
        }
        //el is the target element "A" "SPAN"
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        let elParent = el.parentNode; //li
        const id = elParent.id.replace('neat-tree-item-', '');
        if (!id) {
            onDrop();
            return;
        }
        const draggedBookmarkParent = draggedBookmark.parentNode; //li
        const draggedID = draggedBookmarkParent.id.replace('neat-tree-item-', '');

        const dragDisplay = () => {
            //display
            draggedBookmarkParent.inject(elParent, moveBottom ? 'after' : 'before');
            draggedBookmark.style.webkitPaddingStart = el.style.webkitPaddingStart;
            draggedBookmark.focus();
            draggedBookmarkParent.setAttribute("level", elParent.getAttribute("level"));
            draggedBookmarkParent.setAttribute("data-parentid", elParent.getAttribute("data-parentid"));
            onDrop();
        }
        //fixed clientY
        const clientY = (e.clientY + document.body.scrollTop) / zoomLevel;
        if (el.tagName === 'A') { //dropped target is bookmark
            elRect = el.getBoundingClientRect();
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            moveBottom = (clientY >= elRectTop + elRect.height / 2);
            chrome.bookmarks.get(id, node => {
                if (!node || !node.length)
                    return;
                node = node[0];
                let index = node.index;
                const parentId = node.parentId;

                // Check for cross-storage move
                canMoveBetweenStorage(draggedID, parentId, (canMove) => {
                    if (!canMove) {
                        const msg = chrome.i18n.getMessage('crossStorageMoveWarning') ||
                                   'Cannot move bookmarks between synced and local storage.';
                        alert(msg);
                        onDrop();
                        return;
                    }
                    chrome.bookmarks.move(draggedID, {
                        parentId: parentId,
                        index: moveBottom ? ++index : index
                    }, dragDisplay);
                });
            });
        } else if (el.tagName === 'SPAN') { //dropped target is directory
            elRect = el.getBoundingClientRect();
            let move = 0; // 0 = middle, 1 = top, 2 = bottom
            elRectTop = elRect.top;
            const elRectHeight = elRect.height;
            elParent = el.parentNode; //li
            if (!isDOMElementRootFolder(elParent)) {
                if (clientY < elRectTop + elRectHeight * .3) {
                    move = 1;
                } else if (clientY > elRectTop + elRectHeight * .7 && !elParent.hasClass('open')) {
                    move = 2;
                }
            }
            if (move > 0) { //top or bottom
                moveBottom = (move === 2);
                chrome.bookmarks.get(id, node => {
                    if (!node || !node.length)
                        return;
                    node = node[0];
                    let index = node.index;
                    const parentId = node.parentId;
                    if (draggedID) {
                        // Check for cross-storage move
                        canMoveBetweenStorage(draggedID, parentId, (canMove) => {
                            if (!canMove) {
                                const msg = chrome.i18n.getMessage('crossStorageMoveWarning') ||
                                           'Cannot move bookmarks between synced and local storage.';
                                alert(msg);
                                onDrop();
                                return;
                            }
                            chrome.bookmarks.move(draggedID, {
                                parentId: parentId,
                                index: moveBottom ? ++index : index
                            }, dragDisplay);
                        });
                    }
                });
            } else { //middle position
                // Check for cross-storage move before moving into folder
                canMoveBetweenStorage(draggedID, id, (canMove) => {
                    if (!canMove) {
                        const msg = chrome.i18n.getMessage('crossStorageMoveWarning') ||
                                   'Cannot move bookmarks between synced and local storage.';
                        alert(msg);
                        onDrop();
                        return;
                    }
                    chrome.bookmarks.move(draggedID, {
                        parentId: id
                    }, () => {
                    const ul = elParent.querySelector('ul');
                    const level = parseInt(elParent.parentNode.dataset.level) + 1;
                    draggedBookmark.style.webkitPaddingStart = `${14 * level}px`;
                    if (ul) {
                        // a stale "(Empty)" marker must not survive a real drop
                        const emptyRow = ul.querySelector(':scope > li.empty-folder');
                        if (emptyRow)
                            emptyRow.destroy();
                        draggedBookmarkParent.inject(ul); //inject into bottom of ul
                        draggedBookmarkParent.setAttribute("level", parseInt(elParent.getAttribute("level")) + 1);
                        draggedBookmarkParent.setAttribute("data-parentid", id);
                    } else {
                        draggedBookmarkParent.destroy();
                    }
                    el.focus();
                    onDrop();
                }); // close chrome.bookmarks.move callback
                }); // close canMoveBetweenStorage callback
            }
        } else {
            onDrop();
        }
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

    // Closing dialogs on escape (dialog state helpers come from src/dialogs.js)
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (dialogs.anyOpen()) { // esc
                e.preventDefault();
                dialogs.closeDialogs();
            } else {
                if (search.isActive()) {
                    // Pressing esc shouldn't close the popup when search field has value
                    e.preventDefault();
                    search.quit();
                }
                if (search.input.value) {
                    e.preventDefault();
                    search.input.value = '';
                }
            }
        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { // cmd/ctrl + f
            search.input.focus();
            search.input.select();
            e.preventDefault();
        }
    });

    // Make webkit transitions work only after elements are settled down
    setTimeout(() => {
        body.addClass('transitional');
    }, 10);

    // Zoom
    if (store.get('zoom')) {
        body.dataset.zoom = store.get('zoom');
    }
    const zoom = val => {
        if (draggedBookmark)
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
