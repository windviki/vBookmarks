/**
 * Visit-statistics + recent-history view (v4 task-2, slice D —
 * docs/plan-4.0.0/v4task-2.md §5.4, docs/plan-4.0.0/v4task-2-list.md §3.4; upgraded by 第四轮项9
 * into a "history + statistics" hybrid meant to replace Chrome's native
 * history page).
 *
 * One merged list lives in ONE flat <ul>, so the shared list keyboard
 * contract (keyboard.js ArrowUp/Down li walking, Home/End, Enter) crosses
 * row kinds with zero view-specific keys (batch-deletion slice). The
 * bookmark-stats rows lead (the toolbar sort segment controls them, so
 * the controlled list sits directly under the control) and the unbookmarked
 * recent-history rows join them in the same list while the
 * statsShowUnbookmarked toolbar checkbox is on:
 *
 *   - 已收藏统计行 — the slice-D per-bookmark counters: one row per
 *     bookmark with at least one recorded open, sorted by count (default)
 *     or recency (`statsSort` persists the choice). The bookmarked state
 *     shows as a ★ inline SVG at the line end (.stats-star — not a badge;
 *     the badge slot always renders [relative time, count pill]), and the
 *     parent path rides the rightText slot and the wide second line.
 *     Clicking opens through the shared
 *     bookmarkHandler, which is also the collection point (neat.js
 *     onOpenBookmark). Bookmarked history rows whose id the stats dataset
 *     lacks (visited but never opened through the popup) also land here,
 *     counted at history's visitCount — they are still visited bookmarks.
 *   - 未收藏历史行 — the latest chrome.history entries NOT in the bookmark
 *     tree, most recent first, URL-deduped, capped at HISTORY_RECENT_MAX.
 *     They carry no row id (no data-node-id — the open still goes through
 *     the shared bookmarkHandler via the anchor href, and the visitStats.
 *     record hook no-ops on the resulting empty id) and get a hover-revealed
 *     ☆ row button (the .row-btn pattern of the dead/dupes views) for
 *     one-click bookmarking. Their count dimension is history's own
 *     visitCount, so under count order they interleave by real visit volume
 *     (0 when the entry carries none → they sort to the bottom). Right-click
 *     on an unbookmarked row opens its own slim menu (open in new tab /
 *     window / incognito + bookmark-it) built by context-menu.js
 *     (v4 task-3 #10): the body-level bookmark menu would otherwise act on a
 *     bogus id — the same hazard round-4 item 7 fixed for search-history
 *     rows. Only the permission guide row is still swallowed at the list
 *     level (preventDefault + stopPropagation).
 *
 * The unbookmarked toggle persists as `statsShowUnbookmarked` (default on —
 * the recent history's unbookmarked rows are the merge's whole point); off,
 * only the bookmarked rows render. Empty/guide rules keep arrow walking
 * from stranding on non-focusable rows: a missing `history` permission
 * collapses the recent data to a single trailing guide row, and with no
 * rows at all the statsEmpty row stands alone as the list's FIRST <li>.
 *
 * Permission guide (a more compact take on view-recent's banner): while
 * stats is enabled but the optional `history` permission is missing, the
 * recent section is a single guide row — one sentence plus an Enable link
 * that runs chrome.permissions.request (a real user gesture); a grant
 * fetches immediately. The link is the row's firstElementChild (same
 * Enter contract as above) and there is no dismiss button — the row
 * simply stays until granted. `statsEnabled` off keeps the old master-
 * gate semantics unchanged: the whole view shows statsDisabledHint and no
 * probe/fetch happens at all.
 *
 * Star-add landing (issue #30 parity): chrome.bookmarks.create under
 * `quickAddFolderId` (default '1' = bookmarks bar — the same target the
 * popup star button uses). On success the row flips to its bookmarked
 * form (button gone, ★ badge + data-node-id), ctx.onChanged() invalidates
 * the already-rendered tree (neat.js injects the standard
 * getTree → treeView.generateTree chain, so the target folder repaints),
 * and undo.showToast confirms with the reused quickAddedTo wording.
 *
 * Data lifecycle: history is probed/fetched ONLY on activate (and right
 * after a grant) — never on timers; bookmark-side changes re-resolve the
 * cached items' bookmarked status inside the regular refresh() getTree
 * pass. The tab badge keeps its slice-D semantics: bookmark-stats row
 * count only (history rows are transient browse data).
 *
 * Refresh of the stats dataset: rendering on activation plus after a
 * clear is enough (the dataset only changes through this popup's own
 * opens); bookmark removals additionally prune the dataset via the
 * tree-rebuild hook in neat.js, and a debounced onRemoved refresh keeps a
 * lingering row from outliving its bookmark.
 *
 * initViewStats(ctx) is called once by neat.js after initViewRecent.
 * ctx.store            — settings mirror (statsSort/statsEnabled/showItemPath/showStatsView/quickAddFolderId)
 * ctx.views            — view-manager API (register/isActive/pathOf/showItemPath/updateBadges)
 * ctx.treeRender       — tree-render.js API (generateBookmarkHTML)
 * ctx.separatorManager — isSeparator filtering
 * ctx.treeView         — bookmarkHandler (click/auxclick open)
 * ctx.dialogs          — ConfirmDialog for the clear-statistics gate
 * ctx.visitStats       — initVisitStats API (all/clear/enabled)
 * ctx.undo             — showToast for the star-add confirmation (optional)
 * ctx.onChanged        — tree invalidation after a star-add (optional)
 *
 * chrome.bookmarks.getTree/onRemoved/create/get, chrome.permissions
 * .contains/request, chrome.history.search, chrome.i18n.getMessage,
 * document and setTimeout remain page globals.
 */

