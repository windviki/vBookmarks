// virtual-list.js unit suite — the 4.1.0 LAB painter (options 实验室 switch).
// The DOM double models what the painter needs: innerHTML string, the rows
// <ul> discovered from the head (a real parser's shape), per-element style,
// scrollTop read/write, and an event registry so scroll/focusin drive the
// re-windowing synchronously (no rAF in node — the painter degrades to a
// direct run, exactly like list-chunks.js).
import { describe, it, expect, afterEach } from 'vitest';
import { paintListVirtual } from '../src/virtual-list.js';

const makeList = ({ viewportRows = 20, heights = null } = {}) => {
    const listeners = {};
    const ul = {
        tagName: 'UL',
        style: {},
        _html: '',
        children: [],
        insertAdjacentHTML() {}
    };
    Object.defineProperty(ul, 'innerHTML', {
        get() { return this._html; },
        set(v) {
            this._html = v;
            // A real parser turns the written markup into <li> children —
            // model them as stable objects keyed by the piece id the tests
            // bake into the markup (id="p<index>"). `heights` adds the
            // measurable offsetHeight real rendered rows report.
            this.children = (v.match(/<li[^>]*id="p(\d+)"/g) || [])
                .map(m => {
                    const piece = +m.match(/p(\d+)/)[1];
                    return heights
                        ? { piece, offsetHeight: heights(piece) }
                        : { piece };
                });
        }
    });
    Object.defineProperty(ul, 'firstElementChild', {
        get() { return this.children[0] || null; }
    });
    Object.defineProperty(ul, 'lastElementChild', {
        get() { return this.children[this.children.length - 1] || null; }
    });
    ul.contains = el => !!el && ul.children.some(c => c.piece === el.piece);

    const list = {
        _html: '',
        ul,
        listeners,
        scrollTop: 0,
        clientHeight: viewportRows * 28,
        style: {},
        get innerHTML() { return this._html; },
        set innerHTML(v) { this._html = v; },
        get lastElementChild() { return this._html.includes('<ul') ? ul : null; },
        querySelector(sel) { return sel === 'ul' ? ul : null; },
        insertAdjacentHTML() {},
        addEventListener(type, fn) {
            (listeners[type] = listeners[type] || []).push(fn);
        },
        removeEventListener(type, fn) {
            const arr = listeners[type] || [];
            const i = arr.indexOf(fn);
            if (i >= 0)
                arr.splice(i, 1);
        },
        fire(type, ev) {
            for (const fn of (listeners[type] || []).slice())
                fn(ev || { target: null });
        },
        renderedPieces() {
            return ul.children.map(c => c.piece);
        }
    };
    return list;
};

const pieces = n => Array.from({ length: n }, (_, i) => `<li id="p${i}" class="vbm-row">row ${i}</li>`);

