import { FOLDER_ICON, DOCUMENT_CODE_ICON, CHEVRON_ICON, spriteIcon, ICON_SPRITE_SHEET } from './icons.js';
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

// —— 行尾图标精灵（2026-08-27 真实数据 perf 轮）——
// 树行尾的编辑/暂存/删除按钮改用 icons.js 的 <symbol> 精灵表：每行省
// ~800B 的内联 SVG，5000+ 行真实树的冷开 innerHTML 解析因此显著下降。
// STAGE_SPRITE 传给 staging-relay 的 stageBtnHtml；表在首次树渲染前幂等
// 注入 document（<use> 活解析，测试替身没有 insertAdjacentHTML 时静默跳过）。
const STAGE_SPRITE = { off: spriteIcon('stage'), done: spriteIcon('stage-done') };
let spriteSheetInstalled = false;
const ensureIconSheet = () => {
    if (spriteSheetInstalled)
        return;
    try {
        if (typeof document !== 'undefined' && document.body &&
            typeof document.body.insertAdjacentHTML === 'function' &&
            !document.getElementById('vbm-icon-sheet')) {
            document.body.insertAdjacentHTML('afterbegin', ICON_SPRITE_SHEET);
            spriteSheetInstalled = true;
        }
    } catch (_) { /* 下一轮渲染重试 */ }
};

// v4 task-4 #2: per-level tree indent, shared by every place that computes a
// row's -webkit-padding-start (generateHTML here, actions.js add-node,
// dnd.js drop fixup). 24px is the exact step that lands a child row's icon
// left edge on its parent folder's TITLE left edge (icon starts after the
// 16px twisty slot; text starts after twisty+icon+gap = 40px — 24 = 40-16).
// Measured in the real popup by scripts/console/probe-alignment.js.
export const TREE_INDENT = 24;

