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
 * is touched; no server = direct only — the legacy `deadProxyTemplate`
 * relay channel is retired). `deadScanConcurrency` (default 4) and
 * `deadScanTimeout` (default 8s) tune the pool.
 *
 * Proxy strip (post-v4): a `.dead-proxy-strip` row above the toolbar gives
 * one-click proxy management — no server: an add button (plus a nudge when
 * a finished scan has direct-failing rows and no proxy at all) and a
 * "don't show again" hide; a saved server: a chip + change/remove (a saved
 * server always keeps its manage row — only the no-server hint is
 * dismissable, and the options page has a full add/test/clear entry via
 * src/options-proxy.js). The inline add panel validates the address,
 * checks the `proxy` permission (a REQUIRED install-time permission —
 * Chrome refuses proxy as optional — verified via contains, with a request
 * fallback that never prompts when already granted), refuses servers
 * another extension controls, probes reachability and persists ONLY a
 * reachable one (`deadProxyServer`, the same key the options page
 * reads/clears). The PAC session itself is installed by the service worker
 * at scan start (v4 task-4 #16 moved the scan there — see below); its gate
 * failures come back on the live blob's proxy.gate and surface on the
 * chip. The strip's controls disable mid-scan so the test never clobbers a
 * live session; Esc closes the panel before the
 * selection/scan layers. The idle toolbar also quantifies the result set
 * (dead N · blocked M) ahead of the filter segments.
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
 * ConfirmDialog-gated. badge() = the last scan's dead+blocked count (see
 * the badge hook at registration — NOT the marks count).
 *
 * §5.5d lifecycle (v4 task-4 #16 — the scan runs in the service worker):
 * the scan engine lives in src/dead-scan-sw.js so a popup close NEVER
 * interrupts a run. Pages send fire-and-forget messages
 * (vbm-dead-scan-start/pause/resume/cancel); the runner publishes a live
 * blob to chrome.storage.local `vbmDeadScan` ({ state, done, total, ts,
 * items, results, proxy }) and writes the finished run to `deadLastScan`.
 * This view is a pure MIRROR of those two keys: storage.onChanged drives
 * every mid-session repaint (progress ticks, pause transitions, the
 * settle), activate() re-syncs from storage directly, and pause/resume
 * clicks flip the mirror optimistically before the SW's publication
 * confirms them. Esc toggles pause ⇄ resume while a run lives (item 10 —
 * cancelling is the explicit toolbar Cancel). A SW cold start resumes a
 * live run from the blob's journal; a paused run stays paused.
 *
 * Scan state machine (see "Scan" section):
 *   idle       — no live blob; toolbar = last-scan info / empty, list =
 *                cached results or the executable start hint.
 *   scanning   — blob.state 'scanning'; the list GROWS INCREMENTALLY as
 *                the blob's journal fills (tree order among settled rows —
 *                a row never jumps once shown); toolbar = progress + count
 *                + Pause + Cancel.
 *   paused     — blob.state 'paused'; toolbar swaps Pause for Resume and
 *                tags the progress label; Esc resumes.
 *   cancel     — the SW discards the partial run and deletes the blob
 *                (the run never happened); the view falls back to the
 *                previous persisted cache (or the start hint) — the last
 *                finished scan is the only checkpoint.
 *
 * The filter (all / dead only / blocked only) persists as `deadFilter`
 * (v4 task-4 #1 — reopening the view keeps the active segment highlighted,
 * superseding the in-memory choice of §5.5c).
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
 * ctx.store            — settings mirror (deadMarks/deadLastScan/deadProxyServer/
 *                        deadScanConcurrency/deadScanTimeout/showDeadView)
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

