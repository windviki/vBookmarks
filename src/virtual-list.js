/**
 * Virtualized list painting (4.1.0 LAB — behind the options-page 实验室
 * switch `virtualScrollLab`, default OFF; promoted to a default only after
 * real-world soak, per the P2 virtual-scrolling judgment in
 * docs/plan-4.1.0/build-and-performance-plan.md §4.5).
 *
 * Where list-chunks.js streams every row into the DOM across frames (total
 * work unchanged, first paint early), the virtual painter keeps ONLY the
 * viewport window (+ overscan) in the DOM at any time: off-screen geometry
 * is two paddings on the rows <ul>, sized from a per-piece height estimate
 * (row count × the 28px row height; a piece with k <li> tags estimates
 * k rows — group blocks carry head + members). A 2508-row dupes list then
 * lays out ~50 rows instead of 2508 — the parse+style+layout bill drops
 * from O(total) to O(viewport) on EVERY re-render, not just the first.
 *
 * Same head/pieces contract as list-chunks.js, so the views swap painters
 * behind the flag without touching their row builders. Callback contract:
 * onHead fires after the initial window lands; onChunk fires after every
 * re-window (the views' id-based focus restores retry there); onSettled
 * fires once after the initial window (mirrors the chunked painter's shape
 * so the views' settle logic runs — note its clamped-INDEX row restore is
 * only meaningful when the window covers everything; the handle's
 * `partial` flag tells the caller).
 *
 * Known lab limitations (why this is behind a flag):
 *  - heights are ESTIMATES (28px/row): wide/panel two-line rows and
 *    wrapped titles drift the scrollbar; scrolling is stable but the
 *    thumb's size/position are approximate;
 *  - keyboard End/Home land on the last/first RENDERED row; the focusin
 *    edge extension pages the window so ↓/↑ walks keep working, but End
 *    past the window's edge is a two-step;
 *  - anything keyed by clamped row index is approximate (id-based
 *    restores work — the dupes head-fold focus, the row park/restore).
 */

const ROW_H = 28;        // --vbm-row-h; keep in sync with css/neat.css
const OVERSCAN = 8;      // rows kept rendered above/below the viewport
const FALLBACK_VIEW_ROWS = 30; // geometry-less environments (unit doubles)

// Rows in one piece: count '<li' TAG openings (the char after must be a
// space or '>' — not '<link' text). A piece is at least one row.
const liCount = piece => {
    let n = 0, at = -1;
    while ((at = piece.indexOf('<li', at + 1)) !== -1) {
        if (at + 3 >= piece.length || /[\s>]/.test(piece[at + 3]))
            n++;
    }
    return Math.max(1, n);
};

