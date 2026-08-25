import { describe, it, expect } from 'vitest';
import { fitToolbarLabels, watchToolbarFit } from '../src/toolbar-fit.js';

// toolbar-fit.js (extracted 2026-08 from view-recent's width-aware action
// rung) is pure DOM measurement — the suites drive it with hand-written
// button doubles carrying offsetWidth/clientWidth/scrollWidth, exactly the
// guards the module itself documents for test doubles.

const makeLabel = () => ({ style: {} });
// offsetWidth grows when the label is revealed (the realistic geometry the
// greedy pass measures); label-less buttons keep a flat width
const makeBtn = (baseW, revealedW = baseW + 40, withLabel = true) => {
    const btn = {
        style: {},
        label: withLabel ? makeLabel() : null,
        querySelector(sel) {
            return sel === '.vbm-fit-label' ? this.label : null;
        }
    };
    Object.defineProperty(btn, 'offsetWidth', {
        get() {
            return this.label && this.label.style.display === 'inline' ? revealedW : baseW;
        }
    });
    return btn;
};
const makeBar = (btns, { clientWidth = 200, scrollWidth = 0 } = {}) => {
    const bar = {
        clientWidth,
        scrollWidth,
        _btns: btns,
        querySelectorAll(sel) {
            return sel === '.vbm-fit-btn' ? this._btns : [];
        }
    };
    return bar;
};
const revealed = btn => (btn.label && btn.label.style.display === 'inline');

describe('fitToolbarLabels (toolbar-fit.js)', () => {
    it('reveals labels right-to-left while free width allows', () => {
        // bar 200 wide; 16 padding + 3×30 buttons + 2×6 gaps = 118 used → 82
        // free; each reveal costs 40 → the rightmost two fit, the third would
        // only leave 2px
        const a = makeBtn(30);
        const b = makeBtn(30);
        const c = makeBtn(30);
        const bar = makeBar([a, b, c], { clientWidth: 200 });
        fitToolbarLabels(bar);
        expect(revealed(c)).toBe(true);
        expect(revealed(b)).toBe(true);
        expect(revealed(a)).toBe(false);
        expect(c.style.width).toBe('auto');
        expect(c.style.padding).toBe('2px 6px');
        expect(b.label.style.display).toBe('inline');
    });

    it('reveals nothing when the buttons already fill the bar', () => {
        const a = makeBtn(90);
        const b = makeBtn(90);
        fitToolbarLabels(makeBar([a, b], { clientWidth: 200 }));
        expect(revealed(a)).toBe(false);
        expect(revealed(b)).toBe(false);
    });

    it('skips a label-less button without stopping the walk', () => {
        const plain = makeBtn(20, 60, false);
        const labeled = makeBtn(20);
        fitToolbarLabels(makeBar([plain, labeled], { clientWidth: 200 }));
        expect(revealed(labeled)).toBe(true);
        // the label-less button only gets the reset pass (width/padding '')
        expect(plain.style.width).toBe('');
        expect(plain.style.padding).toBe('');
    });

    it('reverts the last label when it would overflow the free width', () => {
        // free = 100 − 16 − (30+30) − 6 = 18; the label adds 40 → revert
        const a = makeBtn(30);
        const b = makeBtn(30);
        fitToolbarLabels(makeBar([a, b], { clientWidth: 100 }));
        expect(revealed(b)).toBe(false);
        expect(revealed(a)).toBe(false);
        expect(b.style.width).toBe('');
        expect(b.style.padding).toBe('');
    });

    it('overflow backstop reverts revealed labels until scrollWidth fits', () => {
        // the greedy pass thinks both fit, but the measured scrollWidth
        // disagrees (rounding/padding shaving) — the backstop drops them
        // right-to-left until the row actually fits
        const a = makeBtn(30);
        const b = makeBtn(30, 70);
        const bar = makeBar([a, b], { clientWidth: 100, scrollWidth: 140 });
        fitToolbarLabels(bar);
        // b got revealed by the greedy pass (40 ≤ 44 free) but the backstop
        // sees scrollWidth 140 > 100 and reverts it
        expect(revealed(b)).toBe(false);
        expect(b.style.width).toBe('');
    });

    it('guards: no bar, no querySelector, no buttons — all no-ops', () => {
        expect(() => fitToolbarLabels(null)).not.toThrow();
        expect(() => fitToolbarLabels({})).not.toThrow();
        expect(() => fitToolbarLabels(makeBar([]))).not.toThrow();
    });
});

describe('watchToolbarFit (toolbar-fit.js)', () => {
    it('returns a no-op disposer when ResizeObserver is unavailable', () => {
        const prev = globalThis.ResizeObserver;
        delete globalThis.ResizeObserver;
        try {
            const dispose = watchToolbarFit({ id: 'x' }, () => {});
            expect(typeof dispose).toBe('function');
            expect(() => dispose()).not.toThrow();
            expect(watchToolbarFit(null, () => {})).toEqual(expect.any(Function));
        } finally {
            if (prev)
                globalThis.ResizeObserver = prev;
        }
    });

    it('observes the list, fires fit on width change and skips repeats; disposer disconnects', () => {
        const prev = globalThis.ResizeObserver;
        const instances = [];
        globalThis.ResizeObserver = class {
            constructor(cb) { this.cb = cb; instances.push(this); }
            observe(el) { this.el = el; }
            disconnect() { this.disconnected = true; }
        };
        try {
            const fits = [];
            const listEl = { id: 'staging-list' };
            const dispose = watchToolbarFit(listEl, () => fits.push(1));
            const ro = instances[instances.length - 1];
            expect(ro.el).toBe(listEl);
            ro.cb([{ contentRect: { width: 500 } }]);
            ro.cb([{ contentRect: { width: 500 } }]); // repeat: no refire
            ro.cb([{ contentRect: { width: 620 } }]);
            expect(fits).toHaveLength(2);
            // an entries-less callback keeps the last width
            ro.cb([]);
            expect(fits).toHaveLength(2);
            dispose();
            expect(ro.disconnected).toBe(true);
        } finally {
            globalThis.ResizeObserver = prev;
        }
    });
});
