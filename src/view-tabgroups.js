/**
 * Tab groups view (docs/plan-4.1.0/tab-groups-view-design.md) — browser tabs + tab groups
 * + bookmarks, living between the search and recent views.
 *
 * Renders every normal browser window's tabs in tab-strip order, the current
 * window first. Each window is a foldable section whose WHOLE head row is the
 * fold control (a focusable role=button row, so the keyboard model reaches it
 * like a tree folder); the current window is open by default and the others
 * fold, with an explicit fold/unfold remembered for next time. Tabs that
 * belong to a Chrome tab group render under a group header (title, color dot,
 * count, go-to/rename/sleep/save/close actions — the last three sharing the
 * member rows' column order); ungrouped tabs render as plain rows in the same
 * order. Every row ends with the same four icon columns — pin / sleep /
 * bookmark / close — so the columns line up on every row and in selection
 * mode (where they render as inert state markers): the SOLID pin marks the
 * pinned state and unpins on click (a hollow pin on hover pins an unpinned
 * row), the crescent is hollow while the tab is awake and filled (click =
 * wake) once it sleeps, and the filled ★ removes the bookmark again
 * (undo-captured).
 *
 * The view offers a dupes-style selection mode for batch tab management: new
 * tab group / open into an existing group (with a copy-vs-move choice for
 * tabs that already belong to a group), close, sleep, and save the selection
 * as a bookmark folder. Entering it opens every fold (a batch bar must show
 * its candidates) and leaving it restores the previous folds.
 *
 * Closed tab groups and closed single tabs are kept as our OWN records
 * ("recently closed"), so their close time is always known and shown:
 * relative inline in a narrow popup, absolute on the second line when wide.
 *
 * All tab batch operations are sent to the service worker
 * (src/tab-groups-sw.js) so the popup can close mid-operation without
 * dropping callbacks.
 */

import { VIEW_ICONS, STAR_ICON, STAR_ICON_FILLED, SELECT_ICON, FOLDER_STAR_ICON, EDIT_ICON, SLEEP_ICON, SLEEP_ICON_FILLED, ACTIVATE_ICON, TRASH_ICON, REDO_ICON, COLLAPSE_ALL_ICON, EXPAND_ALL_ICON, PIN_ICON, PIN_ICON_FILLED, STAGE_ICON, STAGE_ICON_DONE } from './icons.js';
import { htmlspecialchars } from './escape.js';
import { parkRowFocus, unparkRowFocus, parkToolbarFocus, restoreToolbarFocus } from './list-focus.js';
import { paintListChunked } from './list-chunks.js';
import { paintListVirtual } from './virtual-list.js';
import { saveSession, sessionFolderName, tabsToBookmarks } from './session.js';
import { relTimeLabel } from './tree-render.js';
import { pickGroupColor, saveTabGroupFolderMeta, pruneTabGroupFolderMeta } from './tab-group-utils.js';
import { TAB_GROUP_MSG } from './tab-groups-sw.js';

