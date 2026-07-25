import { FOLDER_ICON, DOCUMENT_CODE_ICON, CHEVRON_ICON } from './icons.js';

/**
 * Tree HTML generation + tree data helpers (P1 module extracted from neat.js,
 * slice 8a — the pure rendering/data half of the tree view; events and state
 * stay in neat.js until 8b).
 *
 * Owns: favicon URL building, the escaped/<mark>-wrapped title highlighter,
 * the bookmark/folder/separator row templates and the recursive generateHTML
 * tree builder (including the lazy chrome.bookmarks.getChildren path for
 * open-but-unloaded folders and the muted "(Empty)" row). Also owns the tree
 * data helpers: nodeTrees population, parent-path resolution and the
 * dual-storage root handling (findFolderByType, getEffectiveSubTree,
 * isRootFolder).
 *
 * initTreeRender(ctx) is called once by neat.js right after $tree and
 * separatorManager exist. opens/rememberState are still neat.js state, so
 * they arrive as getters that are read at call time, never snapshotted.
 * ctx.store              — settings store (separatorcolor, showSyncStatus)
 * ctx.separatorManager   — separator detection/registration during generateHTML
 * ctx.getOpens()         — current expanded-folder id array (read per call)
 * ctx.getRememberState() — current remember-state flag (read per call)
 *
 * Returns { getFaviconUrl, highlightTitlePositions, generateBookmarkHTML,
 * generateFolderHTML, generateSeparatorHTML, generateHTML, generateNodeTrees,
 * getParentPath, findFolderByType, getEffectiveSubTree, isRootFolder }.
 * chrome.i18n.getMessage, chrome.runtime.getURL, chrome.bookmarks.getChildren,
 * window.syncManager, window.innerWidth and document remain page globals.
 * No neatools helpers: String.prototype.htmlspecialchars/colorHex became the
 * module-private pure functions below, Array.contains → includes,
 * inject → appendChild, destroy → remove.
 */

// neatools' String.prototype.htmlspecialchars as a pure function: escape
// >, then <, then " (order matters, ">" first so "&gt;" is not re-escaped).
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// neat.js keeps its own copy for the actions ctx; generateBookmarkHTML uses
// this module-local one.
const httpsPattern = /^https?:\/\//i;

// v4 task-2 (docs/v4task-2.md §3.6): build the id → containing-folder path
// map every list view shares for its row path labels. For each node the map
// holds the titles of its ancestor folders (top-down, untitled folders
// skipped) joined by ' / ' — for a bookmark that reads as "where it lives",
// for a folder as "where it sits". Pure: no chrome/DOM access, so vitest
// exercises it directly.
export const buildPathMap = tree => {
    const paths = {};
    const walk = (nodes, ancestors) => {
        if (!nodes)
            return;
        for (let i = 0, l = nodes.length; i < l; i++) {
            const node = nodes[i];
            // the invisible root has no parentId and contributes no title
            if (typeof node.parentId !== 'undefined')
                paths[node.id] = ancestors.join(' / ');
            if (node.children) {
                const title = (node.title || '').trim();
                const next = (typeof node.parentId !== 'undefined' && title)
                    ? ancestors.concat(title)
                    : ancestors;
                walk(node.children, next);
            }
        }
    };
    walk(tree || [], []);
    return paths;
};

// v4 task-2 (docs/v4task-2-list.md §3.3): relative-time buckets for the
// recent view's right slot and the search-history rows — 刚刚 / N 分钟 /
// N 小时 / 昨天 / N 天, past 7 days the caller shows the absolute date
// (key === null). Pure: ts/now in ms, out a {key, n} bucket, so vitest
// exercises the boundaries directly.
export const relativeTimeBucket = (ts, now) => {
    const diff = Math.max(0, (now || 0) - (ts || 0));
    const MIN = 60000;
    const HOUR = 60 * MIN;
    const DAY = 24 * HOUR;
    if (diff < MIN)
        return { key: 'timeJustNow' };
    if (diff < HOUR)
        return { key: 'timeMinutesAgo', n: Math.floor(diff / MIN) };
    if (diff < DAY)
        return { key: 'timeHoursAgo', n: Math.floor(diff / HOUR) };
    if (diff < 2 * DAY)
        return { key: 'timeYesterday' };
    if (diff <= 7 * DAY)
        return { key: 'timeDaysAgo', n: Math.floor(diff / DAY) };
    return { key: null }; // absolute date
};

