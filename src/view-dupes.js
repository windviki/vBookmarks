/**
 * Duplicate-bookmark cleanup view (v4 task-2, slice C — docs/v4task-2.md
 * §5.6, row spec docs/v4task-2-list.md §3.6).
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
 * and regroup on change.
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
 * Keyboard: ↑↓ walk group headers and members as one sequence (both are
 * plain focusable rows); ←/→/Space/Enter on a group header collapse/expand
 * it (handled capture-phase on the list so keyboard.js never treats the
 * header span as a folder row); K sets the focused member as keeper; R
 * reveals it in the tree; Delete on a member row rides keyboard.js's
 * treeKeyUp → actions.deleteBookmark (the undo chain) untouched.
 *
 * initViewDupes(ctx) is called once by neat.js after treeView init.
 * ctx.store            — settings mirror (dupesStrategy/dupesScope/dupesIgnoreScheme)
 * ctx.views            — view-manager API (register/isActive/pathOf/activate)
 * ctx.treeRender       — tree-render.js API (generateBookmarkHTML)
 * ctx.separatorManager — isSeparator filtering
 * ctx.treeView         — revealInTree + bookmarkHandler (click/auxclick open)
 * ctx.actions          — (unused directly; Delete rides keyboard.js)
 * ctx.dialogs          — ConfirmDialog for the batch deletions
 * ctx.undo             — capture/showToast for the serial deletion chain
 * ctx.visitStats       — slice D: initVisitStats API (countOf/enabled); the
 *                        keep-most-visited strategy reads it (absent = zeros)
 *
 * chrome.bookmarks.*, chrome.i18n.getMessage, document and setTimeout
 * remain page globals.
 */

import { findDupes, pickKeeper, planDeletion } from './dupes.js';
import { VIEW_ICONS } from './icons.js';