// v4 task-2 (docs/plan-4.0.0/v4task-2.md §3.6): build the id → containing-folder path
// map every list view shares for its row path labels. For each node the map
// holds the titles of its ancestor folders (untitled folders skipped), joined
// root-first by ' / ' — the CANONICAL form used by tooltips (and by row meta
// lines unless the reverseItemPath option flips them).
// Issue #64: `formatPathLabel` is the meta-LINE form — NEAREST parent first
// ("Frontend < Dev"), capped at PATH_DEPTH ancestors with a trailing '…' —
// the row-label map (`pathLabels`) carries it; the option decides which form
// a label shows (default: not reversed). Pure: no chrome/DOM access, so
// vitest exercises both directly.
export const PATH_DEPTH = 3;
export const formatPath = ancestors => ancestors.join(' / ');
export const formatPathLabel = ancestors => {
    const near = ancestors.slice(-PATH_DEPTH).reverse().join(' < ');
    return ancestors.length > PATH_DEPTH ? `${near} < …` : near;
};
// The unified row tooltip (issues #62/#64): FULL info on hover in EVERY view,
// one line per fact, extensible — future metadata appends labeled lines at
// the end (before `append`). Native title tooltips are plain text:
//   <标题>
//   <url>
//   Path: Bookmarks Bar / Dev        (canonical root-first, when known)
//   Added: 2026/8/29 13:40           (toLocaleString, when known)
//   <append>                         (view extras, e.g. dead-link marks)
// Segments are escaped here — callers pass RAW values. Pure apart from the
// i18n label lookup (resolved at call time so tests can stub chrome.i18n).
const tooltipLabel = key => {
    try {
        if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage)
            return chrome.i18n.getMessage(key) || '';
    } catch (e) { /* no i18n host — English fallback below */ }
    return '';
};
export const buildRowTooltip = parts => {
    const lines = [];
    if (parts.title)
        lines.push(htmlspecialchars(parts.title));
    if (parts.url)
        lines.push(htmlspecialchars(parts.url));
    if (parts.path)
        lines.push(`${tooltipLabel('tooltipPath') || 'Path'}: ${htmlspecialchars(parts.path)}`);
    if (parts.dateAdded)
        lines.push(`${tooltipLabel('tooltipAdded') || 'Added'}: ${new Date(parts.dateAdded).toLocaleString()}`);
    if (parts.append)
        lines.push(htmlspecialchars(parts.append));
    return lines.join('\n');
};
export const buildPathMap = tree => {
    // H5: one traversal produces both the id → folder-path map and the set of
    // live bookmark ids (previously neat.js walked the tree a second time to
    // collect ids for visitStats.prune). Pure: no chrome/DOM access.
    const paths = {};
    const pathLabels = {};
    // id → the node's dateAdded (bookmarks AND folders) — the Added tooltip
    // line's data source for views whose own model lacks it (staging items,
    // visit-stats rows).
    const dates = {};
    const ids = new Set();
    const walk = (nodes, ancestors) => {
        if (!nodes)
            return;
        for (let i = 0, l = nodes.length; i < l; i++) {
            const node = nodes[i];
            // the invisible root has no parentId and contributes no title
            if (typeof node.parentId !== 'undefined') {
                paths[node.id] = formatPath(ancestors);
                pathLabels[node.id] = formatPathLabel(ancestors);
                dates[node.id] = node.dateAdded || 0;
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
    return { paths, pathLabels, dates, ids };
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

    // Per-render-pass snapshot state (2026-08 perf audit). Two row-level
    // costs used to scale with the whole tree per pass: nodeHtml re-read
    // getOpens().includes(id) per folder row (Array.includes → O(folders ×
    // opens)), and folderStageBtnHtml re-walked each folder's subtree (see
    // folderStagedInfo). A pass now converts opens to a Set ONCE (lazily —
    // rememberState off never touches getOpens, same short-circuit as the
    // old expression) and shares one folder-verdict memo. The wrapper
    // resets when the outermost synchronous pass ends, so the async
    // lazy-expand getChildren callback reads fresh state exactly as before;
    // a nested call (the recursive child render, a synchronous getChildren
    // double) reuses the outer pass.
    let renderPass = null; // { opens: Set|null, staged: Map } | null
    const withRenderPass = fn => {
        if (renderPass)
            return fn();
        renderPass = { opens: null, staged: new Map() };
        try {
            return fn();
        } finally {
            renderPass = null;
        }
    };
    const opensHas = id => {
        if (!renderPass)
            return getOpens().includes(id);
        if (!renderPass.opens)
            renderPass.opens = new Set(getOpens());
        return renderPass.opens.has(id);
    };

    // Tree-row hover quick actions [编辑][暂存][删除] (options 书签树 →
    // treeRowActions, default on). Bookmarks get all three; folders skip
    // the plane (a folder "stage" is the context menu's flatten-send). The
    // plane only renders while the staging feature itself is enabled
    // (stagingEnabled, the options 暂存和最近添加 master switch) AND the
    // staging view is not disabled (showRecentBookmarks — the 2026-08-26
    // report round: a disabled view stands down every cross-view entry).
    const treeRowActionsOn = () => store.get('treeRowActions', '1') === '1';
    const stagingRelayOn = () => store.get('stagingEnabled', '1') === '1'
        && !!store.get('showRecentBookmarks', '1')
        && store.get('disableRecentView', '') !== '1';
    // A folder's staged verdict: EVERY descendant bookmark staged (unknown
    // children — a collapsed lazy folder — read as unstaged). The click is
    // the menu's flatten-send (sendFolder merges one sourceFolderId group).
    // 2026-08 perf audit: the verdict used to re-walk the folder's ENTIRE
    // subtree per row (O(n·depth) per full-tree render — and each isStaged
    // is itself a linear scan of the staging items). It is now bottom-up
    // with a per-render-pass memo (renderPass above): a folder's verdict =
    // its own rows' and child folders' verdicts combined, so one pass
    // visits every node once. Outside a pass (single-row renders like
    // actions.js add-node) a throwaway map keeps the same result.
    const folderStagedInfo = (folderNode, memo) => {
        const hit = memo.get(folderNode);
        if (hit)
            return hit;
        let count = 0;
        let allStaged = true;
        for (const c of (folderNode && folderNode.children) || []) {
            if (c.url) {
                if (!separatorManager.isSeparator(c.title, c.url)) {
                    count++;
                    if (allStaged && !ctx.staging.isStaged(c.url))
                        allStaged = false;
                }
            } else {
                const sub = folderStagedInfo(c, memo);
                count += sub.count;
                if (allStaged && !sub.allStaged)
                    allStaged = false;
            }
        }
        const info = { count, allStaged };
        memo.set(folderNode, info);
        return info;
    };
    const folderStageBtnHtml = folderNode => {
        if (!ctx.staging || !ctx.staging.isStaged)
            return '';
        const info = folderStagedInfo(folderNode, renderPass ? renderPass.staged : new Map());
        const staged = info.count > 0 && info.allStaged;
        const label = htmlspecialchars(_m(staged ? 'stagingAlready' : 'stagingAdd'));
        return `<button type="button" class="row-btn staging-add-btn${staged ? ' staged' : ''}" ` +
            `aria-pressed="${staged}" aria-label="${label}" title="${label}">` +
            `${staged ? STAGE_SPRITE.done : STAGE_SPRITE.off}</button>`;
    };
    const treeRowTail = (url, isFolder, folderNode) => {
        if (!treeRowActionsOn())
            return '';
        const esc = htmlspecialchars;
        const editLabel = esc(_m(isFolder ? 'editFolder' : 'editBookmark'));
        const delLabel = esc(_m('rowActionDelete'));
        let html = `<button type="button" class="row-btn tree-row-btn tree-row-edit" ` +
            `aria-label="${editLabel}" title="${editLabel}">${spriteIcon('edit')}</button>`;
        if (stagingRelayOn())
            html += isFolder
                ? folderStageBtnHtml(folderNode)
                : (url ? relayStageBtnHtml(ctx.staging, { url }, _m, STAGE_SPRITE) : '');
        html += `<button type="button" class="row-btn tree-row-btn tree-row-delete" ` +
            `aria-label="${delLabel}" title="${delLabel}">${spriteIcon('trash')}</button>`;
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
        // tooltipURL stays RAW — buildRowTooltip escapes every segment it
        // takes (double-escaping would corrupt & < > " in the tooltip).
        // The untitled fallback shows the scheme-stripped URL — escape it
        // too (the tooltip below escapes the same expression): a URL with
        // < > " would otherwise land raw in the innerHTML (v4.0 leftover).
        const name = (title && titlePositions && titlePositions.length)
            ? highlightTitlePositions(title, titlePositions)
            : (htmlspecialchars(title) || (httpsPattern.test(url) ? htmlspecialchars(url.replace(httpsPattern, '')) : _m('noTitle')));

        // v4 task-2 §3.6: list views (search/recent/…) pass meta.path — the
        // bookmark's containing-folder path from buildPathMap. The tooltip
        // (issues #62/#64) is the unified FULL-INFO block via buildRowTooltip
        // (title + URL + path + dateAdded, extensible) in EVERY view — the
        // tree passes the same fields since 4.1.1. The row gains path labels
        // when the showItemPath setting is on: inline `.row-path` in the
        // narrow popup, a second muted line `.row-sub` at ≥480px / in panel
        // mode (CSS container query picks the form). Labels render
        // meta.pathLabel when a view passes it (view-manager's
        // reverseItemPath handling — nearest-first form), else the canonical
        // meta.path. Views with a custom meta slot (recent: relative time on
        // the right, `path · absolute time` as the second line —
        // docs/plan-4.0.0/v4task-2-list.md §3.3) override the two label slots
        // wholesale via meta.rightText / meta.subText; both slots are escaped
        // here, so callers compose them from raw text. A view badge
        // (dead/blocked status pill, docs/plan-4.0.0/v4task-2-list.md §3.5) comes via
        // meta.badge = { text, cls } and sits left of the right slot; slice D
        // adds meta.badge.aria for pills whose bare text isn't self-explanatory
        // (the stats ×N count pill gets "Visited N times").
        const path = (meta && meta.path) ? String(meta.path) : '';
        const tooltip = buildRowTooltip({
            title: title || (httpsPattern.test(url) ? url.replace(httpsPattern, '') : _m('noTitle')),
            url: tooltipURL,
            path,
            dateAdded: meta && meta.dateAdded,
            // meta.tooltipAppend（可选，死链视图追加标记/检测时间）：追加在
            // tooltip 末行；其他视图不传 → 行为不变（builder 内统一 escape）。
            append: meta && meta.tooltipAppend
        });
        // meta.tooltipOnlyPath（树行/标签组 tab 行）:路径只进 tooltip——树本身
        // 就是层级、tab 行是紧凑单行,都不渲染 meta 行标签(showItemPath 对它们
        // 无效;2026-08-29 回归修复:树行曾因带 path 被当成列表行渲染出第二行)。
        const labelPath = (meta && meta.tooltipOnlyPath) ? ''
            : ((meta && meta.pathLabel) ? String(meta.pathLabel) : path);
        const showPath = labelPath && !!store.get('showItemPath', '1');
        const rightText = meta && typeof meta.rightText === 'string'
            ? meta.rightText : (showPath ? labelPath : '');
        const subText = meta && typeof meta.subText === 'string'
            ? meta.subText : (showPath ? labelPath : '');
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

    const generateFolderHTML = (title, extras, folderId, folderNode, path) => {
        if (!extras)
            extras = '';

        // Handle dual storage folders - localized suffix marks which
        // root a folder belongs to (both roots are named alike by Chrome)
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

        // Issues #62/#64: folders carry the full-info tooltip too — title +
        // containing path + dateAdded (no URL line: folders have none). The
        // 5th `path` param is the canonical ancestor path (the snapshot's
        // full-tree map); callers without one (actions.js add-node) simply
        // render without the path line.
        const folderTooltip = buildRowTooltip({
            title: title || _m('noTitle'),
            path,
            dateAdded: folderNode && folderNode.dateAdded
        });
        return `<span tabindex="-1" ${extras} class="tree-item-span" title="${folderTooltip}">
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

    const generateHTML = (data, level, pathsMap) => {
        ensureIconSheet();
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
        withRenderPass(() => {
            for (let i = 0, l = data.length; i < l; i++)
                html += nodeHtml(data[i], level, paddingStart, pathsMap);
        });
        html += '</ul>';
        return html;
    };

    // One node's full <li> (folder row + its rendered subtree, bookmark row
    // or separator) — the piece generateHTML concatenates and the CHUNKED
    // tree paint (2026-08-28 perf 任务④) streams per top-level node. The
    // lazy-expand branch appends unloaded children asynchronously exactly as
    // before (same code, just factored out — generateHTML's tests cover it).
    // pathsMap (optional): the snapshot's FULL-tree canonical path map — rows
    // resolve their tooltip path O(1) instead of re-walking ancestors (nil
    // for the legacy generateHTML entry points: no path line in the tooltip).
    const nodeHtml = (d, level, paddingStart, pathsMap) => {
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
        const isOpen = getRememberState() && opensHas(id);
        const open = isOpen ? 'open' : '';
        const ariaStr = isFolder ? `aria-expanded="${isOpen}"` : '';
        let html = `<li class="${classStr}${unsyncedCls} ${open}" ${idHTML} level="${level}" role="treeitem" ${ariaStr} data-parentid="${parentID}">`;
        if (isFolder) { // folder node
            html += generateFolderHTML(title, stylePad, id, d, pathsMap ? (pathsMap[id] || '') : '');
            // only generate children for opened folder
            if (isOpen) {
                if (children) {
                    html += generateHTML(children, level + 1, pathsMap);
                } else {
                    (_id => {
                        chrome.bookmarks.getChildren(_id, children => {
                            // A folder deleted/synced away between the last
                            // getTree and this lazy expand fails getChildren
                            // with lastError — read it to suppress the
                            // warning; also the row may have gone from the DOM.
                            if (chrome.runtime.lastError)
                                return;
                            const html = generateHTML(children || [], level + 1, pathsMap);
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
                html += generateBookmarkHTML(title, url, stylePad, id, null, {
                    tailHtml: treeRowTail(url, false),
                    // issues #62/#64: tree rows carry the full-info tooltip
                    // (title + URL + path + dateAdded) like every list view —
                    // but TOOLTIP-ONLY: the tree IS the hierarchy, its rows
                    // never grow path labels / a second line
                    tooltipOnlyPath: true,
                    path: pathsMap ? (pathsMap[id] || '') : '',
                    dateAdded: d.dateAdded
                });
            }
        }
        return html + '</li>';
    };

    // Top-level pieces for the chunked tree paint (perf 任务④): one string
    // per top-level node; generateHTML(level 0) === wrapper + blocks joined.
    const generateTreeBlocks = (data, pathsMap) => {
        ensureIconSheet();
        const blocks = [];
        withRenderPass(() => {
            for (let i = 0, l = data.length; i < l; i++)
                blocks.push(nodeHtml(data[i], 0, 0, pathsMap));
        });
        return blocks;
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
        const pathLabels = {};
        const dates = {};
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
                    paths[node.id] = formatPath(ancestors);
                    pathLabels[node.id] = formatPathLabel(ancestors);
                    dates[node.id] = node.dateAdded || 0;
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
        // 2026-08-28 perf 任务④: top-level BLOCKS come out of the same render
        // (html = wrapper + blocks.join) so the chunked painter and the
        // one-shot swap share one code path — no duplicated walk. The EMPTY
        // display keeps generateHTML's own "(Empty)" row branch.
        const blocks = display && display.length ? generateTreeBlocks(display, paths) : null;
        const html = blocks
            ? `<ul role="tree" data-level="0">${blocks.join('')}</ul>`
            : generateHTML(display);
        return { html, blocks, nodeTrees, bookmarkIds, paths, pathLabels, dates, ids, urlIndex };
    };

    return {
        getFaviconUrl,
        highlightTitlePositions,
        generateBookmarkHTML,
        generateFolderHTML,
        generateSeparatorHTML,
        generateHTML,
        generateTreeBlocks,
        generateNodeTrees,
        buildTreeSnapshot,
        getParentPath,
        findFolderByType,
        getEffectiveSubTree,
        isRootFolder
    };
}
