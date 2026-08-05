/**
 * Keyboard navigation (P1 module extracted from neat.js).
 *
 * Owns every keyboard binding of the popup: the tree/results keydown handler
 * (arrow-key focus walking incl. the "(Empty)" marker rows, open/close folder
 * via dispatched clicks, Enter/Space click-through with modifiers, Home/End,
 * PageUp/PageDown, F2 rename and the type-ahead keyBuffer with its 500ms
 * reset timer), the tree/results keyup handler (Delete → delete actions),
 * the context menus' keydown handler (menu-item walking that skips <hr>s,
 * wrap-around off Mac, Escape/arrow-out closing the menu), the document-
 * level Escape (close dialogs, quit search) / Ctrl+F (focus search) handler
 * and the Tab region cycle (docs/v4task-2-list.md §2.1: header controls →
 * tab strip → active list's remembered row, Shift+Tab backwards; rows are
 * tabindex="-1" so the cycle is the only Tab path into a list).
 *
 * initKeyboard(ctx) is called once by neat.js where the code used to live —
 * menus/search/actions/dialogs all init further up, so every collaborator is
 * injected directly (no lazy getters needed, unlike src/context-menu.js):
 * ctx.tree    — the #tree element (keydown/keyup bindings + fallback lookups)
 * ctx.search  — initSearch API (.results/.input/.isActive()/.quit()/.escape())
 * ctx.actions — initActions API (editBookmarkFolder/deleteBookmark(s))
 * ctx.menus   — initContextMenu API (clearMenu + the menu elements)
 * ctx.dialogs — initDialogs API (anyOpen/closeDialogs)
 * ctx.body    — document.body (the .active row lookup in contextKeyDown)
 * ctx.os      — 'mac' | 'win' | 'linux' | 'other'
 * ctx.rtl     — true when the popup is right-to-left
 * ctx.views   — view-manager API (v4 task-2): the list-container registry the
 *               nav handlers bind to (lists/listOf, replacing the hardcoded
 *               #tree/#results pair), the view-level Escape levels
 *               (onEscapeActive/escapeToTree in the document chain), the
 *               ↑-past-first-row region crossing (focusTop) and the Ctrl+F
 *               search-view activation. Optional: a fallback mirrors the
 *               pre-view wiring when absent (tests).
 *
 * The handlers keep their `this` semantics (the element the listener is
 * bound to), so they stay `function (e)` declarations; the returned
 * { treeKeyDown, treeKeyUp, contextKeyDown } is for tests. chrome.bookmarks
 * .getChildren (treeKeyUp folder-delete counting), document/window/
 * MouseEvent/setTimeout remain page globals. No neatools helpers: plain
 * getElementById/classList/Array.from only (Array.filter(...).getLast() is
 * inlined as filter + [length - 1], String.escapeRegExp as a pure function).
 */
