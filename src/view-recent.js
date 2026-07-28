/**
 * Recent bookmarks view (v4 task-2, slice B — docs/v4task-2.md §5.3).
 *
 * The virtual "recently added" section that used to be pinned on top of the
 * tree (tree-view.js, pre-slice-B) becomes its own tab. Data comes from
 * chrome.bookmarks.getRecent(N) with N setting-driven (`recentCount`,
 * default 20); rows reuse tree-render's generateBookmarkHTML with the recent
 * meta slots (docs/v4task-2-list.md §3.3): the narrow right slot shows the
 * relative time, the wide second line `路径 · 绝对时间`; the unified
 * 标题+URL+路径 tooltip comes free via meta.path. Rows keep the old
 * semantics: data-virtual="1" (drag-and-drop rejects them), real bookmark
 * ids for open/context-menu/Delete, and the unified data-node-id row id.
 *
 * Refresh: chrome.bookmarks.onCreated/onRemoved + 300ms debounce, skipped
 * while the view is hidden or inactive (a dirty flag replays it on the next
 * activation). `showRecentBookmarks` migrates to the tab's visibility
 * (hidden ViewDef) — same key, same default-on semantics.
 *
 * "Reveal in tree" (R key / context-menu item, §2.3/§2.4) jumps to the tree
 * view and locates the node through treeView.revealInTree — the same chain
 * the search folder rows use.
 *
 * History-permission banner (2026-07-25 spec): while stats is enabled, the
 * optional `history` permission is missing and the user hasn't dismissed
 * the ask, a banner on top of the list offers a one-click grant. The link
 * runs chrome.permissions.request (a real user gesture); a grant seeds
 * visitStats from chrome.history in one additive merge. If the popup dies
 * mid-dialog the next activation notices the grant and imports then (the
 * `statsHistoryImportedAt` key gates the one-shot import), so the flow is
 * self-healing. Dismissal persists under `statsHistoryBannerDismissed`.
 *
 * initViewRecent(ctx) is called once by neat.js after treeView init.
 * ctx.store            — settings mirror (showRecentBookmarks/recentCount/showItemPath)
 * ctx.views            — view-manager API (register/isActive/pathOf/activate/updateBadges)
 * ctx.treeRender       — tree-render.js API (generateBookmarkHTML)
 * ctx.separatorManager — isSeparator filtering
 * ctx.treeView         — revealInTree + bookmarkHandler (click/auxclick open)
 * ctx.visitStats       — initVisitStats API (enabled/merge) for the import
 * ctx.undo             — showToast for the import confirmation
 *
 * chrome.bookmarks.getRecent/onCreated/onRemoved, chrome.i18n.getMessage,
 * document and setTimeout remain page globals.
 */

import { relativeTimeBucket } from './tree-render.js';
import { VIEW_ICONS } from './icons.js';

