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
 *  - `head` must contain the (closed, possibly empty) <ul> the pieces go
 *    into — the helper finds it as the list's last <ul>-tagged child and
 *    appends every batch inside it. Everything outside the <ul> (toolbar,
 *    risk banner) lives in `head` and paints synchronously.
 *  - Without requestAnimationFrame, without querySelector/
 *    insertAdjacentHTML on the list (the unit-test doubles), or for lists
 *    small enough to fit in the first chunk, everything degrades to ONE
 *    synchronous innerHTML assignment — callers never need a fallback.
 *  - onHead fires right after the head paint (toolbar focus restore;
 *    row-focus targets inside the first chunk); onChunk fires after each
 *    appended batch (retry restores that depend on rows further down);
 *    onSettled fires once the last piece is in (deferred scroll-into-view,
 *    row-focus restore by clamped index).
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

    const paintAll = () => {
        list.innerHTML = head + pieces.join('');
        // No appended batches happened, so onChunk does not fire — onHead
        // and onSettled carry everything (toolbar restore, settle restores).
        if (onHead)
            onHead(list);
        if (onSettled)
            onSettled(list);
        return { cancelled: false, cancel() { this.cancelled = true; } };
    };

    const batchFrames = frameScheduler();
    // Degenerate shapes and tiny lists: one synchronous paint, no machinery.
    if (!batchFrames || pieces.length <= first
        || typeof list.querySelector !== 'function'
        || typeof list.insertAdjacentHTML !== 'function')
        return paintAll();

    // Head paint FIRST — the <ul> the pieces stream into only exists in the
    // FRESH content (discovering it before the paint would read the outgoing
    // DOM's last element instead).
    const headHtml = head + pieces.slice(0, first).join('');
    list.innerHTML = headHtml;

    let ul = null;
    for (let el = list.lastElementChild; el; el = el.previousElementSibling) {
        if (el.tagName === 'UL') {
            ul = el;
            break;
        }
    }
    // No <ul> in the head (a mis-shaped or empty-state head) — repaint the
    // whole thing synchronously; no callback has fired yet, so paintAll's
    // onHead/onSettled run exactly once.
    if (!ul || typeof ul.insertAdjacentHTML !== 'function')
        return paintAll();

    const state = { cancelled: false };
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
