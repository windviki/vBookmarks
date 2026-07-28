/**
 * Visit-statistics view (v4 task-2, slice D — docs/v4task-2.md §5.4,
 * docs/v4task-2-list.md §3.4).
 *
 * Renders the visit-stats dataset as its own tab: one row per bookmark that
 * has at least one recorded open, sorted by count (default) or by recency —
 * the choice persists under `statsSort`. Rows follow the unified list-row
 * spec: title + URL tooltip, the count pill / relative time in the right
 * meta slots (the active sort key sticks to the title column — count sort
 * shows the pill left, recent sort the time), the parent path as the wide
 * second line. Clicking a row opens the bookmark through the shared
 * bookmarkHandler, which is also the collection point — the open bumps the
 * row's own counter (slice D wires treeView's onOpenBookmark to
 * visitStats.record).
 *
 * Toolbar (row 0, §3.4): a two-segment sort switch plus the danger-colored
 * "Clear statistics" text button (ConfirmDialog-gated). The empty state is
 * statsEmpty; with `statsEnabled` off the view shows the statsDisabledHint
 * guidance instead of data — the switch is the master gate, data stays
 * untouched beneath.
 *
 * Refresh: the dataset only changes through this popup's own opens (slice E
 * adds the SW-side collector), so rendering on activation plus after a
 * clear is enough; bookmark removals additionally prune the dataset via the
 * tree-rebuild hook in neat.js, and a debounced onRemoved refresh keeps a
 * lingering row from outliving its bookmark.
 *
 * initViewStats(ctx) is called once by neat.js after initViewDead.
 * ctx.store            — settings mirror (statsSort/statsEnabled/showItemPath/showStatsView)
 * ctx.views            — view-manager API (register/isActive/pathOf/showItemPath)
 * ctx.treeRender       — tree-render.js API (generateBookmarkHTML)
 * ctx.separatorManager — isSeparator filtering
 * ctx.treeView         — bookmarkHandler (click/auxclick open)
 * ctx.dialogs          — ConfirmDialog for the clear-statistics gate
 * ctx.visitStats       — initVisitStats API (all/clear/enabled)
 *
 * chrome.bookmarks.getTree/onRemoved, chrome.i18n.getMessage, document and
 * setTimeout remain page globals.
 */

import { relativeTimeBucket } from './tree-render.js';
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

    const $list = $('stats-list');

    const enabled = () => visitStats.enabled();
    const sort = () => store.get('statsSort', 'count') === 'recent' ? 'recent' : 'count';

    // Same bucket → label recipe as view-recent (docs/v4task-2-list.md §3.3).
    const relTimeLabel = ts => {
        const b = relativeTimeBucket(ts, Date.now());
        if (b.key === null)
            return new Date(ts).toLocaleDateString();
        return b.n ? _m(b.key, `${b.n}`) : _m(b.key);
    };

    let dirty = false;
    let rows = []; // [{ item, stat }] in display order

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

    const renderToolbar = () => {
        const s = sort();
        let html = '<div class="stats-toolbar">';
        html += '<span class="seg" role="group">' +
            `<button class="seg-btn${s === 'count' ? ' active' : ''}" data-sort="count" ` +
            `aria-pressed="${s === 'count'}">${_m('statsSortByCount')}</button>` +
            `<button class="seg-btn${s === 'recent' ? ' active' : ''}" data-sort="recent" ` +
            `aria-pressed="${s === 'recent'}">${_m('statsSortByRecent')}</button>` +
            '</span>';
        html += `<button class="stats-clear"${rows.length ? '' : ' disabled'}>${_m('statsClearData')}</button>`;
        html += '</div>';
        return html;
    };

    const render = () => {
        let html = renderToolbar();
        if (!enabled()) {
            // Master switch off: guidance instead of data (§3.4 empty states).
            html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('statsDisabledHint')}</i></li></ul>`;
        } else if (!rows.length) {
            html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('statsEmpty')}</i></li></ul>`;
        } else {
            html += '<ul role="list">';
            const showPath = views.showItemPath();
            const byCount = sort() === 'count';
            for (let i = 0, l = rows.length; i < l; i++) {
                const { item, stat } = rows[i];
                const path = views.pathOf(item.id);
                const countText = `×${stat.c}`;
                const timeText = relTimeLabel(stat.t);
                // §3.4: the active sort key sticks to the title column — the
                // badge slot renders it (pill style for counts, plain for
                // time), the right slot takes the secondary key.
                const badge = byCount
                    ? { text: countText, cls: 'count', aria: _m('statsVisitCount', `${stat.c}`) }
                    : { text: timeText, cls: 'time' };
                html += `<li class="vbm-row" id="stats-item-${item.id}" role="listitem" ` +
                    `data-node-id="${item.id}" data-parentid="${item.parentId}">` +
                    treeRender.generateBookmarkHTML(item.title, item.url, 'data-virtual="1"', item.id, null, {
                        path,
                        badge,
                        rightText: byCount ? timeText : countText,
                        subText: (showPath && path) ? path : ''
                    }) +
                    '</li>';
            }
            html += '</ul>';
        }
        $list.innerHTML = html;
    };

    const refresh = () => {
        chrome.bookmarks.getTree(tree => {
            rows = collectRows(flattenTree(tree));
            // The tab badge tracks the row count even while the view is
            // hidden — recompute always, repaint only when active.
            views.updateBadges();
            if (!views.isActive('stats')) {
                dirty = true;
                return;
            }
            dirty = false;
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
        // plain rows open the bookmark like the tree does (and the open is
        // what bumps this row's own counter — see neat.js onOpenBookmark)
        treeView.bookmarkHandler(e);
    });
    $list.addEventListener('auxclick', treeView.bookmarkHandler);

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
            if (dirty || !$list.innerHTML)
                refresh();
        }
    });

    return { refresh };
}
