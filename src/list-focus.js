/**
 * Row-focus park/restore (4.0.1 focus law) shared by every list view
 * (recent / stats / dead / dupes).
 *
 * A render's innerHTML swap replaces every row, so a focused row drops to
 * <body> and the ↓ walk dies. Park the focused row before the swap, restore
 * it after — by row id when the row carries one, else by its index among the
 * list's <li>s, clamped on restore so a vanished row lands on the row that
 * took its place; an emptied list parks on the container itself.
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

// Restore focus to the parked row (by id, else clamped index), falling back
// to the list container itself when the list came back empty.
export const unparkRowFocus = (list, parked) => {
    if (!parked)
        return;
    let li = parked.id ? document.getElementById(parked.id) : null;
    if (!li) {
        if (typeof list.querySelectorAll !== 'function')
            return;
        const lis = list.querySelectorAll('li');
        if (!lis.length) {
            // no rows at all — park focus on the list container itself
            if (list.focus)
                list.focus();
            return;
        }
        li = lis[Math.min(parked.idx, lis.length - 1)];
    }
    if (!li)
        return;
    // A row carrying tabindex takes the focus itself; plain rows hand it to
    // their anchor/span — the same element keyboard.js's row walk focuses.
    // (getAttribute is guarded: test doubles may lack it.)
    const target = (li.getAttribute && li.getAttribute('tabindex') !== null)
        ? li
        : (li.querySelector ? li.querySelector('a, span') : null);
    if (target && target.focus)
        target.focus();
};
