/**
 * Options-page storage-area badges: a cloud / cloud-with-slash icon telling
 * the user WHERE each setting group persists — chrome.storage.sync (the
 * device-independent preferences routed by store.js SYNC_KEYS) or
 * chrome.storage.local (device-local data: screen state, proxy/scan tuning,
 * bookmark-id-keyed or oversized values).
 *
 * Placement keeps the page quiet: a group whose settings are all in one area
 * carries a single badge on its header (right end of the <h2> line); a MIXED
 * group carries the majority kind on the header and only its differing rows
 * get their own badge. A tie settles on sync (most preference keys are sync).
 * The native title tooltip explains the area — two strings total, one per
 * kind (optionsStorageSyncTip / optionsStorageLocalTip).
 *
 * ES module loaded after /src/store.js (a classic script), so window.store
 * and its static syncKeys list are available. It only READS key names —
 * nothing here depends on store.ready. Badges are appended to the <section>
 * / <li> (never inside the <h2>, whose innerText options.js owns), so load
 * order relative to the label pass is irrelevant.
 */

export const STORAGE_SYNC = 'sync';
export const STORAGE_LOCAL = 'local';

// options-page group heading id → the settings that group edits. `row` is
// the id of a control inside the row's <li> — the outlier badge anchors on
// that li. Rowless entries are group-level keys with no dedicated row (the
// Views group's disable*View toggles, customIcon, paletteCustomCommands);
// they count toward the group tally but can never carry a row badge, so a
// rowless entry that lands in the minority of its group would be unmarked —
// every current rowless key is sync in a sync-dominant group, and the
// consistency test below pins that.
export const OPTIONS_STORAGE_GROUPS = {
    general: [
        { row: 'click-new-tab', key: 'leftClickNewTab' },
        { row: 'open-new-tab-bg', key: 'middleClickBgTab' },
        { row: 'close-unused-folders', key: 'closeUnusedFolders' },
        { row: 'popup-stay-open', key: 'bookmarkClickStayOpen' },
        { row: 'confirm-open-folder', key: 'dontConfirmOpenFolder' },
        { row: 'confirm-delete-folder', key: 'confirmDeleteFolder' },
        { row: 'remember-prev-state', key: 'dontRememberState' },
        { row: 'auto-resize-popup', key: 'autoResizePopup' },
        { row: 'open-in-side-panel', key: 'openInSidePanel' },
        { row: 'theme-select', key: 'theme' },
        { row: 'language-select', key: 'uiLanguage' },
        { row: 'announce-enabled', key: 'announceEnabled' }
    ],
    'views-options': [
        { row: 'show-view-tabs', key: 'showViewTabs' },
        { row: 'remember-view', key: 'rememberView' },
        { row: 'show-tab-badges', key: 'showTabBadges' },
        { row: 'show-item-path', key: 'showItemPath' },
        { row: 'show-tab-groups-view', key: 'showTabGroupsView' },
        { row: 'show-recent-bookmarks', key: 'showRecentBookmarks' },
        { row: 'show-stats-view', key: 'showStatsView' },
        { row: 'show-dead-view', key: 'showDeadView' },
        { row: 'show-dupes-view', key: 'showDupesView' },
        // the per-view Enabled/Disabled toggles write the disable*View keys
        { key: 'disableRecentView' },
        { key: 'disableTabGroupsView' },
        { key: 'disableStatsView' },
        { key: 'disableDeadView' },
        { key: 'disableDupesView' }
    ],
    'tree-options': [
        { row: 'only-show-bmbar', key: 'onlyShowBMBar' },
        { row: 'tree-row-actions', key: 'treeRowActions' }
    ],
    'search-options': [
        { row: 'search-after-enter', key: 'searchAfterEnter' }
    ],
    'tabgroups-options': [
        { row: 'tabgroups-color-style', key: 'tabGroupsColorStyle' },
        { row: 'tabgroups-closed-limit', key: 'tabGroupsClosedLimit' }
    ],
    'recent-options': [
        { row: 'staging-enabled', key: 'stagingEnabled' },
        { row: 'recent-count', key: 'recentCount' }
    ],
    'stats-options': [
        { row: 'stats-enabled', key: 'statsEnabled' },
        { row: 'search-history-enabled', key: 'searchHistoryEnabled' }
    ],
    'dead-scan-options': [
        { row: 'dead-proxy-server-input', key: 'deadProxyServer' },
        { row: 'dead-proxy-strip-visible', key: 'hideDeadProxyStrip' },
        { row: 'dead-scan-concurrency', key: 'deadScanConcurrency' },
        { row: 'dead-scan-timeout', key: 'deadScanTimeout' }
    ],
    'icons-options': [
        { row: 'favicon-contrast', key: 'faviconContrast' },
        { row: 'favicon-enrich', key: 'faviconEnrich' },
        { row: 'favicon-enrich-ddg', key: 'faviconEnrichAgg' },
        { row: 'favicon-backup', key: 'faviconBackupInclude' }
    ],
    'context-menu-options': [
        { row: 'quick-add-context-menu', key: 'quickAddContextMenu' },
        { row: 'collapse-tab-group-menu', key: 'collapseTabGroupMenu' },
        { row: 'collapse-sort-menu', key: 'collapseSortMenu' },
        { row: 'collapse-add-folder-menu', key: 'collapseAddFolderMenu' }
    ],
    'tools-options': [
        { row: 'palette-enabled', key: 'paletteEnabled' },
        { row: 'quick-add-enabled', key: 'quickAddEnabled' },
        { row: 'show-tool-button', key: 'showToolButton' }
    ],
    'palette-cmd-options': [
        { key: 'paletteCustomCommands' }
    ],
    'sync-options': [
        { row: 'show-sync-status', key: 'showSyncStatus' },
        { row: 'highlight-unsynced', key: 'highlightUnsynced' },
        { row: 'auto-refresh-sync', key: 'autoRefreshSync' },
        { row: 'sync-refresh-interval', key: 'syncRefreshInterval' }
    ],
    accessibility: [
        { row: 'zoom-input', key: 'zoom' }
    ],
    'custom-icon': [
        { key: 'customIcon' }
    ],
    'separator-options': [
        { row: 'custom-separator-color', key: 'separatorcolor' },
        { row: 'custom-separator-title', key: 'separatorTitle' },
        { row: 'custom-separator-url', key: 'separatorURL' },
        { row: 'custom-separator-string', key: 'separatorString' }
    ],
    'sort-options': [
        { row: 'sort-options-title', key: 'sortOptions' }
    ],
    'custom-styles': [
        { row: 'userstyle', key: 'userstyle' }
    ],
    'labs-options': [
        { row: 'virtual-scroll-lab', key: 'virtualScrollLab' }
    ]
    // deliberately unmapped (no badge): backup-options (buttons only, no
    // settings) and dupes-options (hidden placeholder group)
};

