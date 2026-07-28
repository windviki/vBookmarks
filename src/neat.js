import { SeparatorManager } from './separators.js';
import { initDialogs } from './dialogs.js';
import { initSearch } from './search.js';
import { initActions } from './actions.js';
import { initContextMenu } from './context-menu.js';
import { initKeyboard } from './keyboard.js';
import { initDnd } from './dnd.js';
import { initTreeRender } from './tree-render.js';
import { initTreeView } from './tree-view.js';
import { initSyncUi } from './sync-ui.js';
import { initPalette } from './palette.js';
import { initUndo } from './undo.js';
import { initViewManager } from './view-manager.js';
import { initViewRecent } from './view-recent.js';
import { initViewDupes } from './view-dupes.js';
import { initViewDead } from './view-dead.js';
import { initVisitStats } from './visit-stats.js';
import { initViewStats } from './view-stats.js';
import { markPopupOpen } from './visit-stats-sw.js';

(window => {
    const store = window.store;
    // Phase 2b: the popup page doubles as the side panel page (sidepanel.html,
    // or the ?panel=1 query form). popup.js tags body with the panel-mode
    // class; here we only need the flag.
    const IS_PANEL = window.location.search.includes('panel=1')
        || window.document.body.classList.contains('panel-mode');

    // Prevent Chrome's native context menu from the very first pixel — the
    // store.ready gated initContextMenu below registers the full handler with
    // custom menus, but there is a gap between DOM parse and store.ready
    // resolution during which right-clicks would either show Chrome's native
    // menu or (worse) do nothing visible. This early no-op preventDefault
    // closes that gap; once initContextMenu attaches its own body
    // contextmenu listener both coexist — ours always wins.
    window.document.body.addEventListener('contextmenu', e => e.preventDefault());

    // Storage mirror must be ready (chrome.storage.local loaded + migrated)
    // before any of the settings below are read
    store.ready.then(() => {
    const document = window.document;
    const chrome = window.chrome;
    const navigator = window.navigator;
    const body = document.body;
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;

    // StringList / SeparatorManager 已剥离至 src/separators.js（P1，ES module 见顶部 import）
    const separatorManager = new SeparatorManager(store);

    // copyToClipboard / TreeText 已剥离至 src/actions.js（P1）

    // Platform detection
    const os = (navigator.platform.toLowerCase().match(/mac|win|linux/i) || ['other'])[0];
    body.classList.add(os);

    // Chrome version detection
    const version = (() => {
        const v = {};
        const keys = ['major', 'minor', 'build', 'patch'];
        const matches = navigator.userAgent.match(/chrome\/([\d]+)\.([\d]+)\.([\d]+)\.([\d]+)/i);
        if (!matches)
            return null;
        matches.slice(1).forEach((m, i) => {
            v[keys[i]] = parseInt(m, 10);
        });
        return v;
    })();

    // Some i18n
    $('search-input').placeholder = _m('searchBookmarks');
    $('edit-dialog-name').placeholder = _m('name');
    $('edit-dialog-url').placeholder = _m('url');
    $('new-folder-dialog-name').placeholder = _m('name');
    $('quick-add-btn').title = _m('quickAddBookmark');
    Object.entries({
        'reveal-in-tree': 'recentRevealInTree',
        'dead-mark-toggle': 'deadMark',
        'dupes-set-keeper': 'dupesKeeperSet',
        'bookmark-new-tab': 'openNewTab',
        'bookmark-new-window': 'openNewWindow',
        'bookmark-new-incognito-window': 'openIncognitoWindow',
        'bookmark-edit': 'edit',
        'bookmark-delete': 'delete',
        'add-bookmark-top': 'addBookmarkTop',
        'add-bookmark-bottom': 'addBookmarkBottom',
        'add-bookmark-before-bookmark': 'addBookmarkBefore',
        'add-bookmark-after-bookmark': 'addBookmarkAfter',
        'add-folder-before-bookmark': 'addNewFolderBefore',
        'add-folder-after-bookmark': 'addNewFolderAfter',
        'add-bookmark-before-folder': 'addBookmarkBefore',
        'add-bookmark-after-folder': 'addBookmarkAfter',
        'add-folder-before-folder': 'addNewFolderBefore',
        'add-folder-after-folder': 'addNewFolderAfter',
        'add-new-folder': 'addNewFolder',
        'add-separator': 'addSeparator',
        'remove-separator': 'removeSeparator',
        'add-folder-separator': 'addSeparator',
        'copy-title-and-url': 'copyTitleAndUrl',
        // 'copy-all-titles-and-urls' : 'copyAllTitlesAndUrls',
        'replace-url': 'replaceUrl',
        'folder-window': 'openBookmarks',
        'open-bookmarks-in-group': 'openBookmarksInGroup',
        'folder-new-window': 'openBookmarksNewWindow',
        'folder-new-incognito-window': 'openBookmarksIncognitoWindow',
        'folder-edit': 'edit',
        'folder-delete': 'deleteEllipsis',
        'sort-folder-contents': 'sortFolderContents',
        'sort-dialog-text': 'sortFolderContents',
        'sort-by-title-label': 'sortByTitle',
        'sort-by-date-label': 'sortByDateAdded',
        'sort-folders-first-label': 'sortFoldersFirst',
        'sort-recursive-label': 'sortRecursive',
        'sort-recursive-warning': 'sortRecursiveWarning',
        'edit-dialog-button': 'save',
        'edit-dialog-cancel-button': 'nope',
        'new-folder-dialog-button': 'save',
        'new-folder-dialog-cancel-button': 'nope',
        'sort-dialog-ok-button': 'save',
        'sort-dialog-cancel-button': 'nope'
    }).forEach(([id, msg]) => {
        const el = $(id);
        const m = _m(msg);
        el.textContent = m;
    });

    // RTL indicator
    const rtl = (getComputedStyle(body).getPropertyValue('direction') === 'rtl');
    if (rtl)
        body.classList.add('rtl');

    // highlightUnsynced setting (dead toggle revived): dim local-only
    // subtrees via the unsynced-subtree rows tree-render marks. Default on.
    body.classList.toggle('highlight-unsynced',
        store.getSyncSetting('highlightUnsynced', 'true') === 'true');

    // Init some variables
    let opens = store.get('opens') ? JSON.parse(store.get('opens')) : [];
    let rememberState = !store.get('dontRememberState');
    const httpsPattern = /^https?:\/\//i;
    // onlyShowBMBar 与 adaptBookmarkTooltips 已剥离至 src/tree-view.js（P1，8b）

    // addSeparator / deleteSeparator 已剥离至 src/actions.js（P1，经 actions 表调用）

    separatorManager.clear();
    const $tree = $('tree');

    // 树 HTML 生成与树数据辅助已剥离至 src/tree-render.js（P1，ES module 见
    // 顶部 import）。opens/rememberState 状态留在 neat.js：treeRender 经
    // getter 读取，treeView 经下方注入的 get/set 回调共享同一份状态。
    const treeRender = initTreeRender({
        store,
        separatorManager,
        getOpens: () => opens,
        getRememberState: () => rememberState
    });

    // 树视图层（nodeTrees、最近书签区、generateTree、树事件与启动的
    // chrome.bookmarks.getTree）已剥离至 src/tree-view.js（P1，8b），
    // 在 actions/dnd 初始化之后经 initTreeView 装配（见下方）。

    // parse version to dictionary
    const parseVersion = function(strversion) {
        let v = {};
        const keys = [ 'major', 'minor' ];
        let matches = strversion.match(/([\d]+)\.([\d]+)/i);
        if (!matches)
            return null;
        matches.slice(1).forEach(function(m, i) {
            v[keys[i]] = parseInt(m, 10);
        });
        return v;
    };

    // Donation (v4 gentle-ask model): no countdown, no forced navigation,
    // no focus stealing. The card reappears on every popup open until the
    // user makes an explicit choice — closing the popup never counts as an
    // answer, so the ask cannot be ignored away, but it never blocks usage
    // either. Choices: Donate (opens the page, long snooze), Later (short
    // snooze), Don't show again (permanent opt-out).
    let newOrUpgrade = true;
    const mf = chrome.runtime.getManifest();
    const currentVer = parseVersion(mf["version"]);
    if (!store.get('currentVersion')) {
        store.set('currentVersion', mf["version"]);
    } else {
        let recordVer = parseVersion(store.get('currentVersion'));
        store.set('currentVersion', mf["version"]);
        // x.0 versions have minor === 0, which is falsy — the old truthiness
        // check skipped the comparison entirely and every popup open counted
        // as an upgrade (donation card on every open). Compare numerically.
        if (recordVer && currentVer
                && typeof recordVer['major'] === 'number' && typeof recordVer['minor'] === 'number'
                && typeof currentVer['major'] === 'number' && typeof currentVer['minor'] === 'number') {
            if ( (recordVer['major'] > currentVer['major']) ||
                ((recordVer['major'] == currentVer['major']) && (recordVer['minor'] >= currentVer['minor'])) ){
                newOrUpgrade = false;
            }
        }
    }
    if (!store.get('openCount')) {
        store.set('openCount', 1);
    } else {
        store.set('openCount', parseInt(store.get('openCount'), 10) + 1);
    }
    if (!store.get('donationKey')) {
        // New installs get a grace window of ~30 popup opens before the
        // first ask, so the request comes after real usage value.
        store.set('donationKey', 30);
    }
    store.remove('donationCountDown'); // retired in v4 (was the 10s timer)

    const $donation = $('donation');
    const showDonation = (show) => {
        if (show) {
            if (newOrUpgrade) {
                $('new-version-text').innerHTML = _m('versionMessage', 
                    [mf["version"], 'Github']);
            }
            $('donation-text').innerHTML = _m('donationMessage');
            $('donation-go').innerHTML = _m('donationGo');
            $('donation-later').innerHTML = _m('donationLater');
            $('donation-never').innerHTML = _m('donationNever');
        }
        $donation.style.display = show ? 'block' : 'none';
    }

    if (!store.get('donationDisabled')
        && (newOrUpgrade || !store.get('donationFactor')
            || parseInt(store.get('donationFactor'), 10) >= parseInt(store.get('donationKey'), 10))) {
        showDonation(true);
    } else {
        store.set('donationFactor', parseInt(store.get('donationFactor'), 10) + 1);
    }

    // Context menus live in src/context-menu.js (P1): the three menus, the
    // body contextmenu handler (position math, hide-editables/hide-sort on
    // root folders, the mac right-click-hold quirk) and every menu-item
    // dispatch. This must init before initSearch, because search calls
    // switchBookmarkMenu synchronously when it restores a saved query — but
    // actions/dialogs init further below (actions needs the search API), so
    // they reach the menus module through getters that only run at dispatch
    // time, when every const below is long initialized.
    const menus = initContextMenu({
        tree: $tree,
        os,
        rtl,
        get actions() { return actions; },
        get dialogs() { return dialogs; },
        // v4 task-2: "Reveal in tree" menu dispatch — treeView inits far
        // below, but menu handlers only run on user events (TDZ-safe).
        get revealInTree() { return id => treeView.revealInTree(id); },
        // v4 task-2 slice C: dead/dupes view-row menu entries — same lazy
        // getter pattern (the view modules init below the menus).
        get deadMenu() {
            return {
                isMarked: id => viewDead.isMarked(id),
                toggle: id => viewDead.toggleMark(id)
            };
        },
        get dupesMenu() { return { setKeeper: id => viewDupes.setKeeper(id) }; }
    });

    // View manager (v4 task-2): the tab strip + view switching layer. Must
    // init before initSearch — the search module maps its mode onto the view
    // state machine at init (saved-query restore activates the search view).
    const views = initViewManager({
        store,
        isPanel: IS_PANEL,
        rtl
    });

    // Search lives in src/search.js (P1): it owns searchMode, the flat fuzzy
    // index, the results pane and every searchInput listener. generateTree
    // (tree-view) refreshes the index via search.updateIndex; everything else
    // goes through the returned API. switchBookmarkMenu comes from the menus
    // module (it hides the add-* menu entries while search is active).
    const search = initSearch({
        store,
        separatorManager,
        switchBookmarkMenu: menus.switchBookmarkMenu,
        generateBookmarkHTML: treeRender.generateBookmarkHTML,
        highlightTitlePositions: treeRender.highlightTitlePositions,
        // 与上方 rememberState 初值相同的确定性推导（search 只读取启动初值）
        rememberState: !store.get('dontRememberState'),
        // v4 task-2: search mode rides the view state machine
        views,
        // §2.3 R 键在树中定位：treeView 在下方才初始化，惰性闭包求值
        revealInTree: (...args) => treeView.revealInTree(...args)
    });

    // Popup auto-height — only grow, never shrink on user interaction.
    // Shrinking on folder collapse is jarring ("popup jumps"): the user
    // toggled a folder, they didn't ask the window to resize. The popup
    // height only shrinks on the initial load (fresh viewport);
    // interaction-triggered calls only grow. When autoResizePopup is off
    // the popup keeps its saved / default height unconditionally.
    const autoResizeEnabled = () => store.get('autoResizePopup') !== 'false';
    const $views = $('views');
    const resetHeight = (allowShrink) => {
        if (IS_PANEL)
            return;
        if (!autoResizeEnabled())
            return;

        const zoomLevel = store.get('zoom') ? parseInt(store.get('zoom'), 10) / 100 : 1;
        // scrollHeight captures the full scrollable content (recent section +
        // main tree), unlike firstElementChild.offsetHeight which only measures
        // the first child and misses the bulk of a long bookmark tree.
        // v4 task-2: #tree now lives inside #views > section, so the chrome
        // above the list (search bar + tab strip) is measured from #views.
        const contentH = ($tree.scrollHeight + $views.offsetTop + 16) * zoomLevel;
        const currentH = body.offsetHeight;
        chrome.tabs.getZoom(zoomFactor => {
            const minH = Math.max(300 / zoomFactor, 200);
            const maxH = Math.min(screen.height - window.screenY - 50, (600 / zoomFactor) - 1);
            const clampedContent = Math.max(minH, Math.min(contentH, maxH));

            let targetH;
            if (clampedContent > currentH) {
                // Content outgrew the popup: grow with it.
                targetH = clampedContent;
                body.style.transitionDuration = '.3s';
            } else if (allowShrink && clampedContent <= currentH &&
                       contentH <= maxH && clampedContent < currentH * 0.7) {
                // Only shrink when explicitly allowed AND the full tree fits
                // within the max height without scroll AND there's real waste.
                targetH = clampedContent;
                body.style.transitionDuration = '.15s';
            } else {
                // Stay put: content is shorter but the popup is a comfortable
                // size. Never shrink on folder toggle events.
                return;
            }
            body.style.height = `${targetH}px`;
            store.set('popupHeight', targetH);
        });
    };

    if (!search.isActive())
        resetHeight(true);

    // Interaction-triggered calls never shrink — only grow.
    $tree.addEventListener('click', () => resetHeight(false));
    $tree.addEventListener('keyup', () => resetHeight(false));

    // Reorder the children of folderId with serial bookmarks.move calls, then
    // rebuild the tree (the opens memory restores the expanded state).
    const sortFolderContents = (folderId, opts) => {
        chrome.bookmarks.getSubTree(folderId, nodes => {
            if (!nodes || !nodes.length)
                return;
            const sorted = window.VBMSort.sortNodes(nodes[0].children || [], opts);
            // Moving every node to its target index in ascending order leaves
            // the parent sorted, because positions before i are already final.
            const moveAll = list => list.reduce((chain, node, i) =>
                chain.then(() => new Promise(resolve => {
                    chrome.bookmarks.move(node.id, { index: i }, () => resolve());
                })), Promise.resolve());
            const applyLevel = list => moveAll(list).then(() => {
                if (!opts.recursive)
                    return Promise.resolve();
                return list.reduce((chain, node) =>
                    (node.children && node.children.length) ?
                        chain.then(() => applyLevel(node.children)) : chain,
                    Promise.resolve());
            });
            applyLevel(sorted).then(() => {
                // treeView 在下方声明；此调用只在排序动作的异步回调里执行，TDZ 安全
                chrome.bookmarks.getTree(treeView.generateTree);
            });
        });
    };

    // Dialogs live in src/dialogs.js (P1); onSort reorders a folder's children.
    const dialogs = initDialogs({ onSort: sortFolderContents });

    // Undo stack + deletion toast (P3.3) live in src/undo.js. The onChanged
    // closure only runs after a successful undo — long after initTreeView
    // below — so the treeView reference is TDZ-safe (same pattern as
    // sortFolderContents above). Must init before initActions, which
    // receives it as ctx.undo for the delete paths.
    const undo = initUndo({
        onChanged: () => chrome.bookmarks.getTree(treeView.generateTree)
    });

    // v4 task-2 slice C: the dead view's × overlay re-lays itself after
    // every tree rebuild (onTreeGenerated above), but initViewDead runs
    // below initTreeView — this indirection keeps the first rebuilds safe.
    let deadOverlayRefresh = () => {};

    // v4 task-2 slice D (§5.4): visit statistics — created before the tree
    // view so bookmarkHandler's open hook and the tree-rebuild prune both
    // reach it; the stats view itself inits below with the other views.
    const visitStats = initVisitStats({ store });

    // Actions live in src/actions.js (P1): the whole bookmark action layer —
    // open/add/edit/delete/copy plus addSeparator/deleteSeparator. The
    // menu/keyboard handlers and the tree-view module reach them through this
    // table (actions inits above initTreeView, so no lazy getter is needed).
    const actions = initActions({
        store,
        dialogs,
        search,
        separatorManager,
        generateBookmarkHTML: treeRender.generateBookmarkHTML,
        generateFolderHTML: treeRender.generateFolderHTML,
        generateSeparatorHTML: treeRender.generateSeparatorHTML,
        generateHTML: treeRender.generateHTML,
        httpsPattern,
        undo
    });

    const middleClickBgTab = !!store.get('middleClickBgTab');
    const leftClickNewTab = !!store.get('leftClickNewTab');

    // Drag & drop ordering lives in src/dnd.js (P1): the tree mousedown drag
    // start, the document mousemove drop-target tracking (clone + overlay,
    // auto-scroll, drop-zone math) and the document mouseup drop
    // (chrome.bookmarks.move + DOM re-insertion). isDOMElementRootFolder and
    // canMoveBetweenStorage moved along (only dnd used them). resetSeparator
    // 是下方的 function 声明，hoist 到 store.ready.then 作用域顶部，此处注入
    // 安全；zoom 块(下方) 经返回值引用 dnd，只在用户事件时执行，TDZ 安全。
    const dnd = initDnd({
        tree: $tree,
        store,
        rtl,
        resetSeparator
    });

    // 同步指示器 wiring 已剥离至 src/sync-ui.js（P1，切片 9）：syncStatusChanged
    // 监听、单个/全量指示器刷新与 window.neat 遗留导出。syncUi 在 treeView
    // 之前初始化，refreshSyncIndicators 经返回值注入。
    const syncUi = initSyncUi({ store });

    // 树视图层已剥离至 src/tree-view.js（P1，8b）：nodeTrees/onlyShowBMBar
    // 状态、generateTree（含启动的 chrome.bookmarks.getTree 与本地分隔符
    // 迁移）、树事件（scroll/focus/click/middle-click）、最近书签区与
    // bookmarkHandler。menus/search/dialogs/actions/dnd/syncUi 均已在上方
    // 就绪，故全部直接值注入；opens/rememberState 经 get/set 回调共享
    // neat.js 状态。
    const treeView = initTreeView({
        store,
        tree: $tree,
        separatorManager,
        SeparatorManager,
        treeRender,
        search,
        actions,
        dnd,
        refreshSyncIndicators: syncUi.refreshSyncIndicators,
        getOpens: () => opens,
        getRememberState: () => rememberState,
        setOpens: v => { opens = v; },
        setRememberState: v => { rememberState = v; },
        middleClickBgTab,
        leftClickNewTab,
        // v4 task-2: view switching (revealInTree activates the tree view)
        views,
        // v4 task-2 §3.6: every tree rebuild refreshes the shared path map;
        // slice C §5.5c: and re-lays the dead-mark × overlays (the view
        // inits below — the indirection stays a no-op until then);
        // slice D §5.4: and prunes visit stats of deleted bookmarks
        onTreeGenerated: t => {
            views.buildPathMap(t);
            deadOverlayRefresh();
            const ids = new Set();
            const collect = nodes => {
                for (let i = 0, l = (nodes || []).length; i < l; i++) {
                    if (!nodes[i].url)
                        collect(nodes[i].children);
                    else
                        ids.add(nodes[i].id);
                }
            };
            collect(t);
            visitStats.prune(ids);
        },
        // slice D: page-side visit collection — bookmarkHandler funnels
        // every bookmark open (tree/search/recent/stats/dead/dupes rows);
        // slice E: the marker keeps the SW-side collector from counting
        // the same navigation a second time
        onOpenBookmark: (id, url) => {
            visitStats.record(id);
            markPopupOpen(url);
        }
    });

    // Recent view (v4 task-2 切片 B): the old in-tree recent section becomes
    // its own tab. Refresh is event-driven (onCreated/onRemoved + debounce)
    // and only runs while the tab is active; treeView is already initialized
    // above, so direct injection is safe. visitStats/undo serve the
    // history-permission banner (grant → one-shot import → toast).
    initViewRecent({
        store,
        views,
        treeRender,
        separatorManager,
        treeView,
        visitStats,
        undo
    });

    // Stats view (v4 task-2 切片 D): visit counters as their own tab.
    // Registration order fixes the tab order (§2: tree/search/recent/
    // stats/dead/dupes).
    const viewStats = initViewStats({
        store,
        views,
        treeRender,
        separatorManager,
        treeView,
        dialogs,
        visitStats
    });

    // Dead/dupes views (v4 task-2 切片 C): the palette's old dupes/dead
    // modes become their own tabs — group/keeper cleanup and the cached
    // dual-channel link scan. Same init point as recent (treeView/actions/
    // dialogs/undo all ready above); the menus reach them through the lazy
    // deadMenu/dupesMenu getters on initContextMenu's ctx.
    const viewDead = initViewDead({
        store,
        views,
        treeRender,
        separatorManager,
        treeView,
        actions,
        dialogs,
        undo
    });
    const viewDupes = initViewDupes({
        store,
        views,
        treeRender,
        separatorManager,
        treeView,
        actions,
        dialogs,
        undo,
        // slice D: the keep-most-visited strategy reads real counts now
        // (zeros + disabled option while statsEnabled is off)
        visitStats
    });
    deadOverlayRefresh = viewDead.refreshOverlays;

    // Tab-badge freshness: recompute the stats/dupes counts once at startup
    // so the tab strip reflects reality before the first visit to those
    // tabs (both refresh()es recompute in the background when inactive and
    // push the count through views.updateBadges).
    viewStats.refresh();
    viewDupes.refresh();

    // donation: three explicit answers to the ask (see the v4 model above)
    const donationSnooze = step => {
        showDonation(false);
        store.set('donationFactor', 1);
        const key = parseInt(store.get('donationKey'), 10);
        store.set('donationKey', Math.min(key + step, 3200));
    };
    $('donation-go').addEventListener('click', () => {
        donationSnooze(800); // donors get the longest quiet period
        actions.openBookmarkNewTab("https://github.com/windviki/vBookmarks/blob/master/donation/donation.md", true, true);
    });
    $('donation-later').addEventListener('click', () => donationSnooze(120));
    $('donation-never').addEventListener('click', () => {
        showDonation(false);
        store.set('donationDisabled', '1');
    });

    $('new-version-text').addEventListener('click', () => {
        actions.openBookmarkNewTab("https://github.com/windviki/vBookmarks#changelogs", true, true);
    });

    // Phase 3 (issue #30): quick-add star button — one click bookmarks the
    // current tab; when the page is already bookmarked the star is solid and
    // clicking opens the edit dialog for the existing bookmark.
    const quickAddBtn = $('quick-add-btn');
    const quickAddToast = $('quick-add-toast');
    let quickAddToastTimer = null;
    const showQuickAddToast = (msgKey, sub) => {
        quickAddToast.textContent = _m(msgKey, sub ? [sub] : undefined);
        quickAddToast.classList.add('show');
        clearTimeout(quickAddToastTimer);
        quickAddToastTimer = setTimeout(() => {
            quickAddToast.classList.remove('show');
        }, 1800);
    };
    const withCurrentTabBookmark = callback => {
        chrome.tabs.query({
            'active': true,
            'windowId': chrome.windows.WINDOW_ID_CURRENT
        }, tabs => {
            const tab = tabs[0];
            if (!tab || !tab.url) {
                callback(null, null);
                return;
            }
            chrome.bookmarks.search({ url: tab.url }, results => {
                callback(tab, (results && results.length) ? results[0] : null);
            });
        });
    };
    const refreshQuickAddState = () => {
        withCurrentTabBookmark((tab, bookmark) => {
            if (bookmark) {
                quickAddBtn.classList.add('starred');
                quickAddBtn.title = _m('quickRemoveBookmark');
            } else {
                quickAddBtn.classList.remove('starred');
                quickAddBtn.title = _m('quickAddBookmark');
            }
        });
    };
    const quickAddCurrentTab = () => {
        withCurrentTabBookmark((tab, bookmark) => {
            if (!tab)
                return;
            if (bookmark) {
                // Already bookmarked: remove it (mirrors Chrome's native star).
                // Track the id we're removing so the star refresh won't re-add it.
                const rmId = bookmark.id;
                chrome.bookmarks.remove(rmId, () => {
                    quickAddBtn.classList.remove('starred');
                    quickAddBtn.title = _m('quickAddBookmark');
                    showQuickAddToast('quickRemoved');
                });
            } else {
                const parentId = store.get('quickAddFolderId', '1');
                chrome.bookmarks.create({
                    title: tab.title || tab.url,
                    url: tab.url,
                    parentId
                }, () => {
                    quickAddBtn.classList.add('starred');
                    quickAddBtn.title = _m('quickRemoveBookmark');
                    // Show target folder name for discoverability
                    chrome.bookmarks.get(parentId, nodes => {
                        const folderName = (nodes && nodes.length) ? (nodes[0].title || '') : '';
                        showQuickAddToast('quickAddedTo', folderName);
                    });
                });
            }
        });
    };
    quickAddBtn.addEventListener('click', quickAddCurrentTab);
    refreshQuickAddState();
    // Ctrl/Cmd+D inside the popup does the same. Capture phase + stopPropagation
    // so the tree's type-ahead never sees the 'd'; skip while a dialog is open.
    document.addEventListener('keydown', e => {
        if (!(e.metaKey || e.ctrlKey) || (e.key !== 'd' && e.key !== 'D'))
            return;
        if (body.classList.contains('needConfirm') || body.classList.contains('needEdit') ||
            body.classList.contains('needAlert') || body.classList.contains('needInputName') ||
            body.classList.contains('needSort'))
            return;
        e.preventDefault();
        e.stopPropagation();
        quickAddCurrentTab();
    }, true);

    // Command palette (P2): Ctrl/Cmd+K overlay unifying bookmark/folder
    // search, folder jump and a small command set — see src/palette.js.
    // v4 task-2 §3.5: the dupes/dead modes are retired in favor of the view
    // Go commands (views.activate) and the /search bridge (search.run).
    // actions/treeView/quickAddCurrentTab are all defined above, so plain
    // values; rootFolderId mirrors the quick-add target folder.
    const palette = initPalette({
        store,
        actions,
        treeView,
        views,
        search,
        quickAdd: quickAddCurrentTab,
        rootFolderId: store.get('quickAddFolderId', '1') || '1',
        dialogs,
        onChanged: () => chrome.bookmarks.getTree(treeView.generateTree),
        // Palette Escape: dismiss context menu first if one is open over the
        // panel (e.g. right-clicked a result row), only then close the panel.
        clearMenu: menus.clearMenu,
        // P4: follow the tree-view click setting for bookmark opens
        leftClickNewTab
    });

    // Tool button (⋮): opens the command palette for feature discovery —
    // dead-link scan, duplicate cleanup, session save, and all slash commands.
    const toolBtn = $('tool-btn');
    if (toolBtn) {
        toolBtn.title = _m('toolButtonTitle');
        toolBtn.addEventListener('click', () => palette.open());
    }

    // Global wake-up (background.js's open-command-palette command): the
    // fallback popup window carries ?palette=1; the chrome.action.openPopup
    // path sets a session-storage flag instead.
    if (new URLSearchParams(window.location.search).has('palette')) {
        palette.open();
        // Consume a stale flag too, so the next plain popup open stays clean.
        chrome.storage.session.remove('pendingPaletteOpen');
    } else {
        chrome.storage.session.get('pendingPaletteOpen', v => {
            if (v && v.pendingPaletteOpen) {
                palette.open();
                chrome.storage.session.remove('pendingPaletteOpen');
            }
        });
    }

    // Disable Chrome auto-scroll feature
    window.addEventListener('mousedown', e => {
        if (e.button === 1) // middle-click
            e.preventDefault();
    });

    // Context menus live in src/context-menu.js (P1, init'd next to initSearch
    // above): the three menus, the body contextmenu handler and every
    // menu-item dispatch. What remains here is menus.* call sites: clearMenu
    // in the resizer code below, and the menu elements the context mousemove /
    // mouseout handlers bind to (menus.bookmarkMenu/folderMenu/separatorMenu).

    // Keyboard navigation lives in src/keyboard.js (P1): the tree/results
    // keydown+keyup handlers (arrow walking, Enter/Space, Home/End,
    // PageUp/PageDown, F2, Delete, type-ahead), the context menus' keydown
    // handler and the document-level Escape / Ctrl+F handler. menus, search,
    // actions and dialogs all init above, so they are passed straight in.
    initKeyboard({
        tree: $tree,
        search,
        actions,
        menus,
        dialogs,
        body,
        os,
        rtl,
        palette,  // ESC layering: close palette before letting Chrome close popup
        views     // v4 task-2: list registry + view-level Escape behavior
    });

    const contextMouseMove = e => {
        e.target.focus();
    };
    menus.bookmarkMenu.addEventListener('mousemove', contextMouseMove);
    menus.folderMenu.addEventListener('mousemove', contextMouseMove);
    menus.separatorMenu.addEventListener('mousemove', contextMouseMove);

    const contextMouseOut = function () {
        if (parseInt(this.style.opacity, 10))
            this.focus();
    };
    menus.bookmarkMenu.addEventListener('mouseout', contextMouseOut);
    menus.folderMenu.addEventListener('mouseout', contextMouseOut);
    menus.separatorMenu.addEventListener('mouseout', contextMouseOut);

    // Resizer
    const $resizerx = $('resizer-x');
    const $resizery = $('resizer-y');
    let resizerXDown = false;
    let resizerYDown = false;
    let bodyWidth = 0,
        bodyHeight = 0, 
        screenX = 0, 
        screenY = 0;

    // Reset separators — CSS-driven since v4.1: .separator-row + .separator-line
    // use absolute positioning (left:0 / right:8px) that auto-adapts to any width.
    // The old inline-width recalc is retired; this stays as a no-op because dnd.js
    // and the resizer still call it for post-drag / post-resize cleanup.
    function resetSeparator() {}

    // Drag the edge
    $resizerx.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        resizerXDown = true;
        bodyWidth = body.offsetWidth;
        screenX = e.screenX;
    });
    $resizery.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        resizerYDown = true;
        bodyHeight = body.offsetHeight;
        screenY = e.screenY;
    });
    let currentMaxHeight = 0;
    function mouseMoveHandler(e) {
        if (!resizerXDown && !resizerYDown)
            return;
        e.preventDefault();
        const isX = resizerXDown;
        if (e.type === 'mouseup') {
            resizerXDown = false;
            resizerYDown = false;
            treeView.adaptBookmarkTooltips();
        }
        if (isX) {
            // record current width
            const changedWidth = rtl ? (e.screenX - screenX) : (screenX - e.screenX);
            let width = bodyWidth + changedWidth;
            // 320 < width < 640
            width = Math.min(640, Math.max(320, width));
            // if (!rtl && e.screenX < 640 || rtl && e.screenX > 640) {
            //     $resizerx.style.cursor = 'not-allowed';
            // } else {
            //     $resizerx.style.cursor = 'col-resize';
            // }
            body.style.width = `${width}px`;
            store.set('popupWidth', width);
            resetSeparator(); // Reset separators
            menus.clearMenu();
        } else {
            // record current height
            const changedHeight = e.screenY - screenY;
            let height = bodyHeight + changedHeight;
            // 240 < height < 600
            if (currentMaxHeight <= 0) {
                chrome.tabs.getZoom(zoomFactor => {
                    currentMaxHeight = (600 / zoomFactor) - 1;
                    height = Math.min(currentMaxHeight, Math.max(currentMaxHeight / 2, height));
                    body.style.height = `${height}px`;
                    store.set('popupHeight', height);
                    resetSeparator(); // Reset separators
                    menus.clearMenu();
                });
            } else {
                height = Math.min(currentMaxHeight, Math.max(currentMaxHeight / 2, height));
                body.style.height = `${height}px`;
                store.set('popupHeight', height);
                resetSeparator(); // Reset separators
                menus.clearMenu();
                if (e.type === 'mouseup') {
                    currentMaxHeight = 0;
                }
            }
        }
    }
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseMoveHandler);

    // Make webkit transitions work only after elements are settled down
    setTimeout(() => {
        body.classList.add('transitional');
    }, 10);

    // Zoom
    if (store.get('zoom')) {
        body.dataset.zoom = store.get('zoom');
    }
    const zoom = val => {
        if (dnd.isDragging())
            return; // prevent zooming when drag-n-dropping
        const dataZoom = body.dataset.zoom;
        const currentZoom = dataZoom ? parseInt(dataZoom, 10) : 100;
        if (val === 0) {
            delete body.dataset.zoom;
            store.remove('zoom');
        } else {
            let z = (val > 0) ? currentZoom + 10 : currentZoom - 10;
            z = Math.min(150, Math.max(90, z));
            body.dataset.zoom = `${z}`;
            store.set('zoom', z);
        }
        body.classList.add('dummy'); // force redraw
        body.classList.remove('dummy');
        resetHeight(true);
    };
    //use 'wheel' event and 'e.deltaY' instead (>= Chrome 61)
    function wheelHandler(e) {
        if (!e.metaKey && !e.ctrlKey)
            return;
        e.preventDefault();
        zoom(e.deltaY || e.wheelDelta);
    }
    document.addEventListener('wheel', wheelHandler);
    document.addEventListener('mousewheel', wheelHandler);
    document.addEventListener('keydown', e => {
        if (!e.metaKey && !e.ctrlKey)
            return;
        switch (e.key) {
            case '+': // =/+ (plus)
            case '=': // =/+ (plus)
                e.preventDefault();
                zoom(1);
                break;
            case '-': // - (minus)
                e.preventDefault();
                zoom(-1);
                break;
            case '0': // 0 (zero)
                e.preventDefault();
                zoom(0);
                break;
        }
    });

    // Fix stupid Chrome build 536 bug
    if (version.build >= 536)
        body.classList.add('chrome-536');

    // Fix stupid wrong offset of the page, on Chrome Mac
    if (os === 'mac') {
        setTimeout(() => {
            const top = body.scrollTop;
            if (top !== 0)
                body.scrollTop = 0;
        }, 1500);
    }

    if (store.get('userstyle')) {
        const style = document.createElement('style');
        style.textContent = store.get('userstyle');
        document.body.appendChild(style);
    }

    // document.addEventListener('DOMContentLoaded', () => {

    //     const reportError = (msg, url, line) => {
    //         const manifest = chrome.runtime.getManifest();
    //         const version = manifest.version;
    //         const txt = `_s=84615e81d50c4ddabff522aee3c4b734&_r=img&Msg=${escape(msg)}&URL=${escape(url)}&Line=${line}&Platform=${escape(navigator.platform)}&Version=${escape(version)}&UserAgent=${escape(navigator.userAgent)}`;
    //         const i = document.createElement('img');
    //         i.setAttribute('src', `${('https:' === document.location.protocol) ? 'https://errorstack.appspot.com'
    //             : 'http://www.errorstack.com'}/submit?${txt}`);
    //         document.body.appendChild(i);
    //         i.onload = () => {
    //             document.body.removeChild(i);
    //         };
    //     };

    //     window.onerror = reportError;

    //     chrome.extension.onRequest.addListener(request => {
    //         if (request.error) reportError.apply(null, request.error);
    //     });
    // });
    
    if (store.get('customIcon')) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const customIcon = JSON.parse(store.get('customIcon'));
        const imageData = ctx.getImageData(0, 0, 19, 19);
        for (const key in customIcon) imageData.data[key] = customIcon[key];
        chrome.action.setIcon({
            imageData: imageData
        });
    }

    });
})(window);
