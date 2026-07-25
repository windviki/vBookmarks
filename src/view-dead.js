/**
 * Dead-link scan view (v4 task-2, slice C — docs/v4task-2.md §5.5, row spec
 * docs/v4task-2-list.md §3.5).
 *
 * Migrates the palette's old mode='dead' panel into its own tab and extends
 * it with the v3 additions: a persisted last-scan cache, the dual-channel
 * direct/proxy verdict, dead marks with a cross-view × overlay, batch mark
 * operations, a result filter and the two scan tuning settings.
 *
 * §5.5a cache: a finished scan lands in `deadLastScan` ({ ts, scannedCount,
 * results: { id: { status, code } } }) — reopening the view renders the
 * cache with a "last scan … · rescan" info row instead of auto-scanning;
 * with no cache the empty state is the executable deadStartHint row
 * (Enter/click starts the scan).
 *
 * §5.5b dual channel: every URL goes through dead-links.js's checkUrlDual
 * with the configured `deadProxyTemplate` (empty = direct only) — direct
 * failure + proxy reachability means `blocked` (region-limited, not dead),
 * rendered with the amber badge; both channels failing confirms `dead`.
 * `deadScanConcurrency` (default 4) and `deadScanTimeout` (default 8s) tune
 * the pool.
 *
 * §5.5c marks: `deadMarks` (id array) toggle per row (⚑ button / M key);
 * every list (tree / search results / recent) overlays a red × on the
 * favicon's top-right corner via refreshOverlays() (sync dots sit on the
 * bottom-right, so they never collide). Marks prune on bookmark removal,
 * and ids that came back ok/skipped after a rescan drop out automatically.
 * Batch "mark all" (every dead+blocked row of the result set) and "clear
 * all marks" are ConfirmDialog-gated. badge() = deadMarks.length.
 *
 * §5.5d lifecycle: switching views mid-scan never aborts (the closure owns
 * the scan; coming back replays the progress); Esc aborts while scanning
 * (onEscape); pagehide aborts — the cache is already on disk. Row deletion
 * rides actions.deleteBookmark (the undo chain).
 *
 * The filter (all / dead only / blocked only) is an in-memory view control,
 * deliberately not persisted (§5.5c).
 *
 * initViewDead(ctx) is called once by neat.js after treeView init.
 * ctx.store            — settings mirror (deadMarks/deadLastScan/deadProxyTemplate/
 *                        deadScanConcurrency/deadScanTimeout)
 * ctx.views            — view-manager API (register/isActive/pathOf)
 * ctx.treeRender       — tree-render.js API (generateBookmarkHTML)
 * ctx.separatorManager — isSeparator filtering (separators are http(s),
 *                        they must never be probed)
 * ctx.treeView         — revealInTree + bookmarkHandler (click/auxclick open)
 * ctx.actions          — deleteBookmark for the row delete button
 * ctx.dialogs          — ConfirmDialog for the batch mark operations
 * ctx.undo             — showToast for the batch-mark report
 *
 * chrome.bookmarks.*, chrome.i18n.getMessage, fetch (through dead-links.js),
 * document, window and setTimeout remain page globals.
 */

import { checkUrlDual, startDeadScan, filterScannable, collectDead, statusLabel } from './dead-links.js';
import { VIEW_ICONS } from './icons.js';

