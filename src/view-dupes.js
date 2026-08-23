/**
 * Duplicate-bookmark cleanup view (v4 task-2, slice C — docs/plan-4.0.0/v4task-2.md
 * §5.6, row spec docs/plan-4.0.0/v4task-2-list.md §3.6).
 *
 * Migrates the palette's old mode='dupes' panel into its own tab. Groups
 * come from dupes.js's findDupes over the flattened tree (normalized-URL
 * collisions, oldest-first inside); each group has exactly one keeper —
 * picked by the persisted strategy (dupesStrategy, six rules, default
 * keep-oldest) and overridable per group by clicking the row's keeper radio
 * (a manual pick sticks across strategy changes as long as the item stays
 * in its group). Everything but the keeper renders in the will-delete
 * preview state (strikethrough + danger) — preview first, execute after.
 *
 * Toolbar (row 0): strategy <select>, scope <select> (dupesScope:
 * 'all' tree / 'bar' bookmarks-bar subtree only), the dupesIgnoreScheme
 * checkbox (fold http/https variants into one group), the preview summary
 * and the apply-all primary button. All three controls persist their value
 * and regroup on change. The 选择 button (v4 task-3 #5) swaps the whole
 * toolbar for a selection-mode batch bar: all/invert/clear over GROUPS,
 * and a dedup-selected button whose count is the live doomed total of the
 * selected groups (the sync the item asks for); one ConfirmDialog gates
 * one serial deletion chain for all of them. Group heads keep their ×
 * quick apply (cleanGroup) outside the mode; inside it every head/member
 * click toggles the group's membership and Esc exits.
 *
 * Row spec (§3.6 — the "no repeated information" rule): the group header
 * shows the normalized URL ONCE (muted, monospace); member rows never
 * repeat the URL — they carry only the discriminating slots: title, parent
 * path + dateAdded (the unified 标题+URL+路径 tooltip comes free via
 * meta.path). Rows keep real bookmark ids + data-node-id, so open /
 * context-menu / Delete ride the same chains as the other list views.
 *
 * Batch deletion (group "clean the rest" and "apply all") is
 * ConfirmDialog-gated, then runs a serial undo.capture + bookmarks.remove
 * chain with a single dupesDone toast at the end — actions.deleteBookmark
 * would fire one toast per row. The onRemoved listener replays the regroup
 * (300ms debounce), so the list rebuilds itself after the chain lands.
 *
 * Snapshot persistence (round-6 item 6): every regroup lands in the settings
 * mirror (`dupesLastResult`, JSON — same recipe as the dead view's
 * deadLastScan). init hydrates groups/itemIndex from it synchronously, so
 * reopening the popup paints the previous result set instantly; activate()
 * then re-runs the regroup against the live tree (300ms debounce) to
 * correct any drift that happened while the popup was closed. The snapshot
 * is scoped: a scope/ignoreScheme mismatch discards it (the controls
 * regrouped since).
 *
 * Keyboard: ↑↓ walk group headers and members as one sequence (both are
 * plain focusable rows); ←/→/Space/Enter on a group header collapse/expand
 * it (handled capture-phase on the list so keyboard.js never treats the
 * header span as a folder row); K sets the focused member as keeper; R
 * reveals it in the tree; Delete on a member row rides keyboard.js's
 * treeKeyUp → actions.deleteBookmark (the undo chain) untouched.
 * Right-click on a group head opens the dedicated group menu (v4 task-3
 * #16: apply dedup — label resolved live via cleanHint — and expand/
 * collapse), never the folder menu the span walk-up used to land on.
 *
 * initViewDupes(ctx) is called once by neat.js after treeView init.
 * ctx.store            — settings mirror (dupesStrategy/dupesScope/dupesIgnoreScheme/
 *                        showDupesView)
 * ctx.views            — view-manager API (register/isActive/pathOf/activate)
 * ctx.treeRender       — tree-render.js API (generateBookmarkHTML)
 * ctx.separatorManager — isSeparator filtering
 * ctx.treeView         — revealInTree + bookmarkHandler (click/auxclick open)
 * ctx.actions          — openBookmarkNewTab (risk-banner help link) and
 *                        deleteBookmark (4.0.8 per-member floating delete);
 *                        keyboard Delete still rides keyboard.js
 * ctx.dialogs          — ConfirmDialog for the batch deletions
 * ctx.undo             — capture/showToast for the serial deletion chain
 * ctx.visitStats       — slice D: initVisitStats API (countOf/enabled); the
 *                        keep-most-visited strategy reads it (absent = zeros)
 *
 * chrome.bookmarks.*, chrome.i18n.getMessage, document and setTimeout
 * remain page globals.
 */

import { findDupes, pickKeeper, planDeletion } from './dupes.js';
import { VIEW_ICONS, CHECK_ICON, CHEVRON_ICON, SELECT_ICON, TRASH_ICON } from './icons.js';
import { initDropdowns } from './dropdown.js';
import { makeRiskBanner, RISK_HELP_URL } from './risk-banner.js';
import { htmlspecialchars } from './escape.js';
import { parkRowFocus, unparkRowFocus, parkToolbarFocus, restoreToolbarFocus } from './list-focus.js';
import { paintListChunked } from './list-chunks.js';