// Same escape recipe as the other render modules (self-contained modules).
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function initViewRecent(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const views = ctx.views;
    const treeRender = ctx.treeRender;
    const separatorManager = ctx.separatorManager;
    const treeView = ctx.treeView;
    // History-permission banner collaborators (both optional so minimal
    // test setups keep working; neat.js always injects them).
    const visitStats = ctx.visitStats || { enabled: () => false, merge: () => 0 };
    const undo = ctx.undo || { showToast: () => {} };

    const $list = $('recent-list');

    const enabled = () => !!store.get('showRecentBookmarks', '1');
    const recentCount = () => {
        const n = parseInt(store.get('recentCount', '20'), 10);
        return n > 0 ? n : 20;
    };

    // --- History-permission banner ------------------------------------------
    // Shown while: stats on + permission missing + not dismissed. The grant
    // seeds visitStats once (statsHistoryImportedAt gates it); a grant that
    // lands while the popup is closed is picked up by the next probe.
    let historyPerm = null; // null = probe pending
    const statsOn = () => !!visitStats.enabled();
    const bannerDismissed = () => !!store.get('statsHistoryBannerDismissed');

    const bannerHtml = () => {
        if (!statsOn() || historyPerm !== false || bannerDismissed())
            return '';
        const dismissLabel = _m('statsHistoryDismiss');
        return `<div class="stats-history-banner" role="note">` +
            `<i>${htmlspecialchars(_m('statsHistoryBanner'))}</i>` +
            `<a href="" class="stats-history-enable" tabindex="0">${htmlspecialchars(_m('statsHistoryEnable'))}</a>` +
            `<button type="button" class="row-btn stats-history-dismiss" tabindex="-1" ` +
            `aria-label="${htmlspecialchars(dismissLabel)}" title="${htmlspecialchars(dismissLabel)}">×</button>` +
            `</div>`;
    };

    const importHistory = () => {
        if (!statsOn() || !chrome.history || !chrome.history.search)
            return;
        chrome.bookmarks.getTree(tree => {
            // URL → bookmark ids (duplicates share a URL; every copy earns
            // the same baseline so their relative order stays fair)
            const urlToIds = new Map();
            const walk = nodes => {
                for (let i = 0, l = nodes.length; i < l; i++) {
                    const node = nodes[i];
                    if (node.children)
                        walk(node.children);
                    else if (node.url) {
                        const ids = urlToIds.get(node.url);
                        if (ids)
                            ids.push(node.id);
                        else
                            urlToIds.set(node.url, [node.id]);
                    }
                }
            };
            walk(tree || []);
            chrome.history.search({ text: '', startTime: 0, maxResults: 2000 }, items => {
                const entries = [];
                for (let i = 0, l = (items || []).length; i < l; i++) {
                    const h = items[i];
                    const ids = h.url && urlToIds.get(h.url);
                    if (!ids)
                        continue;
                    for (let j = 0; j < ids.length; j++)
                        entries.push({ id: ids[j], c: h.visitCount || 1, t: h.lastVisitTime || 0 });
                }
                const n = visitStats.merge(entries);
                store.set('statsHistoryImportedAt', `${Date.now()}`);
                undo.showToast(_m('statsHistoryImported', `${n}`));
                views.updateBadges(); // the stats tab count may have grown
                if (views.isActive('recent'))
                    refresh();
            });
        });
    };

    const probePermission = () => {
        if (!statsOn() || !(chrome.permissions && chrome.permissions.contains)) {
            historyPerm = null;
            return;
        }
        chrome.permissions.contains({ permissions: ['history'] }, granted => {
            historyPerm = !!granted;
            if (historyPerm && !store.get('statsHistoryImportedAt')) {
                importHistory(); // grant landed while the popup was closed
            } else if (views.isActive('recent')) {
                refresh(); // repaint with the banner resolved
            }
        });
    };

    // docs/v4task-2-list.md §3.3 bucket → label: relative up to 7 days,
    // absolute date beyond. Same recipe as search.js's history timestamps.
    const relTimeLabel = ts => {
        const b = relativeTimeBucket(ts, Date.now());
        if (b.key === null)
            return new Date(ts).toLocaleDateString();
        return b.n ? _m(b.key, `${b.n}`) : _m(b.key);
    };

    let dirty = false;
    const render = items => {
        let html = bannerHtml();
        html += '<ul role="list">';
        let count = 0;
        const showPath = views.showItemPath();
        for (let i = 0, l = items.length; i < l; i++) {
            const d = items[i];
            if (!d.url || separatorManager.isSeparator(d.title, d.url))
                continue;
            count++;
            const path = views.pathOf(d.id);
            // §3.3: narrow right slot = relative time; wide second line =
            // `路径 · 绝对时间` (the path half follows showItemPath).
            const absTime = new Date(d.dateAdded || 0).toLocaleString();
            const subText = (showPath && path) ? `${path} · ${absTime}` : absTime;
            html += `<li class="vbm-row" id="recent-item-${d.id}" role="listitem" ` +
                `data-node-id="${d.id}" data-parentid="${d.parentId}">` +
                treeRender.generateBookmarkHTML(d.title, d.url, 'data-virtual="1"', d.id, null, {
                    path,
                    rightText: relTimeLabel(d.dateAdded || 0),
                    subText
                }) +
                '</li>';
        }
        if (!count)
            html += `<li class="empty-state" role="listitem"><i>${_m('recentEmpty')}</i></li>`;
        html += '</ul>';
        $list.innerHTML = html;
    };

    const refresh = () => {
        if (!enabled())
            return;
        // Inactive views skip the fetch (same optimization the old section
        // had for its collapsed state); the activate hook replays it.
        if (!views.isActive('recent')) {
            dirty = true;
            return;
        }
        dirty = false;
        chrome.bookmarks.getRecent(recentCount(), render);
    };

    // Debounced freshness while the popup stays open; onRemoved covered too,
    // otherwise a just-deleted bookmark would linger in the list.
    let refreshTimer = null;
    const scheduleRefresh = () => {
        if (!enabled())
            return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
    };
    chrome.bookmarks.onCreated.addListener(scheduleRefresh);
    chrome.bookmarks.onRemoved.addListener(scheduleRefresh);

    // Open semantics are the tree's (§5.3: 打开/右键菜单/键盘与 tree 书签行
    // 一致): the shared bookmarkHandler dispatches plain bookmark clicks;
    // the body-level contextmenu delegation picks the bookmark menu. The
    // banner's two controls are intercepted first.
    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        if (closest('.stats-history-enable')) {
            e.preventDefault();
            if (chrome.permissions && chrome.permissions.request) {
                chrome.permissions.request({ permissions: ['history'] }, granted => {
                    historyPerm = !!granted;
                    if (granted)
                        importHistory();
                    else
                        refresh(); // denied — the banner stays
                });
            }
            return;
        }
        if (closest('.stats-history-dismiss')) {
            e.preventDefault();
            store.set('statsHistoryBannerDismissed', '1');
            refresh();
            return;
        }
        treeView.bookmarkHandler(e);
    });
    $list.addEventListener('auxclick', treeView.bookmarkHandler);

    // R — reveal the focused row in the tree (docs/v4task-2-list.md §2.3).
    // Consumed by keyboard.js before the type-ahead gate; recent registers
    // typeAhead:false, so letters never reach the keyBuffer here.
    const onKey = e => {
        if (e.key !== 'r' && e.key !== 'R')
            return false;
        const item = document.activeElement;
        const li = item && item.parentNode;
        const id = li && (li.dataset.nodeId || li.id.replace(/^recent-item-/, ''));
        if (!id)
            return false;
        e.preventDefault();
        treeView.revealInTree(id);
        return true;
    };

    views.register({
        id: 'recent',
        titleKey: 'viewRecent',
        icon: VIEW_ICONS.recent,
        container: $('view-recent'),
        listEl: $list,
        hidden: !enabled(), // showRecentBookmarks → tab visibility (§5.3 迁移)
        typeAhead: false,
        activate: () => {
            probePermission(); // the grant may have landed while away
            if (dirty || !$list.innerHTML)
                refresh();
        },
        onKey
    });

    probePermission(); // startup probe (refresh/banner resolve in the callback)

    return { refresh };
}
