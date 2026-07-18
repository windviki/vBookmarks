/**
 * Undo stack (P3.3) — deletion snapshots + the toast undo bar.
 *
 * Replaces the old sync-manager undoStack, which lived in popup memory (lost
 * when the popup closed) and could only recreate a single node (folder
 * children were dropped). Here every deletion is captured BEFORE it happens
 * via chrome.bookmarks.getSubTree, so the full recursive subtree — children,
 * grandchildren, order — survives in the snapshot.
 *
 * The stack persists in chrome.storage.session under the `vbmUndoStack` key
 * (JSON array, newest last, capped at 10 entries with the oldest shifted
 * out), so it outlives popup open/close cycles but never the browser
 * session. Writes are plain sets after every mutation — no debounce, the
 * stack is tiny.
 *
 * initUndo(ctx) is called once by neat.js, before initActions. ctx.onChanged
 * is the tree-refresh callback invoked after a successful undo (neat.js
 * passes the same chrome.bookmarks.getTree(treeView.generateTree) closure
 * the sort flow uses). The returned API:
 *
 *   capture(id)  — snapshot the subtree rooted at `id` and push it; MUST be
 *                  called before the deletion (Chrome applies API calls in
 *                  issue order, so a getSubTree issued ahead of remove /
 *                  removeTree still sees the node). A failed getSubTree
 *                  (node already gone, chrome.runtime.lastError) is skipped
 *                  silently.
 *   undo()       — async; pops the newest entry and recreates it: the root
 *                  at its original parentId/index, then the children
 *                  strictly serially depth-first in their original order (no
 *                  explicit index — positions increment naturally as each
 *                  create resolves). On full success the stack is written
 *                  back, ctx.onChanged() runs and it resolves true. Any
 *                  create failure logs to console.error, KEEPS whatever was
 *                  already recreated (no rollback — a half-restored folder
 *                  is worth more than none, and rolling back could destroy
 *                  bookmarks the user has since edited), persists the popped
 *                  stack and resolves false. Empty stack resolves false.
 *   canUndo()    — whether the stack is non-empty.
 *   peek()       — { title, isFolder } of the newest entry, or null (toast
 *                  copy helper).
 *   showToast(message) — bottom toast bar (#undo-toast, added next to
 *                  #quick-add-toast in popup.html/sidepanel.html) with the
 *                  given text and an undo button; auto-hides after 8s,
 *                  repeated calls reset the timer. The button runs undo()
 *                  and hides the toast when it settles. Missing toast DOM
 *                  makes showToast a no-op.
 *
 * No neatools here: plain getElementById / DOM calls, and i18n goes straight
 * through chrome.i18n.getMessage like every other popup module.
 */

const STORAGE_KEY = 'vbmUndoStack';
const MAX_UNDO = 10;
const TOAST_MS = 8000;

export function initUndo(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    let stack = [];

    // storage.session mirrors the stack across popup lifetimes.
    const session = chrome.storage.session;
    session.get(STORAGE_KEY, result => {
        const saved = result && result[STORAGE_KEY];
        // Don't clobber entries captured while the read was in flight.
        if (Array.isArray(saved) && saved.length && !stack.length)
            stack = saved;
    });
    const persist = () => {
        session.set({ [STORAGE_KEY]: stack });
    };

    const createNode = props => new Promise((resolve, reject) => {
        chrome.bookmarks.create(props, node => {
            const err = chrome.runtime && chrome.runtime.lastError;
            if (err)
                reject(err);
            else
                resolve(node);
        });
    });

    // Recreate `node` under parentId and, for folders, rebuild its children
    // serially depth-first in their original order. Only the subtree root
    // gets an explicit index; deeper nodes append in creation order.
    const restoreNode = async (node, parentId, index) => {
        const props = { parentId, title: node.title };
        if (index !== undefined)
            props.index = index;
        if (node.url)
            props.url = node.url;
        const created = await createNode(props);
        for (const child of node.children || [])
            await restoreNode(child, created.id);
    };

    const capture = id => {
        chrome.bookmarks.getSubTree(id, nodes => {
            if ((chrome.runtime && chrome.runtime.lastError) || !nodes || !nodes.length)
                return;
            const root = nodes[0];
            stack.push({ parentId: root.parentId, index: root.index, node: root });
            while (stack.length > MAX_UNDO)
                stack.shift();
            persist();
        });
    };

    const undo = async () => {
        const entry = stack.pop();
        if (!entry)
            return false;
        try {
            await restoreNode(entry.node, entry.parentId, entry.index);
        } catch (e) {
            console.error('vBookmarks: undo failed:', e);
            persist();
            return false;
        }
        persist();
        if (ctx.onChanged)
            ctx.onChanged();
        return true;
    };

    const canUndo = () => stack.length > 0;

    const peek = () => {
        const entry = stack[stack.length - 1];
        return entry ? { title: entry.node.title, isFolder: !entry.node.url } : null;
    };

    // Toast bar — the DOM rides next to #quick-add-toast in both pages.
    const toast = $('undo-toast');
    const toastText = $('undo-toast-text');
    const toastButton = $('undo-toast-button');
    let toastTimer = null;
    const hideToast = () => {
        clearTimeout(toastTimer);
        toastTimer = null;
        if (toast)
            toast.hidden = true;
    };
    const showToast = message => {
        if (!toast)
            return;
        if (toastText)
            toastText.textContent = message;
        toast.hidden = false;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, TOAST_MS);
    };
    if (toastButton) {
        toastButton.textContent = _m('undoAction');
        toastButton.addEventListener('click', async () => {
            await undo();
            hideToast();
        });
    }

    return { capture, undo, canUndo, peek, showToast };
}
