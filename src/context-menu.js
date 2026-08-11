/**
 * Popup context menus (P1 module extracted from neat.js).
 *
 * Owns the four right-click menus (bookmark / folder / separator /
 * search-history): opening them from the tree or results pane (active-row
 * tracking, the hide-editables
 * / hide-sort toggles on root folders, rtl-aware position math, the Mac
 * right-click-hold-to-close quirk), clearing them on outside clicks, scrolls
 * and focus moves, hiding the add-* entries while search is active
 * (switchBookmarkMenu) and dispatching every menu-item click to the action
 * layer. currentContext (the row the menu was opened on) stays private.
 * v4 task-2 adds the view-row entries: "reveal in tree" on out-of-tree
 * rows, and slice C's dead-mark toggle / dupes keeper pin on dead/dupes
 * view rows (their labels/APIs resolve at open/dispatch time).
 * Round-4 item 7 adds the search-history menu: rows of the upper search
 * pane are recorded queries, not bookmarks, so they get a dedicated minimal
 * menu (rerun / remove / clear-all) instead of the bookmark one.
 * v4 task-3 adds three more row-aware behaviors: the positional bookmark
 * entries (add before/after ×4 + add-separator) hide on every row outside
 * the tree view (#11 — they make no sense in flat result lists); the
 * unbookmarked recent-history rows of the stats view get their own slim
 * menu (open×3 + bookmark-it, #10); and a dupes group head gets a group
 * menu (apply-dedup / expand-collapse, #16) instead of the folder menu
 * the span walk-up used to land on.
 *
 * initContextMenu(ctx) is called once by neat.js BEFORE initSearch: search
 * needs menus.switchBookmarkMenu at init time (a restored query calls it
 * synchronously), while initActions/initDialogs need the search API. That
 * ordering means neither actions nor dialogs can exist yet when this module
 * initializes, so ctx exposes them through getters that are read at dispatch
 * time — menu handlers only run on user events, long after init finished.
 * ctx.tree                       — the #tree element (clearMenu focus compare + bindings)
 * ctx.os                         — 'mac' | 'win' | 'linux' | 'other'
 * ctx.rtl                        — true when the popup is right-to-left
 * ctx.actions                    — initActions API (read lazily, see above)
 * ctx.dialogs                    — initDialogs API (SortDialog, read lazily)
 * ctx.revealInTree               — view-row → tree jump (read lazily)
 * ctx.deadMenu                   — { isMarked, toggle } of the dead view (lazily)
 * ctx.dupesMenu                  — { setKeeper, cleanHint, isCollapsed,
 *                                  cleanGroup, toggleGroup } of the dupes view (lazily)
 *
 * The #results element is looked up here directly (the same static node
 * search.js wraps and returns as search.results) — injecting the search API
 * would recreate the init cycle described above. chrome.tabs/bookmarks/
 * windows, document/window/setTimeout remain page globals. No neatools
 * helpers: plain getElementById/classList only (neatools'
 * Array.map(c => c.url, children).clean() is inlined as map + filter).
 */
import { cleanGroupTitle, pickGroupColor } from './tab-group-utils.js';

