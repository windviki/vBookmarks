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

import { VIEW_ICONS, STAR_ICON, SELECT_ICON, FOLDER_ICON } from './icons.js';
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
    const META_KEY = 'tabGroupMeta';

    // --- State ----------------------------------------------------------------
    let tabs = [];          // chrome.tabs.Tab[] of the current window, index order
    let groups = [];        // chrome.tabGroups.TabGroup[] of the current window
    let currentWindowId = null;
    let currentTabId = null;
    let selecting = false;
    const selected = new Set();   // tab ids
    const collapsed = new Set();  // group ids
    let dragTabId = null;

    const groupById = id => groups.find(g => String(g.id) === String(id));
    const tabById = id => tabs.find(t => String(t.id) === String(id));
    // Chrome reports groupId: -1 for tabs that are NOT grouped; every
    // truthiness check must treat -1 as "no group".
    const isGrouped = tab => !!tab && !!tab.groupId && tab.groupId !== -1;

    const readMeta = () => {
        try {
            return JSON.parse(store.get(META_KEY, '') || '{}');
        } catch (e) {
            return {};
        }
    };
    const writeMeta = meta => {
        try {
            store.set(META_KEY, JSON.stringify(meta));
        } catch (e) { /* best-effort metadata */ }
    };
    const firstSeenOf = groupId => {
        const entry = readMeta()[`${groupId}`];
        return entry && entry.firstSeenAt ? entry.firstSeenAt : null;
    };
    const recordFirstSeen = () => {
        const meta = readMeta();
        let changed = false;
        const now = Date.now();
        for (const g of groups) {
            if (!meta[`${g.id}`] || !meta[`${g.id}`].firstSeenAt) {
                meta[`${g.id}`] = { ...(meta[`${g.id}`] || {}), firstSeenAt: now };
                changed = true;
            }
        }
        if (changed)
            writeMeta(meta);
    };

    // --- Data -----------------------------------------------------------------
    const queryGroups = (windowId, cb) => {
        if (chrome.tabGroups && chrome.tabGroups.query)
            chrome.tabGroups.query({ windowId }, cb);
        else
            cb([]);
    };

    const refresh = () => {
        chrome.tabs.query({ currentWindow: true }, tabList => {
            tabs = (tabList || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
            currentWindowId = tabs.length
                ? tabs[0].windowId
                : ((chrome.windows && chrome.windows.WINDOW_ID_CURRENT) || 1);
            currentTabId = tabs.find(t => t.active) ? tabs.find(t => t.active).id : (tabs[0] && tabs[0].id);
            queryGroups(currentWindowId, groupList => {
                groups = groupList || [];
                recordFirstSeen();
                views.updateBadges();
                if (!views.isActive('tabgroups'))
                    return;
                render();
            });
        });
    };

    // --- Rendering --------------------------------------------------------------
    const renderToolbar = () => {
        if (selecting) {
            const sel = selected.size;
            const hasSel = sel > 0;
            const groupedSel = tabs.filter(t => selected.has(String(t.id)) && isGrouped(t)).length;
            return '<div class="tabgroups-toolbar selecting-bar vbm-toolbar">' +
                `<span class="select-count">${_m('selectCount', `${sel}`)}</span>` +
                `<button class="tabgroups-select-all">${_m('selectAll')}</button>` +
                `<button class="tabgroups-select-invert">${_m('selectInvert')}</button>` +
                `<button class="tabgroups-select-clear">${_m('selectClear')}</button>` +
                `<button class="tabgroups-new-group"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectNewGroup')}</button>` +
                `<button class="tabgroups-open-into"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectOpenInto')}</button>` +
                `<button class="tabgroups-add-bookmarks"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectAddBookmarks')}</button>` +
                `<button class="tabgroups-save-folder"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectSaveFolder')}</button>` +
                `<button class="tabgroups-close-selected"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectClose')}</button>` +
                `<button class="tabgroups-sleep-selected"${hasSel ? '' : ' disabled'}>${_m('tabGroupsSelectSleep')}</button>` +
                `<button class="tabgroups-select-exit">${_m('selectModeExit')}</button>` +
                `<span class="tabgroups-copy-move-note"${groupedSel ? '' : ' hidden'}>${_m('tabGroupsCopyMoveDialog')}</span>` +
                '</div>';
        }
        const label = _m('selectModeEnter');
        return '<div class="tabgroups-toolbar tabgroups-controls-toolbar vbm-toolbar">' +
            `<button class="tabgroups-refresh">${_m('tabGroupsToolbarRefresh')}</button>` +
            `<button class="tabgroups-collapse-all">${_m('tabGroupsCollapseAll')}</button>` +
            `<button class="tabgroups-expand-all">${_m('tabGroupsExpandAll')}</button>` +
            `<span class="tabgroups-summary">${_m('tabGroupsSummary', [`${tabs.length}`, `${groups.length}`])}</span>` +
            `<button class="tabgroups-select-mode" title="${htmlspecialchars(label)}" ` +
            `aria-label="${htmlspecialchars(label)}">${SELECT_ICON}</button>` +
            '</div>';
    };

    const groupHeadHtml = (group, memberTabs) => {
        const gid = String(group.id);
        const isCollapsed = collapsed.has(gid);
        const title = group.title || _m('tabGroupUntitled');
        const color = group.color || 'grey';
        const firstSeen = firstSeenOf(group.id);
        const created = firstSeen ? new Date(firstSeen).toLocaleString() : _m('tabGroupsGroupCreatedUnknown');
        const saveLabel = _m('tabGroupsSaveFolder');
        return `<li class="tabgroups-group${selecting && memberTabs.every(t => selected.has(String(t.id))) ? ' sel' : ''}" data-group-id="${gid}">` +
            `<span class="tabgroups-group-head" tabindex="-1" role="button" aria-expanded="${isCollapsed ? 'false' : 'true'}">` +
            `<span class="chevron${isCollapsed ? ' collapsed' : ''}"></span>` +
            `<span class="tab-group-dot tg-${htmlspecialchars(color)}"></span>` +
            `<span class="tabgroups-group-title" dir="auto">${htmlspecialchars(title)}</span>` +
            `<span class="tabgroups-group-meta">${htmlspecialchars(created)}</span>` +
            `<span class="count-pill" aria-label="${htmlspecialchars(_m('tabGroupsGroupCount', `${memberTabs.length}`))}">${memberTabs.length}</span>` +
            `<button class="row-btn tabgroups-group-save" aria-label="${htmlspecialchars(saveLabel)}" title="${htmlspecialchars(saveLabel)}">${FOLDER_ICON}</button>` +
            '</span></li>';
    };

    const tabRowHtml = tab => {
        const tid = String(tab.id);
        const isCurrent = String(tab.id) === String(currentTabId);
        const inGroup = isGrouped(tab);
        const addLabel = _m('tabGroupsAddBookmark');
        const currentLabel = _m('tabGroupsCurrentTab');
        const extras = `data-tab-id="${tid}" data-url="${htmlspecialchars(tab.url || '')}"`;
        const badge = isCurrent ? [{ text: currentLabel, cls: 'current' }] : [];
        const rowClass = `vbm-row tabgroups-row${isCurrent ? ' tabgroups-current' : ''}${inGroup ? ' grouped' : ''}`;
        return `<li class="${rowClass}" id="tabgroups-item-${tid}" role="listitem" data-tab-id="${tid}"${inGroup ? ` data-group-id="${String(tab.groupId)}"` : ''}>` +
            treeRender.generateBookmarkHTML(tab.title || tab.url || _m('noTitle'), tab.url || '', extras, null, null, { badge }) +
            `<button class="row-btn tabgroups-add-bookmark" aria-label="${htmlspecialchars(addLabel)}" title="${htmlspecialchars(addLabel)}">${STAR_ICON}</button>` +
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
            html += `<ul role="list"${selecting ? ' class="selecting"' : ''}>`;
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
                undo.showToast(_m('quickAddedTo', existing[0].title || ''));
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
            if (count)
                undo.showToast(_m('sessionSaved', `${count}`));
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

    const toggleGroupCollapsed = groupId => {
        if (collapsed.has(groupId))
            collapsed.delete(groupId);
        else
            collapsed.add(groupId);
        render();
    };

    const collapseAll = () => {
        for (const g of groups)
            collapsed.add(String(g.id));
        render();
    };
    const expandAll = () => {
        collapsed.clear();
        render();
    };

    // --- Events ------------------------------------------------------------------
    let refreshTimer = null;
    const scheduleRefresh = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
    };

    const bindChromeEvents = () => {
        for (const ev of ['onCreated', 'onRemoved', 'onMoved', 'onUpdated', 'onActivated']) {
            if (chrome.tabs && chrome.tabs[ev] && chrome.tabs[ev].addListener)
                chrome.tabs[ev].addListener(scheduleRefresh);
        }
        for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onMoved']) {
            if (chrome.tabGroups && chrome.tabGroups[ev] && chrome.tabGroups[ev].addListener)
                chrome.tabGroups[ev].addListener(scheduleRefresh);
        }
    };
    bindChromeEvents();

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
            const isRtl = !!(document.body && document.body.classList && document.body.classList.contains('rtl'));
            const expand = (k === ' ' || k === 'Enter' || k === (isRtl ? 'ArrowLeft' : 'ArrowRight')) && isCollapsed;
            const collapse = (k === ' ' || k === 'Enter' || k === (isRtl ? 'ArrowRight' : 'ArrowLeft')) && !isCollapsed;
            if (expand || collapse) {
                e.preventDefault();
                e.stopPropagation();
                if (expand)
                    collapsed.delete(gid);
                else
                    collapsed.add(gid);
                render();
            }
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

    // Right-clicks on tab rows must never open the bookmark context menu
    // (the row is not a bookmark). Suppress the row menu; the tab context
    // menu can be added later without touching the body-level logic.
    $list.addEventListener('contextmenu', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        if (closest('li.tabgroups-row, li.tabgroups-group')) {
            e.preventDefault();
            e.stopPropagation();
        }
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
        isSelecting: () => selecting
    };
}
