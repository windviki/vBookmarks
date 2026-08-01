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
 * §5.5b dual channel: every URL goes through dead-links.js's checkUrlDual —
 * direct failure + proxy reachability means `blocked` (region-limited, not
 * dead), rendered with the amber badge; both channels failing confirms
 * `dead`. The second channel is the user's own proxy server when
 * `deadProxyServer` is set (marker-PAC session, see dead-proxy.js: the scan
 * installs a PAC routing only marker-tagged probe URLs through the proxy,
 * so direct and proxied checks run concurrently and no other tab's traffic
 * is touched), else the legacy `deadProxyTemplate` relay (empty = direct
 * only). `deadScanConcurrency` (default 4) and `deadScanTimeout` (default
 * 8s) tune the pool.
 *
 * Proxy strip (post-v4): a `.dead-proxy-strip` row above the toolbar gives
 * one-click proxy management — no server: an add button (plus a nudge when
 * a finished scan has direct-failing rows and no proxy at all); a saved
 * server: a chip + change/remove. The inline add panel validates the
 * address, requests the optional `proxy` permission inside the click
 * gesture (Chrome's native confirmation, the stats view's history
 * pattern), refuses servers another extension controls, probes
 * reachability and persists ONLY a reachable one (`deadProxyServer`, the
 * same key the options page displays/clears). Scan start installs the PAC
 * session through the permission/controllability gate (failures degrade to
 * direct+template and are remembered on the chip); settle/cancel/pagehide
 * all tear it down, and a `vbmProxySession` storage.session marker lets
 * the service worker sweep crash residue. The strip's controls disable
 * mid-scan so the test never clobbers a live session; Esc closes the panel
 * before the selection/scan layers. The idle toolbar also quantifies the
 * result set (dead N · blocked M) ahead of the filter segments.
 *
 * §5.5c marks: `deadMarks` (id array) toggle per row (⚑ button / M key);
 * every list (tree / search results / recent / stats / dupes) overlays a
 * red × on the favicon's top-right corner via refreshOverlays() (sync dots
 * sit on the bottom-right, so they never collide). Each list module calls
 * its onRowsRendered ctx hook after rendering (tree: onTreeGenerated,
 * fired after the innerHTML swap) — neat.js wires them all here (第五轮
 * 项3). Marks prune on bookmark removal, and ids that came back
 * ok/skipped after a rescan drop out automatically. Batch "mark all"
 * (every dead+blocked row of the result set) and "clear all marks" are
 * ConfirmDialog-gated. badge() = deadMarks.length.
 *
 * §5.5d lifecycle (+ fourth-round item 10): switching views mid-scan never
 * aborts (the closure owns the session; coming back re-renders the live
 * progress/pause state); Esc toggles pause ⇄ resume while a session lives
 * (item 10 — the old Esc-abort moved to an explicit toolbar Cancel);
 * pagehide cancels — the cache is already on disk. Row deletion rides
 * actions.deleteBookmark (the undo chain).
 *
 * Item 10 scan state machine (see "Scan" section):
 *   idle       — no live session; toolbar = last-scan info / empty, list =
 *                cached results or the executable start hint.
 *   scanning   — the pool dispatches probes; the list GROWS INCREMENTALLY:
 *                every settled dead/blocked check joins the rows at once
 *                (tree order among settled rows — a row never jumps once
 *                shown); toolbar = progress + count + Pause + Cancel.
 *   paused     — pause(): no NEW probes are dispatched, in-flight ones
 *                still land in the partial results; toolbar swaps Pause for
 *                Resume and tags the progress label; Esc resumes.
 *   cancelling — Cancel: in-flight probes abort, the promise settles with
 *                the partial Map which is DISCARDED (the run never happened)
 *                and the view falls back to the previous persisted cache
 *                (or the start hint) — the last finished scan is the only
 *                checkpoint. Rescan from idle starts a fresh session.
 *
 * The filter (all / dead only / blocked only) is an in-memory view control,
 * deliberately not persisted (§5.5c).
 *
 * Selection mode (v4 task-3 #4): the idle toolbar's 选择 button swaps every
 * idle control for a batch bar — select all / invert / clear (over the
 * filtered rows), mark selected / unmark selected (one batch, no confirm —
 * the explicit selection is the confirmation) and exit. Row clicks toggle
 * membership instead of opening (the ⚑/× buttons are CSS-hidden), Esc
 * leaves the mode, and members that vanish mid-mode (tree change, filter)
 * are pruned at render.
 *
 * initViewDead(ctx) is called once by neat.js after treeView init.
 * ctx.store            — settings mirror (deadMarks/deadLastScan/deadProxyTemplate/
 *                        deadProxyServer/deadScanConcurrency/deadScanTimeout/showDeadView)
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

import { checkUrlDual, startPausableScan, filterScannable, collectDead, statusLabel } from './dead-links.js';
import { parseProxyServer, formatProxyServer, DEFAULT_PROXY_TEST_URL, proxyPermission, requestProxyPermission, proxyControllable, startProxySession, endProxySession, testProxyReachable } from './dead-proxy.js';
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
    // Item 10 state machine (idle/scanning/paused/cancelling, header docs):
    // `scan` non-null covers scanning+paused (scan.isPaused() splits them);
    // cancelling is scan→null inside cancelScan before the promise settles.
    let scan = null;        // live startPausableScan session
    let scanStarting = false; // getTree + proxy-gate window before `scan` exists
    let scanProgress = 0;   // settled checks of the running scan
    let scanTotal = 0;      // item count of the running scan
    let scanItems = [];     // scan order (= tree order) for progressive rows
    let scanResults = null; // Map(id → result) settled so far (progressive)
    let lastScan = null;    // { ts, scannedCount, results: {id:{status,code}} }
    let treeItems = new Map(); // id → { id, title, url } of the last render
    let filter = 'all';     // 'all' | 'dead' | 'blocked' — in-memory (§5.5c)
    // v4 task-3 #4 selection mode: the toolbar's 选择 button swaps the idle
    // controls for a batch bar (all/invert/clear + mark/unmark selected);
    // row clicks toggle membership instead of opening, Esc exits. Members
    // are bookmark ids, pruned at render against rows that still exist.
    let selecting = false;
    const selected = new Set();

    // Real-proxy support (dead-proxy.js): the quick add/manage strip above
    // the scan toolbar. proxyPanelOpen toggles the inline add panel;
    // proxyInput/proxyTestUrl mirror the panel's fields across re-renders
    // (the innerHTML swap would otherwise eat them); proxyBusy locks the
    // panel while the permission/test chain runs; proxyError is the panel's
    // failure line; proxyGateError records WHY the last scan could not use
    // the configured server (permission denied / another extension owns the
    // proxy settings) so the chip can surface it.
    let proxyPanelOpen = false;
    let proxyInput = '';
    let proxyTestUrl = DEFAULT_PROXY_TEST_URL;
    let proxyBusy = false;
    let proxyError = '';
    let proxyGateError = '';     // '' | i18n key
    let proxyTestGen = 0;        // stale-test guard: bumped on open/close
    let proxySessionActive = false; // this popup installed the marker-PAC

    const persistMarks = () => {
        store.set('deadMarks', JSON.stringify([...deadMarks]));
        // The tab badge is the marks count — keep it in sync on every
        // mutation (toggle/mark-all/clear/scan prune/onRemoved prune).
        views.updateBadges();
    };

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
        proxyServer: proxyServerSetting(),
        concurrency: Math.min(16, Math.max(1, parseInt(store.get('deadScanConcurrency', '4'), 10) || 4)),
        timeoutMs: Math.min(30, Math.max(2, parseInt(store.get('deadScanTimeout', '8'), 10) || 8)) * 1000
    });

    // The configured real proxy server (dead-proxy.js), canonical
    // 'scheme://host:port' in storage; null when unset/invalid.
    const proxyServerSetting = () => parseProxyServer(store.get('deadProxyServer', '') || '');

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
    // (a bookmark deleted after the scan simply drops out). `blocked` rows
    // carry ok:false, so collectDead's semantics cover them. This is the
    // UNFILTERED set — the toolbar keys off it so the filter segment stays
    // reachable even when the active filter matches nothing (otherwise
    // "blocked only" with zero blocked rows would hide the way back).
    const allResultRows = () => {
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
        return collectDead(items, results).map(item => ({
            item,
            result: results.get(item.id)
        }));
    };

    // …and the three-state segment on top of it.
    const resultRows = () => {
        const rows = allResultRows();
        if (filter === 'all')
            return rows;
        return rows.filter(row => row.result.status === filter);
    };

    // Item 10 progressive rows: the live session's settled checks, in scan
    // order (= tree order), so a row's position is stable once it appears.
    // The filter segment is a finished-result control and is NOT applied
    // here — mid-scan every discovered dead/blocked row shows up at once.
    const liveRows = () => {
        const rows = [];
        for (let i = 0, l = scanItems.length; i < l; i++) {
            const item = scanItems[i];
            const result = scanResults && scanResults.get(item.id);
            if (result && !result.ok)
                rows.push({ item, result });
        }
        return rows;
    };

    // --- Proxy strip (dead-proxy.js quick add/manage) -------------------------
    // Sits above the scan toolbar in every state (idle/scanning/selecting);
    // its controls disable mid-scan so a reachability test can never clobber
    // the running scan's PAC session. Carries .vbm-toolbar so keyboard.js's
    // Tab cycle picks the controls up like the main toolbar's.
    const renderProxyStrip = () => {
        const server = proxyServerSetting();
        const template = store.get('deadProxyTemplate', '') || '';
        let html = '<div class="dead-proxy-strip vbm-toolbar">';
        if (proxyPanelOpen) {
            html += `<span class="dead-proxy-hint">${_m('deadProxyPanelHint')}</span>` +
                `<input type="text" class="dead-proxy-input" value="${htmlspecialchars(proxyInput)}" ` +
                `placeholder="127.0.0.1:7890" spellcheck="false" aria-label="${_m('deadProxyAdd')}"${proxyBusy ? ' disabled' : ''}>` +
                `<input type="text" class="dead-proxy-testurl" value="${htmlspecialchars(proxyTestUrl)}" ` +
                `spellcheck="false" aria-label="${_m('deadProxyTestUrlLabel')}" title="${_m('deadProxyTestUrlLabel')}"${proxyBusy ? ' disabled' : ''}>` +
                `<button class="dead-proxy-save"${proxyBusy ? ' disabled' : ''}>${_m(proxyBusy ? 'deadProxyTesting' : 'deadProxyTestSave')}</button>` +
                `<button class="dead-proxy-cancel"${proxyBusy ? ' disabled' : ''}>${_m('deadCancel')}</button>` +
                (proxyError ? `<span class="dead-proxy-error">${proxyError}</span>` : '');
        } else if (server) {
            html += `<span class="dead-proxy-chip">${_m('deadProxyLabel', htmlspecialchars(formatProxyServer(server)))}</span>` +
                (proxyGateError ? `<span class="dead-proxy-error">${_m(proxyGateError)}</span>` : '') +
                `<button class="dead-proxy-change"${scan ? ' disabled' : ''}>${_m('deadProxyChange')}</button>` +
                `<button class="dead-proxy-remove"${scan ? ' disabled' : ''}>${_m('deadProxyRemove')}</button>`;
        } else {
            if (template)
                html += `<span class="dead-proxy-chip template">${_m('deadProxyTemplateChip')}</span>`;
            html += `<button class="dead-proxy-add"${scan ? ' disabled' : ''}>${_m('deadProxyAdd')}</button>`;
            // The nudge ties the original dual-channel design to the quick
            // button: direct-failing rows may be region-blocks, not dead.
            const deadN = !scan && !template && lastScan
                ? allResultRows().filter(r => r.result.status === 'dead').length
                : 0;
            if (deadN)
                html += `<span class="dead-proxy-nudge">${_m('deadProxyNudge', `${deadN}`)}</span>`;
        }
        return html + '</div>';
    };

    // --- Rendering --------------------------------------------------------------
    const renderToolbar = () => {
        // vbm-toolbar: keyboard.js's Tab cycle picks the controls up as
        // stops between the tab strip and the list rows (final polish).
        let html = '<div class="dead-toolbar vbm-toolbar">';
        if (scan) {
            // scanning/paused share the toolbar; the toggle button and the
            // paused tag split them. Real <button>s: Tab-reachable and
            // Enter/Space-fireable like the other dead-toolbar controls.
            const paused = scan.isPaused();
            html += `<progress class="dead-progress" value="${scanProgress}" max="${Math.max(scanTotal, 1)}"></progress>` +
                (paused ? `<span class="dead-paused-tag">${_m('deadPaused')}</span>` : '') +
                `<span class="dead-progress-label">${_m('deadChecking', [`${scanProgress}`, `${scanTotal}`])}</span>` +
                `<button class="dead-pause">${_m(paused ? 'deadResume' : 'deadPause')}</button>` +
                `<button class="dead-cancel">${_m('deadCancel')}</button>`;
        } else {
            if (selecting) {
                // v4 task-3 #4: the batch bar replaces every idle control
                // while the mode is on — the scan/filter buttons come back
                // on exit. Action buttons disable on an empty selection.
                html += `<span class="select-count">${_m('selectCount', `${selected.size}`)}</span>` +
                    `<button class="dead-select-all">${_m('selectAll')}</button>` +
                    `<button class="dead-select-invert">${_m('selectInvert')}</button>` +
                    `<button class="dead-select-clear">${_m('selectClear')}</button>` +
                    `<button class="dead-mark-selected"${selected.size ? '' : ' disabled'}>${_m('deadMarkSelected')}</button>` +
                    `<button class="dead-unmark-selected"${selected.size ? '' : ' disabled'}>${_m('deadUnmarkSelected')}</button>` +
                    `<button class="dead-select-exit">${_m('selectModeExit')}</button>`;
                html += '</div>';
                return html;
            }
            if (lastScan) {
                const time = new Date(lastScan.ts).toLocaleString();
                html += `<span class="dead-last">${_m('deadLastScanAt', time)} · ${lastScan.scannedCount}</span>` +
                    `<button class="dead-rescan">${_m('deadRescan')}</button>`;
            }
            const rows = allResultRows();
            if (lastScan && rows.length) {
                // Quantify the two situations up front (死链 vs 区域受限) so
                // the filter segments below read as batch-workspace scopes,
                // not mysteries.
                const deadN = rows.filter(r => r.result.status === 'dead').length;
                html += `<span class="dead-summary">${_m('deadSummary', [`${deadN}`, `${rows.length - deadN}`])}</span>`;
                html += '<span class="dead-filter" role="group">';
                for (const [value, key] of [['all', 'deadFilterAll'], ['dead', 'deadFilterDead'], ['blocked', 'deadFilterBlocked']])
                    html += `<button class="dead-filter-btn${filter === value ? ' active' : ''}" data-filter="${value}">${_m(key)}</button>`;
                html += '</span>';
                html += `<button class="dead-mark-all">${_m('deadMarkAll')}</button>`;
            }
            if (deadMarks.size)
                html += `<button class="dead-unmark-all">${_m('deadUnmarkAll')}</button>`;
            // v4 task-3 #4: selection mode entry — only with results on screen
            if (lastScan && allResultRows().length)
                html += `<button class="dead-select-mode">${_m('selectModeEnter')}</button>`;
        }
        html += '</div>';
        return html;
    };

    // One <ul> of result rows — shared by the cached result set and the
    // progressive mid-scan list (same row markup, same buttons).
    const renderRows = rows => {
        let html = `<ul role="list"${selecting ? ' class="selecting"' : ''}>`;
        for (let i = 0, l = rows.length; i < l; i++) {
            const { item, result } = rows[i];
            const blocked = result.status === 'blocked';
            const path = views.pathOf(item.id);
            const marked = deadMarks.has(item.id);
            const sel = selecting && selected.has(item.id);
            html += `<li class="vbm-row${sel ? ' sel' : ''}" id="dead-item-${item.id}" role="listitem" ` +
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
        return html + '</ul>';
    };

    // --- Toolbar focus restore (final polish) --------------------------------
    // The toolbar re-renders together with the rows (filter clicks, pause/
    // resume, every scan-progress tick). Without a restore, a keyboard user
    // holding focus on a control loses it to <body> on every repaint. The
    // controls are positionally stable across re-renders, so an index
    // suffices.
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
        if (selecting) {
            // prune members whose rows vanished (tree change / filter) BEFORE
            // the toolbar reads selected.size for its count
            const alive = new Set(resultRows().map(r => r.item.id));
            for (const id of [...selected])
                if (!alive.has(id))
                    selected.delete(id);
        }
        let html = renderProxyStrip() + renderToolbar();
        if (scan) {
            // Item 10: progressive rendering — settled dead/blocked checks
            // are already rows while the scan keeps running.
            html += renderRows(liveRows());
        } else if (!lastScan) {
            // §3.5: the empty state itself is the executable start row.
            html += `<ul role="list"><li class="empty-state dead-start" role="listitem" tabindex="-1">` +
                `<i>${_m('deadStartHint', `${scanTotal || treeItems.size}`)}</i></li></ul>`;
        } else {
            const rows = resultRows();
            // Distinguish "the scan found nothing" from "the active filter
            // matches nothing" — the latter tells the user the other
            // segments (still visible above) are where the rows went.
            html += rows.length
                ? renderRows(rows)
                : `<ul role="list"><li class="empty-state" role="listitem"><i>${_m(filter !== 'all' && allResultRows().length ? 'deadNoneFiltered' : 'deadNone')}</i></li></ul>`;
        }
        // keep a focused toolbar control focused across the swap (see above)
        const tbIdx = toolbarFocusIndex();
        $list.innerHTML = html;
        restoreToolbarFocus(tbIdx);
    };

    // --- Overlay (§5.5c + 第五轮项3) ------------------------------------------
    // Every list view's rows: dead-marked ids get a red × on the favicon's
    // top-right corner (sync dots own the bottom-right). Idempotent — safe
    // to call after every tree rebuild / mark change. Each list module
    // re-lays the overlays after its own render through the onRowsRendered
    // ctx hook (neat.js wires them all to this function); the tree goes
    // through onTreeGenerated, which tree-view fires AFTER the innerHTML
    // swap (item 3's first-paint fix).
    const LISTS = ['tree', 'results', 'recent-list', 'dupes-list', 'stats-list'];
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

    // --- Selection mode (v4 task-3 #4) -----------------------------------------
    const setSelecting = on => {
        selecting = on;
        if (!on)
            selected.clear();
        render();
    };

    // Mark / unmark every selected row in one batch (no ConfirmDialog — the
    // explicit selection is the confirmation, and the action is reversible).
    const markSelected = mark => {
        if (!selected.size)
            return;
        for (const id of selected) {
            if (mark)
                deadMarks.add(id);
            else
                deadMarks.delete(id);
        }
        persistMarks();
        refreshOverlays();
        if (mark)
            undo.showToast(_m('deadMarked'));
        render();
    };

    // --- Proxy panel + session (dead-proxy.js) --------------------------------
    // The panel opens empty (add) or prefilled (change); input events keep
    // proxyInput/proxyTestUrl in sync WITHOUT re-rendering — an innerHTML
    // swap per keystroke would destroy focus and selection.
    const openProxyPanel = prefill => {
        proxyPanelOpen = true;
        proxyBusy = false;
        proxyError = '';
        proxyInput = prefill || '';
        proxyTestUrl = DEFAULT_PROXY_TEST_URL;
        proxyTestGen++;
        render();
        const input = typeof $list.querySelector === 'function' ? $list.querySelector('.dead-proxy-input') : null;
        if (input && input.focus)
            input.focus();
    };

    const closeProxyPanel = () => {
        if (!proxyPanelOpen)
            return;
        proxyPanelOpen = false;
        proxyBusy = false;
        proxyError = '';
        proxyTestGen++; // a test still in flight must no longer save
        render();
    };

    const removeProxy = () => {
        store.remove('deadProxyServer');
        proxyGateError = '';
        undo.showToast(_m('deadProxyRemoved'));
        render();
    };

    // Test & save: parse → permission (the click's user gesture carries
    // Chrome's native confirmation, same contract as the stats view's
    // history Enable link) → controllability → reachability. Only a
    // REACHABLE server is persisted (to the same store key the options page
    // displays); every failure keeps the panel open with its reason.
    const saveProxy = () => {
        const server = parseProxyServer(proxyInput);
        if (!server) {
            proxyError = _m('deadProxyInvalid');
            render();
            return;
        }
        const gen = ++proxyTestGen;
        proxyBusy = true;
        proxyError = '';
        render();
        const fail = key => {
            if (gen !== proxyTestGen)
                return; // panel closed/reopened mid-flight — drop the result
            proxyBusy = false;
            proxyError = _m(key);
            render();
        };
        requestProxyPermission().then(granted => {
            if (gen !== proxyTestGen)
                return;
            if (!granted)
                return fail('deadProxyDenied');
            return proxyControllable().then(control => {
                if (gen !== proxyTestGen)
                    return;
                if (control !== 'ok')
                    return fail(control === 'other-extension' ? 'deadProxyControlled' : 'deadProxyUnavailable');
                const testUrl = (proxyTestUrl || '').trim() || DEFAULT_PROXY_TEST_URL;
                return testProxyReachable(server, { testUrl, timeoutMs: scanSettings().timeoutMs }).then(reachable => {
                    if (gen !== proxyTestGen)
                        return;
                    if (!reachable)
                        return fail('deadProxyUnreachable');
                    store.set('deadProxyServer', formatProxyServer(server));
                    proxyPanelOpen = false;
                    proxyBusy = false;
                    proxyGateError = '';
                    undo.showToast(_m('deadProxySaved'));
                    render();
                });
            });
        });
    };

    // Marker-PAC session for a scan: permission → controllability → install.
    // Resolves true only with the PAC live; a failure is remembered in
    // proxyGateError (the chip shows it) and the scan degrades to
    // direct(+template)-only instead of failing.
    const startScanProxy = server =>
        proxyPermission().then(have => {
            if (!have) {
                proxyGateError = 'deadProxyDenied';
                return false;
            }
            return proxyControllable().then(control => {
                if (control !== 'ok') {
                    proxyGateError = control === 'other-extension' ? 'deadProxyControlled' : 'deadProxyUnavailable';
                    return false;
                }
                return startProxySession(server).then(started => {
                    if (!started) {
                        proxyGateError = 'deadProxyControlled';
                        return false;
                    }
                    proxyGateError = '';
                    proxySessionActive = true;
                    // Crash-residue marker: the SW sweeps a leftover PAC when
                    // no live session marker exists (src/background.js).
                    if (chrome.storage && chrome.storage.session)
                        chrome.storage.session.set({ vbmProxySession: Date.now() });
                    return true;
                });
            });
        });

    // Every scan exit path (settle / cancel / pagehide) funnels here — the
    // PAC must not outlive its scan (clear() removes only OUR settings, so
    // this is also safe when something else took control in between).
    const stopProxySession = () => {
        if (!proxySessionActive)
            return;
        proxySessionActive = false;
        endProxySession();
        if (chrome.storage && chrome.storage.session)
            chrome.storage.session.remove('vbmProxySession');
    };

    // --- Scan (§5.5b/§5.5d + item 10 state machine) -----------------------------
    const startScan = () => {
        if (scan || scanStarting)
            return;
        scanStarting = true;
        // A scan installs its own PAC session — an open add panel's test
        // would clobber it, so the panel goes first.
        closeProxyPanel();
        const settings = scanSettings();
        chrome.bookmarks.getTree(tree => {
            const items = scannableItems(tree);
            treeItems = new Map(items.map(item => [item.id, item]));
            scanProgress = 0;
            scanTotal = items.length;
            scanItems = items;
            scanResults = new Map();
            const launch = proxyActive => {
                scanStarting = false;
                const session = startPausableScan(items, {
                    concurrency: settings.concurrency,
                    timeoutMs: settings.timeoutMs,
                    checker: (url, o) => checkUrlDual(url, { ...o, proxyTemplate: settings.proxyTemplate, proxyServer: proxyActive }),
                    onResult: (id, result, done) => {
                        // Progressive rendering: every settled check lands in the
                        // partial Map and repaints at once (inactive view: the
                        // closure keeps the state, activate() re-renders it).
                        scanResults.set(id, result);
                        scanProgress = done;
                        if (views.isActive('dead'))
                            render();
                    }
                });
                scan = session;
                // render only after `scan` is set — the toolbar's progress row
                // keys off it
                if (views.isActive('dead'))
                    render();
                session.promise.then(results => {
                    // Settled after cancelScan dropped the session (or a newer
                    // scan replaced it): the partial Map is discarded — cancel
                    // means "the run never happened" (item 10 semantics).
                    if (scan !== session)
                        return;
                    scan = null;
                    scanItems = [];
                    scanResults = null;
                    stopProxySession();
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
            };
            // The real proxy server wins over the legacy relay template when
            // both are configured (dead-links.js applies the same priority).
            if (settings.proxyServer)
                startScanProxy(settings.proxyServer).then(launch);
            else
                launch(false);
        });
    };

    // Cancel (item 10): abort in-flight probes, drop the session and its
    // partial results, fall back to the previous persisted cache (or the
    // start hint). The settle handler sees scan!==session and stays out.
    const cancelScan = () => {
        if (!scan)
            return;
        const session = scan;
        scan = null;
        scanItems = [];
        scanResults = null;
        session.cancel();
        stopProxySession();
        if (views.isActive('dead'))
            render();
    };

    // Popup close cancels the in-flight scan; the persisted cache survives.
    window.addEventListener('pagehide', () => {
        if (scan)
            cancelScan();
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
        const pauseBtn = closest('.dead-pause');
        if (pauseBtn) {
            e.preventDefault();
            if (scan) {
                // Pause ⇄ Resume toggle (same semantics as Esc, item 10).
                if (scan.isPaused())
                    scan.resume();
                else
                    scan.pause();
                render();
            }
            return;
        }
        if (closest('.dead-cancel')) {
            e.preventDefault();
            cancelScan();
            return;
        }
        // --- proxy strip (dead-proxy.js) ---
        if (closest('.dead-proxy-add')) {
            e.preventDefault();
            openProxyPanel('');
            return;
        }
        if (closest('.dead-proxy-change')) {
            e.preventDefault();
            const server = proxyServerSetting();
            openProxyPanel(server ? formatProxyServer(server) : '');
            return;
        }
        if (closest('.dead-proxy-remove')) {
            e.preventDefault();
            removeProxy();
            return;
        }
        if (closest('.dead-proxy-save')) {
            e.preventDefault();
            if (!proxyBusy)
                saveProxy();
            return;
        }
        if (closest('.dead-proxy-cancel')) {
            e.preventDefault();
            closeProxyPanel();
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
        // v4 task-3 #4: selection mode controls + row-toggle clicks
        if (closest('.dead-select-mode')) {
            e.preventDefault();
            setSelecting(true);
            return;
        }
        if (closest('.dead-select-exit')) {
            e.preventDefault();
            setSelecting(false);
            return;
        }
        if (closest('.dead-select-all')) {
            e.preventDefault();
            for (const { item } of resultRows())
                selected.add(item.id);
            render();
            return;
        }
        if (closest('.dead-select-invert')) {
            e.preventDefault();
            for (const { item } of resultRows()) {
                if (selected.has(item.id))
                    selected.delete(item.id);
                else
                    selected.add(item.id);
            }
            render();
            return;
        }
        if (closest('.dead-select-clear')) {
            e.preventDefault();
            selected.clear();
            render();
            return;
        }
        if (closest('.dead-mark-selected')) {
            e.preventDefault();
            markSelected(true);
            return;
        }
        if (closest('.dead-unmark-selected')) {
            e.preventDefault();
            markSelected(false);
            return;
        }
        if (selecting) {
            // Row click toggles membership instead of opening; everything
            // else (row buttons are CSS-hidden) is swallowed.
            const li = closest('li');
            if (li && li.dataset && li.dataset.nodeId) {
                e.preventDefault();
                e.stopPropagation();
                const id = li.dataset.nodeId;
                if (selected.has(id))
                    selected.delete(id);
                else
                    selected.add(id);
                render();
            }
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

    // Proxy panel fields: mirror into state WITHOUT re-rendering (an
    // innerHTML swap per keystroke would destroy focus and selection).
    $list.addEventListener('input', e => {
        const t = e.target;
        if (!t || !t.classList)
            return;
        if (t.classList.contains('dead-proxy-input'))
            proxyInput = t.value;
        else if (t.classList.contains('dead-proxy-testurl'))
            proxyTestUrl = t.value;
    });

    // The executable empty state runs on Enter/Space too.
    $list.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ')
            return;
        const start = e.target && e.target.classList && e.target.classList.contains('dead-start');
        if (start) {
            e.preventDefault();
            e.stopPropagation();
            startScan();
            return;
        }
        // Enter in a proxy panel field = Test & save.
        if (e.key === 'Enter' && proxyPanelOpen && !proxyBusy && e.target && e.target.classList &&
            (e.target.classList.contains('dead-proxy-input') || e.target.classList.contains('dead-proxy-testurl'))) {
            e.preventDefault();
            e.stopPropagation();
            saveProxy();
        }
    }, true);

    // (Final polish superseded the seg-local ←/→ walker: keyboard.js's
    // non-row branch now walks ALL toolbar controls as one rung — a
    // view-local filter-seg walker would double-step.)

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
        hidden: !store.get('showDeadView', '1'), // showDeadView → tab visibility
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
        // §5.5d + item 10: Escape toggles pause ⇄ resume while a scan
        // session lives (consumed both ways) — non-destructive, matching the
        // layered Esc contract (the view consumes Esc only while it holds
        // transient state). Cancelling is the explicit toolbar Cancel.
        onEscape: () => {
            // The proxy add panel is the most transient state — Esc closes
            // it (and voids any in-flight test) before anything else.
            if (proxyPanelOpen) {
                closeProxyPanel();
                return true;
            }
            // v4 task-3 #4: while selecting, Esc leaves the mode (the
            // selection goes with it) — before any scan semantics.
            if (selecting) {
                setSelecting(false);
                return true;
            }
            if (!scan)
                return false;
            if (scan.isPaused())
                scan.resume();
            else
                scan.pause();
            if (views.isActive('dead'))
                render();
            return true;
        },
        onKey
    });

    return { refresh: render, refreshOverlays, isMarked, toggleMark };
}
