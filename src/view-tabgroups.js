/**
 * Tab groups view (docs/tab-groups-view-design.md) — browser tabs + tab groups
 * + bookmarks, living between the search and recent views.
 *
 * Renders every normal browser window's tabs in tab-strip order, the current
 * window first. Each window is a foldable section whose WHOLE head row is the
 * fold control (a focusable role=button row, so the keyboard model reaches it
 * like a tree folder); the current window is open by default and the others
 * fold, with an explicit fold/unfold remembered for next time. Tabs that
 * belong to a Chrome tab group render under a group header (title, color dot,
 * count, go-to/rename/save/sleep/close actions); ungrouped tabs render as
 * plain rows in the same order. Every row ends with the same four icon
 * columns — pin / sleep / bookmark / close — so the columns line up on every
 * row and in selection mode (where they render as inert state markers): the
 * pinned glyph unpins, the crescent is hollow while the tab is awake and
 * filled (click = wake) once it sleeps, and the filled ★ removes the
 * bookmark again (undo-captured).
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

import { VIEW_ICONS, STAR_ICON, STAR_ICON_FILLED, SELECT_ICON, FOLDER_ICON, EDIT_ICON, SLEEP_ICON, SLEEP_ICON_FILLED, ACTIVATE_ICON, TRASH_ICON, REDO_ICON, COLLAPSE_ALL_ICON, EXPAND_ALL_ICON, PIN_ICON } from './icons.js';
import { htmlspecialchars } from './escape.js';
import { parkRowFocus, unparkRowFocus, parkToolbarFocus, restoreToolbarFocus } from './list-focus.js';
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
    const undo = ctx.undo || { showToast: () => {} };
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
    // Group color decoration (options page, default off) — one of three:
    //   'off'  color dot only (the default);
    //   'edge' a 3px band in the group color down the header + member rows
    //          (the original tabGroupsColorBorder switch);
    //   'line' a color CONNECTOR line under the group head's dot with a
    //          per-row tick, tying the whole group into one tree.
    // The legacy boolean key is read as 'edge' so an existing profile keeps
    // the look it had before the style choice existed.
    const colorStyle = () => {
        const v = store.get('tabGroupsColorStyle', '');
        if (v === 'edge' || v === 'line' || v === 'off')
            return v;
        return store.get('tabGroupsColorBorder', '') ? 'edge' : 'off';
    };

    // --- State ----------------------------------------------------------------
    let refreshToken = 0;   // monotonic refresh generation: stale async
                            // tabs/tabGroups callbacks must never overwrite
                            // a newer refresh
    let windows = [];       // [{ id, focused, tabs }] sorted: current first
    let tabs = [];          // flat chrome.tabs.Tab[] across every window
    let groups = [];        // chrome.tabGroups.TabGroup[] across every window
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
    // Fold state saved when selection mode opens everything up, restored on
    // exit (selection mode must show every candidate row).
    let foldSnapshot = null;

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

    const groupById = id => groups.find(g => String(g.id) === String(id));
    const tabById = id => tabs.find(t => String(t.id) === String(id));
    // Chrome reports groupId: -1 for tabs that are NOT grouped; every
    // truthiness check must treat -1 as "no group".
    const isGrouped = tab => !!tab && !!tab.groupId && tab.groupId !== -1;

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
    // the current window first. Fallback: the pre-existing current-window
    // tabs.query path (old Chrome / minimal tests).
    const readWindows = cb => {
        if (chrome.windows && chrome.windows.getAll) {
            chrome.windows.getAll({ populate: true }, wins => {
                const all = (wins || [])
                    .filter(w => w && w.tabs && w.tabs.length && (!w.type || w.type === 'normal'))
                    .map(w => ({
                        id: w.id,
                        focused: !!w.focused,
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
        readWindows(winList => {
            if (token !== refreshToken)
                return; // a newer refresh started — drop this stale read
            windows = winList;
            tabs = windows.flatMap(w => w.tabs.map(t => ({ ...t, _windowId: t.windowId || w.id })));
            const focused = windows.find(w => w.focused) || windows[0];
            currentWindowId = focused ? focused.id
                : ((chrome.windows && chrome.windows.WINDOW_ID_CURRENT) || 1);
            const activeTab = tabs.find(t => t.active);
            currentTabId = activeTab ? activeTab.id : (tabs[0] && tabs[0].id);
            queryAllGroups(groupList => {
                if (token !== refreshToken)
                    return;
                groups = groupList || [];
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
                views.updateBadges();
                if (!views.isActive('tabgroups'))
                    return;
                chrome.bookmarks.getTree(tree => {
                    if (token !== refreshToken)
                        return;
                    const sets = collectTreeSets(tree);
                    bookmarkedUrls = sets.urls;
                    pruneTabGroupFolderMeta(store, sets.folderIds);
                    render();
                });
            });
        });
    };

    // --- Rendering --------------------------------------------------------------
    const iconBtn = (cls, icon, labelKey) => {
        const label = _m(labelKey);
        return `<button class="${cls} tabgroups-icon-btn" title="${htmlspecialchars(label)}" ` +
            `aria-label="${htmlspecialchars(label)}">${icon}</button>`;
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
        // right); row 2 = view options (collapse-sync checkbox left, select
        // mode icon right).
        const syncLabel = _m('tabGroupsSyncCollapse');
        const syncHint = _m('tabGroupsSyncCollapseHint');
        return '<div class="tabgroups-toolbar tabgroups-controls-toolbar vbm-toolbar">' +
            `<span class="tabgroups-summary">${_m('tabGroupsSummary', [`${tabs.length}`, `${groups.length}`])}</span>` +
            iconBtn('tabgroups-refresh', REDO_ICON, 'tabGroupsToolbarRefresh') +
            iconBtn('tabgroups-collapse-all', COLLAPSE_ALL_ICON, 'tabGroupsCollapseAll') +
            iconBtn('tabgroups-expand-all', EXPAND_ALL_ICON, 'tabGroupsExpandAll') +
            '</div>' +
            '<div class="tabgroups-toolbar tabgroups-actions-toolbar vbm-toolbar">' +
            `<span class="tabgroups-options" role="group" aria-label="${htmlspecialchars(_m('tabGroupOptions'))}">` +
            `<label class="tabgroups-sync-collapse" title="${htmlspecialchars(syncHint)}">` +
            `<input type="checkbox" class="tabgroups-sync-collapse-input"${syncCollapse() ? ' checked' : ''}>` +
            `<span>${htmlspecialchars(syncLabel)}</span></label>` +
            '</span>' +
            iconBtn('tabgroups-select-mode', SELECT_ICON, 'selectModeEnter') +
            '</div>';
    };

    const groupHeadHtml = (group, memberTabs) => {
        const gid = String(group.id);
        const isCollapsed = collapsed.has(gid);
        const title = group.title || _m('tabGroupUntitled');
        const color = group.color || 'grey';
        const saveLabel = _m('tabGroupsSaveFolder');
        // Group sleep is a real toggle, like the member rows': every member
        // asleep → filled glyph + wake, otherwise hollow glyph + sleep.
        const allAsleep = memberTabs.length > 0 && memberTabs.every(t => !!t.discarded);
        const sleepLabel = _m(allAsleep ? 'tabGroupsWakeGroup' : 'tabGroupsSleepGroup');
        return `<li class="tabgroups-group tg-${htmlspecialchars(color)}${selecting && memberTabs.every(t => selected.has(String(t.id))) ? ' sel' : ''}" id="tabgroups-group-${gid}" data-group-id="${gid}">` +
            `<span class="tabgroups-group-head" tabindex="-1" role="button" aria-expanded="${isCollapsed ? 'false' : 'true'}" title="${htmlspecialchars(title)}">` +
            `<span class="chevron${isCollapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            `<span class="tab-group-dot tg-${htmlspecialchars(color)}"></span>` +
            `<span class="tabgroups-group-title" dir="auto">${htmlspecialchars(title)}</span>` +
            `<span class="count-pill" aria-label="${htmlspecialchars(_m('tabGroupsGroupCount', `${memberTabs.length}`))}">${memberTabs.length}</span>` +
            `<button class="row-btn tabgroups-group-activate" aria-label="${htmlspecialchars(_m('tabGroupsActivateGroup'))}" title="${htmlspecialchars(_m('tabGroupsActivateGroup'))}">${ACTIVATE_ICON}</button>` +
            `<button class="row-btn tabgroups-group-rename" aria-label="${htmlspecialchars(_m('tabGroupsRenameGroup'))}" title="${htmlspecialchars(_m('tabGroupsRenameGroup'))}">${EDIT_ICON}</button>` +
            `<button class="row-btn tabgroups-group-save" aria-label="${htmlspecialchars(saveLabel)}" title="${htmlspecialchars(saveLabel)}">${FOLDER_ICON}</button>` +
            `<button class="row-btn tabgroups-group-sleep${allAsleep ? ' asleep' : ''}" aria-pressed="${allAsleep}" aria-label="${htmlspecialchars(sleepLabel)}" title="${htmlspecialchars(sleepLabel)}">${allAsleep ? SLEEP_ICON_FILLED : SLEEP_ICON}</button>` +
            `<button class="row-btn tabgroups-group-close" aria-label="${htmlspecialchars(_m('tabGroupsCloseGroup'))}" title="${htmlspecialchars(_m('tabGroupsCloseGroup'))}">${TRASH_ICON}</button>` +
            '</span></li>';
    };

    // An empty 20px slot: keeps the four row-icon columns (pin / sleep /
    // bookmark / close) aligned on EVERY row and in both modes, so a row
    // without a pin or a bookmark does not shift its neighbours' glyphs.
    const emptySlot = () => '<span class="tabgroups-slot" aria-hidden="true"></span>';

    // The row's trailing icon strip. Non-selection mode renders live
    // controls (state glyph = click toggles that state); selection mode
    // renders the SAME four columns as inert state markers, so the row
    // geometry is identical in both modes (only the batch bar acts there).
    const rowIcons = tab => {
        const pinned = !!tab.pinned;
        const discarded = !!tab.discarded;
        const bookmarked = bookmarkedUrls.has(tab.url || '');
        const pinnedLabel = _m('tabGroupsPinned');
        const discardedLabel = _m('tabGroupsDiscarded');
        const bookmarkedLabel = _m('tabGroupsBookmarked');
        if (selecting) {
            return (pinned
                ? `<span class="tabgroups-status-icon pinned" aria-label="${htmlspecialchars(pinnedLabel)}" title="${htmlspecialchars(pinnedLabel)}">${PIN_ICON}</span>`
                : emptySlot()) +
                (discarded
                    ? `<span class="tabgroups-status-icon discarded" aria-label="${htmlspecialchars(discardedLabel)}" title="${htmlspecialchars(discardedLabel)}">${SLEEP_ICON_FILLED}</span>`
                    : emptySlot()) +
                (bookmarked
                    ? `<span class="tabgroups-star" aria-label="${htmlspecialchars(bookmarkedLabel)}" title="${htmlspecialchars(bookmarkedLabel)}">${STAR_ICON_FILLED}</span>`
                    : emptySlot()) +
                emptySlot();
        }
        // Pin: a pinned tab shows the always-visible glyph and one click
        // unpins it (the state icon IS the action). An unpinned tab keeps
        // the column reserved — pinning stays a context-menu action.
        const pinHtml = pinned
            ? `<button class="row-btn tabgroups-unpin always-on" aria-pressed="true" aria-label="${htmlspecialchars(_m('tabGroupsUnpinTab'))}" title="${htmlspecialchars(_m('tabGroupsUnpinTab'))}">${PIN_ICON}</button>`
            : emptySlot();
        // Sleep: hollow crescent = awake (click sleeps), filled = sleeping
        // (always visible, click wakes the tab in place).
        const sleepLabel = _m(discarded ? 'tabGroupsWakeTab' : 'tabGroupsSleepTab');
        const sleepHtml = `<button class="row-btn tabgroups-sleep-tab${discarded ? ' asleep always-on' : ''}" ` +
            `aria-pressed="${discarded}" aria-label="${htmlspecialchars(sleepLabel)}" title="${htmlspecialchars(sleepLabel)}">` +
            `${discarded ? SLEEP_ICON_FILLED : SLEEP_ICON}</button>`;
        // Bookmark state follows the stats-view recipe: an always-visible
        // filled ★ once bookmarked — clicking it now REMOVES the bookmark
        // (undo-captured) — and a hover-revealed hollow ☆ otherwise.
        const starHtml = bookmarked
            ? `<button class="row-btn tabgroups-remove-bookmark always-on" aria-pressed="true" aria-label="${htmlspecialchars(_m('tabGroupsRemoveBookmark'))}" title="${htmlspecialchars(_m('tabGroupsRemoveBookmark'))}">${STAR_ICON_FILLED}</button>`
            : `<button class="row-btn tabgroups-add-bookmark tabgroups-add-btn" aria-label="${htmlspecialchars(_m('tabGroupsAddBookmark'))}" title="${htmlspecialchars(_m('tabGroupsAddBookmark'))}">${STAR_ICON}</button>`;
        // The rightmost hover action is close-tab (delete).
        const closeLabel = _m('tabGroupsSelectClose');
        const closeHtml = `<button class="row-btn tabgroups-close-tab" aria-label="${htmlspecialchars(closeLabel)}" title="${htmlspecialchars(closeLabel)}">${TRASH_ICON}</button>`;
        return pinHtml + sleepHtml + starHtml + closeHtml;
    };

    const tabRowHtml = (tab, opts = {}) => {
        const tid = String(tab.id);
        const isCurrent = String(tab.id) === String(currentTabId);
        const inGroup = isGrouped(tab);
        const isSelected = selected.has(tid);
        const pinned = !!tab.pinned;
        const discarded = !!tab.discarded;
        const currentLabel = _m('tabGroupsCurrentTab');
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
            treeRender.generateBookmarkHTML(tab.title || tab.url || _m('noTitle'), tab.url || '', extras, null, null, { badge }) +
            rowIcons(tab) +
            '</li>';
    };

    // Closed rows carry the time we closed them: the records are OUR own
    // (written by closeTabById/closeGroup), so savedAt is always available —
    // no browser API guessing. Narrow popup: relative time inline in the
    // right slot; wide/panel: the absolute time as the second line's right
    // half (the dead view's rightText/subRight recipe). A closed GROUP's
    // member rows inherit the head's time and stay single-line.
    const closedTabHtml = (record, tab, idx) => {
        const title = tab.title || tab.url || _m('noTitle');
        const extras = `data-closed-id="${htmlspecialchars(record.id)}" data-closed-tab="${idx}"`;
        const addLabel = _m('tabGroupsAddBookmark');
        const removeLabel = _m('tabGroupsRemoveClosedTab');
        const standalone = record.type === 'tab';
        const savedAt = record.savedAt || 0;
        const meta = (standalone && savedAt)
            ? {
                rightText: relTimeLabel(savedAt, _m),
                subRight: new Date(savedAt).toLocaleString(),
                tooltipAppend: `${_m('tabGroupsClosedTimeLabel')} ${new Date(savedAt).toLocaleString()}`
            }
            : {};
        return `<li class="vbm-row tabgroups-closed-tab" data-closed-id="${htmlspecialchars(record.id)}" data-closed-tab="${idx}">` +
            treeRender.generateBookmarkHTML(title, tab.url || '', extras, null, null, meta) +
            `<button class="row-btn tabgroups-closed-add-bookmark" aria-label="${htmlspecialchars(addLabel)}" title="${htmlspecialchars(addLabel)}">${STAR_ICON}</button>` +
            `<button class="row-btn tabgroups-closed-remove-tab" aria-label="${htmlspecialchars(removeLabel)}" title="${htmlspecialchars(removeLabel)}">${TRASH_ICON}</button>` +
            '</li>';
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
            `<button class="row-btn tabgroups-closed-delete" aria-label="${htmlspecialchars(deleteLabel)}" title="${htmlspecialchars(deleteLabel)}">${TRASH_ICON}</button>` +
            '</span></li>';
        if (isExpanded) {
            const tabs = record.tabs || [];
            for (let i = 0; i < tabs.length; i++)
                html += closedTabHtml(record, tabs[i], i);
        }
        return html;
    };

    const render = () => {
        // Prune selected ids whose tab vanished.
        const alive = new Set(tabs.map(t => String(t.id)));
        for (const id of [...selected])
            if (!alive.has(id))
                selected.delete(id);

        let html = renderToolbar();
        if (!tabs.length) {
            html += `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('tabGroupsViewEmpty')}</i></li></ul>`;
        } else {
            const style = colorStyle();
            const ulClass = [
                selecting ? 'selecting' : '',
                style === 'edge' ? 'color-enhanced' : '',
                style === 'line' ? 'color-line' : ''
            ].filter(Boolean).join(' ');
            html += `<ul role="list"${ulClass ? ` class="${ulClass}"` : ''}>`;

            // Window section head: the WHOLE row is the fold control (a
            // focusable role=button span, so it joins the row keyboard model
            // exactly like a group head) — the old chevron-only button left
            // most of the row dead to both mouse and keyboard.
            const windowHead = (win, idx) => {
                const label = _m('tabGroupsWindow', [`${idx + 1}`]);
                const isCollapsed = collapsedWindows.has(String(win.id));
                const toggleLabel = _m(isCollapsed ? 'tabGroupsExpandWindow' : 'tabGroupsCollapseWindow');
                const current = win.focused ? `<b class="tabgroups-window-current">${_m('tabGroupsCurrentWindow')}</b>` : '';
                const count = win.tabs.length;
                return `<li class="tabgroups-window-head" data-window-id="${String(win.id)}">` +
                    `<span class="tabgroups-window-head-row" tabindex="-1" role="button" ` +
                    `aria-expanded="${isCollapsed ? 'false' : 'true'}" ` +
                    `aria-label="${htmlspecialchars(`${label} · ${toggleLabel}`)}" ` +
                    `title="${htmlspecialchars(toggleLabel)}">` +
                    `<span class="chevron${isCollapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
                    `<em>${htmlspecialchars(label)}</em>${current}` +
                    `<span class="count-pill" aria-label="${htmlspecialchars(_m('tabGroupsGroupCount', `${count}`))}">${count}</span>` +
                    '</span></li>';
            };
            const groupBlock = ({ group, memberTabs }) => {
                let out = groupHeadHtml(group, memberTabs);
                if (!collapsed.has(String(group.id))) {
                    for (let mi = 0; mi < memberTabs.length; mi++)
                        out += tabRowHtml(memberTabs[mi], { lastMember: mi === memberTabs.length - 1 });
                }
                return out;
            };

            for (let wi = 0, wl = windows.length; wi < wl; wi++) {
                const win = windows[wi];
                html += windowHead(win, wi);
                if (collapsedWindows.has(String(win.id)))
                    continue;

                // Open groups and ungrouped tabs render INTERLEAVED in the
                // browser's actual tab order (drag sorting reorders that
                // order). Closed (collapsed) groups leave the inline flow
                // and anchor to the bottom of their window section.
                const seenGroups = new Set();
                for (let i = 0, l = win.tabs.length; i < l; i++) {
                    const tab = win.tabs[i];
                    if (!isGrouped(tab)) {
                        html += tabRowHtml(tab);
                        continue;
                    }
                    const group = groupById(tab.groupId);
                    if (!group) {
                        html += tabRowHtml(tab);
                        continue;
                    }
                    const gid = String(group.id);
                    if (seenGroups.has(gid))
                        continue;
                    seenGroups.add(gid);
                    const memberTabs = win.tabs.filter(t => String(t.groupId) === gid)
                        .sort((a, b) => (a.index || 0) - (b.index || 0));
                    // Collapsed groups stay inline in tab order (they are not
                    // closed — their tabs still exist in the browser).
                    html += groupBlock({ group, memberTabs });
                }
            }

            if (closedRecords.length) {
                const clearLabel = _m('tabGroupsClearClosedGroups');
                html += `<li class="tabgroups-section-head tabgroups-closed-section-head"><em>${_m('tabGroupsClosedGroups')}</em>` +
                    `<button class="tabgroups-closed-clear" title="${htmlspecialchars(clearLabel)}" aria-label="${htmlspecialchars(clearLabel)}">${htmlspecialchars(clearLabel)}</button></li>`;
                for (const record of closedRecords) {
                    if (record.type === 'tab') {
                        const tab = (record.tabs && record.tabs[0]) || { title: record.title || '', url: record.url || '' };
                        html += closedTabHtml(record, tab, 0);
                    } else {
                        html += closedGroupHtml(record);
                    }
                }
            }
            html += '</ul>';
        }
        const parkedToolbar = parkToolbarFocus($list);
        const parkedRow = parkRowFocus($list);
        $list.innerHTML = html;
        restoreToolbarFocus($list, parkedToolbar);
        unparkRowFocus($list, parkedRow);
        if (pendingScrollToCurrent) {
            pendingScrollToCurrent = false;
            const cur = $list.querySelector ? $list.querySelector('.tabgroups-current') : null;
            if (cur && cur.scrollIntoView)
                cur.scrollIntoView({ block: 'nearest' });
        }
        onRowsRendered();
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
        const finish = () => {
            if (chrome.tabs.update) {
                chrome.tabs.update(tab.id, { pinned: shouldPin }, () => {
                    if (chrome.runtime.lastError)
                        return;
                    scheduleRefresh();
                });
            }
        };
        // Pinning a tab removes it from its tab group first (Chrome keeps
        // the two states mutually exclusive).
        if (shouldPin && isGrouped(tab)) {
            if (chrome.tabs.ungroup)
                chrome.tabs.ungroup(tab.id, () => finish());
            else
                finish();
        } else {
            finish();
        }
    };

    const closeTabById = tabId => {
        const tab = tabById(tabId);
        if (!tab)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmClose', '1'),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
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
                send({ type: TAB_GROUP_MSG.tabsClose, tabIds: [tab.id] });
                scheduleRefresh();
            }
        });
    };

    const sleepTabById = tabId => {
        const tab = tabById(tabId);
        if (!tab)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmSleep', '1'),
            button1: `<strong>${_m('tabGroupsSelectSleep')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                send({ type: TAB_GROUP_MSG.tabsDiscard, tabIds: [tab.id] });
                scheduleRefresh();
            }
        });
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
            undo.showToast(_m('tabGroupsGroupSavedToFolder', [`${count}`, folderName]));
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
        saveSession({ rootFolderId: rootFolderId(), folderName, tabs: bookmarkTabs }).then(({ count }) => {
            if (count) {
                onChanged();
                undo.showToast(_m('sessionSaved', `${count}`));
            }
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
        const ids = tabs.filter(t => String(t.groupId) === String(groupId)).map(t => t.id);
        if (!ids.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmClose', `${ids.length}`),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                // A closed group is NOT deleted: keep a local record so the
                // group can be reopened later from the closed-groups section.
                const record = {
                    id: `cg_${Date.now().toString(36)}`,
                    type: 'group',
                    title: group ? group.title || '' : '',
                    color: group ? group.color || 'grey' : 'grey',
                    savedAt: Date.now(),
                    tabs: tabs.filter(t => String(t.groupId) === String(groupId))
                        .sort((a, b) => (a.index || 0) - (b.index || 0))
                        .map(t => ({ title: t.title || '', url: t.url || '' }))
                };
                persistClosedGroups([...readClosedGroups(), record]);
                send({ type: TAB_GROUP_MSG.tabsClose, tabIds: ids });
                scheduleRefresh();
            }
        });
    };

    const sleepGroup = groupId => {
        const ids = tabs.filter(t => String(t.groupId) === String(groupId)).map(t => t.id);
        if (!ids.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmSleep', `${ids.length}`),
            button1: `<strong>${_m('tabGroupsSelectSleep')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                send({ type: TAB_GROUP_MSG.tabsDiscard, tabIds: ids });
                scheduleRefresh();
            }
        });
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
        send({
            type: TAB_GROUP_MSG.openNew,
            urls,
            title: record.title || '',
            color: record.color || 'grey'
        });
        scheduleRefresh();
    };

    const deleteClosedGroup = recordId => {
        persistClosedGroups(closedRecords.filter(r => String(r.id) !== String(recordId)));
        closedRecords = readClosedGroups().sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
        if (views.isActive('tabgroups'))
            render();
    };

    const removeClosedTab = (recordId, idx) => {
        const record = closedRecords.find(r => String(r.id) === String(recordId));
        if (!record)
            return;
        const tabs = (record.tabs || []).slice();
        tabs.splice(idx, 1);
        if (!tabs.length) {
            persistClosedGroups(closedRecords.filter(r => String(r.id) !== String(recordId)));
        } else {
            const updated = { ...record, tabs };
            persistClosedGroups(closedRecords.map(r => String(r.id) === String(recordId) ? updated : r));
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
        persistClosedGroups([]);
        closedRecords = [];
        if (views.isActive('tabgroups'))
            render();
    };

    const closedRecordById = recordId =>
        closedRecords.find(r => String(r.id) === String(recordId)) || null;

    // Open ONE tab of a closed record in a background tab, preferring the
    // window it was closed in (gone → the current window). Shared by the row
    // click and the closed-row context menu.
    const openClosedTab = (recordId, idx) => {
        const record = closedRecordById(recordId);
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

    const closeSelected = () => {
        const ids = selectedTabs().map(t => t.id);
        if (!ids.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmClose', `${ids.length}`),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
                send({ type: TAB_GROUP_MSG.tabsClose, tabIds: ids });
                setSelecting(false);
                scheduleRefresh();
            }
        });
    };

    const sleepSelected = () => {
        const ids = selectedTabs().map(t => t.id);
        if (!ids.length)
            return;
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

    const setGroupCollapsed = (groupId, shouldCollapse) => {
        if (shouldCollapse)
            collapsed.add(String(groupId));
        else
            collapsed.delete(String(groupId));
        persistUIState();
        render();
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
    const setWindowCollapsed = (windowId, shouldCollapse) => {
        const id = String(windowId);
        if (shouldCollapse)
            collapsedWindows.add(id);
        else
            collapsedWindows.delete(id);
        windowChoice.set(id, !!shouldCollapse);
        persistUIState();
        render();
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
    let refreshTimer = null;
    const scheduleRefresh = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
    };

    const bindChromeEvents = () => {
        for (const ev of ['onCreated', 'onRemoved', 'onMoved', 'onUpdated', 'onActivated', 'onAttached', 'onDetached']) {
            if (chrome.tabs && chrome.tabs[ev] && chrome.tabs[ev].addListener)
                chrome.tabs[ev].addListener(scheduleRefresh);
        }
        for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved']) {
            if (chrome.tabGroups && chrome.tabGroups[ev] && chrome.tabGroups[ev].addListener)
                chrome.tabGroups[ev].addListener(scheduleRefresh);
        }
        // Bookmarked state (filled/outline star) follows the bookmark tree.
        for (const ev of ['onCreated', 'onRemoved', 'onChanged']) {
            if (chrome.bookmarks && chrome.bookmarks[ev] && chrome.bookmarks[ev].addListener)
                chrome.bookmarks[ev].addListener(scheduleRefresh);
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
                for (const key of ['tabGroupsColorStyle', 'tabGroupsColorBorder', 'tabGroupsSyncCollapse']) {
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

    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
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
        // same rule the group head follows).
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
        // The pinned glyph is its own un-pin control.
        const unpinBtn = closest('.tabgroups-unpin');
        if (unpinBtn) {
            e.preventDefault();
            e.stopPropagation();
            const li = unpinBtn.closest('li');
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
