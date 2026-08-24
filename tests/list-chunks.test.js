// list-chunks.js unit suite — the 4.1.0 chunked list painter. The DOM is a
// purpose-built double: innerHTML records the string, lastElementChild
// surfaces the <ul> the way a real parser would (the head always ends with
// one), and insertAdjacentHTML appends into the ul's buffer — mirroring the
// contract that row pieces land INSIDE the head's <ul>, never as siblings
// (stranded <li>s after a closed </ul> was the D1 keyboard-gate regression).
// requestAnimationFrame is captured into a manual frame queue so the tests
// drive frames explicitly.
import { describe, it, expect, afterEach } from 'vitest';
import { paintListChunked } from '../src/list-chunks.js';

const makeList = () => {
    const ul = {
        tagName: 'UL',
        buffer: '',
        insertAdjacentHTML(pos, html) {
            if (pos === 'beforeend')
                this.buffer += html;
        }
    };
    const list = {
        _html: '',
        ul,
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = v; },
        get lastElementChild() { return this._html.includes('<ul') ? ul : null; },
        querySelector(sel) { return sel === 'ul' ? ul : null; },
        insertAdjacentHTML(pos, html) {
            if (pos === 'beforeend')
                this._html += html;
        }
    };
    return list;
};

const makeFrames = () => {
    const frames = [];
    globalThis.requestAnimationFrame = cb => frames.push(cb);
    return frames;
};