export function initViewTabGroups(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const views = ctx.views;
    const treeRender = ctx.treeRender;
    const dialogs = ctx.dialogs;
    const undo = ctx.undo || { showToast: () => {}, toastAction: () => {} };
    // Tree invalidation after a quick-add bookmark (neat.js injects the
    // standard getTree → generateTree chain; optional in tests).
    const onChanged = ctx.onChanged || (() => {});
    const onRowsRendered = ctx.onRowsRendered || (() => {});
    // Remember-state switch (same option as the tree/search view state).
    const rememberState = ctx.getRememberState || (() => true);

    const $list = $('tabgroups-list');

    const rootFolderId = () => store.get('quickAddFolderId', '1') || '1';
    // Collapse/expand sync (toolbar option, default OFF): when off, folding
    // groups in the view is local-only and never updates chrome.tabGroups.
    const syncCollapse = () => !!store.get('tabGroupsSyncCollapse', '');
    // Group color decoration (options page) — one of three:
    //   'off'  color dot only;
    //   'edge' a 3px band in the group color down the header + member rows
    //          (the original tabGroupsColorBorder switch);
    //   'line' a color CONNECTOR line under the group head's dot with a
    //          per-row tick, tying the whole group into one tree.
    // Since the 4.1.0 polish round the default is 'line' (it reads best at
    // every width and makes membership unambiguous). The legacy boolean key
    // is read as 'edge' so an existing profile keeps the look it had before
    // the style choice existed; an explicit 'off' still wins.
    const colorStyle = () => {
        const v = store.get('tabGroupsColorStyle', '');
        if (v === 'edge' || v === 'line' || v === 'off')
            return v;
        return store.get('tabGroupsColorBorder', '') ? 'edge' : 'line';
    };

    // --- State ----------------------------------------------------------------
    let refreshToken = 0;   // monotonic refresh generation: stale async
                            // tabs/tabGroups callbacks must never overwrite
                            // a newer refresh
    let windows = [];       // [{ id, focused, tabs }] sorted: current first
    let tabs = [];          // flat chrome.tabs.Tab[] across every window
    let groups = [];        // chrome.tabGroups.TabGroup[] across every window
    // String(id) → item indexes over tabs/groups. The old per-call
    // `array.find` scans made every grouped row O(groups) (and the render
    // walk O(tabs × groups)) — at 160 groups × 1200 tabs the profiler put
    // several ms per render into the scans alone, growing quadratically
    // with the group count. Rebuilt wherever the arrays are assigned.
    let tabMap = new Map();
    let groupMap = new Map();
    const reindexTabs = () => {
        tabMap = new Map();
        for (const t of tabs)
            tabMap.set(String(t.id), t);
    };
    const reindexGroups = () => {
        groupMap = new Map();
        for (const g of groups)
            groupMap.set(String(g.id), g);
    };
    // The bookmark-tree walk (bookmarkedUrls + folder-meta prune) costs a
    // full chrome.bookmarks.getTree round trip — measured 53-106 ms per
    // refresh at 6000 bookmarks. Tab-only churn (the common storm while the
    // view is open) cannot change it: re-walk only after a bookmarks event.
    let bookmarksDirty = true;
    let currentWindowId = null;
    let currentTabId = null;
    let selecting = false;
    const selected = new Set();   // tab ids
    const collapsed = new Set();  // group ids
    const collapsedWindows = new Set(); // window ids folded right now
    // EXPLICIT window fold choices only (id → true collapsed / false open).
    // The default is derived per refresh — the current window is open, the
    // others fold — so a remembered choice is exactly what the user did,
    // never the default. Without this split a session that folded the other
    // windows persisted "current window collapsed" as soon as window ids
    // were reused by a later browser session.
    const windowChoice = new Map();
    const expandedClosed = new Set();   // closed-record ids (view-local expand)
    let bookmarkedUrls = new Set(); // tab URLs that already exist as bookmarks
    let closedRecords = [];       // saved closed tab groups (our own records)
    let dragTabId = null;
    // First-activation scroll (design §7): the current tab's row scrolls into
    // view once the first render after the FIRST activation lands (`nearest`
    // — a row already visible never moves). Later activations leave the
    // view-manager's scroll/focus memory alone.
    let initialScrollDone = false;
    let pendingScrollToCurrent = false;
    // In-view instant filter (session-only, never persisted): matches tab
    // title + URL, hides non-matching rows/groups/windows, and force-expands
    // folds while active — a find operation must never hide a hit behind a
    // fold (same philosophy as selection mode opening every fold).
    let filterText = '';
    // Fold state saved when selection mode opens everything up, restored on
    // exit (selection mode must show every candidate row).
    let foldSnapshot = null;
    // The in-flight chunked paint (list-chunks.js): a new render cancels
    // the previous one's pending row batches.
    let paintHandle = null;
    // Fold spans for the LAB virtual painter (rebuilt every render): gid /
    // window id → [members piece from, to) — a fold hides/shows exactly that
    // piece range through the painter's fold().
    let groupFoldSpans = new Map();
    let windowFoldSpans = new Map();
    // A fold while the chunked stream is still landing rows cancels it and
    // repaints with the new fold state — surgery assumes a settled DOM: a
    // pending batch could re-append the just-folded members after the
    // surgical removal. paintHandle alone can't say "streaming" (the sync
    // degrade path fires onSettled DURING the paint call, before the handle
    // assignment completes), so the settle flag carries the truth.
    let paintSettled = true;
    const foldDuringStream = () => {
        if (!paintHandle || paintSettled)
            return false;
        paintHandle.cancel();
        paintHandle = null;
        return true;
    };
    // LAB virtual painter flag (options 实验室, default off). The windowed
    // painter never keeps the full list in the DOM, so fold surgery (which
    // inserts/removes rows in place) must yield to a full render there.
    const virtualLab = () => !!store.get('virtualScrollLab', '');

    const CLOSED_GROUPS_KEY = 'tabGroupsClosed';
    const UI_STATE_KEY = 'tabGroupsViewState';
    const readUIState = () => {
        if (!rememberState())
            return {};
        try {
            const obj = JSON.parse(store.get(UI_STATE_KEY, '') || '{}');
            return obj && typeof obj === 'object' ? obj : {};
        } catch (e) {
            return {};
        }
    };
    const writeUIState = ui => {
        if (!rememberState())
            return;
        try {
            store.set(UI_STATE_KEY, JSON.stringify(ui));
        } catch (e) { /* best-effort */ }
    };
    const persistUIState = () => {
        // Selection mode force-opens every fold (see setSelecting) — writing
        // that transient state would erase the user's real fold choices.
        if (selecting)
            return;
        const windowChoices = {};
        for (const [id, folded] of windowChoice)
            windowChoices[id] = !!folded;
        writeUIState({
            windowChoices,
            expandedClosed: [...expandedClosed],
            collapsedGroups: [...collapsed]
        });
    };
    const readClosedGroups = () => {
        try {
            const list = JSON.parse(store.get(CLOSED_GROUPS_KEY, '') || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    };
    const writeClosedGroups = list => {
        try {
            store.set(CLOSED_GROUPS_KEY, JSON.stringify(list));
        } catch (e) { /* best-effort */ }
    };
    // Newest first, capped by the options-page setting (default 10).
    const persistClosedGroups = list => {
        const limit = Math.max(1, parseInt(store.get('tabGroupsClosedLimit', '10'), 10) || 10);
        const capped = (list || []).slice()
            .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
            .slice(0, limit);
        writeClosedGroups(capped);
        return capped;
    };

    const groupById = id => groupMap.get(String(id));
    const tabById = id => tabMap.get(String(id));
    // Chrome reports groupId: -1 for tabs that are NOT grouped; every
    // truthiness check must treat -1 as "no group".
    const isGrouped = tab => !!tab && !!tab.groupId && tab.groupId !== -1;

    // Instant filter: case-insensitive substring over title + URL.
    const filterNeedle = () => filterText.trim().toLowerCase();
    const tabMatchesNeedle = (tab, needle) => !needle
        || `${tab.title || ''}\n${tab.url || ''}`.toLowerCase().includes(needle);

    // Walk the bookmark tree once per refresh: remember which URLs are
    // already bookmarked (row star state) and which folder ids are alive
    // (the tab-group folder meta is pruned against the live set, so a folder
    // deleted anywhere never leaves residue).
    const collectTreeSets = tree => {
        const urls = new Set();
        const folderIds = new Set();
        const walk = nodes => {
            for (let i = 0, l = (nodes || []).length; i < l; i++) {
                const node = nodes[i];
                if (node.children) {
                    if (node.id !== undefined && node.id !== null)
                        folderIds.add(String(node.id));
                    walk(node.children);
                } else if (node.url) {
                    urls.add(node.url);
                }
            }
        };
        walk(tree || []);
        return { urls, folderIds };
    };

    // --- Data -----------------------------------------------------------------
    const queryAllGroups = cb => {
        if (chrome.tabGroups && chrome.tabGroups.query)
            chrome.tabGroups.query({}, cb);
        else
            cb([]);
    };

    const sortTabs = list => (list || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));

    // Read every normal browser window with its populated tabs, sorted with
    // the current window first. The current window comes from
    // chrome.windows.getLastFocused — the `focused` flag on getAll's results
    // is a snapshot that can be stale at popup open (a freshly-activated
    // window still reporting unfocused, so the OTHER window won the sort and
    // wore the 当前 pill). Fallback: the pre-existing current-window
    // tabs.query path (old Chrome / minimal tests).
    const readWindows = cb => {
        if (chrome.windows && chrome.windows.getAll) {
            const withAll = focusedId => {
                chrome.windows.getAll({ populate: true }, wins => {
                    const all = (wins || [])
                        .filter(w => w && w.tabs && w.tabs.length && (!w.type || w.type === 'normal'))
                        .map(w => ({
                            id: w.id,
                            focused: focusedId !== null && focusedId !== undefined
                                ? w.id === focusedId
                                : !!w.focused,
                            tabs: sortTabs(w.tabs)
                        }))
                        .sort((a, b) => {
                            if (a.focused && !b.focused)
                                return -1;
                            if (!a.focused && b.focused)
                                return 1;
                            return Number(a.id) - Number(b.id);
                        });
                    cb(all.length ? all : []);
                });
            };
            if (chrome.windows.getLastFocused) {
                chrome.windows.getLastFocused(win => {
                    withAll(chrome.runtime.lastError || !win ? null : win.id);
                });
                return;
            }
            withAll(null);
            return;
        }
        chrome.tabs.query({ currentWindow: true }, tabList => {
            const tabs = sortTabs(tabList);
            const id = tabs.length ? tabs[0].windowId
                : ((chrome.windows && chrome.windows.WINDOW_ID_CURRENT) || 1);
            cb([{ id, focused: true, tabs }]);
        });
    };

    const refresh = () => {
        const token = ++refreshToken;
        if (!views.isActive('tabgroups')) {
            // H9: count-only — the badge reads tabs.length, and the heavy
            // queries (queryAllGroups / readClosedGroups) plus the fold-state
            // reconciliation are render inputs the inactive view doesn't
            // need. tabs.onUpdated storms in background windows no longer pay
            // two full query rounds every 300 ms.
            chrome.tabs.query({}, tabList => {
                if (token !== refreshToken)
                    return;
                tabs = tabList || [];
                reindexTabs();
                views.updateBadges();
            });
            return;
        }
        // The three render inputs are independent reads — fire them
        // together. The old chain serialized windows.getAll →
        // tabGroups.query → bookmarks.getTree (three IPC round trips end to
        // end; the outer two measured ~100 ms combined per refresh at
        // 1200 tabs / 6000 bookmarks), and tab-only churn paid all three.
        // Now the tree read joins the fan-out AND is skipped entirely while
        // bookmarksDirty is false (only bookmarks events flip it).
        const treeWanted = bookmarksDirty;
        let winList = null, groupList = null, tree = null;
        let landed = 0;
        const need = 2 + (treeWanted ? 1 : 0);
        const join = () => {
            windows = winList;
            tabs = windows.flatMap(w => w.tabs.map(t => ({ ...t, _windowId: t.windowId || w.id })));
            reindexTabs();
            const focused = windows.find(w => w.focused) || windows[0];
            currentWindowId = focused ? focused.id
                : ((chrome.windows && chrome.windows.WINDOW_ID_CURRENT) || 1);
            const activeTab = tabs.find(t => t.active);
            currentTabId = activeTab ? activeTab.id : (tabs[0] && tabs[0].id);
            groups = groupList || [];
            reindexGroups();
            // Keep the list folding in sync with the browser's own
            // collapsed state (chrome.tabGroups.TabGroup.collapsed).
            collapsed.clear();
            for (const g of groups)
                if (g.collapsed)
                    collapsed.add(String(g.id));

            // Restore (or default) the view-local folding state.
            // Windows: the CURRENT window is open by default and the
            // others fold; only an explicit fold/unfold the user
            // performed is remembered and wins over that default (with
            // remember-state on). Group folds follow the browser when
            // sync is on; when sync is off the saved view override
            // survives refreshes.
            const uiState = readUIState();
            // With remember-state ON the persisted choices are the truth;
            // with it OFF nothing is stored, so THIS session's in-memory
            // choices must survive the refresh — a tab event fires a
            // refresh every 300 ms, and rebuilding from an empty state
            // would undo the fold the user just performed.
            if (rememberState()) {
                windowChoice.clear();
                if (uiState.windowChoices && typeof uiState.windowChoices === 'object') {
                    for (const id of Object.keys(uiState.windowChoices))
                        windowChoice.set(String(id), !!uiState.windowChoices[id]);
                } else if (Array.isArray(uiState.collapsedWindows)) {
                    // Legacy shape (a flat collapsed list): read every entry
                    // as an explicit fold so an upgrade keeps the folds.
                    for (const id of uiState.collapsedWindows)
                        windowChoice.set(String(id), true);
                }
            }
            collapsedWindows.clear();
            for (const w of windows) {
                const id = String(w.id);
                const folded = windowChoice.has(id) ? windowChoice.get(id) : !w.focused;
                if (folded)
                    collapsedWindows.add(id);
            }
            expandedClosed.clear();
            if (Array.isArray(uiState.expandedClosed))
                for (const id of uiState.expandedClosed)
                    expandedClosed.add(String(id));
            if (!syncCollapse() && Array.isArray(uiState.collapsedGroups)) {
                for (const g of groups) {
                    const gid = String(g.id);
                    if (uiState.collapsedGroups.indexOf(gid) !== -1)
                        collapsed.add(gid);
                    else
                        collapsed.delete(gid);
                }
            }
            // Selection mode shows every candidate row: a refresh that
            // lands mid-selection must not re-fold what setSelecting
            // opened (tab events fire constantly while selecting).
            if (selecting) {
                collapsed.clear();
                collapsedWindows.clear();
            }

            closedRecords = readClosedGroups()
                .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
            if (treeWanted) {
                const sets = collectTreeSets(tree);
                bookmarkedUrls = sets.urls;
                pruneTabGroupFolderMeta(store, sets.folderIds);
                bookmarksDirty = false;
            }
            views.updateBadges();
            if (!views.isActive('tabgroups'))
                return;
            render();
        };
        const step = () => {
            if (++landed === need)
                join();
        };
        readWindows(list => {
            if (token !== refreshToken)
                return; // a newer refresh started — drop this stale read
            winList = list || [];
            step();
        });
        queryAllGroups(list => {
            if (token !== refreshToken)
                return;
            groupList = list || [];
            step();
        });
        if (treeWanted) {
            chrome.bookmarks.getTree(t => {
                if (token !== refreshToken)
                    return;
                tree = t;
                step();
            });
        }
    };

    // --- Rendering --------------------------------------------------------------
    const iconBtn = (cls, icon, labelKey, disabled) => {
        const label = _m(labelKey);
        return `<button class="${cls} tabgroups-icon-btn" title="${htmlspecialchars(label)}" ` +
            `aria-label="${htmlspecialchars(label)}"${disabled ? ' disabled' : ''}>${icon}</button>`;
    };

    const renderToolbar = () => {
        if (selecting) {
            const sel = selected.size;
            const hasSel = sel > 0;
            // Two-row batch bar, the dupes recipe: row 1 is selection-only
            // (count + all/invert/clear + exit), row 2 is the batch actions.
            // Each row is its own .vbm-toolbar keyboard rung.
            return '<div class="tabgroups-toolbar tabgroups-select-toolbar selecting-bar vbm-toolbar">' +
                `<span class="select-count">${_m('selectCount', `${sel}`)}</span>` +
                `<button class="tabgroups-select-all">${_m('selectAll')}</button>` +
                `<button class="tabgroups-select-invert">${_m('selectInvert')}</button>` +
                `<button class="tabgroups-select-clear">${_m('selectClear')}</button>` +
                `<button class="tabgroups-select-exit">${_m('selectModeExit')}</button>` +
                '</div>' +
                '<div class="tabgroups-toolbar tabgroups-actions-toolbar selecting-bar vbm-toolbar">' +
                `<button class="tabgroups-new-group"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectNewGroup')}</button>` +
                `<button class="tabgroups-open-into"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectOpenInto')}</button>` +
                `<button class="tabgroups-add-bookmarks"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectAddBookmarks')}</button>` +
                `<button class="tabgroups-save-folder"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectSaveFolder')}</button>` +
                `<button class="tabgroups-sleep-selected"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectSleep')}</button>` +
                `<button class="tabgroups-close-selected"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectClose')}</button>` +
                '</div>';
        }
        // Idle toolbar: two stacked .vbm-toolbar rows (the dead/dupes
        // recipe). Row 1 = view controls (summary left, refresh/fold icons
        // right); row 2 = view options (collapse-sync checkbox left, then
        // the instant tab filter; the select-mode icon right).
        const syncLabel = _m('tabGroupsSyncCollapse');
        const syncHint = _m('tabGroupsSyncCollapseHint');
        const filterLabel = _m('tabGroupsFilterPlaceholder');
        const filterClearLabel = _m('searchClear');
        return '<div class="tabgroups-toolbar tabgroups-controls-toolbar vbm-toolbar">' +
            `<span class="tabgroups-summary">${_m('tabGroupsSummary', [`${tabs.length}`, `${groups.length}`])}</span>` +
            iconBtn('tabgroups-refresh', REDO_ICON, 'tabGroupsToolbarRefresh') +
            // The fold buttons stand down while a filter is active (folds
            // are inert — the filter force-expands every group and window).
            iconBtn('tabgroups-collapse-all', COLLAPSE_ALL_ICON, 'tabGroupsCollapseAll', !!filterNeedle()) +
            iconBtn('tabgroups-expand-all', EXPAND_ALL_ICON, 'tabGroupsExpandAll', !!filterNeedle()) +
            '</div>' +
            '<div class="tabgroups-toolbar tabgroups-actions-toolbar vbm-toolbar">' +
            `<span class="tabgroups-options" role="group" aria-label="${htmlspecialchars(_m('tabGroupOptions'))}">` +
            `<label class="tabgroups-sync-collapse" title="${htmlspecialchars(syncHint)}">` +
            `<input type="checkbox" class="tabgroups-sync-collapse-input"${syncCollapse() ? ' checked' : ''}>` +
            `<span>${htmlspecialchars(syncLabel)}</span></label>` +
            '</span>' +
            // The instant filter carries a trailing-edge clear × (the header
            // search box recipe) while it holds text — Esc was the only
            // implicit clear before, and a visible affordance beats a
            // hidden one.
            `<span class="tabgroups-filter-field">` +
            `<input type="text" class="tabgroups-filter-input" placeholder="${htmlspecialchars(filterLabel)}" ` +
            `aria-label="${htmlspecialchars(filterLabel)}" value="${htmlspecialchars(filterText)}">` +
            (filterText
                ? `<button class="tabgroups-filter-clear" aria-label="${htmlspecialchars(filterClearLabel)}" title="${htmlspecialchars(filterClearLabel)}">` +
                  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
                  '</button>'
                : '') +
            `</span>` +
            iconBtn('tabgroups-select-mode', SELECT_ICON, 'selectModeEnter') +
            '</div>';
    };

    // Per-render row label cache (i18n hoisting): every row used to
    // re-ask chrome.i18n for the same handful of strings (7+ getMessage
    // crossings per row) — resolve once per render (and once per surgical
    // fold) instead.
    const tabgroupsLabels = () => ({
        currentTab: _m('tabGroupsCurrentTab'),
        pinned: _m('tabGroupsPinned'),
        discarded: _m('tabGroupsDiscarded'),
        bookmarked: _m('tabGroupsBookmarked'),
        noTitle: _m('noTitle'),
        unpin: _m('tabGroupsUnpinTab'),
        pin: _m('tabGroupsPinTab'),
        wake: _m('tabGroupsWakeTab'),
        sleep: _m('tabGroupsSleepTab'),
        removeBookmark: _m('tabGroupsRemoveBookmark'),
        addBookmark: _m('tabGroupsAddBookmark'),
        stage: _m('tabRowStage'),
        close: _m('tabGroupsSelectClose')
    });

    const groupHeadHtml = (group, memberTabs, G) => {
        const gid = String(group.id);
        // Folds are inert while the filter is active — a find never hides
        // hits behind a fold, and the head renders expanded accordingly.
        const isCollapsed = !filterNeedle() && collapsed.has(gid);
        const title = group.title || G.untitled;
        const color = group.color || 'grey';
        // Group sleep is a real toggle, like the member rows': every member
        // asleep → filled glyph + wake, otherwise hollow glyph + sleep.
        const allAsleep = memberTabs.length > 0 && memberTabs.every(t => !!t.discarded);
        const sleepLabel = allAsleep ? G.wake : G.sleep;
        // Staged indicator: every bookmarkable member already staged → the
        // filled plane, always on (the staging view's .staged law).
        const groupStaged = memberTabs.some(t => bookmarkableUrl(t.url))
            && memberTabs.filter(t => bookmarkableUrl(t.url)).every(t => isStagedUrl(t.url));
        const groupStageLabel = G.stage;
        // Button order (4.1.0 alignment pass): the three actions a group
        // shares with a single tab read RIGHT-to-left as close (删除) /
        // save-as-folder (收藏) / sleep (睡眠) — the same order and the
        // same 20px columns as the member rows' [sleep][star][close] tail,
        // so the glyphs line up vertically. The group-specific actions
        // (go-to, rename) keep their places to the left of that tail.
        return `<li class="tabgroups-group tg-${htmlspecialchars(color)}${selecting && memberTabs.every(t => selected.has(String(t.id))) ? ' sel' : ''}" id="tabgroups-group-${gid}" data-group-id="${gid}">` +
            `<span class="tabgroups-group-head" tabindex="-1" role="button" aria-expanded="${isCollapsed ? 'false' : 'true'}" title="${htmlspecialchars(title)}">` +
            `<span class="chevron${isCollapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            `<span class="tab-group-dot tg-${htmlspecialchars(color)}"></span>` +
            `<span class="tabgroups-group-title" dir="auto">${htmlspecialchars(title)}</span>` +
            `<span class="count-pill" aria-label="${htmlspecialchars(G.count(`${memberTabs.length}`))}">${memberTabs.length}</span>` +
            `<button class="row-btn tabgroups-group-activate" aria-label="${htmlspecialchars(G.activate)}" title="${htmlspecialchars(G.activate)}">${ACTIVATE_ICON}</button>` +
            `<button class="row-btn tabgroups-group-rename" aria-label="${htmlspecialchars(G.rename)}" title="${htmlspecialchars(G.rename)}">${EDIT_ICON}</button>` +
            `<button class="row-btn tabgroups-group-sleep${allAsleep ? ' asleep' : ''}" aria-pressed="${allAsleep}" aria-label="${htmlspecialchars(sleepLabel)}" title="${htmlspecialchars(sleepLabel)}">${allAsleep ? SLEEP_ICON_FILLED : SLEEP_ICON}</button>` +
            `<button class="row-btn tabgroups-group-save" aria-label="${htmlspecialchars(G.save)}" title="${htmlspecialchars(G.save)}">${FOLDER_STAR_ICON}</button>` +
            (relayOn() ? `<button class="row-btn tabgroups-group-stage${groupStaged ? ' staged always-on' : ''}" aria-pressed="${groupStaged}" aria-label="${htmlspecialchars(groupStageLabel)}" title="${htmlspecialchars(groupStageLabel)}">${groupStaged ? STAGE_ICON_DONE : STAGE_ICON}</button>` : '') +
            `<button class="row-btn tabgroups-group-close" aria-label="${htmlspecialchars(G.close)}" title="${htmlspecialchars(G.close)}">${TRASH_ICON}</button>` +
            '</span></li>';
    };

    // An empty 20px slot: keeps the four row-icon columns (pin / sleep /
    // bookmark / close) aligned on EVERY row and in both modes, so a row
    // without a pin or a bookmark does not shift its neighbours' glyphs.
    const emptySlot = () => '<span class="tabgroups-slot" aria-hidden="true"></span>';

    // The row's trailing icon strip. Non-selection mode renders live
    // controls (state glyph = click toggles that state); selection mode
    // renders the SAME columns as inert state markers, so the row
    // geometry is identical in both modes (only the batch bar acts there).
    // The stage column sits between the bookmark star and close (the same
    // slot order the group head uses) and follows the .staged law: staged →
    // the filled plane, always on in accent; otherwise a hover-revealed
    // hollow plane.
    const rowIcons = (tab, L = {}) => {
        const pinned = !!tab.pinned;
        const discarded = !!tab.discarded;
        const bookmarked = bookmarkedUrls.has(tab.url || '');
        const staged = isStagedUrl(tab.url);
        const pinnedLabel = L.pinned || _m('tabGroupsPinned');
        const discardedLabel = L.discarded || _m('tabGroupsDiscarded');
        const bookmarkedLabel = L.bookmarked || _m('tabGroupsBookmarked');
        const stagedLabel = L.stage || _m('tabRowStage');
        if (selecting) {
            return (pinned
                ? `<span class="tabgroups-status-icon pinned" aria-label="${htmlspecialchars(pinnedLabel)}" title="${htmlspecialchars(pinnedLabel)}">${PIN_ICON_FILLED}</span>`
                : emptySlot()) +
                (discarded
                    ? `<span class="tabgroups-status-icon discarded" aria-label="${htmlspecialchars(discardedLabel)}" title="${htmlspecialchars(discardedLabel)}">${SLEEP_ICON_FILLED}</span>`
                    : emptySlot()) +
                (bookmarked
                    ? `<span class="tabgroups-star" aria-label="${htmlspecialchars(bookmarkedLabel)}" title="${htmlspecialchars(bookmarkedLabel)}">${STAR_ICON_FILLED}</span>`
                    : emptySlot()) +
                (relayOn() && staged
                    ? `<span class="tabgroups-star staged" aria-label="${htmlspecialchars(stagedLabel)}" title="${htmlspecialchars(stagedLabel)}">${STAGE_ICON_DONE}</span>`
                    : emptySlot()) +
                emptySlot();
        }
        // Pin: a pinned tab shows the always-visible SOLID pin (state glyph
        // language — filled = on, like the sleeping crescent and bookmarked
        // ★) and one click unpins it. An unpinned tab gets a hover-revealed
        // hollow pin button in the same column (4.1.0 parity with the
        // sleep/star hover actions — pinning was context-menu-only).
        const pinHtml = pinned
            ? `<button class="row-btn tabgroups-unpin always-on" aria-pressed="true" aria-label="${htmlspecialchars(L.unpin || _m('tabGroupsUnpinTab'))}" title="${htmlspecialchars(L.unpin || _m('tabGroupsUnpinTab'))}">${PIN_ICON_FILLED}</button>`
            : `<button class="row-btn tabgroups-pin-tab" aria-label="${htmlspecialchars(L.pin || _m('tabGroupsPinTab'))}" title="${htmlspecialchars(L.pin || _m('tabGroupsPinTab'))}">${PIN_ICON}</button>`;
        // Sleep: hollow crescent = awake (click sleeps), filled = sleeping
        // (always visible, click wakes the tab in place).
        const sleepLabel = discarded ? (L.wake || _m('tabGroupsWakeTab')) : (L.sleep || _m('tabGroupsSleepTab'));
        const sleepHtml = `<button class="row-btn tabgroups-sleep-tab${discarded ? ' asleep always-on' : ''}" ` +
            `aria-pressed="${discarded}" aria-label="${htmlspecialchars(sleepLabel)}" title="${htmlspecialchars(sleepLabel)}">` +
            `${discarded ? SLEEP_ICON_FILLED : SLEEP_ICON}</button>`;
        // Bookmark state follows the stats-view recipe: an always-visible
        // filled ★ once bookmarked — clicking it now REMOVES the bookmark
        // (undo-captured) — and a hover-revealed hollow ☆ otherwise.
        const starHtml = bookmarked
            ? `<button class="row-btn tabgroups-remove-bookmark always-on" aria-pressed="true" aria-label="${htmlspecialchars(L.removeBookmark || _m('tabGroupsRemoveBookmark'))}" title="${htmlspecialchars(L.removeBookmark || _m('tabGroupsRemoveBookmark'))}">${STAR_ICON_FILLED}</button>`
            : `<button class="row-btn tabgroups-add-bookmark tabgroups-add-btn" aria-label="${htmlspecialchars(L.addBookmark || _m('tabGroupsAddBookmark'))}" title="${htmlspecialchars(L.addBookmark || _m('tabGroupsAddBookmark'))}">${STAR_ICON}</button>`;
        // Stage (发送到暂存): pure snapshot between the star and close
        // columns; staged → filled plane always on in accent.
        const stageHtml = !relayOn() ? '' : (staged
            ? `<button class="row-btn tabgroups-stage staged always-on" aria-pressed="true" aria-label="${htmlspecialchars(stagedLabel)}" title="${htmlspecialchars(stagedLabel)}">${STAGE_ICON_DONE}</button>`
            : `<button class="row-btn tabgroups-stage" aria-label="${htmlspecialchars(stagedLabel)}" title="${htmlspecialchars(stagedLabel)}">${STAGE_ICON}</button>`);
        // The rightmost hover action is close-tab (delete).
        const closeLabel = L.close || _m('tabGroupsSelectClose');
        const closeHtml = `<button class="row-btn tabgroups-close-tab" aria-label="${htmlspecialchars(closeLabel)}" title="${htmlspecialchars(closeLabel)}">${TRASH_ICON}</button>`;
        return pinHtml + sleepHtml + starHtml + stageHtml + closeHtml;
    };

    const tabRowHtml = (tab, opts = {}) => {
        const L = opts.L || {};
        const tid = String(tab.id);
        const isCurrent = String(tab.id) === String(currentTabId);
        const inGroup = isGrouped(tab);
        const isSelected = selected.has(tid);
        const pinned = !!tab.pinned;
        const discarded = !!tab.discarded;
        const currentLabel = L.currentTab || _m('tabGroupsCurrentTab');
        const extras = `data-tab-id="${tid}" data-url="${htmlspecialchars(tab.url || '')}"`;
        const badge = isCurrent ? [{ text: currentLabel, cls: 'current' }] : [];
        const groupColor = inGroup ? ((groupById(tab.groupId) || {}).color || 'grey') : '';
        const rowClass = `vbm-row tabgroups-row${isCurrent ? ' tabgroups-current' : ''}${inGroup ? ` grouped tg-${groupColor}` : ''}${isSelected ? ' sel' : ''}${pinned ? ' pinned' : ''}${discarded ? ' discarded' : ''}${opts.lastMember ? ' tg-last' : ''}`;
        // Connector-line style: one absolutely positioned element per member
        // row draws the color trunk under the group head's dot plus the
        // per-row tick — the tab-tree look. `tg-last` closes the trunk with
        // an elbow so the group reads as one bracket.
        const connector = (inGroup && colorStyle() === 'line')
            ? '<span class="tg-connector" aria-hidden="true"></span>'
            : '';
        const winId = tab._windowId || tab.windowId;
        return `<li class="${rowClass}" id="tabgroups-item-${tid}" role="listitem" data-tab-id="${tid}"` +
            `${winId !== undefined && winId !== null ? ` data-window-id="${String(winId)}"` : ''}` +
            `${inGroup ? ` data-group-id="${String(tab.groupId)}"` : ''}>` +
            connector +
            treeRender.generateBookmarkHTML(tab.title || tab.url || L.noTitle || _m('noTitle'), tab.url || '', extras, null, null, { badge }) +
            rowIcons(tab, L) +
            '</li>';
    };

    // Closed rows carry the time we closed them: the records are OUR own
    // (written by closeTabById/closeGroup), so savedAt is always available —
    // no browser API guessing. One rhythm for the whole history strip
    // (4.1.0 coordination pass): TOP-LEVEL entries — a standalone tab
    // record and a closed-group head — are single-line rows at the head
    // height with the RELATIVE time inline (absolute time in the tooltip);
    // an expanded group's members take the same 24px indent and compact
    // data-row height as live grouped rows. The dead view's wide-mode
    // second line used to make standalone records 40px between 28px heads.
    //
    // The standalone record's primary action is REOPEN (arrow, like a
    // closed group's head); its bookmark entry stays in the context menu.
    // Member rows keep the hover ☆ + remove pair.
    const closedTabHtml = (record, tab, idx, opts = {}) => {
        const title = tab.title || tab.url || _m('noTitle');
        const extras = `data-closed-id="${htmlspecialchars(record.id)}" data-closed-tab="${idx}"`;
        const removeLabel = _m('tabGroupsRemoveClosedTab');
        const standalone = record.type === 'tab';
        const savedAt = record.savedAt || 0;
        const meta = (standalone && savedAt)
            ? {
                rightText: relTimeLabel(savedAt, _m),
                tooltipAppend: `${_m('tabGroupsClosedTimeLabel')} ${new Date(savedAt).toLocaleString()}`
            }
            : {};
        const firstBtn = standalone
            ? `<button class="row-btn tabgroups-closed-reopen" aria-label="${htmlspecialchars(_m('tabGroupsReopenAction'))}" title="${htmlspecialchars(_m('tabGroupsReopenAction'))}">${ACTIVATE_ICON}</button>`
            : `<button class="row-btn tabgroups-closed-add-bookmark" aria-label="${htmlspecialchars(_m('tabGroupsAddBookmark'))}" title="${htmlspecialchars(_m('tabGroupsAddBookmark'))}">${STAR_ICON}</button>`;
        // 发送到暂存 between the leading action and the trailing ×: staged →
        // the filled plane, always on in accent (the staging view's law).
        const closedStaged = isStagedUrl(tab.url);
        const closedStageLabel = _m('tabRowStage');
        const stageBtn = relayOn()
            ? `<button class="row-btn tabgroups-closed-stage${closedStaged ? ' staged always-on' : ''}" ` +
              `aria-pressed="${closedStaged}" aria-label="${htmlspecialchars(closedStageLabel)}" title="${htmlspecialchars(closedStageLabel)}">` +
              `${closedStaged ? STAGE_ICON_DONE : STAGE_ICON}</button>`
            : '';
        return `<li class="vbm-row tabgroups-closed-tab${opts.member ? ' tabgroups-closed-member' : ''}" data-closed-id="${htmlspecialchars(record.id)}" data-closed-tab="${idx}">` +
            treeRender.generateBookmarkHTML(title, tab.url || '', extras, null, null, meta) +
            firstBtn +
            stageBtn +
            `<button class="row-btn tabgroups-closed-remove-tab" aria-label="${htmlspecialchars(removeLabel)}" title="${htmlspecialchars(removeLabel)}">${TRASH_ICON}</button>` +
            '</li>';
    };

    // The closed group head's stage button (暂存 between reopen and delete):
    // every bookmarkable recorded tab already staged → filled plane, always on.
    const closedHeadStageBtn = record => {
        if (!relayOn())
            return '';
        const tabs = record.tabs || [];
        const bookmarkable = tabs.filter(t => bookmarkableUrl(t.url));
        const staged = bookmarkable.length > 0 && bookmarkable.every(t => isStagedUrl(t.url));
        const label = _m('tabgroupStageAll');
        return `<button class="row-btn tabgroups-closed-stage-group${staged ? ' staged always-on' : ''}" ` +
            `aria-pressed="${staged}" aria-label="${htmlspecialchars(label)}" title="${htmlspecialchars(label)}">` +
            `${staged ? STAGE_ICON_DONE : STAGE_ICON}</button>`;
    };

    const closedGroupHtml = record => {
        const color = record.color || 'grey';
        const title = record.title || _m('tabGroupUntitled');
        const isExpanded = expandedClosed.has(String(record.id));
        const openLabel = _m('tabGroupsReopenGroup');
        const deleteLabel = _m('tabGroupsDeleteClosedGroup');
        const closedAt = relTimeLabel(record.savedAt || 0, _m);
        const closedAtFull = new Date(record.savedAt || 0).toLocaleString();
        let html = `<li class="tabgroups-closed-group tg-${htmlspecialchars(color)}" data-closed-id="${htmlspecialchars(record.id)}">` +
            `<span class="tabgroups-closed-head" tabindex="-1" role="button" aria-expanded="${isExpanded ? 'true' : 'false'}">` +
            `<span class="chevron${isExpanded ? '' : ' collapsed'}"></span>` +
            `<span class="tab-group-dot tg-${htmlspecialchars(color)}"></span>` +
            `<span class="tabgroups-group-title" dir="auto">${htmlspecialchars(title)}</span>` +
            `<span class="tabgroups-closed-meta" title="${htmlspecialchars(closedAtFull)}">${htmlspecialchars(closedAt)}</span>` +
            `<span class="count-pill" aria-label="${htmlspecialchars(_m('tabGroupsGroupCount', `${(record.tabs || []).length}`))}">${(record.tabs || []).length}</span>` +
            `<button class="row-btn tabgroups-closed-open" aria-label="${htmlspecialchars(openLabel)}" title="${htmlspecialchars(openLabel)}">${ACTIVATE_ICON}</button>` +
            closedHeadStageBtn(record) +
            `<button class="row-btn tabgroups-closed-delete" aria-label="${htmlspecialchars(deleteLabel)}" title="${htmlspecialchars(deleteLabel)}">${TRASH_ICON}</button>` +
            '</span></li>';
        if (isExpanded) {
            const tabs = record.tabs || [];
            for (let i = 0; i < tabs.length; i++)
                html += closedTabHtml(record, tabs[i], i, { member: true });
        }
        return html;
    };

    const render = () => {
        // Prune selected ids whose tab vanished.
        const alive = new Set(tabs.map(t => String(t.id)));
        for (const id of [...selected])
            if (!alive.has(id))
                selected.delete(id);

        // Per-render i18n labels. Every row used to re-ask chrome.i18n for
        // the same handful of strings (7+ getMessage crossings per row); the
        // profiler attributed ~37 ms of a 1371-row render to the binding.
        // Resolve them once, hand them down.
        const L = tabgroupsLabels();
        // 4.1.0: rows stream in chunks (list-chunks.js) — the head paint is
        // synchronous (toolbar + first rows), the rest appends per frame.
        // The pieces array holds li-level fragments in render order.
        // Per-render group-head i18n labels: 160 group heads × ~5 static
        // getMessage crossings used to pay the i18n bridge every render.
        const G = {
            untitled: _m('tabGroupUntitled'),
            count: n => _m('tabGroupsGroupCount', n),
            activate: _m('tabGroupsActivateGroup'),
            rename: _m('tabGroupsRenameGroup'),
            save: _m('tabGroupsSaveFolder'),
            stage: _m('tabgroupStageAll'),
            sleep: _m('tabGroupsSleepGroup'),
            wake: _m('tabGroupsWakeGroup'),
            close: _m('tabGroupsCloseGroup')
        };
        let head = renderToolbar();
        const virtual = !!store.get('virtualScrollLab', '');
        const pieces = [];
        const hiddenRanges = []; // render-time folds → the painter starts them hidden
        groupFoldSpans = new Map();
        windowFoldSpans = new Map();
        // Piece index carrying the current tab's row — the LAB virtual
        // painter's initial reveal target (first-activation scroll).
        let currentPieceIdx = null;
        if (!tabs.length) {
            head += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('tabGroupsViewEmpty')}</i></li></ul>`;
        } else {
            const style = colorStyle();
            const ulClass = [
                selecting ? 'selecting' : '',
                style === 'edge' ? 'color-enhanced' : '',
                style === 'line' ? 'color-line' : ''
            ].filter(Boolean).join(' ');
            head += `<ul role="list"${ulClass ? ` class="${ulClass}"` : ''}></ul>`;

            const needle = filterNeedle();
            // A find hits a TAB's title/URL, or a GROUP's title — a group
            // whose NAME matches shows whole (Chrome's own tab search matches
            // group names; a name hit that hid the group's body would be a
            // false negative).
            const groupTitleMatches = group => {
                if (!needle || !group)
                    return false;
                return `${group.title || ''}`.toLowerCase().includes(needle);
            };
            const tabVisible = t => tabMatchesNeedle(t, needle)
                || (needle && isGrouped(t) && groupTitleMatches(groupById(t.groupId)));
            // Window section head: the WHOLE row is the fold control (a
            // focusable role=button span, so it joins the row keyboard model
            // exactly like a group head) — the old chevron-only button left
            // most of the row dead to both mouse and keyboard.
            const windowHead = (win, idx, count) => {
                const label = _m('tabGroupsWindow', [`${idx + 1}`]);
                // Folds are inert while filtering — a find never hides hits.
                const isCollapsed = !needle && collapsedWindows.has(String(win.id));
                const toggleLabel = _m(isCollapsed ? 'tabGroupsExpandWindow' : 'tabGroupsCollapseWindow');
                // The current-window pill keys on currentWindowId (which
                // falls back to the first window when the browser reports no
                // focused window), so EXACTLY one section is always marked —
                // win.focused alone made the badge flicker away. It sits in
                // the row's right zone next to the count pill, styled like
                // the current-TAB badge (4.1.0 consistency pass).
                const current = String(win.id) === String(currentWindowId)
                    ? `<b class="tabgroups-window-current">${_m('tabGroupsCurrentWindow')}</b>`
                    : '';
                // The head's one hover action: close the WHOLE window. It
                // confirm-gates on the tab count, records the tabs as ONE
                // merged closed entry (the batch-close recipe) and the toast
                // can bring them back — plus Chrome's native Ctrl+Shift+T
                // restores the window itself. Not rendered in selection mode
                // (the head toggles the window's membership there).
                const closeBtn = selecting ? '' :
                    `<button class="row-btn tabgroups-window-close" aria-label="${htmlspecialchars(_m('tabGroupsCloseWindow'))}" title="${htmlspecialchars(_m('tabGroupsCloseWindow'))}">${TRASH_ICON}</button>`;
                return `<li class="tabgroups-window-head" data-window-id="${String(win.id)}">` +
                    `<span class="tabgroups-window-head-row" tabindex="-1" role="button" ` +
                    `aria-expanded="${isCollapsed ? 'false' : 'true'}" ` +
                    `aria-label="${htmlspecialchars(`${label} · ${toggleLabel}`)}" ` +
                    `title="${htmlspecialchars(toggleLabel)}">` +
                    `<span class="chevron${isCollapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
                    `<em>${htmlspecialchars(label)}</em>${current}` +
                    `<span class="count-pill" aria-label="${htmlspecialchars(_m('tabGroupsGroupCount', `${count}`))}">${count}</span>` +
                    closeBtn +
                    '</span></li>';
            };

            // §perf (fold surgery × virtual painter): heads and member
            // bodies are SEPARATE pieces so a fold maps to hiding the
            // members piece alone (the clicked head keeps its node under
            // both painters). Under the virtual painter folded bodies are
            // still built (painted hidden) so an unfold stays surgical; the
            // chunked painter keeps the old shape (skip when folded).
            const pushGroupBlock = ({ group, memberTabs, L }) => {
                pieces.push(groupHeadHtml(group, memberTabs, G));
                const gid = String(group.id);
                const shown = needle || !collapsed.has(gid);
                let membersHtml = '';
                for (let mi = 0; mi < memberTabs.length; mi++)
                    membersHtml += tabRowHtml(memberTabs[mi], { lastMember: mi === memberTabs.length - 1, L });
                groupFoldSpans.set(gid, [pieces.length, pieces.length + 1]);
                if (shown || virtual) {
                    if (!shown)
                        hiddenRanges.push([pieces.length, pieces.length + 1]);
                    pieces.push(membersHtml);
                }
            };

            let matchedRows = 0;
            for (let wi = 0, wl = windows.length; wi < wl; wi++) {
                const win = windows[wi];
                const visibleTabs = needle ? win.tabs.filter(tabVisible) : win.tabs;
                // A window with no matching tab leaves the flow entirely.
                if (needle && !visibleTabs.length)
                    continue;
                pieces.push(windowHead(win, wi, visibleTabs.length));
                const winId = String(win.id);
                const winCollapsed = !needle && collapsedWindows.has(winId);
                // §perf (fold surgery × virtual painter): a collapsed window
                // still builds its block (hidden) under the virtual painter
                // so unfolding it stays surgical; the chunked painter skips.
                const winStart = pieces.length;
                if (!winCollapsed || virtual) {

                    // Open groups and ungrouped tabs render INTERLEAVED in the
                    // browser's actual tab order (drag sorting reorders that
                    // order). Closed (collapsed) groups leave the inline flow
                    // and anchor to the bottom of their window section.
                    // Group members are pre-bucketed in ONE pass (the walk used
                    // to re-filter the whole window per group — O(tabs×groups)
                    // with a String() allocation per compare). visibleTabs
                    // keeps the window's index order (sortTabs ordered it and
                    // the filter pass preserves order), so the buckets come out
                    // ordered with no per-group sort. The filtered (needle)
                    // walk keeps the per-group filter: a group-name hit shows
                    // the whole group even when members don't match the needle.
                    const membersByGid = new Map();
                    if (!needle) {
                        for (let i = 0; i < visibleTabs.length; i++) {
                            const t = visibleTabs[i];
                            if (!isGrouped(t) || !groupMap.has(String(t.groupId)))
                                continue;
                            const gid = String(t.groupId);
                            let arr = membersByGid.get(gid);
                            if (!arr) {
                                arr = [];
                                membersByGid.set(gid, arr);
                            }
                            arr.push(t);
                        }
                    }
                    const seenGroups = new Set();
                    for (let i = 0, l = visibleTabs.length; i < l; i++) {
                        const tab = visibleTabs[i];
                        if (!isGrouped(tab)) {
                            if (String(tab.id) === String(currentTabId))
                                currentPieceIdx = pieces.length;
                            pieces.push(tabRowHtml(tab, L));
                            matchedRows++;
                            continue;
                        }
                        const group = groupById(tab.groupId);
                        if (!group) {
                            if (String(tab.id) === String(currentTabId))
                                currentPieceIdx = pieces.length;
                            pieces.push(tabRowHtml(tab, L));
                            matchedRows++;
                            continue;
                        }
                        const gid = String(group.id);
                        if (seenGroups.has(gid))
                            continue;
                        seenGroups.add(gid);
                        const memberTabs = needle
                            ? visibleTabs.filter(t => String(t.groupId) === gid)
                            : membersByGid.get(gid);
                        // Collapsed groups stay inline in tab order (they are not
                        // closed — their tabs still exist in the browser).
                        if (memberTabs.some(t => String(t.id) === String(currentTabId)))
                            currentPieceIdx = pieces.length;
                        pushGroupBlock({ group, memberTabs, L });
                        matchedRows += memberTabs.length;
                    }
                }
                windowFoldSpans.set(winId, [winStart, pieces.length]);
                if (winCollapsed && virtual)
                    hiddenRanges.push([winStart, pieces.length]);
            }
            if (needle && !matchedRows)
                pieces.push(`<li class="empty-state" role="listitem"><i>${_m('tabGroupsNoMatchingTabs')}</i></li>`);

            // The closed-record section is history, not open tabs — it stays
            // out of the filter's scope (hidden while a filter is active).
            // Its heading row carries the clear-all action on the right
            // (4.1.0: the toolbar placement read as "clear the filter" —
            // here the scope is unambiguous; the li gets .vbm-section-head
            // so the button joins the keyboard model's Tab ring, and ↑/↓
            // cross between the open-tab zone and this zone through it).
            if (!needle && closedRecords.length) {
                pieces.push(`<li class="tabgroups-section-head tabgroups-closed-section-head vbm-section-head">` +
                    `<em>${_m('tabGroupsClosedGroups')}</em>` +
                    iconBtn('tabgroups-closed-clear', TRASH_ICON, 'tabGroupsClearClosedGroups') +
                    `</li>`);
                for (const record of closedRecords) {
                    if (record.type === 'tab') {
                        const tab = (record.tabs && record.tabs[0]) || { title: record.title || '', url: record.url || '' };
                        pieces.push(closedTabHtml(record, tab, 0));
                    } else {
                        pieces.push(closedGroupHtml(record));
                    }
                }
            }
        }
        // Focus law + the paint. The toolbar park/restore runs on the head
        // paint (the toolbar lives in the head); the ROW park/restore
        // retries per chunk (an id'd row restores as soon as its chunk is
        // in) and always runs at settle, where the clamped-index path is
        // safe again — the full list exists by then. The LAB virtual painter
        // (options 实验室, default off) never has the full list in the DOM:
        // its settle keeps id-based restore only.
        // Virtual painter + content-visibility:auto = fresh windows that
        // skip rendering/hit-testing (blank viewport, repro diag-vl-6000.js)
        // — the override in css/neat.css keys on this class.
        if ($list && $list.classList && typeof $list.classList.toggle === 'function')
            $list.classList.toggle('virtual-paint', virtual);
        const parkedToolbar = parkToolbarFocus($list);
        let parkedRow = parkRowFocus($list);
        if (paintHandle)
            paintHandle.cancel();
        const tryScrollToCurrent = (paintedThrough) => {
            if (!pendingScrollToCurrent)
                return;
            // Piece-index gate: the current-tab row exists once its piece
            // is in — no per-batch querySelector walk before that.
            if (currentPieceIdx == null || (paintedThrough != null && currentPieceIdx >= paintedThrough))
                return;
            const cur = $list.querySelector ? $list.querySelector('.tabgroups-current') : null;
            if (cur && cur.scrollIntoView) {
                pendingScrollToCurrent = false;
                cur.scrollIntoView({ block: 'nearest' });
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
        const paintOpts = {
            head,
            pieces,
            onHead: el => {
                restoreToolbarFocus(el, parkedToolbar);
                onRowsRendered();
                tryScrollToCurrent(null);   // target may sit in the head batch
            },
            onChunk: (el, from, end) => {
                tryUnparkRow();
                onRowsRendered();
                tryScrollToCurrent(end);
            },
            onSettled: el => {
                paintSettled = true;
                if (parkedRow && !virtual) {
                    unparkRowFocus(el, parkedRow);
                    parkedRow = null;
                } else if (parkedRow) {
                    tryUnparkRow();   // id-based only under the virtual painter
                    parkedRow = null;
                }
                tryScrollToCurrent(null);
            }
        };
        paintSettled = false;
        paintHandle = virtual
            ? paintListVirtual($list, {
                ...paintOpts,
                hiddenRanges,
                revealIndex: pendingScrollToCurrent ? currentPieceIdx : null
            })
            : paintListChunked($list, {
                ...paintOpts,
                first: 80, chunk: 160,
                adaptive: true, budgetMs: 16, minChunk: 48, maxChunk: 320
            });
    };

    // --- Bookmark helpers -------------------------------------------------------
    const bookmarkableUrl = u => /^(https?|ftp|file):/i.test(u || '');

    const addTabToBookmarks = tabId => {
        const tab = tabById(tabId);
        if (!tab || !bookmarkableUrl(tab.url))
            return;
        chrome.bookmarks.search({ url: tab.url }, existing => {
            if (existing && existing.length) {
                // Already bookmarked (the row's star went stale between the
                // last refresh and the click): flip the state silently, the
                // same way the stats view's ☆ handles a duplicate.
                bookmarkedUrls.add(tab.url);
                if (views.isActive('tabgroups'))
                    render();
                return;
            }
            const parentId = rootFolderId();
            chrome.bookmarks.create({ title: tab.title || tab.url, url: tab.url, parentId }, created => {
                if (!created || created.id === undefined || created.id === null)
                    return;
                bookmarkedUrls.add(tab.url);
                onChanged();
                if (views.isActive('tabgroups'))
                    render();
                chrome.bookmarks.get(parentId, nodes => {
                    const folderName = (nodes && nodes.length) ? (nodes[0].title || '') : '';
                    undo.showToast(_m('quickAddedTo', folderName));
                });
            });
        });
    };

    // --- Staging interop (velvet staging §2.5, user-revised) -----------------
    // "Send to staging" is a PURE snapshot (url/title, id=null): sending
    // must not touch the tree — the workbench's own star/favorite actions
    // do the real bookmarking when the user wants it. Tabs are not
    // bookmarks; no resolve/create step applies.
    const stageTab = tab => {
        const stagingApi = ctx.staging;
        if (!stagingApi || !tab || !bookmarkableUrl(tab.url))
            return;
        stagingApi.addItems([{ id: null, url: tab.url, title: tab.title || tab.url }]);
    };

    const stageTabById = tabId => stageTab(tabById(tabId));

    // Staged-state probe for the row/head buttons: staged → the filled plane
    // glyph, always visible in accent (the staging view's .staged law). All
    // the relay builders below return nothing while the staging master
    // switch (stagingEnabled) is off.
    const relayOn = () => !ctx.staging || !ctx.staging.isEnabled || ctx.staging.isEnabled();
    const isStagedUrl = url => !!(ctx.staging && ctx.staging.isStaged && url && ctx.staging.isStaged(url));

    // Stage a CLOSED record (group head → every recorded tab; one recorded
    // tab → its snapshot). Pure snapshots like stageTab — no tree writes.
    const stageClosedGroup = recordId => {
        const stagingApi = ctx.staging;
        const record = closedRecords.find(r => String(r.id) === String(recordId));
        if (!stagingApi || !record)
            return;
        const entries = (record.tabs || [])
            .filter(t => bookmarkableUrl(t.url))
            .map(t => ({ id: null, url: t.url, title: t.title || t.url }));
        if (!entries.length) {
            undo.showToast(_m('tabgroupStageNone'));
            return;
        }
        stagingApi.addItems(entries);
        undo.showToast(_m('stagingAddedSummary', [`${entries.length}`, '0']));
    };

    const stageClosedTab = (recordId, idx) => {
        const stagingApi = ctx.staging;
        const record = closedRecords.find(r => String(r.id) === String(recordId));
        const tab = record && (record.tabs || [])[idx];
        if (!stagingApi || !tab || !bookmarkableUrl(tab.url))
            return;
        stagingApi.addItems([{ id: null, url: tab.url, title: tab.title || tab.url }]);
    };

    // A whole tab group: bookmarkable tabs by index as PURE snapshots into
    // one sourceTabGroup staging group (>10 ConfirmDialog; 0 bookmarkable →
    // toast). No tree writes — same revision as stageTab.
    const STAGE_GROUP_CONFIRM_LIMIT = 10;
    const stageTabGroup = (groupId, groupTitle) => {
        const stagingApi = ctx.staging;
        if (!stagingApi)
            return;
        const groupTabs = tabs
            .filter(t => t.groupId === groupId && bookmarkableUrl(t.url))
            .sort((a, b) => (a.index || 0) - (b.index || 0));
        if (!groupTabs.length) {
            undo.showToast(_m('tabgroupStageNone'));
            return;
        }
        const run = () => {
            const entries = groupTabs.map(t => ({ id: null, url: t.url, title: t.title || t.url }));
            let group = null;
            const state = stagingApi.state();
            for (const g of state.groups) {
                if (g.sourceTabGroup === groupTitle) {
                    group = g;
                    break;
                }
            }
            stagingApi.addItems(entries, group ? { defaultGroup: group.id } : {});
            undo.showToast(_m('stagedToast', [`${entries.length}`, groupTitle || '']));
        };
        if (groupTabs.length > STAGE_GROUP_CONFIRM_LIMIT && dialogs && dialogs.ConfirmDialog) {
            dialogs.ConfirmDialog.open({
                dialog: _m('tabgroupStageConfirm', `${groupTabs.length}`),
                button1: `<strong>${_m('open')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    // The filled ★ is a toggle, not just a state marker: clicking it removes
    // the bookmark(s) for that tab's URL again. Deletions go through
    // undo.capture first, so the toast's Undo restores them (the same
    // contract every other delete in the popup has).
    const removeTabBookmarks = tabId => {
        const tab = tabById(tabId);
        if (!tab || !tab.url)
            return;
        chrome.bookmarks.search({ url: tab.url }, existing => {
            const nodes = (existing || []).filter(n => n && n.id && !n.children);
            if (!nodes.length) {
                bookmarkedUrls.delete(tab.url);
                if (views.isActive('tabgroups'))
                    render();
                return;
            }
            // Serial capture → remove: a URL may be bookmarked more than
            // once, and the star can only go hollow when all copies are gone.
            const step = i => {
                if (i >= nodes.length) {
                    bookmarkedUrls.delete(tab.url);
                    onChanged();
                    if (views.isActive('tabgroups'))
                        render();
                    undo.showToast(_m('tabGroupsBookmarkRemoved', `${nodes.length}`));
                    return;
                }
                // capture() snapshots the subtree for Undo (fire-and-forget,
                // the P3.3 contract every other delete path uses).
                if (undo.capture)
                    undo.capture(nodes[i].id);
                chrome.bookmarks.remove(nodes[i].id, () => {
                    void chrome.runtime.lastError;
                    step(i + 1);
                });
            };
            step(0);
        });
    };

    const togglePinned = tabId => {
        const tab = tabById(tabId);
        if (!tab)
            return;
        const shouldPin = !tab.pinned;
        // Chrome keeps pinned tabs and tab groups mutually exclusive: pinning
        // a grouped member silently pulls it OUT of its group. That deserves
        // a toast — the row otherwise just vanishes from its group.
        const wasGrouped = shouldPin && isGrouped(tab);
        const finish = () => {
            if (chrome.tabs.update) {
                chrome.tabs.update(tab.id, { pinned: shouldPin }, () => {
                    if (chrome.runtime.lastError)
                        return;
                    if (wasGrouped)
                        undo.showToast(_m('tabGroupsPinnedUngroupedToast'));
                    scheduleRefresh();
                });
            }
        };
        if (shouldPin && isGrouped(tab)) {
            if (chrome.tabs.ungroup)
                chrome.tabs.ungroup(tab.id, () => finish());
            else
                finish();
        } else {
            finish();
        }
    };

    // Single-item destructive/stateful operations run WITHOUT a confirm —
    // the toast + action button is the regret path (4.1.0 UX pass: one-item
    // confirms made every click pay a dialog tax; the dialogs stay on the
    // BATCH bar, where the blast radius justifies them).
    const closeTabById = tabId => {
        const tab = tabById(tabId);
        if (!tab)
            return;
        // Remember closed single tabs in the same history list as
        // closed groups, so they can be reopened in their window.
        const record = {
            id: `ct_${Date.now().toString(36)}`,
            type: 'tab',
            title: tab.title || '',
            url: tab.url || '',
            windowId: tab.windowId,
            savedAt: Date.now(),
            tabs: [{ title: tab.title || '', url: tab.url || '' }]
        };
        persistClosedGroups([...readClosedGroups(), record]);
        // Keep the in-memory mirror in step: the toast's Reopen callback may
        // fire before the 300 ms-debounced refresh reloads the list.
        closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        send({ type: TAB_GROUP_MSG.tabsClose, tabIds: [tab.id] });
        undo.toastAction(_m('tabGroupsClosedToast', '1'), _m('tabGroupsReopenAction'),
            () => restoreClosedGroup(record.id));
        scheduleRefresh();
    };

    const sleepTabById = tabId => {
        const tab = tabById(tabId);
        if (!tab)
            return;
        send({ type: TAB_GROUP_MSG.tabsDiscard, tabIds: [tab.id] });
        undo.toastAction(_m('tabGroupsSleptToast', '1'), _m('tabGroupsWakeAction'),
            () => wakeTabById(tab.id));
        scheduleRefresh();
    };

    // Waking is non-destructive (the tab reloads in place and stays where it
    // is), so it runs without a confirmation — unlike sleeping, which throws
    // away the tab's in-memory state.
    const wakeTabById = tabId => {
        const tab = tabById(tabId);
        if (!tab)
            return;
        send({ type: TAB_GROUP_MSG.tabsWake, tabIds: [tab.id] });
        scheduleRefresh();
    };

    // The row's sleep glyph is a toggle: asleep → wake, awake → sleep.
    const toggleTabSleep = tabId => {
        const tab = tabById(tabId);
        if (!tab)
            return;
        if (tab.discarded)
            wakeTabById(tabId);
        else
            sleepTabById(tabId);
    };

    const createBookmark = (folderId, tab) => new Promise(resolve => {
        if (!bookmarkableUrl(tab.url)) {
            resolve(0);
            return;
        }
        chrome.bookmarks.search({ url: tab.url }, existing => {
            if (existing && existing.length) {
                resolve(0);
                return;
            }
            chrome.bookmarks.create({ parentId: folderId, title: tab.title || tab.url, url: tab.url }, created => {
                resolve(created && created.id !== undefined ? 1 : 0);
            });
        });
    });

    const addSelectedToBookmarks = () => {
        const sel = tabs.filter(t => selected.has(String(t.id)));
        if (!sel.length)
            return;
        if (!dialogs.BookmarkFolderPickDialog) {
            // Minimal test setups without the new dialog: fall back to the
            // quick-add folder so the action remains usable.
            addManyToFolder(rootFolderId(), sel);
            return;
        }
        dialogs.BookmarkFolderPickDialog.open({
            dialog: _m('bookmarkFolderPickDialogTitle'),
            onPick: folderId => addManyToFolder(folderId, sel)
        });
    };

    const addManyToFolder = (folderId, sel) => {
        sel.reduce((chain, tab) => chain.then(n => createBookmark(folderId, tab).then(c => n + c)), Promise.resolve(0))
            .then(count => {
                onChanged();
                chrome.bookmarks.get(folderId, nodes => {
                    const folderName = (nodes && nodes.length) ? (nodes[0].title || '') : '';
                    undo.showToast(_m('tabGroupsBookmarksAdded', [`${count}`, folderName]));
                });
            });
    };

    // Regret path for "saved as a bookmark folder": capture-then-remove the
    // freshly created folder, so the standard bookmark undo stack can bring
    // it back if the user changes their mind twice.
    const undoSavedFolder = folderId => {
        if (!chrome.bookmarks || !chrome.bookmarks.removeTree)
            return;
        if (undo.capture)
            undo.capture(folderId);
        chrome.bookmarks.removeTree(folderId, () => {
            void chrome.runtime.lastError;
            onChanged();
        });
    };

    const saveGroupToBookmarks = groupId => {
        const group = groupById(groupId);
        if (!group)
            return;
        const groupTabs = tabs.filter(t => String(t.groupId) === String(group.id))
            .sort((a, b) => (a.index || 0) - (b.index || 0));
        const bookmarkTabs = tabsToBookmarks(groupTabs);
        if (!bookmarkTabs.length) {
            dialogs.AlertDialog && dialogs.AlertDialog.open(_m('sessionEmpty'));
            return;
        }
        const folderName = group.title || _m('tabGroupUntitled');
        saveSession({ rootFolderId: rootFolderId(), folderName, tabs: bookmarkTabs }).then(({ folderId, count }) => {
            if (!folderId)
                return;
            saveTabGroupFolderMeta(store, folderId, {
                title: group.title || '',
                color: group.color || 'grey',
                savedAt: Date.now(),
                sourceGroupId: group.id
            });
            onChanged();
            undo.toastAction(_m('tabGroupsGroupSavedToFolder', [`${count}`, folderName]), _m('undoAction'),
                () => undoSavedFolder(folderId));
        });
    };

    const saveSelectedAsFolder = () => {
        const sel = tabs.filter(t => selected.has(String(t.id)));
        const bookmarkTabs = tabsToBookmarks(sel);
        if (!bookmarkTabs.length) {
            dialogs.AlertDialog && dialogs.AlertDialog.open(_m('sessionEmpty'));
            return;
        }
        const folderName = sessionFolderName(new Date(), _m('sessionFolderName'));
        saveSession({ rootFolderId: rootFolderId(), folderName, tabs: bookmarkTabs }).then(({ folderId, count }) => {
            if (!count || !folderId)
                return;
            onChanged();
            undo.toastAction(_m('sessionSaved', `${count}`), _m('undoAction'),
                () => undoSavedFolder(folderId));
        });
    };

    // --- Per-group management (all synced to the browser) ---------------------------
    const activateGroup = groupId => {
        const group = groupById(groupId);
        if (!group)
            return;
        const member = tabs.filter(t => String(t.groupId) === String(group.id))
            .sort((a, b) => (a.index || 0) - (b.index || 0))[0];
        focusTab(member);
    };

    const renameGroup = groupId => {
        const group = groupById(groupId);
        if (!group)
            return;
        dialogs.GroupDialog.open({
            dialog: _m('tabGroupsRenameDialog'),
            title: group.title || '',
            color: group.color || 'grey',
            onConfirm: (title, color) => {
                if (chrome.tabGroups && chrome.tabGroups.update) {
                    chrome.tabGroups.update(group.id, { title, color }, () => {
                        if (chrome.runtime.lastError)
                            return;
                        refresh();
                    });
                }
            }
        });
    };

    const closeGroup = groupId => {
        const group = groupById(groupId);
        const groupTabs = tabs.filter(t => String(t.groupId) === String(groupId));
        const ids = groupTabs.map(t => t.id);
        if (!ids.length)
            return;
        // A closed group is NOT deleted: keep a local record so the
        // group can be reopened later from the closed-groups section —
        // and the toast's Reopen button jumps straight there.
        const record = {
            id: `cg_${Date.now().toString(36)}`,
            type: 'group',
            title: group ? group.title || '' : '',
            color: group ? group.color || 'grey' : 'grey',
            savedAt: Date.now(),
            tabs: groupTabs
                .sort((a, b) => (a.index || 0) - (b.index || 0))
                .map(t => ({ title: t.title || '', url: t.url || '' }))
        };
        persistClosedGroups([...readClosedGroups(), record]);
        closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        send({ type: TAB_GROUP_MSG.tabsClose, tabIds: ids });
        undo.toastAction(_m('tabGroupsClosedToast', `${ids.length}`), _m('tabGroupsReopenAction'),
            () => restoreClosedGroup(record.id));
        scheduleRefresh();
    };

    const sleepGroup = groupId => {
        const ids = tabs.filter(t => String(t.groupId) === String(groupId)).map(t => t.id);
        if (!ids.length)
            return;
        send({ type: TAB_GROUP_MSG.tabsDiscard, tabIds: ids });
        undo.toastAction(_m('tabGroupsSleptToast', `${ids.length}`), _m('tabGroupsWakeAction'),
            () => wakeGroup(groupId));
        scheduleRefresh();
    };

    // Wake every member (no confirmation — reloading in place is reversible).
    const wakeGroup = groupId => {
        const ids = tabs.filter(t => String(t.groupId) === String(groupId) && t.discarded).map(t => t.id);
        if (!ids.length)
            return;
        send({ type: TAB_GROUP_MSG.tabsWake, tabIds: ids });
        scheduleRefresh();
    };

    // The group head's sleep glyph mirrors the rows': filled (every member
    // asleep) wakes the group, hollow sleeps it.
    const isGroupAsleep = groupId => {
        const member = tabs.filter(t => String(t.groupId) === String(groupId));
        return member.length > 0 && member.every(t => !!t.discarded);
    };
    const toggleGroupSleep = groupId => {
        if (isGroupAsleep(groupId))
            wakeGroup(groupId);
        else
            sleepGroup(groupId);
    };

    // 取消分组：把组内标签打散回普通标签页（组实体消失，标签页保留）。
    const ungroupGroup = groupId => {
        const ids = tabs.filter(t => String(t.groupId) === String(groupId)).map(t => t.id);
        if (!ids.length)
            return;
        const finish = () => scheduleRefresh();
        if (chrome.tabs.ungroup) {
            // One tab at a time: the array form is MV3-only, and a
            // one-by-one chain works on every Chrome version we support.
            let pending = ids.length;
            for (const id of ids) {
                chrome.tabs.ungroup(id, () => {
                    void chrome.runtime.lastError; // stale snapshot id — see swallowLastError
                    if (--pending === 0)
                        finish();
                });
            }
        } else {
            // Ungroup API unavailable — best effort, refresh to show the
            // browser's actual state.
            finish();
        }
    };

    // 移动整组到新窗口：SW 创建新窗口并搬移全部成员，完成后刷新。
    const moveGroupToNewWindow = groupId => {
        const ids = tabs.filter(t => String(t.groupId) === String(groupId)).map(t => t.id);
        if (!ids.length)
            return;
        send({ type: TAB_GROUP_MSG.tabsMoveNewWindow, tabIds: ids }, () => refresh());
    };

    // Close a whole window from its section head: confirm on the tab count,
    // then keep the tabs as ONE merged closed record (the batch-close
    // recipe — the 10-slot history must not be flushed) and toast a Reopen
    // that brings them back as one group. Chrome's native Ctrl+Shift+T
    // remains the whole-window regret path (it restores the window itself).
    const closeWindowById = windowId => {
        const win = windows.find(w => String(w.id) === String(windowId));
        if (!win || !win.tabs || !win.tabs.length)
            return;
        const tabsSnapshot = win.tabs.slice()
            .sort((a, b) => (a.index || 0) - (b.index || 0))
            .map(t => ({ title: t.title || '', url: t.url || '' }));
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmClose', `${tabsSnapshot.length}`),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                const record = {
                    id: `cw_${Date.now().toString(36)}`,
                    type: 'group',
                    title: _m('tabGroupsWindowClosedTitle'),
                    color: 'grey',
                    savedAt: Date.now(),
                    tabs: tabsSnapshot
                };
                persistClosedGroups([...readClosedGroups(), record]);
                closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
                if (chrome.windows && chrome.windows.remove)
                    chrome.windows.remove(win.id, () => void chrome.runtime.lastError);
                undo.toastAction(_m('tabGroupsClosedToast', `${tabsSnapshot.length}`), _m('tabGroupsReopenAction'),
                    () => restoreClosedGroup(record.id));
                scheduleRefresh();
            }
        });
    };

    const restoreClosedGroup = recordId => {
        const record = closedRecords.find(r => String(r.id) === String(recordId));
        if (!record)
            return;
        const urls = (record.tabs || []).map(t => t.url).filter(Boolean);
        if (!urls.length) {
            persistClosedGroups(closedRecords.filter(r => String(r.id) !== String(recordId)));
            closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
            if (views.isActive('tabgroups'))
                render();
            return;
        }
        persistClosedGroups(closedRecords.filter(r => String(r.id) !== String(recordId)));
        closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        if (record.type === 'tab') {
            // A single-tab record reopens as a PLAIN tab in its original
            // window (the row-click recipe) — routing it through openNew
            // would resurrect one tab as a titled one-member tab GROUP.
            openTabFromRecord(record, 0);
            scheduleRefresh();
            return;
        }
        send({
            type: TAB_GROUP_MSG.openNew,
            urls,
            title: record.title || '',
            color: record.color || 'grey',
            // restore into the window the group lived in (stale ids degrade
            // gracefully inside the SW — D)
            windowId: record.windowId !== undefined && record.windowId !== null
                ? record.windowId : currentWindowId
        });
        scheduleRefresh();
    };

    const deleteClosedGroup = recordId => {
        const record = closedRecords.find(r => String(r.id) === String(recordId));
        if (!record)
            return;
        persistClosedGroups(closedRecords.filter(r => String(r.id) !== String(recordId)));
        closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        // Regret path: put the exact record back where it was.
        undo.toastAction(_m('tabGroupsRecordDeletedToast'), _m('undoAction'),
            () => {
                persistClosedGroups([...readClosedGroups(), record]);
                closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
                if (views.isActive('tabgroups'))
                    render();
            });
        if (views.isActive('tabgroups'))
            render();
    };

    const removeClosedTab = (recordId, idx) => {
        const record = closedRecords.find(r => String(r.id) === String(recordId));
        if (!record)
            return;
        const tabs = (record.tabs || []).slice();
        const removed = tabs.splice(idx, 1)[0];
        if (!tabs.length) {
            persistClosedGroups(closedRecords.filter(r => String(r.id) !== String(recordId)));
        } else {
            const updated = { ...record, tabs };
            persistClosedGroups(closedRecords.map(r => String(r.id) === String(recordId) ? updated : r));
        }
        closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        if (removed)
            undo.toastAction(_m('tabGroupsClosedTabRemovedToast'), _m('undoAction'),
                () => removeClosedTabUndo(recordId, idx, removed));
        if (views.isActive('tabgroups'))
            render();
    };

    // Undo for removeClosedTab: re-insert the tab at its old index (or
    // resurrect the whole record when the removal emptied it).
    const removeClosedTabUndo = (recordId, idx, removed) => {
        const record = closedRecords.find(r => String(r.id) === String(recordId));
        if (!record) {
            persistClosedGroups([...readClosedGroups(),
                { ...record, tabs: [removed], savedAt: record.savedAt || Date.now() }]);
        } else {
            const tabs = (record.tabs || []).slice();
            tabs.splice(Math.min(idx, tabs.length), 0, removed);
            persistClosedGroups(closedRecords.map(r => String(r.id) === String(recordId)
                ? { ...r, tabs } : r));
        }
        closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        if (views.isActive('tabgroups'))
            render();
    };

    const addClosedTabToBookmarks = (recordId, idx) => {
        const record = closedRecords.find(r => String(r.id) === String(recordId));
        const tab = record && record.tabs && record.tabs[idx];
        if (!tab || !bookmarkableUrl(tab.url))
            return;
        chrome.bookmarks.search({ url: tab.url }, existing => {
            if (existing && existing.length) {
                undo.showToast(_m('quickAdded'));
                return;
            }
            const parentId = rootFolderId();
            chrome.bookmarks.create({ title: tab.title || tab.url, url: tab.url, parentId }, created => {
                if (!created || created.id === undefined || created.id === null)
                    return;
                onChanged();
                chrome.bookmarks.get(parentId, nodes => {
                    const folderName = (nodes && nodes.length) ? (nodes[0].title || '') : '';
                    undo.showToast(_m('quickAddedTo', folderName));
                });
            });
        });
    };

    const clearClosedGroups = () => {
        if (!closedRecords.length)
            return;
        // The records are the ONLY way to reopen a closed group from here —
        // clearing them is destructive, so it confirms like the view's other
        // destructive batch actions (the 4.1.0 audit found this unguarded).
        // The toast's Undo restores the whole list afterwards.
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmClearClosed'),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                const snapshot = closedRecords.slice();
                persistClosedGroups([]);
                closedRecords = [];
                undo.toastAction(_m('tabGroupsClearedToast', `${snapshot.length}`), _m('undoAction'),
                    () => {
                        persistClosedGroups(snapshot);
                        closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
                        if (views.isActive('tabgroups'))
                            render();
                    });
                if (views.isActive('tabgroups'))
                    render();
            }
        });
    };

    const closedRecordById = recordId =>
        closedRecords.find(r => String(r.id) === String(recordId)) || null;

    // Open ONE tab of a closed record in a background tab, preferring the
    // window it was closed in (gone → the current window). Shared by the row
    // click, the closed-row context menu AND the toast undo (which holds the
    // record object — its id is already gone from the list by then).
    const openTabFromRecord = (record, idx) => {
        const tab = record && record.tabs && record.tabs[parseInt(idx, 10) || 0];
        if (!tab || !tab.url || !chrome.tabs.create)
            return;
        const openIn = windowId => chrome.tabs.create({ url: tab.url, active: false, windowId });
        if (record && record.windowId && chrome.windows && chrome.windows.get) {
            chrome.windows.get(record.windowId, win => {
                if (chrome.runtime.lastError || !win)
                    chrome.tabs.create({ url: tab.url, active: false });
                else
                    openIn(record.windowId);
            });
        } else {
            chrome.tabs.create({ url: tab.url, active: false });
        }
    };

    const openClosedTab = (recordId, idx) => {
        openTabFromRecord(closedRecordById(recordId), idx);
    };

    const isClosedExpanded = recordId => expandedClosed.has(String(recordId));
    const toggleClosedExpanded = recordId => {
        const cid = String(recordId);
        if (expandedClosed.has(cid))
            expandedClosed.delete(cid);
        else
            expandedClosed.add(cid);
        persistUIState();
        render();
    };

    // --- Selection mode + tab batch actions ---------------------------------------
    // Entering selection mode OPENS every fold (groups and window sections):
    // a batch bar that cannot see half of its candidates is a trap. The
    // pre-selection folds are snapshotted and restored on exit, and
    // persistUIState stands down while selecting so the transient
    // all-expanded state never overwrites the user's real choices.
    const setSelecting = on => {
        if (on && !selecting) {
            foldSnapshot = { groups: [...collapsed], windows: [...collapsedWindows] };
            collapsed.clear();
            collapsedWindows.clear();
            // Same "show every candidate" law applies to the filter: a batch
            // bar that cannot see half its rows is a trap.
            filterText = '';
        } else if (!on && selecting && foldSnapshot) {
            collapsed.clear();
            for (const id of foldSnapshot.groups)
                collapsed.add(id);
            collapsedWindows.clear();
            for (const id of foldSnapshot.windows)
                collapsedWindows.add(id);
            foldSnapshot = null;
        }
        selecting = on;
        if (!on)
            selected.clear();
        render();
    };

    const selectedTabs = () => tabs.filter(t => selected.has(String(t.id)));
    const selectedGrouped = () => selectedTabs().filter(isGrouped);

    const askCopyMove = fn => {
        const grouped = selectedGrouped();
        if (!grouped.length) {
            fn(false);
            return;
        }
        if (!dialogs.CopyMoveDialog) {
            // Minimal test setups: default to move (the non-destructive
            // half is the safer fallback).
            fn(false);
            return;
        }
        dialogs.CopyMoveDialog.open({
            dialog: _m('tabGroupsCopyMoveDialog'),
            onMove: () => fn(false),
            onCopy: () => fn(true)
        });
    };

    const send = (msg, cb) => {
        if (chrome.runtime && chrome.runtime.sendMessage)
            // Swallow lastError like sync-manager does: an asleep/updated SW
            // must never surface as an unchecked runtime error.
            chrome.runtime.sendMessage(msg, m => { void chrome.runtime.lastError; if (cb) cb(m); });
    };

    // A tab/group can vanish between the last refresh and the click (the
    // event refresh is 300 ms-debounced) — every chrome.tabs.* call on a
    // snapshot id carries this guard so a stale id never logs an unchecked
    // runtime.lastError (same pattern as togglePinned's callback).
    const swallowLastError = () => void chrome.runtime.lastError;

    // chrome.tabs.update(active) only switches the tab within ITS OWN window
    // — a tab living in another window stays invisible until that window is
    // focused too. The multi-window sections only make sense if clicking a
    // row actually takes the user there, so every activation also focuses
    // the owning window (which, for a popup, then closes the popup — the
    // same semantics as activating a tab in the current window).
    const focusTab = tab => {
        if (!tab || !chrome.tabs.update)
            return;
        chrome.tabs.update(tab.id, { active: true }, swallowLastError);
        const winId = tab._windowId || tab.windowId;
        if (winId !== undefined && winId !== null && String(winId) !== String(currentWindowId)
            && chrome.windows && chrome.windows.update)
            chrome.windows.update(winId, { focused: true }, swallowLastError);
    };

    // Chrome keeps pinned tabs and tab groups mutually exclusive: before a
    // tab can be grouped it must be unpinned. Resolves when every requested
    // tab is unpinned (or the API is unavailable).
    const unpinTabs = tabsToUnpin => {
        const list = (tabsToUnpin || []).filter(Boolean);
        if (!list.length)
            return Promise.resolve();
        return Promise.all(list.map(t => new Promise(resolve => {
            if (!chrome.tabs.update) {
                resolve();
                return;
            }
            chrome.tabs.update(t.id, { pinned: false }, () => resolve());
        })));
    };

    const newGroup = copyMode => {
        const sel = selectedTabs();
        if (!sel.length)
            return;
        const moveIds = sel.filter(t => !(copyMode && isGrouped(t))).map(t => t.id);
        const copyTabs = copyMode
            ? sel.filter(isGrouped).map(t => ({ url: t.url, title: t.title }))
            : [];
        // Default title: the common group's title when every selected tab is
        // already in one and the same group; otherwise untitled.
        let defaultTitle = _m('tabGroupUntitled');
        const firstGroupId = isGrouped(sel[0]) ? sel[0].groupId : -1;
        if (firstGroupId !== -1 && sel.every(t => isGrouped(t) && t.groupId === firstGroupId)) {
            const g = groupById(firstGroupId);
            if (g && g.title)
                defaultTitle = g.title;
        }
        dialogs.GroupDialog.open({
            title: defaultTitle,
            color: pickGroupColor(defaultTitle),
            onConfirm: (title, color) => {
                setSelecting(false);
                // Joining a group cancels pin state — unpin the tabs that
                // will actually be moved before the service worker groups
                // them, then refresh only after the SW reports completion.
                unpinTabs(sel.filter(t => !(copyMode && isGrouped(t)) && t.pinned)).then(() => {
                    send({
                        type: TAB_GROUP_MSG.tabsNewGroup,
                        moveIds,
                        copyTabs,
                        title,
                        color,
                        windowId: currentWindowId
                    }, () => refresh());
                });
            }
        });
    };

    const openInto = copyMode => {
        const sel = selectedTabs();
        if (!sel.length)
            return;
        const moveIds = sel.filter(t => !(copyMode && isGrouped(t))).map(t => t.id);
        const copyTabs = copyMode
            ? sel.filter(isGrouped).map(t => ({ url: t.url, title: t.title }))
            : [];
        const openPicker = groupList => {
            dialogs.GroupPickDialog.open({
                groups: groupList || [],
                onPick: groupId => {
                    setSelecting(false);
                    unpinTabs(sel.filter(t => !(copyMode && isGrouped(t)) && t.pinned)).then(() => {
                        send({ type: TAB_GROUP_MSG.tabsOpenInto, moveIds, copyTabs, groupId }, () => refresh());
                    });
                }
            });
        };
        if (chrome.tabGroups && chrome.tabGroups.query)
            chrome.tabGroups.query({}, openPicker);
        else
            openPicker(groups);
    };

    // Batch close/sleep: a SELECTION of many justifies the confirm; a
    // selection of one behaves like the single-item buttons above (direct +
    // toast regret), so a misclick never costs two dialogs.
    const closeSelected = () => {
        const sel = selectedTabs();
        const ids = sel.map(t => t.id);
        if (!ids.length)
            return;
        if (ids.length === 1) {
            setSelecting(false);
            closeTabById(ids[0]);
            return;
        }
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmClose', `${ids.length}`),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                // The batch records ONE merged closed entry (not N singles —
                // the 10-slot history must not be flushed by one batch), so
                // the toast's Reopen and the closed section both bring the
                // whole batch back as one restorable unit.
                const record = {
                    id: `cb_${Date.now().toString(36)}`,
                    type: 'group',
                    title: _m('tabGroupsBatchClosedTitle'),
                    color: 'grey',
                    savedAt: Date.now(),
                    windowId: currentWindowId,
                    tabs: sel.slice()
                        .sort((a, b) => (a.index || 0) - (b.index || 0))
                        .map(t => ({ title: t.title || '', url: t.url || '' }))
                };
                persistClosedGroups([...readClosedGroups(), record]);
                closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
                send({ type: TAB_GROUP_MSG.tabsClose, tabIds: ids });
                undo.toastAction(_m('tabGroupsClosedToast', `${ids.length}`), _m('tabGroupsReopenAction'),
                    () => restoreClosedGroup(record.id));
                setSelecting(false);
                scheduleRefresh();
            }
        });
    };

    const sleepSelected = () => {
        const sel = selectedTabs();
        const ids = sel.map(t => t.id);
        if (!ids.length)
            return;
        if (ids.length === 1) {
            setSelecting(false);
            sleepTabById(ids[0]);
            return;
        }
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmSleep', `${ids.length}`),
            button1: `<strong>${_m('tabGroupsSelectSleep')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                send({ type: TAB_GROUP_MSG.tabsDiscard, tabIds: ids });
                setSelecting(false);
                scheduleRefresh();
            }
        });
    };

    // A fold action while the filter is active would be invisible state
    // churn (the filter force-expands everything) — folds stand down until
    // the filter clears.
    // §perf (fold surgery): a group fold moves ONLY the group's own
    // contiguous member rows — no full repaint, the head li keeps its node
    // (focus survives), and the window/closed sections stay untouched.
    // The LAB virtual painter and minimal DOM doubles keep the full render.
    // §perf (fold surgery, node stash): a group fold moves ONLY the group's
    // own contiguous member rows — no full repaint, the head li keeps its node
    // (focus survives), and the window/closed sections stay untouched.
    // Collapsed rows are stashed in a fragment keyed by the head (WeakMap) and
    // reinserted as the ORIGINAL nodes on expand — no HTML rebuild, no favicon
    // load storm, no overlay rescan. The LAB virtual painter and minimal DOM
    // doubles keep the full render.
    const foldStash = new WeakMap();
    const foldGroupSurgically = (gid, shouldCollapse) => {
        const li = $list.querySelector
            ? $list.querySelector('#tabgroups-group-' + gid)
            : null;
        if (!li || typeof li.querySelector !== 'function') {
            render();
            return;
        }
        const head = li.querySelector('.tabgroups-group-head');
        if (head)
            head.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
        const chev = li.querySelector('.chevron');
        if (chev)
            chev.classList.toggle('collapsed', !!shouldCollapse);
        const stash = foldStash.get(li) || document.createDocumentFragment();
        let next = li.nextElementSibling;
        while (next && next.classList && next.classList.contains('vbm-row')
            && next.dataset && next.dataset.groupId === gid) {
            const rm = next;
            next = next.nextElementSibling;
            stash.appendChild(rm);
        }
        if (shouldCollapse) {
            if (stash.childNodes.length)
                foldStash.set(li, stash);
            return;
        }
        if (stash.childNodes.length) {
            li.after(stash);
            return; // reinserted nodes keep their overlays
        }
        const memberTabs = tabs.filter(t => isGrouped(t) && String(t.groupId) === gid);
        if (memberTabs.length) {
            const L = tabgroupsLabels();
            const html = memberTabs
                .map((t, mi) => tabRowHtml(t, { lastMember: mi === memberTabs.length - 1, L }))
                .join('');
            li.insertAdjacentHTML('afterend', html);
            onRowsRendered(); // rebuilt rows carry no overlays — repaint them
        }
    };

    const setGroupCollapsed = (groupId, shouldCollapse) => {
        if (filterNeedle())
            return;
        if (shouldCollapse)
            collapsed.add(String(groupId));
        else
            collapsed.delete(String(groupId));
        persistUIState();
        if (virtualLab()) {
            // §perf (fold surgery × virtual painter): hide/show the group's
            // members PIECE through the painter — no full render, the scroll
            // position and the head's node/focus both survive.
            foldVirtual(groupFoldSpans.get(String(groupId)), shouldCollapse,
                '#tabgroups-group-' + groupId, '.tabgroups-group-head');
        } else if (foldDuringStream()) {
            render();
        } else {
            foldGroupSurgically(String(groupId), shouldCollapse);
        }
        // Only write through to the browser when the toolbar option is on.
        // Default OFF: view folding stays local (a refresh restores the
        // browser's own collapsed state).
        if (!syncCollapse())
            return;
        const group = groupById(groupId);
        if (group && chrome.tabGroups && chrome.tabGroups.update) {
            chrome.tabGroups.update(group.id, { collapsed: shouldCollapse }, () => {
                if (chrome.runtime.lastError)
                    return;
                scheduleRefresh();
            });
        }
    };

    const toggleGroupCollapsed = groupId => {
        setGroupCollapsed(groupId, !collapsed.has(String(groupId)));
    };

    // Window folding: the effective set plus the explicit choice that
    // survives into the next session (see windowChoice).
    // §perf (fold surgery, the window block): a window fold detaches the
    // block AS PAINTED (group folds included — the members' DOM is the
    // truth, never a stale rebuild) into a fragment keyed by the head li and
    // restores exactly those nodes — no outerHTML serialize/re-parse, no
    // favicon load storm, no full repaint, the head li survives (focus
    // stays). The LAB virtual painter and minimal DOM doubles keep the full
    // render.
    const foldWindowSurgically = (id, shouldCollapse) => {
        const headLi = $list.querySelector
            ? $list.querySelector('li.tabgroups-window-head[data-window-id="' + id + '"]')
            : null;
        if (!headLi || typeof headLi.querySelector !== 'function') {
            render();
            return;
        }
        const row = headLi.querySelector('.tabgroups-window-head-row');
        if (row)
            row.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
        const chev = headLi.querySelector('.chevron');
        if (chev)
            chev.classList.toggle('collapsed', !!shouldCollapse);
        const stash = foldStash.get(headLi) || document.createDocumentFragment();
        let next = headLi.nextElementSibling;
        while (next && next.classList
            && !(next.classList.contains('tabgroups-window-head')
                || next.classList.contains('tabgroups-section-head'))) {
            const rm = next;
            next = next.nextElementSibling;
            stash.appendChild(rm);
        }
        if (shouldCollapse) {
            if (stash.childNodes.length)
                foldStash.set(headLi, stash);
            return;
        }
        if (stash.childNodes.length) {
            headLi.after(stash);
            return; // reinserted nodes keep their overlays
        }
        render(); // never painted — full path
    };

    // §perf (fold surgery × virtual painter): route a fold through the
    // painter's piece-range fold() — no full render, the scroll position and
    // the head's node (focus) both survive. Falls back to render() when the
    // painter isn't geometry-backed (minimal doubles / a paint that never
    // landed). `chromeSel` is the head's focusable row — its aria-expanded
    // and the chevron mirror the fold.
    const foldVirtual = (span, shouldCollapse, headSel, chromeSel) => {
        if (!span || !paintHandle || typeof paintHandle.fold !== 'function') {
            render();
            return;
        }
        paintHandle.fold(span[0], span[1], shouldCollapse);
        const li = $list.querySelector ? $list.querySelector(headSel) : null;
        if (li && typeof li.querySelector === 'function') {
            const chrome = li.querySelector(chromeSel);
            if (chrome)
                chrome.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
            const chev = li.querySelector('.chevron');
            if (chev)
                chev.classList.toggle('collapsed', !!shouldCollapse);
        }
    };

    const setWindowCollapsed = (windowId, shouldCollapse) => {
        if (filterNeedle())
            return; // folds are inert while the filter is active
        const id = String(windowId);
        if (shouldCollapse)
            collapsedWindows.add(id);
        else
            collapsedWindows.delete(id);
        windowChoice.set(id, !!shouldCollapse);
        persistUIState();
        if (virtualLab()) {
            // §perf (fold surgery × virtual painter): the window's block is
            // a contiguous piece range — hide/show it through the painter.
            foldVirtual(windowFoldSpans.get(id), shouldCollapse,
                'li.tabgroups-window-head[data-window-id="' + id + '"]',
                '.tabgroups-window-head-row');
        } else if (foldDuringStream()) {
            render();
        } else {
            foldWindowSurgically(id, shouldCollapse);
        }
    };
    const toggleWindowCollapsed = windowId =>
        setWindowCollapsed(windowId, !collapsedWindows.has(String(windowId)));
    const isWindowCollapsed = windowId => collapsedWindows.has(String(windowId));
    // Focus a window head by id — the "walk to the structural parent" target
    // for a collapsed group head and for an ungrouped row (keyboard-model
    // §2.4's ← rule, one level higher than the group head).
    const focusWindowHead = windowId => {
        if (!windowId || !$list.querySelector)
            return;
        const rows = $list.querySelectorAll
            ? $list.querySelectorAll('li.tabgroups-window-head') : [];
        for (let i = 0; i < rows.length; i++) {
            if (String(rows[i].dataset && rows[i].dataset.windowId) === String(windowId)) {
                const target = rows[i].querySelector('.tabgroups-window-head-row');
                if (target && target.focus)
                    target.focus();
                return;
            }
        }
    };

    // Selection helpers shared by the click and keyboard paths: a group head
    // toggles its members, a window head toggles that window's tabs.
    const toggleIds = ids => {
        const allSel = ids.length > 0 && ids.every(id => selected.has(id));
        for (const id of ids) {
            if (allSel)
                selected.delete(id);
            else
                selected.add(id);
        }
        render();
    };
    const toggleGroupSelection = groupId =>
        toggleIds(tabs.filter(t => String(t.groupId) === String(groupId)).map(t => String(t.id)));
    const toggleWindowSelection = windowId =>
        toggleIds(tabs.filter(t => String(t._windowId || t.windowId) === String(windowId)).map(t => String(t.id)));

    const collapseAll = () => {
        if (filterNeedle())
            return; // folds are inert while the filter is active
        for (const g of groups)
            collapsed.add(String(g.id));
        persistUIState();
        render();
        if (!syncCollapse())
            return;
        for (const g of groups) {
            if (chrome.tabGroups && chrome.tabGroups.update) {
                chrome.tabGroups.update(g.id, { collapsed: true }, () => {
                    void chrome.runtime.lastError;
                });
            }
        }
    };
    const expandAll = () => {
        if (filterNeedle())
            return; // folds are inert while the filter is active
        collapsed.clear();
        persistUIState();
        render();
        if (!syncCollapse())
            return;
        for (const g of groups) {
            if (chrome.tabGroups && chrome.tabGroups.update) {
                chrome.tabGroups.update(g.id, { collapsed: false }, () => {
                    void chrome.runtime.lastError;
                });
            }
        }
    };

    // --- Events ------------------------------------------------------------------
    // H9 follow-up (4.1.0 收尾): the 300 ms debounce is for ACTIVE re-renders
    // (title/order/active-marker churn). The inactive path only serves the
    // tab-count badge, whose count changes on tabs.onCreated/onRemoved alone
    // — every other event is skipped while inactive, and the inactive poll
    // itself slows to 1 s, so background title storms stop paying
    // chrome.tabs.query every 300 ms.
    const ACTIVE_REFRESH_MS = 300;
    const INACTIVE_REFRESH_MS = 1000;
    let refreshTimer = null;
    const scheduleRefresh = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh,
            views.isActive('tabgroups') ? ACTIVE_REFRESH_MS : INACTIVE_REFRESH_MS);
    };
    // Render-input events (title/order/active/group/bookmark changes): only
    // the ACTIVE view needs a re-render; the inactive badge count never
    // changes from these.
    const scheduleActiveRefresh = () => {
        if (!views.isActive('tabgroups'))
            return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, ACTIVE_REFRESH_MS);
    };

    const bindChromeEvents = () => {
        // Count-affecting tab events drive the inactive badge too.
        for (const ev of ['onCreated', 'onRemoved']) {
            if (chrome.tabs && chrome.tabs[ev] && chrome.tabs[ev].addListener)
                chrome.tabs[ev].addListener(scheduleRefresh);
        }
        // Everything else is render input: active view only.
        for (const ev of ['onMoved', 'onUpdated', 'onActivated', 'onAttached', 'onDetached']) {
            if (chrome.tabs && chrome.tabs[ev] && chrome.tabs[ev].addListener)
                chrome.tabs[ev].addListener(scheduleActiveRefresh);
        }
        for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved']) {
            if (chrome.tabGroups && chrome.tabGroups[ev] && chrome.tabGroups[ev].addListener)
                chrome.tabGroups[ev].addListener(scheduleActiveRefresh);
        }
        // Bookmarked state (filled/outline star) follows the bookmark tree.
        // The listener also flips bookmarksDirty — refresh() re-walks the
        // (expensive) full tree only after these events, never on tab churn.
        for (const ev of ['onCreated', 'onRemoved', 'onChanged']) {
            if (chrome.bookmarks && chrome.bookmarks[ev] && chrome.bookmarks[ev].addListener)
                chrome.bookmarks[ev].addListener(() => {
                    bookmarksDirty = true;
                    scheduleActiveRefresh();
                });
        }
        // Options-page writes to these keys must reach an open side panel
        // live (the view-manager already does this for show/disable keys).
        // All three keys are sync-routed since the 2026-08 storage audit, so
        // accept BOTH areas — a sync-only filter would never fire.
        if (chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if ((area !== 'sync' && area !== 'local') || !changes)
                    return;
                let touched = false;
                for (const key of ['tabGroupsColorStyle', 'tabGroupsColorBorder', 'tabGroupsSyncCollapse', 'virtualScrollLab']) {
                    if (Object.prototype.hasOwnProperty.call(changes, key)) {
                        if (store.adopt)
                            store.adopt(key, changes[key].newValue);
                        touched = true;
                    }
                }
                if (touched && views.isActive('tabgroups'))
                    render();
            });
        }
    };
    bindChromeEvents();

    $list.addEventListener('change', e => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('tabgroups-sync-collapse-input')) {
            store.set('tabGroupsSyncCollapse', t.checked ? '1' : '');
            // No re-render needed for a settings checkbox; the next collapse
            // action reads the new value.
            return;
        }
    });

    // The instant filter: every keystroke re-renders the rows; the toolbar
    // park/restore keeps the input focused AND restores the caret (a render
    // swaps the element).
    $list.addEventListener('input', e => {
        const t = e.target;
        if (t && t.classList && t.classList.contains('tabgroups-filter-input')) {
            filterText = t.value || '';
            render();
        }
    });

    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        // The filter's trailing-edge ×: clears and hands focus back to the
        // input (the re-render drops the × itself, so the toolbar restore
        // has nothing to land on — an explicit focus keeps the flow going).
        const filterClear = closest('.tabgroups-filter-clear');
        if (filterClear) {
            e.preventDefault();
            filterText = '';
            render();
            const input = $list.querySelector ? $list.querySelector('.tabgroups-filter-input') : null;
            if (input && input.focus)
                input.focus();
            return;
        }
        // Toolbar controls
        if (closest('.tabgroups-select-mode')) {
            e.preventDefault();
            setSelecting(true);
            return;
        }
        if (closest('.tabgroups-select-exit')) {
            e.preventDefault();
            setSelecting(false);
            return;
        }
        if (closest('.tabgroups-select-all')) {
            e.preventDefault();
            for (const t of tabs)
                selected.add(String(t.id));
            render();
            return;
        }
        if (closest('.tabgroups-select-invert')) {
            e.preventDefault();
            for (const t of tabs) {
                const id = String(t.id);
                if (selected.has(id))
                    selected.delete(id);
                else
                    selected.add(id);
            }
            render();
            return;
        }
        if (closest('.tabgroups-select-clear')) {
            e.preventDefault();
            selected.clear();
            render();
            return;
        }
        if (closest('.tabgroups-new-group')) {
            e.preventDefault();
            if (selected.size)
                askCopyMove(newGroup);
            return;
        }
        if (closest('.tabgroups-open-into')) {
            e.preventDefault();
            if (selected.size)
                askCopyMove(openInto);
            return;
        }
        if (closest('.tabgroups-close-selected')) {
            e.preventDefault();
            if (selected.size)
                closeSelected();
            return;
        }
        if (closest('.tabgroups-sleep-selected')) {
            e.preventDefault();
            if (selected.size)
                sleepSelected();
            return;
        }
        if (closest('.tabgroups-add-bookmarks')) {
            e.preventDefault();
            if (selected.size)
                addSelectedToBookmarks();
            return;
        }
        if (closest('.tabgroups-save-folder')) {
            e.preventDefault();
            if (selected.size)
                saveSelectedAsFolder();
            return;
        }
        if (closest('.tabgroups-refresh')) {
            e.preventDefault();
            refresh();
            return;
        }
        if (closest('.tabgroups-collapse-all')) {
            e.preventDefault();
            collapseAll();
            return;
        }
        if (closest('.tabgroups-expand-all')) {
            e.preventDefault();
            expandAll();
            return;
        }
        // Window section head: the whole row folds/unfolds its window (in
        // selection mode it toggles every tab of that window instead, the
        // same rule the group head follows). The head's own close-window
        // button acts instead of folding.
        const winCloseBtn = closest('.tabgroups-window-close');
        if (winCloseBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = winCloseBtn.closest('li');
            if (li && li.dataset.windowId)
                closeWindowById(li.dataset.windowId);
            return;
        }
        const winHead = closest('.tabgroups-window-head-row');
        if (winHead) {
            e.preventDefault();
            const li = winHead.closest('li');
            const winId = li && li.dataset.windowId;
            if (!winId)
                return;
            if (selecting) {
                toggleWindowSelection(winId);
                return;
            }
            toggleWindowCollapsed(winId);
            return;
        }
        // Selection mode: row/group clicks toggle membership.
        if (selecting) {
            const rowLi = closest('li');
            if (rowLi && rowLi.dataset) {
                if (rowLi.dataset.tabId) {
                    e.preventDefault();
                    e.stopPropagation();
                    const id = rowLi.dataset.tabId;
                    if (selected.has(id))
                        selected.delete(id);
                    else
                        selected.add(id);
                    render();
                    return;
                }
                if (rowLi.dataset.groupId) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleGroupSelection(rowLi.dataset.groupId);
                    return;
                }
            }
            return;
        }
        const closeTabBtn = closest('.tabgroups-close-tab');
        if (closeTabBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = closeTabBtn.closest('li');
            if (li && li.dataset.tabId)
                closeTabById(li.dataset.tabId);
            return;
        }
        // Row sleep toggle: hollow crescent sleeps, filled one wakes.
        const sleepTabBtn = closest('.tabgroups-sleep-tab');
        if (sleepTabBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = sleepTabBtn.closest('li');
            if (li && li.dataset.tabId)
                toggleTabSleep(li.dataset.tabId);
            return;
        }
        // The pinned glyph is its own un-pin control; the hover-revealed
        // hollow one pins the tab (4.1.0: same column, state-dependent
        // action — exactly like the sleep crescent and the star).
        const pinBtn = closest('.tabgroups-unpin') || closest('.tabgroups-pin-tab');
        if (pinBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = pinBtn.closest('li');
            if (li && li.dataset.tabId)
                togglePinned(li.dataset.tabId);
            return;
        }
        // The filled ★ removes the bookmark again (undo-captured).
        const unstarBtn = closest('.tabgroups-remove-bookmark');
        if (unstarBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = unstarBtn.closest('li');
            if (li && li.dataset.tabId)
                removeTabBookmarks(li.dataset.tabId);
            return;
        }
        const addBtn = closest('.tabgroups-add-bookmark');
        if (addBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = addBtn.closest('li');
            if (li && li.dataset.tabId)
                addTabToBookmarks(li.dataset.tabId);
            return;
        }
        // 发送到暂存 (row): the pure snapshot send, same as the menu entry.
        const stageBtn = closest('.tabgroups-stage');
        if (stageBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = stageBtn.closest('li');
            if (li && li.dataset.tabId)
                stageTabById(li.dataset.tabId);
            return;
        }
        // 发送到暂存 (group head): the whole group as one staging group.
        const groupStageBtn = closest('.tabgroups-group-stage');
        if (groupStageBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = groupStageBtn.closest('li');
            if (li && li.dataset.groupId)
                stageTabGroup(li.dataset.groupId, (groupById(li.dataset.groupId) || {}).title);
            return;
        }
        // 发送到暂存 (closed rows): the recorded tab's snapshot.
        const closedStageBtn = closest('.tabgroups-closed-stage');
        if (closedStageBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = closedStageBtn.closest('li');
            if (li && li.dataset.closedId)
                stageClosedTab(li.dataset.closedId, parseInt(li.dataset.closedTab, 10) || 0);
            return;
        }
        // 发送到暂存 (closed group head): every recorded tab of the record.
        const closedGroupStageBtn = closest('.tabgroups-closed-stage-group');
        if (closedGroupStageBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = closedGroupStageBtn.closest('li');
            if (li && li.dataset.closedId)
                stageClosedGroup(li.dataset.closedId);
            return;
        }
        const activateBtn = closest('.tabgroups-group-activate');
        if (activateBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = activateBtn.closest('li');
            if (li && li.dataset.groupId)
                activateGroup(li.dataset.groupId);
            return;
        }
        const renameBtn = closest('.tabgroups-group-rename');
        if (renameBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = renameBtn.closest('li');
            if (li && li.dataset.groupId)
                renameGroup(li.dataset.groupId);
            return;
        }
        const sleepGroupBtn = closest('.tabgroups-group-sleep');
        if (sleepGroupBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = sleepGroupBtn.closest('li');
            if (li && li.dataset.groupId)
                toggleGroupSleep(li.dataset.groupId);
            return;
        }
        const closeGroupBtn = closest('.tabgroups-group-close');
        if (closeGroupBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = closeGroupBtn.closest('li');
            if (li && li.dataset.groupId)
                closeGroup(li.dataset.groupId);
            return;
        }
        const closedOpen = closest('.tabgroups-closed-open');
        if (closedOpen) {
            e.preventDefault();
            e.stopPropagation();
            const li = closedOpen.closest('li');
            if (li && li.dataset.closedId)
                restoreClosedGroup(li.dataset.closedId);
            return;
        }
        const closedReopen = closest('.tabgroups-closed-reopen');
        if (closedReopen) {
            e.preventDefault();
            e.stopPropagation();
            const li = closedReopen.closest('li');
            if (li && li.dataset.closedId)
                restoreClosedGroup(li.dataset.closedId);
            return;
        }
        const closedClear = closest('.tabgroups-closed-clear');
        if (closedClear) {
            e.preventDefault();
            clearClosedGroups();
            return;
        }
        const closedAddBookmark = closest('.tabgroups-closed-add-bookmark');
        if (closedAddBookmark) {
            e.preventDefault();
            e.stopPropagation();
            const li = closedAddBookmark.closest('li');
            if (li && li.dataset.closedId)
                addClosedTabToBookmarks(li.dataset.closedId, parseInt(li.dataset.closedTab, 10) || 0);
            return;
        }
        const closedRemoveTab = closest('.tabgroups-closed-remove-tab');
        if (closedRemoveTab) {
            e.preventDefault();
            e.stopPropagation();
            const li = closedRemoveTab.closest('li');
            if (li && li.dataset.closedId)
                removeClosedTab(li.dataset.closedId, parseInt(li.dataset.closedTab, 10) || 0);
            return;
        }
        const closedDelete = closest('.tabgroups-closed-delete');
        if (closedDelete) {
            e.preventDefault();
            e.stopPropagation();
            const li = closedDelete.closest('li');
            if (li && li.dataset.closedId)
                deleteClosedGroup(li.dataset.closedId);
            return;
        }
        const closedHead = closest('.tabgroups-closed-head');
        if (closedHead) {
            e.preventDefault();
            const li = closedHead.closest('li');
            if (li && li.dataset.closedId)
                toggleClosedExpanded(li.dataset.closedId);
            return;
        }
        const saveBtn = closest('.tabgroups-group-save');
        if (saveBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = saveBtn.closest('li');
            if (li && li.dataset.groupId)
                saveGroupToBookmarks(li.dataset.groupId);
            return;
        }
        const head = closest('.tabgroups-group-head');
        if (head) {
            e.preventDefault();
            const li = head.closest('li');
            if (li && li.dataset.groupId)
                toggleGroupCollapsed(li.dataset.groupId);
            return;
        }
        const anchor = closest('a');
        if (anchor && anchor.dataset && anchor.dataset.tabId) {
            e.preventDefault();
            focusTab(tabById(anchor.dataset.tabId));
            return;
        }
        if (anchor && anchor.dataset && anchor.dataset.closedId) {
            e.preventDefault();
            openClosedTab(anchor.dataset.closedId, anchor.dataset.closedTab);
            return;
        }
    });

    $list.addEventListener('auxclick', e => {
        // Only middle-click (button 1) activates a tab row. A right-click
        // also fires auxclick after the context menu opens — treating it as
        // an activation made right-click jump to the browser tab.
        if (e.button !== 1)
            return;
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        const anchor = closest('a');
        if (anchor && anchor.dataset && anchor.dataset.tabId) {
            e.preventDefault();
            focusTab(tabById(anchor.dataset.tabId));
        }
    });

    // Window/group-header keys, capture phase (the dupes recipe):
    // Space/Enter/←/→ collapse/expand; in selection mode Space toggles the
    // whole section. Both heads speak the same protocol, one nesting level
    // apart (window → group → row).
    $list.addEventListener('keydown', e => {
        const isRtlNow = () => !!(document.body && document.body.classList
            && document.body.classList.contains('rtl'));
        const winHead = (e.target && e.target.classList
            && e.target.classList.contains('tabgroups-window-head-row'))
            ? e.target
            : (e.target && e.target.closest ? e.target.closest('.tabgroups-window-head-row') : null);
        if (winHead) {
            const li = winHead.closest('li');
            const winId = li && li.dataset.windowId;
            if (!winId)
                return;
            // A BUTTON inside the head (close window) keeps its native keys
            // — the capture-phase fold handler must not eat its Space/Enter.
            if (e.target && e.target.closest && e.target.closest('button'))
                return;
            const k = e.key;
            const isCollapsed = isWindowCollapsed(winId);
            if (k === 'F2') {
                // Never fall through to keyboard.js's bookmark rename.
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            if (k === ' ' || k === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (selecting)
                    toggleWindowSelection(winId);
                else
                    setWindowCollapsed(winId, !isCollapsed);
                return;
            }
            const forwardW = k === (isRtlNow() ? 'ArrowLeft' : 'ArrowRight');
            const backW = k === (isRtlNow() ? 'ArrowRight' : 'ArrowLeft');
            if (forwardW || backW) {
                // Folded + forward opens, open + back folds; the remaining
                // combinations are swallowed on purpose — a window head has
                // no context menu and no structural parent, and letting the
                // generic row rule run would open the FOLDER menu on it.
                e.preventDefault();
                e.stopPropagation();
                if (forwardW && isCollapsed)
                    setWindowCollapsed(winId, false);
                else if (backW && !isCollapsed)
                    setWindowCollapsed(winId, true);
                return;
            }
            return;
        }
        const head = (e.target && e.target.classList && e.target.classList.contains('tabgroups-group-head'))
            ? e.target
            : (e.target && e.target.closest ? e.target.closest('.tabgroups-group-head') : null);
        if (head) {
            const li = head.closest('li');
            const gid = li && li.dataset.groupId;
            if (!gid)
                return;
            const k = e.key;
            const isCollapsed = collapsed.has(gid);
            if (selecting && k === ' ') {
                e.preventDefault();
                e.stopPropagation();
                toggleGroupSelection(gid);
                return;
            }
            if (k === 'F2') {
                e.preventDefault();
                e.stopImmediatePropagation();
                renameGroup(gid);
                return;
            }
            const isRtl = !!(document.body && document.body.classList && document.body.classList.contains('rtl'));
            const forward = k === (isRtl ? 'ArrowLeft' : 'ArrowRight');
            const back = k === (isRtl ? 'ArrowRight' : 'ArrowLeft');
            if (k === ' ' || k === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                setGroupCollapsed(gid, !isCollapsed);
                return;
            }
            if (forward && isCollapsed) {
                // Closed group + forward arrow: expand it (tree-folder rule).
                e.preventDefault();
                e.stopPropagation();
                setGroupCollapsed(gid, false);
                return;
            }
            if (forward) {
                // Open group + forward arrow: open the group context menu at
                // the head's edge (the generic row rule, now that folding is
                // no longer the forward action on an already-open group).
                e.preventDefault();
                e.stopPropagation();
                if (head.dispatchEvent && typeof MouseEvent !== 'undefined') {
                    const rect = head.getBoundingClientRect
                        ? head.getBoundingClientRect() : null;
                    head.dispatchEvent(new MouseEvent('contextmenu', {
                        bubbles: true,
                        cancelable: true,
                        ...(typeof window !== 'undefined' ? { view: window } : {}),
                        clientX: rect ? rect.right : 0,
                        clientY: rect ? rect.bottom : 0
                    }));
                }
                return;
            }
            if (back && !isCollapsed) {
                // Open group + back arrow: collapse it.
                e.preventDefault();
                e.stopPropagation();
                setGroupCollapsed(gid, true);
                return;
            }
            if (back) {
                // Collapsed group + back arrow: up to the structural parent —
                // the window head is a focusable row now, so the tree model's
                // "← walks to the parent" holds at every level of this view.
                e.preventDefault();
                e.stopPropagation();
                focusWindowHead((groupById(gid) || {}).windowId);
            }
            return;
        }
        // Closed-record heads speak the same fold protocol as the group and
        // window heads (one nesting level of their own): Space/Enter expands
        // and collapses, forward-arrow opens a collapsed record, back-arrow
        // folds an open one (tree-folder rule, keyboard-model §2.3). Before
        // 4.1.0 the row walk could FOCUS the head but no key answered — a
        // closed group was mouse-only to expand.
        const closedHead = (e.target && e.target.classList
            && e.target.classList.contains('tabgroups-closed-head'))
            ? e.target
            : (e.target && e.target.closest ? e.target.closest('.tabgroups-closed-head') : null);
        if (closedHead) {
            const li = closedHead.closest('li');
            const cid = li && li.dataset.closedId;
            if (!cid)
                return;
            const k = e.key;
            if (selecting && k === ' ') {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            const isCollapsed = !expandedClosed.has(String(cid));
            const forwardC = k === (isRtlNow() ? 'ArrowLeft' : 'ArrowRight');
            const backC = k === (isRtlNow() ? 'ArrowRight' : 'ArrowLeft');
            if (k === ' ' || k === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                toggleClosedExpanded(cid);
                return;
            }
            if (forwardC && isCollapsed) {
                e.preventDefault();
                e.stopPropagation();
                toggleClosedExpanded(cid);
                return;
            }
            if (backC && !isCollapsed) {
                e.preventDefault();
                e.stopPropagation();
                toggleClosedExpanded(cid);
                return;
            }
            return;
        }
        // F2 on a tab row is a no-op here, but it must never fall through
        // to keyboard.js's bookmark-rename path (the row is not a bookmark).
        if (e.key === 'F2') {
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        // Structural back-arrow for grouped tab rows (keyboard-model §2.4,
        // the dupes-member rule): ← (RTL →) jumps to the owning group head.
        // The forward arrow keeps keyboard.js's default context-menu open.
        const rowLi = e.target && e.target.closest ? e.target.closest('li.tabgroups-row') : null;
        if (rowLi && rowLi.dataset && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            const back = (e.key === 'ArrowLeft') !== isRtlNow();
            if (back && rowLi.dataset.groupId) {
                e.preventDefault();
                e.stopPropagation();
                const head = $list.querySelector
                    ? $list.querySelector(`#tabgroups-group-${rowLi.dataset.groupId} .tabgroups-group-head`)
                    : null;
                if (head && head.focus)
                    head.focus();
                return;
            }
            if (back) {
                // Ungrouped row: its structural parent is the window head.
                e.preventDefault();
                e.stopPropagation();
                focusWindowHead(rowLi.dataset.windowId);
                return;
            }
        }
        // Tab-row Space in selection mode toggles the row (click parity).
        if (selecting && e.key === ' ') {
            const rowLi = e.target && e.target.closest ? e.target.closest('li.tabgroups-row') : null;
            if (!rowLi || !rowLi.dataset || !rowLi.dataset.tabId)
                return;
            e.preventDefault();
            e.stopPropagation();
            const id = rowLi.dataset.tabId;
            if (selected.has(id))
                selected.delete(id);
            else
                selected.add(id);
            render();
        }
    }, true);

    // Delete on a tab row must not reach keyboard.js's bookmark-delete
    // handler (the row is not a bookmark). In selection mode Delete closes
    // the selected tabs; otherwise it closes the focused tab. Both paths
    // confirm first — tab close has no undo.
    $list.addEventListener('keyup', e => {
        if (e.key !== 'Delete')
            return;
        // Text fields own their Delete (caret editing) — never swallow it.
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || ''))
            return;
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        let rowLi = closest('li.tabgroups-row');
        if (!rowLi && e.target === $list && $list.querySelector) {
            const marked = $list.querySelector('.focus');
            rowLi = marked && marked.closest ? marked.closest('li.tabgroups-row') : null;
        }
        if (!rowLi) {
            // Every other row in this view (group/window/closed heads,
            // closed tabs) is NOT a bookmark: swallow Delete so it can never
            // fall through to keyboard.js's bookmark-delete path with a
            // bogus id like "tabgroups-group-12".
            e.preventDefault();
            e.stopImmediatePropagation();
            return;
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        if (selecting && selected.size) {
            closeSelected();
            return;
        }
        if (rowLi.dataset && rowLi.dataset.tabId)
            closeTabById(rowLi.dataset.tabId);
    });

    // --- Drag sorting (chrome.tabs.move) ---------------------------------------
    const clearDragClasses = () => {
        if (!$list.querySelectorAll)
            return;
        const rows = $list.querySelectorAll('.drag-over, .dragging');
        for (let i = 0, l = rows.length; i < l; i++)
            rows[i].classList.remove('drag-over', 'dragging');
    };
    $list.addEventListener('dragstart', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        const li = closest('li.tabgroups-row');
        if (!li || !li.dataset || !li.dataset.tabId)
            return;
        dragTabId = li.dataset.tabId;
        if (e.dataTransfer && e.dataTransfer.setData)
            e.dataTransfer.setData('text/plain', dragTabId);
        if (li.classList)
            li.classList.add('dragging');
    });
    $list.addEventListener('dragover', e => {
        if (!dragTabId)
            return;
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        const li = closest('li.tabgroups-row');
        if (!li)
            return;
        e.preventDefault();
        if (e.dataTransfer)
            e.dataTransfer.dropEffect = 'move';
        if (li.classList && !li.classList.contains('drag-over'))
            li.classList.add('drag-over');
    });
    $list.addEventListener('dragleave', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        const li = closest('li.tabgroups-row');
        if (li && li.classList)
            li.classList.remove('drag-over');
    });
    $list.addEventListener('drop', e => {
        e.preventDefault();
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        const targetLi = closest('li.tabgroups-row');
        if (dragTabId && targetLi && targetLi.dataset && targetLi.dataset.tabId
            && String(targetLi.dataset.tabId) !== String(dragTabId)) {
            const targetTab = tabById(targetLi.dataset.tabId);
            const targetWindowId = targetTab ? targetTab.windowId : currentWindowId;
            if (chrome.tabs.move)
                chrome.tabs.move(Number(dragTabId), { windowId: targetWindowId, index: targetTab ? targetTab.index : -1 }, swallowLastError);
        }
        dragTabId = null;
        clearDragClasses();
        scheduleRefresh();
    });
    $list.addEventListener('dragend', () => {
        dragTabId = null;
        clearDragClasses();
    });

    // --- View registration -------------------------------------------------------
    views.register({
        id: 'tabgroups',
        titleKey: 'viewTabGroups',
        icon: VIEW_ICONS.tabgroups,
        container: $('view-tabgroups'),
        listEl: $list,
        hidden: !store.get('showTabGroupsView', '1'),
        showKey: 'showTabGroupsView',
        disableKey: 'disableTabGroupsView',
        typeAhead: false,
        badge: () => tabs.length,
        activate: () => {
            // Always revalidate on entry: tabs change behind the popup. The
            // first activation of this page session also scrolls the current
            // tab into view once its render lands (design §7).
            if (!initialScrollDone) {
                initialScrollDone = true;
                pendingScrollToCurrent = true;
            }
            refresh();
        },
        onEscape: () => {
            // The view's own Esc levels, innermost first (the document Esc
            // chain calls onEscapeActive before the search quit / back-to-
            // tree / window-close layers): an active filter clears first —
            // it is the most transient state — then selection mode exits.
            if (filterNeedle()) {
                filterText = '';
                render();
                return true;
            }
            if (!selecting)
                return false;
            setSelecting(false);
            return true;
        }
    });

    return {
        refresh,
        setSelecting,
        selectedTabs,
        isSelecting: () => selecting,
        // velvet staging §2.5: bookmark-and-stage interop (context-menu.js
        // reads these through neat.js's ctx.tabGroupsMenu getter).
        stageTabById,
        stageTabGroup,
        stageClosedGroup,
        // Lazy context-menu dispatch (context-menu.js reads these through
        // neat.js's ctx.tabGroupsMenu getter).
        activateTab: tabId => focusTab(tabById(tabId)),
        isPinned: tabId => {
            const tab = tabById(tabId);
            return !!(tab && tab.pinned);
        },
        togglePinned,
        addBookmark: addTabToBookmarks,
        // The row menu's bookmark entry is a toggle like the ★ itself.
        isBookmarked: tabId => {
            const tab = tabById(tabId);
            return !!(tab && bookmarkedUrls.has(tab.url || ''));
        },
        removeBookmark: removeTabBookmarks,
        closeTab: closeTabById,
        sleepTab: sleepTabById,
        wakeTab: wakeTabById,
        isDiscarded: tabId => {
            const tab = tabById(tabId);
            return !!(tab && tab.discarded);
        },
        activateGroup,
        renameGroup,
        saveGroupToBookmarks,
        closeGroup,
        sleepGroup,
        wakeGroup,
        isGroupAsleep,
        toggleGroup: toggleGroupCollapsed,
        isCollapsed: gid => collapsed.has(String(gid)),
        ungroupGroup,
        moveGroupToNewWindow,
        // Closed-record surface (the closed-row context menus dispatch here;
        // every entry is state-checked against the live record list).
        restoreClosedGroup,
        deleteClosedGroup,
        clearClosedGroups,
        removeClosedTab,
        openClosedTab,
        addClosedTabToBookmarks,
        isClosedExpanded,
        toggleClosedExpanded,
        closedRecordType: recordId => {
            const record = closedRecordById(recordId);
            return record ? (record.type || 'group') : null;
        },
        closedTabCount: recordId => {
            const record = closedRecordById(recordId);
            return record ? (record.tabs || []).length : 0;
        },
        // Window sections (keyboard/menu parity with the group heads)
        isWindowCollapsed,
        toggleWindowCollapsed
    };
}