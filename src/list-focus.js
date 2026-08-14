/**
 * Row-focus park/restore (4.0.1 focus law) shared by every list view
 * (recent / stats / dead / dupes — and the search view's history area).
 *
 * A render's innerHTML swap replaces every row, so a focused row drops to
 * <body> and the ↓ walk dies. Park the focused row before the swap, restore
 * it after — by row id when the row carries one, else by its index among the
 * list's <li>s, clamped on restore so a vanished row lands on the row that
 * took its place; an emptied list parks on the container itself (or the
 * caller's `emptyFocus` fallback). Also shared here: the row's focus-target
 * contract (rowFocusTarget — the anchor/span, or the tabindex row container)
 * and the list views' toolbar focus park/restore trio.
 */

// Capture the list row that currently owns focus (or null when focus is not
// inside `list`).
export const parkRowFocus = list => {
    let li = document.activeElement;
    while (li && li.tagName !== 'LI')
        li = li.parentNode;
    // the row must belong to THIS list — another view's row does not count
    for (let p = li; p; p = p.parentNode) {
        if (p !== list)
            continue;
        if (typeof list.querySelectorAll !== 'function')
            return null;
        const lis = list.querySelectorAll('li');
        for (let i = 0, l = lis.length; i < l; i++)
            if (lis[i] === li)
                return { id: li.id || '', idx: i };
        return null;
    }
    return null;
};

// The element of a list row that takes the focus: a row carrying tabindex
// takes it itself (the dead view's start row); plain rows hand it to their
// anchor/span — the same element keyboard.js's row walk focuses. Never a
// firstElementChild heuristic: a row leading with a <button> (the dupes
// member rows' keeper radio) must still resolve to the anchor behind it.
// Shared by view-manager.js's remembered-row restores. (getAttribute/
// querySelector are guarded: test doubles may lack them.)
export const rowFocusTarget = li =>
    (li.getAttribute && li.getAttribute('tabindex') !== null)
        ? li
        : (li.querySelector ? li.querySelector('a, span') : null);

// Restore focus to the parked row (by id, else clamped index). An emptied
// list falls back to `emptyFocus` when given (search.js's history area hands
// the focus back to its search box), else to the list container itself.
export const unparkRowFocus = (list, parked, emptyFocus) => {
    if (!parked)
        return;
    let li = parked.id ? document.getElementById(parked.id) : null;
    if (!li) {
        if (typeof list.querySelectorAll !== 'function')
            return;
        const lis = list.querySelectorAll('li');
        if (!lis.length) {
            // no rows at all — park focus on the fallback element
            const alt = emptyFocus || list;
            if (alt && alt.focus)
                alt.focus();
            return;
        }
        li = lis[Math.min(parked.idx, lis.length - 1)];
    }
    if (!li)
        return;
    const target = rowFocusTarget(li);
    if (target && target.focus)
        target.focus();
};

// --- Toolbar focus park/restore (final polish) ------------------------------
// Shared by the stats/dead/dupes views: the toolbar re-renders together with
// the rows (a sort switch, a clear, every scan-progress tick), and without a
// restore a keyboard user holding focus on a control loses it to <body> on
// every repaint. The controls are positionally stable across re-renders, so
// an index suffices. The selector is the caller's: dead/dupes pass
// TOOLBAR_SEL_RISK so their risk banner's controls ride along (v4 task-4 #14).
export const TOOLBAR_SEL = '.vbm-toolbar button, .vbm-toolbar select, .vbm-toolbar input';
export const TOOLBAR_SEL_RISK = `${TOOLBAR_SEL}, .risk-banner button, .risk-banner a[href]`;

// Index of the focused control within root's `sel` set (-1: focus elsewhere).
export const toolbarFocusIndex = (root, sel = TOOLBAR_SEL) => {
    if (typeof root.querySelectorAll !== 'function')
        return -1;
    const controls = root.querySelectorAll(sel);
    for (let i = 0, l = controls.length; i < l; i++)
        if (controls[i] === document.activeElement)
            return i;
    return -1;
};

// Focus back the `idx`-th control of root's `sel` set after the re-render.
export const restoreToolbarFocus = (root, idx, sel = TOOLBAR_SEL) => {
    if (idx < 0 || typeof root.querySelectorAll !== 'function')
        return;
    const c = root.querySelectorAll(sel)[idx];
    if (c && c.focus)
        c.focus();
};
