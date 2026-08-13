import { describe, it, expect } from 'vitest';
import { createToolButton } from '../src/tool-button.js';

// The ⋮ tool button (v4 task-3 #20): hidden when showToolButton is off, or
// when the palette itself is disabled (the button's only job is opening it).

const makeBtn = () => {
    const set = new Set();
    return {
        title: '',
        classList: {
            add: c => set.add(c),
            remove: c => set.delete(c),
            contains: c => set.has(c),
            _set: set
        },
        _listeners: {},
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        fire(type, ev = {}) { (this._listeners[type] || []).forEach(fn => fn(ev)); }
    };
};

const makeStore = (data = {}) => ({
    get: (k, dflt) => (k in data ? data[k] : dflt)
});

describe('createToolButton', () => {
    it('is a no-op when the button is absent from the page', () => {
        expect(() => createToolButton({
            store: makeStore(), toolBtn: null, palette: { open() {} }, _m: k => k
        })).not.toThrow();
    });

    it('stays visible and sets the title when both switches are on (defaults)', () => {
        const btn = makeBtn();
        const palette = { open: () => {} };
        createToolButton({ store: makeStore(), toolBtn: btn, palette, _m: k => k });
        expect(btn.classList.contains('hidden')).toBe(false);
        expect(btn.title).toBe('toolButtonTitle');
    });

    it('is hidden when showToolButton is off', () => {
        const btn = makeBtn();
        createToolButton({ store: makeStore({ showToolButton: '' }), toolBtn: btn, palette: { open() {} }, _m: k => k });
        expect(btn.classList.contains('hidden')).toBe(true);
    });

    it('is hidden when the palette itself is disabled (its only job is opening it)', () => {
        const btn = makeBtn();
        createToolButton({ store: makeStore({ paletteEnabled: '' }), toolBtn: btn, palette: { open() {} }, _m: k => k });
        expect(btn.classList.contains('hidden')).toBe(true);
    });

    it('opens the palette on click', () => {
        const btn = makeBtn();
        let opened = 0;
        createToolButton({ store: makeStore(), toolBtn: btn, palette: { open: () => opened++ }, _m: k => k });
        btn.fire('click');
        expect(opened).toBe(1);
    });
});
