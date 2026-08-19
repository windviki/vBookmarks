/**
 * Tab groups view (docs/tab-groups-view-design.md) — browser tabs + tab groups
 * + bookmarks, living between the search and recent views.
 *
 * Renders the current window's tabs in tab-strip order. Tabs that belong to
 * a Chrome tab group render under a group header (title, color dot, count,
 * first-seen creation time, save-as-bookmark-folder action); ungrouped tabs
 * render as plain rows in the same order. The view offers a dupes-style
 * selection mode for batch tab management: new tab group / open into an
 * existing group (with a copy-vs-move choice for tabs that already belong to
 * a group), close, sleep, and save the selection as a bookmark folder.
 * Each row has a hover bookmark button (the stats-view recipe).
 *
 * All tab batch operations are sent to the service worker
 * (src/tab-groups-sw.js) so the popup can close mid-operation without
 * dropping callbacks.
 */

import { VIEW_ICONS, STAR_ICON, STAR_ICON_FILLED, SELECT_ICON, FOLDER_ICON, EDIT_ICON, SLEEP_ICON, ACTIVATE_ICON, TRASH_ICON, REDO_ICON, COLLAPSE_ALL_ICON, EXPAND_ALL_ICON } from './icons.js';
import { htmlspecialchars } from './escape.js';
import { parkRowFocus, unparkRowFocus, parkToolbarFocus, restoreToolbarFocus } from './list-focus.js';
import { saveSession, sessionFolderName, tabsToBookmarks } from './session.js';
import { pickGroupColor, saveTabGroupFolderMeta } from './tab-group-utils.js';
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

    const $list = $('tabgroups-list');

    const rootFolderId = () => store.get('quickAddFolderId', '1') || '1';
    // Collapse/expand sync (toolbar option, default OFF): when off, folding
    // groups in the view is local-only and never updates chrome.tabGroups.
    const syncCollapse = () => !!store.get('tabGroupsSyncCollapse', '');
    // Enhanced group-color edge (toolbar option, default OFF): when on, each
    // group's header and member rows get a 3px left edge in the group color.
    const colorBorder = () => !!store.get('tabGroupsColorBorder', '');

    // --- State ----------------------------------------------------------------
    let refreshToken = 0;   // monotonic refresh generation: stale async
                            // tabs/tabGroups callbacks must never overwrite
                            // a newer refresh
    let tabs = [];          // chrome.tabs.Tab[] of the current window, index order
    let groups = [];        // chrome.tabGroups.TabGroup[] of the current window
    let currentWindowId = null;
    let currentTabId = null;
    let selecting = false;
    const selected = new Set();   // tab ids
    const collapsed = new Set();  // group ids
    let bookmarkedUrls = new Set(); // tab URLs that already exist as bookmarks
    let dragTabId = null;

    const groupById = id => groups.find(g => String(g.id) === String(id));
    const tabById = id => tabs.find(t => String(t.id) === String(id));
    // Chrome reports groupId: -1 for tabs that are NOT grouped; every
    // truthiness check must treat -1 as "no group".
    const isGrouped = tab => !!tab && !!tab.groupId && tab.groupId !== -1;

    // Walk the bookmark tree once per refresh and remember which URLs are
    // already bookmarked. Row state (filled/outline star) reads this set.
    const collectBookmarkedUrls = tree => {
        const urls = new Set();
        const walk = nodes => {
            for (let i = 0, l = (nodes || []).length; i < l; i++) {
                const node = nodes[i];
                if (node.children)
                    walk(node.children);
                else if (node.url)
                    urls.add(node.url);
            }
        };
        walk(tree || []);
        return urls;
    };

    // --- Data -----------------------------------------------------------------
    const queryGroups = (windowId, cb) => {
        if (chrome.tabGroups && chrome.tabGroups.query)
            chrome.tabGroups.query({ windowId }, cb);
        else
            cb([]);
    };

    const refresh = () => {
        const token = ++refreshToken;
        chrome.tabs.query({ currentWindow: true }, tabList => {
            if (token !== refreshToken)
                return; // a newer refresh started — drop this stale read
            tabs = (tabList || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
            currentWindowId = tabs.length
                ? tabs[0].windowId
                : ((chrome.windows && chrome.windows.WINDOW_ID_CURRENT) || 1);
            const activeTab = tabs.find(t => t.active);
            currentTabId = activeTab ? activeTab.id : (tabs[0] && tabs[0].id);
            queryGroups(currentWindowId, groupList => {
                if (token !== refreshToken)
                    return;
                groups = groupList || [];
                // Keep the list folding in sync with the browser's own
                // collapsed state (chrome.tabGroups.TabGroup.collapsed).
                collapsed.clear();
                for (const g of groups)
                    if (g.collapsed)
                        collapsed.add(String(g.id));
                views.updateBadges();
                if (!views.isActive('tabgroups'))
                    return;
                chrome.bookmarks.getTree(tree => {
                    if (token !== refreshToken)
                        return;
                    bookmarkedUrls = collectBookmarkedUrls(tree);
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
        return `<li class="tabgroups-group tg-${htmlspecialchars(color)}${selecting && memberTabs.every(t => selected.has(String(t.id))) ? ' sel' : ''}" id="tabgroups-group-${gid}" data-group-id="${gid}">` +
            `<span class="tabgroups-group-head" tabindex="-1" role="button" aria-expanded="${isCollapsed ? 'false' : 'true'}" title="${htmlspecialchars(title)}">` +
            `<span class="chevron${isCollapsed ? ' collapsed' : ''}"></span>` +
            `<span class="tab-group-dot tg-${htmlspecialchars(color)}"></span>` +
            `<span class="tabgroups-group-title" dir="auto">${htmlspecialchars(title)}</span>` +
            `<span class="count-pill" aria-label="${htmlspecialchars(_m('tabGroupsGroupCount', `${memberTabs.length}`))}">${memberTabs.length}</span>` +
            `<button class="row-btn tabgroups-group-activate" aria-label="${htmlspecialchars(_m('tabGroupsActivateGroup'))}" title="${htmlspecialchars(_m('tabGroupsActivateGroup'))}">${ACTIVATE_ICON}</button>` +
            `<button class="row-btn tabgroups-group-rename" aria-label="${htmlspecialchars(_m('tabGroupsRenameGroup'))}" title="${htmlspecialchars(_m('tabGroupsRenameGroup'))}">${EDIT_ICON}</button>` +
            `<button class="row-btn tabgroups-group-save" aria-label="${htmlspecialchars(saveLabel)}" title="${htmlspecialchars(saveLabel)}">${FOLDER_ICON}</button>` +
            `<button class="row-btn tabgroups-group-sleep" aria-label="${htmlspecialchars(_m('tabGroupsSleepGroup'))}" title="${htmlspecialchars(_m('tabGroupsSleepGroup'))}">${SLEEP_ICON}</button>` +
            `<button class="row-btn tabgroups-group-close" aria-label="${htmlspecialchars(_m('tabGroupsCloseGroup'))}" title="${htmlspecialchars(_m('tabGroupsCloseGroup'))}">${TRASH_ICON}</button>` +
            '</span></li>';
    };

    const tabRowHtml = tab => {
        const tid = String(tab.id);
        const isCurrent = String(tab.id) === String(currentTabId);
        const inGroup = isGrouped(tab);
        const isSelected = selected.has(tid);
        const bookmarked = bookmarkedUrls.has(tab.url || '');
        const addLabel = _m('tabGroupsAddBookmark');
        const bookmarkedLabel = _m('tabGroupsBookmarked');
        const currentLabel = _m('tabGroupsCurrentTab');
        const extras = `data-tab-id="${tid}" data-url="${htmlspecialchars(tab.url || '')}"`;
        const badge = isCurrent ? [{ text: currentLabel, cls: 'current' }] : [];
        const groupColor = inGroup ? ((groupById(tab.groupId) || {}).color || 'grey') : '';
        const rowClass = `vbm-row tabgroups-row${isCurrent ? ' tabgroups-current' : ''}${inGroup ? ` grouped tg-${groupColor}` : ''}${isSelected ? ' sel' : ''}`;
        // Bookmark state follows the stats-view recipe: already-bookmarked
        // tabs show a filled, always-visible star; unbookmarked tabs get the
        // hover-revealed outline star button.
        const starHtml = bookmarked
            ? `<span class="tabgroups-star" aria-label="${htmlspecialchars(bookmarkedLabel)}" title="${htmlspecialchars(bookmarkedLabel)}">${STAR_ICON_FILLED}</span>`
            : `<button class="row-btn tabgroups-add-bookmark tabgroups-add-btn" aria-label="${htmlspecialchars(addLabel)}" title="${htmlspecialchars(addLabel)}">${STAR_ICON}</button>`;
        return `<li class="${rowClass}" id="tabgroups-item-${tid}" role="listitem" data-tab-id="${tid}"${inGroup ? ` data-group-id="${String(tab.groupId)}"` : ''}>` +
            treeRender.generateBookmarkHTML(tab.title || tab.url || _m('noTitle'), tab.url || '', extras, null, null, { badge }) +
            starHtml +
            '</li>';
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
            const ulClass = [selecting ? 'selecting' : '', colorBorder() ? 'color-enhanced' : ''].filter(Boolean).join(' ');
            html += `<ul role="list"${ulClass ? ` class="${ulClass}"` : ''}>`;
            const seenGroups = new Set();
            for (let i = 0, l = tabs.length; i < l; i++) {
                const tab = tabs[i];
                if (isGrouped(tab)) {
                    const group = groupById(tab.groupId);
                    if (!group) {
                        html += tabRowHtml(tab);
                        continue;
                    }
                    const gid = String(group.id);
                    if (seenGroups.has(gid))
                        continue;
                    seenGroups.add(gid);
                    const memberTabs = tabs.filter(t => String(t.groupId) === gid)
                        .sort((a, b) => (a.index || 0) - (b.index || 0));
                    html += groupHeadHtml(group, memberTabs);
                    if (!collapsed.has(gid)) {
                        for (const mt of memberTabs)
                            html += tabRowHtml(mt);
                    }
                } else {
                    html += tabRowHtml(tab);
                }
            }
            html += '</ul>';
        }
        const parkedToolbar = parkToolbarFocus($list);
        const parkedRow = parkRowFocus($list);
        $list.innerHTML = html;
        restoreToolbarFocus($list, parkedToolbar);
        unparkRowFocus($list, parkedRow);
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
                bookmarkedUrls.add(tab.url);
                undo.showToast(_m('quickAdded'));
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

    const closeTabById = tabId => {
        const tab = tabById(tabId);
        if (!tab)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmClose', '1'),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
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
        if (member && chrome.tabs.update)
            chrome.tabs.update(member.id, { active: true });
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
        const ids = tabs.filter(t => String(t.groupId) === String(groupId)).map(t => t.id);
        if (!ids.length)
            return;
        dialogs.ConfirmDialog.open({
            dialog: _m('tabGroupsConfirmClose', `${ids.length}`),
            button1: `<strong>${_m('delete')}</strong>`,
            button2: _m('nope'),
            fn1: () => {
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

    // --- Selection mode + tab batch actions ---------------------------------------
    const setSelecting = on => {
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

    const send = msg => {
        if (chrome.runtime && chrome.runtime.sendMessage)
            chrome.runtime.sendMessage(msg);
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
                send({
                    type: TAB_GROUP_MSG.tabsNewGroup,
                    moveIds,
                    copyTabs,
                    title,
                    color,
                    windowId: currentWindowId
                });
                setSelecting(false);
                scheduleRefresh();
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
                    send({ type: TAB_GROUP_MSG.tabsOpenInto, moveIds, copyTabs, groupId });
                    setSelecting(false);
                    scheduleRefresh();
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
            }
        });
    };

    const setGroupCollapsed = (groupId, shouldCollapse) => {
        if (shouldCollapse)
            collapsed.add(String(groupId));
        else
            collapsed.delete(String(groupId));
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

    const collapseAll = () => {
        for (const g of groups)
            collapsed.add(String(g.id));
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
        if (chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local' || !changes)
                    return;
                let touched = false;
                for (const key of ['tabGroupsColorBorder', 'tabGroupsSyncCollapse']) {
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
                    const gid = rowLi.dataset.groupId;
                    const memberIds = tabs.filter(t => String(t.groupId) === gid).map(t => String(t.id));
                    const allSel = memberIds.every(id => selected.has(id));
                    for (const id of memberIds) {
                        if (allSel)
                            selected.delete(id);
                        else
                            selected.add(id);
                    }
                    render();
                    return;
                }
            }
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
                sleepGroup(li.dataset.groupId);
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
            const tab = tabById(anchor.dataset.tabId);
            if (tab)
                chrome.tabs.update(tab.id, { active: true });
            return;
        }
    });

    $list.addEventListener('auxclick', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        const anchor = closest('a');
        if (anchor && anchor.dataset && anchor.dataset.tabId) {
            e.preventDefault();
            const tab = tabById(anchor.dataset.tabId);
            if (tab)
                chrome.tabs.update(tab.id, { active: true });
        }
    });

    // Group-header keys, capture phase (the dupes recipe): Space/Enter/←/→
    // collapse/expand; in selection mode Space toggles the group.
    $list.addEventListener('keydown', e => {
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
                const memberIds = tabs.filter(t => String(t.groupId) === gid).map(t => String(t.id));
                const allSel = memberIds.every(id => selected.has(id));
                for (const id of memberIds) {
                    if (allSel)
                        selected.delete(id);
                    else
                        selected.add(id);
                }
                render();
                return;
            }
            if (k === 'F2') {
                e.preventDefault();
                e.stopImmediatePropagation();
                renameGroup(gid);
                return;
            }
            const isRtl = !!(document.body && document.body.classList && document.body.classList.contains('rtl'));
            const expand = (k === ' ' || k === 'Enter' || k === (isRtl ? 'ArrowLeft' : 'ArrowRight')) && isCollapsed;
            const collapse = (k === ' ' || k === 'Enter' || k === (isRtl ? 'ArrowRight' : 'ArrowLeft')) && !isCollapsed;
            if (expand || collapse) {
                e.preventDefault();
                e.stopPropagation();
                // Sync the folded state to the browser group too (same
                // path as the click handler — the keyboard must not be a
                // local-only shortcut).
                setGroupCollapsed(gid, collapse);
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
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        let rowLi = closest('li.tabgroups-row');
        if (!rowLi && e.target === $list && $list.querySelector) {
            const marked = $list.querySelector('.focus');
            rowLi = marked && marked.closest ? marked.closest('li.tabgroups-row') : null;
        }
        if (!rowLi)
            return;
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
            if (chrome.tabs.move)
                chrome.tabs.move(Number(dragTabId), { windowId: currentWindowId, index: targetTab ? targetTab.index : -1 });
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
            // Always revalidate on entry: tabs change behind the popup.
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
        activateTab: tabId => {
            const tab = tabById(tabId);
            if (tab && chrome.tabs.update)
                chrome.tabs.update(tab.id, { active: true });
        },
        addBookmark: addTabToBookmarks,
        closeTab: closeTabById,
        sleepTab: sleepTabById,
        activateGroup,
        renameGroup,
        saveGroupToBookmarks,
        closeGroup,
        sleepGroup,
        toggleGroup: toggleGroupCollapsed,
        isCollapsed: gid => collapsed.has(String(gid))
    };
}
