/**
 * Visit-statistics + recent-history view (v4 task-2, slice D —
 * docs/v4task-2.md §5.4, docs/v4task-2-list.md §3.4; upgraded by 第四轮项9
 * into a "history + statistics" hybrid meant to replace Chrome's native
 * history page).
 *
 * Two sections share ONE flat <ul>, so the shared list keyboard contract
 * (keyboard.js ArrowUp/Down li walking, Home/End, Enter) crosses section
 * boundaries with zero view-specific keys. The bookmark-stats section
 * leads (v4 task-3 #2: the toolbar sort segment controls it, so the
 * controlled list must sit directly under the control — with the history
 * section first, a count tie made the toggle look dead):
 *
 *   1. 书签统计 (statsSectionBookmarks) — the slice-D per-bookmark
 *      counters: one row per bookmark with at least one recorded open,
 *      sorted by count (default) or recency (`statsSort` persists the
 *      choice), count pill / relative time in the meta slots (the active
 *      sort key sticks to the title column), parent path on the wide
 *      second line. Clicking opens through the shared bookmarkHandler,
 *      which is also the collection point (neat.js onOpenBookmark).
 *   2. 最近访问 (statsSectionRecent) — the latest chrome.history entries,
 *      most recent first, URL-deduped, capped at HISTORY_RECENT_MAX. Every
 *      row shows its last-visit time in both layout slots (relative label
 *      inline, absolute time on the wide/panel second line — final polish).
 *      The
 *      section's point is the URLs that are NOT in the bookmark tree:
 *      an unbookmarked row carries no row id (no data-node-id — the open
 *      still goes through the shared bookmarkHandler via the anchor href,
 *      and the visitStats.record hook no-ops on the resulting empty id)
 *      and gets a hover-revealed ☆ row button (the .row-btn pattern of
 *      the dead/dupes views) for one-click bookmarking. A row whose URL
 *      already lives in the tree is recognizable instead: a ★ badge
 *      (row-badge.starred, aria-label statsHistoryBookmarked), a real
 *      data-node-id (the click opens AND bumps that bookmark's own
 *      counter, and the body-level bookmark context menu — including
 *      在树中定位 — applies verbatim), and no star button. Right-click on
 *      an unbookmarked row opens its own slim menu (open in new tab /
 *      window / incognito + bookmark-it) built by context-menu.js
 *      (v4 task-3 #10): the body-level bookmark menu would otherwise act
 *      on a bogus id — the same hazard round-4 item 7 fixed for
 *      search-history rows. Only the permission guide row is still
 *      swallowed at the list level (preventDefault + stopPropagation).
 *
 * Section heads are muted non-interactive labels (recent-group-head
 * semantics). Each rides INSIDE its section's first row as that row's
 * LAST DOM child, pulled above the row by CSS order — deliberately NOT
 * view-recent's head-first pattern: keyboard.js Enter dispatches the
 * synthetic click at li.firstElementChild, which must stay the row anchor
 * for Enter=open to work on head-carrying rows. Empty-section rules keep
 * arrow walking from stranding on non-focusable rows: the recent section
 * is omitted entirely when granted-but-empty (a head with no rows under
 * it would read as a bug), while the stats section keeps its head on the
 * statsEmpty row, which is then the list's FIRST <li>.
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
import { VIEW_ICONS } from './icons.js';

// Same escape recipe as the other render modules (self-contained modules).
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

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

    // Bucket → label recipe imported from tree-render.js (docs/v4task-2-list.md §3.3).

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
                bookmarkId: urlToIds.get(matchUrl(h.url)) || null
            });
        }
    };

    const renderToolbar = () => {
        const s = sort();
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
        html += `<button class="stats-clear"${rows.length ? '' : ' disabled'}>${_m('statsClearData')}</button>`;
        html += '</div>';
        return html;
    };

    // Muted non-interactive section label (recent-group-head semantics).
    // Rendered as the carrier row's LAST DOM child; CSS order pulls it above
    // the row so li.firstElementChild stays the anchor (keyboard.js Enter
    // dispatches its synthetic click there).
    const sectionHead = key =>
        `<div class="stats-section-head" role="presentation">${_m(key)}</div>`;

    const renderHistorySection = () => {
        // Permission missing: the section collapses to a compact guide row
        // (one sentence + Enable link, no dismiss). The link is the li's
        // firstElementChild — the same Enter contract as data rows.
        if (historyPerm === false) {
            return `<li class="stats-history-guide has-head" role="listitem">` +
                `<a href="" class="stats-history-enable" tabindex="-1">${htmlspecialchars(_m('statsHistoryEnable'))}</a>` +
                `<i>${htmlspecialchars(_m('statsHistoryGuide'))}</i>` +
                sectionHead('statsSectionRecent') +
                '</li>';
        }
        // Probe pending or granted-but-empty: omit the section entirely.
        if (historyPerm !== true || !histRows.length)
            return '';
        let html = '';
        const showPath = views.showItemPath();
        for (let i = 0, l = histRows.length; i < l; i++) {
            const r = histRows[i];
            const head = i === 0 ? sectionHead('statsSectionRecent') : '';
            const cls = `vbm-row stats-hist-row${i === 0 ? ' has-head' : ''}`;
            // Every entry carries its last-visit time in BOTH layout forms
            // (final polish): the narrow inline right slot keeps the relative
            // label, while the wide/panel second line (which REPLACES the
            // right slot per the container query) gets the absolute time —
            // it used to render nothing there, so wide/panel rows showed no
            // time at all. Same recipe as view-recent (§3.3).
            const absTime = new Date(r.t || 0).toLocaleString();
            if (r.bookmarkId) {
                // Bookmarked: ★ badge + real row id — the open self-counts
                // and the bookmark context menu applies; no star button.
                const path = views.pathOf(r.bookmarkId);
                html += `<li class="${cls}" id="stats-hist-${r.bookmarkId}" role="listitem" ` +
                    `data-node-id="${r.bookmarkId}">` +
                    treeRender.generateBookmarkHTML(r.title, r.url, 'data-virtual="1"', r.bookmarkId, null, {
                        path,
                        rightText: relTimeLabel(r.t, _m),
                        subText: (showPath && path) ? `${path} · ${absTime}` : absTime,
                        badge: { text: '★', cls: 'starred', aria: _m('statsHistoryBookmarked') }
                    }) +
                    head +
                    '</li>';
            } else {
                // Unbookmarked: no row id (record no-ops on the empty id),
                // hover-revealed ☆ row button for the one-click add.
                html += `<li class="${cls}" role="listitem">` +
                    treeRender.generateBookmarkHTML(r.title, r.url, 'data-virtual="1"', null, null, {
                        rightText: relTimeLabel(r.t, _m),
                        subText: absTime
                    }) +
                    `<button type="button" class="row-btn stats-add-btn" data-hist-idx="${i}" ` +
                    `aria-label="${htmlspecialchars(_m('statsHistoryAdd'))}" ` +
                    `title="${htmlspecialchars(_m('statsHistoryAdd'))}">☆</button>` +
                    head +
                    '</li>';
            }
        }
        return html;
    };

    const renderStatsSection = () => {
        const head = sectionHead('statsSectionBookmarks');
        if (!rows.length)
            return `<li class="empty-state has-head" role="listitem"><i>${_m('statsEmpty')}</i>${head}</li>`;
        let html = '';
        const showPath = views.showItemPath();
        const byCount = sort() === 'count';
        for (let i = 0, l = rows.length; i < l; i++) {
            const { item, stat } = rows[i];
            const path = views.pathOf(item.id);
            const countText = `×${stat.c}`;
            const timeText = relTimeLabel(stat.t, _m);
            // §3.4: the active sort key sticks to the title column — the
            // badge slot renders it (pill style for counts, plain for
            // time), the right slot takes the secondary key.
            const badge = byCount
                ? { text: countText, cls: 'count', aria: _m('statsVisitCount', `${stat.c}`) }
                : { text: timeText, cls: 'time' };
            html += `<li class="vbm-row${i === 0 ? ' has-head' : ''}" id="stats-item-${item.id}" role="listitem" ` +
                `data-node-id="${item.id}" data-parentid="${item.parentId}">` +
                treeRender.generateBookmarkHTML(item.title, item.url, 'data-virtual="1"', item.id, null, {
                    path,
                    badge,
                    rightText: byCount ? timeText : countText,
                    subText: (showPath && path) ? path : ''
                }) +
                (i === 0 ? head : '') +
                '</li>';
        }
        return html;
    };

    // --- Toolbar focus restore (final polish) --------------------------------
    // The toolbar re-renders together with the rows (a sort switch, a clear,
    // every scan-progress tick). Without a restore, a keyboard user holding
    // focus on a control loses it to <body> on every repaint. The controls
    // are positionally stable across re-renders, so an index suffices.
    const TOOLBAR_SEL = '.vbm-toolbar button, .vbm-toolbar select, .vbm-toolbar input';
    const toolbarFocusIndex = () => {
        if (typeof $list.querySelectorAll !== 'function')
            return -1;
        const controls = $list.querySelectorAll(TOOLBAR_SEL);
        for (let i = 0, l = controls.length; i < l; i++)
            if (controls[i] === document.activeElement)
                return i;
        return -1;
    };
    const restoreToolbarFocus = idx => {
        if (idx < 0 || typeof $list.querySelectorAll !== 'function')
            return;
        const c = $list.querySelectorAll(TOOLBAR_SEL)[idx];
        if (c && c.focus)
            c.focus();
    };

    const render = () => {
        let html = renderToolbar();
        if (!enabled()) {
            // Master switch off: guidance instead of data (§3.4 empty states).
            html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('statsDisabledHint')}</i></li></ul>`;
        } else {
            // v4 task-3 #2: the bookmark-stats section comes FIRST — the
            // toolbar's sort segment controls it, so the controlled list
            // sits directly under the control (the history section led
            // before, and the toggle looked dead when every count tied).
            html += '<ul role="list">' + renderStatsSection() + renderHistorySection() + '</ul>';
        }
        // Final polish: keep a focused toolbar control focused across the
        // innerHTML swap (sort switch re-renders the bar) — positionally
        // stable index, or the keyboard rung dies on every refresh.
        const tbIdx = toolbarFocusIndex();
        $list.innerHTML = html;
        restoreToolbarFocus(tbIdx);
        onRowsRendered();
    };

    const refresh = () => {
        chrome.bookmarks.getTree(tree => {
            lastTree = tree;
            rows = collectRows(flattenTree(tree));
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
        const parentId = store.get('quickAddFolderId', '1');
        chrome.bookmarks.create({ title: row.title || row.url, url: row.url, parentId }, created => {
            if (!created || created.id === undefined || created.id === null)
                return; // create failed (lastError) — leave the row untouched
            // State flip: the row becomes its bookmarked form (★ badge,
            // data-node-id, no button).
            row.bookmarkId = `${created.id}`;
            onChanged(); // invalidate the already-rendered tree
            // The quick-add toast wording, reused verbatim.
            chrome.bookmarks.get(parentId, nodes => {
                const folderName = (nodes && nodes.length) ? (nodes[0].title || '') : '';
                undo.showToast(_m('quickAddedTo', folderName));
            });
            render();
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

    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
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
        const addBtn = closest('.stats-add-btn');
        if (addBtn) {
            e.preventDefault();
            addToBookmarks(parseInt(addBtn.dataset.histIdx, 10));
            return;
        }
        // plain rows open the bookmark like the tree does (and the open is
        // what bumps this row's own counter — see neat.js onOpenBookmark)
        treeView.bookmarkHandler(e);
    });
    $list.addEventListener('auxclick', treeView.bookmarkHandler);

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
        typeAhead: false,
        badge: () => rows.length,
        activate: () => {
            // 数据只在 activate（及授权成功）时拉取：探权限 → 已授权取最近
            // 访问，每条路径的链尾都是 refreshIfNeeded/render —— 单次激活
            // 恰好重绘一次（probe 与 refresh 不双绘）。
            probeHistory();
        }
    });

    return { refresh };
}
