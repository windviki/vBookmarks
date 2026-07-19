/**
 * Drag & drop ordering (P1 module extracted from neat.js).
 *
 * Owns the tree's whole drag-and-drop layer: the $tree mousedown handler that
 * starts a drag (left button only, any bookmark or non-root folder; recent-
 * section virtual entries rejected, <hr> targets normalized to their <a>),
 * the document mousemove handler (drag clone + drop overlay positioning,
 * bookmark top/bottom-half and folder 30%/70% drop-zone math, auto-scrolling
 * at the tree edges, collapse-before-move for open folders) and the document
 * mouseup handler that performs the drop (chrome.bookmarks.get → the
 * canMoveBetweenStorage syncing check → chrome.bookmarks.move, then the DOM
 * re-insertion incl. level/data-parentid/padding fixups and removal of a
 * stale "(Empty)" marker row). Also owns the noOpenBookmark flag: a drag
 * that ends without a valid drop must swallow the click that follows, so the
 * bookmark is not opened.
 *
 * initDnd(ctx) is called once by neat.js where the code used to live —
 * tree/store/rtl all exist by then, and resetSeparator is a hoisted function
 * declaration (shared with the resizer further below), so it is passed in
 * directly. Handlers only run on user events, after sync init finished.
 * ctx.tree           — the #tree element (mousedown binding + geometry)
 * ctx.store          — settings store (the 'zoom' level read at drag start)
 * ctx.rtl            — true when the popup is right-to-left
 * ctx.resetSeparator — neat.js's shared separator-width recompute
 *
 * Returns { isDragging, consumeNoOpen }: neat.js's zoom() guards on
 * isDragging() and bookmarkHandler swallows the post-drag click via
 * consumeNoOpen() (returns the flag once, then resets it).
 * chrome.bookmarks.get/move, chrome.i18n.getMessage, window/document/
 * setInterval remain page globals. No neatools helpers: plain getElementById/
 * classList/insertAdjacentElement only (hasClass → classList.contains,
 * inject → insertAdjacentElement/appendChild, destroy → remove,
 * String.toInt → parseInt/parseFloat with a 0 fallback).
 */
