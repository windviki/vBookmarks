/**
 * Chunked list painting (4.1.0 perf).
 *
 * The list views (tab-groups, dupes) build their rows as one giant
 * innerHTML string. At the maintainer's real-world scale that string is
 * 1-2 MB across 1300-2500 rows and the browser pays it in one bite: the
 * profiler put ~470 ms of a 2508-row dupes render into the synchronous
 * HTML parse and ~1.7 s into the follow-on style/layout of a 1371-row
 * tab-groups refresh — the main thread freezes for the whole span, which
 * is exactly the "click, then wait seconds for the tree" report.
 *
 * paintListChunked splits the SAME markup into a head paint (toolbar +
 * <ul> + first rows, synchronous — focus park/restore and the toolbar
 * swaps must land immediately) and row pieces appended into the head's
 * <ul> in requestAnimationFrame batches. First content reaches the screen
 * in the first frame; the rest streams in behind it. Total work is
 * unchanged; interactivity is preserved.
 *
 * 4.1.0 perf round 2 — three extensions, all backward compatible:
 *  - adaptive: true re-sizes each subsequent batch from the MEASURED cost
 *    of the previous insert (parse is ~linear in rows on one machine but
 *    the slope varies wildly across devices); the batch count is no longer
 *    a fixed 2508-rows→42-frames staircase.
 *  - onChunk(list, from, end) receives the slice bounds, so the views can
 *    retry piece-indexed focus restores ONLY once their piece is in —
 *    no per-batch whole-list querySelectorAll scans.
 *  - pipes: [{ ul, pieces, first, chunk }] streams several <ul>s (the dead
 *    view's result list + marked-residue list) from ONE head paint. The
 *    single-list form is exactly the old behavior.
 *
 * Contract notes:
 *  - `head` must END with the (closed, possibly empty) <ul> the pieces go
 *    into — every path below paints the head first, discovers that <ul> in
 *    the FRESH content, and appends the rows INSIDE it. Concatenating
 *    pieces after a closed </ul> instead would strand the <li>s as
 *    siblings of the list (verified: the keyboard row walks and every
 *    `#x-list ul li` CSS rule missed them — caught by the Docker keyboard
 *    gate, invisible to the string-concat unit doubles).
 *  - Without requestAnimationFrame, without querySelector/
 *    insertAdjacentHTML on the list (the unit-test doubles), or for lists
 *    small enough to fit in the first chunk, everything degrades to ONE
 *    synchronous paint that appends all pieces into the same <ul> —
 *    callers never need a fallback.
 *  - onHead fires right after the head paint (toolbar focus restore;
 *    row-focus targets inside the first chunk); onChunk fires after each
 *    appended batch (retry restores that depend on rows further down);
 *    onSettled fires once the last piece is in (deferred scroll-into-view,
 *    row-focus restore by clamped index). The synchronous paint fires
 *    onHead + onSettled only — no appended batch happened.
 *  - The returned handle's cancel() drops every pending batch — a newer
 *    render must never race an older one's tail chunks.
 */