export const paintListVirtual = (list, opts = {}) => {
    const {
        head = '',
        pieces = [],
        revealIndex = null,   // piece index to scroll to on first paint
        onHead = null,
        onChunk = null,
        onSettled = null
    } = opts;

    const syncPaint = () => {
        list.innerHTML = head + pieces.join('');
        if (onHead)
            onHead(list);
        if (onSettled)
            onSettled(list);
        return { cancelled: false, partial: false, cancel() { this.cancelled = true; } };
    };

    if (typeof list.querySelector !== 'function'
        || typeof list.insertAdjacentHTML !== 'function')
        return syncPaint();

    // --- geometry model (piece-granular prefix sums) ----------------------
    // Heights start as estimates (row count × ROW_H). Every applied window
    // is then MEASURED against the real rendered <li>s (offsetHeight) and
    // the prefix sums rebuilt — visited regions get exact heights, so the
    // scrollbar converges on reality instead of drifting on two-line
    // wide/panel rows (the LAB's chief limitation). Pieces whose children
    // report no usable height (unit doubles, cv:auto offscreen rows that
    // never laid out) keep their estimate.
    const liCounts = pieces.map(liCount);
    const heights = liCounts.map(n => n * ROW_H);
    let tops = null;
    const rebuildTops = () => {
        tops = new Array(pieces.length + 1);
        tops[0] = 0;
        for (let i = 0; i < pieces.length; i++)
            tops[i + 1] = tops[i] + heights[i];
    };
    rebuildTops();
    const totalH = () => tops[pieces.length];

    const measure = (from, to) => {
        const children = ul.children;
        if (!children || typeof children.length !== 'number' || !children.length)
            return false;
        let ci = 0;
        let changed = false;
        for (let i = from; i < to; i++) {
            const k = liCounts[i];
            let h = 0;
            let ok = true;
            for (let j = 0; j < k; j++) {
                const li = children[ci + j];
                if (!li || typeof li.offsetHeight !== 'number' || li.offsetHeight <= 0) {
                    ok = false;
                    break;
                }
                h += li.offsetHeight;
            }
            ci += k;
            if (ok && h > 0 && h !== heights[i]) {
                heights[i] = h;
                changed = true;
            }
        }
        return changed;
    };

    const viewportH = () => {
        const h = list.clientHeight || list.offsetHeight || 0;
        return h > 0 ? h : FALLBACK_VIEW_ROWS * ROW_H;
    };
    // Window [start, end) covering scrollTop−overscan .. scrollTop+viewport+overscan.
    const windowFor = scrollTop => {
        const topEdge = Math.max(0, scrollTop - OVERSCAN * ROW_H);
        const botEdge = scrollTop + viewportH() + OVERSCAN * ROW_H;
        let start = 0;
        while (start < pieces.length && tops[start + 1] <= topEdge)
            start++;
        let end = start;
        while (end < pieces.length && tops[end] < botEdge)
            end++;
        return [start, end];
    };

    // --- head paint + initial window --------------------------------------
    // Capture the scroll position BEFORE the head paint: replacing the list
    // content collapses its height and a real DOM clamps scrollTop to 0 —
    // reading it after would silently re-window to the top on every
    // re-render (the user's scroll position must survive data refreshes).
    const savedScroll = list.scrollTop || 0;
    list.innerHTML = head;
    let ul = null;
    for (let el = list.lastElementChild; el; el = el.previousElementSibling) {
        if (el.tagName === 'UL') {
            ul = el;
            break;
        }
    }
    if (!ul || typeof ul.insertAdjacentHTML !== 'function')
        return syncPaint();

    const state = { cancelled: false };
    let start = 0, end = 0, rafPending = false;

    const apply = (from, to) => {
        let html = '';
        for (let i = from; i < to; i++)
            html += pieces[i];
        ul.innerHTML = html;
        // Measure BEFORE the padding write: this window's real heights move
        // tops[to] (and the total), so the paddings must reflect the updated
        // prefix sums — a scrollbar sized from stale estimates is the drift
        // the LAB was known for.
        if (measure(from, to))
            rebuildTops();
        ul.style.paddingTop = tops[from] + 'px';
        ul.style.paddingBottom = (totalH() - tops[to]) + 'px';
        start = from;
        end = to;
    };

    // The paddings must exist BEFORE the scroll write (a scrollTop set on a
    // short list clamps to 0), so: window for the DESIRED scroll first,
    // apply it, then move scrollTop — geometry is already in place.
    const wanted = (revealIndex != null && pieces[revealIndex] !== undefined)
        ? Math.max(0, tops[revealIndex] - Math.round(viewportH() / 3))
        : savedScroll;
    const w0 = windowFor(wanted);
    apply(w0[0], w0[1]);
    if (list.scrollTop !== undefined && list.scrollTop !== wanted)
        list.scrollTop = wanted;
    if (onHead)
        onHead(list);
    if (onSettled)
        onSettled(list);

    // --- live re-windowing --------------------------------------------------
    const scheduleRewindow = () => {
        if (rafPending || state.cancelled)
            return;
        const run = () => {
            rafPending = false;
            if (state.cancelled)
                return;
            const [from, to] = windowFor(list.scrollTop || 0);
            if (from !== start || to !== end) {
                apply(from, to);
                if (onChunk)
                    onChunk(list);
            }
        };
        if (typeof requestAnimationFrame === 'function') {
            rafPending = true;
            requestAnimationFrame(run);
        } else {
            run();
        }
    };

    const onScroll = () => scheduleRewindow();

    // Keyboard walking at the window's edge: focusing the FIRST/LAST rendered
    // row pages the window one viewport toward that side, so a held ↓ keeps
    // advancing (the next row materializes and takes the next ↓).
    const onFocusIn = e => {
        if (state.cancelled)
            return;
        const t = e.target;
        const li = t && t.closest ? t.closest('li') : null;
        if (!li || !ul.contains(li))
            return;
        const size = end - start;
        const page = Math.max(1, Math.round(viewportH() / ROW_H));
        if (li === ul.lastElementChild && end < pieces.length) {
            const from = Math.min(start + page, Math.max(0, pieces.length - size));
            apply(from, Math.min(pieces.length, from + size));
            if (onChunk)
                onChunk(list);
        } else if (li === ul.firstElementChild && start > 0) {
            const from = Math.max(0, start - page);
            apply(from, Math.min(pieces.length, from + size));
            if (onChunk)
                onChunk(list);
        }
    };

    if (typeof list.addEventListener === 'function') {
        list.addEventListener('scroll', onScroll, { passive: true });
        list.addEventListener('focusin', onFocusIn);
    }

    return {
        cancelled: false,
        partial: !(start === 0 && end >= pieces.length),
        cancel() {
            state.cancelled = true;
            this.cancelled = true;
            if (typeof list.removeEventListener === 'function') {
                list.removeEventListener('scroll', onScroll);
                list.removeEventListener('focusin', onFocusIn);
            }
            ul.style.paddingTop = '';
            ul.style.paddingBottom = '';
        }
    };
};