export function initTreeRender(ctx = {}) {
    const store = ctx.store;
    const separatorManager = ctx.separatorManager;
    const getOpens = ctx.getOpens;
    const getRememberState = ctx.getRememberState;
    const _m = chrome.i18n.getMessage;

    const getFaviconUrl = (url) => {
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
            return htmlspecialchars(title);
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
            html += htmlspecialchars(title.charAt(i));
        }
        if (inMark)
            html += '</mark>';
        return html;
    };

    const generateBookmarkHTML = (title, url, extras, bookmarkId, titlePositions, meta) => {
        if (!extras)
            extras = '';
        const u = htmlspecialchars(url);
        let tooltipURL = url;
        // `javascript:` bookmarklets get the inline document-code glyph
        // (P4 — bitmap retired); everything else goes through _favicon.
        const isBookmarklet = /^javascript:/i.test(url);
        const faviconHtml = isBookmarklet
            ? DOCUMENT_CODE_ICON
            : `<img src="${getFaviconUrl(url)}" width="16" height="16" alt="">`;
        if (isBookmarklet && url.length > 140)
            tooltipURL = `${url.slice(0, 140)}...`;
        tooltipURL = htmlspecialchars(tooltipURL);
        const name = (title && titlePositions && titlePositions.length)
            ? highlightTitlePositions(title, titlePositions)
            : (htmlspecialchars(title) || (httpsPattern.test(url) ? url.replace(httpsPattern, '') : _m('noTitle')));

        // v4 task-2 §3.6: list views (search/recent/…) pass meta.path — the
        // bookmark's containing-folder path from buildPathMap. The tooltip
        // unifies to `标题 + URL + 路径` (absorbing the old async
        // parent-folder tooltip), and the row gains path labels when the
        // showItemPath setting is on: inline `.row-path` in the narrow popup,
        // a second muted line `.row-sub` at ≥480px / in panel mode (CSS
        // container query picks the form). Views with a custom meta slot
        // (recent: relative time on the right, `path · absolute time` as the
        // second line — docs/v4task-2-list.md §3.3) override the two label
        // slots wholesale via meta.rightText / meta.subText; both slots are
        // escaped here, so callers compose them from raw text. A view badge
        // (dead/blocked status pill, docs/v4task-2-list.md §3.5) comes via
        // meta.badge = { text, cls } and sits left of the right slot.
        const path = (meta && meta.path) ? String(meta.path) : '';
        const tooltip = path
            ? `${htmlspecialchars(title || (httpsPattern.test(url) ? url.replace(httpsPattern, '') : _m('noTitle')))}\n${tooltipURL}\n${htmlspecialchars(path)}`
            : tooltipURL;
        const showPath = path && !!store.get('showItemPath', '1');
        const rightText = meta && typeof meta.rightText === 'string'
            ? meta.rightText : (showPath ? path : '');
        const subText = meta && typeof meta.subText === 'string'
            ? meta.subText : (showPath ? path : '');
        const badge = meta && meta.badge && meta.badge.text
            ? `<span class="row-badge ${htmlspecialchars(meta.badge.cls || '')}">${htmlspecialchars(meta.badge.text)}</span>`
            : '';
        const nameHtml = (rightText || subText || badge)
            ? `<span class="row-main"><i>${name}</i>` +
              (subText ? `<span class="row-sub" dir="auto">${htmlspecialchars(subText)}</span>` : '') +
              `</span>` + badge +
              (rightText ? `<span class="row-path" dir="auto">${htmlspecialchars(rightText)}</span>` : '')
            : `<i>${name}</i>`;

        // Add sync status indicator if enabled
        let syncIndicator = '';
        if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && window.syncManager && bookmarkId) {
            const syncStatus = window.syncManager.getSyncStatusIndicator(bookmarkId);
            const syncTooltip = window.syncManager.getSyncTooltip(bookmarkId);
            if (syncStatus) {
                syncIndicator = `<span class="sync-indicator ${syncStatus}">
                    <span class="sync-tooltip">${syncTooltip}</span>
                </span>`;
            }
        }

        return `<a href="${u}" title="${tooltip}" tabindex="0" ${extras} class="tree-item-link">
                <div class="favicon-container">
                    ${faviconHtml}
                    ${syncIndicator}
                </div>
                ${nameHtml}
                </a>`;
    };

    const generateFolderHTML = (title, extras, folderId, folderNode) => {
        if (!extras)
            extras = '';

        // Handle dual storage folders - localized suffix marks which root a
        // folder belongs to (both roots are named alike by Chrome)
        let displayTitle = title || _m('noTitle');
        if (folderNode && folderNode.folderType) {
            if (folderNode.syncing === false) {
                displayTitle += ` ${_m('syncSuffixLocal') || '(Local)'}`;
            } else if (folderNode.syncing === true) {
                displayTitle += ` ${_m('syncSuffixSynced') || '(Synced)'}`;
            }
        }

        // Add sync status indicator if enabled
        let syncIndicator = '';
        if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && window.syncManager && folderId) {
            const syncStatus = window.syncManager.getSyncStatusIndicator(folderId);
            const syncTooltip = window.syncManager.getSyncTooltip(folderId);
            if (syncStatus) {
                syncIndicator = `<span class="sync-indicator ${syncStatus}">
                    <span class="sync-tooltip">${syncTooltip}</span>
                </span>`;
            }
        }

        return `<span tabindex="0" ${extras} class="tree-item-span">
		   <b class="twisty">${CHEVRON_ICON}</b>
		   <div class="favicon-container">
		       ${FOLDER_ICON}
		       ${syncIndicator}
		   </div>
		   <i>${displayTitle}</i>
		   </span>`;
    };

    const generateSeparatorHTML = paddingStart => {
        // CSS-driven: separator-line uses absolute positioning with left:0 /
        // right:8px inside the relative a.separator-row — it stretches from
        // the icon left edge to the right margin automatically, using the
        // theme border token. No more inline color or manual width calc.
        const aStyle = `style="-webkit-padding-start: ${paddingStart}px"`;
        return `<a href="" tabindex="0" ${aStyle} class="tree-item-link separator-row">
                <hr class="separator-line" role="separator">
                </a>`;
    };

    const generateHTML = (data, level) => {
        if (!level)
            level = 0;
        const paddingStart = 16 * level;
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
            const title = htmlspecialchars(d.title);
            const url = d.url;
            const id = d.id;
            const parentID = d.parentId;
            const idHTML = id ? `id="neat-tree-item-${id}"` : '';
            const isFolder = d.dateGroupModified || children || typeof url === 'undefined';
            const stylePad = `style="-webkit-padding-start: ${paddingStart}px"`;
            const classStr = isFolder ? 'parent' : 'child';
            // syncing===false 的行打上标记：highlightUnsynced 开启时整棵本地
            // 子树淡显（body.highlight-unsynced 规则在 neat.css），替代旧版
            // 满树绿点的噪音式指示。
            const unsyncedCls = (d.syncing === false) ? ' unsynced-subtree' : '';
            const isOpen = getRememberState() && getOpens().includes(id);
            const open = isOpen ? 'open' : '';
            const ariaStr = isFolder ? `aria-expanded="${isOpen}"` : '';
            html += `<li class="${classStr}${unsyncedCls} ${open}" ${idHTML} level="${level}" role="treeitem" ${ariaStr} data-parentid="${parentID}">`;
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
                                document.getElementById(`neat-tree-item-${_id}`).appendChild(ul);
                                div.remove();
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

    return {
        getFaviconUrl,
        highlightTitlePositions,
        generateBookmarkHTML,
        generateFolderHTML,
        generateSeparatorHTML,
        generateHTML,
        generateNodeTrees,
        getParentPath,
        findFolderByType,
        getEffectiveSubTree,
        isRootFolder
    };
}