// Dataset rows — explicit badges for rows that manage DATA, not a setting:
// the favicon cache (vbmFavicon:* + vbmFaviconIdx) lives in
// chrome.storage.local by design, while the Icons group's SETTINGS are all
// sync — so the gallery link states its dataset's locality itself. Anchored
// and placed exactly like an outlier row, but with the inline variant class
// (it rides the row's flex flow right after the link instead of docking
// absolutely at the card edge).
export const DATA_ROW_BADGES = {
    'favicon-gallery-link': STORAGE_LOCAL
};

export const storageKindOf = (key, syncKeySet) =>
    syncKeySet.has(key) ? STORAGE_SYNC : STORAGE_LOCAL;

// Majority kind of a group + the rows that differ from it. `outliers` only
// lists entries WITH a row (see the map comment for the rowless caveat).
export const classifyGroup = (entries, syncKeySet) => {
    let syncCount = 0;
    for (const entry of entries) {
        if (storageKindOf(entry.key, syncKeySet) === STORAGE_SYNC)
            syncCount++;
    }
    const dominant = syncCount * 2 >= entries.length ? STORAGE_SYNC : STORAGE_LOCAL;
    const outliers = entries
        .filter(entry => entry.row && storageKindOf(entry.key, syncKeySet) !== dominant)
        .map(entry => ({ row: entry.row, key: entry.key, kind: storageKindOf(entry.key, syncKeySet) }));
    return { dominant, outliers };
};

export const classifyGroups = (groups, syncKeySet) => {
    const plan = {};
    for (const headingId in groups)
        plan[headingId] = classifyGroup(groups[headingId], syncKeySet);
    return plan;
};

// Stroke-drawn cloud (the classic outline); the local variant crosses it
// with a diagonal slash. currentColor + the theme tokens keep it legible on
// all five themes.
const cloudSvg = slashed =>
    '<svg viewBox="0 0 24 24" aria-hidden="true">'
    + '<path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>'
    + (slashed ? '<path d="M4 4l16 16"/>' : '')
    + '</svg>';

const makeBadge = (doc, kind, extraClass, tipSync, tipLocal) => {
    const span = doc.createElement('span');
    span.className = `storage-badge ${extraClass} storage-${kind}`;
    span.title = kind === STORAGE_SYNC ? tipSync : tipLocal;
    span.innerHTML = cloudSvg(kind === STORAGE_LOCAL);
    return span;
};

// Decorate the page: one badge per group header (the majority kind), plus a
// row badge on each outlier row, plus the explicit dataset-row badges.
// Unknown headings/rows are skipped quietly — the module rides on ids
// options.html owns.
export const applyStorageBadges = ({
    groups = OPTIONS_STORAGE_GROUPS,
    dataRows = DATA_ROW_BADGES,
    syncKeySet,
    tipSync,
    tipLocal,
    doc = document
} = {}) => {
    const plan = classifyGroups(groups, syncKeySet);
    for (const headingId in plan) {
        const { dominant, outliers } = plan[headingId];
        const heading = doc.getElementById(headingId);
        if (!heading || typeof heading.closest !== 'function')
            continue;
        const section = heading.closest('section');
        if (section)
            section.appendChild(makeBadge(doc, dominant, 'group-storage-badge', tipSync, tipLocal));
        for (const outlier of outliers) {
            const control = doc.getElementById(outlier.row);
            const li = control && typeof control.closest === 'function' ? control.closest('li') : null;
            if (li)
                li.appendChild(makeBadge(doc, outlier.kind, 'row-storage-badge', tipSync, tipLocal));
        }
    }
    for (const rowId in dataRows) {
        const control = doc.getElementById(rowId);
        const li = control && typeof control.closest === 'function' ? control.closest('li') : null;
        if (li)
            li.appendChild(makeBadge(doc, dataRows[rowId], 'storage-badge-inline', tipSync, tipLocal));
    }
};

const init = () => {
    // Node/test imports land here: no DOM, nothing to decorate. On the real
    // page the guard is the General group's heading.
    if (typeof document === 'undefined' || !document.getElementById('general'))
        return;
    const syncKeys = (typeof store !== 'undefined' && store.syncKeys) || [];
    const _m = typeof chrome !== 'undefined' ? chrome.i18n.getMessage : null;
    applyStorageBadges({
        syncKeySet: new Set(syncKeys),
        tipSync: _m ? _m('optionsStorageSyncTip') : '',
        tipLocal: _m ? _m('optionsStorageLocalTip') : ''
    });
};

init();
