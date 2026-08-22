/**
 * Tree view layer (P1 module extracted from neat.js, slice 8b — the state +
 * behavior half of the tree view; the pure rendering/data half lives in
 * src/tree-render.js, slice 8a).
 *
 * Owns: the tree-view state (the nodeTrees parent map and the onlyShowBMBar
 * startup flag, plus the v4 task-3 #14 session-only show-all override), generateTree (subtree selection incl. onlyShowBMBar, the
 * search-index refresh, the sync-indicator refresh, scroll/focus restore and
 * the legacy local-separator migration) plus the startup
 * chrome.bookmarks.getTree call, the four tree event handlers (scroll
 * persistence, focus tracking with focusID, folder expand/collapse incl. lazy
 * child loading + closeUnusedFolders sibling collapse + opens persistence,
 * middle-click focus forcing), generateTreeForTarget (the search-result jump
 * scroll handler) and bookmarkHandler (bookmark/folder open dispatch on
 * click/auxclick for the tree, the search results pane and — bound by
 * src/view-recent.js — the recent view's list). The virtual "recently added"
 * section moved out to src/view-recent.js in v4 task-2 (slice B).
 *
 * initTreeView(ctx) is called once by neat.js right after actions/dnd init —
 * menus/search/dialogs/actions/dnd are all ready by then, so everything is
 * passed as a plain value (no lazy getters). refreshSyncIndicators is a
 * hoisted function declaration in neat.js (sync-ui 尚未剥离) and
 * SeparatorManager an imported class there, so both arrive via ctx too.
 * ctx.store                 — settings store
 * ctx.tree                  — the #tree element (all tree event bindings)
 * ctx.SeparatorManager      — class, for the legacy local-separator migration
 * ctx.treeRender            — tree-render.js API (generateHTML & co.)
 * ctx.search                — search.js API (quit/reset/results)
 * ctx.actions               — actions.js API (the open* calls + addSeparator)
 * ctx.dnd                   — dnd.js API (consumeNoOpen swallows post-drag click)
 * ctx.refreshSyncIndicators — neat.js's sync UI refresh (called via setTimeout)
 * ctx.getOpens()            — current expanded-folder id array (shared channel
 *                             with treeRender's getter; the view only writes)
 * ctx.getRememberState()    — current remember-state flag (read per call)
 * ctx.setOpens(arr)         — replace the expanded-folder id array (neat.js state)
 * ctx.setRememberState(b)   — set the remember-state flag (neat.js state)
 * ctx.middleClickBgTab      — middle-click opens a background tab when true
 * ctx.leftClickNewTab       — left-click opens a new tab when true
 * ctx.onOpenBookmark(id,url) — v4 task-2 slice D: optional hook fired on every
 *                             bookmark open (the visit-stats collection point;
 *                             slice E: the url feeds the SW dedupe marker)
 * ctx.toastAction(message, buttonLabel, onAction) — v4 task-3 #14: optional
 *                             generic action toast (neat.js passes
 *                             undo.toastAction); revealInTree uses it when the
 *                             target sits outside an onlyShowBMBar-filtered
 *                             tree. Missing → the guard silently falls back
 *                             to the plain reveal (minimal setups).
 *
 * Returns { generateTree, adaptBookmarkTooltips, revealFolder, revealInTree,
 * bookmarkHandler }: neat.js's sortFolderContents rebuilds via
 * treeView.generateTree, the resizer re-fits tooltips via
 * treeView.adaptBookmarkTooltips, the command palette (P2) jumps to a folder
 * via treeView.revealFolder (the search-result link-folder branch of
 * bookmarkHandler runs the same chain), and src/view-recent.js binds its
 * list clicks to treeView.bookmarkHandler and its R key to
 * treeView.revealInTree.
 * chrome.bookmarks.*, chrome.i18n.getMessage, document and setTimeout remain
 * page globals. No neatools helpers: hasClass/addClass/removeClass/toggleClass
 * → classList.* (the removeClass('open').setAttribute(...) chain became two
 * statements), inject → appendChild, destroy → remove, $ →
 * document.getElementById, Array.map(fn, list) → Array.from(list).map(fn),
 * Array.prototype.clean → filter(Boolean), getSiblings('li') → an
 * Array.from(children).filter (neatools' getSiblings ignored its selector
 * argument anyway), String.prototype.htmlspecialchars became the
 * module-private pure function below (same implementation as tree-render.js's).
 */

import { parkRowFocus, unparkRowFocus } from './list-focus.js';

