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
import { initFaviconFallback } from './favicon-fallback.js';
import { initFaviconEnrich } from './favicon-enrich.js';
import { applyUserStyle } from './userstyle.js';
import { initResize } from './resize.js';
import { createFolderSorter } from './folder-sort.js';
import { createQuickAdd } from './quick-add.js';
import { createDonation } from './donation.js';
import { initAnnounce } from './announce.js';
import { createToolButton } from './tool-button.js';
import { initWakeUp } from './wake-up.js';
import { shouldHighlightUnsynced, shouldRememberState } from './settings.js';

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

    // Default-favicon fallback (4.0.2): swap Chrome's flat-gray no-favicon
    // placeholder bitmap for the theme-following DEFAULT_BOOKMARK_ICON.
    // Installed before any rows render (the store.ready block below) so the
    // capture-phase load delegation catches every favicon <img>.
    // v4.1: the same module also runs the favicon contrast service (invert
    // low-contrast icons against the current background). Both getters read at
    // decision time, so the options toggle and live palette theme switches
    // take effect immediately. themeIsDark resolves the --vbm-bg token's
    // luminance, covering light/dark/ink/paper/auto uniformly.
    // faviconContrastLive is the options-page value pushed through the
    // chrome.storage.onChanged listener below; null = trust the store mirror.
    let faviconContrastLive = null;
    // 4.0.6 favicon enrichment: enricher is instantiated AFTER faviconService
    // (it needs sampleIcon/statsBySrc), but the onPlaceholder hook must be in
    // place before any row renders — a lazy wrapper defers to `enricher` which
    // is assigned right after construction (first hook call happens at row
    // render time, long after). Same lazy-getter convention as the rest of
    // neat.js.
    let enricher = null;
    const faviconService = initFaviconFallback(window.document, {
        contrastEnabled: () => (faviconContrastLive ?? store.get('faviconContrast', '1')) === '1',
        onPlaceholder: img => !!enricher && enricher.onPlaceholder(img),
        themeIsDark: () => {
            const b = window.document.body;
            if (!b)
                return false;
            const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
                getComputedStyle(b).getPropertyValue('--vbm-bg').trim());
            if (!m)
                return false;
            const r = parseInt(m[1], 16) / 255;
            const g = parseInt(m[2], 16) / 255;
            const blue = parseInt(m[3], 16) / 255;
            return 0.2126 * r + 0.7152 * g + 0.0722 * blue < 0.5;
        }
    });

    // 4.0.6 favicon enrichment: fetch real icons for hosts Chrome has no
    // cached favicon for. Live getters read the options at decision time.
    enricher = initFaviconEnrich({
        doc: window.document,
        faviconService,
        isEnabled: () => store.get('faviconEnrich', '1') === '1',
        fallbackEnabled: () => store.get('faviconEnrichAgg', '') === '1'
    });

    // The store mirror has no onChanged forwarding, so an options-page
    // faviconContrast flip never reaches an already-open side panel (the
    // popup simply reloads on each open and never needed this). Listen
    // directly: remember the pushed value for the getter above and re-decide
    // every cached icon — turning the service off also sweeps the invert
    // classes it previously applied.
    const wc = window.chrome;
    if (faviconService && wc && wc.storage && wc.storage.onChanged) {
        wc.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes)
                return;
            if (Object.prototype.hasOwnProperty.call(changes, 'faviconContrast')) {
                faviconContrastLive = changes.faviconContrast.newValue ?? '1';
                faviconService.reapplyContrast();
            }
            // 4.0.6 favicon enrichment switches are live: off cancels in-flight
            // fetches and stops new enqueues; on lets the next placeholder
            // render trigger again. No re-render sweep on enable (avoid a
            // whole-tree scan) — the user reopens or scrolls to refresh.
            if (enricher && (Object.prototype.hasOwnProperty.call(changes, 'faviconEnrich')
                || Object.prototype.hasOwnProperty.call(changes, 'faviconEnrichAgg'))) {
                enricher.setEnabled(store.get('faviconEnrich', '1') === '1');
            }
        });
    }

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
        // P3.4: single-bookmark tab-group entries
        'bookmark-open-in-new-group': 'bookmarkOpenInNewGroup',
        'bookmark-open-in-new-group-setup': 'bookmarkOpenInNewGroupSetup',
        'bookmark-open-in-existing-group': 'bookmarkOpenInExistingGroup',
        // issue #48 follow-up: the collapsed tab-group submenu reuses the same
        // labels (ids carry a `sub-` prefix, normalized at dispatch time)
        'sub-bookmark-open-in-new-group': 'bookmarkOpenInNewGroup',
        'sub-bookmark-open-in-new-group-setup': 'bookmarkOpenInNewGroupSetup',
        'sub-bookmark-open-in-existing-group': 'bookmarkOpenInExistingGroup',
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
        // P3.4: the named-setup + existing-group folder entries
        'open-bookmarks-in-group-setup': 'openBookmarksInGroupSetup',
        'folder-open-in-existing-group': 'openBookmarksInExistingGroup',
        // issue #48 follow-up: the collapsed tab-group submenu (folder menu)
        'sub-open-bookmarks-in-group': 'openBookmarksInGroup',
        'sub-open-bookmarks-in-group-setup': 'openBookmarksInGroupSetup',
        'sub-folder-open-in-existing-group': 'openBookmarksInExistingGroup',
        'folder-new-window': 'openBookmarksNewWindow',
        'folder-new-incognito-window': 'openBookmarksIncognitoWindow',
        'folder-edit': 'edit',
        'folder-delete': 'deleteEllipsis',
        // issue #33: direct sort actions + the "Sort options…" dialog opener
        'sort-folder-by-name': 'sortByName',
        'sort-folder-by-date': 'sortByDate',
        'sort-folder-contents': 'sortOptions',
        // issue #48 follow-up: the collapsed sort submenu
        'sub-sort-folder-by-name': 'sortByName',
        'sub-sort-folder-by-date': 'sortByDate',
        'sub-sort-folder-contents': 'sortOptions',
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
        'sort-dialog-cancel-button': 'nope',
        // P3.4: the tab-group dialogs' labels + buttons (the dialog-text and
        // the existing-group picker list are filled at open time)
        'tab-group-title-label': 'tabGroupTitleLabel',
        'tab-group-color-label': 'tabGroupColorLabel',
        'tab-group-dialog-button': 'save',
        'tab-group-dialog-cancel-button': 'nope',
        'tab-group-pick-cancel-button': 'nope'
    }).forEach(([id, msg]) => {
        const el = $(id);
        if (el)
            el.textContent = _m(msg);
    });

    // RTL indicator
    const rtl = (getComputedStyle(body).getPropertyValue('direction') === 'rtl');
    if (rtl)
        body.classList.add('rtl');

    // highlightUnsynced setting (dead toggle revived): dim local-only
    // subtrees via the unsynced-subtree rows tree-render marks. Default on.
    // The boolean judgment lives in src/settings.js (testable).
    body.classList.toggle('highlight-unsynced',
        shouldHighlightUnsynced(store.getSyncSetting('highlightUnsynced', 'true')));

    // Init some variables
    let opens = store.get('opens') ? JSON.parse(store.get('opens')) : [];
    let rememberState = shouldRememberState(store.get('dontRememberState'));
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

    // Donation (v4 gentle-ask model) — the whole card lives in src/donation.js:
    // version gating, open-count / grace-key bookkeeping, the three answer
    // buttons, the v4 upgrade notice and the visibility rule. actions is
    // declared below; the button handlers only run on user events, so
    // openNewTab resolves lazily (TDZ-safe, same as the inline closure it
    // replaced).
    const donation = createDonation({
        store,
        $,
        chrome,
        _m,
        get openNewTab() { return (url, inNewTab, selected) => actions.openBookmarkNewTab(url, inNewTab, selected); }
    });
    // 4.0.8: the remote announcement layer (docs/announce.json + src/announce.js)
    // — the what's-new banner. Fire-and-forget: the 6h cache avoids network,
    // every fetch failure is silent, and when the donation card claims this
    // open the announcement defers to the next one (4.1.0 §4.3 priority).
    initAnnounce({
        store,
        $,
        chrome,
        _m,
        channel: IS_PANEL ? 'sidepanel' : 'popup',
        donationShowing: donation.shouldShow,
        get openNewTab() { return (url, inNewTab, selected) => actions.openBookmarkNewTab(url, inNewTab, selected); }
    });

    // Context menus live in src/context-menu.js (P1): the three menus, the
    // body contextmenu handler (position math, hide-sort on root folders,
    // the mac right-click-hold quirk) and every menu-item dispatch. This
    // must init before initSearch, because search calls
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
        get dupesMenu() {
            return {
                setKeeper: id => viewDupes.setKeeper(id),
                // v4 task-3 #16: group-head menu (labels resolved at open
                // time, dispatch by group key)
                cleanHint: key => viewDupes.cleanHint(key),
                isCollapsed: key => viewDupes.isCollapsed(key),
                cleanGroup: key => viewDupes.cleanGroup(key),
                toggleGroup: key => viewDupes.toggleGroup(key)
            };
        },
        // v4 task-4 #6: the palette custom-command row menu (edit/delete)
        // — palette inits below, same lazy getter pattern as the views.
        get paletteMenu() { return palette.customMenu; },
        // issue #33: the direct sort menu items need the persisted sort
        // options (for the label's recursive suffix and the sort opts) and the
        // sortFolderContents dispatcher. Both read lazily — context-menu inits
        // before sortFolderContents/undo are declared (TDZ-safe on user events).
        get sortOptions() { return readSortOptions(); },
        get sortFolder() { return (id, opts) => sortFolderContents(id, opts); },
        // issue #48 follow-up: the tab-group / sort blocks may collapse into
        // single submenu entries (read at open time; defaults tab-group off,
        // sort on).
        get collapseTabGroupMenu() { return store.get('collapseTabGroupMenu', '0') === '1'; },
        get collapseSortMenu() { return store.get('collapseSortMenu', '1') === '1'; },
        // The extension zoom factor (body[data-zoom] CSS zoom): the menu
        // container itself is zoom:1 while #search is a zoomed body> child,
        // so positionMenu scales the search-bar clamp up to viewport space.
        get zoomLevel() { return store.get('zoom') ? parseInt(store.get('zoom'), 10) / 100 : 1; }
    });

    // v4 task-2 slice C: the dead view's × overlay re-lays itself after
    // every list render (tree rebuild, search results, recent/stats/dupes
    // rows — the onRowsRendered hooks below), but initViewDead runs later in
    // this function — this indirection keeps the first renders safe.
    // Declared above initSearch: the saved-query restore can render results
    // during init, and the hook closures must never hit the TDZ.
    let deadOverlayRefresh = () => {};

    // View manager (v4 task-2): the tab strip + view switching layer. Must
    // init before initSearch — the search module maps its mode onto the view
    // state machine at init (saved-query restore activates the search view).
    const views = initViewManager({
        store,
        isPanel: IS_PANEL,
        rtl,
        clearMenu: menus.clearMenu,
        // The "记住之前的状态" flag: view-manager's focusSpot capture/persist/
        // restore follow it, the same way tree-view's focusID restore does.
        getRememberState: () => rememberState
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
        rememberState: shouldRememberState(store.get('dontRememberState')),
        // v4 task-2: search mode rides the view state machine
        views,
        // v4 task-3 #15: the history rows' menu key mirrors the tree's rtl rule
        rtl,
        // §2.3 R 键在树中定位：treeView 在下方才初始化，惰性闭包求值
        revealInTree: (...args) => treeView.revealInTree(...args),
        // 第五轮项3: results re-render wipes the dead-mark × overlays —
        // re-lay them after every render (no-op until viewDead inits).
        onRowsRendered: () => deadOverlayRefresh()
    });

    // Popup resize + zoom（auto-height / 边缘拖拽 resizers / Ctrl+Cmd 缩放 /
    // issue #51 的 userResizedHeight 会话旗标）已剥离至 src/resize.js，纯决策
    // 内核在 src/resize-core.js。在原 auto-height 代码的位置初始化：此处
    // store/body/tree/views/menus/search 均已就绪；treeView/dnd 在下方才初始
    // 化，经惰性 getter 在事件发生时求值（TDZ 安全，与 menus ctx 同模式）。
    initResize({
        store,
        body,
        tree: $tree,
        views: $('views'),
        isPanel: IS_PANEL,
        rtl,
        search,
        clearMenu: menus.clearMenu,
        get treeView() { return treeView; },
        get isDragging() { return dnd.isDragging(); }
    });

    // Parse the persisted sort options (shared with the dialog and options
    // page via sort-utils.js); used by the direct sort menu items.
    const readSortOptions = () =>
        window.VBMSort ? window.VBMSort.parseSortOptions(store.get('sortOptions'))
            : { by: 'title', foldersFirst: true, recursive: false };

    // Reorder the children of folderId with serial bookmarks.move calls, then
    // rebuild the tree (the opens memory restores the expanded state). The
    // executor (src/folder-sort.js) holds the re-entrancy lock, captures the
    // pre-sort order of EVERY level and wires the toast Undo replay — the
    // direct menu items and the sort dialog share this executor, so one lock
    // covers both entries. undo / treeView are declared below; the sorter only
    // touches them on user events (TDZ-safe via the lazy getters).
    const sortFolderContents = createFolderSorter({
        _m,
        get undo() { return undo; },
        get treeView() { return treeView; }
    });

    // Dialogs live in src/dialogs.js (P1); onSort reorders a folder's children,
    // and store lets the sort dialog persist its options (issue #33).
    const dialogs = initDialogs({ onSort: sortFolderContents, store });

    // Undo stack + deletion toast (P3.3) live in src/undo.js. The onChanged
    // closure only runs after a successful undo — long after initTreeView
    // below — so the treeView reference is TDZ-safe (same pattern as
    // sortFolderContents above). Must init before initActions, which
    // receives it as ctx.undo for the delete paths.
    const undo = initUndo({
        onChanged: () => chrome.bookmarks.getTree(treeView.generateTree)
    });

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
        },
        // 第五轮项3: the lazy folder-expand renders rows outside
        // generateTree — re-lay the dead-mark × overlays on them too.
        onRowsRendered: () => deadOverlayRefresh(),
        // v4 task-3 #14: the onlyShowBMBar reveal guard toasts through the
        // undo bar's generic action toast (undo inits above, plain value).
        toastAction: undo.toastAction
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
        undo,
        // 第五轮项3: re-lay the dead-mark × overlays after every re-render
        // (activate + the onCreated/onRemoved debounced refresh).
        onRowsRendered: () => deadOverlayRefresh()
    });

    // Stats view (v4 task-2 切片 D): visit counters as their own tab.
    // Registration order fixes the tab order (§2: tree/search/recent/
    // stats/dead/dupes). 第四轮项9: undo serves the star-add toast and
    // onChanged is the minimal tree-invalidation hook after a one-click
    // bookmark from the recent-history section (same chain undo/palette use).
    const viewStats = initViewStats({
        store,
        views,
        treeRender,
        separatorManager,
        treeView,
        dialogs,
        visitStats,
        undo,
        onChanged: () => chrome.bookmarks.getTree(treeView.generateTree),
        // 第五轮项3: re-lay the dead-mark × overlays after every re-render.
        onRowsRendered: () => deadOverlayRefresh()
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
        visitStats,
        // 第五轮项3: re-lay the dead-mark × overlays after every re-render.
        onRowsRendered: () => deadOverlayRefresh()
    });
    deadOverlayRefresh = viewDead.refreshOverlays;

    // Tab-badge freshness: recompute the stats/dupes counts once at startup
    // so the tab strip reflects reality before the first visit to those
    // tabs (both refresh()es recompute in the background when inactive and
    // push the count through views.updateBadges).
    viewStats.refresh();
    viewDupes.refresh();

    // Popup reopen "where I was": restore the last focus spot (a list row /
    // header button / toolbar control / view tab) once all views are
    // registered. Gated by the remember option; its internal retry + the
    // user-interaction guard keep it from fighting a user who already began
    // typing or clicking. The tree's focusID refocus (generateTree) and the
    // search-query restore stay the owners of their own zones.
    views.restoreFocusSpot();

    // Phase 3 (issue #30): quick-add star button — one click bookmarks the
    // current tab; when the page is already bookmarked the star is solid and
    // clicking removes it (mirrors Chrome's native star). The flow + the
    // Ctrl/Cmd+D binding + the quickAddEnabled visibility all live in
    // src/quick-add.js (tested directly).
    const quickAddBtn = $('quick-add-btn');
    const quickAddToast = $('quick-add-toast');
    const quickAdd = createQuickAdd({
        store, document, body, chrome,
        quickAddBtn, quickAddToast, _m
    });
    const quickAddCurrentTab = quickAdd.quickAddCurrentTab;
    quickAddBtn.addEventListener('click', quickAddCurrentTab);
    quickAdd.refreshQuickAddState();
    quickAdd.bindQuickAddKey();

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
    // v4 task-3 #20: hidden when showToolButton is off, or when the palette
    // itself is disabled (the button's only job is opening it). Visibility
    // rule + click wiring live in src/tool-button.js.
    createToolButton({ store, toolBtn: $('tool-btn'), palette, _m });

    // Global wake-up (background.js's open-command-palette command): the
    // fallback popup window carries ?palette=1; the chrome.action.openPopup
    // path sets a session-storage flag instead. Lives in src/wake-up.js.
    initWakeUp({
        palette,
        chrome,
        hasPaletteQuery: new URLSearchParams(window.location.search).has('palette')
    });

    // Disable Chrome auto-scroll feature
    window.addEventListener('mousedown', e => {
        if (e.button === 1) // middle-click
            e.preventDefault();
    });

    // Context menus live in src/context-menu.js (P1, init'd next to initSearch
    // above): the three menus, the body contextmenu handler and every
    // menu-item dispatch. What remains here is menus.* call sites: clearMenu
    // via the resize module's ctx (src/resize.js closes an open menu while
    // dragging), and the menu elements the context mousemove / mouseout
    // handlers bind to (menus.bookmarkMenu/folderMenu/separatorMenu).

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
    if (menus.searchHistoryMenu)
        menus.searchHistoryMenu.addEventListener('mousemove', contextMouseMove);
    // final polish: same hover-focus for the two v4 task-3 menus
    if (menus.histRowMenu)
        menus.histRowMenu.addEventListener('mousemove', contextMouseMove);
    if (menus.dupesGroupMenu)
        menus.dupesGroupMenu.addEventListener('mousemove', contextMouseMove);
    // issue #48 follow-up: the collapsed-group flyouts highlight/focus their
    // items on hover too. contextMouseOut is deliberately NOT bound to them —
    // a mouseout to a hidden flyout would strand focus there.
    if (menus.folderTabGroupSubmenu)
        menus.folderTabGroupSubmenu.addEventListener('mousemove', contextMouseMove);
    if (menus.folderSortSubmenu)
        menus.folderSortSubmenu.addEventListener('mousemove', contextMouseMove);
    if (menus.bookmarkTabGroupSubmenu)
        menus.bookmarkTabGroupSubmenu.addEventListener('mousemove', contextMouseMove);

    const contextMouseOut = function () {
        if (parseInt(this.style.opacity, 10))
            this.focus();
    };
    menus.bookmarkMenu.addEventListener('mouseout', contextMouseOut);
    menus.folderMenu.addEventListener('mouseout', contextMouseOut);
    menus.separatorMenu.addEventListener('mouseout', contextMouseOut);
    if (menus.searchHistoryMenu)
        menus.searchHistoryMenu.addEventListener('mouseout', contextMouseOut);
    if (menus.histRowMenu)
        menus.histRowMenu.addEventListener('mouseout', contextMouseOut);
    if (menus.dupesGroupMenu)
        menus.dupesGroupMenu.addEventListener('mouseout', contextMouseOut);

    // Reset separators — CSS-driven since v4.1: .separator-row + .separator-line
    // use absolute positioning (left:0 / right:8px) that auto-adapts to any width.
    // The old inline-width recalc is retired; this stays as a no-op because dnd.js
    // still calls it for post-drag cleanup (the resizer's own calls moved along
    // with src/resize.js and were dropped there).
    function resetSeparator() {}

    // Make webkit transitions work only after elements are settled down
    setTimeout(() => {
        body.classList.add('transitional');
    }, 10);

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

    // Custom styles (userstyle): apply the user's CSS as a <style> appended to
    // <body> — later in the cascade than the <head> stylesheet links, so a
    // same-specificity rule wins by source order (src/userstyle.js).
    applyUserStyle(document, store.get('userstyle'));

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
