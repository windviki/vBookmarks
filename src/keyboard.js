/**
 * Keyboard navigation (P1 module extracted from neat.js).
 *
 * Owns every keyboard binding of the popup: the tree/results keydown handler
 * (arrow-key focus walking incl. the "(Empty)" marker rows, open/close folder
 * via dispatched clicks, Enter/Space click-through with modifiers, Home/End,
 * PageUp/PageDown, F2 rename and the type-ahead keyBuffer with its 500ms
 * reset timer), the tree/results keyup handler (Delete → delete actions),
 * the context menus' keydown handler (menu-item walking that skips <hr>s,
 * wrap-around off Mac, Escape/arrow-out closing the menu) and the document-
 * level Escape (close dialogs, quit search) / Ctrl+F (focus search) handler.
 *
 * initKeyboard(ctx) is called once by neat.js where the code used to live —
 * menus/search/actions/dialogs all init further up, so every collaborator is
 * injected directly (no lazy getters needed, unlike src/context-menu.js):
 * ctx.tree    — the #tree element (keydown/keyup bindings + fallback lookups)
 * ctx.search  — initSearch API (.results/.input/.isActive()/.quit())
 * ctx.actions — initActions API (editBookmarkFolder/deleteBookmark(s))
 * ctx.menus   — initContextMenu API (clearMenu + the menu elements)
 * ctx.dialogs — initDialogs API (anyOpen/closeDialogs)
 * ctx.body    — document.body (the .active row lookup in contextKeyDown)
 * ctx.os      — 'mac' | 'win' | 'linux' | 'other'
 * ctx.rtl     — true when the popup is right-to-left
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

    // neatools' String.prototype.escapeRegExp, kept as a pure function
    const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Keyboard navigation
    let keyBuffer = '';
    let keyBufferTimer = null;
    const treeKeyDown = function (e) {
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName)) {
            item = $tree.querySelector('.focus') || $tree.querySelector('li:first-child>span');
        }
        let li = item.parentNode;
        let keyValue = e.key;
        const metaKey = e.metaKey;
        if (keyValue === 'ArrowDown' && metaKey)
            keyValue = 'End'; // cmd + down (Mac)
        if (keyValue === 'ArrowUp' && metaKey)
            keyValue = 'Home'; // cmd + up (Mac)
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
                        search.input.focus();
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
                const id = li.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                actions.editBookmarkFolder(id);
            }
                break;
            case 'Delete': // delete
                break; // don't run 'default'
            default: {
                if (keyValue.length > 1)
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
    $tree.addEventListener('keydown', treeKeyDown);
    search.results.addEventListener('keydown', treeKeyDown);

    const treeKeyUp = e => {
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName))
            item = $tree.querySelector('.focus') || $tree.querySelector('li:first-child>span');
        const li = item.parentNode;
        switch (e.key) {
            case "Delete": // delete
                e.preventDefault();
                const id = li.id.replace(/(neat-tree|neat-recent|results)-item-/, '');
                if (li.classList.contains('parent')) {
                    chrome.bookmarks.getChildren(id, children => {
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
    $tree.addEventListener('keyup', treeKeyUp);
    search.results.addEventListener('keyup', treeKeyUp);

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
        if (palette && palette.isOpen()) {
            palette.close();
            return;
        }
        if (search.isActive() || search.input.value) {
            if (search.isActive())
                search.quit();
            else
                search.input.value = '';
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
            search.input.focus();
            search.input.select();
            e.preventDefault();
        }
    });

    return { treeKeyDown, treeKeyUp, contextKeyDown };
}