export function initDnd(ctx = {}) {
    const $tree = ctx.tree;
    const store = ctx.store;
    const rtl = ctx.rtl;
    const resetSeparator = ctx.resetSeparator;

    // Check if a DOM element represents a root folder (for drag/drop)
    const isDOMElementRootFolder = (el) => {
        if (!el || !el.dataset) return false;
        // Check dataset attributes which may contain folderType info
        const parentId = el.dataset.parentid;
        const folderType = el.dataset.foldertype;
        return parentId === "0" || parentId === 0 || folderType !== undefined;
    };

    // Blocked cross-storage drops used to call alert() — which destroys the
    // popup window outright. A transient toast delivers the same message
    // without killing the context. Created on demand (kept out of the HTML
    // so popup/sidepanel parity is untouched), styled in neat.css.
    let blockedToastTimer = null;
    const showBlockedToast = msg => {
        let toast = document.getElementById('notice-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'notice-toast';
            toast.setAttribute('role', 'status');
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(blockedToastTimer);
        blockedToastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
    };

    // Check if a bookmark can be moved between storage spaces
    const canMoveBetweenStorage = (sourceId, targetParentId, callback) => {
        chrome.bookmarks.get(sourceId, (sourceNodes) => {
            if (!sourceNodes || !sourceNodes.length) {
                callback(true);
                return;
            }
            const sourceNode = sourceNodes[0];

            chrome.bookmarks.get(sourceNode.parentId, (sourceParentNodes) => {
                const sourceParent = sourceParentNodes && sourceParentNodes[0];

                chrome.bookmarks.get(targetParentId, (targetParentNodes) => {
                    const targetParent = targetParentNodes && targetParentNodes[0];

                    // If no sync info, allow (old Chrome or no sync enabled)
                    if (!sourceParent || !targetParent ||
                        sourceParent.syncing === undefined ||
                        targetParent.syncing === undefined) {
                        callback(true);
                        return;
                    }

                    // Block cross-storage moves in dual-storage Chrome
                    callback(sourceParent.syncing === targetParent.syncing);
                });
            });
        });
    };

    // Drag and drop, baby
    let draggedBookmark = null;
    let draggedOut = false;
    let canDrop = false;
    let zoomLevel = 1;
    let noOpenBookmark = false; // flag that disables opening bookmark
    const bookmarkClone = document.getElementById('bookmark-clone');
    const dropOverlay = document.getElementById('drop-overlay');
    $tree.addEventListener('mousedown', e => {
        if (e.button !== 0) //left-click
            return;
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        const elParent = el.parentNode; //li
        if (el.dataset && el.dataset.virtual) // recent-section entries can't be dragged
            return;
        // can move any bookmarks/folders except the default root folders
        if ((el.tagName === 'A' && elParent.classList.contains('child')) ||
            (el.tagName === 'SPAN' && elParent.classList.contains('parent') && !isDOMElementRootFolder(elParent))) {
            e.preventDefault();
            draggedOut = false;
            draggedBookmark = el; //a
            if (store.get('zoom'))
                zoomLevel = parseInt(store.get('zoom'), 10) / 100;
            bookmarkClone.innerHTML = el.innerHTML; //<a>..</a>
            el.focus();
        }
    });
    let scrollTree = null,
        scrollTreeInterval = 100,
        scrollTreeSpot = 10;
    const stopScrollTree = () => {
        clearInterval(scrollTree);
        scrollTree = null;
    };
    document.addEventListener('mousemove', e => {
        let top;
        let elRectBottom;
        let elRectTop;
        let elRect;
        if (e.button !== 0)
            return;
        if (!draggedBookmark)
            return;
        e.preventDefault();
        let el = e.target;
        let clientX = e.clientX;
        let clientY = e.clientY;
        //fixed clientY
        clientY += document.body.scrollTop;
        //hovering over the dragged element itself
        if (el === draggedBookmark) {
            bookmarkClone.style.left = '-999px';
            dropOverlay.style.left = '-999px';
            canDrop = false;
            return;
        }
        draggedOut = true;
        //cursor moves outside the tree
        const treeTop = $tree.offsetTop,
            treeBottom = window.innerHeight;
        if (clientX < 0 || clientY < treeTop || clientX > $tree.offsetWidth || clientY > treeBottom) {
            bookmarkClone.style.left = '-999px';
            dropOverlay.style.left = '-999px';
            canDrop = false;
        }
        // if hovering over the top or bottom edges of the tree,
        // scroll the tree
        const treeScrollHeight = $tree.scrollHeight,
            treeOffsetHeight = $tree.offsetHeight;
        if (treeScrollHeight > treeOffsetHeight) { // only scroll when it's scrollable
            const treeScrollTop = $tree.scrollTop;
            if (clientY <= treeTop + scrollTreeSpot) {
                if (treeScrollTop === 0) {
                    stopScrollTree();
                } else if (!scrollTree)
                    scrollTree = setInterval(() => {
                        $tree.scrollBy(0, -scrollTreeSpot);
                        dropOverlay.style.left = '-999px';
                    }, scrollTreeInterval);
            } else if (clientY >= treeBottom - scrollTreeSpot) {
                if (treeScrollTop === (treeScrollHeight - treeOffsetHeight)) {
                    stopScrollTree();
                } else if (!scrollTree)
                    scrollTree = setInterval(() => {
                        $tree.scrollBy(0, scrollTreeSpot);
                        dropOverlay.style.left = '-999px';
                    }, scrollTreeInterval);
            } else {
                stopScrollTree();
            }
        }
        // collapse the folder before moving it
        const draggedBookmarkParent = draggedBookmark.parentNode;
        if (draggedBookmark.tagName === 'SPAN' && draggedBookmarkParent.classList.contains('open')) {
            draggedBookmarkParent.classList.remove('open');
            draggedBookmarkParent.setAttribute('aria-expanded', false);
        }
        clientX /= zoomLevel;
        clientY /= zoomLevel;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        if (el.dataset && el.dataset.virtual) {
            // recent-section entries are not valid drop targets
            canDrop = false;
            bookmarkClone.style.top = `${clientY}px`;
            bookmarkClone.style.left = `${rtl ? (clientX - bookmarkClone.offsetWidth) : clientX}px`;
            dropOverlay.style.left = '-999px';
            return;
        }
        if (el.tagName === 'A' /* || el.tagName === 'HR'*/) {
            canDrop = true;
            bookmarkClone.style.top = `${clientY}px`;
            bookmarkClone.style.left = `${rtl ? (clientX - bookmarkClone.offsetWidth) : clientX}px`;
            elRect = el.getBoundingClientRect();
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            //fixed elRectBottom
            elRectBottom = elRect.bottom + document.body.scrollTop;
            top = (clientY >= elRectTop + elRect.height / 2) ? elRectBottom : elRectTop;
            dropOverlay.className = 'bookmark';
            dropOverlay.style.top = `${top}px`;
            dropOverlay.style.left = rtl ? '0px' : `${(parseInt(el.style.webkitPaddingStart, 10) || 0) + 16}px`;
            dropOverlay.style.width = `${(parseFloat(getComputedStyle(el).width) || 0) - 12}px`;
            dropOverlay.style.height = null;
        } else if (el.tagName === 'SPAN') {
            canDrop = true;
            bookmarkClone.style.top = `${clientY}px`;
            bookmarkClone.style.left = `${clientX}px`;
            elRect = el.getBoundingClientRect();
            top = null;
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            //fixed elRectBottom
            elRectBottom = elRect.bottom + document.body.scrollTop;
            const elRectHeight = elRect.height;
            const elParent = el.parentNode;
            if (!isDOMElementRootFolder(elParent)) {
                if (clientY < elRectTop + elRectHeight * .3) {
                    top = elRectTop;
                } else if (clientY > elRectTop + elRectHeight * .7 && !elParent.classList.contains('open')) {
                    top = elRectBottom;
                }
            }
            if (top === null) {
                dropOverlay.className = 'folder';
                dropOverlay.style.top = `${elRectTop}px`;
                dropOverlay.style.left = '0px';
                dropOverlay.style.width = `${elRect.width}px`;
                dropOverlay.style.height = `${elRect.height}px`;
            } else {
                dropOverlay.className = 'bookmark';
                dropOverlay.style.top = `${top}px`;
                dropOverlay.style.left = `${(parseInt(el.style.webkitPaddingStart, 10) || 0) + 16}px`;
                dropOverlay.style.width = `${(parseFloat(getComputedStyle(el).width) || 0) - 12}px`;
                dropOverlay.style.height = null;
            }
        }
    });
    const onDrop = () => {
        draggedBookmark = null;
        bookmarkClone.style.left = '-999px';
        dropOverlay.style.left = '-999px';
        canDrop = false;
        resetSeparator();
    };
    document.addEventListener('mouseup', e => {
        let moveBottom;
        let elRectTop;
        let elRect;
        if (e.button !== 0) //left-click
            return;
        if (!draggedBookmark)
            return;
        stopScrollTree();
        if (!canDrop) {
            if (draggedOut)
                noOpenBookmark = true;
            draggedOut = false;
            onDrop();
            return;
        }
        //el is the target element "A" "SPAN"
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        let elParent = el.parentNode; //li
        const id = elParent.id.replace('neat-tree-item-', '');
        if (!id) {
            onDrop();
            return;
        }
        const draggedBookmarkParent = draggedBookmark.parentNode; //li
        const draggedID = draggedBookmarkParent.id.replace('neat-tree-item-', '');

        const dragDisplay = () => {
            //display
            elParent.insertAdjacentElement(moveBottom ? 'afterend' : 'beforebegin', draggedBookmarkParent);
            draggedBookmark.style.webkitPaddingStart = el.style.webkitPaddingStart;
            draggedBookmark.focus();
            draggedBookmarkParent.setAttribute("level", elParent.getAttribute("level"));
            draggedBookmarkParent.setAttribute("data-parentid", elParent.getAttribute("data-parentid"));
            onDrop();
        }
        //fixed clientY
        const clientY = (e.clientY + document.body.scrollTop) / zoomLevel;
        if (el.tagName === 'A') { //dropped target is bookmark
            elRect = el.getBoundingClientRect();
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            moveBottom = (clientY >= elRectTop + elRect.height / 2);
            chrome.bookmarks.get(id, node => {
                if (!node || !node.length)
                    return;
                node = node[0];
                let index = node.index;
                const parentId = node.parentId;

                // Check for cross-storage move
                canMoveBetweenStorage(draggedID, parentId, (canMove) => {
                    if (!canMove) {
                        const msg = chrome.i18n.getMessage('crossStorageMoveWarning') ||
                                   'Cannot move bookmarks between synced and local storage.';
                        showBlockedToast(msg);
                        onDrop();
                        return;
                    }
                    chrome.bookmarks.move(draggedID, {
                        parentId: parentId,
                        index: moveBottom ? ++index : index
                    }, dragDisplay);
                });
            });
        } else if (el.tagName === 'SPAN') { //dropped target is directory
            elRect = el.getBoundingClientRect();
            let move = 0; // 0 = middle, 1 = top, 2 = bottom
            elRectTop = elRect.top;
            const elRectHeight = elRect.height;
            elParent = el.parentNode; //li
            if (!isDOMElementRootFolder(elParent)) {
                if (clientY < elRectTop + elRectHeight * .3) {
                    move = 1;
                } else if (clientY > elRectTop + elRectHeight * .7 && !elParent.classList.contains('open')) {
                    move = 2;
                }
            }
            if (move > 0) { //top or bottom
                moveBottom = (move === 2);
                chrome.bookmarks.get(id, node => {
                    if (!node || !node.length)
                        return;
                    node = node[0];
                    let index = node.index;
                    const parentId = node.parentId;
                    if (draggedID) {
                        // Check for cross-storage move
                        canMoveBetweenStorage(draggedID, parentId, (canMove) => {
                            if (!canMove) {
                                const msg = chrome.i18n.getMessage('crossStorageMoveWarning') ||
                                           'Cannot move bookmarks between synced and local storage.';
                                showBlockedToast(msg);
                                onDrop();
                                return;
                            }
                            chrome.bookmarks.move(draggedID, {
                                parentId: parentId,
                                index: moveBottom ? ++index : index
                            }, dragDisplay);
                        });
                    }
                });
            } else { //middle position
                // Check for cross-storage move before moving into folder
                canMoveBetweenStorage(draggedID, id, (canMove) => {
                    if (!canMove) {
                        const msg = chrome.i18n.getMessage('crossStorageMoveWarning') ||
                                   'Cannot move bookmarks between synced and local storage.';
                        showBlockedToast(msg);
                        onDrop();
                        return;
                    }
                    chrome.bookmarks.move(draggedID, {
                        parentId: id
                    }, () => {
                    const ul = elParent.querySelector('ul');
                    const level = parseInt(elParent.parentNode.dataset.level) + 1;
                    draggedBookmark.style.webkitPaddingStart = `${16 * level}px`;
                    if (ul) {
                        // a stale "(Empty)" marker must not survive a real drop
                        const emptyRow = ul.querySelector(':scope > li.empty-folder');
                        if (emptyRow)
                            emptyRow.remove();
                        ul.appendChild(draggedBookmarkParent); //inject into bottom of ul
                        draggedBookmarkParent.setAttribute("level", parseInt(elParent.getAttribute("level")) + 1);
                        draggedBookmarkParent.setAttribute("data-parentid", id);
                    } else {
                        draggedBookmarkParent.remove();
                    }
                    el.focus();
                    onDrop();
                }); // close chrome.bookmarks.move callback
                }); // close canMoveBetweenStorage callback
            }
        } else {
            onDrop();
        }
    });

    return {
        isDragging: () => !!draggedBookmark,
        consumeNoOpen: () => {
            const flag = noOpenBookmark;
            noOpenBookmark = false;
            return flag;
        }
    };
}