describe('paintListVirtual', () => {
    afterEach(() => {
        delete globalThis.requestAnimationFrame;
    });

    it('renders only the viewport window + overscan, with paddings carrying the rest', () => {
        const list = makeList({ viewportRows: 20 });
        const handle = paintListVirtual(list, {
            head: '<div class="toolbar"></div><ul></ul>',
            pieces: pieces(300)
        });
        const rendered = list.renderedPieces();
        // 20 viewport rows + 2×8 overscan ≈ 36 rendered pieces at the top
        expect(rendered.length).toBeGreaterThan(20);
        expect(rendered.length).toBeLessThan(60);
        expect(rendered[0]).toBe(0);
        // bottom padding carries everything below the window
        expect(list.ul.style.paddingBottom).toBe((300 - rendered.length) * 28 + 'px');
        expect(list.ul.style.paddingTop).toBe('0px');
        expect(handle.partial).toBe(true);
    });

    it('a short list renders everything with zero paddings (partial=false)', () => {
        const list = makeList({ viewportRows: 20 });
        const handle = paintListVirtual(list, {
            head: '<ul></ul>',
            pieces: pieces(10)
        });
        expect(list.renderedPieces().length).toBe(10);
        expect(list.ul.style.paddingTop).toBe('0px');
        expect(list.ul.style.paddingBottom).toBe('0px');
        expect(handle.partial).toBe(false);
    });

    it('scrolling re-windows: scrollTop deep into the list swaps the rendered slice', () => {
        const list = makeList({ viewportRows: 20 });
        paintListVirtual(list, { head: '<ul></ul>', pieces: pieces(300) });
        expect(list.renderedPieces()[0]).toBe(0);
        list.scrollTop = 150 * 28;   // ~piece 150
        list.fire('scroll');
        const rendered = list.renderedPieces();
        expect(rendered[0]).toBeGreaterThan(100);
        expect(rendered).toContain(150);
        // top padding now carries pieces above the window
        expect(parseInt(list.ul.style.paddingTop, 10)).toBe(rendered[0] * 28);
    });

    it('focus on the last rendered row pages the window forward (keyboard ↓ at the edge)', () => {
        const list = makeList({ viewportRows: 20 });
        paintListVirtual(list, { head: '<ul></ul>', pieces: pieces(300) });
        const last = list.ul.lastElementChild;
        const lastPiece = last.piece;
        list.fire('focusin', { target: { closest: () => null } }); // no li → no-op
        list.fire('focusin', { target: { closest: () => last } });
        // the window pages forward past the top (the focused row may well
        // stay inside the new, larger-positioned window — that's fine)
        expect(list.renderedPieces()[0]).toBeGreaterThan(0);
        expect(list.renderedPieces()).not.toContain(0);
        expect(parseInt(list.ul.style.paddingTop, 10)).toBeGreaterThan(0);
    });

    it('revealIndex scrolls the window to that piece on first paint', () => {
        const list = makeList({ viewportRows: 20 });
        paintListVirtual(list, { head: '<ul></ul>', pieces: pieces(300), revealIndex: 200 });
        expect(list.scrollTop).toBeGreaterThan(150 * 28);
        expect(list.renderedPieces()).toContain(200);
        expect(list.renderedPieces()).not.toContain(0);
    });

    it('cancel removes the listeners and clears the paddings', () => {
        const list = makeList({ viewportRows: 20 });
        const handle = paintListVirtual(list, { head: '<ul></ul>', pieces: pieces(300) });
        handle.cancel();
        expect(list.listeners.scroll).toHaveLength(0);
        expect(list.listeners.focusin).toHaveLength(0);
        expect(list.ul.style.paddingTop).toBe('');
        expect(list.ul.style.paddingBottom).toBe('');
        // a late scroll event finds nothing
        list.scrollTop = 200 * 28;
        list.fire('scroll');
        expect(list.renderedPieces()[0]).toBe(0);
    });

    it('a multi-<li> piece counts as multiple rows in the geometry (group blocks)', () => {
        const list = makeList({ viewportRows: 20 });
        // piece 0 is a group block: head + 2 members = 3 rows.
        const groupPieces = [
            '<li id="p0" class="dupes-group">head</li><li id="p0" class="dupes-member">m1</li><li id="p0" class="dupes-member">m2</li>',
            ...pieces(100).slice(1)
        ];
        paintListVirtual(list, { head: '<ul></ul>', pieces: groupPieces });
        const rendered = list.renderedPieces().length;   // LIs on screen
        // total geometry = 102 row-heights (piece 0 counts as 3); the bottom
        // padding covers every UNRENDERED row — piece 0's extra rows must be
        // in the budget, which is exactly what the li-count estimate buys.
        expect(parseInt(list.ul.style.paddingBottom, 10)).toBe((102 - rendered) * 28);
    });

    it('a re-render keeps the pre-paint scroll position (scrollTop clamps on swap in a real DOM)', () => {
        const list = makeList({ viewportRows: 20 });
        paintListVirtual(list, { head: '<ul></ul>', pieces: pieces(300) });
        // simulate the user scrolled deep, then a data refresh re-renders:
        // the painter must window around the OLD scrollTop, not the top
        list.scrollTop = 200 * 28;
        const events = [];
        paintListVirtual(list, {
            head: '<ul></ul>',
            pieces: pieces(300),
            onHead: () => events.push('head')
        });
        expect(list.renderedPieces()[0]).toBeGreaterThan(150);
        expect(list.scrollTop).toBe(200 * 28);
    });

    it('a list without querySelector degrades to one synchronous paint', () => {
        const list = makeList();
        delete list.querySelector;
        const events = [];
        paintListVirtual(list, {
            head: '<ul></ul>',
            pieces: pieces(3),
            onHead: () => events.push('head'),
            onSettled: () => events.push('settled')
        });
        expect((list.innerHTML.match(/<li /g) || []).length).toBe(3);
        expect(events).toEqual(['head', 'settled']);
    });

    it('measured row heights replace the estimates: the paddings track real geometry', () => {
        // 4.1.0 perf round 2: rendered rows are measured (offsetHeight) and
        // the prefix sums rebuilt — two-line wide/panel rows stop drifting
        // the scrollbar.
        const list = makeList({
            viewportRows: 4,
            // pieces < 10 are "two-line rows": 56px instead of 28
            heights: piece => (piece < 10 ? 56 : 28)
        });
        paintListVirtual(list, { head: '<ul></ul>', pieces: pieces(100) });
        const rendered = list.renderedPieces();
        // invariant: the scrollbar model (top pad + measured window + bottom
        // pad) equals the TRUE total — 10 two-line pieces × 56px + 90 × 28px
        // (with estimate-only geometry it would still say 100 × 28).
        const topPad = parseInt(list.ul.style.paddingTop, 10);
        const botPad = parseInt(list.ul.style.paddingBottom, 10);
        const windowH = rendered.reduce((h, p) => h + (p < 10 ? 56 : 28), 0);
        expect(topPad + windowH + botPad).toBe(10 * 56 + 90 * 28);
        // …and the measured pieces actually got rendered (the window started
        // at the top, so the two-line head pieces are inside it)
        expect(rendered.some(p => p < 10)).toBe(true);
        // re-window past the measured head: the top padding now reflects
        // real 56px rows, not 28px estimates
        list.scrollTop = 20 * 56;
        list.fire('scroll');
        expect(parseInt(list.ul.style.paddingTop, 10)).toBeGreaterThanOrEqual(10 * 56);
    });
});
