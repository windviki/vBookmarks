/**
 * Dead-link scan view (v4 task-2, slice C — docs/plan-4.0.0/v4task-2.md §5.5, row spec
 * docs/plan-4.0.0/v4task-2-list.md §3.5).
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
 * 项3). Marks prune on bookmark removal (the tree re-join drops vanished
 * ids); a mark that comes back ok/skipped after a rescan stays as the
 * "过去标注" residue (§2.4 — see docs/dead-过去标注语义.md), cleared only by
 * the user or by bookmark removal. Batch "mark all"
 * (every dead+blocked row of the result set) and "clear all marks" are
 * ConfirmDialog-gated. badge() = the last scan's dead+blocked count after
 * the tree join (see the badge hook at registration — NOT the marks count,
 * and NOT the raw cached verdicts: bookmarks gone from the tree drop out).
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
import { VIEW_ICONS, FLAG_ICON, TRASH_ICON, CHEVRON_ICON } from './icons.js';
import { makeRiskBanner, RISK_HELP_URL } from './risk-banner.js';
import { initDropdowns } from './dropdown.js';
import { htmlspecialchars } from './escape.js';
import { parkRowFocus, unparkRowFocus, parkToolbarFocus, restoreToolbarFocus } from './list-focus.js';

export function initViewDead(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    // 标注状态筛选（第二工具条）与排序下拉的选项表。两者均为空闲态控制：
    // 扫描中（live）渐进展示不受影响。
    const MARK_FILTERS = [
        ['', 'deadMarkStatusAll'],
        ['marked', 'deadMarkStatusMarked'],
        ['unmarked', 'deadMarkStatusUnmarked']
    ];
    const DEAD_SORT_OPTS = [
        ['detected', 'deadSortByDetected'],
        ['path', 'deadSortByPath'],
        ['marked', 'deadSortByMarked']
    ];
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
    // 标记时间（id → Date.now() 毫秒）：与 deadMarks 并行持久化的 map，供
    // "标记时间"排序使用。老备份无此 key 时为空 map → 排序回退到稳定序
    // （deadMarks 插入序），与"回退 key 顺序"语义一致。
    const loadMarkTimes = () => {
        try {
            return new Map(Object.entries(JSON.parse(store.get('deadMarkTimes', '{}') || '{}')));
        } catch (e) {
            return new Map();
        }
    };
    let deadMarkTimes = loadMarkTimes();
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
    let filter = ['all', 'dead', 'blocked', 'marked'].indexOf(store.get('deadFilter', 'all')) !== -1
        ? store.get('deadFilter', 'all') : 'all';
    // 标注状态筛选（第二工具条）: '' | 'marked' | 'unmarked'，持久化 deadMarkFilter。
    // 与 filter（分类筛选）正交：filter 分段计数保持描述整次扫描，markFilter
    // 只作用于可见行（结果 + 残留标注列表一起过滤）。
    let markFilter = ['', 'marked', 'unmarked'].indexOf(store.get('deadMarkFilter', '')) !== -1
        ? store.get('deadMarkFilter', '') : '';
    // 结果排序（空闲态）: 'detected' | 'path' | 'marked'，持久化 deadSort。
    let deadSort = ['detected', 'path', 'marked'].indexOf(store.get('deadSort', 'detected')) !== -1
        ? store.get('deadSort', 'detected') : 'detected';
    // v4 task-3 #4 selection mode: the toolbar's 选择 button swaps the idle
    // controls for a batch bar (all/invert/clear + mark/unmark selected);
    // row clicks toggle membership instead of opening, Esc exits. Members
    // are bookmark ids, pruned at render against rows that still exist.
    let selecting = false;
    const selected = new Set();
    // v4 task-4 #8: select-mode Space toggles the focused row and render()
    // swaps the list — park the row id so focus returns to it afterwards.
    let pendingRowFocus = null;
    // The marked-view tooltip banner (markedBannerHtml): a session-level
    // dismiss (×) — same semantics as the risk banner's ×, the hint
    // reappears on the next popup open / re-entry into the marked-only view.
    let markedBannerDismissed = false;

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
        // Mark times ride every marks mutation: one persistence path covers
        // toggle/mark-all/clear/mark-selected/onRemoved prune.
        store.set('deadMarkTimes', JSON.stringify(Object.fromEntries(deadMarkTimes)));
        // No updateBadges here: the tab badge derives from the last scan's
        // dead+blocked rows (badge() = allResultRows().length), not the marks.
        // A marks-only mutation can never change the count, so refreshing here
        // would be a redundant DOM write per toggle — the badge is updated only
        // where lastScan/tree actually change (scan complete, clear scan,
        // onRemoved verdict removal, activation).
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
    // 结果行缓存（审计 F3）：一次 render 里 renderToolbar（含 filter 分段循环
    // 每段一次 resultRows）与 render 会对 allResultRows 求值多次，每次还带
    // sort —— 大死链集下重复排序。缓存结果行，仅在依赖变化（lastScan、
    // treeItems、deadSort）时由 invalidateResultRows() 失效。resultRows /
    // selectableRows 只读该数组，不会 mutate。
    let cachedResultRows = null;
    const invalidateResultRows = () => { cachedResultRows = null; };
    const allResultRows = () => {
        if (cachedResultRows)
            return cachedResultRows;
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
                error: r.error,
                ts: r.ts    // per-row scan time (deadSort 'detected'); absent on old backups
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
        // idle 排序（deadSort）：仅结果行；老备份全 tie 时稳定排序保持 key 序。
        if (rows.length > 1)
            rows.sort(compareRows);
        cachedResultRows = rows;
        return rows;
    };

    // …and the three-state segment on top of it, PLUS the mark-status filter
    // (已标注/未标注 second toolbar): markFilter narrows the already category-
    // filtered set. resultRows() is the scope source for mark-all / selectable
    // / delete-all, so the second toolbar's filter flows through all of them.
    const resultRows = () => {
        const rows = allResultRows();
        const byFilter = filter === 'all' ? rows : rows.filter(row => row.result.status === filter);
        if (markFilter === 'marked')
            return byFilter.filter(r => deadMarks.has(r.item.id));
        if (markFilter === 'unmarked')
            return byFilter.filter(r => !deadMarks.has(r.item.id));
        return byFilter;
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

    // The user's manual marks, joined against the tree, in display order.
    // "过去标注" is the set of marks the CURRENT run has not yet re-verdict as
    // a problem row — a mark the scan judges dead/blocked rides its result row
    // (⚑ kept there) and is NEVER counted here again (double-count regression).
    //   - before any scan cache (!lastScan): the whole marked set.
    //   - mid-scan / cached results: only the UNCOVERED marks (a healthy-but-
    //     previously-marked link, or a mark added after the run) — the residue
    //     the doc (docs/dead-过去标注语义.md) calls the only remaining source.
    const markedRows = () => {
        let covered = null;
        if (live)
            covered = new Set(liveRows().map(r => r.item.id));
        else if (lastScan)
            covered = new Set(allResultRows().map(r => r.item.id));
        const showAll = !live && !lastScan;
        const out = [];
        for (const id of deadMarks) {
            if (!showAll && covered && covered.has(id))
                continue;
            const item = treeItems.get(id);
            if (item)
                out.push({ item });
        }
        if (out.length > 1)
            out.sort(compareRows);
        return out;
    };

    // 残留标注列表的可见集：'unmarked' 下整个残留列表隐藏（残留全是已标注的，
    // "未标注"筛选下它们不该出现在视野里）；其余状态原样透出。
    const visibleMarkedRows = () => markFilter === 'unmarked' ? [] : markedRows();

    // 第二工具条计数：按当前分类（filter）划分标注状态。全部 = 该分类下可见行
    // 总数（= 已标注 + 未标注）。残留（过去标注）只在它可见的分类（全部 / 上次
    // 标注 / 无扫描）计入"已标注"；仅死链/仅受限分类下残留不可见、不计入。
    const markStatusCounts = () => {
        const markedOnly = filter === 'marked' || !lastScan;
        const rows = markedOnly ? [] : (filter === 'all'
            ? allResultRows() : allResultRows().filter(r => r.result.status === filter));
        const residue = (markedOnly || filter === 'all') ? markedRows().length : 0;
        const marked = rows.filter(r => deadMarks.has(r.item.id)).length + residue;
        const unmarked = rows.length - (marked - residue);
        return { all: marked + unmarked, marked, unmarked };
    };

    // 空闲态排序（deadSort）：结果行与残留标注列表共用同一比较器，全视图视觉
    // 一致。'detected' 用扫描的 per-row ts（老备份无 ts → 0 → 全 tie → 稳定
    // 排序回退 Object.entries 的 key 序）；'path' 用 views.pathOf；'marked' 用
    // deadMarkTimes（未标注行排最后）。live 不经过此路径（liveRows 走 tree 序）。
    const rowSortKey = row => {
        switch (deadSort) {
            case 'path':
                return views.pathOf(row.item.id) || '';
            case 'marked':
                return deadMarkTimes.get(row.item.id) ?? Number.MAX_SAFE_INTEGER;
            default: {  // 'detected'
                const r = row.result
                    || (lastScan && lastScan.results && lastScan.results[row.item.id])
                    || {};
                return typeof r.ts === 'number' ? r.ts : 0;
            }
        }
    };
    const compareRows = (a, b) => deadSort === 'path'
        ? (rowSortKey(a) || '').localeCompare(rowSortKey(b) || '')
        : rowSortKey(a) - rowSortKey(b);

    // The rows the batch/selection toolbar acts on while idle: the active
    // result segment when results are on screen, PLUS the marked rows that
    // aren't duplicated by a result row. The marked rows only join in the
    // "全部" view (where the marked list renders below the results) and in
    // the marked-only view (filter 'marked' or no scan, marks alone). Under
    // 仅死链/仅受限 only that category's results are on screen — a category
    // filter hides the marked list, so its rows are not selectable there.
    const selectableRows = () => {
        if (filter === 'marked' || !lastScan)
            return visibleMarkedRows();
        return filter === 'all' ? resultRows().concat(visibleMarkedRows()) : resultRows();
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
        // 选择模式下批量工具条接管工具栏，proxy strip 一并隐藏——避免面板与批量
        // 条同屏的状态混叠（批量模式是临时态，退出后 strip 恢复）。
        if (selecting || proxyStripHidden())
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
            html += '</div>';
            // 扫描中不渲染第二工具条：标记状态过滤与排序都是完成态（idle）控制，
            // live 的渐进树序不参与 deadSort，过滤器也不作用于 liveRows。
            return html;
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
            // Unmark-all is NOT gated on a result list: marks are the user's
            // persistent intent (survive a cancelled scan — the run's abort
            // must not wipe them), so the clearing entry has to exist even
            // when no scan results are on screen (a first scan cancelled
            // before finishing leaves marked ids with no row to unmark on).
            if (deadMarks.size)
                html += `<button class="dead-unmark-all">${_m('deadUnmarkAll')}</button>`;
            // 清除扫描结果：紧跟在清空所有标记之后。清空本次扫描判定后，已标注
            // 项划归"过去标注"分类；顶部"重新检测"横幅重新显示。
            if (lastScan)
                html += `<button class="dead-clear-scan">${_m('deadClearScan')}</button>`;
            if (lastScan) {
                const time = new Date(lastScan.ts).toLocaleString();
                html += `<span class="dead-last">${_m('deadLastScanAt', time)} · ${lastScan.scannedCount}</span>`;
                // Rescan rides the timestamp, not the result rows: a clean
                // scan (zero dead rows) must still offer the way back into
                // a fresh run (f5bc7cb had stranded the button inside the
                // rows branch, leaving no in-view rescan after a clean scan).
            }
            // …and the same way back has to exist for a cancelled scan whose
            // marks now fill the list (the bottom start row is gone there, so
            // the toolbar's rescan is the only entry into a fresh run).
            if (lastScan || deadMarks.size)
                html += `<button class="dead-rescan">${_m('deadRescan')}</button>`;
            const rows = allResultRows();
            // mark-all / select-mode act on the FILTERED row set (markAll
            // reads resultRows(), the selection prunes against it), so they
            // key off the filtered count; delete-all additionally covers the
            // marked-only view (no result rows there — it deletes the marked
            // bookmarks, see deleteAll()). The filter segment stays keyed off
            // the UNFILTERED count, so the way back remains reachable.
            const markedOnly = filter === 'marked' || !lastScan;
            const filteredN = resultRows().length;
            // The marked segment counts the UNCOVERED marks (markedRows), not
            // the raw deadMarks set: a mark the scan verdicts dead/blocked
            // already rides its result row, so using deadMarks.size would
            // double-count it in 全部 (= result rows + marks).
            const markedCount = markedRows().length;
            if (lastScan && (rows.length || deadMarks.size)) {
                // dead-filter and the old dead-summary merge: each segment
                // button carries its own count ("全部 28 · 仅死链 20 · 仅受限 0 ·
                // 上次标注 5"), so the two situations read at a glance instead
                // of as a separate summary line. Order: unmark-all (whenever
                // marks exist) → scan-time → rescan → filter → mark-all →
                // delete-all → select-mode.
                const deadN = rows.filter(r => r.result.status === 'dead').length;
                html += '<span class="dead-filter" role="group">';
                // v4 task-4 #1: pressed state = aria-pressed only (the
                // 'active' class is context-menu.js's menu-open marker —
                // clearMenu strips it body-wide on click/focus).
                // 全部 = 本次扫描结果 (死链 + 受限) + 未覆盖标注 三者之和 —
                // 用户方案: "全部的计数应该包含以上三个分类的和, 而不仅是
                // 本次扫描之后的计数", 即 全部 = 死链 + 受限 + 标注。标注只算
                // 未被本次结果覆盖的残留 (markedCount), 一个 id 不会既算结果
                // 又算标注。
                for (const [value, key, count] of [
                    ['all', 'deadFilterAll', rows.length + markedCount],
                    ['dead', 'deadFilterDead', deadN],
                    ['blocked', 'deadFilterBlocked', rows.length - deadN],
                    // "上次标注": the uncovered marks — a mark the scan verdicts
                    // dead/blocked rides its result row and is never counted
                    // here again; the residue is what the segment shows.
                    ['marked', 'deadFilterMarked', markedCount]
                ])
                    html += `<button class="dead-filter-btn" data-filter="${value}" aria-pressed="${filter === value}">${_m(key)} ${count}</button>`;
                html += '</span>';
                // mark-all: result rows only — a marked-only view has none to
                // batch-mark (the batch bar handles those), and under the
                // 已标注 mark filter every visible result row is already
                // marked, so "mark all" would be a no-op confirm (审计 F2).
                if (filteredN && markFilter !== 'marked')
                    html += `<button class="dead-mark-all">${_m('deadMarkAll')}</button>`;
            }
            // Batch delete-all: the result view removes every row of the
            // ACTIVE filter segment (the same scope as mark-all, so 仅死链
            // narrows it to dead rows only); the marked-only view (cancelled
            // scan / 过去标注 filter) deletes the marked bookmarks instead.
            // Rendered only when the target set is non-empty — a danger
            // button that clicks into nothing must not appear. The marked-only
            // branch keys off the VISIBLE residue (markFilter hides it under
            // 'unmarked'), so the button never clicks into an empty set.
            if (filteredN || (markedOnly && visibleMarkedRows().length))
                html += `<button class="dead-delete-all">${_m('deadDeleteAllBtn')}</button>`;
            // v4 task-3 #4: selection mode entry — OUTSIDE the result-gated
            // block, so the marked-only view (a cancelled scan with marks,
            // or the 上次标注 filter) still gets the batch bar: the marked
            // rows are selectable members there and the batch mark/unmark/
            // delete ops are the only way to work them in bulk. Mark-all/
            // delete-all stay gated on the filtered RESULT count above
            // (marked-only view hides them).
            if (selectableRows().length)
                html += `<button class="dead-select-mode">${_m('selectModeEnter')}</button>`;
        }
        html += '</div>';
        // 标注状态筛选 + 排序（第二工具条，独立 .vbm-toolbar = 独立键盘 rung，
        // 与主工具条并列）。仅空闲态：selecting / live 已在上方 early-return。
        // gating = 有可见行可过滤/排序才渲染（审计 F1）：有标记（残留列表）或
        // 有结果行时出现；仅"有缓存但 0 死链 0 标记"的纯空态下不渲染无意义的
        // 工具条（下方是 deadNone 空态，没有行）。全新空态同理不渲染。
        if (deadMarks.size || (lastScan && allResultRows().length)) {
            const counts = markStatusCounts();
            html += '<div class="dead-toolbar dead-mark-toolbar vbm-toolbar">';
            html += '<span class="dead-mark-filter" role="group">';
            for (const [value, key] of MARK_FILTERS) {
                const n = value === 'marked' ? counts.marked
                    : value === 'unmarked' ? counts.unmarked : counts.all;
                html += `<button class="dead-mark-filter-btn" data-markfilter="${value}" aria-pressed="${markFilter === value}">${_m(key)} ${n}</button>`;
            }
            html += '</span>';
            html += dropdownHtml('dead-sort', 'deadSortLabel', DEAD_SORT_OPTS, deadSort);
            html += '</div>';
        }
        return html;
    };

    // 排序下拉的标记（镜像 view-dupes.js 的 dropdownHtml）：自定义下拉以遵循
    // 弹出窗口的箭头协议（↑ 离开 rung、↓ 打开、→ 选择、← 取消，见 dropdown.js）。
    const dropdownHtml = (cls, labelKey, options, current) => {
        const curKey = (options.find(o => o[0] === current) || [])[1] || options[0][1];
        let opts = '';
        for (const [value, key] of options)
            opts += `<li role="option" tabindex="-1" data-value="${value}"` +
                ` aria-selected="${value === current ? 'true' : 'false'}">${_m(key)}</li>`;
        return `<div class="vbm-dropdown ${cls}">` +
            `<button type="button" class="vbm-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false"` +
            ` aria-controls="${cls}-listbox" aria-label="${_m(labelKey)}">` +
            `<span class="vbm-dropdown-value">${_m(curKey)}</span>${CHEVRON_ICON}</button>` +
            `<ul id="${cls}-listbox" class="vbm-dropdown-list" role="listbox" aria-label="${_m(labelKey)}" hidden>` + opts + '</ul></div>';
    };

    // 绝对时间（检测时间/标记时间）：行的第二行右侧与 tooltip 追加使用。老备份
    // 无 per-row ts、未标记行无标记时间 → 返回空串（"标记时间没有就不显示"）。
    const fmtTime = ts => (typeof ts === 'number' && ts) ? new Date(ts).toLocaleString() : '';

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
            // 时间信息：标记时间（有则显）+ 检测时间（per-row ts）。第二行右侧
            // (subRight) 显示 `标记时间 · 检测时间`；tooltip 追加同两行带标签。
            const markTime = deadMarkTimes.get(item.id);
            const detectTime = typeof result.ts === 'number' ? result.ts : null;
            const times = [markTime, detectTime].filter(t => t).map(fmtTime).join(' · ');
            const tip = [];
            if (markTime) tip.push(`${_m('deadMarkTimeLabel')} ${fmtTime(markTime)}`);
            if (detectTime) tip.push(`${_m('deadDetectTimeLabel')} ${fmtTime(detectTime)}`);
            html += `<li class="vbm-row${sel ? ' sel' : ''}${blocked ? ' blocked' : ''}" ` +
                `id="dead-item-${item.id}" role="listitem" data-node-id="${item.id}">` +
                treeRender.generateBookmarkHTML(item.title, item.url, 'data-virtual="1"', item.id, null, {
                    path,
                    // Intentional exception: the path labels are NOT gated
                    // by showItemPath here (the dupes/recent rows are) —
                    // locating a dead bookmark needs its containing folder
                    // to be visible (docs/plan-4.0.0/v4task-2-list.md §3.5 row spec:
                    // "[icon][title ……] [×dead | ⇄直连×] [path]").
                    rightText: path,
                    // 宽/panel 第二行：路径左对齐（subText）+ 时间右对齐（subRight）。
                    // 窄视口 row-sub 隐藏、右侧槽只显示 path（rightText）→ 时间仅
                    // 存 tooltip（追加在下方）。
                    subText: path,
                    subRight: times,
                    tooltipAppend: tip.join('\n'),
                    // pill 外层槽：宽/panel 下固定宽度，时间右对齐到槽左边缘
                    // （pill 背景维持文本长度）。窄视口由 CSS 取消固定宽度。
                    badgeSlot: true,
                    badge: {
                        // statusLabel expects the direct channel's
                        // raw verdict (numeric / 'error'+name)
                        text: blocked ? _m('deadStatusBlocked')
                            : statusLabel({ status: result.code, ok: false, error: result.error }),
                        cls: blocked ? 'blocked' : 'dead'
                    }
                }) +
                // 选择模式下结果行不渲染 ⚑/× 行按钮（与 renderMarkedRows 一致）：
                // CSS 也会隐藏它们，但多出的 DOM 节点对屏幕阅读器仍可见、且点击
                // 落在行容器上会被 membership 处理器吞掉——JS 层面不渲染更干净。
                (selecting ? '' :
                    `<button class="row-btn dead-mark-btn${marked ? ' marked' : ''}" ` +
                    `aria-pressed="${marked}" ` +
                    `aria-label="${marked ? _m('deadUnmark') : _m('deadMark')}" ` +
                    `title="${marked ? _m('deadUnmark') : _m('deadMark')}">${FLAG_ICON}</button>` +
                    `<button class="row-btn dead-del-btn" aria-label="${_m('rowActionDelete')}" ` +
                    `title="${_m('rowActionDelete')}">${TRASH_ICON}</button>`) +
                '</li>';
        }
        return html + '</ul>';
    };

    // Rows of the user's manual marks, joined against the tree. They always
    // render — appended below the result rows (for the marks the current
    // result list does NOT cover: a marked id the scan never probed, or one
    // added after the run), or as the whole list in the marked-only view
    // (filter '上次标注', or a cancelled scan with no cache). Marks are
    // persistent intent, so they stay reachable and individually clearable
    // even without a scan to host them: each row carries the same mark-toggle
    // (unmarks just that one) and delete as the scan rows. Unlike the scan
    // rows they are SELECTABLE members too — the selection bar's
    // mark/unmark/delete work on them exactly like on the results (the shared
    // row-click branch swallows the row buttons while selecting, so they are
    // not rendered in that mode — no dead controls on screen).
    const renderMarkedRows = (rows, hasResults) => {
        // head 的分隔线（.after-results）仅在结果列表在上方时出现——"全部"/扫描中
        // 视图的残留区块与结果列表视觉分开；marked-only 视图（无结果列表）head 紧跟
        // 工具栏，带分隔线会与工具栏 border-bottom 叠成双线。
        let html = `<div class="dead-marked-head${hasResults ? ' after-results' : ''}">${_m('deadMarkedCount', `${rows.length}`)}</div>`;
        html += `<ul role="list" class="dead-marked-list${selecting ? ' selecting' : ''}">`;
        for (let i = 0, l = rows.length; i < l; i++) {
            const { item } = rows[i];
            const sel = selecting && selected.has(item.id);
            const path = views.pathOf(item.id);
            // 残留行的"已标注"badge 按来源着色（审计 F4）：一次标注的来源是
            // 过去的死链（danger 红）或受限（warning 琥珀）——本行若在 lastScan
            // 里判过 blocked 就读琥珀，其余（dead / ok / 未探测 / 无缓存）一律
            // 红。idle 完成扫描后残留行多为健康/未探测，自然落红；live 扫描中
            // 未判定标记可查上轮 verdict。li 同步带 blocked class → ⚑ 按钮与
            // tree overlay 的颜色随来源（受限橙 / 其余红）。
            const verdict = lastScan && lastScan.results && lastScan.results[item.id];
            const badgeCls = verdict && verdict.status === 'blocked' ? 'blocked' : 'dead';
            const markTime = deadMarkTimes.get(item.id);
            const tip = markTime ? `${_m('deadMarkTimeLabel')} ${fmtTime(markTime)}` : '';
            html += `<li class="vbm-row${sel ? ' sel' : ''}${badgeCls === 'blocked' ? ' blocked' : ''}" ` +
                `id="dead-item-${item.id}" ` +
                `role="listitem" data-node-id="${item.id}">` +
                treeRender.generateBookmarkHTML(item.title, item.url, 'data-virtual="1"', item.id, null, {
                    path,
                    rightText: path,
                    subText: path,
                    subRight: fmtTime(markTime),
                    tooltipAppend: tip,
                    badgeSlot: true,
                    badge: { text: _m('deadMarkedRow'), cls: badgeCls }
                }) +
                (selecting ? '' :
                    `<button class="row-btn dead-mark-btn marked" aria-pressed="true" ` +
                    `aria-label="${_m('deadUnmark')}" title="${_m('deadUnmark')}">${FLAG_ICON}</button>` +
                    `<button class="row-btn dead-del-btn" aria-label="${_m('rowActionDelete')}" ` +
                    `title="${_m('rowActionDelete')}">${TRASH_ICON}</button>`) +
                '</li>';
        }
        return html + '</ul>';
    };

    // --- Toolbar + row focus park/restore: see src/list-focus.js -----------
    // (final polish / 4.0.1 focus law). v4 task-4 #14: the shared toolbar
    // selector includes the risk banner's controls so a scan tick can't
    // drop focus off a banner button either.

    // Marked-view tooltip banner: shown above the toolbar whenever the list
    // is the marked-only view (filter 上次标注, or a cancelled scan with no
    // cache) and there are marks to look at. Session-dismissible (×) — same
    // contract as the risk banner's ×: the hint reappears on the next popup
    // open / re-entry into the marked view. Its rescan button is the "way
    // back into a run" the removed bottom start row used to be.
    const markedBannerVisible = () => {
        if (markedBannerDismissed || live || selecting)
            return false;
        // 有可看的标注行才提示: 标注列表为空 (全部标注已被本次结果覆盖 /
        // 从未标记, 或 'unmarked' 筛选隐藏了残留) 时, 列表本身已给出去路
        // (dead-start / 结果行), 横幅无意义。
        if (!visibleMarkedRows().length)
            return false;
        // marked-only 视图 (取消扫描 / "过去标注"筛选 / 无扫描): 有标记就提示。
        if (filter === 'marked' || !lastScan)
            return true;
        // "全部"视图 + 扫描正常完成: 本次扫描不再判为问题行的标记 (现在可
        // 访问、过去被标注) 追加于结果下方 — 同样提示用户检查"过去标注"分类。
        // 仅死链/仅受限视图不渲染标注列表, 也不提示。
        return filter === 'all';
    };
    const markedBannerHtml = () => {
        if (!markedBannerVisible())
            return '';
        return `<div class="risk-banner dead-marked-banner" role="note">` +
            `<i>${_m('deadMarkedBanner')}</i>` +
            `<button type="button" class="dead-marked-banner-rescan" tabindex="-1">${_m('deadRescan')}</button>` +
            `<button type="button" class="dead-marked-banner-dismiss" tabindex="-1" ` +
            `aria-label="${_m('deadMarkedBannerDismiss')}" title="${_m('deadMarkedBannerDismiss')}">×</button>` +
            '</div>';
    };

    const render = () => {
        if (selecting) {
            // prune members whose rows vanished (tree change / filter) BEFORE
            // the toolbar reads selected.size for its count — the marked rows
            // are selectable now, so the alive set spans results AND marks
            const alive = new Set(selectableRows().map(r => r.item.id));
            for (const id of [...selected])
                if (!alive.has(id))
                    selected.delete(id);
        }
        let html = riskBanner.html() + markedBannerHtml() + renderProxyStrip() + renderToolbar();
        if (live) {
            // Progressive rendering (v4 task-4 #16): the blob journal's
            // settled dead/blocked checks are already rows while the SW's
            // scan keeps running. A mark the run re-verifies as a problem row
            // moves into the result list here (its marked state kept on the
            // row); the still-unchecked marks append below.
            html += renderRows(liveRows());
            const marks = markedRows();
            if (marks.length)
                html += renderMarkedRows(marks, true);
        } else if (filter === 'marked' || !lastScan) {
            // Marked-only view: the whole marked set, no result rows. With no
            // scan at all AND no marks (a fresh first run) the executable
            // start row is still the empty state (§3.5); once marks exist the
            // bottom start row is gone — the toolbar's rescan (or the banner
            // above) is the way back into a run.
            const marks = visibleMarkedRows();
            // A marked-only view with marks gone (clear-all / delete-all just
            // ran, or the segment has none — incl. 'unmarked' 筛选下残留全隐藏)
            // falls back to an empty state — the empty
            // `<ul class="dead-marked-list">` shell must not linger where
            // there is nothing left to show.
            if (marks.length)
                html += renderMarkedRows(marks, false);
            else if (!lastScan)
                // 没有任何历史死链数据（从未扫描 / 清除扫描结果）→ 蓝色开始扫描
                // 按钮。这是"第一次启动"的号召性空态。
                html += `<ul role="list"><li class="empty-state dead-start" role="listitem" tabindex="-1">` +
                    `<i>${_m('deadStartHint', `${treeItems.size}`)}</i></li></ul>`;
            else {
                // 有历史扫描但"上次标注"分类为空 → 普通空态（不显示蓝色按钮）。
                // 残留标注存在但被已标注/未标注子筛选隐藏 → 提示换分段；真无残留
                // → "还没有标记过书签"。
                // 有标注但当前无可见残留（全被本次结果覆盖 / 被子筛选隐藏）→ 提示换
                // 分段；真无标注才说"还没有标记过书签"（审计：全覆盖场景原显示
                // deadMarkedNone 误导——用户明明标记过，只是都判进结果行了）。
                const label = (markedRows().length || deadMarks.size)
                    ? 'deadNoneFiltered' : 'deadMarkedNone';
                html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m(label)}</i></li></ul>`;
            }
        } else {
            const allRows = allResultRows();
            const rows = resultRows();
            // Distinguish "the scan found nothing" from "the active filter
            // matches nothing" — the latter tells the user the other
            // segments (still visible above) are where the rows went.
            html += rows.length
                ? renderRows(rows)
                : `<ul role="list"><li class="empty-state" role="listitem"><i>${_m(filter !== 'all' && allRows.length ? 'deadNoneFiltered' : 'deadNone')}</i></li></ul>`;
            // The marked list renders ONLY under "全部" (the default view),
            // when any residue mark exists — it is the "上次标注" record
            // appended below the full result set. Content: marks the result
            // rows do NOT cover (dead-过去标注语义.md §2.4: a marked id the last
            // scan judged healthy, or one it never probed, or one added after
            // it) — marks among the scan's problem rows carry the toggle in
            // the result rows, so they are not repeated here. Gated on the
            // RESIDUE count, not the raw set: when every mark is covered (过去
            // 标注 empty) no empty list shell may linger. Under 仅死链/仅受限
            // only that category's rows are on screen: a category filter hides
            // the marked list entirely (a mark the category hides is covered
            // by its own row once the segment switches back, so echoing it
            // here read as "the toolbar filter is swapped / the list shows
            // everything" — the toolbar/list mismatch report).
            const marks = visibleMarkedRows();
            if (filter === 'all' && marks.length)
                html += renderMarkedRows(marks, true);
        }
        // keep a focused toolbar control focused across the swap (see above)
        const parkedToolbar = parkToolbarFocus($list);
        // 4.0.1 focus law: a focused list ROW rides the same swap
        const parkedRow = parkRowFocus($list);
        // v4 task-4 #17: mid-scan repaints are silent — the list's scroll
        // position survives the innerHTML swap (idle interactions keep the
        // old reset-to-top behavior).
        const scroll = live ? $list.scrollTop : 0;
        $list.innerHTML = html;
        if (live && scroll)
            $list.scrollTop = scroll;
        restoreToolbarFocus($list, parkedToolbar);
        // …restored BEFORE the pendingRowFocus block below, so that explicit
        // override still wins when set (v4 task-4 #8).
        unparkRowFocus($list, parkedRow);
        // v4 task-4 #8: select-mode Space toggle — restore the row's anchor.
        if (pendingRowFocus) {
            const id = pendingRowFocus;
            pendingRowFocus = null;
            const row = document.getElementById(`dead-item-${id}`);
            const a = row && row.querySelector('a');
            if (a)
                a.focus();
        }
        // Cancelling a scan re-renders the toolbar from live (pause/cancel)
        // to idle: the parked control (e.g. .dead-cancel) no longer exists,
        // restoreToolbarFocus fails silently and focus falls out of the list
        // to <body> — the ↓ walk then dies until the user clicks back in.
        // The banner itself must not trap focus, but the keyboard must not
        // lose it either: when the focus was IN this list before the swap and
        // ends up outside it after (nothing to restore to), land on the dead
        // view's tab instead of <body>.
        if (parkedToolbar || parkedRow) {
            let ae = document.activeElement;
            while (ae && ae !== $list)
                ae = ae.parentNode;
            if (!ae) {
                const tab = document.getElementById('view-tab-dead');
                if (tab && tab.focus)
                    tab.focus();
            }
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
                const id = rowIdOf(li);
                // 死链=红（默认），受限=橙：按该 id 在本次扫描中的 verdict 着色
                // （残留标记无 verdict / 老备份 → 红，与残留行 badge 同规则）。
                const verdict = lastScan && lastScan.results && lastScan.results[id];
                const blocked = verdict && verdict.status === 'blocked';
                const cls = `dead-indicator${blocked ? ' blocked' : ''}`;
                const existing = fav.querySelector('.dead-indicator');
                if (deadMarks.has(id)) {
                    if (existing)
                        existing.className = cls; // verdict 可能随新扫描变化
                    else {
                        const span = document.createElement('span');
                        span.className = cls;
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
        if (deadMarks.has(id)) {
            deadMarks.delete(id);
            deadMarkTimes.delete(id);
        } else {
            deadMarks.add(id);
            deadMarkTimes.set(id, Date.now());
        }
        persistMarks();
        refreshOverlays();
        if (views.isActive('dead'))
            render();
    };

    const markAll = () => {
        // 已标注筛选下可见结果行全是已标注的——"标注全部"无对象，直接返回
        // （按钮已隐藏，这里兜底防其他入口）。
        if (markFilter === 'marked')
            return;
        const rows = resultRows();
        if (!rows.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('deadMarkAll'),
            button1: `<strong>${_m('deadMarkAll')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                const now = Date.now();   // 一次动作 = 同一标记时间（批量语义）
                for (const { item } of rows) {
                    deadMarks.add(item.id);
                    deadMarkTimes.set(item.id, now);
                }
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
                deadMarkTimes.clear();
                persistMarks();
                refreshOverlays();
                if (views.isActive('dead'))
                    render();
            }
        });
    };

    // 清除扫描结果：清空 lastScan（与 DEAD_LAST_KEY），本次扫描的死链/受限
    // 判定全部作废。已标注项保留——它们划归"过去标注"分类（marked-only 视图
    // 的残留列表自然承接），"重新检测已处理/已标记"的顶部横幅同步重新显示
    // （markedBannerDismissed 重置）。
    const clearScanResults = () => {
        if (!lastScan)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('deadClearScan'),
            button1: `<strong>${_m('deadClearScan')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                lastScan = null;
                store.set(DEAD_LAST_KEY, '');
                invalidateResultRows(); // 结果行缓存随 lastScan 失效
                markedBannerDismissed = false; // 顶部"重新检测"横幅重新显示
                refreshOverlays();
                // tab 徽标来自扫描判定——清空后回到 0
                views.updateBadges();
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
    // finish (deleteSelected exits the mode). Every batch delete's dialog
    // carries the undo-granularity note on its second line (undo() restores
    // only the most recent deletion); `noteKey` prepends delete-all's
    // All-filter blocked-rows warning to that same line.
    const confirmDeletion = (doomed, dialogKey, done, noteKey) => {
        if (!doomed.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m(dialogKey, `${doomed.length}`) +
                `<br>${noteKey ? `${_m(noteKey)} ` : ''}${_m('undoSingleStepNote')}`,
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                removeSequentially(doomed).then(removed => {
                    undo.showToast(_m('deadDeleted', `${removed}`));
                    for (const id of doomed)
                        treeItems.delete(id);
                    invalidateResultRows(); // 删除后 treeItems 变动 → 结果行重算
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
    // (all / dead / blocked — mirrors markAll); under the marked-only view
    // (cancelled scan / 过去标注 filter) it deletes the marked bookmarks
    // instead. The dialog names the current-filter scope (the old text
    // lumped everything under "dead bookmarks" while All also deletes
    // blocked rows); the blocked-rows note only applies to the All filter,
    // so the marked-only path drops it.
    const deleteAll = () => {
        const markedOnly = filter === 'marked' || !lastScan;
        const ids = markedOnly
            ? visibleMarkedRows().map(({ item }) => item.id)
            : resultRows().map(({ item }) => item.id);
        confirmDeletion(ids, 'deadDeleteAll', null, markedOnly ? null : 'deadDeleteAllNote');
    };

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
        const now = Date.now();   // 一次动作 = 同一标记时间
        for (const id of selected) {
            if (mark) {
                deadMarks.add(id);
                deadMarkTimes.set(id, now);
            } else {
                deadMarks.delete(id);
                deadMarkTimes.delete(id);
            }
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
    // finished: fold in the fresh cache and repaint every overlay. Runs even
    // when the view is not active (the repaint must not wait for a revisit).
    // Marks are NOT pruned here (dead-过去标注语义.md §2.4): a mark that came
    // back healthy (ok/skipped) — or one the run never probed — stays in
    // deadMarks as the "过去标注" residue, appended below the results. The
    // only things that remove marks are the user (unmark / delete) and
    // bookmark removal (the tree re-join prune).
    const onCacheWritten = raw => {
        try {
            lastScan = raw ? JSON.parse(raw) : null;
        } catch (e) {
            lastScan = null;
        }
        invalidateResultRows(); // 新缓存 → 结果行重算
        if (lastScan && lastScan.results)
            refreshOverlays();
        // The tab badge is now the scan's dead+blocked count — a finished run
        // always re-evaluates it, even when no mark was affected (the scan's
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
    // 用户方案: 取消进行中的扫描 → 自动切到"上次标注"分类并显示 tooltip
    // (标注是持久意图, 取消后只剩它们可看; 横幅提示可点重新检测回到新扫描)。
    // 没有任何标注时切过去只会看到空分类, 保持原视图 (回缓存/start 药丸)
    // 更自然。暂停/扫描完成不受此影响 (它们不经过 cancelScan)。
    const cancelScan = () => {
        if (!live && !scanStarting)
            return;
        live = null;
        scanStarting = false;
        if (deadMarks.size) {
            // 仅内存切换, 不写 deadFilter: 取消是程序性临时动作, 下次打开
            // 仍回持久化的分类 (通常默认"全部")。
            filter = 'marked';
            markedBannerDismissed = false;
        }
        sendScan(DEAD_SCAN_MSG.cancel);
        if (views.isActive('dead'))
            render();
    };

    // --- Events ------------------------------------------------------------------
    // Prune marks of removed bookmarks; path changes may reshuffle rows.
    chrome.bookmarks.onRemoved.addListener(id => {
        // Both sets are pruned unconditionally: the `||` short-circuit must
        // not skip the mark-time delete when the id WAS in deadMarks (a stale
        // deadMarkTimes entry would outlive the mark and skew 'marked' sort).
        const had = deadMarks.delete(id);
        const hadTime = deadMarkTimes.delete(id);
        if (had || hadTime) {
            persistMarks();
            refreshOverlays();
        }
        // Drop the removed id from the cached verdicts too — otherwise the
        // row (and the tree-joined badge derived from it) outlives the
        // bookmark until the debounced re-join below prunes treeItems.
        // In-memory only: the persisted deadLastScan is the SW's to rewrite
        // on the next scan.
        if (lastScan && lastScan.results && id in lastScan.results) {
            delete lastScan.results[id];
            invalidateResultRows(); // 缓存 verdict 原地删了一个 id
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
                    invalidateResultRows(); // tree join 重建 → 结果行重算
                    render();
                });
            }
        }, 300);
    };
    // All four bookmark events (the dupes view's set): onCreated covers a
    // bookmark appearing mid-session — e.g. an undo restore — so the rows'
    // tree join never goes stale while the view sits open.
    chrome.bookmarks.onCreated.addListener(scheduleRender);
    chrome.bookmarks.onRemoved.addListener(scheduleRender);
    chrome.bookmarks.onChanged.addListener(scheduleRender);
    chrome.bookmarks.onMoved.addListener(scheduleRender);

    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        // Sort dropdown (second toolbar) owns its own click handling in
        // dropdown.js — trigger toggles / option picks must not fall through
        // to the row/bookmark handler below.
        if (closest('.vbm-dropdown')) {
            e.preventDefault();
            return;
        }
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
        // marked-view tooltip banner: its rescan starts a fresh run, the ×
        // hides the hint for the session (reappears on the next entry).
        if (closest('.dead-marked-banner-rescan')) {
            e.preventDefault();
            startScan();
            return;
        }
        if (closest('.dead-marked-banner-dismiss')) {
            e.preventDefault();
            markedBannerDismissed = true;
            render();
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
        // 第二工具条的标注状态筛选（类名独立于 .dead-filter-btn，避免被上方
        // 主工具条的 filter 处理器截获）。
        const markFilterBtn = closest('.dead-mark-filter-btn');
        if (markFilterBtn) {
            e.preventDefault();
            // data-markfilter（无连字符）→ dataset.markfilter 全小写；写
            // dataset.markFilter（camelCase）取到 undefined → 恒回退 ''（全部），
            // 已标注/未标注点击全部失效——真实 DOM 的 dataset 键不含连字符不变驼峰。
            markFilter = markFilterBtn.dataset.markfilter || '';
            store.set('deadMarkFilter', markFilter);
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
        if (closest('.dead-clear-scan')) {
            e.preventDefault();
            clearScanResults();
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
            for (const { item } of selectableRows())
                selected.add(item.id);
            render();
            return;
        }
        if (closest('.dead-select-invert')) {
            e.preventDefault();
            for (const { item } of selectableRows()) {
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
    // (docs/plan-4.0.0/v4task-2-list.md §3.5). Consumed by keyboard.js before the
    // type-ahead gate; dead registers typeAhead:false.
    const onKey = e => {
        // 选择模式下 M/R 是单行操作，与批量选择的 membership 语义冲突——行点击
        // 此时是勾选成员，键盘不应悄悄标记/定位单行（键盘 M 会 toggleMark 聚焦
        // 行，与点选勾选不一致）。
        if (selecting)
            return false;
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
        // dupes (groups) and stats (rows) badges. The count derives from the
        // TREE-JOINED row set (allResultRows), not the raw cached verdicts:
        // a bookmark deleted after the scan drops out of the join, so a
        // stale persisted cache can never revive the old count above the
        // rows the list would actually show. No scan yet (or no join yet —
        // the view never activated this session) → 0 → hidden.
        badge: () => allResultRows().length,
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
                    invalidateResultRows(); // tree join 重建 → 结果行重算
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
                // Fold the cache in raw — marks are never pruned here (nor by
                // onCacheWritten): residue semantics keep every past mark.
                try {
                    lastScan = data[DEAD_LAST_KEY] ? JSON.parse(data[DEAD_LAST_KEY]) : null;
                } catch (e) {
                    lastScan = null;
                }
                invalidateResultRows(); // 直接读 storage 的缓存同样要失效
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
            // The marked-view tooltip banner is transient too — Esc dismisses
            // it (session semantics, same as its ×).
            if (markedBannerVisible()) {
                markedBannerDismissed = true;
                render();
                return true;
            }
            if (!live)
                return false;
            togglePause();
            return true;
        },
        onKey
    });

    // Sort dropdown wiring (see dropdown.js for the protocol). Delegated on
    // $list, so it survives the innerHTML swap on every render — the onSelect
    // re-renders synchronously, which detaches the old trigger before
    // dropdown.js's pick→close can focus it, so we re-focus the fresh trigger.
    initDropdowns($list, {
        onSelect: (dd, value) => {
            if (!dd.classList.contains('dead-sort'))
                return;
            deadSort = ['detected', 'path', 'marked'].indexOf(value) !== -1 ? value : 'detected';
            store.set('deadSort', deadSort);
            invalidateResultRows(); // 排序键变化 → 结果行重算
            render();
            const t = $list.querySelector('.dead-sort .vbm-dropdown-trigger');
            if (t && t.focus)
                t.focus();
        },
        rtl: !!(document.body && document.body.classList && document.body.classList.contains('rtl'))
    });

    return { refresh: render, refreshOverlays, isMarked, toggleMark };
}
