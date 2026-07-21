/**
 * Tree view layer (P1 module extracted from neat.js, slice 8b — the state +
 * behavior half of the tree view; the pure rendering/data half lives in
 * src/tree-render.js, slice 8a).
 *
 * Owns: the tree-view state (the nodeTrees parent map and the onlyShowBMBar
 * startup flag), generateTree (subtree selection incl. onlyShowBMBar, the
 * search-index refresh, the recent-section mount, the sync-indicator refresh,
 * scroll/focus restore and the legacy local-separator migration) plus the
 * startup chrome.bookmarks.getTree call, the four tree event handlers (scroll
 * persistence, focus tracking with focusID, folder expand/collapse incl. lazy
 * child loading + closeUnusedFolders sibling collapse + opens persistence,
 * middle-click focus forcing), generateTreeForTarget (the search-result jump
 * scroll handler), bookmarkHandler (bookmark/folder open dispatch on
 * click/auxclick for both the tree and the search results pane) and the
 * virtual "recently added" section (generateRecentSectionHTML /
 * refreshRecentSection / debounced scheduleRecentRefresh on
 * chrome.bookmarks.onCreated/onRemoved).
 *
 * initTreeView(ctx) is called once by neat.js right after actions/dnd init —
 * menus/search/dialogs/actions/dnd are all ready by then, so everything is
 * passed as a plain value (no lazy getters). refreshSyncIndicators is a
 * hoisted function declaration in neat.js (sync-ui 尚未剥离) and
 * SeparatorManager an imported class there, so both arrive via ctx too.
 * ctx.store                 — settings store
 * ctx.tree                  — the #tree element (all tree event bindings)
 * ctx.separatorManager      — separator filtering in refreshRecentSection
 * ctx.SeparatorManager      — class, for the legacy local-separator migration
 * ctx.treeRender            — tree-render.js API (generateHTML & co.)
 * ctx.search                — search.js API (updateIndex/quit/reset/results)
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
 *
 * Returns { generateTree, adaptBookmarkTooltips, revealFolder }: neat.js's
 * sortFolderContents rebuilds via treeView.generateTree, the resizer re-fits
 * tooltips via treeView.adaptBookmarkTooltips, and the command palette (P2)
 * jumps to a folder via treeView.revealFolder (the search-result link-folder
 * branch of bookmarkHandler runs the same function).
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

// neatools' String.prototype.htmlspecialchars as a pure function: escape
// >, then <, then " (order matters, ">" first so "&gt;" is not re-escaped).
// tree-render.js 内有同款实现（模块各自私有，不交叉引用）。
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function initTreeView(ctx = {}) {
    const store = ctx.store;
    const $tree = ctx.tree;
    const separatorManager = ctx.separatorManager;
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
    const _m = chrome.i18n.getMessage;

    // 树视图状态：folder id -> parent id 映射（每次 generateTree 重建）与
    // onlyShowBMBar 启动开关（只有 generateTree 读取）。
    const nodeTrees = {};
    const viewManager = ctx.viewManager;
    const visitStats = ctx.visitStats;
    const onlyShowBMBar = !!store.get('onlyShowBMBar');

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

    // v4 task 2: recent section migrated to src/view-recent.js.
    // The tree view no longer mounts the virtual recent section.

    const generateTree = tree => {
        let subTree;
        if (onlyShowBMBar) {
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
        treeRender.generateNodeTrees(subTree, nodeTrees);
        // v4 task 2: share parent-path map with view-manager for cross-view path labels
        if (viewManager && viewManager.setParentPathMap) {
            viewManager.setParentPathMap({...nodeTrees});
        }
        // v4 task 2: prune visit stats for deleted bookmarks
        if (visitStats && visitStats.prune) {
            const validIds = new Set(Object.keys(nodeTrees));
            visitStats.prune(validIds);
        }
        // Build deadMarks set for overlay rendering in tree rows
        const deadMarks = (() => {
            try {
                const raw = store.get('deadMarks');
                if (!raw) return new Set();
                const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
                return new Set(arr || []);
            } catch (e) { return new Set(); }
        })();
        const html = treeRender.generateHTML(subTree, 0, deadMarks);
        // Keep the fuzzy-search index in sync with the freshly loaded tree
        search.updateIndex(tree);

        $tree.innerHTML = html;

        // Refresh sync indicators after tree is generated
        if (store.getSyncSetting('showSyncStatus', 'true') === 'true') {
            setTimeout(() => {
                refreshSyncIndicators();
            }, 100);
        }

        if (getRememberState()) {
            $tree.scrollTop = store.get('scrollTop') ? store.get('scrollTop') : 0;
        }

        const focusID = store.get('focusID');
        if (typeof focusID !== 'undefined' && focusID !== null) {
            const focusEl = document.getElementById(`neat-tree-item-${focusID}`);
            if (focusEl) {
                const oriOverflow = $tree.style.overflow;
                $tree.style.overflow = 'hidden';
                focusEl.style.width = '100%';
                focusEl.firstElementChild.classList.add('focus');
                setTimeout(() => {
                    $tree.style.overflow = oriOverflow;
                }, 1);
                setTimeout(() => {
                    store.remove('focusID');
                }, 4000);
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
                const deadMarks = (() => {
                    try {
                        const raw = store.get('deadMarks');
                        if (!raw) return new Set();
                        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
                        return new Set(arr || []);
                    } catch (e) { return new Set(); }
                })();
                const html = treeRender.generateHTML(children, parseInt(parent.parentNode.dataset.level) + 1, deadMarks);
                const div = document.createElement('div');
                div.innerHTML = html;
                const ul = div.querySelector('ul');
                parent.appendChild(ul);
                div.remove();
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
        const newOpens = treeRender.getParentPath(id, nodeTrees);
        setOpens(newOpens);
        store.set('opens', JSON.stringify(newOpens));
        // force to recover from remember state (opened folders)
        setRememberState(true);
        // focus on the target folder
        store.set('focusID', id);
        // new handler to handle the scrolling
        chrome.bookmarks.getTree(generateTreeForTarget);
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
            if (el.className === "link-folder") { // search result folder
                // get folder id (el parent is li)
                const id = el.parentNode.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                revealFolder(id);
            } else {
                const id = el.parentNode.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                actions.recordVisit(id);
                const url = el.href;
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
                const urls = children.map(c => c.url).filter(Boolean);
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

    // v4 task 2: reveal a bookmark in the tree — open its parent folder chain,
    // then focus the bookmark row after rebuild.
    const revealBookmark = (bookmarkId, parentFolderId) => {
        search.quit();
        // Open parent folder chain using parent folder ID
        const newOpens = treeRender.getParentPath(parentFolderId, nodeTrees);
        setOpens(newOpens);
        store.set('opens', JSON.stringify(newOpens));
        setRememberState(true);
        // Focus on the bookmark itself (not the folder)
        store.set('focusID', bookmarkId);
        chrome.bookmarks.getTree(generateTreeForTarget);
    };

    return {
        generateTree,
        adaptBookmarkTooltips,
        revealFolder,
        revealBookmark
    };
}
