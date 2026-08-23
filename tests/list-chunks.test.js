// list-chunks.js unit suite — the 4.1.1 chunked list painter. The DOM is a
// purpose-built double: innerHTML records the string, lastElementChild
// surfaces the <ul> the way a real parser would (the head always contains
// one), and insertAdjacentHTML appends into the ul's buffer. requestAnimationFrame
// is captured into a manual frame queue so the tests drive frames explicitly.
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
        insertAdjacentHTML() {}
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

    it('a list within the first chunk paints in one synchronous innerHTML', () => {
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
        expect(list.innerHTML).toBe('<div class="toolbar"></div><ul></ul><li>1</li><li>2</li>');
        expect(events).toEqual(['head', 'settled']);   // no appended batch → no chunk event
        expect(handle.cancelled).toBe(false);
    });

    it('without requestAnimationFrame everything degrades to one synchronous paint', () => {
        const list = makeList();
        paintListChunked(list, {
            head: '<ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>', '<li>3</li>'],
            first: 1,
            chunk: 1
        });
        expect(list.innerHTML).toBe('<ul></ul><li>1</li><li>2</li><li>3</li>');
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
        // synchronous head paint: toolbar + first two rows, and nothing else yet
        expect(list.innerHTML).toBe('<div class="toolbar"></div><ul></ul><li>1</li><li>2</li>');
        expect(list.ul.buffer).toBe('');
        expect(events).toEqual(['head']);
        // frame 1: rows 3+4
        frames.shift()();
        expect(list.ul.buffer).toBe('<li>3</li><li>4</li>');
        expect(events).toEqual(['head', 'chunk']);
        // frame 2: row 5 + settle
        frames.shift()();
        expect(list.ul.buffer).toBe('<li>3</li><li>4</li><li>5</li>');
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
        expect(list.ul.buffer).toBe('');
        expect(events).toEqual([]);
        expect(handle.cancelled).toBe(true);
    });

    it('a head without a <ul> falls back to the single synchronous paint', () => {
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

    it('a list without querySelector (unit-test doubles) takes the synchronous path', () => {
        const list = makeList();
        delete list.querySelector;
        paintListChunked(list, {
            head: '<ul></ul>',
            pieces: ['<li>1</li>', '<li>2</li>'],
            first: 1
        });
        expect(list.innerHTML).toBe('<ul></ul><li>1</li><li>2</li>');
    });
});