export function initContextMenu(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const body = document.body;
    const $tree = ctx.tree;
    const os = ctx.os;
    const rtl = ctx.rtl;

    const $bookmarkContextMenu = $('bookmark-context-menu');
    const $folderContextMenu = $('folder-context-menu');
    const $separatorContextMenu = $('separator-context-menu');
    const $searchHistoryContextMenu = $('search-history-context-menu');
    // v4 task-3 #10/#16: unbookmarked stats-history rows and dupes group
    // heads get their own menus (absent in minimal test setups → null-check).
    const $histRowContextMenu = $('hist-row-context-menu');
    const $dupesGroupContextMenu = $('dupes-group-context-menu');
    // v4 task-4 #6: the palette custom-command row menu (edit / delete)
    const $paletteCmdContextMenu = $('palette-cmd-context-menu');
    const $results = $('results');
    // Collapsed tab-group / sort submenus (issue #48 follow-up): body-level
    // sibling menus whose items are dispatched by the same handlers as their
    // parent-menu counterparts (their ids carry a `sub-` prefix, normalized at
    // dispatch time). Absent in minimal test setups → null-check everywhere.
    const $folderTabGroupSubmenu = $('folder-tab-group-submenu');
    const $folderSortSubmenu = $('folder-sort-submenu');
    const $bookmarkTabGroupSubmenu = $('bookmark-tab-group-submenu');
    let openSubmenu = null;

    // Collapse settings (lazy, read from ctx at open time): the tab-group
    // block collapses on BOTH the folder and bookmark menus, the sort block on
    // the folder menu only. Defaults — tab-group off, sort on.
    const collapseTabGroup = () => !!ctx.collapseTabGroupMenu;
    const collapseSort = () => ctx.collapseSortMenu !== false;

    // The row element (a/span) the open menu belongs to; cleared by clearMenu.
    let currentContext = null;
    // …plus the owner row's identity for the post-close focus restore: a
    // view re-render (regroup, mark toggle, scan tick) swaps the list's
    // innerHTML under an open/just-closed menu, so the owner ELEMENT may be
    // detached by the time focus returns. The li id survives on the
    // replacement row; the list container element itself is never swapped.
    let ownerInfo = null;
    // Every scrollable list a row menu can open on (ownerInfo capture).
    const LIST_SEL = '#tree, #results, #recent-list, #stats-list, #dead-list, ' +
        '#dupes-list, #search-history-area, #palette-results';

    // v4 task-2: unified row-id extraction — data-node-id first (the row id
    // every list view shares), the legacy prefix strip as fallback.
    const rowId = li =>
        (li.dataset && li.dataset.nodeId) || li.id.replace(/(neat-tree|neat-recent|results|recent)-item-/, '');

    // P3.4: a row's proposed group title = its <i> text (the displayed name),
    // with the localized sync suffix stripped — a group must not be named
    // "Foo (Local)" just because the tree row showed the sync annotation.
    const rowGroupTitle = () => {
        const titleNode = currentContext && currentContext.querySelector('i');
        return cleanGroupTitle(titleNode ? titleNode.textContent.trim() : '',
            [_m('syncSuffixLocal'), _m('syncSuffixSynced')]);
    };

    // Folder-menu entries Chrome refuses on the ROOT folders (bookmarks bar /
    // other bookmarks / mobile, whose parent is the '0' pseudo-root):
    //   - folder-edit            — update() rejects root title changes;
    //   - add-*-before/after     — create with parentId '0' (the root level)
    //                              is rejected (positions are fixed);
    //   - add-folder-separator   — same root-level insert.
    // They grey out (disable) like folder-delete; the in-root inserts
    // (top/bottom/new-folder) and the open actions stay enabled.
    const ROOT_DISABLED_IDS = [
        'folder-edit',
        'add-bookmark-before-folder', 'add-bookmark-after-folder',
        'add-folder-before-folder', 'add-folder-after-folder',
        'add-folder-separator', 'folder-delete'
    ];
    const setRootDisabled = on => {
        for (let i = 0, l = ROOT_DISABLED_IDS.length; i < l; i++) {
            const item = $(ROOT_DISABLED_IDS[i]);
            if (item)
                item.classList[on ? 'add' : 'remove']('disabled');
        }
    };

    // issue #33: the direct sort items (by name / by date) run with the
    // persisted sortOptions, so their labels reflect the recursive flag —
    // the action's scope is visible before the click. "Sort options…" (the
    // dialog opener) keeps its static label.
    const updateSortLabels = () => {
        const so = ctx.sortOptions || {};
        const suffix = so.recursive ? ` ${_m('sortRecursiveSuffix')}` : '';
        // The labels live in the main menu AND the collapsed sort submenu —
        // whichever is visible must carry the current (recursive) suffix.
        for (const id of ['sort-folder-by-name', 'sub-sort-folder-by-name']) {
            const item = $(id);
            if (item)
                item.textContent = _m('sortByName') + suffix;
        }
        for (const id of ['sort-folder-by-date', 'sub-sort-folder-by-date']) {
            const item = $(id);
            if (item)
                item.textContent = _m('sortByDate') + suffix;
        }
    };

    const hideAllMenus = () => {
        $bookmarkContextMenu.style.left = '-999px';
        $bookmarkContextMenu.style.opacity = '0';
        $bookmarkContextMenu.style.transform = 'scale(.98)';
        $folderContextMenu.style.left = '-999px';
        $folderContextMenu.style.opacity = '0';
        $folderContextMenu.style.transform = 'scale(.98)';
        $separatorContextMenu.style.left = '-999px';
        $separatorContextMenu.style.opacity = '0';
        $separatorContextMenu.style.transform = 'scale(.98)';
        if ($searchHistoryContextMenu) {
            $searchHistoryContextMenu.style.left = '-999px';
            $searchHistoryContextMenu.style.opacity = '0';
            $searchHistoryContextMenu.style.transform = 'scale(.98)';
        }
        if ($histRowContextMenu) {
            $histRowContextMenu.style.left = '-999px';
            $histRowContextMenu.style.opacity = '0';
            $histRowContextMenu.style.transform = 'scale(.98)';
        }
        if ($dupesGroupContextMenu) {
            $dupesGroupContextMenu.style.left = '-999px';
            $dupesGroupContextMenu.style.opacity = '0';
            $dupesGroupContextMenu.style.transform = 'scale(.98)';
        }
        if ($paletteCmdContextMenu) {
            $paletteCmdContextMenu.style.left = '-999px';
            $paletteCmdContextMenu.style.opacity = '0';
            $paletteCmdContextMenu.style.transform = 'scale(.98)';
        }
        // The root-folder disabled states are per-open (root vs non-root);
        // drop them all here so they can never leak across unrelated menu
        // opens.
        setRootDisabled(false);
        // Park any open collapsed-group flyout and its expanded marker.
        for (const sub of [$folderTabGroupSubmenu, $folderSortSubmenu, $bookmarkTabGroupSubmenu]) {
            if (!sub)
                continue;
            sub.style.left = '-999px';
            sub.style.opacity = '0';
            sub.style.transform = 'scale(.98)';
        }
        if (openSubmenu && openSubmenu._parentEntryId) {
            const entry = $(openSubmenu._parentEntryId);
            if (entry && entry.setAttribute)
                entry.setAttribute('aria-expanded', 'false');
        }
        openSubmenu = null;
    };

    // Shared menu positioning (the issue #48 clamp + horizontal/vertical fit).
    // mode 'cursor' = a main menu anchored at the pointer (never flips);
    // mode 'entry'  = a collapsed-group flyout anchored at its entry, flipped
    // to the other side when it would leave the popup. In both modes the menu
    // is clamped to the space below the search bar and gets its own internal
    // scrollbar when too tall, so focus() never scrolls the document.
    const positionMenu = (menu, anchor, mode) => {
        const searchBar = document.getElementById('search');
        const menuMinY = searchBar ? (searchBar.offsetTop + searchBar.offsetHeight) : 0;
        const viewportH = window.innerHeight;
        // The menu's own padding/border sits OUTSIDE the max-height content
        // box (default content-box sizing) — subtract that chrome from the
        // available space, or the total box still overflows. getComputedStyle
        // is absent in the unit-test DOM stub → chrome 0 (roomier clamp only).
        const menuCs = typeof getComputedStyle === 'function' ? getComputedStyle(menu) : null;
        const menuChrome = menuCs
            ? (parseFloat(menuCs.paddingTop) || 0) + (parseFloat(menuCs.paddingBottom) || 0) +
              (parseFloat(menuCs.borderTopWidth) || 0) + (parseFloat(menuCs.borderBottomWidth) || 0)
            : 0;
        const maxMenuH = Math.max(80, viewportH - menuMinY - 8 - menuChrome);
        if (menu.offsetHeight > maxMenuH + menuChrome) {
            menu.style.maxHeight = `${maxMenuH}px`;
            menu.style.overflowY = 'auto';
        } else {
            menu.style.maxHeight = '';
            menu.style.overflowY = '';
        }
        const menuWidth = menu.offsetWidth;
        const menuHeight = menu.offsetHeight;
        let pageX, pageY;
        if (mode === 'entry') {
            const aw = anchor.width || 0;
            if (rtl) {
                pageX = anchor.left - menuWidth;
                if (pageX < 0)
                    pageX = anchor.left + aw;
            } else {
                pageX = anchor.left + aw;
                if (pageX + menuWidth > body.offsetWidth)
                    pageX = anchor.left - menuWidth;
            }
            pageX = Math.max(0, Math.min(pageX, Math.max(0, body.offsetWidth - menuWidth)));
            pageY = Math.max(menuMinY, anchor.top);
            if (pageY + menuHeight > viewportH)
                pageY = Math.max(menuMinY, viewportH - menuHeight);
        } else {
            pageX = rtl ? Math.max(0, anchor.left - menuWidth) :
                Math.min(anchor.left, body.offsetWidth - menuWidth);
            const boundY = viewportH - anchor.clientY;
            pageY = boundY > menuHeight
                ? anchor.top
                : Math.max(anchor.top - menuHeight, menuMinY);
            pageY = Math.max(pageY, menuMinY);
        }
        menu.style.left = `${pageX}px`;
        menu.style.top = `${pageY}px`;
        menu.style.opacity = '1';
        menu.style.transform = 'scale(1)';
    };

    // ── collapsed-group flyouts ─────────────────────────────────────────
    const entryRect = entry => {
        const r = entry.getBoundingClientRect();
        return {
            left: r.left + window.scrollX,
            top: r.top + window.scrollY,
            width: r.width,
            height: r.height,
            clientY: r.top
        };
    };
    const openSubmenuFor = entry => {
        if (!entry || !entry.classList || entry.classList.contains('disabled'))
            return null;
        const sub = entry.dataset && $(entry.dataset.submenu);
        if (!sub)
            return null;
        if (openSubmenu && openSubmenu !== sub) {
            openSubmenu.style.left = '-999px';
            openSubmenu.style.opacity = '0';
            openSubmenu.style.transform = 'scale(.98)';
            if (openSubmenu._parentEntryId) {
                const old = $(openSubmenu._parentEntryId);
                if (old && old.setAttribute)
                    old.setAttribute('aria-expanded', 'false');
            }
        }
        openSubmenu = sub;
        openSubmenu._parentEntryId = entry.id;
        positionMenu(sub, entryRect(entry), 'entry');
        if (entry.setAttribute)
            entry.setAttribute('aria-expanded', 'true');
        return sub;
    };
    const closeSubmenu = (refocus = false) => {
        if (!openSubmenu)
            return;
        const parentId = openSubmenu._parentEntryId;
        openSubmenu.style.left = '-999px';
        openSubmenu.style.opacity = '0';
        openSubmenu.style.transform = 'scale(.98)';
        openSubmenu = null;
        if (parentId) {
            const entry = $(parentId);
            if (entry && entry.setAttribute)
                entry.setAttribute('aria-expanded', 'false');
            if (refocus && entry && entry.focus)
                entry.focus();
        }
    };
    const toggleSubmenuFor = entry => {
        if (openSubmenu && openSubmenu._parentEntryId === entry.id)
            closeSubmenu(true);
        else
            openSubmenuFor(entry);
    };
    const submenuOpen = () => !!openSubmenu;

    // Collapsed-group visibility + the folder noURLS state, applied at open
    // time BEFORE positioning (the class toggles change the measured size).
    const applyCollapseState = menu => {
        const isFolder = menu === $folderContextMenu;
        menu.classList.toggle('collapse-tab-group', collapseTabGroup());
        if (isFolder)
            menu.classList.toggle('collapse-sort', collapseSort());
        // Reset the entry/submenu disabled state first (per-open, self-corrects).
        const entry = isFolder ? $('folder-tab-group-collapse') : $('bookmark-tab-group-collapse');
        const submenu = isFolder ? $folderTabGroupSubmenu : $bookmarkTabGroupSubmenu;
        const targets = [entry];
        if (submenu)
            targets.push(...Array.from(submenu.querySelectorAll('.menu-item')));
        targets.forEach(t => { if (t && t.classList) t.classList.remove('disabled'); });
        // A folder whose children carry no URLs has nothing to tab-group: the
        // collapsed entry and its submenu read disabled (all three actions are
        // no-URL no-ops anyway). The async children read lands ~1 frame later.
        if (isFolder && collapseTabGroup() && currentContext) {
            const li = currentContext.closest ? currentContext.closest('li') : null;
            const id = li ? rowId(li) : null;
            if (id) {
                chrome.bookmarks.getChildren(id, children => {
                    const noURLS = !(children || []).some(c => c && c.url);
                    targets.forEach(t => {
                        if (t && t.classList)
                            t.classList.toggle('disabled', noURLS);
                    });
                });
            }
        }
    };

    // Focus after a menu closes (4.0.1 focus law: a menu close must never
    // drop focus to <body> or strand it on the hidden menu). The owning row
    // first; when a re-render swapped it out, its same-id replacement row;
    // failing both, the list container (the arrow keys keep working from
    // there — keyboard.js's container branch). A menu opened over the
    // PALETTE returns to the panel's input box instead: the result rows
    // carry no keyboard handlers, the panel's ↑↓ live on the input (K2).
    const refocusOwner = () => {
        const owner = currentContext;
        if (owner && owner.closest && owner.closest('#command-palette')) {
            const input = $('palette-input');
            if (input && input.focus) {
                input.focus();
                return;
            }
        }
        if (owner && owner.isConnected !== false && owner.focus) { // doubles count as connected
            owner.focus();
            return;
        }
        const info = owner ? ownerInfo : null;
        if (info && info.liId) {
            const li = document.getElementById(info.liId);
            const t = li && ((li.getAttribute && li.getAttribute('tabindex') !== null)
                ? li
                : (li.querySelector ? li.querySelector('a, span') : null));
            if (t && t.focus) {
                t.focus();
                return;
            }
        }
        if (info && info.listEl && info.listEl.focus) {
            info.listEl.focus();
            return;
        }
        // No recorded owner (a stale-marker close — view switch, palette
        // open): the legacy behavior, focus whatever row still carries it.
        const active = body.querySelector('.active');
        if (active && active.focus)
            active.focus();
    };

    const clearMenu = e => {
        const active = body.querySelector('.active');
        if (e) {
            currentContext = null;
            ownerInfo = null;
            if (active) {
                active.classList.remove('active');
                const el = e.target;
                if (el === $tree || el === $results) {
                    active.focus();
                }
            }
        } else {
            // Programmatic close (menu-item dispatch, view switch, palette
            // open): the .active marker stays (K6's stale-state contract)
            // and focus returns to the owning row, robust against the view
            // re-renders an action may have triggered.
            refocusOwner();
            currentContext = null;
            ownerInfo = null;
        }
        hideAllMenus();
    };

    // Cancel semantics (keyboard.js's ←-back / Esc): the marker comes OFF
    // the owning row and focus returns to it (refocusOwner covers a row
    // re-rendered away under the open menu), then every menu hides.
    const closeMenu = () => {
        const active = body.querySelector('.active');
        if (active)
            active.classList.remove('active');
        refocusOwner();
        currentContext = null;
        ownerInfo = null;
        hideAllMenus();
    };

    body.addEventListener('click', clearMenu);
    //body.addEventListener('scroll', clearMenu);
    $tree.addEventListener('scroll', clearMenu);
    //invalid event handler?
    window.addEventListener('scroll', clearMenu);
    $results.addEventListener('scroll', clearMenu);
    // Palette results (dead-link list etc.) scroll must also dismiss menus,
    // otherwise a right-click menu opened inside the palette stays frozen
    // while the list scrolls underneath it.
    const $paletteResults = $('palette-results');
    if ($paletteResults)
        $paletteResults.addEventListener('scroll', clearMenu);
    $tree.addEventListener('focus', clearMenu, true);
    $results.addEventListener('focus', clearMenu, true);
    // Round-3 item 3: the feature-view lists follow the same contract —
    // scrolling the content or moving focus into the list dismisses an open
    // menu (previously only the tree/results/palette panes did).
    for (const id of ['recent-list', 'stats-list', 'dead-list', 'dupes-list', 'search-history-area']) {
        const listEl = $(id);
        if (listEl) {
            listEl.addEventListener('scroll', clearMenu);
            listEl.addEventListener('focus', clearMenu, true);
        }
    }

    let macCloseContextMenu = false;
    body.addEventListener('contextmenu', e => {
        e.preventDefault();
        clearMenu();
        if (os === 'mac') {
            macCloseContextMenu = false;
            setTimeout(() => {
                macCloseContextMenu = true;
            }, 500);
        }
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        // Walk up to the nearest a/span when a child element (img, i, div, …)
        // captured the event — covers recent-view bookmarks and tree rows
        // whose ::after / favicon / sync-indicator received the click.
        if (el.tagName !== 'A' && el.tagName !== 'SPAN' && el.closest) {
            const nearest = el.closest('a, span');
            if (nearest) el = nearest;
        }
        // Round-6 item: menus belong to list ROWS. The walk-up above happily
        // lands on spans outside any row — the view-tab strip (right-clicking
        // a tab opened the FOLDER menu on the tab-icon span) and the view
        // toolbars. No row → no menu (default already suppressed above).
        if (!el.closest || !el.closest('li'))
            return;
        const row = el.closest('li');
        let menu;
        // Round-4 item 7: a search-history row (the recorded-query rows of
        // the upper search pane) is not a bookmark — its li carries no
        // bookmark id, so the bookmark menu's open/edit/delete entries would
        // act on a bogus id. Give the row its own minimal menu instead.
        const onHistoryRow = el.tagName === 'A'
            && el.dataset && typeof el.dataset.q !== 'undefined'
            && el.parentNode && el.parentNode.classList
            && el.parentNode.classList.contains('search-history-row');
        // v4 task-3 #16: a dupes GROUP HEAD is a span row, so the generic
        // branches below would open the folder menu on it — its entries act
        // on a bogus id. The group head gets its own menu instead: apply
        // dedup (label names keeper + doomed count, resolved live) and
        // expand/collapse (label follows the current state).
        const groupHead = el.closest('.group-head');
        // v4 task-4 #6: a palette CUSTOM command row is no bookmark/folder —
        // its slim menu (edit/delete) dispatches through ctx.paletteMenu
        // with the row's data-cc-id.
        if (row.classList && row.classList.contains('palette-command-custom')
            && $paletteCmdContextMenu && ctx.paletteMenu) {
            el = row;
            menu = $paletteCmdContextMenu;
        } else if (groupHead && groupHead.parentNode && groupHead.parentNode.classList
            && groupHead.parentNode.classList.contains('dupes-group')
            && $dupesGroupContextMenu && ctx.dupesMenu) {
            el = groupHead;
            menu = $dupesGroupContextMenu;
            const key = groupHead.parentNode.dataset.key;
            const hint = ctx.dupesMenu.cleanHint(key);
            const cleanItem = $('dupes-group-clean');
            cleanItem.textContent = hint;
            cleanItem.style.display = hint ? 'block' : 'none';
            const cleanSep = $('dupes-group-menu-sep1');
            if (cleanSep)
                cleanSep.style.display = hint ? 'block' : 'none';
            $('dupes-group-toggle').textContent =
                _m(ctx.dupesMenu.isCollapsed(key) ? 'dupesGroupExpand' : 'dupesGroupCollapse');
        // v4 task-3 #10: an UNBOOKMARKED stats-history row has no bookmark
        // id, so the bookmark menu would act on a bogus id (it used to be
        // swallowed at the list level). Its slim menu: open×3 via the row
        // href, bookmark-it via the row's own ☆ button.
        } else if (row.classList && row.classList.contains('stats-hist-row')
            && !(row.dataset && row.dataset.nodeId) && $histRowContextMenu) {
            const anchor = el.tagName === 'A' ? el : row.querySelector('a');
            if (!anchor)
                return;
            el = anchor;
            menu = $histRowContextMenu;
        } else if (onHistoryRow && $searchHistoryContextMenu) {
            menu = $searchHistoryContextMenu;
        } else if (el.tagName === 'A') {
            if (el.classList.contains('link-folder')) {
                // Folder link (search results / palette folder rows) — show
                // folder context menu. Root-level folder detection (hide-sort)
                // isn't needed here; these are never root folders. Every
                // root-disabled entry stays enabled (a non-root folder's
                // disabled classes from a previous root open must not linger).
                menu = $folderContextMenu;
                menu.classList.remove('hide-sort');
                setRootDisabled(false);
            } else if (el.querySelector('hr')) {
                menu = $separatorContextMenu;
                if (el.parentNode.dataset.parentid === '0') {
                    menu.classList.add('hide-editables');
                } else {
                    menu.classList.remove('hide-editables');
                }
            } else {
                menu = $bookmarkContextMenu;
                // v4 task-3 #11: outside the tree view the positional add-*
                // entries have no meaning (flat result lists have no
                // before/after), so the menu collapses to its flat form.
                // This subsumes switchBookmarkMenu's search-era hiding: a
                // results row is never a tree row. (Palette rows land here
                // too — same flat rule.)
                const inTree = el.parentNode.id.startsWith('neat-tree-item-');
                setPositionalItems(inTree);
                // v4 task-2: "Reveal in tree" only makes sense for rows that
                // live outside the tree view (recent list / search results);
                // on a tree row the entry would be a no-op, so hide it there.
                const revealItem = $('reveal-in-tree');
                if (revealItem) {
                    revealItem.style.display = inTree ? 'none' : 'block';
                    const revealSep = $('reveal-in-tree-sep');
                    if (revealSep)
                        revealSep.style.display = inTree ? 'none' : 'block';
                }
                // v4 task-2 slice C: dead/dupes view rows get their view-
                // specific entries — the mark toggle (label follows the
                // row's current mark state) and the dupes keeper pin. Both
                // APIs are injected lazily (view modules init after menus).
                const liId = el.parentNode.id || '';
                const markItem = $('dead-mark-toggle');
                if (markItem) {
                    const onDeadRow = liId.startsWith('dead-item-') && ctx.deadMenu;
                    markItem.style.display = onDeadRow ? 'block' : 'none';
                    if (onDeadRow) {
                        const marked = ctx.deadMenu.isMarked(rowId(el.parentNode));
                        markItem.textContent = _m(marked ? 'deadUnmark' : 'deadMark');
                    }
                }
                const keeperItem = $('dupes-set-keeper');
                if (keeperItem) {
                    const onDupesRow = liId.startsWith('dupes-item-') && ctx.dupesMenu;
                    keeperItem.style.display = onDupesRow ? 'block' : 'none';
                }
            }
        } else if (el.tagName === 'SPAN') {
            menu = $folderContextMenu;
            // Sorting applies to a folder's contents, never to the root
            // folders themselves (issue #33 excludes the bookmarks bar root).
            // Root folders (bookmarks bar / other bookmarks / mobile, whose
            // parent is the '0' pseudo-root) can ALSO not be deleted — Chrome
            // rejects removeTree on them — so the delete entry greys out
            // instead of acting on a call that can only fail.
            const isRoot = el.parentNode.dataset.parentid === '0';
            setRootDisabled(isRoot);
            if (isRoot) {
                menu.classList.add('hide-sort');
            } else {
                menu.classList.remove('hide-sort');
            }
        } else {
        }
        // issue #33: refresh the direct sort items' labels when the folder
        // menu is about to show (recursive suffix follows the sortOptions).
        if (menu === $folderContextMenu)
            updateSortLabels();
        if (menu) {
            currentContext = el;
            // Capture the owner row's identity NOW — a view re-render under
            // the open menu detaches the element and breaks its parentNode
            // chain, so the close-time refocusOwner could not find the list
            // or the replacement row otherwise.
            const ownerLi = el.closest ? el.closest('li') : null;
            ownerInfo = {
                liId: (ownerLi && ownerLi.id) || '',
                listEl: ownerLi && ownerLi.closest ? ownerLi.closest(LIST_SEL) : null
            };
            const active = body.querySelector('.active');
            if (active)
                active.classList.remove('active');
            el.classList.add('active');
            // Collapse the tab-group / sort blocks per the settings, then
            // position (clamped to the popup — issue #48) and show the menu.
            applyCollapseState(menu);
            positionMenu(menu, { left: e.pageX, top: e.pageY, clientY: e.clientY }, 'cursor');
            menu.focus();
        }
    });
    // on Mac, holding down right-click for a period of time closes the context menu
    // Not a complete implementation, but it works :)
    if (os === 'mac')
        body.addEventListener('mouseup', e => {
            if (e.button === 2 && macCloseContextMenu) {
                macCloseContextMenu = false;
                clearMenu();
            }
        });

    const bookmarkContextHandler = e => {
        e.stopPropagation();
        if (!currentContext)
            return;
        const actions = ctx.actions;
        const dialogs = ctx.dialogs;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        // A collapsed-group entry toggles its flyout instead of dispatching an
        // action; submenu items carry a `sub-` id prefix, normalized below.
        if (el.classList.contains('has-submenu')) {
            toggleSubmenuFor(el);
            return;
        }
        const caseId = el.id.replace(/^sub-/, '');
        const url = currentContext.href;
        const li = currentContext.parentNode;
        const id = rowId(li);
        // Capture the proposed group title BEFORE clearMenu — rowGroupTitle
        // reads currentContext, which the close nulls.
        const groupTitle = rowGroupTitle();
        // Close FIRST (the 4.0.1 menu focus law): focus returns to the
        // owning row before the action runs — a dialog the action opens then
        // captures the ROW as its invoker (not the hidden menu), and a view
        // re-render triggered by the action finds the row focused, so the
        // views' render-time focus park carries it across the innerHTML
        // swap. Closing last used to strand focus on the hidden menu or
        // yank it out of a just-opened dialog.
        clearMenu();
        switch (caseId) {
            // ++++++++ modified by windviki@gmail.com ++++++++
            // P3.4: open the bookmark as a one-tab tab group. The open
            // itself is handed to the service worker (vbm-tab-group-open-*)
            // so closing the popup cannot abort it.
            case 'bookmark-open-in-new-group': {
                actions.openBookmarksInGroup([url], groupTitle);
                break;
            }
            case 'bookmark-open-in-new-group-setup': {
                dialogs.GroupDialog.open({
                    title: groupTitle,
                    color: pickGroupColor(groupTitle),
                    onConfirm: (t, c) => actions.openBookmarksInGroup([url], t, c)
                });
                break;
            }
            case 'bookmark-open-in-existing-group': {
                chrome.tabGroups.query({}, groups => {
                    dialogs.GroupPickDialog.open({
                        groups: groups || [],
                        onPick: groupId => actions.openInExistingTabGroup([url], groupId)
                    });
                });
                break;
            }
            case 'add-bookmark-before-bookmark':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        const curTab = tabs[0];
                        actions.addNewBookmarkNode(id, 'before', curTab.url, curTab.title);
                    });
                break;
            case 'add-bookmark-after-bookmark':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        const curTab = tabs[0];
                        actions.addNewBookmarkNode(id, 'after', curTab.url, curTab.title);
                    });
                break;
            case 'add-folder-before-bookmark':
                actions.addNewBookmarkNode(id, 'before', '', '');
                break;
            case 'add-folder-after-bookmark':
                actions.addNewBookmarkNode(id, 'after', '', '');
                break;
            case 'add-separator':
                actions.addSeparator(id, 'after');
                break;
            case 'copy-title-and-url':
                actions.copyAllTitlesAndUrls(id);
                break;
            case 'replace-url':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        actions.replaceUrl(id, tabs[0].url);
                    });
                break;
            // ++++++++ end ++++++++
            case 'bookmark-new-tab':
                actions.openBookmarkNewTab(url);
                break;
            case 'bookmark-new-window':
                actions.openBookmarkNewWindow(url);
                break;
            case 'bookmark-new-incognito-window':
                actions.openBookmarkNewWindow(url, true);
                break;
            case 'reveal-in-tree':
                // v4 task-2: jump from a recent-list / search-results row to
                // the same bookmark inside the tree view.
                ctx.revealInTree(rowId(li));
                break;
            case 'dead-mark-toggle':
                // v4 task-2 slice C: dead-view row — flip its dead mark.
                ctx.deadMenu.toggle(rowId(li));
                break;
            case 'dupes-set-keeper':
                // v4 task-2 slice C: dupes-view row — pin it as the keeper.
                ctx.dupesMenu.setKeeper(rowId(li));
                break;
            case 'bookmark-edit': {
                actions.editBookmarkFolder(rowId(li));
            }
                break;
            case 'bookmark-delete': {
                actions.deleteBookmark(rowId(li));
            }
                break;
        }
    };
    // On Mac, all three mouse clicks work; on Windows, middle-click doesn't work
    $bookmarkContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            bookmarkContextHandler(e);
    });
    $bookmarkContextMenu.addEventListener('contextmenu', bookmarkContextHandler);
    $bookmarkContextMenu.addEventListener('click', e => {
        e.stopPropagation();
    });

    const folderContextHandler = e => {
        if (!currentContext)
            return;
        const actions = ctx.actions;
        const dialogs = ctx.dialogs;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        // Disabled entries (e.g. deleting a root folder) dispatch nothing —
        // the greyed item is visual state, and the action is impossible.
        if (el.classList.contains('disabled'))
            return;
        // A collapsed-group entry toggles its flyout instead of dispatching an
        // action; submenu items carry a `sub-` id prefix, normalized to their
        // parent-menu id below so the same switch handles both.
        if (el.classList.contains('has-submenu')) {
            toggleSubmenuFor(el);
            return;
        }
        const caseId = el.id.replace(/^sub-/, '');
        // P3.4: capture the proposed group title BEFORE scheduling getChildren.
        // clearMenu() below nulls currentContext, and the group cases run
        // inside the async callback — reading the title there would see null
        // and silently produce an untitled group.
        const groupTitle = rowGroupTitle();
        const li = currentContext.parentNode;
        const id = rowId(li);
        // Close FIRST (the 4.0.1 menu focus law — see the bookmark handler):
        // the owning row retakes focus before the async dispatch below opens
        // any dialog or triggers a re-render.
        clearMenu();
        chrome.bookmarks.getChildren(id, children => {
            // A deleted/ghost folder id makes getChildren call back with
            // undefined + lastError — guard so the map doesn't throw.
            children = children || [];
            // neatools' Array.map(c => c.url, children).clean(): urls of the
            // children that have one (folders have none, null/undefined dropped)
            const urls = children.map(c => c.url).filter(url => url != undefined);
            const urlsLen = urls.length;
            const noURLS = !urlsLen;
            switch (caseId) {
                // ++++++++ modified by windviki@gmail.com ++++++++
                case 'add-bookmark-top':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'top', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-bottom':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'bottom', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-before-folder':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'before', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-after-folder':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'after', curTab.url, curTab.title);
                        });
                    break;
                case 'add-folder-before-folder':
                    actions.addNewBookmarkNode(id, 'before', '', '');
                    break;
                case 'add-folder-after-folder':
                    actions.addNewBookmarkNode(id, 'after', '', '');
                    break;
                case 'add-new-folder':
                    actions.addNewBookmarkNode(id, 'top', '', '');
                    break;
                case 'add-folder-separator':
                    actions.addSeparator(id, 'after');
                    break;
                case 'copy-all-titles-and-urls':
                    actions.copyAllTitlesAndUrls(id);
                    break;
                // ++++++++ end ++++++++
                case 'folder-window':
                    if (noURLS)
                        return;
                    actions.openBookmarks(urls);
                    break;
                // P3.4: batch-open as a named tab group — one-click path
                // (folder name + deterministic color), named-setup path
                // (GroupDialog lets the user pick title + color) and the
                // existing-group path (GroupPickDialog lists the browser's
                // current tab groups). The open itself runs in the service
                // worker, so the popup closing cannot abort the grouping.
                case 'open-bookmarks-in-group': {
                    if (noURLS)
                        return;
                    actions.openBookmarksInGroup(urls, groupTitle);
                    break;
                }
                case 'open-bookmarks-in-group-setup': {
                    if (noURLS)
                        return;
                    dialogs.GroupDialog.open({
                        title: groupTitle,
                        color: pickGroupColor(groupTitle),
                        onConfirm: (t, c) => actions.openBookmarksInGroup(urls, t, c)
                    });
                    break;
                }
                case 'folder-open-in-existing-group': {
                    if (noURLS)
                        return;
                    chrome.tabGroups.query({}, groups => {
                        dialogs.GroupPickDialog.open({
                            groups: groups || [],
                            onPick: groupId => actions.openInExistingTabGroup(urls, groupId)
                        });
                    });
                    break;
                }
                case 'folder-new-window':
                    if (noURLS)
                        return;
                    actions.openBookmarksNewWindow(urls);
                    break;
                case 'folder-new-incognito-window':
                    if (noURLS)
                        return;
                    actions.openBookmarksNewWindow(urls, true);
                    break;
                case 'folder-edit':
                    actions.editBookmarkFolder(id);
                    break;
                case 'folder-delete':
                    actions.deleteBookmarks(id, urlsLen, children.length - urlsLen);
                    break;
                // issue #33: direct sort actions run with the persisted
                // sortOptions (foldersFirst/recursive), only the key flips.
                case 'sort-folder-by-name':
                    if (ctx.sortFolder)
                        ctx.sortFolder(id, { ...(ctx.sortOptions || {}), by: 'title' });
                    break;
                case 'sort-folder-by-date':
                    if (ctx.sortFolder)
                        ctx.sortFolder(id, { ...(ctx.sortOptions || {}), by: 'dateAdded' });
                    break;
                case 'sort-folder-contents':
                    if (dialogs && dialogs.SortDialog)
                        dialogs.SortDialog.open(id);
                    break;
            }
        });
    };
    $folderContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            folderContextHandler(e);
    });
    $folderContextMenu.addEventListener('contextmenu', folderContextHandler);
    $folderContextMenu.addEventListener('click', e => {
        e.stopPropagation();
    });

    // ── collapsed-group entries + flyouts (issue #48 follow-up) ──────
    // Entry labels are set here (not neat.js's table): they only need the ▸
    // indicator, and binding via _m() classifies these keys as menu items for
    // the i18n length gate. The flyouts dispatch through the parent handlers
    // (a `sub-` id prefix is normalized at dispatch time). Hover on the parent
    // menu opens an entry's flyout and closes it over a plain item; entering
    // the flyout — a body-level sibling — never fires the parent's mouseover,
    // so the move into it can't wrongly close it.
    const entryLabel = e => { if (e) e.textContent = _m(e.id === 'folder-sort-collapse' ? 'sortMenuOptions' : 'tabGroupOptions'); };
    entryLabel($('folder-tab-group-collapse'));
    entryLabel($('folder-sort-collapse'));
    entryLabel($('bookmark-tab-group-collapse'));
    const bindSubmenu = (sub, handler) => {
        if (!sub)
            return;
        sub.addEventListener('mouseup', e => {
            e.stopPropagation();
            if (e.button === 0 || (os === 'mac' && e.button === 1))
                handler(e);
        });
        sub.addEventListener('contextmenu', handler);
        sub.addEventListener('click', e => { e.stopPropagation(); });
    };
    bindSubmenu($folderTabGroupSubmenu, folderContextHandler);
    bindSubmenu($folderSortSubmenu, folderContextHandler);
    bindSubmenu($bookmarkTabGroupSubmenu, bookmarkContextHandler);
    const bindSubmenuHover = menu => {
        menu.addEventListener('mouseover', e => {
            const t = e.target;
            if (!t || !t.classList || !t.classList.contains('menu-item'))
                return;
            if (t.classList.contains('has-submenu'))
                openSubmenuFor(t);
            else
                closeSubmenu(false);
        });
    };
    bindSubmenuHover($folderContextMenu);
    bindSubmenuHover($bookmarkContextMenu);


    const separatorContextHandler = e => {
        if (!currentContext)
            return;
        const actions = ctx.actions;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        const li = currentContext.parentNode;
        const id = rowId(li);
        // Close FIRST (the 4.0.1 menu focus law — see the bookmark handler).
        clearMenu();
        switch (el.id) {
            case 'remove-separator':
                actions.deleteSeparator(id);
                break;
        }
    };
    $separatorContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            separatorContextHandler(e);
    });
    $separatorContextMenu.addEventListener('contextmenu', separatorContextHandler);

    // Round-4 item 7: the search-history menu. Dispatch reuses the history
    // area's own click affordances — search.js's delegated handlers own the
    // rerun / removal / clear-all logic, so this module needs no search API
    // (the same decoupling as the #results lookup described in the header).
    if ($searchHistoryContextMenu) {
        // neat.js's id→message map predates this menu, so the labels are
        // assigned here (same _m helper; searchHistoryRerun is a new key,
        // with a fallback while the locale files catch up).
        $('search-history-menu-rerun').textContent = _m('searchHistoryRerun') || 'Search again';
        $('search-history-menu-remove').textContent = _m('searchHistoryRemove');
        $('search-history-menu-clear').textContent = _m('searchHistoryClear');
    }
    const searchHistoryContextHandler = e => {
        if (!currentContext)
            return;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        // Close FIRST (menu focus law); the dispatch below rides the
        // captured row — currentContext is null after clearMenu().
        const row = currentContext;
        clearMenu();
        switch (el.id) {
            case 'search-history-menu-rerun':
                // Activating the row anchor reruns its query.
                row.click();
                break;
            case 'search-history-menu-remove': {
                // The row may have been re-rendered away since the menu opened
                // (row then has no parentNode) — a stale-row click
                // must not crash on a null querySelector.
                const removeBtn = row.parentNode &&
                    row.parentNode.querySelector('.search-history-remove');
                if (removeBtn)
                    removeBtn.click();
                break;
            }
            case 'search-history-menu-clear': {
                const clearBtn = $('search-history-clear');
                if (clearBtn)
                    clearBtn.click();
                break;
            }
        }
    };
    if ($searchHistoryContextMenu) {
        $searchHistoryContextMenu.addEventListener('mouseup', e => {
            e.stopPropagation();
            if (e.button === 0 || (os === 'mac' && e.button === 1))
                searchHistoryContextHandler(e);
        });
        $searchHistoryContextMenu.addEventListener('contextmenu', searchHistoryContextHandler);
    }

    // v4 task-3 #10: the slim menu for unbookmarked stats-history rows.
    // Open×3 ride the shared actions on the row href; bookmark-it clicks
    // the row's own ☆ button, so view-stats keeps owning the add logic
    // (the same decoupling as the search-history dispatch above).
    if ($histRowContextMenu) {
        $('hist-open-new-tab').textContent = _m('openNewTab');
        $('hist-open-new-window').textContent = _m('openNewWindow');
        $('hist-open-incognito').textContent = _m('openIncognitoWindow');
        $('hist-add-bookmark').textContent = _m('statsHistoryAdd');
    }
    const histRowContextHandler = e => {
        if (!currentContext)
            return;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        const actions = ctx.actions;
        // Close FIRST (menu focus law); the dispatch rides the captured row.
        const row = currentContext;
        const url = row.href;
        clearMenu();
        switch (el.id) {
            case 'hist-open-new-tab':
                actions.openBookmarkNewTab(url);
                break;
            case 'hist-open-new-window':
                actions.openBookmarkNewWindow(url);
                break;
            case 'hist-open-incognito':
                actions.openBookmarkNewWindow(url, true);
                break;
            case 'hist-add-bookmark': {
                // Same stale-row guard as the search-history remove entry: a
                // re-rendered list can leave the captured row detached.
                const addBtn = row.parentNode &&
                    row.parentNode.querySelector('.stats-add-btn');
                if (addBtn)
                    addBtn.click();
                break;
            }
        }
    };
    if ($histRowContextMenu) {
        $histRowContextMenu.addEventListener('mouseup', e => {
            e.stopPropagation();
            if (e.button === 0 || (os === 'mac' && e.button === 1))
                histRowContextHandler(e);
        });
        $histRowContextMenu.addEventListener('contextmenu', histRowContextHandler);
    }

    // v4 task-3 #16: the dupes group-head menu. currentContext is the
    // group-head span; its parent li carries data-key. Labels are resolved
    // at open time (they name the keeper / follow the collapsed state).
    const dupesGroupContextHandler = e => {
        if (!currentContext)
            return;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        const key = currentContext.parentNode.dataset.key;
        // Close FIRST (menu focus law): the group-head span retakes focus
        // before clean/toggle re-renders the dupes list.
        clearMenu();
        switch (el.id) {
            case 'dupes-group-clean':
                ctx.dupesMenu.cleanGroup(key);
                break;
            case 'dupes-group-toggle':
                ctx.dupesMenu.toggleGroup(key);
                break;
        }
    };
    if ($dupesGroupContextMenu) {
        $dupesGroupContextMenu.addEventListener('mouseup', e => {
            e.stopPropagation();
            if (e.button === 0 || (os === 'mac' && e.button === 1))
                dupesGroupContextHandler(e);
        });
        $dupesGroupContextMenu.addEventListener('contextmenu', dupesGroupContextHandler);
    }

    // v4 task-4 #6: the palette custom-command row menu. currentContext is
    // the row li (it carries data-cc-id); the dispatch rides palette.js's
    // customMenu (lazy getter on neat.js's ctx — palette inits after menus).
    if ($paletteCmdContextMenu) {
        $('palette-cmd-edit').textContent = _m('edit');
        $('palette-cmd-delete').textContent = _m('delete');
    }
    const paletteCmdContextHandler = e => {
        if (!currentContext)
            return;
        const el = e.target;
        if (!el.classList.contains('menu-item'))
            return;
        // Close FIRST (menu focus law): focus returns to the palette input
        // (refocusOwner's palette branch) before edit/remove opens a dialog
        // or re-renders the result list.
        const id = currentContext.dataset && currentContext.dataset.ccId;
        clearMenu();
        if (!id || !ctx.paletteMenu)
            return;
        switch (el.id) {
            case 'palette-cmd-edit':
                ctx.paletteMenu.edit(id);
                break;
            case 'palette-cmd-delete':
                ctx.paletteMenu.remove(id);
                break;
        }
    };
    if ($paletteCmdContextMenu) {
        $paletteCmdContextMenu.addEventListener('mouseup', e => {
            e.stopPropagation();
            if (e.button === 0 || (os === 'mac' && e.button === 1))
                paletteCmdContextHandler(e);
        });
        $paletteCmdContextMenu.addEventListener('contextmenu', paletteCmdContextHandler);
    }

    // v4 task-3 #11: the positional add-* entries + their separators, as one
    // set — hidden for every row outside the tree view (open-time flat rule)
    // and by switchBookmarkMenu (search.js's search-active toggle, kept for
    // compatibility; the open-time rule already covers its case).
    const POSITIONAL_IDS = [
        'add-bookmark-before-bookmark', 'add-bookmark-after-bookmark',
        'bookmark-context-menu-sep1', 'add-folder-before-bookmark',
        'add-folder-after-bookmark', 'bookmark-context-menu-sep2',
        'add-separator', 'bookmark-context-menu-sep3'
    ];
    const setPositionalItems = visible => {
        for (let i = 0; i < POSITIONAL_IDS.length; i++) {
            const item = $(POSITIONAL_IDS[i]);
            if (item)
                item.style.display = visible ? 'block' : 'none';
        }
    };

    const switchBookmarkMenu = disable => setPositionalItems(!disable);

    return {
        clearMenu,
        // Cancel semantics for the keyboard layer (←-back / Esc): marker off,
        // focus back to the owning row, all menus hidden.
        closeMenu,
        switchBookmarkMenu,
        // The keyboard/mouse bindings that stay in neat.js
        // (contextKeyDown/contextMouseMove/contextMouseOut) attach through
        // these element references.
        bookmarkMenu: $bookmarkContextMenu,
        folderMenu: $folderContextMenu,
        separatorMenu: $separatorContextMenu,
        // fourth-round item 7: dedicated menu for search-history rows; may be
        // absent in minimal test setups, so consumers must null-check
        searchHistoryMenu: $searchHistoryContextMenu || null,
        // v4 task-3 #10/#16: same null-check contract as searchHistoryMenu
        histRowMenu: $histRowContextMenu || null,
        dupesGroupMenu: $dupesGroupContextMenu || null,
        // v4 task-4 #6: palette custom-command row menu
        paletteCmdMenu: $paletteCmdContextMenu || null,
        // issue #48 follow-up: the collapsed-group flyouts (may be absent in
        // minimal test setups — consumers null-check) and their open/close API
        // (used by the keyboard layer for →/←/Enter and the two-level Esc).
        folderTabGroupSubmenu: $folderTabGroupSubmenu || null,
        folderSortSubmenu: $folderSortSubmenu || null,
        bookmarkTabGroupSubmenu: $bookmarkTabGroupSubmenu || null,
        openSubmenuFor, closeSubmenu, toggleSubmenuFor, submenuOpen
    };
}
