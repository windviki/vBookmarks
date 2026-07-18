import { FOLDER_ICON, DOCUMENT_CODE_ICON } from './icons.js';

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

// RGB -> HEX, formerly String.prototype.colorHex in neat.js (byte-identical
// semantics, quirks included): rgb(a)? strings become #hex with per-component
// "0" → "00" padding only; a result that is not exactly 7 chars falls back to
// the input unchanged. 6-digit #hex passes through, 3-digit #hex is doubled,
// anything else returns ''.
const hexColorRegex = /^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/;
const colorHex = (that) => {
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

// neat.js keeps its own copy for the actions ctx; generateBookmarkHTML uses
// this module-local one.
const httpsPattern = /^https?:\/\//i;

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

    const generateBookmarkHTML = (title, url, extras, bookmarkId, titlePositions) => {
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
                    ${faviconHtml}
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
		       ${FOLDER_ICON}
		       ${syncIndicator}
		   </div>
		   <i>${displayTitle}</i>
		   </span>`;
    };

    const generateSeparatorHTML = paddingStart => {
        let color = '#888888';
        if (store.get('separatorcolor')) {
            color = colorHex(store.get('separatorcolor'));
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
            const title = htmlspecialchars(d.title);
            const url = d.url;
            const id = d.id;
            const parentID = d.parentId;
            const idHTML = id ? `id="neat-tree-item-${id}"` : '';
            const isFolder = d.dateGroupModified || children || typeof url === 'undefined';
            const stylePad = `style="-webkit-padding-start: ${paddingStart}px"`;
            const classStr = isFolder ? 'parent' : 'child';
            const isOpen = getRememberState() && getOpens().includes(id);
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