import { filterScannable, collectDead, statusLabel } from './dead-links.js';
import { parseProxyServer, formatProxyServer, DEFAULT_PROXY_TEST_URL, proxyPermission, requestProxyPermission, proxyControllable, testProxyReachable } from './dead-proxy.js';
import { DEAD_SCAN_KEY, DEAD_LAST_KEY, DEAD_SCAN_MSG } from './dead-scan-sw.js';
import { VIEW_ICONS, FLAG_ICON, TRASH_ICON } from './icons.js';
import { makeRiskBanner, RISK_HELP_URL } from './risk-banner.js';

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

    // v4 task-4 #14: pre-use risk banner (bulk deletion warning +
    // backup help link); acked per major version, session × dismiss.
    const riskBanner = makeRiskBanner({ store, ackKey: 'deadRiskAck', textKey: 'deadRiskBanner' });

    // --- State ----------------------------------------------------------------
    const loadMarks = () => {
        try {
            return new Set(JSON.parse(store.get('deadMarks', '[]') || '[]'));
        } catch (e) {
            return new Set();
        }
    };
    let deadMarks = loadMarks();
    // v4 task-4 #16 scan mirror (idle/scanning/paused, header docs): the SW
    // owns the run; `live` mirrors the published vbmDeadScan blob while one
    // exists (live.state splits scanning/paused). scanStarting guards the
    // window between the start message and the blob's first publication.
    let live = null;        // { state, done, total, order:[id…], results:Map }
    let scanStarting = false;
    let lastScan = null;    // { ts, scannedCount, results: {id:{status,code}} }
    let treeItems = new Map(); // id → { id, title, url } of the last render
    // v4 task-4 #1: the filter persists (deadFilter) — reopening the view
    // restores the active segment, same contract as the stats view's
    // statsSort (supersedes the in-memory choice of §5.5c).
    let filter = ['all', 'dead', 'blocked'].indexOf(store.get('deadFilter', 'all')) !== -1
        ? store.get('deadFilter', 'all') : 'all';
    // v4 task-3 #4 selection mode: the toolbar's 选择 button swaps the idle
    // controls for a batch bar (all/invert/clear + mark/unmark selected);
    // row clicks toggle membership instead of opening, Esc exits. Members
    // are bookmark ids, pruned at render against rows that still exist.
    let selecting = false;
    const selected = new Set();
    // v4 task-4 #8: select-mode Space toggles the focused row and render()
    // swaps the list — park the row id so focus returns to it afterwards.
    let pendingRowFocus = null;

    // Real-proxy support (dead-proxy.js): the quick add/manage strip above
    // the scan toolbar. proxyPanelOpen toggles the inline add panel;
    // proxyInput/proxyTestUrl mirror the panel's fields across re-renders
    // (the innerHTML swap would otherwise eat them); proxyBusy locks the
    // panel while the permission/test chain runs; proxyError is the panel's
    // failure line; proxyGateError mirrors WHY the running/last scan could
    // not use the configured server (the SW blob's proxy.gate: permission
    // denied / another extension owns the proxy settings) so the chip can
    // surface it.
    let proxyPanelOpen = false;
    let proxyInput = '';
    let proxyTestUrl = DEFAULT_PROXY_TEST_URL;
    let proxyBusy = false;
    let proxyError = '';
    let proxyGateError = '';     // '' | i18n key (mirrors blob.proxy.gate)
    let proxyTestGen = 0;        // stale-test guard: bumped on open/close

    const persistMarks = () => {
        store.set('deadMarks', JSON.stringify([...deadMarks]));
        // Refresh the tab badge on every marks mutation (toggle/mark-all/
        // clear/scan prune/onRemoved prune). badge() itself counts the last
        // scan's dead+blocked rows, not the marks.
        views.updateBadges();
    };

    const scannableItems = tree =>
        filterScannable(flattenTree(tree),
            (title, url) => separatorManager.isSeparator(title, url));

    // The scan tuning settings are read by the SW (dead-scan-sw.js) — the
    // view only needs the timeout for the proxy panel's reachability test.
    const scanTimeoutMs = () =>
        Math.min(30, Math.max(2, parseInt(store.get('deadScanTimeout', '8'), 10) || 8)) * 1000;

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

    // v4 task-4 #16: progressive rows come from the SW blob's journal —
    // settled dead/blocked checks in scan order (= tree order, so a row's
    // position is stable once it appears), joined against the tree map like
    // the cached rows. The filter segment is a finished-result control and
    // is NOT applied here — mid-scan every discovered row shows up at once.
    const liveRows = () => {
        const rows = [];
        if (!live)
            return rows;
        for (let i = 0, l = live.order.length; i < l; i++) {
            const id = live.order[i];
            const result = live.results.get(id);
            if (!result || result.status === 'ok' || result.status === 'skipped')
                continue;
            const item = treeItems.get(id);
            if (item)
                rows.push({ item, result });
        }
        return rows;
    };

    // --- Proxy strip (dead-proxy.js quick add/manage) -------------------------
    // Sits above the scan toolbar in every state (idle/scanning/selecting);
    // its controls disable mid-scan so a reachability test can never clobber
    // the running scan's PAC session. Carries .vbm-toolbar so keyboard.js's
    // Tab cycle picks the controls up like the main toolbar's.
    // Dismissable: with no server saved, the strip (add button + nudge) can
    // be hidden for good — the options page has a full add/test/clear entry
    // now (src/options-proxy.js), so the hint is not the only way in. A saved
    // server always keeps its manage row (change/remove) visible.
    const proxyStripHidden = () => !proxyServerSetting() && store.get('hideDeadProxyStrip', '') === '1';
    const renderProxyStrip = () => {
        if (proxyStripHidden())
            return '';
        const server = proxyServerSetting();
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
                `<button class="dead-proxy-change"${live ? ' disabled' : ''}>${_m('deadProxyChange')}</button>` +
                `<button class="dead-proxy-remove"${live ? ' disabled' : ''}>${_m('deadProxyRemove')}</button>`;
        } else {
            html += `<button class="dead-proxy-add"${live ? ' disabled' : ''}>${_m('deadProxyAdd')}</button>`;
            // The dismiss is a small × (not a wordy button) — it only hides
            // the no-server hint; the options page keeps the full add entry.
            // It renders SECOND: the strip's CSS pushes it to the first
            // row's right end (margin-inline-start:auto).
            html += `<button class="dead-proxy-hide"${live ? ' disabled' : ''} ` +
                `title="${_m('deadProxyNeverShow')}" aria-label="${_m('deadProxyNeverShow')}">` +
                `<svg class="vbm-icon" width="10" height="10" viewBox="0 0 16 16" fill="none" ` +
                `stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">` +
                `<path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg></button>`;
            // The nudge ties the dual-channel design to the quick button:
            // direct-failing rows may be region-blocks, not dead. It renders
            // LAST — flex-basis:100% wraps it onto its own second row — and
            // the wording no longer carries the dead-row count (the
            // visibility gate still keys off it).
            const deadN = !live && lastScan
                ? allResultRows().filter(r => r.result.status === 'dead').length
                : 0;
            if (deadN)
                html += `<span class="dead-proxy-nudge">${_m('deadProxyNudge')}</span>`;
        }
        return html + '</div>';
    };

    // --- Rendering --------------------------------------------------------------
    const renderToolbar = () => {
        // vbm-toolbar: keyboard.js's Tab cycle picks the controls up as
        // stops between the tab strip and the list rows (final polish).
        let html = '<div class="dead-toolbar vbm-toolbar">';
        if (live) {
            // scanning/paused share the toolbar; the toggle button and the
            // paused tag split them. Real <button>s: Tab-reachable and
            // Enter/Space-fireable like the other dead-toolbar controls.
            const paused = live.state === 'paused';
            // v4 task-4 #17: the label is the bare done/total counter (the
            // full sentence moves to title/aria-label) so a progress tick
            // never truncates it — the bar carries the visual ratio.
            const full = _m('deadChecking', [`${live.done}`, `${live.total}`]);
            html += `<progress class="dead-progress" value="${live.done}" max="${Math.max(live.total, 1)}"></progress>` +
                (paused ? `<span class="dead-paused-tag">${_m('deadPaused')}</span>` : '') +
                `<span class="dead-progress-label" title="${htmlspecialchars(full)}" aria-label="${htmlspecialchars(full)}">${live.done}/${live.total}</span>` +
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
                    `<button class="dead-delete-selected"${selected.size ? '' : ' disabled'}>${_m('deadDeleteSelected')}</button>` +
                    `<button class="dead-select-exit">${_m('selectModeExit')}</button>`;
                html += '</div>';
                return html;
            }
            if (lastScan) {
                const time = new Date(lastScan.ts).toLocaleString();
                html += `<span class="dead-last">${_m('deadLastScanAt', time)} · ${lastScan.scannedCount}</span>`;
                // Rescan rides the timestamp, not the result rows: a clean
                // scan (zero dead rows) must still offer the way back into
                // a fresh run (f5bc7cb had stranded the button inside the
                // rows branch, leaving no in-view rescan after a clean scan).
                html += `<button class="dead-rescan">${_m('deadRescan')}</button>`;
            }
            const rows = allResultRows();
            if (lastScan && rows.length) {
                // dead-filter and the old dead-summary merge: each segment
                // button carries its own count ("全部 28 · 仅死链 20 · 仅受限 0"),
                // so the two situations read at a glance instead of as a
                // separate summary line. Order: scan-time → rescan → filter →
                // mark-all → unmark-all → delete-all → select-mode.
                const deadN = rows.filter(r => r.result.status === 'dead').length;
                html += '<span class="dead-filter" role="group">';
                // v4 task-4 #1: pressed state = aria-pressed only (the
                // 'active' class is context-menu.js's menu-open marker —
                // clearMenu strips it body-wide on click/focus).
                for (const [value, key, count] of [
                    ['all', 'deadFilterAll', rows.length],
                    ['dead', 'deadFilterDead', deadN],
                    ['blocked', 'deadFilterBlocked', rows.length - deadN]
                ])
                    html += `<button class="dead-filter-btn" data-filter="${value}" aria-pressed="${filter === value}">${_m(key)} ${count}</button>`;
                html += '</span>';
                html += `<button class="dead-mark-all">${_m('deadMarkAll')}</button>`;
                if (deadMarks.size)
                    html += `<button class="dead-unmark-all">${_m('deadUnmarkAll')}</button>`;
                // Batch delete-all: removes every row of the ACTIVE filter
                // segment (the same scope as mark-all, so 仅死链 narrows it
                // to dead rows only). Rendered only when that set is
                // non-empty — a danger button that clicks into nothing
                // under a filter matching no rows must not appear.
                if (resultRows().length)
                    html += `<button class="dead-delete-all">${_m('deadDeleteAllBtn')}</button>`;
                // v4 task-3 #4: selection mode entry — only with results on screen
                html += `<button class="dead-select-mode">${_m('selectModeEnter')}</button>`;
            }
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
                `title="${marked ? _m('deadUnmark') : _m('deadMark')}">${FLAG_ICON}</button>` +
                `<button class="row-btn dead-del-btn" aria-label="${_m('rowActionDelete')}" ` +
                `title="${_m('rowActionDelete')}">${TRASH_ICON}</button>` +
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
    // v4 task-4 #14: the risk banner's controls join the park/restore so
    // a scan tick can't drop focus off a banner button either.
    const TOOLBAR_SEL = '.vbm-toolbar button, .vbm-toolbar select, .vbm-toolbar input, .risk-banner button, .risk-banner a[href]';
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

    // --- Row focus park/restore (4.0.1 focus law) --------------------------
    // The list-row twin of the toolbar pair above: the render's innerHTML
    // swap replaces every row, so a focused row drops to <body> and the ↓
    // walk dies (every filter click, mark toggle and scan tick repaints).
    // Park the focused row before the swap, restore it after — by row id
    // when the row carries one (dead-item-<id>), else by its index among the
    // list's <li>s, clamped on restore so a vanished row lands on the row
    // that took its place; an emptied list parks on the container itself.
    const parkRowFocus = () => {
        let li = document.activeElement;
        while (li && li.tagName !== 'LI')
            li = li.parentNode;
        // the row must belong to THIS list — another view's row does not count
        for (let p = li; p; p = p.parentNode) {
            if (p !== $list)
                continue;
            if (typeof $list.querySelectorAll !== 'function')
                return null;
            const lis = $list.querySelectorAll('li');
            for (let i = 0, l = lis.length; i < l; i++)
                if (lis[i] === li)
                    return { id: li.id || '', idx: i };
            return null;
        }
        return null;
    };
    const unparkRowFocus = parked => {
        if (!parked)
            return;
        let li = parked.id ? document.getElementById(parked.id) : null;
        if (!li) {
            if (typeof $list.querySelectorAll !== 'function')
                return;
            const lis = $list.querySelectorAll('li');
            if (!lis.length) {
                // no rows at all — park focus on the list container itself
                if ($list.focus)
                    $list.focus();
                return;
            }
            li = lis[Math.min(parked.idx, lis.length - 1)];
        }
        if (!li)
            return;
        // A row carrying tabindex takes the focus itself (the executable
        // start-hint row); plain rows hand it to their anchor/span — the
        // same element keyboard.js's row walk focuses. (getAttribute is
        // guarded: test doubles may lack it.)
        const target = (li.getAttribute && li.getAttribute('tabindex') !== null)
            ? li
            : (li.querySelector ? li.querySelector('a, span') : null);
        if (target && target.focus)
            target.focus();
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
        let html = riskBanner.html() + renderProxyStrip() + renderToolbar();
        if (live) {
            // Progressive rendering (v4 task-4 #16): the blob journal's
            // settled dead/blocked checks are already rows while the SW's
            // scan keeps running.
            html += renderRows(liveRows());
        } else if (!lastScan) {
            // §3.5: the empty state itself is the executable start row.
            html += `<ul role="list"><li class="empty-state dead-start" role="listitem" tabindex="-1">` +
                `<i>${_m('deadStartHint', `${treeItems.size}`)}</i></li></ul>`;
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
        // 4.0.1 focus law: a focused list ROW rides the same swap
        const parkedRow = parkRowFocus();
        // v4 task-4 #17: mid-scan repaints are silent — the list's scroll
        // position survives the innerHTML swap (idle interactions keep the
        // old reset-to-top behavior).
        const scroll = live ? $list.scrollTop : 0;
        $list.innerHTML = html;
        if (live && scroll)
            $list.scrollTop = scroll;
        restoreToolbarFocus(tbIdx);
        // …restored BEFORE the pendingRowFocus block below, so that explicit
        // override still wins when set (v4 task-4 #8).
        unparkRowFocus(parkedRow);
        // v4 task-4 #8: select-mode Space toggle — restore the row's anchor.
        if (pendingRowFocus) {
            const id = pendingRowFocus;
            pendingRowFocus = null;
            const row = document.getElementById(`dead-item-${id}`);
            const a = row && row.querySelector('a');
            if (a)
                a.focus();
        }
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

    // --- Batch deletion (the dupes recipe: removeSequentially + ConfirmDialog
    // + a single toast) ------------------------------------------------------
    // Serial chain so the backend and the undo stack see one deletion at a
    // time (every capture lands BEFORE its remove, chrome applies API calls
    // in issue order). Deleting a row prunes its mark through the onRemoved
    // listener. A doomed id can vanish mid-batch (sync, another page): the
    // remove callback reads lastError so that failure neither logs an
    // "Unchecked runtime.lastError" nor counts toward the toast — the
    // promise resolves with the number of rows ACTUALLY deleted.
    const removeSequentially = ids => {
        let removed = 0;
        return ids.reduce((chain, id) => chain.then(() => new Promise(resolve => {
            undo.capture(id);
            chrome.bookmarks.remove(id, () => {
                if (!chrome.runtime.lastError)
                    removed++;
                resolve();
            });
        })), Promise.resolve()).then(() => removed);
    };

    // Shared batch-delete gate: ConfirmDialog with the running count, then
    // the serial chain, then a single toast reporting the actual deletions.
    // The doomed rows are pruned from treeItems BEFORE the follow-up render,
    // so they vanish immediately instead of lingering until the
    // onRemoved→scheduleRender 300ms re-join (a stale list would let a fast
    // second click re-target deleted ids). `done` is the caller-specific
    // finish (deleteSelected exits the mode); `noteKey` appends a second
    // line to the dialog (delete-all's blocked/undo-granularity warning).
    const confirmDeletion = (doomed, dialogKey, done, noteKey) => {
        if (!doomed.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m(dialogKey, `${doomed.length}`) + (noteKey ? `<br>${_m(noteKey)}` : ''),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                removeSequentially(doomed).then(removed => {
                    undo.showToast(_m('deadDeleted', `${removed}`));
                    for (const id of doomed)
                        treeItems.delete(id);
                    // Rebuild the tree: the batch removal goes straight to
                    // chrome.bookmarks.remove and the tree has no onRemoved
                    // listener of its own — without this the deleted rows
                    // linger in the tree until the popup reopens.
                    chrome.bookmarks.getTree(treeView.generateTree);
                    if (done)
                        done();
                    else if (views.isActive('dead'))
                        render();
                });
            }
        });
    };

    // Toolbar "delete all": removes every row of the ACTIVE filter segment
    // (all / dead / blocked — mirrors markAll). The dialog names the
    // current-filter scope (the old text lumped everything under "dead
    // bookmarks" while All also deletes blocked rows) and carries the note
    // about blocked rows and the one-step undo granularity.
    const deleteAll = () =>
        confirmDeletion(resultRows().map(({ item }) => item.id), 'deadDeleteAll', null, 'deadDeleteAllNote');

    // Selection-mode "delete selected": removes the selected rows after a
    // confirm, then LEAVES the mode — the selection's rows are all gone, so
    // a zero-count selection bar would be dead weight.
    const deleteSelected = () => {
        if (!selected.size)
            return;
        confirmDeletion([...selected], 'deadConfirmDeleteSelected',
            () => setSelecting(false));
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

    // Test & save: parse → permission → controllability → reachability. The
    // `proxy` permission is a REQUIRED install-time permission (Chrome
    // refuses it as optional), so contains() is the gate and request() is
    // only a fallback for states that should not exist — a granted required
    // permission never triggers a prompt. Only a REACHABLE server is
    // persisted (to the same store key the options page displays); every
    // failure keeps the panel open with its reason.
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
        const ensurePermission = () =>
            proxyPermission().then(have => have || requestProxyPermission());
        ensurePermission().then(granted => {
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
                return testProxyReachable(server, { testUrl, timeoutMs: scanTimeoutMs() }).then(reachable => {
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

    // --- Scan (v4 task-4 #16: the SW owns the run, the view mirrors it) -------
    // The scan engine lives in src/dead-scan-sw.js so it survives popup close:
    // pages send fire-and-forget DEAD_SCAN_MSG messages; the runner publishes
    // a live blob to chrome.storage.local[DEAD_SCAN_KEY] and the finished run
    // to deadLastScan (same shape the view always rendered). Everything below
    // is a mirror of those two keys.
    const sendScan = type => {
        try {
            chrome.runtime.sendMessage({ type });
        } catch (e) { /* no listener (unit tests) — the mirror stays put */ }
    };

    // A published blob replaces the mirror wholesale; raw === undefined (key
    // removed) means the run ended — the deadLastScan change that accompanies
    // a finish renders the fresh cache, a cancel leaves the previous one.
    const applyBlob = raw => {
        scanStarting = false;
        if (!raw) {
            live = null;
        } else {
            try {
                const blob = typeof raw === 'string' ? JSON.parse(raw) : raw;
                live = {
                    state: blob.state === 'paused' ? 'paused' : 'scanning',
                    done: blob.done || 0,
                    total: blob.total || 0,
                    order: blob.items || [],
                    results: new Map(Object.entries(blob.results || {}))
                };
                // The proxy chip surfaces why the scan's second channel is
                // off (permission denied / another extension owns proxy).
                proxyGateError = (blob.proxy && blob.proxy.gate) || '';
            } catch (e) {
                live = null; // a corrupt blob renders as "no run"
            }
        }
        if (views.isActive('dead'))
            render();
    };

    // deadLastScan changed — only the SW writes it, so this means a run
    // finished: fold in the fresh cache, prune the marks of ids that came
    // back healthy (§5.5c) and repaint every overlay. Runs even when the
    // view is not active (the prune must not wait for a revisit).
    const onCacheWritten = raw => {
        try {
            lastScan = raw ? JSON.parse(raw) : null;
        } catch (e) {
            lastScan = null;
        }
        if (lastScan && lastScan.results) {
            let pruned = false;
            for (const [id, r] of Object.entries(lastScan.results))
                if ((r.status === 'ok' || r.status === 'skipped') && deadMarks.delete(id))
                    pruned = true;
            if (pruned)
                persistMarks();
            refreshOverlays();
        }
        // The tab badge is now the scan's dead+blocked count — a finished run
        // always re-evaluates it, even when no mark was pruned (the scan's
        // verdict alone can change the number).
        views.updateBadges();
        if (views.isActive('dead'))
            render();
    };

    if (chrome.storage && chrome.storage.onChanged)
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local')
                return;
            if (DEAD_SCAN_KEY in changes)
                applyBlob(changes[DEAD_SCAN_KEY].newValue);
            if (DEAD_LAST_KEY in changes)
                onCacheWritten(changes[DEAD_LAST_KEY].newValue);
        });

    // Start: one fire-and-forget message; scanStarting guards the window
    // until the first blob lands (applyBlob clears it). The SW gates and
    // installs the marker-PAC session itself (a gate failure comes back as
    // blob.proxy.gate); an open add panel's test would clobber that session,
    // so the panel goes first.
    const startScan = () => {
        if (live || scanStarting)
            return;
        scanStarting = true;
        closeProxyPanel();
        sendScan(DEAD_SCAN_MSG.start);
    };

    // Pause ⇄ Resume (same semantics as Esc, item 10): flip the mirror
    // optimistically, then let the SW's published transition confirm it.
    const togglePause = () => {
        if (!live)
            return;
        const resume = live.state === 'paused';
        live.state = resume ? 'scanning' : 'paused';
        sendScan(resume ? DEAD_SCAN_MSG.resume : DEAD_SCAN_MSG.pause);
        if (views.isActive('dead'))
            render();
    };

    // Cancel (item 10): the run never happened — the mirror drops, the SW
    // discards the partial results and the view falls back to the previous
    // persisted cache (or the start hint).
    const cancelScan = () => {
        if (!live && !scanStarting)
            return;
        live = null;
        scanStarting = false;
        sendScan(DEAD_SCAN_MSG.cancel);
        if (views.isActive('dead'))
            render();
    };

    // --- Events ------------------------------------------------------------------
    // Prune marks of removed bookmarks; path changes may reshuffle rows.
    chrome.bookmarks.onRemoved.addListener(id => {
        if (deadMarks.delete(id)) {
            persistMarks();
            refreshOverlays();
        }
        // The badge counts the cached scan's dead+blocked verdicts without a
        // tree join — drop the removed id there too, or the count stays
        // higher than the rows on screen (and a cold-start preload would
        // "revive" it). In-memory only: the persisted deadLastScan is the
        // SW's to rewrite on the next scan.
        if (lastScan && lastScan.results && id in lastScan.results) {
            delete lastScan.results[id];
            views.updateBadges();
        }
    });
    let refreshTimer = null;
    const scheduleRender = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            if (views.isActive('dead') && lastScan && !live) {
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
        // v4 task-4 #14 risk banner: ack (per major version), session
        // dismiss, and the backup-help link (popup-respecting open).
        if (closest('.risk-banner-never')) {
            e.preventDefault();
            riskBanner.ack();
            render();
            return;
        }
        if (closest('.risk-banner-dismiss')) {
            e.preventDefault();
            riskBanner.dismiss();
            render();
            return;
        }
        if (closest('.risk-banner-help')) {
            e.preventDefault();
            if (actions && actions.openBookmarkNewTab)
                actions.openBookmarkNewTab(RISK_HELP_URL, true, true);
            return;
        }
        if (closest('.dead-start') || closest('.dead-rescan')) {
            e.preventDefault();
            startScan();
            return;
        }
        const pauseBtn = closest('.dead-pause');
        if (pauseBtn) {
            e.preventDefault();
            togglePause();
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
        if (closest('.dead-proxy-hide')) {
            e.preventDefault();
            // Hide the add/nudge strip for good — the options page keeps a
            // full proxy add/test/clear entry (src/options-proxy.js).
            store.set('hideDeadProxyStrip', '1');
            render();
            return;
        }
        const filterBtn = closest('.dead-filter-btn');
        if (filterBtn) {
            e.preventDefault();
            filter = filterBtn.dataset.filter || 'all';
            store.set('deadFilter', filter); // v4 task-4 #1: persist the mode
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
        if (closest('.dead-delete-all')) {
            e.preventDefault();
            deleteAll();
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
        if (closest('.dead-delete-selected')) {
            e.preventDefault();
            deleteSelected();
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

    // v4 task-4 #8: in select mode Space toggles the focused row's
    // membership (click parity). Capture phase, so keyboard.js never turns
    // it into a synthetic click that opens the bookmark — and so a focus
    // parked on a row button still toggles the row instead of paging the
    // list. Focus is restored by render() via pendingRowFocus.
    $list.addEventListener('keydown', e => {
        if (!selecting || e.key !== ' ')
            return;
        const li = e.target && e.target.closest ? e.target.closest('li.vbm-row') : null;
        const id = li && li.dataset && li.dataset.nodeId;
        if (!id)
            return;
        e.preventDefault();
        e.stopPropagation();
        if (selected.has(id))
            selected.delete(id);
        else
            selected.add(id);
        pendingRowFocus = id;
        render();
    }, true);

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
        // Tab badge = the last scan's discovered dead+blocked rows (not the
        // manual marks count) — the same "discovered count" semantics as the
        // dupes (groups) and stats (rows) badges. No scan yet → 0 → hidden.
        badge: () => {
            const r = lastScan && lastScan.results ? lastScan.results : null;
            if (!r)
                return 0;
            let n = 0;
            for (const id in r) {
                const res = r[id];
                if (res.status === 'dead' || res.status === 'blocked')
                    n++;
            }
            return n;
        },
        activate: ({ preset } = {}) => {
            // v4 task-4 #16: sync straight from chrome.storage.local — the
            // store mirror only overlays at page init, but a scan may have
            // finished (or be running) while the popup sat open elsewhere.
            // v4 task-4 #6: preset { scan:true } (palette custom command)
            // kicks the scan off once the mirror is in sync — startScan
            // itself guards against a live run.
            const kick = () => {
                if (preset && preset.scan)
                    startScan();
            };
            const local = chrome.storage && chrome.storage.local;
            const treeAndRender = () =>
                chrome.bookmarks.getTree(t => {
                    // the first entry builds the tree-item map the rows join against
                    treeItems = new Map(scannableItems(t).map(item => [item.id, item]));
                    render();
                    // Refresh the tab badge now that lastScan is available: the
                    // activation-time updateBadges ran BEFORE the async storage
                    // read resolved, so a stored scan's badge stayed hidden
                    // until a later event (view switch / SW publish). Mirrors
                    // the stats view's post-read badge refresh.
                    views.updateBadges();
                    kick();
                });
            if (!local || !local.get) // unit doubles without storage
                return treeAndRender();
            local.get([DEAD_SCAN_KEY, DEAD_LAST_KEY], data => {
                // Fold the cache in without the mark prune — that side
                // effect belongs to the finish event (onCacheWritten).
                try {
                    lastScan = data[DEAD_LAST_KEY] ? JSON.parse(data[DEAD_LAST_KEY]) : null;
                } catch (e) {
                    lastScan = null;
                }
                applyBlob(data[DEAD_SCAN_KEY]);
                treeAndRender();
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
            if (!live)
                return false;
            togglePause();
            return true;
        },
        onKey
    });

    // Cold-start badge: the dead tab's count comes from the stored lastScan,
    // which activate() only reads once the tab is opened. Reopening the popup
    // on another view left the badge dark until a switch — preload the cache
    // right after registration (registration's own renderTabs → updateBadges
    // ran with lastScan still null) so the count lights immediately.
    const coldLocal = chrome.storage && chrome.storage.local;
    if (coldLocal && coldLocal.get) {
        coldLocal.get([DEAD_LAST_KEY], data => {
            try {
                lastScan = data[DEAD_LAST_KEY] ? JSON.parse(data[DEAD_LAST_KEY]) : null;
            } catch (e) {
                lastScan = null;
            }
            views.updateBadges();
        });
    }

    return { refresh: render, refreshOverlays, isMarked, toggleMark };
}