// Same escape recipe as the other render modules (self-contained modules).
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function initViewDead(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const views = ctx.views;
    const treeRender = ctx.treeRender;
    const separatorManager = ctx.separatorManager;
    const treeView = ctx.treeView;
    const actions = ctx.actions;
    const dialogs = ctx.dialogs;
    const undo = ctx.undo;

    const $list = $('dead-list');

    // --- State ----------------------------------------------------------------
    const loadMarks = () => {
        try {
            return new Set(JSON.parse(store.get('deadMarks', '[]') || '[]'));
        } catch (e) {
            return new Set();
        }
    };
    let deadMarks = loadMarks();
    let scan = null;        // { promise, abort() } while a scan runs
    let scanProgress = 0;   // settled checks of the running scan
    let scanTotal = 0;      // item count of the running scan
    let lastScan = null;    // { ts, scannedCount, results: {id:{status,code}} }
    let treeItems = new Map(); // id → { id, title, url } of the last render
    let filter = 'all';     // 'all' | 'dead' | 'blocked' — in-memory (§5.5c)

    const persistMarks = () =>
        store.set('deadMarks', JSON.stringify([...deadMarks]));

    const loadCache = () => {
        try {
            lastScan = JSON.parse(store.get('deadLastScan', '') || 'null');
        } catch (e) {
            lastScan = null;
        }
        return lastScan;
    };

    const scannableItems = tree =>
        filterScannable(flattenTree(tree),
            (title, url) => separatorManager.isSeparator(title, url));

    const scanSettings = () => ({
        proxyTemplate: store.get('deadProxyTemplate', '') || '',
        concurrency: Math.min(16, Math.max(1, parseInt(store.get('deadScanConcurrency', '4'), 10) || 4)),
        timeoutMs: Math.min(30, Math.max(2, parseInt(store.get('deadScanTimeout', '8'), 10) || 8)) * 1000
    });

    const flattenTree = tree => {
        const items = [];
        const walk = nodes => {
            for (let i = 0, l = nodes.length; i < l; i++) {
                const node = nodes[i];
                if (node.children)
                    walk(node.children);
                else if (node.url)
                    items.push({ id: node.id, title: node.title || '', url: node.url });
            }
        };
        walk(tree || []);
        return items;
    };

    // Rows of the result set: cached verdicts joined against the live tree
    // (a bookmark deleted after the scan simply drops out), filtered by the
    // three-state segment. `blocked` rows carry ok:false, so collectDead's
    // semantics cover them.
    const resultRows = () => {
        if (!lastScan || !lastScan.results)
            return [];
        const items = [];
        const results = new Map();
        for (const [id, r] of Object.entries(lastScan.results)) {
            const item = treeItems.get(id);
            if (!item)
                continue;
            const result = {
                status: r.status,
                ok: r.status === 'ok' || r.status === 'skipped',
                code: r.code,
                error: r.error
            };
            if (!result.ok) {
                items.push(item);
                results.set(id, result);
            }
        }
        const rows = collectDead(items, results).map(item => ({
            item,
            result: results.get(item.id)
        }));
        if (filter === 'all')
            return rows;
        return rows.filter(row => row.result.status === filter);
    };

    // --- Rendering --------------------------------------------------------------
    const renderToolbar = () => {
        let html = '<div class="dead-toolbar">';
        if (scan) {
            html += `<progress class="dead-progress" value="${scanProgress}" max="${Math.max(scanTotal, 1)}"></progress>` +
                `<span class="dead-progress-label">${_m('deadChecking', [`${scanProgress}`, `${scanTotal}`])}</span>` +
                `<button class="dead-cancel">${_m('nope')}</button>`;
        } else {
            if (lastScan) {
                const time = new Date(lastScan.ts).toLocaleString();
                html += `<span class="dead-last">${_m('deadLastScanAt', time)} · ${lastScan.scannedCount}</span>` +
                    `<button class="dead-rescan">${_m('deadRescan')}</button>`;
            }
            const rows = resultRows();
            if (lastScan && rows.length) {
                html += '<span class="dead-filter" role="group">';
                for (const [value, key] of [['all', 'deadFilterAll'], ['dead', 'deadFilterDead'], ['blocked', 'deadFilterBlocked']])
                    html += `<button class="dead-filter-btn${filter === value ? ' active' : ''}" data-filter="${value}">${_m(key)}</button>`;
                html += '</span>';
                html += `<button class="dead-mark-all">${_m('deadMarkAll')}</button>`;
            }
            if (deadMarks.size)
                html += `<button class="dead-unmark-all">${_m('deadUnmarkAll')}</button>`;
        }
        html += '</div>';
        return html;
    };

    const render = () => {
        let html = renderToolbar();
        if (!scan) {
            if (!lastScan) {
                // §3.5: the empty state itself is the executable start row.
                html += `<ul role="list"><li class="empty-state dead-start" role="listitem" tabindex="0">` +
                    `<i>${_m('deadStartHint', `${scanTotal || treeItems.size}`)}</i></li></ul>`;
            } else {
                const rows = resultRows();
                if (!rows.length) {
                    html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('deadNone')}</i></li></ul>`;
                } else {
                    html += '<ul role="list">';
                    for (let i = 0, l = rows.length; i < l; i++) {
                        const { item, result } = rows[i];
                        const blocked = result.status === 'blocked';
                        const path = views.pathOf(item.id);
                        const marked = deadMarks.has(item.id);
                        html += `<li class="vbm-row" id="dead-item-${item.id}" role="listitem" ` +
                            `data-node-id="${item.id}">` +
                            treeRender.generateBookmarkHTML(item.title, item.url, 'data-virtual="1"', item.id, null, {
                                path,
                                rightText: path,
                                subText: path,
                                badge: {
                                    // statusLabel expects the direct channel's
                                    // raw verdict (numeric / 'error'+name)
                                    text: blocked ? _m('deadStatusBlocked')
                                        : statusLabel({ status: result.code, ok: false, error: result.error }),
                                    cls: blocked ? 'blocked' : 'dead'
                                }
                            }) +
                            `<button class="row-btn dead-mark-btn${marked ? ' marked' : ''}" ` +
                            `aria-label="${marked ? _m('deadUnmark') : _m('deadMark')}" ` +
                            `title="${marked ? _m('deadUnmark') : _m('deadMark')}">⚑</button>` +
                            `<button class="row-btn dead-del-btn" aria-label="${_m('rowActionDelete')}" ` +
                            `title="${_m('rowActionDelete')}">×</button>` +
                            '</li>';
                    }
                    html += '</ul>';
                }
            }
        }
        $list.innerHTML = html;
    };

    // --- Overlay (§5.5c) -----------------------------------------------------------
    // Every list view's rows: dead-marked ids get a red × on the favicon's
    // top-right corner (sync dots own the bottom-right). Idempotent — safe
    // to call after every tree rebuild / mark change.
    const LISTS = ['tree', 'results', 'recent-list'];
    const rowIdOf = li =>
        (li.dataset && li.dataset.nodeId) ||
        li.id.replace(/^(neat-tree|neat-recent|results|recent|dead|dupes)-item-/, '');
    const refreshOverlays = () => {
        for (const listId of LISTS) {
            const list = $(listId);
            if (!list || !list.querySelectorAll)
                continue;
            const lis = list.querySelectorAll('li');
            for (let i = 0, l = lis.length; i < l; i++) {
                const li = lis[i];
                const fav = li.querySelector ? li.querySelector('.favicon-container') : null;
                if (!fav)
                    continue;
                const existing = fav.querySelector('.dead-indicator');
                if (deadMarks.has(rowIdOf(li))) {
                    if (!existing) {
                        const span = document.createElement('span');
                        span.className = 'dead-indicator';
                        span.textContent = '×';
                        fav.appendChild(span);
                    }
                } else if (existing && existing.parentNode) {
                    existing.parentNode.removeChild(existing);
                }
            }
        }
    };

    // --- Marks ------------------------------------------------------------------
    const isMarked = id => deadMarks.has(id);

    const toggleMark = id => {
        if (!id)
            return;
        if (deadMarks.has(id))
            deadMarks.delete(id);
        else
            deadMarks.add(id);
        persistMarks();
        refreshOverlays();
        if (views.isActive('dead'))
            render();
    };

    const markAll = () => {
        const rows = resultRows();
        if (!rows.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('deadMarkAll'),
            button1: `<strong>${_m('deadMarkAll')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                for (const { item } of rows)
                    deadMarks.add(item.id);
                persistMarks();
                refreshOverlays();
                undo.showToast(_m('deadMarked'));
                if (views.isActive('dead'))
                    render();
            }
        });
    };

    const unmarkAll = () => {
        if (!deadMarks.size)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('deadUnmarkAll'),
            button1: `<strong>${_m('deadUnmarkAll')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                deadMarks.clear();
                persistMarks();
                refreshOverlays();
                if (views.isActive('dead'))
                    render();
            }
        });
    };

    // --- Scan (§5.5b/§5.5d) ---------------------------------------------------------
    const startScan = () => {
        if (scan)
            return;
        const settings = scanSettings();
        chrome.bookmarks.getTree(tree => {
            const items = scannableItems(tree);
            treeItems = new Map(items.map(item => [item.id, item]));
            scanProgress = 0;
            scanTotal = items.length;
            scan = startDeadScan(items, {
                concurrency: settings.concurrency,
                timeoutMs: settings.timeoutMs,
                checker: (url, o) => checkUrlDual(url, { ...o, proxyTemplate: settings.proxyTemplate }),
                onProgress: done => {
                    scanProgress = done;
                    if (views.isActive('dead'))
                        render(); // progress line repaint (inactive: closure keeps it)
                }
            });
            // render only after `scan` is set — the toolbar's progress row
            // keys off it
            if (views.isActive('dead'))
                render();
            scan.promise.then(results => {
                scan = null;
                const plain = {};
                results.forEach((r, id) => {
                    plain[id] = { status: r.status, code: r.code, error: r.error };
                });
                lastScan = { ts: Date.now(), scannedCount: items.length, results: plain };
                store.set('deadLastScan', JSON.stringify(lastScan));
                // §5.5c: ids that came back healthy lose their mark
                let pruned = false;
                results.forEach((r, id) => {
                    if ((r.status === 'ok' || r.status === 'skipped') && deadMarks.delete(id))
                        pruned = true;
                });
                if (pruned)
                    persistMarks();
                refreshOverlays();
                if (views.isActive('dead'))
                    render();
            });
        });
    };

    // Popup close aborts the in-flight scan; the persisted cache survives.
    window.addEventListener('pagehide', () => {
        if (scan)
            scan.abort();
    });

    // --- Events ------------------------------------------------------------------
    // Prune marks of removed bookmarks; path changes may reshuffle rows.
    chrome.bookmarks.onRemoved.addListener(id => {
        if (deadMarks.delete(id)) {
            persistMarks();
            refreshOverlays();
        }
    });
    let refreshTimer = null;
    const scheduleRender = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            if (views.isActive('dead') && lastScan && !scan) {
                // re-join against the live tree, then repaint
                chrome.bookmarks.getTree(t => {
                    treeItems = new Map(scannableItems(t).map(item => [item.id, item]));
                    render();
                });
            }
        }, 300);
    };
    chrome.bookmarks.onRemoved.addListener(scheduleRender);
    chrome.bookmarks.onChanged.addListener(scheduleRender);
    chrome.bookmarks.onMoved.addListener(scheduleRender);

    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        if (closest('.dead-start') || closest('.dead-rescan')) {
            e.preventDefault();
            startScan();
            return;
        }
        if (closest('.dead-cancel')) {
            e.preventDefault();
            if (scan) {
                scan.abort();
                scan = null;
                render();
            }
            return;
        }
        const filterBtn = closest('.dead-filter-btn');
        if (filterBtn) {
            e.preventDefault();
            filter = filterBtn.dataset.filter || 'all';
            render();
            return;
        }
        if (closest('.dead-mark-all')) {
            e.preventDefault();
            markAll();
            return;
        }
        if (closest('.dead-unmark-all')) {
            e.preventDefault();
            unmarkAll();
            return;
        }
        const markBtn = closest('.dead-mark-btn');
        if (markBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = markBtn.closest('li');
            toggleMark(li && li.dataset.nodeId);
            return;
        }
        const delBtn = closest('.dead-del-btn');
        if (delBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = delBtn.closest('li');
            const id = li && li.dataset.nodeId;
            if (id)
                actions.deleteBookmark(id);
            return;
        }
        // plain row clicks open the bookmark like the tree does
        treeView.bookmarkHandler(e);
    });
    $list.addEventListener('auxclick', treeView.bookmarkHandler);

    // The executable empty state runs on Enter/Space too.
    $list.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ')
            return;
        const start = e.target && e.target.classList && e.target.classList.contains('dead-start');
        if (start) {
            e.preventDefault();
            e.stopPropagation();
            startScan();
        }
    }, true);

    // M — toggle the focused row's dead mark; R — reveal it in the tree
    // (docs/v4task-2-list.md §3.5). Consumed by keyboard.js before the
    // type-ahead gate; dead registers typeAhead:false.
    const onKey = e => {
        const k = e.key;
        if (k !== 'm' && k !== 'M' && k !== 'r' && k !== 'R')
            return false;
        const item = document.activeElement;
        const li = item && item.closest ? item.closest('[data-node-id]') : null;
        const id = li && li.dataset.nodeId;
        if (!id)
            return false;
        e.preventDefault();
        if (k === 'm' || k === 'M')
            toggleMark(id);
        else
            treeView.revealInTree(id);
        return true;
    };

    views.register({
        id: 'dead',
        titleKey: 'viewDead',
        icon: VIEW_ICONS.dead,
        container: $('view-dead'),
        listEl: $list,
        typeAhead: false,
        badge: () => deadMarks.size,
        activate: () => {
            loadCache();
            // the first entry builds the tree-item map the rows join against
            chrome.bookmarks.getTree(t => {
                treeItems = new Map(scannableItems(t).map(item => [item.id, item]));
                render();
            });
        },
        // §5.5d: Escape aborts the scan (and is consumed then); otherwise the
        // view-manager's own layering (back to tree) applies.
        onEscape: () => {
            if (scan) {
                scan.abort();
                scan = null;
                if (views.isActive('dead'))
                    render();
                return true;
            }
            return false;
        },
        onKey
    });

    return { refresh: render, refreshOverlays, isMarked, toggleMark };
}
