/**
 * Chunked list painting (4.1.1 perf).
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
        first = 60,          // rows in the synchronous head paint
        chunk = 120,         // rows per animation-frame batch
        onHead = null,
        onChunk = null,
        onSettled = null
    } = opts;

    const domCapable = typeof list.querySelector === 'function'
        && typeof list.insertAdjacentHTML === 'function';

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
        if (html) {
            if (ul && typeof ul.insertAdjacentHTML === 'function')
                ul.insertAdjacentHTML('beforeend', html);
            else if (typeof list.insertAdjacentHTML === 'function')
                list.insertAdjacentHTML('beforeend', html);
        }
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

    const batchFrames = frameScheduler();
    // Degenerate shapes and tiny lists: one synchronous paint, no machinery.
    if (!batchFrames || pieces.length <= first || !domCapable)
        return paintAll();

    const state = { cancelled: false };
    const ul = paintHeadAndAppend(pieces.slice(0, first).join(''));
    if (!ul || typeof ul.insertAdjacentHTML !== 'function')
        return paintAll();   // head carried no <ul> — repaint everything
    let at = first;

    if (onHead)                  // head is in — the toolbar and the first
        onHead(list);            // rows exist before we yield the thread

    const pump = () => {
        if (state.cancelled)
            return;
        const end = Math.min(at + chunk, pieces.length);
        let html = '';
        for (let i = at; i < end; i++)
            html += pieces[i];
        if (html)
            ul.insertAdjacentHTML('beforeend', html);
        at = end;
        if (onChunk)
            onChunk(list);
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