// Resolved per CALL, not at import time: the scheduler must reflect the
// environment the current paint runs in (and stay stubbable in tests).
const frameScheduler = () =>
    (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : null;

export const paintListChunked = (list, opts = {}) => {
    const {
        head = '',
        pieces = [],
        pipes = null,        // [{ ul, pieces, first, chunk }] — multi-list mode
        first = 60,          // rows in the synchronous head paint
        chunk = 120,         // rows per animation-frame batch
        adaptive = false,    // re-size batches from the measured insert cost
        budgetMs = 12,       // target parse budget per frame (adaptive only)
        minChunk = 24,
        maxChunk = 240,
        onHead = null,
        onChunk = null,
        onSettled = null
    } = opts;

    const domCapable = typeof list.querySelector === 'function'
        && typeof list.insertAdjacentHTML === 'function';

    const appendInto = (ul, html) => {
        if (ul && typeof ul.insertAdjacentHTML === 'function')
            ul.insertAdjacentHTML('beforeend', html);
        else if (typeof list.insertAdjacentHTML === 'function')
            list.insertAdjacentHTML('beforeend', html);
    };

    // Paint the head, find the rows <ul> in the fresh content (the LAST
    // ul-tagged element — the head ends with it), append `html` inside it.
    // Returns the ul (null when the head carries none).
    const paintHeadAndAppend = html => {
        list.innerHTML = head;
        let ul = null;
        for (let el = list.lastElementChild; el; el = el.previousElementSibling) {
            if (el.tagName === 'UL') {
                ul = el;
                break;
            }
        }
        if (html)
            appendInto(ul, html);
        return ul;
    };

    const paintAll = () => {
        if (domCapable) {
            paintHeadAndAppend(pieces.join(''));
        } else {
            // String-concat doubles: the concatenation IS the model.
            list.innerHTML = head + pieces.join('');
        }
        if (onHead)
            onHead(list);
        if (onSettled)
            onSettled(list);
        return { cancelled: false, cancel() { this.cancelled = true; } };
    };

    // --- multi-list pipes mode (dead view: result list + marked list) --------
    if (pipes && pipes.length) {
        const paintPipesAll = () => {
            if (domCapable) {
                list.innerHTML = head;
                for (const p of pipes) {
                    const ul = p.ul
                        ? list.querySelector(p.ul)
                        : null;
                    appendInto(ul, (p.pieces || []).join(''));
                }
            } else {
                list.innerHTML = head + pipes.map(p => (p.pieces || []).join('')).join('');
            }
            if (onHead)
                onHead(list);
            if (onSettled)
                onSettled(list);
            return { cancelled: false, cancel() { this.cancelled = true; } };
        };

        const batchFrames = frameScheduler();
        if (!batchFrames || !domCapable)
            return paintPipesAll();
        // Resolve every pipe's <ul> in the fresh head; any missing ul
        // (or a list too small to split) falls back to one paint. Each
        // pipe's `first` slice lands synchronously with the head (the
        // single-list contract): the first rows exist before we yield.
        list.innerHTML = head;
        const resolved = [];
        for (const p of pipes) {
            const ul = p.ul ? list.querySelector(p.ul) : null;
            if (!ul || typeof ul.insertAdjacentHTML !== 'function')
                return paintPipesAll();
            const at = Math.min(p.first || 0, (p.pieces || []).length);
            let html = '';
            for (let i = 0; i < at; i++)
                html += p.pieces[i];
            if (html)
                ul.insertAdjacentHTML('beforeend', html);
            resolved.push({ ...p, ul, at });
        }
        if (onHead)
            onHead(list);
        const state = { cancelled: false };
        let remaining = resolved.length;
        // Adaptive sizing in pipes mode (4.1.0 perf round 2): one shared
        // scale over every pipe's base chunk — the whole round shares one
        // frame budget, so the cost of ALL inserts feeds back together.
        const now = typeof performance !== 'undefined' && performance.now
            ? () => performance.now()
            : null;
        let scale = 1;
        const adapt = costMs => {
            if (!costMs)
                return;
            if (costMs > budgetMs)
                scale = Math.max(minChunk / Math.max(1, chunk), scale * (budgetMs / costMs));
            else if (costMs < budgetMs * 0.4)
                scale = Math.min(maxChunk / Math.max(1, chunk), scale * 1.6);
        };
        const pump = () => {
            if (state.cancelled)
                return;
            remaining = 0;
            const t0 = adaptive && now ? now() : 0;
            for (const p of resolved) {
                if (p.at >= p.pieces.length)
                    continue;
                remaining++;
                const size = adaptive
                    ? Math.max(minChunk, Math.round((p.chunk || chunk) * scale))
                    : (p.chunk || chunk);
                const from = p.at;
                const end = Math.min(from + size, p.pieces.length);
                let html = '';
                for (let i = from; i < end; i++)
                    html += p.pieces[i];
                if (html)
                    p.ul.insertAdjacentHTML('beforeend', html);
                p.at = end;
                if (onChunk)
                    onChunk(list, from, end);
            }
            if (adaptive && now && remaining)
                adapt(now() - t0);
            if (remaining)
                batchFrames(pump);
            else if (onSettled)
                onSettled(list);
        };
        batchFrames(pump);
        return {
            cancelled: false,
            cancel() {
                state.cancelled = true;
                this.cancelled = true;
            }
        };
    }

    // --- single-list mode ------------------------------------------------------
    const batchFrames = frameScheduler();
    // Degenerate shapes and tiny lists: one synchronous paint, no machinery.
    if (!batchFrames || pieces.length <= first || !domCapable)
        return paintAll();

    const state = { cancelled: false };
    const ul = paintHeadAndAppend(pieces.slice(0, first).join(''));
    if (!ul || typeof ul.insertAdjacentHTML !== 'function')
        return paintAll();   // head carried no <ul> — repaint everything
    let at = first;
    let nextChunk = chunk;

    if (onHead)                  // head is in — the toolbar and the first
        onHead(list);            // rows exist before we yield the thread

    const now = typeof performance !== 'undefined' && performance.now
        ? () => performance.now()
        : null;
    // Adaptive sizing: after each measured insert, walk the next batch
    // toward the parse budget (grow gently, shrink proportionally).
    const adapt = costMs => {
        if (!costMs)
            return;
        if (costMs > budgetMs)
            nextChunk = Math.max(minChunk, Math.round(nextChunk * (budgetMs / costMs)));
        else if (costMs < budgetMs * 0.4)
            nextChunk = Math.min(maxChunk, Math.round(nextChunk * 1.6));
    };

    const pump = () => {
        if (state.cancelled)
            return;
        const from = at;
        const end = Math.min(at + nextChunk, pieces.length);
        let html = '';
        for (let i = from; i < end; i++)
            html += pieces[i];
        if (html) {
            if (adaptive && now) {
                const t0 = now();
                ul.insertAdjacentHTML('beforeend', html);
                adapt(now() - t0);
            } else {
                ul.insertAdjacentHTML('beforeend', html);
            }
        }
        at = end;
        if (onChunk)
            onChunk(list, from, end);
        if (at < pieces.length)
            batchFrames(pump);
        else if (onSettled)
            onSettled(list);
    };
    batchFrames(pump);

    return {
        cancelled: false,
        cancel() {
            state.cancelled = true;
            this.cancelled = true;
        }
    };
};