// Same escape recipe as the other render modules (self-contained modules).
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

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
    const dialogs = ctx.dialogs;
    const undo = ctx.undo;
    // Slice D: real visit counts for keep-most-visited; the zero-filled
    // fallback doubles as the "stats off" behavior (oldest wins the tie).
    const visitStats = ctx.visitStats || { countOf: () => 0, enabled: () => false };

    const $list = $('dupes-list');

    // --- State ----------------------------------------------------------------
    let groups = [];                 // findDupes() result backing the rows
    let itemIndex = new Map();       // id → flattened item of the last regroup
    const keepers = new Map();       // group key → manually pinned keeper item
    const collapsed = new Set();     // folded group keys
    let dirty = false;

    const strategy = () => store.get('dupesStrategy', 'keep-oldest') || 'keep-oldest';
    const scope = () => store.get('dupesScope', 'all') || 'all';
    const ignoreScheme = () => !!store.get('dupesIgnoreScheme', '');

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

    const keeperOf = group => {
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

    const doomedCount = () =>
        groups.reduce((n, g) => n + planDeletion(g, keeperOf(g)).length, 0);

    // --- Rendering --------------------------------------------------------------
    const renderToolbar = () => {
        const doomed = doomedCount();
        const statsOn = visitStats.enabled();
        let html = '<div class="dupes-toolbar">';
        html += `<select class="dupes-strategy" aria-label="${_m('dupesStrategyOldest')}">`;
        for (let i = 0; i < STRATEGIES.length; i++) {
            const [value, key] = STRATEGIES[i];
            // §5.4 联动: no visit data exists while statsEnabled is off —
            // grey out keep-most-visited instead of silently picking oldest.
            const greyed = value === 'keep-most-visited' && !statsOn;
            html += `<option value="${value}"${value === strategy() ? ' selected' : ''}` +
                `${greyed ? ' disabled' : ''}>${_m(key)}</option>`;
        }
        html += '</select>';
        html += `<select class="dupes-scope" aria-label="${_m('dupesScopeAll')}">` +
            `<option value="all"${scope() === 'all' ? ' selected' : ''}>${_m('dupesScopeAll')}</option>` +
            `<option value="bar"${scope() === 'bar' ? ' selected' : ''}>${_m('dupesScopeBar')}</option>` +
            '</select>';
        html += `<label class="dupes-scheme"><input type="checkbox"${ignoreScheme() ? ' checked' : ''}>${_m('dupesIgnoreScheme')}</label>`;
        html += `<span class="dupes-summary">${_m('dupesPreviewSummary', [`${groups.length}`, `${doomed}`])}</span>`;
        html += `<button class="dupes-apply-all"${doomed ? '' : ' disabled'}>` +
            _m('dupesApplyAll', `${doomed}`) + '</button>';
        html += '</div>';
        return html;
    };

    const renderGroup = group => {
        const keeper = keeperOf(group);
        const key = htmlspecialchars(group.key);
        const isCollapsed = collapsed.has(group.key);
        let html = `<li class="dupes-group" data-key="${key}">` +
            `<span class="group-head" tabindex="0" role="button" aria-expanded="${isCollapsed ? 'false' : 'true'}">` +
            `<span class="chevron${isCollapsed ? ' collapsed' : ''}"></span>` +
            `<span class="dupes-key" dir="auto" title="${key}">${key}</span>` +
            `<span class="count-pill" aria-label="${_m('dupesGroupCount', `${group.items.length}`)}">${group.items.length}</span>` +
            `<button class="row-btn dupes-clean-rest" aria-label="${_m('dupesGroupCleanRest')}" title="${_m('dupesGroupCleanRest')}">×</button>` +
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
                    rightText: path ? `${path} · ${shortDate}` : shortDate,
                    subText: path ? `${path} · ${fullTime}` : fullTime
                }) +
                '</li>';
        }
        return html;
    };

    const render = () => {
        let html = renderToolbar();
        if (!groups.length) {
            html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('dupesNone')}</i></li></ul>`;
        } else {
            html += '<ul role="list">';
            for (let i = 0, l = groups.length; i < l; i++)
                html += renderGroup(groups[i]);
            html += '</ul>';
        }
        $list.innerHTML = html;
    };

    const refresh = () => {
        chrome.bookmarks.getTree(tree => {
            let items = flattenTree(tree);
            if (scope() === 'bar')
                items = items.filter(item => item.inBar);
            itemIndex = new Map(items.map(item => [item.id, item]));
            groups = findDupes(items, { ignoreScheme: ignoreScheme() });
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
    const removeSequentially = items =>
        items.reduce((chain, item) => chain.then(() => new Promise(resolve => {
            undo.capture(item.id);
            chrome.bookmarks.remove(item.id, resolve);
        })), Promise.resolve());

    const confirmDeletion = (doomed, message) => {
        if (!doomed.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: message,
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                removeSequentially(doomed).then(() =>
                    undo.showToast(_m('dupesDone', `${doomed.length}`)));
                // the onRemoved listener replays the regroup by itself
            }
        });
    };

    const cleanGroup = group =>
        confirmDeletion(planDeletion(group, keeperOf(group)),
            _m('dupesConfirmGroup', `${planDeletion(group, keeperOf(group)).length}`));

    const cleanAll = () => {
        const doomed = groups.reduce((all, g) => all.concat(planDeletion(g, keeperOf(g))), []);
        confirmDeletion(doomed, _m('dupesConfirmAll', [`${doomed.length}`, `${groups.length}`]));
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

    $list.addEventListener('change', e => {
        const el = e.target;
        if (el.classList.contains('dupes-strategy')) {
            store.set('dupesStrategy', el.value);
            refresh();
        } else if (el.classList.contains('dupes-scope')) {
            store.set('dupesScope', el.value);
            refresh();
        } else if (el.closest('.dupes-scheme')) {
            store.set('dupesIgnoreScheme', el.checked ? '1' : '');
            refresh();
        }
    });

    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        if (closest('.dupes-apply-all')) {
            e.preventDefault();
            cleanAll();
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
    // trigger the folder-toggle / context-menu paths).
    $list.addEventListener('keydown', e => {
        const head = (e.target && e.target.classList && e.target.classList.contains('group-head'))
            ? e.target
            : (e.target && e.target.closest ? e.target.closest('.group-head') : null);
        if (!head)
            return;
        const li = head.closest('li');
        const key = li && li.dataset.key;
        if (!key)
            return;
        const isCollapsed = collapsed.has(key);
        const k = e.key;
        const expand = (k === ' ' || k === 'Enter' || k === 'ArrowRight') && isCollapsed;
        const collapse = (k === ' ' || k === 'Enter' || k === 'ArrowLeft') && !isCollapsed;
        if (expand || collapse) {
            e.preventDefault();
            e.stopPropagation();
            if (expand)
                collapsed.delete(key);
            else
                collapsed.add(key);
            refresh();
        }
    }, true);

    // K — pin the focused member as its group's keeper; R — reveal it in the
    // tree (docs/v4task-2-list.md §3.6). Consumed by keyboard.js before the
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
        typeAhead: false,
        badge: () => groups.length,
        activate: () => {
            if (dirty || !$list.innerHTML)
                refresh();
        },
        onKey
    });

    return { refresh, setKeeper };
}