export function initKeyboard(ctx = {}) {
    const $ = id => document.getElementById(id);
    const $tree = ctx.tree;
    const search = ctx.search;
    const actions = ctx.actions;
    const menus = ctx.menus;
    const dialogs = ctx.dialogs;
    const body = ctx.body;
    const os = ctx.os;
    const rtl = ctx.rtl;
    const palette = ctx.palette; // ESC layering: close palette before popup
    // v4 task-2: the list containers and the view-level Escape behavior come
    // from the view manager. The fallback mirrors the pre-view wiring so
    // minimal test setups keep working; neat.js always injects it.
    const views = ctx.views || {
        lists: () => [
            { id: 'tree', el: ctx.tree, typeAhead: true },
            { id: 'search', el: ctx.search.results, typeAhead: true }
        ],
        listOf: () => null,
        activeDef: () => ({ listEl: ctx.tree }),
        onEscapeActive: () => false,
        escapeToTree: () => false,
        focusTop: () => { ctx.search.input.focus(); },
        focusDown: () => { ctx.search.input.focus(); },
        activate: () => {}
    };

    // neatools' String.prototype.escapeRegExp, kept as a pure function
    const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Keyboard navigation
    let keyBuffer = '';
    let keyBufferTimer = null;
    const treeKeyDown = function (e) {
        let item = document.activeElement;
        let keyValue = e.key;
        const metaKey = e.metaKey;
        if (keyValue === 'ArrowDown' && metaKey)
            keyValue = 'End'; // cmd + down (Mac)
        if (keyValue === 'ArrowUp' && metaKey)
            keyValue = 'Home'; // cmd + up (Mac)
        if (!/^(a|span)$/i.test(item.tagName)) {
            // Focus is on the list container itself, on an in-list toolbar
            // control (stats seg buttons, dead/dupes toolbar buttons/selects)
            // or on an inline row control (keeper radio, ⚑/× row buttons).
            // Action keys (Enter/Delete/F2/letters) stay with the control,
            // which has its own semantics for them; navigation keys walk THIS
            // list's rows — never a row of another (possibly hidden) list.
            if (!/^(ArrowDown|ArrowUp|ArrowLeft|ArrowRight|Home|End|PageDown|PageUp)$/.test(keyValue))
                return;
            if (item !== this) {
                // keyboard-model §2.5 (final-polish revision): the toolbar is
                // a rung of the vertical chain, sitting between the tab strip
                // and the rows exactly where it renders.
                const toolbar = item.closest && item.closest('.vbm-toolbar');
                if (toolbar) {
                    if (keyValue === 'ArrowDown' || keyValue === 'ArrowUp') {
                        // A <select> keeps its native ↑/↓ (option change when
                        // closed, popup navigation when open) — leave the rung
                        // via ←/→ instead.
                        if (item.tagName === 'SELECT')
                            return;
                        e.preventDefault();
                        // v4 task-4 #13: a view may stack several
                        // .vbm-toolbar rows (the dead view's proxy strip
                        // above its scan toolbar) — each is its own rung.
                        // ↓/↑ enters the next/previous rung that has an
                        // enabled control; past the ends, ↓ crosses into
                        // the rows and ↑ out to the strip/box.
                        const bars = this.querySelectorAll('.vbm-toolbar');
                        let barIdx = -1;
                        for (let i = 0, l = bars.length; i < l; i++)
                            if (bars[i] === toolbar) {
                                barIdx = i;
                                break;
                            }
                        const firstEnabled = bar => {
                            const cs = bar.querySelectorAll('button, select, input');
                            for (let i = 0, l = cs.length; i < l; i++)
                                if (!cs[i].disabled)
                                    return cs[i];
                            return null;
                        };
                        if (keyValue === 'ArrowDown') {
                            for (let i = barIdx + 1; i < bars.length; i++) {
                                const c = firstEnabled(bars[i]);
                                if (c) {
                                    c.focus();
                                    return;
                                }
                            }
                            // ↓ into the rows: the remembered row first (the
                            // same landing the strip's ↓ makes).
                            const target = this.querySelector('.focus')
                                || this.querySelector('li a, li span');
                            if (target)
                                target.focus();
                        } else {
                            for (let i = barIdx - 1; i >= 0; i--) {
                                const c = firstEnabled(bars[i]);
                                if (c) {
                                    c.focus();
                                    return;
                                }
                            }
                            // ↑ out of the top rung: the strip, else the box.
                            views.focusTop();
                        }
                        return;
                    }
                    if (keyValue === 'ArrowLeft' || keyValue === 'ArrowRight') {
                        // ←/→ walk the rung's enabled controls in reading
                        // order (RTL mirrors); the rung's edges are dead
                        // ends, the header-chain contract.
                        const controls = toolbar.querySelectorAll
                            ? toolbar.querySelectorAll('button, select, input') : [];
                        const walk = [];
                        for (let i = 0, l = controls.length; i < l; i++)
                            if (!controls[i].disabled)
                                walk.push(controls[i]);
                        const idx = walk.indexOf(item);
                        if (idx < 0)
                            return;
                        const dir = keyValue === 'ArrowRight' ? 1 : -1;
                        const step = rtl ? -dir : dir;
                        const next = walk[idx + step];
                        if (!next)
                            return;
                        e.preventDefault();
                        next.focus();
                        return;
                    }
                    // Home/End/Page* fall through to the list's own cases —
                    // they work off the container and never touch the row
                    // under the control.
                } else {
                    // Inline row control or focusable row container (dead
                    // start row): ↑/↓ walk rows relative to the OWNING row;
                    // everything else keeps its native semantics.
                    const ownLi = item.closest && item.closest('li');
                    if (!ownLi)
                        return;
                    if (keyValue !== 'ArrowDown' && keyValue !== 'ArrowUp')
                        return;
                    e.preventDefault();
                    const sib = keyValue === 'ArrowDown'
                        ? ownLi.nextElementSibling : ownLi.previousElementSibling;
                    const target = sib && sib.querySelector ? sib.querySelector('a, span') : null;
                    if (target) {
                        target.focus();
                    } else if (keyValue === 'ArrowUp') {
                        // Owning row was the top row: the §2.1/§2.5 crossing.
                        if (views.focusListExit)
                            views.focusListExit();
                        else
                            views.focusTop();
                    }
                    return;
                }
            } else {
                item = this.querySelector('.focus') || this.querySelector('li a, li span');
                if (!item)
                    return; // empty list / empty state only
            }
        }
        let li = item.parentNode;
        switch (keyValue) {
            case 'ArrowDown': // down
                e.preventDefault();
                const liChild = li.querySelector('ul>li:first-child');
                // may be an "(Empty)" marker row, which has no focusable element
                const liChildFocus = liChild ? liChild.querySelector('a, span') : null;
                let nextLiSpan;
                if (li.classList.contains('open') && liChildFocus) {
                    liChildFocus.focus();
                } else {
                    let nextLi = li.nextElementSibling;
                    if (nextLi) {
                        nextLiSpan = nextLi.querySelector('a, span');
                        if (nextLiSpan) {
                            nextLiSpan.focus();
                        }
                    } else if (!search.isActive()) {
                        nextLi = null;
                        do {
                            if (li)
                                li = li.parentNode.parentNode;
                            if (li)
                                nextLi = li.nextElementSibling;
                            if (nextLi)
                                nextLiSpan = nextLi.querySelector('a, span');
                            if (nextLiSpan) //fixed: pushed down "DOWN" when the focus was at the last node
                                nextLiSpan.focus();
                        } while (li && !nextLi);
                    }
                }
                break;
            case 'ArrowUp': // up
            {
                e.preventDefault();
                let prevLi = li.previousElementSibling;
                if (prevLi) {
                    while (prevLi.classList.contains('open') && prevLi.querySelector('ul>li:last-child')) {
                        const lis = prevLi.querySelectorAll('ul>li:last-child');
                        const visible = Array.from(lis).filter(li => !!li.parentNode.offsetHeight);
                        prevLi = visible[visible.length - 1];
                    }
                    const prevLiFocus = prevLi && prevLi.querySelector('a, span');
                    if (prevLiFocus) {
                        prevLiFocus.focus();
                    } else if (prevLi) {
                        // "(Empty)" marker row: land on its folder instead
                        const markerParentLi = prevLi.parentNode.parentNode;
                        if (markerParentLi && markerParentLi.tagName === 'LI')
                            markerParentLi.querySelector('a, span').focus();
                    }
                } else {
                    const parentPrevLi = li.parentNode.parentNode;
                    if (parentPrevLi && parentPrevLi.tagName === 'LI') {
                        parentPrevLi.querySelector('a, span').focus();
                    } else {
                        // v4task-2-list §2.1 + §2.5 (final polish): ↑ past
                        // the first row crosses into the in-list toolbar when
                        // the active view has one, else the tab strip (or the
                        // search box when the strip is hidden).
                        if (views.focusListExit)
                            views.focusListExit();
                        else
                            views.focusTop();
                    }
                }
            }
                break;
            case 'ArrowRight': // right (left for RTL)
            {
                e.preventDefault();
                // open/close dir node
                if (li.classList.contains('parent') && ((!rtl && !li.classList.contains('open')) || (rtl && li.classList.contains('open')))) {
                    let event = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    });
                    li.firstElementChild.dispatchEvent(event);
                } else {
                    if (rtl) {
                        // move back to parent node
                        const parentID = li.dataset.parentid;
                        if (parentID === '0')
                            return;
                        // fixed: check whether the parent item exists
                        const item = $(`neat-tree-item-${parentID}`);
                        if (item) {
                            item.querySelector('span').focus();
                        }
                    } else {
                        let elRect = e.target.getBoundingClientRect();
                        let event = new MouseEvent("contextmenu", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: elRect.right,
                            clientY: elRect.bottom,
                        });
                        e.target.dispatchEvent(event);
                    }
                }
            }
                break;
            case 'ArrowLeft': // left (right for RTL)
            {
                e.preventDefault();
                // open/close dir node
                if (li.classList.contains('parent') && ((!rtl && li.classList.contains('open')) || (rtl && !li.classList.contains('open')))) {
                    let event = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    });
                    li.firstElementChild.dispatchEvent(event);
                } else {
                    if (!rtl) {
                        // move back to parent node
                        const parentID = li.dataset.parentid;
                        if (parentID === '0')
                            return;
                        // fixed: check whether the parent item exists
                        const item = $(`neat-tree-item-${parentID}`);
                        if (item) {
                            item.querySelector('span').focus();
                        }
                    } else {
                        let elRect = e.target.getBoundingClientRect();
                        let event = new MouseEvent("contextmenu", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: elRect.left,
                            clientY: elRect.bottom,
                        });
                        e.target.dispatchEvent(event);
                    }
                }
            }
                break;
            case ' ': // space
            case 'Enter': // enter
            {
                e.preventDefault();
                let event = new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey
                });
                li.firstElementChild.dispatchEvent(event);
            }
                break;
            case 'End': // end
                if (search.isActive()) {
                    // may be the no-results empty state, which has no focusable row
                    const lastResult = this.querySelector('li:last-child a');
                    if (lastResult)
                        lastResult.focus();
                } else {
                    const lis = this.querySelectorAll('ul>li:last-child');
                    const visible = Array.from(lis).filter(li => !!li.parentNode.offsetHeight);
                    const li = visible[visible.length - 1];
                    li.querySelector('span, a').focus();
                }
                break;
            case 'Home': // home
                if (search.isActive()) {
                    const firstResult = this.querySelector('ul>li:first-child a');
                    if (firstResult)
                        firstResult.focus();
                } else {
                    this.querySelector('ul>li:first-child').querySelector('span, a').focus();
                }
                break;
            case 'PageDown': // page down
            {
                const self = this;
                const getLastItem = () => {
                    const bound = self.offsetHeight + self.scrollTop;
                    const items = self.querySelectorAll('a, span');
                    const visible = Array.from(items).filter(item => !!item.parentElement.offsetHeight && item.offsetTop < bound);
                    return visible[visible.length - 1];
                };
                const item = getLastItem();
                if (item !== document.activeElement) {
                    e.preventDefault();
                    item.focus();
                } else {
                    setTimeout(() => {
                        getLastItem().focus();
                    }, 0);
                }
            }
                break;
            case 'PageUp': // page up
            {
                const self = this;
                const getFirstItem = () => {
                    const bound = self.scrollTop;
                    const items = self.querySelectorAll('a, span');
                    return Array.from(items).filter(item => !!item.parentElement.offsetHeight && ((item.offsetTop + item.offsetHeight) > bound))[0];
                };
                const item = getFirstItem();
                if (item !== document.activeElement) {
                    e.preventDefault();
                    item.focus();
                } else {
                    setTimeout(() => {
                        getFirstItem().focus();
                    }, 0);
                }
            }
                break;
            case 'F2': // F2, not for Mac
            {
                if (os === 'mac')
                    break;
                // data-node-id is the v4 task-2 unified row id; the legacy
                // prefix strip stays for rows that predate it.
                const id = li.dataset.nodeId || li.id.replace(/(neat-tree|neat-recent|results|recent)-item-/, '');
                if (id)
                    actions.editBookmarkFolder(id);
            }
                break;
            case 'Delete': // delete
                break; // don't run 'default'
            default: {
                if (keyValue.length > 1)
                    return;
                // View-local letter keys (M/R/K — docs/v4task-2-list.md
                // §2.3) are consumed before the type-ahead gate; type-ahead
                // itself lives on tree/search only (docs/v4task-2.md §3.4):
                // other list views consume letter keys through onKey.
                const listView = views.listOf(this);
                if (listView && listView.onKey && listView.onKey(e))
                    return;
                if (listView && listView.typeAhead === false)
                    return;
                const key = keyValue;
                if (key !== keyBuffer)
                    keyBuffer += key;
                clearTimeout(keyBufferTimer);
                keyBufferTimer = setTimeout(() => {
                    keyBuffer = '';
                }, 500);
                const lis = this.querySelectorAll('ul>li');
                const items = [];
                for (let i = 0, l = lis.length; i < l; i++) {
                    const li = lis[i];
                    if (li.parentNode.offsetHeight)
                        items.push(li.firstElementChild);
                }
                const pattern = new RegExp(`^${escapeRegExp(keyBuffer)}`, 'i');
                const batch = [];
                let startFind = false;
                let found = false;
                const activeElement = document.activeElement;
                for (let i = 0, l = items.length; i < l; i++) {
                    const item = items[i];
                    if (item === activeElement) {
                        startFind = true;
                    } else if (startFind) {
                        if (pattern.test(item.textContent.trim())) {
                            found = true;
                            item.focus();
                            break;
                        }
                    } else {
                        batch.push(item);
                    }
                }
                if (!found) {
                    for (let i = 0, l = batch.length; i < l; i++) {
                        const item = batch[i];
                        if (pattern.test(item.textContent.trim())) {
                            item.focus();
                            break;
                        }
                    }
                }
            }
        }
    };
    // v4 task-2 §3.4: the list containers come from the view registry
    // (tree/search today, feature views as they land); the handlers keep
    // their `this` = the bound list element semantics.
    views.lists().forEach(list => {
        list.el.addEventListener('keydown', treeKeyDown);
    });

    const treeKeyUp = e => {
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName)) {
            // Delete on an in-list toolbar control must never reach a row —
            // only the list container itself falls back to its .focus row
            // (never to a row of another, possibly hidden, list).
            if (item !== e.currentTarget)
                return;
            item = e.currentTarget.querySelector('.focus') || e.currentTarget.querySelector('li a, li span');
            if (!item)
                return;
        }
        const li = item.parentNode;
        switch (e.key) {
            case "Delete": // delete
                e.preventDefault();
                const id = li.dataset.nodeId || li.id.replace(/(neat-tree|neat-recent|results|recent)-item-/, '');
                if (!id)
                    break;
                // Root folders (parentid '0' — bar / other / mobile) cannot be
                // deleted: Chrome rejects removeTree on them, and actions'
                // callback would drop the row from the DOM anyway. Same guard
                // as the context menu's disabled delete entry. Scoped to the
                // folder branch — a bookmark row's parentid is its real parent
                // folder, never the '0' pseudo-root.
                if (li.classList.contains('parent')
                    && li.dataset && li.dataset.parentid === '0')
                    break;
                if (li.classList.contains('parent')) {
                    chrome.bookmarks.getChildren(id, children => {
                        // same undefined-guard as bookmarkHandler's folder branch
                        children = children || [];
                        // neatools' Array.map(c => c.url, children).clean():
                        // child urls (folders have none, null/undefined dropped)
                        const urlsLen = children.map(c => c.url).filter(Boolean).length;
                        actions.deleteBookmarks(id, urlsLen, children.length - urlsLen);
                    });
                } else {
                    actions.deleteBookmark(id);
                }
                break;
        }
    };
    views.lists().forEach(list => {
        list.el.addEventListener('keyup', treeKeyUp);
    });

    //use keyboardEvent.key (>= Chrome 51)
    const contextKeyDown = function (e) {
        const menu = this;
        const item = document.activeElement;
        const metaKey = e.metaKey;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (metaKey) { // cmd + down (Mac)
                    menu.lastElementChild.focus();
                } else {
                    if (item.classList.contains('menu-item')) {
                        let nextItem = item.nextElementSibling;
                        if (nextItem && nextItem.tagName === 'HR')
                            nextItem = nextItem.nextElementSibling;
                        if (nextItem) {
                            nextItem.focus();
                        } else if (os !== 'mac') {
                            menu.firstElementChild.focus();
                        }
                    } else {
                        item.firstElementChild.focus();
                    }
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (metaKey) { // cmd + up (Mac)
                    menu.firstElementChild.focus();
                } else {
                    if (item.classList.contains('menu-item')) {
                        let prevItem = item.previousElementSibling;
                        if (prevItem && prevItem.tagName === 'HR')
                            prevItem = prevItem.previousElementSibling;
                        if (prevItem) {
                            prevItem.focus();
                        } else if (os !== 'mac') {
                            menu.lastElementChild.focus();
                        }
                    } else {
                        item.lastElementChild.focus();
                    }
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (!rtl) {
                    const active = body.querySelector('.active');
                    if (active) {
                        active.classList.remove('active');
                        active.focus();
                    }
                    menus.clearMenu();
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (rtl) {
                    const active = body.querySelector('.active');
                    if (active) {
                        active.classList.remove('active');
                        active.focus();
                    }
                    menus.clearMenu();
                }
                break;
            case " ": // space
            case 'Enter': // enter
                e.preventDefault();
                let event = new MouseEvent("mouseup", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                });
                item.dispatchEvent(event);
                break;
            case 'Escape': // esc
                e.preventDefault();
                const active = body.querySelector('.active');
                if (active) {
                    active.classList.remove('active');
                    active.focus();
                }
                menus.clearMenu();
                break;
        }
    };
    menus.bookmarkMenu.addEventListener('keydown', contextKeyDown);
    menus.folderMenu.addEventListener('keydown', contextKeyDown);
    //menus.separatorMenu.addEventListener('keydown', contextKeyDown);
    // fourth-round item 7: search-history menu gets full ↑↓/Enter/Esc support
    if (menus.searchHistoryMenu)
        menus.searchHistoryMenu.addEventListener('keydown', contextKeyDown);
    // final polish (v4task-2-list §2.4): the two v4 task-3 menus get the same
    // treatment — without these bindings their rows were unreachable by keys
    if (menus.histRowMenu)
        menus.histRowMenu.addEventListener('keydown', contextKeyDown);
    if (menus.dupesGroupMenu)
        menus.dupesGroupMenu.addEventListener('keydown', contextKeyDown);

    // Header-row arrows (final polish): the naive horizontal walk between
    // the search box and the header buttons (quick-add ⇄ tool) plus ↓ from
    // any header button into the zone below (tab strip / active list — the
    // same focusDown the search box uses). The box's own →-at-text-edge
    // binding lives in search.js next to its ↓ handler; ← from quick-add
    // returns to the box with the caret parked at the end, ready to type.
    const quickAddBtn = $('quick-add-btn');
    const toolBtn = $('tool-btn');
    // (doubles without layout APIs count as visible — tests)
    const visibleEl = el => el && (el.getClientRects ? el.getClientRects().length > 0 : true);
    const headerArrow = e => {
        const left = rtl ? 'ArrowRight' : 'ArrowLeft';
        const right = rtl ? 'ArrowLeft' : 'ArrowRight';
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            views.focusDown();
            return;
        }
        let target = null;
        if (e.currentTarget === quickAddBtn) {
            if (e.key === left)
                target = search.input;
            else if (e.key === right && visibleEl(toolBtn))
                target = toolBtn;
        } else if (e.currentTarget === toolBtn && e.key === left) {
            target = visibleEl(quickAddBtn) ? quickAddBtn : search.input;
        }
        if (!target)
            return;
        e.preventDefault();
        target.focus();
        if (target === search.input && search.input.setSelectionRange) {
            const n = search.input.value.length;
            search.input.setSelectionRange(n, n);
        }
    };
    if (quickAddBtn)
        quickAddBtn.addEventListener('keydown', headerArrow);
    if (toolBtn)
        toolBtn.addEventListener('keydown', headerArrow);

    // Closing dialogs / context menus on escape.
    // Capture phase so we run before any child handler and before Chrome's
    // built-in "Escape closes popup" behaviour.  We always preventDefault +
    // stopImmediatePropagation on Escape — Chrome never sees the key, so the
    // popup only closes when we explicitly call window.close() as the last resort.
    // stopImmediatePropagation is used (not stopPropagation) to also block any
    // other capture-phase listeners on the same document node.
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;

        e.preventDefault();
        e.stopImmediatePropagation(); // block all other handlers + Chrome's popup-close

        if (dialogs.anyOpen()) { // esc
            dialogs.closeDialogs();
            return;
        }
        // Context menu open — dismiss just the menu.
        const active = body.querySelector('.active');
        if (active) {
            active.classList.remove('active');
            active.focus();
            menus.clearMenu();
            return;
        }
        // Transient banner (donation / what's-new — keyboard-model §4 layer
        // 3): dismiss it with the *Later* semantics, dispatched through the
        // button itself so the snooze logic stays in neat.js. Visible means
        // "not display:none" — neat.js always sets the inline style at boot.
        const banner = $('donation');
        if (banner && (!banner.style || banner.style.display !== 'none')) {
            const later = $('donation-later');
            if (later && later.click) {
                later.click();
                return;
            }
        }
        // v4 task-4 #14: a visible risk banner (dead/dupes) sits at the same
        // layer — dismissed with the session × semantics through its button.
        const activeDef = views.activeDef ? views.activeDef() : null;
        const riskBanner = activeDef && activeDef.container && activeDef.container.querySelector
            ? activeDef.container.querySelector('.risk-banner') : null;
        if (riskBanner) {
            const dismiss = riskBanner.querySelector('.risk-banner-dismiss');
            if (dismiss && dismiss.click) {
                dismiss.click();
                return;
            }
        }
        if (palette && palette.isOpen()) {
            palette.close();
            return;
        }
        // v4 task-2 §3.4 Esc layering: the active view's own consumer first
        // (e.g. aborting a dead-link scan), then the search query clear
        // (two-level in the search view, docs/v4task-2-list.md §2.3), then
        // the browser-style "back to tree", then window.close.
        if (views.onEscapeActive()) {
            return;
        }
        if (search.escape ? search.escape() : (search.isActive() || search.input.value)) {
            // Fallback for pre-slice-B search doubles without escape():
            if (!search.escape) {
                if (search.isActive())
                    search.quit();
                else
                    search.input.value = '';
            }
            return;
        }
        // Non-tree view: Esc returns to the tree (new browser-style back).
        if (views.escapeToTree()) {
            return;
        }
        // Nothing left to dismiss — close the popup.
        if (typeof window.close === 'function') window.close();
    }, true); // capture — first in line

    // Safety net: also intercept keyup Escape to prevent Chrome from closing
    // the popup if it processes the keyup phase instead of (or in addition to)
    // the keydown phase. Same layered fallthrough as above.
    document.addEventListener('keyup', e => {
        if (e.key !== 'Escape') return;
        // If we already handled the corresponding keydown, preventDefault here
        // too ensures Chrome doesn't see an "unprocessed" Escape at any stage.
        e.preventDefault();
        e.stopImmediatePropagation();
    }, true);

    document.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { // cmd/ctrl + f
            // §4.2: Ctrl/Cmd+F enters the search view and focuses the box
            views.activate('search');
            search.input.focus();
            search.input.select();
            e.preventDefault();
        }
    });

    // --- Tab region cycle (docs/v4task-2-list.md §2.1) -------------------------
    // Three regions in a ring: the header controls (search box → quick-add →
    // tool button), the tab strip (one stop — roving tabindex inside), and
    // the active view's list (its remembered `.focus` row, else first row).
    // Rows carry tabindex="-1", so this cycle is the only Tab path in or out
    // of a list; Shift+Tab walks the ring backwards. Dialogs, open context
    // menus and the palette keep their local Tab behavior (spec: 保持现状).
    const ROW_SEL = 'li a, li span, li[tabindex]';
    const menuContainers = [
        menus.bookmarkMenu, menus.folderMenu, menus.searchHistoryMenu,
        menus.histRowMenu, menus.dupesGroupMenu
    ].filter(Boolean);
    const isWithin = (root, node) => {
        for (let n = node; n; n = n.parentNode) {
            if (n === root)
                return true;
        }
        return false;
    };
    // A stop counts when it is actually rendered: the `.hidden` class and an
    // inline display:none are the explicit cases; getClientRects catches the
    // stylesheet-driven hiding (body.no-view-tabs → #view-tabs, the option-
    // hidden header buttons) where the element itself carries no marker.
    const tabVisible = el => {
        if (!el || el.classList.contains('hidden'))
            return false;
        if (el.style && el.style.display === 'none')
            return false;
        if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0)
            return false;
        return true;
    };
    const tabCycle = e => {
        if (e.key !== 'Tab' || e.defaultPrevented)
            return;
        if (dialogs.anyOpen()) {
            // Modal Tab trap (final polish; the dialogs carry aria-modal):
            // Tab must cycle among the open dialog's own controls instead of
            // leaking focus into the page behind the cover.
            const dlg = dialogs.activeEl ? dialogs.activeEl() : null;
            if (!dlg || !dlg.querySelectorAll)
                return;
            e.preventDefault();
            const controls = dlg.querySelectorAll('button, input');
            const focusables = [];
            for (let i = 0, l = controls.length; i < l; i++)
                if (!controls[i].disabled)
                    focusables.push(controls[i]);
            if (!focusables.length)
                return; // e.g. the alert dialog has no controls — stay put
            const cur = focusables.indexOf(document.activeElement);
            const next = cur < 0
                ? (e.shiftKey ? focusables.length - 1 : 0)
                : (cur + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
            focusables[next].focus();
            return;
        }
        if (palette && palette.isOpen && palette.isOpen())
            return;
        const ae = document.activeElement;
        for (let i = 0, l = menuContainers.length; i < l; i++) {
            if (isWithin(menuContainers[i], ae))
                return;
        }
        const stops = [];
        const headerIds = ['search-input', 'quick-add-btn', 'tool-btn'];
        for (let i = 0, l = headerIds.length; i < l; i++) {
            const el = $(headerIds[i]);
            if (tabVisible(el))
                stops.push(el);
        }
        // keyboard-model §7: the transient banner (donation / what's-new)
        // joins the ring at its visual spot — between the header row and the
        // tab strip — whenever it is up. Never an arrow rung: the arrow chain
        // stays stable whether or not the banner happens to be showing.
        const bannerEl = $('donation');
        if (bannerEl && bannerEl.querySelectorAll && tabVisible(bannerEl)) {
            const bannerControls = bannerEl.querySelectorAll('button, a[href]');
            for (let i = 0, l = bannerControls.length; i < l; i++) {
                const c = bannerControls[i];
                if (!c.disabled && tabVisible(c))
                    stops.push(c);
            }
        }
        const tabsEl = $('view-tabs');
        let tabStop = null;
        const def = views.activeDef ? views.activeDef() : null;
        if (tabVisible(tabsEl)) {
            tabStop = (def && def.tabEl) || tabsEl.querySelector('.view-tab');
            if (tabStop)
                stops.push(tabStop);
        }
        // Final polish (v4task-2-list §3.4–3.6 "第 0 行" + 原则 2 全键盘可达):
        // the active view's in-list toolbar controls (stats sort seg/clear,
        // dead rescan/filter/mark-all, dupes strategy/scope/apply) join the
        // cycle between the tab strip and the list rows — previously no
        // keyboard path reached them at all.
        const container = def && def.container;
        // v4 task-4 #14: the risk banner (dead/dupes pre-use warning) joins
        // at its visual spot — top of the view, right below the strip and
        // before the toolbar rungs. A Tab stop, never an arrow rung (§7).
        if (container && container.querySelectorAll) {
            const bannerControls = container.querySelectorAll(
                '.risk-banner button, .risk-banner a[href]');
            for (let i = 0, l = bannerControls.length; i < l; i++) {
                const c = bannerControls[i];
                if (!c.disabled && tabVisible(c))
                    stops.push(c);
            }
        }
        if (container && container.querySelectorAll) {
            const controls = container.querySelectorAll(
                '.vbm-toolbar button, .vbm-toolbar select, .vbm-toolbar input');
            for (let i = 0, l = controls.length; i < l; i++) {
                const c = controls[i];
                if (!c.disabled && tabVisible(c))
                    stops.push(c);
            }
        }
        const listEl = (def && def.listEl) || $tree;
        const rowStop = listEl
            ? (listEl.querySelector('.focus') || listEl.querySelector(ROW_SEL))
            : null;
        if (rowStop)
            stops.push(rowStop);
        if (!stops.length)
            return;
        let i = stops.indexOf(ae);
        if (i < 0) {
            // Focus sits inside a region but not on its stop (a row's inner
            // control, the list container, a non-roving tab): continue from
            // that region. From nowhere (body), enter at the near edge.
            if (rowStop && isWithin(listEl, ae))
                i = stops.indexOf(rowStop);
            else if (tabStop && isWithin(tabsEl, ae))
                i = stops.indexOf(tabStop);
            else
                i = e.shiftKey ? 0 : -1;
        }
        const next = stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length];
        e.preventDefault();
        next.focus();
    };
    document.addEventListener('keydown', tabCycle);

    return { treeKeyDown, treeKeyUp, contextKeyDown, tabCycle };
}