describe('paintListChunked', () => {
    afterEach(() => {
        delete globalThis.requestAnimationFrame;
    });

    it('a list within the first chunk paints synchronously with the rows INSIDE the ul', () => {
        const list = makeList();
        const events = [];
        const handle = paintListChunked(list, {
            head: '<div class="toolbar"></div><ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>'],
            first: 5,
            onHead: () => events.push('head'),
            onChunk: () => events.push('chunk'),
            onSettled: () => events.push('settled')
        });
        expect(list.innerHTML).toBe('<div class="toolbar"></div><ul></ul>');
        expect(list.ul.buffer).toBe('<li>1</li><li>2</li>');   // inside the ul
        expect(events).toEqual(['head', 'settled']);   // no appended batch → no chunk event
        expect(handle.cancelled).toBe(false);
    });

    it('without requestAnimationFrame everything degrades to the same synchronous paint', () => {
        const list = makeList();
        paintListChunked(list, {
            head: '<ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>', '<li>3</li>'],
            first: 1,
            chunk: 1
        });
        expect(list.innerHTML).toBe('<ul></ul>');
        expect(list.ul.buffer).toBe('<li>1</li><li>2</li><li>3</li>');
    });

    it('streams: head + first rows synchronously, the rest one batch per frame', () => {
        const frames = makeFrames();
        const list = makeList();
        const events = [];
        paintListChunked(list, {
            head: '<div class="toolbar"></div><ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>', '<li>3</li>', '<li>4</li>', '<li>5</li>'],
            first: 2,
            chunk: 2,
            onHead: () => events.push('head'),
            onChunk: () => events.push('chunk'),
            onSettled: () => events.push('settled')
        });
        // synchronous head paint: toolbar + first two rows INSIDE the ul
        expect(list.innerHTML).toBe('<div class="toolbar"></div><ul></ul>');
        expect(list.ul.buffer).toBe('<li>1</li><li>2</li>');
        expect(events).toEqual(['head']);
        // frame 1: rows 3+4
        frames.shift()();
        expect(list.ul.buffer).toBe('<li>1</li><li>2</li><li>3</li><li>4</li>');
        expect(events).toEqual(['head', 'chunk']);
        // frame 2: row 5 + settle
        frames.shift()();
        expect(list.ul.buffer).toBe('<li>1</li><li>2</li><li>3</li><li>4</li><li>5</li>');
        expect(events).toEqual(['head', 'chunk', 'chunk', 'settled']);
        expect(frames).toHaveLength(0);
    });

    it('cancel() drops every pending batch — a newer render never races the old tail', () => {
        const frames = makeFrames();
        const list = makeList();
        const events = [];
        const handle = paintListChunked(list, {
            head: '<ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>', '<li>3</li>'],
            first: 1,
            chunk: 1,
            onChunk: () => events.push('chunk'),
            onSettled: () => events.push('settled')
        });
        handle.cancel();
        frames.shift()();
        expect(list.ul.buffer).toBe('<li>1</li>');    // only the head batch landed
        expect(events).toEqual([]);
        expect(handle.cancelled).toBe(true);
    });

    it('a head without a <ul> appends the pieces to the list itself, synchronously', () => {
        const frames = makeFrames();
        const list = makeList();
        paintListChunked(list, {
            head: '<div class="toolbar"></div>',
            pieces: ['<li>1</li>', '<li>2</li>'],
            first: 1
        });
        expect(list.innerHTML).toBe('<div class="toolbar"></div><li>1</li><li>2</li>');
        expect(frames).toHaveLength(0);
    });

    it('a list without querySelector (unit-test doubles) takes the string-concat path', () => {
        const list = makeList();
        delete list.querySelector;
        paintListChunked(list, {
            head: '<ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>'],
            first: 1
        });
        expect(list.innerHTML).toBe('<ul></ul><li>1</li><li>2</li>');
    });

    it('onChunk receives the slice bounds (from, end) so views can gate piece-indexed retries', () => {
        const frames = makeFrames();
        const list = makeList();
        const ranges = [];
        paintListChunked(list, {
            head: '<ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>', '<li>3</li>', '<li>4</li>'],
            first: 1,
            chunk: 2,
            onChunk: (el, from, end) => ranges.push([from, end])
        });
        frames.shift()();
        frames.shift()();
        expect(ranges).toEqual([[1, 3], [3, 4]]);
    });

    it('adaptive sizing grows and shrinks the next batch from the measured insert cost', () => {
        const frames = makeFrames();
        const list = makeList();
        const spans = [];
        let t = 0;
        let cost = 20; // ms per insert — above the 12ms budget → shrink
        globalThis.performance = {
            now: () => {
                const v = t;
                t += cost;
                spans.push(v);
                return v;
            }
        };
        try {
            paintListChunked(list, {
                head: '<ul></ul>',
                pieces: Array.from({ length: 30 }, (_, i) => `<li>${i}</li>`),
                first: 2,
                chunk: 10,
                adaptive: true,
                budgetMs: 12,
                minChunk: 4,
                maxChunk: 40
            });
            // frame 1: 10 pieces at cost 20 → next = max(4, 10*12/20) = 6
            frames.shift()();
            expect(list.ul.buffer).toBe(Array.from({ length: 12 }, (_, i) => `<li>${i}</li>`).join(''));
            // frame 2: 6 pieces; make it cheap → grow 6*1.6 = 10
            cost = 1;
            frames.shift()();
            expect(list.ul.buffer).toBe(Array.from({ length: 18 }, (_, i) => `<li>${i}</li>`).join(''));
            // frame 3: 10 pieces (grown); settle the tail as cheap
            while (frames.length)
                frames.shift()();
            expect(list.ul.buffer).toBe(Array.from({ length: 30 }, (_, i) => `<li>${i}</li>`).join(''));
        } finally {
            delete globalThis.performance;
        }
    });

    it('pipes mode streams two <ul>s from one head paint', () => {
        const frames = makeFrames();
        // A two-ul double: querySelector resolves both selectors.
        const ulA = { tagName: 'UL', buffer: '', insertAdjacentHTML(pos, h) { if (pos === 'beforeend') this.buffer += h; } };
        const ulB = { tagName: 'UL', buffer: '', insertAdjacentHTML(pos, h) { if (pos === 'beforeend') this.buffer += h; } };
        const list = {
            _html: '',
            get innerHTML() { return this._html; },
            set innerHTML(v) { this._html = v; },
            querySelector(sel) { return sel === 'ul[role="list"]' ? ulA : ulB; },
            insertAdjacentHTML() {}
        };
        const events = [];
        paintListChunked(list, {
            head: '<ul role="list"></ul><ul class="marked"></ul>',
            pipes: [
                { ul: 'ul[role="list"]', pieces: ['<li>a1</li>', '<li>a2</li>', '<li>a3</li>'], first: 1, chunk: 1 },
                { ul: '.marked', pieces: ['<li>b1</li>', '<li>b2</li>'], first: 1, chunk: 1 }
            ],
            onHead: () => events.push('head'),
            onChunk: () => events.push('chunk'),
            onSettled: () => events.push('settled')
        });
        // head + first slice of each pipe, synchronously
        expect(ulA.buffer).toBe('<li>a1</li>');
        expect(ulB.buffer).toBe('<li>b1</li>');
        expect(events).toEqual(['head']);
        // frame 1: second slice of each pipe
        frames.shift()();
        expect(ulA.buffer).toBe('<li>a1</li><li>a2</li>');
        expect(ulB.buffer).toBe('<li>b1</li><li>b2</li>');
        // frame 2: pipe A tail; frame 3: all settled
        frames.shift()();
        expect(ulA.buffer).toBe('<li>a1</li><li>a2</li><li>a3</li>');
        frames.shift()();
        expect(events).toEqual(['head', 'chunk', 'chunk', 'chunk', 'settled']);
    });

    it('pipes mode with a missing ul falls back to one synchronous paint', () => {
        const frames = makeFrames();
        const list = makeList();
        delete list.querySelector;
        const events = [];
        paintListChunked(list, {
            head: '<ul></ul>',
            pipes: [{ ul: 'ul', pieces: ['<li>1</li>', '<li>2</li>'], first: 1, chunk: 1 }],
            onHead: () => events.push('head'),
            onSettled: () => events.push('settled')
        });
        expect(list.innerHTML).toContain('<li>1</li><li>2</li>');
        expect(events).toEqual(['head', 'settled']);
        expect(frames).toHaveLength(0);
    });

    it('pipes mode adapts the shared batch scale from the round cost (perf round 3)', () => {
        const frames = makeFrames();
        const ulA = { tagName: 'UL', buffer: '', insertAdjacentHTML(pos, h) { if (pos === 'beforeend') this.buffer += h; } };
        const list = {
            _html: '',
            get innerHTML() { return this._html; },
            set innerHTML(v) { this._html = v; },
            querySelector: () => ulA,
            insertAdjacentHTML() {}
        };
        let t = 0;
        let cost = 20; // per-round insert cost above the 12ms budget → shrink
        globalThis.performance = { now: () => (t += cost) };
        try {
            paintListChunked(list, {
                head: '<ul></ul>',
                pipes: [{ ul: 'ul', pieces: Array.from({ length: 24 }, (_, i) => `<li>${i}</li>`), first: 2, chunk: 10 }],
                adaptive: true, budgetMs: 12, minChunk: 4, maxChunk: 40
            });
            expect(ulA.buffer).toBe('<li>0</li><li>1</li>'); // head slice
            // frame 1: base chunk 10 (cost 20 > budget) → next round shrinks
            frames.shift()();
            expect(ulA.buffer.endsWith('<li>11</li>')).toBe(true);
            // frame 2: chunk now max(4, round(10 * 12/20)) = 6
            cost = 1;
            frames.shift()();
            expect(ulA.buffer.endsWith('<li>17</li>')).toBe(true);
            while (frames.length)
                frames.shift()();
            expect(ulA.buffer).toBe(Array.from({ length: 24 }, (_, i) => `<li>${i}</li>`).join(''));
        } finally {
            delete globalThis.performance;
        }
    });

    it('fold-during-stream contract: cancel + repaint mid-flight leaves no stale appends on late frames (f9d9e1b)', () => {
        const frames = makeFrames();
        const list = makeList();
        // 5 rows, 1 in head, 1 per frame → the stream is mid-flight with 3
        // queued frames when the view's foldDuringStream guard fires.
        const handle = paintListChunked(list, {
            head: '<ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>', '<li>3</li>', '<li>4</li>', '<li>5</li>'],
            first: 1,
            chunk: 1
        });
        expect(frames.length).toBeGreaterThan(0);
        // the view guard: cancel the stream, then repaint surgically/fully
        // on the settled-looking DOM (the repaint's innerHTML swap retires
        // the old <ul> — mirror that by clearing the old buffer)
        handle.cancel();
        const staleFrames = frames.slice();
        list.ul.buffer = '';
        paintListChunked(list, {
            head: '<ul></ul>',
            pieces: ['<li>x</li>'],
            first: 5
        });
        // pumping every stale frame must append NOTHING from the old stream
        while (staleFrames.length)
            staleFrames.shift()();
        expect(list.ul.buffer).toBe('<li>x</li>');
    });
});