export function initTreeView(ctx = {}) {
    const store = ctx.store;
    const $tree = ctx.tree;
    const SeparatorManager = ctx.SeparatorManager;
    const treeRender = ctx.treeRender;
    const search = ctx.search;
    const actions = ctx.actions;
    const dnd = ctx.dnd;
    const refreshSyncIndicators = ctx.refreshSyncIndicators;
    const getRememberState = ctx.getRememberState;
    const setOpens = ctx.setOpens;
    const setRememberState = ctx.setRememberState;
    const middleClickBgTab = ctx.middleClickBgTab;
    const leftClickNewTab = ctx.leftClickNewTab;
    // v4 task-2 §3.6: optional hook receiving the full bookmark tree on every
    // generateTree — neat.js feeds it to view-manager.buildPathMap.
    const onTreeGenerated = ctx.onTreeGenerated;
    // 第五轮项3: the lazy folder-expand below renders NEW rows (getChildren +
    // appendChild) outside generateTree — neat.js re-lays the dead-mark ×
    // overlays on them through this hook (default no-op for minimal setups).
    const onRowsRendered = ctx.onRowsRendered || (() => {});
    // v4 task-2: view-manager API — revealInTree activates the tree view
    // (optional so minimal test setups keep working).
    const views = ctx.views;
    // v4 task-3 #14: generic action toast (undo.toastAction in neat.js).
    const toastAction = ctx.toastAction;

    // 树视图状态：folder id -> parent id 映射（每次 generateTree 重建）与
    // onlyShowBMBar 启动开关（只有 generateTree 读取）。
    const nodeTrees = {};
    const onlyShowBMBar = !!store.get('onlyShowBMBar');
    // v4 task-3 #14: session-only override set by the reveal hint's toast
    // action — the tree shows the FULL tree until the page unloads; the
    // onlyShowBMBar setting itself is never touched.
    let showAllOverride = false;

    // Round-4 item 4: generateNodeTrees maps folders only, so a bookmark id
    // never resolved an ancestor chain in revealFolder — "在树中定位" opened
    // nothing and the target row was never rendered. generateTree therefore
    // adds the bookmark parents to the same map and records the bookmark
    // ids, so revealFolder can resolve (and trim) a bookmark's path too.
    const bookmarkIds = new Set();
    const addBookmarkParents = nodes => {
        for (let i = 0, l = nodes.length; i < l; i++) {
            const d = nodes[i];
            if (d.url) {
                nodeTrees[d.id] = d.parentId;
                bookmarkIds.add(`${d.id}`);
            }
            if (d.children)
                addBookmarkParents(d.children);
        }
    };

    // Adaptive bookmark tooltips
    const adaptBookmarkTooltips = () => {
        const bookmarks = document.querySelectorAll('li.child a');
        for (let i = 0, l = bookmarks.length; i < l; i++) {
            const bookmark = bookmarks[i];
            if (bookmark.querySelector('hr')) {
                bookmark.title = '';
            } else {
                if (bookmark.classList.contains('titled')) {
                    if (bookmark.scrollWidth <= bookmark.offsetWidth) {
                        bookmark.title = bookmark.href;
                        bookmark.classList.remove('titled');
                    }
                } else if (bookmark.scrollWidth > bookmark.offsetWidth) {
                    const text = bookmark.querySelector('i').textContent;
                    const title = bookmark.title;
                    if (text !== title) {
                        bookmark.title = `${text}\n${title}`;
                        bookmark.classList.add('titled');
                    }
                }
            }
        }
    };

    const generateTree = tree => {
        let subTree;
        if (onlyShowBMBar && !showAllOverride) {
            // Find the bookmarks bar folder using folderType instead of fixed position
            const bookmarksBarFolder = treeRender.findFolderByType(tree, 'bookmarks-bar');
            if (bookmarksBarFolder) {
                subTree = bookmarksBarFolder.children || [];
            } else {
                // Fallback to old logic if folderType not available
                subTree = tree[0].children[0].children;
            }
        } else {
            // Use getEffectiveSubTree to handle dual-storage Chrome
            subTree = treeRender.getEffectiveSubTree(tree);
        }
        const html = treeRender.generateHTML(subTree);
        treeRender.generateNodeTrees(subTree, nodeTrees);
        addBookmarkParents(subTree);

        // 4.0.1 focus law: the innerHTML swap below replaces every row, so a
        // focused row would drop to <body> and the ↓ walk would die. Park it
        // before the swap, restore after — unconditionally: by row id when
        // the bookmark survives, else the clamped index of the row that took
        // its place.
        const parked = parkRowFocus($tree);
        $tree.innerHTML = html;

        // v4 task-2 §3.6: the view layer rebuilds its shared id→parent-path
        // map from the same full tree (list-row path labels). AFTER the
        // innerHTML swap — the hook also re-lays DOM overlays (slice C's
        // dead-mark ×, 第五轮项3), which the swap itself just wiped.
        if (onTreeGenerated)
            onTreeGenerated(tree);

        // Refresh sync indicators after tree is generated
        if (store.getSyncSetting('showSyncStatus', 'true') === 'true') {
            setTimeout(() => {
                refreshSyncIndicators();
            }, 100);
        }

        if (getRememberState()) {
            $tree.scrollTop = store.get('scrollTop') ? store.get('scrollTop') : 0;
        }
        // after the scroll baseline is back, so focus() only scrolls the
        // minimal distance to reveal the restored row.
        unparkRowFocus($tree, parked);

        // issue #58: the focusID restore (refocus + .focus highlight-flash,
        // which re-paints the last-focused row on every open) is part of
        // "remember previous state" — gate it with the rest so the existing
        // remember-prev-state option turns the whole restore off (scroll,
        // opened folders AND the focus highlight), instead of only the first
        // two. revealFolder/revealInTree force rememberState=true on purpose,
        // so explicit "reveal in tree" keeps working with the option off.
        if (getRememberState()) {
            const focusID = store.get('focusID');
            // The park/restore law above may already have re-focused a live
            // row. The reveal treatment (width/overflow + .focus flash) is
            // for the reopen case — skip it when the restored row IS the
            // focusID row; a DIFFERENT focusID means an explicit reveal
            // (revealFolder ran while a tree row still held focus) and wins.
            const parkedId = parked ? `${parked.id || ''}`.replace('neat-tree-item-', '') : '';
            if (typeof focusID !== 'undefined' && focusID !== null && `${focusID}` !== parkedId) {
                const focusEl = document.getElementById(`neat-tree-item-${focusID}`);
                if (focusEl) {
                    const oriOverflow = $tree.style.overflow;
                    $tree.style.overflow = 'hidden';
                    focusEl.style.width = '100%';
                    const focusTarget = focusEl.firstElementChild;
                    // A row without a focusable child (detached/mid-render) has
                    // no reveal target — skip the highlight; the cleanup timers
                    // below still run.
                    if (focusTarget) {
                        focusTarget.classList.add('focus');
                        // The blueFade class only paints the reveal highlight — the
                        // row must ALSO take keyboard focus, or an "reveal in tree"
                        // from another view strands the user with no way to continue
                        // (arrow keys do nothing until they click). The tree rows are
                        // tabindex="-1"; a programmatic focus() here is what makes
                        // ArrowUp/Down/Right walk on from the revealed row. The focus
                        // listener removes the .focus class on its event — re-apply it
                        // after focus() so the reveal highlight is not wiped by the
                        // very focus we just granted.
                        if (focusTarget.focus)
                            focusTarget.focus();
                        focusTarget.classList.add('focus');
                    }
                    setTimeout(() => {
                        $tree.style.overflow = oriOverflow;
                    }, 1);
                    setTimeout(() => {
                        store.remove('focusID');
                    }, 4000);
                }
            }
        }

        setTimeout(adaptBookmarkTooltips, 100);

        // try to load local separator list used in last version
        const sm = new SeparatorManager(store);
        sm.load();
        const seps = sm.getAll();
        for (let i = 0; i < seps.length; i++) {
            if (seps[i]) {
                actions.addSeparator(seps[i], 'after');
            }
        }
        // and discard this setting from now on
        sm.clear();
        sm.save();

        tree = null;
    };

    // 启动时生成整棵树（8b 起随本模块一并剥离）
    chrome.bookmarks.getTree(generateTree);

    // Events for the tree
    $tree.addEventListener('scroll', () => {
        store.set('scrollTop', $tree.scrollTop);
    });
    $tree.addEventListener('focus', e => {
        const el = e.target;
        const tagName = el.tagName;
        const focusEl = $tree.querySelector('.focus');
        if (focusEl)
            focusEl.classList.remove('focus');
        if (tagName === 'A' || tagName === 'SPAN') {
            store.set('focusID', el.parentNode.id.replace('neat-tree-item-', ''));
        } else {
            store.set('focusID', null);
        }
    }, true);
    const closeUnusedFolders = store.get('closeUnusedFolders');
    $tree.addEventListener('click', e => {
        if (e.button !== 0)
            return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName !== 'SPAN')
            return;
        if (e.shiftKey || e.ctrlKey)
            return;
        const parent = el.parentNode;
        parent.classList.toggle('open');
        const expanded = parent.classList.contains('open');
        parent.setAttribute('aria-expanded', expanded);
        const children = parent.querySelector('ul');
        // expand children for unexpanded folder node
        if (!children) {
            const id = parent.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id, children => {
                // A stale row (folder deleted/synced away meanwhile) makes
                // getChildren fail — read lastError so Chrome doesn't surface
                // the "Bookmark id is invalid" warning, then skip silently.
                if (chrome.runtime.lastError)
                    return;
                // same undefined-guard as bookmarkHandler's folder branch
                children = children || [];
                const html = treeRender.generateHTML(children, parseInt(parent.parentNode.dataset.level) + 1);
                const div = document.createElement('div');
                div.innerHTML = html;
                const ul = div.querySelector('ul');
                parent.appendChild(ul);
                div.remove();
                onRowsRendered(); // 第五轮项3: overlays for the fresh rows
                setTimeout(adaptBookmarkTooltips, 100);
            });
        }
        if (closeUnusedFolders && expanded) {
            // neatools 的 getSiblings 忽略其选择器实参、返回全部元素兄弟
            // （先后再前）；此循环与顺序无关，且 ul 的子元素本就全是 li。
            const siblings = Array.from(parent.parentNode.children).filter(sib => sib !== parent && sib.tagName === 'LI');
            for (let i = 0, l = siblings.length; i < l; i++) {
                const li = siblings[i];
                if (li.classList.contains('parent')) {
                    li.classList.remove('open');
                    li.setAttribute('aria-expanded', false);
                }
            }
        }
        // 局部变量：展开状态只持久化到 store；内存里的 opens（generateHTML
        // 经 getOpens 读取）保持启动时的值，与原实现一致。
        let opens = $tree.querySelectorAll('li.open');
        opens = Array.from(opens).map(li => li.id.replace('neat-tree-item-', ''));
        store.set('opens', JSON.stringify(opens));
    });
    // Force middle clicks to trigger the focus event
    $tree.addEventListener('mouseup', e => {
        if (e.button !== 1)
            return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName !== 'A' && tagName !== 'SPAN')
            return;
        el.focus();
    });

    function generateTreeForTarget(trees) {
        generateTree(trees);
        // This must be put int chrome API handler function.
        // Otherwise it may be called before generation completed.
        if (store.get('focusID')) {
            const item = $tree.querySelector(`#neat-tree-item-${store.get('focusID')}`);
            if (item) {
                item.scrollIntoView();
            }
        }
        store.set('scrollTop', $tree.scrollTop);
    }

    // Reveal a folder in the tree: quit search, open its ancestor chain,
    // force remember-state recovery, focus it and rebuild with the scroll
    // handler. Extracted from bookmarkHandler's link-folder branch (P2) so the
    // command palette's "jump to folder" can reuse the exact same sequence.
    const revealFolder = id => {
        // switch to tree
        search.quit();
        // all parent folder ids
        // set them as opened folders
        let newOpens = treeRender.getParentPath(id, nodeTrees);
        // A bookmark's path ends with the bookmark itself — drop it: the
        // opens list may only hold folders (a bookmark row has no children
        // to expand, and li.open rows get persisted back into opens).
        if (bookmarkIds.has(`${id}`))
            newOpens = newOpens.slice(0, -1);
        setOpens(newOpens);
        store.set('opens', JSON.stringify(newOpens));
        // force to recover from remember state (opened folders)
        setRememberState(true);
        // focus on the target folder
        store.set('focusID', id);
        // new handler to handle the scrolling
        chrome.bookmarks.getTree(generateTreeForTarget);
    };

    // v4 task-2 (docs/plan-4.0.0/v4task-2-list.md §2.3): "Reveal in tree" from any list
    // view (recent/search R key + context-menu item) — activate the tree
    // view, then run the same reveal chain (works for bookmark ids too: the
    // row is focused via focusID, its ancestors opened).
    const revealInTree = id => {
        // v4 task-3 #14: with "only show the bookmarks bar" on, a target
        // outside the bar subtree has no nodeTrees entry at all — the old
        // chain then silently revealed nothing (getParentPath degenerated to
        // the bare id, the row never rendered). Instead of quietly failing,
        // explain via toast and offer a one-click, session-only override
        // that shows the full tree and completes the reveal. The user stays
        // in the current view until they explicitly pick the action.
        if (onlyShowBMBar && !showAllOverride && nodeTrees[id] === undefined && toastAction) {
            toastAction(
                chrome.i18n.getMessage('revealOutsideBarHint'),
                chrome.i18n.getMessage('revealOutsideBarAction'),
                () => {
                    showAllOverride = true;
                    // nodeTrees still maps the bar-only render — regenerate
                    // over the full tree first so revealFolder's
                    // getParentPath resolves the real ancestor chain.
                    chrome.bookmarks.getTree(tree => {
                        generateTree(tree);
                        revealFolder(id);
                        if (views)
                            views.activate('tree', { keepFocus: true });
                    });
                });
            return;
        }
        revealFolder(id);
        if (views)
            views.activate('tree', { keepFocus: true });
    };

    const bookmarkHandler = e => {
        e.preventDefault();
        if (e.button !== 0 && e.button !== 1)
            return;
        // only take left-click
        // noOpenBookmark 已收归 src/dnd.js：拖拽落点无效时吞掉随后的点击
        if (dnd.consumeNoOpen()) // flag that disables opening bookmark
            return;
        const el = e.target;
        const ctrlMeta = (e.ctrlKey || e.metaKey || (e.button === 1));
        const shift = e.shiftKey;
        if (el.tagName === 'A' && !el.querySelector('hr')) { // bookmark
            // Search-result / palette folder rows carry `link-folder tree-item-link`
            // — a classList membership test, never an exact className match
            // (the exact match silently fell through to the bookmark-open
            // branch and opened the popup page's own URL in a new tab).
            if (el.classList.contains('link-folder')) { // search result folder
                // get folder id (el parent is li); data-node-id is the
                // v4 task-2 unified row id
                const id = el.parentNode.dataset.nodeId
                    || el.parentNode.id.replace(/(neat-tree|neat-recent|results|recent)-item-/, '');
                revealInTree(id);
            } else {
                const url = el.href;
                // v4 task-2 slice D (§5.4): every bookmark open — mouse,
                // middle-click or the keyboard's synthetic click — funnels
                // through here, so this single hook is the page-side visit
                // collector. data-node-id is the unified row id; the legacy
                // prefix strip covers rows that predate it.
                if (ctx.onOpenBookmark) {
                    const openId = el.parentNode.dataset.nodeId
                        || el.parentNode.id.replace(/(neat-tree|neat-recent|results|recent|dead|dupes|stats)-item-/, '');
                    ctx.onOpenBookmark(openId, url);
                }
                if (ctrlMeta) { // ctrl/meta click
                    actions.openBookmarkNewTab(url, middleClickBgTab ? shift : !shift);
                } else { // click
                    if (shift) {
                        actions.openBookmarkNewWindow(url);
                    } else {
                        leftClickNewTab ? actions.openBookmarkNewTab(url, true, true) : actions.openBookmark(url);
                    }
                }
                search.reset();
            }
        } else if (el.tagName === 'SPAN') { // folder
            const li = el.parentNode;
            const id = li.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id, children => {
                // A stale/ghost row (folder deleted meanwhile, or an id that
                // never resolves) makes getChildren call back with undefined
                // + lastError — read lastError to keep Chrome from surfacing
                // the "Bookmark id is invalid" warning, then guard the map.
                if (chrome.runtime.lastError)
                    return;
                const urls = (children || []).map(c => c.url).filter(Boolean);
                const urlsLen = urls.length;
                if (!urlsLen)
                    return;
                if (ctrlMeta) { // ctrl/meta click
                    actions.openBookmarks(urls, middleClickBgTab ? shift : !shift);
                } else if (shift) { // shift click
                    actions.openBookmarksNewWindow(urls);
                }
            });
        }
    };
    $tree.addEventListener('click', bookmarkHandler);
    search.results.addEventListener('click', bookmarkHandler);
    $tree.addEventListener('auxclick', bookmarkHandler);
    // Middle-click parity on the search results pane (the click-only binding
    // above was a legacy gap): auxclick with button 1 opens in a tab like a
    // ctrl-click, per bookmarkHandler's own modifier mapping.
    search.results.addEventListener('auxclick', bookmarkHandler);

    return {
        generateTree,
        adaptBookmarkTooltips,
        revealFolder,
        revealInTree,
        // bound per list container: tree above, search results above, and the
        // recent view's list (src/view-recent.js)
        bookmarkHandler
    };
}