// Group-head URL display (view-system absorption): the normalized key's
// discriminating part usually sits in the tail path, where CSS
// text-overflow would clip exactly that. Strip the scheme for display and
// mid-truncate instead — head 55% + … + tail; the full key stays in title.
export const midTruncate = (url, maxLen = 48) => {
    if (!url)
        return '';
    const display = url.replace(/^https?:\/\//, '');
    if (display.length <= maxLen)
        return display;
    const headLen = Math.floor(maxLen * 0.55);
    const tailLen = maxLen - headLen - 1; // -1 for the ellipsis char
    return display.slice(0, headLen) + '…' + display.slice(-tailLen);
};

const STRATEGIES = [
    ['keep-oldest', 'dupesStrategyOldest'],
    ['keep-newest', 'dupesStrategyNewest'],
    ['keep-bookmark-bar', 'dupesStrategyBookmarkBar'],
    ['keep-shortest-title', 'dupesStrategyShortestTitle'],
    ['keep-shallowest', 'dupesStrategyShallowest'],
    ['keep-most-visited', 'dupesStrategyMostVisited']
];

export function initViewDupes(ctx = {}) {
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
    // Slice D: real visit counts for keep-most-visited; the zero-filled
    // fallback doubles as the "stats off" behavior (oldest wins the tie).
    const visitStats = ctx.visitStats || { countOf: () => 0, enabled: () => false };
    // 第五轮项3: after every render, neat.js re-lays the dead-mark ×
    // overlays (the innerHTML swap just wiped them).
    const onRowsRendered = ctx.onRowsRendered || (() => {});

    const $list = $('dupes-list');

    // v4 task-4 #14: pre-use risk banner (bulk deletion warning +
    // backup help link); acked per major version, session × dismiss.
    const riskBanner = makeRiskBanner({ store, ackKey: 'dupesRiskAck', textKey: 'dupesRiskBanner' });

    // --- State ----------------------------------------------------------------
    let groups = [];                 // findDupes() result backing the rows
    let itemIndex = new Map();       // id → flattened item of the last regroup
    const keepers = new Map();       // group key → manually pinned keeper item
    const collapsed = new Set();     // folded group keys
    let dirty = false;
    // v4 task-3 #5 selection mode: groups (not rows) are the unit — the
    // toolbar's 选择 button swaps the toolbar for a batch bar (all/invert/
    // clear + dedup-selected with a live doomed count); head/member clicks
    // toggle the group's membership, Esc exits. Keys prune at render.
    let selecting = false;
    const selected = new Set();      // group keys
    // A head-key collapse/expand re-renders (async getTree → innerHTML swap)
    // and the head element is replaced — without this the focus drops to
    // <body> and the ←/→ key walk dies after one fold. render() restores
    // focus to the new head element for the same group key.
    let pendingHeadFocus = null;
    // v4 task-4 #8: same park-and-restore for a select-mode Space toggle
    // fired from a member row (the toggle re-renders, replacing the row).
    let pendingMemberFocus = null;
    // Selection-mode focus transitions (4.0.8): activating the 选择 button
    // swaps the toolbar away and would drop focus to <body>. Focus the
    // selection bar's first enabled control on entry, and the restored 选择
    // entry button on exit — the same law as the dead view's selection mode.
    let selectionFocus = null; // 'first' | 'entry' | null
    // The in-flight chunked paint (list-chunks.js): a new render cancels
    // the previous one's pending group batches.
    let paintHandle = null;

    const strategy = () => store.get('dupesStrategy', 'keep-oldest') || 'keep-oldest';
    const scope = () => store.get('dupesScope', 'all') || 'all';
    const ignoreScheme = () => !!store.get('dupesIgnoreScheme', '');

    // --- Snapshot persistence (round-6 item 6) --------------------------------
    // JSON in the settings mirror (chrome.storage.local via store) — the
    // dead view's deadLastScan recipe. Items serialize as plain data (they
    // already are: flattenTree's { id, title, url, dateAdded, parentId,
    // inBar }); the keeper strategy is NOT snapshotted — keeper picking
    // re-runs over the restored groups at render time.
    const CACHE_KEY = 'dupesLastResult';

    const saveCache = () => {
        try {
            store.set(CACHE_KEY, JSON.stringify({
                ts: Date.now(),
                scope: scope(),
                ignoreScheme: ignoreScheme(),
                groups: groups.map(g => ({ key: g.key, items: g.items }))
            }));
        } catch (e) { /* best-effort cache — a storage hiccup must not break the view */ }
    };

    // Synchronous restore at init (before the first activate). Returns true
    // when usable groups came back; a scope/ignoreScheme mismatch or a
    // corrupt blob simply skips (the normal refresh path recomputes).
    const hydrate = () => {
        let snap = null;
        try {
            snap = JSON.parse(store.get(CACHE_KEY, '') || 'null');
        } catch (e) {
            snap = null;
        }
        if (!snap || !Array.isArray(snap.groups))
            return false;
        if (snap.scope !== scope() || !!snap.ignoreScheme !== ignoreScheme())
            return false;
        const restored = snap.groups
            .map(g => ({ key: g.key, items: (g.items || []).filter(it => it && it.id && it.url) }))
            .filter(g => g.items.length > 1);
        if (!restored.length)
            return false;
        groups = restored;
        itemIndex = new Map();
        for (const g of groups)
            for (const item of g.items)
                itemIndex.set(item.id, item);
        return true;
    };
    const hydrated = hydrate();


    // Flatten the tree to bookmark items; inBar marks the bookmarks-bar
    // subtree ('1') — the keep-bookmark-bar strategy and the scope selector
    // both read it.
    const flattenTree = tree => {
        const items = [];
        const walk = (nodes, inBar) => {
            for (let i = 0, l = nodes.length; i < l; i++) {
                const node = nodes[i];
                const nodeInBar = inBar || node.id === '1';
                if (node.children) {
                    walk(node.children, nodeInBar);
                } else if (node.url && !separatorManager.isSeparator(node.title, node.url)) {
                    items.push({
                        id: node.id,
                        title: node.title || '',
                        url: node.url,
                        dateAdded: node.dateAdded || 0,
                        parentId: node.parentId,
                        inBar: nodeInBar
                    });
                }
            }
        };
        walk(tree || [], false);
        return items;
    };

    // ctx for pickKeeper: bar membership comes from the flatten pass, folder
    // depth from the shared path map, visit counts from slice D's stats
    // store (zeros when stats is off → the strategy falls back to oldest).
    const keeperCtx = () => ({
        inBar: id => {
            const item = itemIndex.get(id);
            return !!(item && item.inBar);
        },
        depthOf: id => {
            const path = views.pathOf(id);
            return path ? path.split(' / ').length : 0;
        },
        visitCountOf: id => visitStats.countOf(id)
    });

    // H7: per-render keeper memo. pickKeeper/planDeletion are pure over
    // (group, strategy, keeperCtx) — compute each keeper ONCE per render pass
    // instead of once per call site (toolbar, every group row, the confirm
    // paths all read the same keeper). The memo dies with the groups
    // reference it was built from (refresh() reassigns groups → rebuild).
    let keeperByGroup = null; // { groups, map } — null when not rendered yet
    const computeKeeper = group => {
        const pinned = keepers.get(group.key);
        if (pinned) {
            // refresh() re-flattens the tree, so the pinned reference goes
            // stale every regroup — match by id, not by object identity.
            const still = group.items.find(item => item.id === pinned.id);
            if (still)
                return still;
        }
        return pickKeeper(group, strategy(), keeperCtx());
    };
    const keeperOf = group => {
        if (keeperByGroup && keeperByGroup.groups === groups) {
            const memo = keeperByGroup.map.get(group.key);
            if (memo !== undefined)
                return memo;
        }
        return computeKeeper(group);
    };

    const doomedCount = () =>
        groups.reduce((n, g) => n + planDeletion(g, keeperOf(g)).length, 0);

    // --- Rendering --------------------------------------------------------------
    const renderToolbar = () => {
        if (selecting) {
            // v4 task-3 #5: the batch bar replaces the whole toolbar; the
            // apply button's count is the LIVE doomed total of the selected
            // groups (the "banner" the item text asks to keep in sync).
            let doomedSel = 0;
            for (const g of groups) {
                if (selected.has(g.key))
                    doomedSel += planDeletion(g, keeperOf(g)).length;
            }
            return '<div class="dupes-toolbar selecting-bar vbm-toolbar">' +
                `<span class="select-count">${_m('selectCount', `${selected.size}`)}</span>` +
                `<button class="dupes-select-all">${_m('selectAll')}</button>` +
                `<button class="dupes-select-invert">${_m('selectInvert')}</button>` +
                `<button class="dupes-select-clear">${_m('selectClear')}</button>` +
                `<button class="dupes-apply-selected"${doomedSel ? '' : ' disabled'}>` +
                `${_m('dupesApplySelected', `${doomedSel}`)}</button>` +
                `<button class="dupes-select-exit">${_m('selectModeExit')}</button>` +
                '</div>';
        }
        const doomed = doomedCount();
        const statsOn = visitStats.enabled();
        // Shared custom dropdowns (see dropdown.js for the keyboard protocol):
        // the native <select> could not follow the arrow contract (↑ leaves,
        // ↓ opens, → picks, ← cancels), so strategy/scope are dropdowns with
        // that exact behaviour.
        const dropdownHtml = (cls, labelKey, options, current) => {
            const curKey = (options.find(o => o[0] === current) || [])[1] || options[0][1];
            let opts = '';
            for (const [value, key, greyed] of options)
                opts += `<li role="option" tabindex="-1" data-value="${value}"` +
                    ` aria-selected="${value === current ? 'true' : 'false'}"` +
                    `${greyed ? ' class="greyed" aria-disabled="true"' : ''}>${_m(key)}</li>`;
            return `<div class="vbm-dropdown ${cls}">` +
                `<button type="button" class="vbm-dropdown-trigger" aria-haspopup="listbox" aria-expanded="false"` +
                ` aria-controls="${cls}-listbox" aria-label="${_m(labelKey)}">` +
                `<span class="vbm-dropdown-value">${_m(curKey)}</span>${CHEVRON_ICON}</button>` +
                `<ul id="${cls}-listbox" class="vbm-dropdown-list" role="listbox" aria-label="${_m(labelKey)}" hidden>` + opts + '</ul></div>';
        };
        // 4.0.8: idle toolbar is two stacked .vbm-toolbar rows (each row a
        // keyboard rung) with no separator between them — one visual block.
        const selectLabel = _m('selectModeEnter');
        const selectBtn = groups.length
            ? `<button class="dupes-select-mode" title="${htmlspecialchars(selectLabel)}" ` +
              `aria-label="${htmlspecialchars(selectLabel)}">${SELECT_ICON}</button>`
            : '';
        // Row 1 — controls: strategy dropdown + scope dropdown + scheme switch.
        let html = '<div class="dupes-toolbar dupes-controls-toolbar vbm-toolbar">';
        html += dropdownHtml('dupes-strategy', 'dupesStrategyOldest',
            // §5.4 联动: no visit data exists while statsEnabled is off —
            // grey out keep-most-visited instead of silently picking oldest.
            STRATEGIES.map(([v, k]) => [v, k, v === 'keep-most-visited' && !statsOn]),
            strategy());
        html += dropdownHtml('dupes-scope', 'dupesScopeAll',
            [['all', 'dupesScopeAll'], ['bar', 'dupesScopeBar']],
            scope());
        html += `<label class="dupes-scheme"><input type="checkbox"${ignoreScheme() ? ' checked' : ''}>${_m('dupesIgnoreScheme')}</label>`;
        html += '</div>';
        // Row 2 — summary + primary actions: X groups / Y duplicates, apply all,
        // selection mode (icon-only, tooltip reuses the original i18n copy).
        html += '<div class="dupes-toolbar dupes-actions-toolbar vbm-toolbar">';
        html += `<span class="dupes-summary">${_m('dupesPreviewSummary', [`${groups.length}`, `${doomed}`])}</span>`;
        html += `<button class="dupes-apply-all"${doomed ? '' : ' disabled'}>` +
            _m('dupesApplyAll', `${doomed}`) + '</button>';
        html += selectBtn;
        html += '</div>';
        return html;
    };

    const renderGroup = group => {
        const keeper = keeperOf(group);
        const key = htmlspecialchars(group.key);
        const isCollapsed = collapsed.has(group.key);
        const showPath = views.showItemPath();
        // The per-group quick action names its strategy pick up front
        // ("keep 〈title〉, remove the other N") — one click applies the
        // configured strategy to this group alone. v4 task-4 #9: the glyph
        // is a ✓ ("apply this group's dedup"), not a × (which read as a
        // plain delete and went unnoticed).
        const doomed = planDeletion(group, keeper).length;
        const hint = htmlspecialchars(_m('dupesCleanRestHint',
            [keeper.title || _m('noTitle'), `${doomed}`]));
        let html = `<li class="dupes-group${selecting && selected.has(group.key) ? ' sel' : ''}" data-key="${key}">` +
            `<span class="group-head" tabindex="-1" role="button" aria-expanded="${isCollapsed ? 'false' : 'true'}">` +
            `<span class="chevron${isCollapsed ? ' collapsed' : ''}"></span>` +
            `<span class="dupes-key" dir="auto" title="${key}">${htmlspecialchars(midTruncate(group.key))}</span>` +
            `<span class="count-pill" aria-label="${_m('dupesGroupCount', `${group.items.length}`)}">${group.items.length}</span>` +
            `<button class="row-btn dupes-clean-rest" aria-label="${hint}" title="${hint}">${CHECK_ICON}</button>` +
            '</span></li>';
        if (isCollapsed)
            return html;
        for (let i = 0, l = group.items.length; i < l; i++) {
            const item = group.items[i];
            const isKeeper = item === keeper;
            const path = views.pathOf(item.id);
            // §3.6: member rows carry path + dateAdded only — never the URL.
            const shortDate = new Date(item.dateAdded || 0).toLocaleDateString();
            const fullTime = new Date(item.dateAdded || 0).toLocaleString();
            html += `<li class="vbm-row dupes-member${isKeeper ? '' : ' will-delete'}" ` +
                `id="dupes-item-${item.id}" role="listitem" data-node-id="${item.id}" ` +
                `data-parentid="${item.parentId}" data-key="${key}">` +
                `<button class="keeper-radio${isKeeper ? ' checked' : ''}" ` +
                `aria-label="${_m('dupesKeepThis')}" title="${_m('dupesKeepThis')}"></button>` +
                treeRender.generateBookmarkHTML(item.title, item.url, 'data-virtual="1"', item.id, null, {
                    path,
                    // §3.6 unified meta: the date rides the left-aligned time
                    // slot (first column), the path the right-aligned row-path
                    // (second column); wide/panel keeps the date and moves path
                    // to the second line (`路径 · 时间`, same template as the
                    // recent view). The path half follows showItemPath.
                    badge: { text: shortDate, cls: 'time' },
                    rightText: (showPath && path) ? path : '',
                    subText: (showPath && path) ? `${path} · ${fullTime}` : fullTime
                }) +
                `<button class="row-btn dupes-member-del" aria-label="${_m('rowActionDelete')}" ` +
                `title="${_m('rowActionDelete')}">${TRASH_ICON}</button>` +
                '</li>';
        }
        return html;
    };

    // --- Toolbar + row focus park/restore: see src/list-focus.js -----------
    // (final polish / 4.0.1 focus law). v4 task-4 #14: the shared toolbar
    // selector includes the risk banner's controls.

    // Selection-mode focus helpers (see view-dead.js).
    const focusSelectionBarFirst = () => {
        if (typeof $list.querySelector !== 'function')
            return;
        const bar = $list.querySelector('.dupes-toolbar.selecting-bar.vbm-toolbar');
        if (!bar || typeof bar.querySelectorAll !== 'function')
            return;
        const controls = bar.querySelectorAll('button, select, input');
        for (let i = 0, l = controls.length; i < l; i++) {
            if (!controls[i].disabled) {
                controls[i].focus();
                return;
            }
        }
    };
    const focusSelectModeButton = () => {
        if (typeof $list.querySelector !== 'function')
            return;
        const btn = $list.querySelector('.dupes-select-mode');
        if (btn && btn.focus)
            btn.focus();
    };

    const render = () => {
        // H7: one strategy pass per render — every later keeperOf/planDeletion
        // read within this pass serves the memo.
        keeperByGroup = { groups, map: new Map() };
        for (const g of groups)
            keeperByGroup.map.set(g.key, computeKeeper(g));
        if (selecting) {
            // prune selected keys whose group vanished (regroup) BEFORE the
            // toolbar counts them
            const alive = new Set(groups.map(g => g.key));
            for (const key of [...selected])
                if (!alive.has(key))
                    selected.delete(key);
        }
        // 4.1.1: rows stream in chunks (list-chunks.js) — head paint is
        // synchronous (banner + toolbar + first groups), the rest appends
        // per frame. 2508-row regroups used to freeze the popup for the
        // whole parse.
        let head = riskBanner.html() + renderToolbar();
        const pieces = [];
        if (!groups.length) {
            head += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('dupesNone')}</i></li></ul>`;
        } else {
            head += `<ul role="list"${selecting ? ' class="selecting"' : ''}></ul>`;
            for (let i = 0, l = groups.length; i < l; i++)
                pieces.push(renderGroup(groups[i]));
        }
        // Focus law + chunked paint. Toolbar park/restore and the selection
        // toolbar transitions run on the head paint (the toolbar lives in
        // the head); the head/member focus restores and the row park/restore
        // retry per chunk — their targets may sit in any batch — and always
        // run at settle, where the clamped-index row restore is safe again.
        const parkedToolbar = parkToolbarFocus($list);
        let parkedRow = parkRowFocus($list);
        if (paintHandle)
            paintHandle.cancel();
        const tryHeadFocus = () => {
            if (!pendingHeadFocus)
                return;
            if (typeof $list.querySelectorAll !== 'function')
                return;
            const key = pendingHeadFocus;
            const groupLis = $list.querySelectorAll('li.dupes-group');
            for (let i = 0, l = groupLis.length; i < l; i++) {
                if (groupLis[i].dataset && groupLis[i].dataset.key === key) {
                    const headEl = groupLis[i].querySelector('.group-head');
                    if (headEl) {
                        pendingHeadFocus = null;
                        headEl.focus();
                    }
                    return;
                }
            }
        };
        const tryMemberFocus = () => {
            if (!pendingMemberFocus)
                return;
            const row = document.getElementById(`dupes-item-${pendingMemberFocus}`);
            const a = row && row.querySelector ? row.querySelector('a') : null;
            if (a) {
                pendingMemberFocus = null;
                a.focus();
            }
        };
        const tryUnparkRow = () => {
            if (!parkedRow)
                return;
            if (parkedRow.id && typeof document !== 'undefined'
                && typeof document.getElementById === 'function'
                && document.getElementById(parkedRow.id)) {
                unparkRowFocus($list, parkedRow);
                parkedRow = null;
            }
        };
        paintHandle = paintListChunked($list, {
            head,
            pieces,
            first: 30,   // groups (~1 + members rows each) in the head paint
            chunk: 60,
            onHead: el => {
                restoreToolbarFocus(el, parkedToolbar);
                onRowsRendered();
                if (selectionFocus === 'first') {
                    selectionFocus = null;
                    focusSelectionBarFirst();
                } else if (selectionFocus === 'entry') {
                    selectionFocus = null;
                    focusSelectModeButton();
                }
            },
            onChunk: () => {
                tryHeadFocus();
                tryMemberFocus();
                tryUnparkRow();
                onRowsRendered();
            },
            onSettled: el => {
                if (parkedRow) {
                    unparkRowFocus(el, parkedRow);
                    parkedRow = null;
                }
                tryHeadFocus();
                tryMemberFocus();
            }
        });
    };

    const refresh = () => {
        chrome.bookmarks.getTree(tree => {
            let items = flattenTree(tree);
            if (scope() === 'bar')
                items = items.filter(item => item.inBar);
            itemIndex = new Map(items.map(item => [item.id, item]));
            groups = findDupes(items, { ignoreScheme: ignoreScheme() });
            saveCache(); // round-6: persist every regroup for the next popup open
            // The tab badge tracks the group count even while the view is
            // hidden — recompute always, repaint only when active.
            views.updateBadges();
            if (!views.isActive('dupes')) {
                dirty = true;
                return;
            }
            dirty = false;
            render();
        });
    };

    // --- Batch deletion ------------------------------------------------------------
    // Serial chain so the backend (and the undo stack) sees one deletion at
    // a time; a single toast reports at the end (N rows, not N toasts).
    // A doomed id can vanish mid-batch (sync, another page): the remove
    // callback reads lastError so that failure neither logs an "Unchecked
    // runtime.lastError" nor counts toward the toast — the promise resolves
    // with the number of rows ACTUALLY deleted (the dead view's recipe).
    const removeSequentially = items => {
        let removed = 0;
        return items.reduce((chain, item) => chain.then(() => new Promise(resolve => {
            undo.capture(item.id);
            chrome.bookmarks.remove(item.id, () => {
                if (!chrome.runtime.lastError)
                    removed++;
                resolve();
            });
        })), Promise.resolve()).then(() => removed);
    };

    // Shared batch-delete gate: ConfirmDialog, then the serial chain, then a
    // single toast reporting the actual deletions. Every batch delete
    // appends the undo-granularity note (undo() restores only the most
    // recent deletion). `done` is the caller-specific finish (applySelected
    // leaves the selection mode — the dead view's deleteSelected recipe).
    const confirmDeletion = (doomed, message, done) => {
        if (!doomed.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: `${message}<br>${_m('undoSingleStepNote')}`,
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                removeSequentially(doomed).then(removed => {
                    undo.showToast(_m('dupesDone', `${removed}`));
                    // Rebuild the tree: the serial removal goes straight to
                    // chrome.bookmarks.remove and the tree has no onRemoved
                    // listener of its own — without this the deleted rows
                    // linger in the tree until the popup reopens.
                    chrome.bookmarks.getTree(treeView.generateTree);
                    if (done)
                        done();
                });
                // the onRemoved listener replays the regroup by itself
            }
        });
    };

    const cleanGroup = group => {
        const keeper = keeperOf(group);
        const doomed = planDeletion(group, keeper);
        // The confirm names the group's CURRENT keeper (the strategy default
        // or a manual radio pick) — the same wording the head ✓ button
        // carries as its hint. The title is user data landing in an
        // innerHTML dialog, so the assembled message takes the hint's
        // escape pass (view-dead's confirms only substitute counts).
        confirmDeletion(doomed, htmlspecialchars(_m('dupesConfirmGroup',
            [keeper.title || _m('noTitle'), `${doomed.length}`])));
    };

    const cleanAll = () => {
        const doomed = groups.reduce((all, g) => all.concat(planDeletion(g, keeperOf(g))), []);
        confirmDeletion(doomed, _m('dupesConfirmAll', [`${doomed.length}`, `${groups.length}`]));
    };

    // --- Selection mode (v4 task-3 #5) -----------------------------------------
    // `focus` names the post-render focus transition: 'first' focuses the
    // selection bar's first enabled control (activation of 选择); 'entry'
    // focuses the restored 选择 button (exit). null keeps render()'s generic
    // park/restore behavior (row Space toggle, Esc on a row, post-apply exit).
    const setSelecting = (on, focus = null) => {
        selecting = on;
        if (!on)
            selected.clear();
        if (focus)
            selectionFocus = focus;
        render();
    };

    // Dedup the selected groups: one confirm, one serial deletion chain, one
    // toast — the doomed rows of every selected group join a single plan
    // (each group's own keeper still applies). Stale keys prune at render
    // after the regroup lands. A finished apply LEAVES the mode (same rule
    // as the dead view's deleteSelected): the selection's doomed rows are
    // gone, so a zero-count selection bar would be dead weight.
    const applySelected = () => {
        const doomed = [];
        let groupCount = 0;
        for (const g of groups) {
            if (!selected.has(g.key))
                continue;
            groupCount++;
            doomed.push(...planDeletion(g, keeperOf(g)));
        }
        if (!doomed.length)
            return;
        confirmDeletion(doomed, _m('dupesConfirmSelected', [`${doomed.length}`, `${groupCount}`]),
            () => setSelecting(false));
    };

    const setKeeper = id => {
        const item = itemIndex.get(id);
        if (!item)
            return;
        const group = groups.find(g => g.items.indexOf(item) !== -1);
        if (!group)
            return;
        keepers.set(group.key, item);
        if (views.isActive('dupes')) {
            refresh();
        } else {
            dirty = true; // the activate hook replays the render
            views.activate('dupes');
        }
    };

    // v4 task-3 #16: group-level API for the group-head context menu
    // (context-menu.js resolves labels and dispatches by data-key).
    const groupByKey = key => groups.find(g => g.key === key);
    // The menu's apply-dedup label names the strategy pick up front — the
    // same sentence the × quick-action button carries as its hint.
    const cleanHint = key => {
        const group = groupByKey(key);
        if (!group)
            return '';
        const keeper = keeperOf(group);
        return _m('dupesCleanRestHint',
            [keeper.title || _m('noTitle'), `${planDeletion(group, keeper).length}`]);
    };
    const cleanGroupByKey = key => {
        const group = groupByKey(key);
        if (group)
            cleanGroup(group);
    };
    const toggleGroup = key => {
        if (!groupByKey(key))
            return;
        if (collapsed.has(key))
            collapsed.delete(key);
        else
            collapsed.add(key);
        // Same park as the keyboard fold path (4.0.1 focus law): refresh()
        // re-renders and replaces the head element — land focus back on it.
        pendingHeadFocus = key;
        refresh();
    };

    // --- Events ------------------------------------------------------------------
    // Debounced freshness while the popup stays open (same recipe as recent).
    let refreshTimer = null;
    const scheduleRefresh = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
    };
    chrome.bookmarks.onCreated.addListener(scheduleRefresh);
    chrome.bookmarks.onRemoved.addListener(scheduleRefresh);
    chrome.bookmarks.onChanged.addListener(scheduleRefresh);
    chrome.bookmarks.onMoved.addListener(scheduleRefresh);

    // Strategy/scope are custom dropdowns now (native <select> could not
    // follow the arrow protocol). The scheme checkbox stays a native control
    // (its change still fires).
    initDropdowns($list, {
        onSelect: (dd, value) => {
            if (dd.classList.contains('dupes-strategy'))
                store.set('dupesStrategy', value);
            else if (dd.classList.contains('dupes-scope'))
                store.set('dupesScope', value);
            refresh();
        },
        rtl: !!(ctx.rtl || (document.body && document.body.classList.contains('rtl')))
    });

    $list.addEventListener('change', e => {
        const el = e.target;
        if (el.closest('.dupes-scheme')) {
            store.set('dupesIgnoreScheme', el.checked ? '1' : '');
            refresh();
        }
    });

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
        if (closest('.dupes-apply-all')) {
            e.preventDefault();
            cleanAll();
            return;
        }
        // The scheme checkbox must NOT fall through to bookmarkHandler —
        // its unconditional preventDefault cancels the checkbox's native
        // toggle (the click's default action), so the box would never flip
        // and no change event would fire. Return early; the change listener
        // (registered below) repaints.
        if (closest('.dupes-scheme')) {
            return;
        }
        // v4 task-3 #5: selection mode controls + group-toggle clicks
        if (closest('.dupes-select-mode')) {
            e.preventDefault();
            setSelecting(true, 'first');
            return;
        }
        if (closest('.dupes-select-exit')) {
            e.preventDefault();
            setSelecting(false, 'entry');
            return;
        }
        if (closest('.dupes-select-all')) {
            e.preventDefault();
            for (const g of groups)
                selected.add(g.key);
            render();
            return;
        }
        if (closest('.dupes-select-invert')) {
            e.preventDefault();
            for (const g of groups) {
                if (selected.has(g.key))
                    selected.delete(g.key);
                else
                    selected.add(g.key);
            }
            render();
            return;
        }
        if (closest('.dupes-select-clear')) {
            e.preventDefault();
            selected.clear();
            render();
            return;
        }
        if (closest('.dupes-apply-selected')) {
            e.preventDefault();
            applySelected();
            return;
        }
        if (selecting) {
            // Head AND member clicks toggle the group's membership (both li
            // kinds carry data-key); everything else is swallowed (the ×
            // quick action and keeper radios are CSS-hidden in this mode).
            const li = closest('li');
            const key = li && li.dataset && li.dataset.key;
            if (key) {
                e.preventDefault();
                e.stopPropagation();
                if (selected.has(key))
                    selected.delete(key);
                else
                    selected.add(key);
                render();
            }
            return;
        }
        const cleanBtn = closest('.dupes-clean-rest');
        if (cleanBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = cleanBtn.closest('li');
            const group = groups.find(g => g.key === (li && li.dataset.key));
            if (group)
                cleanGroup(group);
            return;
        }
        // 4.0.8: per-member floating delete — directly removes this one
        // bookmark. The onRemoved listener regroups + re-renders, so a
        // 2-item group disappears entirely and the toolbar stats update in
        // real time; keeperOf falls back to the strategy pick if the deleted
        // row was the current keeper.
        const memberDel = closest('.dupes-member-del');
        if (memberDel) {
            e.preventDefault();
            e.stopPropagation();
            const li = memberDel.closest('li');
            const id = li && li.dataset.nodeId;
            if (id)
                actions.deleteBookmark(id);
            return;
        }
        const radio = closest('.keeper-radio');
        if (radio) {
            e.preventDefault();
            e.stopPropagation();
            const li = radio.closest('li');
            const id = li && li.dataset.nodeId;
            if (id) {
                const item = itemIndex.get(id);
                if (item)
                    keepers.set(li.dataset.key, item);
                refresh();
            }
            return;
        }
        const head = closest('.group-head');
        if (head) {
            e.preventDefault();
            const li = head.closest('li');
            const key = li && li.dataset.key;
            if (key) {
                if (collapsed.has(key))
                    collapsed.delete(key);
                else
                    collapsed.add(key);
                refresh();
            }
            return;
        }
        // plain member-row clicks open the bookmark like the tree does
        treeView.bookmarkHandler(e);
    });
    $list.addEventListener('auxclick', treeView.bookmarkHandler);

    // Group-header keys, capture phase: ←/→/Space/Enter collapse/expand the
    // group and must never reach keyboard.js (a span row would otherwise
    // trigger the folder-toggle / context-menu paths). In select mode Space
    // instead toggles the group's membership (v4 task-4 #8).
    $list.addEventListener('keydown', e => {
        const head = (e.target && e.target.classList && e.target.classList.contains('group-head'))
            ? e.target
            : (e.target && e.target.closest ? e.target.closest('.group-head') : null);
        if (head) {
            const li = head.closest('li');
            const key = li && li.dataset.key;
            if (!key)
                return;
            const isCollapsed = collapsed.has(key);
            const k = e.key;
            // v4 task-4 #8: in select mode Space toggles the group's
            // membership (click parity); Enter/←/→ keep their fold
            // semantics. Outside select mode Space folds, as before.
            if (selecting && k === ' ') {
                e.preventDefault();
                e.stopPropagation();
                if (selected.has(key))
                    selected.delete(key);
                else
                    selected.add(key);
                pendingHeadFocus = key;
                render();
                return;
            }
            // K18: the fold arrows mirror under RTL (visually "forward"
            // flips) — the same RTL read the member rows' back arrow below
            // uses, per keyboard-model §7's "every horizontal law mirrors".
            const isRtl = !!(document.body && document.body.classList
                && document.body.classList.contains('rtl'));
            const expand = (k === ' ' || k === 'Enter' || k === (isRtl ? 'ArrowLeft' : 'ArrowRight')) && isCollapsed;
            const collapse = (k === ' ' || k === 'Enter' || k === (isRtl ? 'ArrowRight' : 'ArrowLeft')) && !isCollapsed;
            if (expand || collapse) {
                e.preventDefault();
                e.stopPropagation();
                if (expand)
                    collapsed.delete(key);
                else
                    collapsed.add(key);
                // refresh() re-renders async and replaces the head element —
                // park the key so render() can restore focus to the new head.
                pendingHeadFocus = key;
                refresh();
            }
            return;
        }
        // Member-row keys (final-polish pass, v4task-2-list §2.3/§3.6 — the
        // two confirmed conflicts): the row's firstElementChild is the
        // keeper radio, so keyboard.js's generic Enter/Space synthetic click
        // would SET THE KEEPER instead of opening the bookmark; open through
        // the anchor here. The "back" arrow (RTL-aware) jumps to the owning
        // group head — the generic fallback would try to focus the hidden
        // tree view's folder row, a no-op outside the tree.
        const memberLi = e.target && e.target.closest ? e.target.closest('li.dupes-member') : null;
        if (!memberLi)
            return;
        if (e.target.classList && e.target.classList.contains('keeper-radio'))
            return; // focus on the radio itself: native button toggles keeper
        const k = e.key;
        // v4 task-4 #8: in select mode Space toggles the owning group's
        // membership (click parity) instead of opening the bookmark.
        if (selecting && k === ' ') {
            const key = memberLi.dataset.key;
            if (!key)
                return;
            e.preventDefault();
            e.stopPropagation();
            if (selected.has(key))
                selected.delete(key);
            else
                selected.add(key);
            pendingMemberFocus = memberLi.dataset.nodeId;
            render();
            return;
        }
        if (k === 'Enter' || k === ' ') {
            const a = memberLi.querySelector('a');
            if (!a)
                return;
            e.preventDefault();
            e.stopPropagation();
            a.dispatchEvent(new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                metaKey: e.metaKey
            }));
        } else {
            const isRtl = !!(document.body && document.body.classList
                && document.body.classList.contains('rtl'));
            if (k === (isRtl ? 'ArrowRight' : 'ArrowLeft')) {
                let headEl = null;
                const groupLis = $list.querySelectorAll('li.dupes-group');
                for (let i = 0, l = groupLis.length; i < l; i++) {
                    if (groupLis[i].dataset && groupLis[i].dataset.key === memberLi.dataset.key) {
                        headEl = groupLis[i].querySelector('.group-head');
                        break;
                    }
                }
                if (!headEl)
                    return;
                e.preventDefault();
                e.stopPropagation();
                headEl.focus();
            }
        }
    }, true);

    // K — pin the focused member as its group's keeper; R — reveal it in the
    // tree (docs/plan-4.0.0/v4task-2-list.md §3.6). Consumed by keyboard.js before the
    // type-ahead gate; dupes registers typeAhead:false.
    const onKey = e => {
        const k = e.key;
        if (k !== 'k' && k !== 'K' && k !== 'r' && k !== 'R')
            return false;
        const item = document.activeElement;
        const li = item && item.closest ? item.closest('[data-node-id]') : null;
        const id = li && li.dataset.nodeId;
        if (!id)
            return false;
        e.preventDefault();
        if (k === 'k' || k === 'K')
            setKeeper(id);
        else
            treeView.revealInTree(id);
        return true;
    };

    views.register({
        id: 'dupes',
        titleKey: 'viewDupes',
        icon: VIEW_ICONS.dupes,
        container: $('view-dupes'),
        listEl: $list,
        hidden: !store.get('showDupesView', '1'), // showDupesView → tab visibility
        showKey: 'showDupesView',
        disableKey: 'disableDupesView',
        typeAhead: false,
        badge: () => groups.length,
        activate: ({ preset } = {}) => {
            // v4 task-4 #6: the palette custom-command view-preset channel —
            // '/clean' lands here with e.g. { strategy:'keep-newest',
            // scope:'all' }. Unknown values fall off (the selects own the
            // value lists); an applied preset forces a regroup.
            if (preset) {
                let applied = false;
                if (preset.strategy && STRATEGIES.some(s => s[0] === preset.strategy)) {
                    store.set('dupesStrategy', preset.strategy);
                    applied = true;
                }
                if (preset.scope === 'all' || preset.scope === 'bar') {
                    store.set('dupesScope', preset.scope);
                    applied = true;
                }
                if (applied)
                    dirty = true;
            }
            if (dirty || !groups.length) {
                // nothing hydrated (or bookmark events fired): compute now
                refresh();
            } else if (!$list.innerHTML) {
                // Hydrated snapshot: paint instantly, then revalidate against
                // the live tree (drift while the popup was closed).
                render();
                scheduleRefresh();
            }
        },
        // v4 task-3 #5: while selecting, Esc leaves the mode (the selection
        // goes with it) — same layered Esc contract as the dead view.
        onEscape: () => {
            if (!selecting)
                return false;
            // Keyboard exit: toolbar focus returns to the restored 选择
            // button; a row-focused Esc keeps the row via the park path.
            const ae = document.activeElement;
            const inToolbar = ae && ae.closest ? ae.closest('.vbm-toolbar') : null;
            setSelecting(false, inToolbar ? 'entry' : null);
            return true;
        },
        onKey
    });
    if (hydrated)
        views.updateBadges(); // dupes was unregistered during hydrate()

    return {
        refresh,
        setKeeper,
        // v4 task-3 #16: the group-head context menu reads/dispatches these
        cleanHint,
        isCollapsed: key => collapsed.has(key),
        cleanGroup: cleanGroupByKey,
        toggleGroup
    };
}