import { relTimeLabel } from './tree-render.js';
import { VIEW_ICONS, STAR_ICON, STAGE_ICON, SELECT_ICON, OPEN_ICON, TABS_ICON, TRASH_ICON, spriteIcon } from './icons.js';

    // 2026-08-28 行级图标精灵化（perf 任务①）：行乘数大的按钮用文档级 symbol。
    const IC = {
        stage: spriteIcon('stage'),
        stageDone: spriteIcon('stage-done'),
        starFilled: spriteIcon('star-filled')
    };
import { fitToolbarLabels, watchToolbarFit } from './toolbar-fit.js';
import { htmlspecialchars } from './escape.js';
import { parkRowFocus, unparkRowFocus, parkToolbarFocus, restoreToolbarFocus } from './list-focus.js';
import { paintListChunked } from './list-chunks.js';

export function initViewStats(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const views = ctx.views;
    const treeRender = ctx.treeRender;
    const separatorManager = ctx.separatorManager;
    const treeView = ctx.treeView;
    const dialogs = ctx.dialogs;
    const visitStats = ctx.visitStats;
    // History-section collaborators (optional so minimal test setups keep
    // working; neat.js always injects them).
    const undo = ctx.undo || { showToast: () => {} };
    const onChanged = ctx.onChanged || (() => {});
    // 第五轮项3: after every render, neat.js re-lays the dead-mark ×
    // overlays (the innerHTML swap just wiped them).
    const onRowsRendered = ctx.onRowsRendered || (() => {});

    const $list = $('stats-list');

    const enabled = () => visitStats.enabled();
    const sort = () => store.get('statsSort', 'count') === 'recent' ? 'recent' : 'count';

    // Bucket → label recipe imported from tree-render.js (docs/plan-4.0.0/v4task-2-list.md §3.3).

    // History normalizes bare hosts to a trailing slash while bookmarks keep
    // whatever was saved; matching on the slash-folded key pairs those up
    // (same recipe as view-recent's import matcher, which keeps it private).
    const matchUrl = u =>
        (u.length > 1 && u.endsWith('/') && !u.endsWith('//')) ? u.slice(0, -1) : u;

    // chrome.bookmarks.create rejects chrome:// & friends — the ☆ button is
    // only offered on rows the create can actually land.
    const bookmarkableUrl = u => /^(https?|ftp|file):/i.test(u);

    // 性能上限：最近 200 个不同 URL（history.search 按 lastVisitTime 降序）。
    const HISTORY_RECENT_MAX = 200;

    let dirty = false;
    let rows = [];          // [{ item, stat }] bookmark-stats rows in display order
    let historyPerm = null; // null = probe pending/unsupported
    let histItems = null;   // deduped raw history items (null = not fetched)
    let histRows = [];      // [{ title, url, t, bookmarkId|null }] in display order
    let lastTree = null;    // latest getTree snapshot (bookmarked-status resolve)

    // Bookmark rows of the whole tree (separators excluded) — the stats
    // dataset is keyed by bookmark id, titles/urls come from the live tree.
    const flattenTree = tree => {
        const items = [];
        const walk = nodes => {
            for (let i = 0, l = nodes.length; i < l; i++) {
                const node = nodes[i];
                if (node.children) {
                    walk(node.children);
                } else if (node.url && !separatorManager.isSeparator(node.title, node.url)) {
                    items.push({
                        id: node.id,
                        title: node.title || '',
                        url: node.url,
                        parentId: node.parentId
                    });
                }
            }
        };
        walk(tree || []);
        return items;
    };

    // id → { title, url, parentId } of the LIVE tree (built each refresh).
    // The count-from-history rows (visited + bookmarked but never opened
    // through the popup) resolve their title and parent from here instead of
    // trusting history's snapshot — a renamed bookmark renders its current
    // title, and the row carries the real data-parentid.
    let treeItems = new Map();

    const collectRows = items => {
        const stats = visitStats.all();
        const out = [];
        for (let i = 0, l = items.length; i < l; i++) {
            const stat = stats[items[i].id];
            if (stat && stat.c > 0)
                out.push({ item: items[i], stat });
        }
        const byCount = sort() === 'count';
        // Tie-break on the other key so both orders feel intentional.
        out.sort((a, b) => byCount
            ? (b.stat.c - a.stat.c) || (b.stat.t - a.stat.t)
            : (b.stat.t - a.stat.t) || (b.stat.c - a.stat.c));
        return out;
    };

    // Re-derive the history rows' bookmarked status from the cached items
    // and the newest tree — runs on every refresh() so a bookmark added or
    // removed elsewhere flips the row on the next pass. Duplicate bookmarks
    // share a URL; the first copy stands as the row's bookmark identity.
    const resolveHistRows = tree => {
        histRows = [];
        if (!histItems || !tree)
            return;
        const urlToIds = new Map();
        const walk = nodes => {
            for (let i = 0, l = nodes.length; i < l; i++) {
                const node = nodes[i];
                if (node.children)
                    walk(node.children);
                else if (node.url) {
                    const key = matchUrl(node.url);
                    if (!urlToIds.has(key))
                        urlToIds.set(key, node.id);
                }
            }
        };
        walk(tree);
        for (let i = 0, l = histItems.length; i < l; i++) {
            const h = histItems[i];
            histRows.push({
                title: h.title || '',
                url: h.url,
                t: h.lastVisitTime || 0,
                // history.search aggregates visitCount per URL — the unbookmarked
                // rows' count dimension for the merged list's sort.
                visitCount: h.visitCount || 0,
                bookmarkId: urlToIds.get(matchUrl(h.url)) || null
            });
        }
    };

    // Merged-list toggle (batch-deletion slice): whether the unbookmarked
    // history rows join the bookmark-stats list. Persisted so the choice
    // survives a popup reopen; default ON (the recent history's unbookmarked
    // rows are the section's whole point).
    const showUnbookmarked = () => store.get('statsShowUnbookmarked', '1') === '1';

    // --- Selection mode (velvet staging §3.7) -------------------------------
    // The bulk-collection gesture the stats view was missing: bookmarked
    // rows AND unbookmarked history rows select alike (unit = url — the two
    // row kinds' unified key), actions degrade to what applies.
    let selecting = false;
    const selected = new Set(); // urls
    let pendingRowFocus = null;
    let selectionFocus = null;
    let displayRows = [];
    let paintHandle = null;       // the in-flight chunked paint (cancelled on re-render)
    let urlPieceIdx = new Map();  // focus-retry gate: url → piece index

    const selectedRows = () => displayRows.filter(r => selected.has(r.url));

    const setSelecting = (on, focus = null) => {
        selecting = on;
        if (!on)
            selected.clear();
        if (focus)
            selectionFocus = focus;
        render();
    };

    const renderToolbar = () => {
        const s = sort();
        if (selecting) {
            // The staging-view law: TWO rungs — rung 1 = count + set ops +
            // exit, rung 2 = the ICONIFIED actions ([发送到暂存][打开][打开为
            // 标签组][删除], labels revealed progressively from the right via
            // the shared toolbar fitter).
            let html = '<div class="stats-toolbar stats-select-toolbar selecting-bar vbm-toolbar">';
            html += `<span class="select-count">${_m('selectCount', `${selected.size}`)}</span>` +
                `<button class="stats-select-all">${_m('selectAll')}</button>` +
                `<button class="stats-select-invert">${_m('selectInvert')}</button>` +
                `<button class="stats-select-clear">${_m('selectClear')}</button>` +
                `<button class="stats-select-exit">${_m('selectModeExit')}</button>`;
            html += '</div>';
            const hasSel = selected.size ? '' : ' disabled';
            const barStageOn = !ctx.stagingApi || !ctx.stagingApi.isEnabled || ctx.stagingApi.isEnabled();
            const iconBtn = (cls, key, icon) => {
                const lab = htmlspecialchars(_m(key));
                return `<button class="stats-icon-btn vbm-fit-btn ${cls}"${hasSel} aria-label="${lab}" title="${lab}">` +
                    `${icon}<span class="stats-btn-label vbm-fit-label">${lab}</span></button>`;
            };
            html += '<div class="stats-toolbar stats-actions-toolbar vbm-toolbar">' +
                (barStageOn ? iconBtn('stats-stage', 'stagingAdd', STAGE_ICON) : '') +
                iconBtn('stats-open', 'open', OPEN_ICON) +
                iconBtn('stats-open-group', 'openBookmarksInGroup', TABS_ICON) +
                iconBtn('stats-delete', 'deleteSelected', TRASH_ICON) +
                '</div>';
            return html;
        }
        if (!enabled())
            return '';
        // vbm-toolbar: keyboard.js's Tab cycle picks the controls up as
        // stops between the tab strip and the list rows (final polish).
        let html = '<div class="stats-toolbar vbm-toolbar">';
        // v4 task-4 #1: the pressed state rides aria-pressed ONLY — a class
        // named 'active' collides with context-menu.js's menu-open row marker
        // (clearMenu strips body-wide .active on every click/focus, which ate
        // the highlight right after the re-render).
        html += '<span class="seg" role="group">' +
            `<button class="seg-btn" data-sort="count" ` +
            `aria-pressed="${s === 'count'}">${_m('statsSortByCount')}</button>` +
            `<button class="seg-btn" data-sort="recent" ` +
            `aria-pressed="${s === 'recent'}">${_m('statsSortByRecent')}</button>` +
            '</span>';
        html += `<label class="stats-unbookmarked" title="${_m('statsShowUnbookmarkedHint')}">` +
            `<input type="checkbox" class="stats-unbookmarked-input"${showUnbookmarked() ? ' checked' : ''}>` +
            `<span>${_m('statsShowUnbookmarked')}</span></label>`;
        html += `<button class="stats-clear"${rows.length ? '' : ' disabled'}>${TRASH_ICON}${_m('statsClearData')}</button>`;
        // velvet staging §3.7: the selection-mode entry (bulk collection)
        if (displayRows.length)
            html += `<button class="stats-select-mode" aria-label="${_m('selectModeEnter')}" ` +
                `title="${_m('selectModeEnter')}">${SELECT_ICON}</button>`;
        html += '</div>';
        return html;
    };

    // (batch-deletion slice): the two section heads are gone — bookmarked
    // and unbookmarked rows now share ONE flat list sorted by the active
    // key, so there is no boundary to label. The shared list keyboard
    // contract (keyboard.js li walking) still crosses the whole list.

    // Merge the bookmark-stats rows with the recent-history rows into one
    // display list, sorted by the active key. Unbookmarked history rows join
    // only while the toolbar checkbox is on; bookmarked history rows always
    // join (an id the stats dataset lacks still holds a visited bookmark).
    const buildDisplayRows = () => {
        const out = [];
        const byId = new Map();
        for (let i = 0, l = rows.length; i < l; i++) {
            const { item, stat } = rows[i];
            const r = {
                kind: 'bm', id: item.id, title: item.title, url: item.url,
                c: stat.c, t: stat.t, bookmarkId: item.id, parentId: item.parentId
            };
            byId.set(item.id, r);
            out.push(r);
        }
        for (let i = 0, l = histRows.length; i < l; i++) {
            const h = histRows[i];
            if (h.bookmarkId) {
                const existing = byId.get(h.bookmarkId);
                if (existing) {
                    // the stats row is authoritative for the count; the
                    // history last-visit time can be fresher — merge up.
                    if (h.t > existing.t)
                        existing.t = h.t;
                } else {
                    // visited + bookmarked but never opened through the
                    // popup: the stats dataset has no entry, history does.
                    // The live tree supplies the current title + parent (a
                    // renamed bookmark must not render history's stale copy).
                    const treeItem = treeItems.get(h.bookmarkId);
                    out.push({
                        kind: 'bm', id: h.bookmarkId,
                        title: (treeItem && treeItem.title) || h.title,
                        url: (treeItem && treeItem.url) || h.url,
                        parentId: treeItem && treeItem.parentId,
                        c: h.visitCount, t: h.t, bookmarkId: h.bookmarkId
                    });
                }
            } else if (showUnbookmarked()) {
                // unbookmarked recent-history row: its count is history's
                // own visitCount (0 when the entry carries none → sorts to
                // the bottom under count order).
                out.push({
                    kind: 'hist', id: null, title: h.title, url: h.url,
                    c: h.visitCount, t: h.t, bookmarkId: null, histIdx: i
                });
            }
        }
        const byCount = sort() === 'count';
        out.sort((a, b) => byCount
            ? (b.c - a.c) || (b.t - a.t)
            : (b.t - a.t) || (b.c - a.c));
        return out;
    };

    // The permission-guide row: shown while the `history` permission is
    // missing (no recent-history data to merge). It survives as a trailing
    // list row after the bookmarked rows.
    const renderGuideRow = () =>
        `<li class="stats-history-guide" role="listitem">` +
        `<a href="" class="stats-history-enable" tabindex="-1">${htmlspecialchars(_m('statsHistoryEnable'))}</a>` +
        `<i>${htmlspecialchars(_m('statsHistoryGuide'))}</i>` +
        '</li>';

    // One flat <ul> of merged rows, right meta aligned: both rows put the
    // bookmark icon (★ bookmarked / ☆ add) at the LINE END, then left of it
    // the count pill and the time — so the ★ and ☆ align column, the count
    // pill sits one slot left, and the time left of that (right to left:
    // icon → count → time). Both time and count ride the badge slot (time
    // is NOT the row-path), so the wide/panel container query that hides
    // row-path can never drop the time.
    // velvet staging §2.3: the history rows' hover "send to staging" button —
    // same slot language as the instant-favorite ☆, toggle semantics. Empty
    // while the staging master switch is off.
    const stageBtnHtml = row => {
        const api = ctx.stagingApi;
        if (api && api.isEnabled && !api.isEnabled())
            return '';
        const staged = !!(api && api.isStaged(row.url));
        const label = _m(staged ? 'stagingRemove' : 'stagingAdd');
        return `<button type="button" class="row-btn staging-add-btn${staged ? ' staged' : ''}" ` +
            `data-hist-idx="${row.histIdx}" aria-pressed="${staged ? 'true' : 'false'}" ` +
            `aria-label="${htmlspecialchars(label)}" title="${htmlspecialchars(label)}">` +
            (staged ? IC.stageDone : IC.stage) + '</button>';
    };

    // Row pieces for the chunked painter (4.1.0 perf round 3): one <li>
    // piece per row plus the url → piece-index map the focus retries gate on.
    const renderRowPieces = list => {
        const countBadge = c => ({ text: `×${c}`, cls: 'count', aria: _m('statsVisitCount', `${c}`) });
        const timeBadge = t => ({ text: relTimeLabel(t, _m), cls: 'time' });
        const urlIdx = new Map();
        const pieces = [];
        const push = (row, html) => {
            urlIdx.set(row.url, pieces.length);
            pieces.push(html);
        };
        for (let i = 0, l = list.length; i < l; i++) {
            const row = list[i];
            const absTime = new Date(row.t || 0).toLocaleString();
            const badges = [timeBadge(row.t), countBadge(row.c)];
            const sel = selecting && selected.has(row.url);
            if (row.bookmarkId) {
                const path = views.pathOf(row.bookmarkId);
                // issue #64: meta lines take the label form (reverse option)
                const labelPath = views.pathLabelOf ? views.pathLabelOf(row.bookmarkId) : path;
                push(row, `<li class="vbm-row${sel ? ' sel' : ''}" id="stats-item-${row.bookmarkId}" role="listitem" ` +
                    `data-node-id="${row.bookmarkId}" data-parentid="${row.parentId || ''}" data-url="${encodeURIComponent(row.url)}">` +
                    treeRender.generateBookmarkHTML(row.title, row.url, 'data-virtual="1"', row.bookmarkId, null, {
                        path,
                        badge: badges,
                        // Narrow: the path rides the inline .row-path slot
                        // (right before the time badge, so the right side
                        // reads path → time → count → icon). Wide/panel: the
                        // row-path hides and the second line shows
                        // path · absolute time — the same template as the
                        // recent/dupes views (aligned with the unbookmarked
                        // rows' bare absolute time when the path is off).
                        pathLabel: labelPath,
                        dateAdded: row.dateAdded,
                        rightText: (views.showItemPath() && path) ? labelPath : '',
                        subText: (views.showItemPath() && path)
                            ? `${labelPath} · ${absTime}`
                            : absTime
                    }) +
                    // ★: bookmarked-state marker (filled star), always visible,
                    // aligned with the unbookmarked rows' ☆ (hollow star) at
                    // the line end — one glyph, two states.
                    `<span class="stats-star" aria-label="${_m('statsHistoryBookmarked')}">${IC.starFilled}</span>` +
                    // the same hover stage toggle the unbookmarked rows carry
                    // (both row kinds end with star + plane columns aligned)
                    stageBtnHtml(row) +
                    '</li>');
            } else {
                push(row, `<li class="vbm-row stats-hist-row${sel ? ' sel' : ''}" role="listitem" data-url="${encodeURIComponent(row.url)}">` +
                    treeRender.generateBookmarkHTML(row.title, row.url, 'data-virtual="1"', null, null, {
                        badge: badges,
                        subText: absTime
                    }) +
                    `<button type="button" class="row-btn stats-add-btn" data-hist-idx="${row.histIdx}" ` +
                    `aria-label="${htmlspecialchars(_m('statsHistoryAdd'))}" ` +
                    `title="${htmlspecialchars(_m('statsHistoryAdd'))}">${STAR_ICON}</button>` +
                    stageBtnHtml(row) +
                    '</li>');
            }
        }
        return { pieces, urlIdx };
    };

    // --- Toolbar + row focus park/restore: see src/list-focus.js -----------
    // (final polish / 4.0.1 focus law). Stats has no risk banner, but the
    // shared toolbar selector's extra risk-banner terms simply match nothing
    // here — the same cls+idx restore works unchanged.

    const render = () => {
        // displayRows feeds the toolbar (the select entry rides on it) —
        // build BEFORE the toolbar renders
        if (enabled())
            displayRows = buildDisplayRows();
        let html = renderToolbar();
        const list = enabled() ? displayRows : [];
        const guideNeeded = enabled() && historyPerm === false;
        // Final polish: keep a focused toolbar control focused across the
        // innerHTML swap (sort switch re-renders the bar) — cls+idx key, or
        // the keyboard rung dies on every refresh.
        const parkedToolbar = parkToolbarFocus($list);
        // 4.0.1 focus law: a focused list ROW rides the same swap
        let parkedRow = parkRowFocus($list);
        if (paintHandle)
            paintHandle.cancel();
        // Chunked paint (4.1.0 perf round 3): the toolbar + the first rows
        // land synchronously, the rest stream in adaptive rAF batches — the
        // 6000-bookmark profile no longer pays one whole-list parse task.
        // Degenerate shapes (master off, empty, no guide) keep the plain
        // single paint.
        const finishSelectionFocus = () => {
            if (selectionFocus === 'first') {
                selectionFocus = null;
                const firstBtn = $list.querySelector && $list.querySelector('.stats-select-toolbar button:not([disabled])');
                if (firstBtn && firstBtn.focus)
                    firstBtn.focus();
            } else if (selectionFocus === 'entry') {
                selectionFocus = null;
                const entryBtn = $list.querySelector && $list.querySelector('.stats-select-mode');
                if (entryBtn && entryBtn.focus)
                    entryBtn.focus();
            }
        };
        const tryPendingRowFocus = paintedThrough => {
            if (pendingRowFocus === null)
                return;
            const idx = urlPieceIdx.get(pendingRowFocus);
            if (idx === undefined || (paintedThrough != null && idx >= paintedThrough))
                return;
            const url = pendingRowFocus;
            pendingRowFocus = null;
            if ($list.querySelector) {
                const row = $list.querySelector(`li[data-url="${encodeURIComponent(url)}"]`);
                const anchor = row && row.querySelector ? row.querySelector('a') : null;
                if (anchor && anchor.focus)
                    anchor.focus();
            }
        };
        const tryUnparkRow = () => {
            if (parkedRow && parkedRow.id && typeof document !== 'undefined'
                && typeof document.getElementById === 'function'
                && document.getElementById(parkedRow.id)) {
                unparkRowFocus($list, parkedRow);
                parkedRow = null;
            }
        };
        if (!enabled()) {
            // Master switch off: guidance instead of data (§3.4 empty states).
            html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('statsDisabledHint')}</i></li></ul>`;
            $list.innerHTML = html;
            restoreToolbarFocus($list, parkedToolbar);
            unparkRowFocus($list, parkedRow);
            parkedRow = null;
            finishSelectionFocus();
            onRowsRendered();
            return;
        }
        if (!list.length && !guideNeeded) {
            html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('statsEmpty')}</i></li></ul>`;
            $list.innerHTML = html;
            restoreToolbarFocus($list, parkedToolbar);
            unparkRowFocus($list, parkedRow);
            parkedRow = null;
            finishSelectionFocus();
            onRowsRendered();
            return;
        }
        // One merged list under the toolbar's sort control. The guide
        // row (missing history permission) trails the bookmarked rows.
        const { pieces, urlIdx } = renderRowPieces(list);
        urlPieceIdx = urlIdx;
        if (guideNeeded)
            pieces.push(renderGuideRow());
        paintHandle = paintListChunked($list, {
            head: html + `<ul role="list"${selecting ? ' class="selecting"' : ''}>`,
            pieces,
            first: 80, chunk: 160,
            adaptive: true, budgetMs: 16, minChunk: 40, maxChunk: 320,
            onHead: el => {
                restoreToolbarFocus(el, parkedToolbar);
                finishSelectionFocus();
                tryPendingRowFocus(null);
                onRowsRendered();
            },
            onChunk: (el, from, end) => {
                tryPendingRowFocus(end);
                tryUnparkRow();
                onRowsRendered();
            },
            onSettled: el => {
                if (parkedRow) {
                    unparkRowFocus(el, parkedRow);
                    parkedRow = null;
                }
                tryPendingRowFocus(null);
                fitSelectionLabels();
            }
        });
    };

    // The selecting action rung's progressive labels (shared fitter) —
    // reveal right-to-left as free width allows; re-fit on resize.
    const fitSelectionLabels = () => {
        if (!$list.querySelector)
            return;
        fitToolbarLabels($list.querySelector('.stats-actions-toolbar'));
    };
    watchToolbarFit($list, () => {
        if (selecting)
            fitSelectionLabels();
    });

    // Delete applies to the BOOKMARKED rows only (§3.7 — history rows have
    // no tree node); confirm + per-item undo capture, then refresh.
    const deleteSelectedRows = () => {
        const rows2 = selectedRows().filter(r => r.bookmarkId);
        if (!rows2.length)
            return;
        const run = () => {
            let i = 0;
            const step = () => {
                if (i >= rows2.length) {
                    selected.clear();
                    onChanged();
                    undo.showToast(_m('stagingDeleted', `${rows2.length}`));
                    return;
                }
                const r = rows2[i++];
                if (ctx.undo && ctx.undo.capture)
                    ctx.undo.capture(r.bookmarkId);
                chrome.bookmarks.remove(r.bookmarkId, () => {
                    if (chrome.runtime.lastError)
                        return;
                    step();
                });
            };
            step();
        };
        if (dialogs && dialogs.ConfirmDialog) {
            dialogs.ConfirmDialog.open({
                dialog: _m('stagingDeleteConfirm', `${rows2.length}`),
                button1: `<strong>${_m('delete')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    const refresh = () => {
        chrome.bookmarks.getTree(tree => {
            lastTree = tree;
            treeItems = new Map(flattenTree(tree).map(item => [item.id, item]));
            rows = collectRows([...treeItems.values()]);
            resolveHistRows(tree);
            // The tab badge tracks the row count even while the view is
            // hidden — recompute always, repaint only when active.
            views.updateBadges();
            if (!views.isActive('stats')) {
                dirty = true;
                return;
            }
            dirty = false;
            renderedRevision = statsRevision();
            render();
        });
    };

    // --- Recent-history section (第四轮项9) --------------------------------
    // Dataset mutations that bypass this view's own render pass (the
    // recent-view history import seeds visitStats from there) bump
    // visitStats.revision() — treat a revision mismatch as dirty so the
    // next activate never shows stale counts. The optional call keeps
    // legacy test doubles (no revision) on the old dirty-only path.
    const statsRevision = () => (visitStats.revision ? visitStats.revision() : 0);
    let renderedRevision = statsRevision();

    // The slice-D activate body, shared by every probe path below.
    const refreshIfNeeded = () => {
        if (dirty || !$list.innerHTML || statsRevision() !== renderedRevision)
            refresh();
    };

    const fetchHistory = () => {
        if (!chrome.history || !chrome.history.search)
            return;
        chrome.history.search({ text: '', startTime: 0, maxResults: HISTORY_RECENT_MAX }, items => {
            // history.search already aggregates per URL; the slash-fold
            // dedupe also collapses bare-host vs trailing-slash doubles.
            // First (most recent) occurrence wins.
            const seen = new Set();
            const deduped = [];
            for (let i = 0, l = (items || []).length; i < l; i++) {
                const h = items[i];
                if (!h.url || !bookmarkableUrl(h.url))
                    continue;
                const key = matchUrl(h.url);
                if (seen.has(key))
                    continue;
                seen.add(key);
                deduped.push(h);
            }
            histItems = deduped;
            if (!lastTree || dirty) {
                refreshIfNeeded(); // no tree snapshot (or a stale one) —
                return;            // refresh resolves + repaints + clears dirty
            }
            resolveHistRows(lastTree);
            if (views.isActive('stats'))
                render();
            else
                dirty = true;
        });
    };

    const probeHistory = () => {
        // The master switch gates the whole feature: no probe, no fetch.
        if (!enabled() || !(chrome.permissions && chrome.permissions.contains)) {
            historyPerm = null;
            refreshIfNeeded();
            return;
        }
        chrome.permissions.contains({ permissions: ['history'] }, granted => {
            historyPerm = !!granted;
            if (historyPerm)
                fetchHistory();
            else
                refreshIfNeeded(); // the guide row rides the normal repaint
        });
    };

    // One-click bookmark from a row's ☆ button: same landing folder as the
    // popup star button (issue #30) — quickAddFolderId, default '1'.
    const addToBookmarks = idx => {
        const row = histRows[idx];
        if (!row || row.bookmarkId)
            return;
        // State flip: the row becomes its bookmarked form (★ badge,
        // data-node-id, no button).
        const flipToBookmarked = id => {
            row.bookmarkId = `${id}`;
            onChanged(); // invalidate the already-rendered tree
            render();
        };
        // Session blind spot (review 05-S6): this view only listens to
        // onRemoved, so a bookmark created mid-session (quick-add star, tree
        // add) doesn't flip the stale row — re-check by URL before create or
        // the ☆ would mint a duplicate.
        chrome.bookmarks.search({ url: row.url }, existing => {
            if (existing && existing.length) {
                flipToBookmarked(existing[0].id);
                return;
            }
            const parentId = store.get('quickAddFolderId', '1');
            chrome.bookmarks.create({ title: row.title || row.url, url: row.url, parentId }, created => {
                if (!created || created.id === undefined || created.id === null)
                    return; // create failed (lastError) — leave the row untouched
                flipToBookmarked(created.id);
                // The quick-add toast wording, reused verbatim.
                chrome.bookmarks.get(parentId, nodes => {
                    const folderName = (nodes && nodes.length) ? (nodes[0].title || '') : '';
                    undo.showToast(_m('quickAddedTo', folderName));
                });
            });
        });
    };

    // --- Clear-statistics gate -----------------------------------------------------
    const clearStats = () => {
        if (!rows.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('statsClearConfirm', `${rows.length}`),
            button1: `<strong>${_m('statsClearData')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                visitStats.clear();
                refresh();
            }
        });
    };

    // --- Events --------------------------------------------------------------------
    // A deleted bookmark must not linger in the list (the dataset entry is
    // pruned by the tree-rebuild hook in neat.js; this replays the render).
    let refreshTimer = null;
    chrome.bookmarks.onRemoved.addListener(() => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
    });

    // The unbookmarked-history toggle: flip the persisted flag and repaint
    // (the merged list grows or sheds its unbookmarked rows). The change
    // event fires on the checkbox input itself.
    $list.addEventListener('change', e => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('stats-unbookmarked-input')) {
            store.set('statsShowUnbookmarked', t.checked ? '1' : '');
            refresh();
        }
    });
    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        // The toolbar checkbox must NOT fall through to bookmarkHandler:
        // its unconditional preventDefault cancels the checkbox's native
        // toggle (the click's default action), so the box would never flip
        // and no change event would fire. Return early and let the browser
        // flip it, then the change listener above repaints.
        if (closest('.stats-unbookmarked')) {
            return;
        }
        const segBtn = closest('.seg-btn');
        if (segBtn) {
            e.preventDefault();
            const value = segBtn.dataset.sort === 'recent' ? 'recent' : 'count';
            if (value !== sort()) {
                store.set('statsSort', value);
                refresh();
            }
            return;
        }
        if (closest('.stats-clear')) {
            e.preventDefault();
            clearStats();
            return;
        }
        if (closest('.stats-history-enable')) {
            e.preventDefault();
            if (chrome.permissions && chrome.permissions.request) {
                chrome.permissions.request({ permissions: ['history'] }, granted => {
                    historyPerm = !!granted;
                    if (granted)
                        fetchHistory(); // 授权后立即加载
                    else
                        render(); // denied — the guide row stays
                });
            }
            return;
        }
        if (selecting) {
            const toolbarBtn = cls => {
                const btn = closest(cls);
                return btn && closest('.vbm-toolbar') ? btn : null;
            };
            if (toolbarBtn('.stats-select-all')) {
                for (const r of displayRows)
                    selected.add(r.url);
                render();
                return;
            }
            if (toolbarBtn('.stats-select-invert')) {
                for (const r of displayRows) {
                    if (selected.has(r.url))
                        selected.delete(r.url);
                    else
                        selected.add(r.url);
                }
                render();
                return;
            }
            if (toolbarBtn('.stats-select-clear')) {
                selected.clear();
                render();
                return;
            }
            if (toolbarBtn('.stats-select-exit')) {
                setSelecting(false, 'entry');
                return;
            }
            if (toolbarBtn('.stats-stage')) {
                const api = ctx.stagingApi;
                if (api) {
                    const rows2 = selectedRows();
                    api.addItems(rows2.map(r => ({ id: r.bookmarkId || null, url: r.url, title: r.title })));
                }
                return;
            }
            if (toolbarBtn('.stats-open')) {
                if (ctx.actions)
                    ctx.actions.openBookmarks(selectedRows().map(r => r.url), false);
                return;
            }
            if (toolbarBtn('.stats-open-group')) {
                if (ctx.actions)
                    ctx.actions.openBookmarksInGroup(selectedRows().map(r => r.url));
                return;
            }
            if (toolbarBtn('.stats-delete')) {
                deleteSelectedRows();
                return;
            }
            const li = closest('li');
            const urlAttr = li && li.dataset ? li.dataset.url : undefined;
            if (urlAttr !== undefined) {
                e.preventDefault();
                e.stopPropagation();
                const url = decodeURIComponent(urlAttr);
                if (selected.has(url))
                    selected.delete(url);
                else
                    selected.add(url);
                pendingRowFocus = url;
                render();
            }
            return;
        }
        if (closest('.stats-select-mode')) {
            e.preventDefault();
            setSelecting(true, 'first');
            return;
        }
        const addBtn = closest('.stats-add-btn');
        if (addBtn) {
            e.preventDefault();
            addToBookmarks(parseInt(addBtn.dataset.histIdx, 10));
            return;
        }
        // velvet staging: history-row hover arrow — toggle the snapshot in
        // the staging area (single fast path next to the bulk flows).
        const stageBtn = closest('.staging-add-btn');
        if (stageBtn) {
            e.preventDefault();
            e.stopPropagation();
            const api = ctx.stagingApi;
            // Both row kinds carry data-url; bookmarked rows also carry the
            // node id (the staged entry anchors), history rows go id-less.
            const li = closest('li');
            const urlAttr = li && li.dataset ? li.dataset.url : '';
            const url = urlAttr ? decodeURIComponent(urlAttr) : '';
            if (api && url) {
                if (api.isStaged(url)) {
                    api.removeByUrl(url);
                } else {
                    const i = li.querySelector ? li.querySelector('i') : null;
                    api.addItems([{ id: (li.dataset && li.dataset.nodeId) || null, url, title: i ? i.textContent : '' }]);
                }
                render();
            }
            return;
        }
        // plain rows open the bookmark like the tree does (and the open is
        // what bumps this row's own counter — see neat.js onOpenBookmark)
        treeView.bookmarkHandler(e);
    });
    $list.addEventListener('auxclick', treeView.bookmarkHandler);
    // Selection mode keys (velvet staging §3.7): Space toggles the focused
    // row, Delete acts on the selection — both on the capture phase so
    // keyboard.js never synthesizes a click under them.
    $list.addEventListener('keydown', e => {
        if (!selecting)
            return;
        if (e.key === ' ') {
            const li = e.target && e.target.closest ? e.target.closest('li.vbm-row') : null;
            const urlAttr = li && li.dataset ? li.dataset.url : undefined;
            if (urlAttr === undefined)
                return;
            e.preventDefault();
            e.stopPropagation();
            const url = decodeURIComponent(urlAttr);
            if (selected.has(url))
                selected.delete(url);
            else
                selected.add(url);
            pendingRowFocus = url;
            render();
        } else if (e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            deleteSelectedRows();
        }
    }, true);

    // (v4task-2-list §3.4 superseded by the final-polish toolbar rung: ←/→
    // walk ALL of the toolbar's controls, handled by keyboard.js's non-row
    // branch — a view-local seg-only walker would double-step.)

    // Rows without a bookmark id: unbookmarked history rows now bubble to
    // the body-level handler, which gives them their own slim menu
    // (context-menu.js, v4 task-3 #10). Only the permission guide row must
    // still be swallowed — its Enable anchor would otherwise open the
    // bookmark menu on a bogus id. Bookmarked rows bubble through with
    // their real data-node-id and get the full menu verbatim.
    $list.addEventListener('contextmenu', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        const li = closest('li');
        if (li && !(li.dataset && li.dataset.nodeId)
            && !(li.classList && li.classList.contains('stats-hist-row'))) {
            e.preventDefault();
            e.stopPropagation();
        }
    });

    views.register({
        id: 'stats',
        titleKey: 'viewStats',
        icon: VIEW_ICONS.stats,
        container: $('view-stats'),
        listEl: $list,
        hidden: !store.get('showStatsView', '1'), // showStatsView → tab visibility
        showKey: 'showStatsView',
        disableKey: 'disableStatsView',
        typeAhead: false,
        badge: () => rows.length,
        // velvet staging §3.7: stats has no second Esc level — the view
        // onEscape just leaves selection mode.
        onEscape: () => {
            if (selecting) {
                const ae = document.activeElement;
                const inToolbar = ae && ae.closest ? ae.closest('.vbm-toolbar') : null;
                setSelecting(false, inToolbar ? 'entry' : null);
                return true;
            }
            return false;
        },
        activate: () => {
            // 数据只在 activate（及授权成功）时拉取：探权限 → 已授权取最近
            // 访问，每条路径的链尾都是 refreshIfNeeded/render —— 单次激活
            // 恰好重绘一次（probe 与 refresh 不双绘）。
            probeHistory();
        }
    });

    return { refresh };
}
