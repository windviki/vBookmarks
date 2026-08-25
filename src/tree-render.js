import { FOLDER_ICON, DOCUMENT_CODE_ICON, CHEVRON_ICON, EDIT_ICON, TRASH_ICON, STAGE_ICON, STAGE_ICON_DONE } from './icons.js';
import { htmlspecialchars } from './escape.js';
import { stageBtnHtml as relayStageBtnHtml } from './staging-relay.js';

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
 * No neatools helpers: htmlspecialchars is the shared src/escape.js import
 * (see top), Array.contains → includes, inject → appendChild, destroy →
 * remove; the old colorHex helper is gone (separator color is theme CSS —
 * see generateSeparatorHTML).
 */

const httpsPattern = /^https?:\/\//i;

// v4 task-4 #2: per-level tree indent, shared by every place that computes a
// row's -webkit-padding-start (generateHTML here, actions.js add-node,
// dnd.js drop fixup). 24px is the exact step that lands a child row's icon
// left edge on its parent folder's TITLE left edge (icon starts after the
// 16px twisty slot; text starts after twisty+icon+gap = 40px — 24 = 40-16).
// Measured in the real popup by scripts/console/probe-alignment.js.
export const TREE_INDENT = 24;

// v4 task-2 (docs/plan-4.0.0/v4task-2.md §3.6): build the id → containing-folder path
// map every list view shares for its row path labels. For each node the map
// holds the titles of its ancestor folders (top-down, untitled folders
// skipped) joined by ' / ' — for a bookmark that reads as "where it lives",
// for a folder as "where it sits". Pure: no chrome/DOM access, so vitest
// exercises it directly.
export const buildPathMap = tree => {
    // H5: one traversal produces both the id → folder-path map and the set of
    // live bookmark ids (previously neat.js walked the tree a second time to
    // collect ids for visitStats.prune). Pure: no chrome/DOM access.
    const paths = {};
    const ids = new Set();
    const walk = (nodes, ancestors) => {
        if (!nodes)
            return;
        for (let i = 0, l = nodes.length; i < l; i++) {
            const node = nodes[i];
            // the invisible root has no parentId and contributes no title
            if (typeof node.parentId !== 'undefined') {
                paths[node.id] = ancestors.join(' / ');
                if (node.url)
                    ids.add(node.id);
            }
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
    return { paths, ids };
};

// v4 task-2 (docs/plan-4.0.0/v4task-2-list.md §3.3): relative-time buckets for the
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

// Bucket → localized label, shared by the recent/stats views and the
// search-history rows (one recipe, previously copied into three files).
// Falsy ts renders empty rather than a 1970 date. `_m` is injected so the
// helper stays pure (chrome.i18n.getMessage at the call sites).
export const relTimeLabel = (ts, _m) => {
    if (!ts)
        return '';
    const b = relativeTimeBucket(ts, Date.now());
    if (b.key === null)
        return new Date(ts).toLocaleDateString();
    return b.n ? _m(b.key, `${b.n}`) : _m(b.key);
};

// Escape a title and wrap the characters at the given (pre-escape) indices in
// <mark> tags. Built one character at a time so escaping never shifts the
// indices. Pure (only htmlspecialchars) so it is exported at top level for
// other renderers (palette.js) to reuse the same match highlight.
export const highlightTitlePositions = (title, positions) => {
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

export function initTreeRender(ctx = {}) {
    const store = ctx.store;
    const separatorManager = ctx.separatorManager;
    const getOpens = ctx.getOpens;
    const getRememberState = ctx.getRememberState;
    const _m = chrome.i18n.getMessage;

    // Tree-row hover quick actions [编辑][暂存][删除] (options 书签树 →
    // treeRowActions, default on). Bookmarks get all three; folders skip
    // the plane (a folder "stage" is the context menu's flatten-send). The
    // plane only renders while the staging feature itself is enabled
    // (stagingEnabled, the options 暂存和最近添加 master switch).
    const treeRowActionsOn = () => store.get('treeRowActions', '1') === '1';
    const stagingRelayOn = () => store.get('stagingEnabled', '1') === '1';
    // A folder's staged verdict: EVERY descendant bookmark staged (unknown
    // children — a collapsed lazy folder — read as unstaged). The click is
    // the menu's flatten-send (sendFolder merges one sourceFolderId group).
    const folderStagedUrls = folderNode => {
        const urls = [];
        const walk = n => {
            for (const c of (n && n.children) || []) {
                if (c.url) {
                    if (!separatorManager.isSeparator(c.title, c.url))
                        urls.push(c.url);
                } else {
                    walk(c);
                }
            }
        };
        walk(folderNode);
        return urls;
    };
    const folderStageBtnHtml = folderNode => {
        if (!ctx.staging || !ctx.staging.isStaged)
            return '';
        const urls = folderStagedUrls(folderNode);
        const staged = urls.length > 0 && urls.every(u => ctx.staging.isStaged(u));
        const label = htmlspecialchars(_m(staged ? 'stagingAlready' : 'stagingAdd'));
        return `<button type="button" class="row-btn staging-add-btn${staged ? ' staged' : ''}" ` +
            `aria-pressed="${staged}" aria-label="${label}" title="${label}">` +
            `${staged ? STAGE_ICON_DONE : STAGE_ICON}</button>`;
    };
    const treeRowTail = (url, isFolder, folderNode) => {
        if (!treeRowActionsOn())
            return '';
        const esc = htmlspecialchars;
        const editLabel = esc(_m(isFolder ? 'editFolder' : 'editBookmark'));
        const delLabel = esc(_m('rowActionDelete'));
        let html = `<button type="button" class="row-btn tree-row-btn tree-row-edit" ` +
            `aria-label="${editLabel}" title="${editLabel}">${EDIT_ICON}</button>`;
        if (stagingRelayOn())
            html += isFolder
                ? folderStageBtnHtml(folderNode)
                : (url ? relayStageBtnHtml(ctx.staging, { url }, _m) : '');
        html += `<button type="button" class="row-btn tree-row-btn tree-row-delete" ` +
            `aria-label="${delLabel}" title="${delLabel}">${TRASH_ICON}</button>`;
        return html;
    };

    const getFaviconUrl = (url) => {
        // H3: precomputed base + manual serialization — no per-row URL object.
        // Must stay byte-identical to URLSearchParams (guarded by the corpus
        // test): form serialization differs from encodeURIComponent in space
        // ('+' vs '%20') and in ! ' ( ) ~ (percent-encoded by the WHATWG
        // urlencoded set, left literal by encodeURIComponent) — both fixed
        // below.
        const base = chrome.runtime.getURL("/_favicon/");
        const pageUrl = encodeURIComponent(url)
            .replace(/%20/g, '+')
            .replace(/[!'()~]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        return `${base}?pageUrl=${pageUrl}&size=32`;
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
            : `<img src="${getFaviconUrl(url)}" width="16" height="16" alt="" loading="lazy">`;
        if (isBookmarklet && url.length > 140)
            tooltipURL = `${url.slice(0, 140)}...`;
        tooltipURL = htmlspecialchars(tooltipURL);
        // The untitled fallback shows the scheme-stripped URL — escape it
        // too (the tooltip below escapes the same expression): a URL with
        // < > " would otherwise land raw in the innerHTML (v4.0 leftover).
        const name = (title && titlePositions && titlePositions.length)
            ? highlightTitlePositions(title, titlePositions)
            : (htmlspecialchars(title) || (httpsPattern.test(url) ? htmlspecialchars(url.replace(httpsPattern, '')) : _m('noTitle')));

        // v4 task-2 §3.6: list views (search/recent/…) pass meta.path — the
        // bookmark's containing-folder path from buildPathMap. The tooltip
        // unifies to `标题 + URL + 路径` (absorbing the old async
        // parent-folder tooltip), and the row gains path labels when the
        // showItemPath setting is on: inline `.row-path` in the narrow popup,
        // a second muted line `.row-sub` at ≥480px / in panel mode (CSS
        // container query picks the form). Views with a custom meta slot
        // (recent: relative time on the right, `path · absolute time` as the
        // second line — docs/plan-4.0.0/v4task-2-list.md §3.3) override the two label
        // slots wholesale via meta.rightText / meta.subText; both slots are
        // escaped here, so callers compose them from raw text. A view badge
        // (dead/blocked status pill, docs/plan-4.0.0/v4task-2-list.md §3.5) comes via
        // meta.badge = { text, cls } and sits left of the right slot; slice D
        // adds meta.badge.aria for pills whose bare text isn't self-explanatory
        // (the stats ×N count pill gets "Visited N times").
        const path = (meta && meta.path) ? String(meta.path) : '';
        const tooltip = (path
            ? `${htmlspecialchars(title || (httpsPattern.test(url) ? url.replace(httpsPattern, '') : _m('noTitle')))}\n${tooltipURL}\n${htmlspecialchars(path)}`
            : tooltipURL) +
            // meta.tooltipAppend（可选，死链视图追加标记/检测时间）：追加在
            // tooltip 末行；其他视图不传 → 行为不变。escape 与其余 segment 一致。
            (meta && meta.tooltipAppend ? `\n${htmlspecialchars(meta.tooltipAppend)}` : '');
        const showPath = path && !!store.get('showItemPath', '1');
        const rightText = meta && typeof meta.rightText === 'string'
            ? meta.rightText : (showPath ? path : '');
        const subText = meta && typeof meta.subText === 'string'
            ? meta.subText : (showPath ? path : '');
        // meta.subRight（可选，死链视图宽/panel 第二行右侧的时间）：仅当其存在
        // 时第二行才改用"左子 + 右子"结构（左路径可截断、右时间推右对齐）；其他
        // 视图不传 → 保持纯文本 `.row-sub` 不变（tree-render.test.js 锁定结构）。
        const subRight = meta && typeof meta.subRight === 'string' ? meta.subRight : '';
        // 双子结构仅在 subRight 存在时启用：subText 单文本时保持老结构的纯文本
        // `.row-sub`（tree/search 等视图回归锁定）；有右侧时间槽时路径包进
        // `.row-sub-left` 可截断、时间在 `.row-sub-right` 右对齐。
        const subHtml = (subText || subRight)
            ? `<span class="row-sub" dir="auto">` +
              (subRight
                  ? (subText ? `<span class="row-sub-left">${htmlspecialchars(subText)}</span>` : '') +
                    `<span class="row-sub-right">${htmlspecialchars(subRight)}</span>`
                  : htmlspecialchars(subText)) +
              `</span>`
            : '';
        // A view badge via meta.badge = { text, cls } (object form, the
        // dead/dupes/stats convention) — or an ARRAY of them, when one row
        // needs two independent pills (the stats merge: ★ bookmarked marker
        // + the count/time sort key). Empty entries are skipped.
        const badgeList = meta && Array.isArray(meta.badge) ? meta.badge
            : (meta && meta.badge && meta.badge.text ? [meta.badge] : []);
        const badgeHtml = badgeList.filter(b => b && b.text).map(b =>
            `<span class="row-badge ${htmlspecialchars(b.cls || '')}"` +
            (b.aria ? ` aria-label="${htmlspecialchars(b.aria)}"` : '') +
            `>${htmlspecialchars(b.text)}</span>`).join('');
        // meta.badgeSlot（可选）：把 pill 包进固定宽度的外层槽 `.row-badge-slot`，
        // 让 pill 背景维持文本长度、而时间等 meta 在槽左边缘对齐。死链视图
        // 宽/panel 行传 true；其他视图不传 → 结构与老代码完全一致。
        const badge = meta && meta.badgeSlot && badgeHtml
            ? `<span class="row-badge-slot">${badgeHtml}</span>` : badgeHtml;
        const nameHtml = (rightText || subHtml || badge)
            ? `<span class="row-main"><i>${name}</i>${subHtml}</span>` + badge +
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

        return `<a href="${u}" title="${tooltip}" tabindex="-1" ${extras} class="tree-item-link">
                <div class="favicon-container">
                    ${faviconHtml}
                    ${syncIndicator}
                </div>
                ${nameHtml}${(meta && meta.tailHtml) || ''}
                </a>`;
    };

    const generateFolderHTML = (title, extras, folderId, folderNode) => {
        if (!extras)
            extras = '';

        // Handle dual storage folders - localized suffix marks which root a
        // folder belongs to (both roots are named alike by Chrome)
        // Escape the user-controlled title here (single responsibility): both
        // callers — generateHTML (main render) and actions.js add-node — pass
        // raw titles, matching generateBookmarkHTML's internal escaping.
        let displayTitle = title ? htmlspecialchars(title) : _m('noTitle');
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

        return `<span tabindex="-1" ${extras} class="tree-item-span">
		   <b class="twisty">${CHEVRON_ICON}</b>
		   <div class="favicon-container">
		       ${FOLDER_ICON}
		       ${syncIndicator}
		   </div>
		   <i>${displayTitle}</i>${treeRowTail('', true, folderNode)}
		   </span>`;
    };

    const generateSeparatorHTML = paddingStart => {
        // CSS-driven: the <a> is a flex row and the <hr> fills it (flex: 1),
        // stretching from the row's indented start edge to the right margin
        // using the theme border token. No inline color or manual width calc.
        const aStyle = `style="-webkit-padding-start: ${paddingStart}px"`;
        return `<a href="" tabindex="-1" ${aStyle} class="tree-item-link separator-row">
                <hr class="separator-line" role="separator">
                </a>`;
    };

    const generateHTML = (data, level) => {
        if (!level)
            level = 0;
        const paddingStart = TREE_INDENT * level;
        const group = (level === 0) ? 'tree' : 'group';
        // Phase 2b: an expanded folder with no children renders a muted
        // "(Empty)" row. It contains no focusable a/span element, so keyboard
        // navigation and the click handlers ignore it. This covers both child
        // loading paths (pre-rendered open folders and lazy expand), which
        // both funnel through generateHTML.
        // Item 6 alignment contract: the row has no twisty/icon slots of its
        // own, so the padding compensates with the full slot width (16px
        // twisty + 20px icon + 4px icon-text gap = 40px) to land the label
        // on the same text-left axis as sibling folder/bookmark titles.
        const SLOT_WIDTH = 40; // keep in sync with neat.css (16px twisty + 20px favicon-container + 4px gap)
        if (!data.length) {
            return `<ul role="${group}" data-level="${level}"><li class="empty-folder" style="-webkit-padding-start: ${paddingStart + SLOT_WIDTH}px"><i>${_m('folderEmpty')}</i></li></ul>`;
        }
        let html = `<ul role="${group}" data-level="${level}">`;

        for (let i = 0, l = data.length; i < l; i++) {
            const d = data[i];
            const children = d.children;
            // Raw title: generateFolderHTML/generateBookmarkHTML escape their
            // own titles (single responsibility — see generateFolderHTML).
            // isSeparator below also needs the RAW title, not an escaped one.
            const title = d.title;
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
                                // A folder deleted/synced away between the last
                                // getTree and this lazy expand fails getChildren
                                // with lastError — read it to suppress the
                                // warning; also the row may be gone from the DOM.
                                if (chrome.runtime.lastError)
                                    return;
                                const html = generateHTML(children || [], level + 1);
                                const div = document.createElement('div');
                                div.innerHTML = html;
                                const ul = div.querySelector('ul');
                                const row = document.getElementById(`neat-tree-item-${_id}`);
                                if (row)
                                    row.appendChild(ul);
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
                    // tree rows carry their hover quick-action tail (the
                    // shared generateBookmarkHTML appends meta.tailHtml
                    // inside the anchor — hover reveal + focus ride the
                    // anchor's own box, no ancestor-hover leakage).
                    html += generateBookmarkHTML(title, url, stylePad, id, null, { tailHtml: treeRowTail(url, false) });
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

    // P1-1 (4.1.0 收尾): single-snapshot walk — one traversal over the FULL
    // tree produces every derived map (paths for list rows, live bookmark
    // ids for visitStats.prune, the tree-view nodeTrees/bookmarkIds) plus the
    // rendered HTML. Replaces generateNodeTrees + addBookmarkParents +
    // buildPathMap (three walks, two of them full-tree) with one snapshot
    // walk + the subtree render, so a generateTree rebuild no longer pays
    // repeated O(n) traversals for the same data.
    //
    // `subTree` is the display root tree-view already selected (bookmarks-bar
    // filter / effective dual-storage subtree); it decides which nodes are
    // rendered rows (nodeTrees/bookmarkIds/html) while paths/ids still cover
    // the FULL tree (list-view path labels + visitStats.prune need the whole
    // tree). Optional: defaults to getEffectiveSubTree for direct callers.
    const buildTreeSnapshot = (tree, subTree) => {
        const paths = {};
        const ids = new Set();
        const nodeTrees = {};
        const bookmarkIds = new Set();
        // velvet staging §0.5: url → the FIRST tree node carrying it — the
        // staging anchors' relink index, built by the same single walk.
        const urlIndex = new Map();
        const list = tree || [];
        const display = subTree || getEffectiveSubTree(list);
        const displayIds = new Set();
        const collectDisplay = nodes => {
            if (!nodes)
                return;
            for (let i = 0, l = nodes.length; i < l; i++) {
                const node = nodes[i];
                if (!node)
                    continue;
                displayIds.add(node.id);
                if (node.children)
                    collectDisplay(node.children);
            }
        };
        collectDisplay(display);
        const walk = (nodes, ancestors) => {
            if (!nodes)
                return;
            for (let i = 0, l = nodes.length; i < l; i++) {
                const node = nodes[i];
                if (!node)
                    continue;
                if (typeof node.parentId !== 'undefined') {
                    paths[node.id] = ancestors.join(' / ');
                    if (node.url) {
                        ids.add(node.id);
                        if (!urlIndex.has(node.url))
                            urlIndex.set(node.url, node.id);
                    }
                }
                if (displayIds.has(node.id)) {
                    if (node.url) {
                        // addBookmarkParents contract: bookmark rows resolve
                        // their ancestor chain too (reveal-in-tree).
                        nodeTrees[node.id] = node.parentId;
                        bookmarkIds.add(`${node.id}`);
                    } else if (!isRootFolder(node)) {
                        // generateNodeTrees contract: non-root folders only.
                        nodeTrees[node.id] = node.parentId;
                    }
                }
                if (node.children) {
                    const title = (node.title || '').trim();
                    const next = (typeof node.parentId !== 'undefined' && title)
                        ? ancestors.concat(title)
                        : ancestors;
                    walk(node.children, next);
                }
            }
        };
        walk(list, []);
        const html = generateHTML(display);
        return { html, nodeTrees, bookmarkIds, paths, ids, urlIndex };
    };

    return {
        getFaviconUrl,
        highlightTitlePositions,
        generateBookmarkHTML,
        generateFolderHTML,
        generateSeparatorHTML,
        generateHTML,
        generateNodeTrees,
        buildTreeSnapshot,
        getParentPath,
        findFolderByType,
        getEffectiveSubTree,
        isRootFolder
    };
}
