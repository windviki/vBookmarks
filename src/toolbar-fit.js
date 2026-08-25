/**
 * Selection action-rung label fitting (shared, extracted from view-recent's
 * 2026-08 implementation): the iconified batch buttons reveal their text
 * labels ONE BY ONE from the right edge as free width allows — measured per
 * render/resize instead of container breakpoints, so every extra pixel earns
 * the next label.
 *
 * fitToolbarLabels(bar): reset + greedily reveal. Pure DOM measurement; safe
 * on hand-written doubles (guards querySelector/offsetWidth).
 * watchToolbarFit(listEl, isActive): one ResizeObserver per list container —
 * re-fits on width changes while the caller's selection mode is live.
 */
export const fitToolbarLabels = bar => {
    if (!bar || !bar.querySelectorAll || typeof bar.querySelectorAll !== 'function')
        return;
    const btns = [...bar.querySelectorAll('.vbm-fit-btn')];
    if (!btns.length)
        return;
    for (const b of btns) {
        const lab = b.querySelector('.vbm-fit-label');
        if (lab)
            lab.style.display = 'none';
        b.style.width = '';
        b.style.padding = '';
    }
    // free width = bar box − padding − buttons − inter-button gaps
    let used = 16; // 8px + 8px bar padding
    for (const b of btns)
        used += b.offsetWidth;
    used += 6 * Math.max(0, btns.length - 1); // the toolbar gap
    let free = bar.clientWidth - used;
    // rightmost first — the danger pair leads, then organize/favorite group,
    // then the open pair on the left
    for (let i = btns.length - 1; i >= 0 && free > 0; i--) {
        const b = btns[i];
        const lab = b.querySelector('.vbm-fit-label');
        if (!lab)
            continue;
        const before = b.offsetWidth;
        lab.style.display = 'inline';
        b.style.width = 'auto';
        b.style.padding = '2px 6px';
        const delta = b.offsetWidth - before;
        if (delta <= free)
            free -= delta;
        else {
            lab.style.display = 'none';
            b.style.width = '';
            b.style.padding = '';
            break;
        }
    }
};

// One observer per list container (persistent element). Width change only —
// the fit itself only mutates the labels, never the container's width.
export const watchToolbarFit = (listEl, fit) => {
    if (typeof ResizeObserver === 'undefined' || !listEl)
        return () => {};
    let lastW = -1;
    const ro = new ResizeObserver(entries => {
        const w = entries.length ? entries[0].contentRect.width : lastW;
        if (w === lastW)
            return;
        lastW = w;
        fit();
    });
    ro.observe(listEl);
    return () => ro.disconnect();
};
