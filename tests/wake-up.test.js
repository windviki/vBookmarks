import { describe, it, expect, afterEach, vi } from 'vitest';
import { initWakeUp } from '../src/wake-up.js';
import { makeStorageArea } from './helpers/chrome.js';

// The command-palette global wake-up: the background's open-command-palette
// command opens the popup either with a ?palette=1 fallback-window query or
// a `pendingPaletteOpen` session flag. Both must open the palette AND consume
// the flag so the next plain popup open stays clean.

const setup = ({ hasPaletteQuery = false, pending = undefined } = {}) => {
    const session = makeStorageArea(pending === undefined ? {} : { pendingPaletteOpen: pending });
    const opens = [];
    const chrome = { storage: { session } };
    const palette = { open: () => opens.push('open') };
    return {
        chrome, palette, opens, session,
        flush: async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); }
    };
};

describe('initWakeUp — command-palette global wake-up', () => {
    it('?palette=1 opens the palette and consumes the stale flag', async () => {
        const h = setup({ hasPaletteQuery: true, pending: true });
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: true });
        expect(h.opens).toEqual(['open']);
        expect(h.session.data.pendingPaletteOpen).toBeUndefined();
    });

    it('a pendingPaletteOpen session flag opens the palette and is consumed', async () => {
        const h = setup({ pending: true });
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: false });
        await h.flush();
        expect(h.opens).toEqual(['open']);
        expect(h.session.data.pendingPaletteOpen).toBeUndefined();
    });

    it('no flag and no query → the palette stays closed and nothing is written', async () => {
        const h = setup();
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: false });
        await h.flush();
        expect(h.opens).toEqual([]);
        expect(h.session.calls.remove).toHaveLength(0);
    });

    it('a falsy pending flag (already consumed elsewhere) opens nothing', async () => {
        const h = setup({ pending: false });
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: false });
        await h.flush();
        expect(h.opens).toEqual([]);
        expect(h.session.calls.remove).toHaveLength(0);
    });
});

// With a popup document present the open is focus-deferred (6587c83): a cold
// popup navigation can fire a focusout that swallows an immediate open, so
// the module polls document.hasFocus() on a 100ms tick, defers one extra tick
// when focus is already there, and falls back to opening after 50 tries (5s).
describe('focus-deferred open (popup document present)', () => {
    const setupDoc = ({ hasPaletteQuery = false, pending = undefined, hasFocus = () => true } = {}) => {
        const session = makeStorageArea(pending === undefined ? {} : { pendingPaletteOpen: pending });
        const opens = [];
        const chrome = { storage: { session } };
        const palette = { open: () => opens.push('open') };
        globalThis.document = { hasFocus };
        vi.useFakeTimers();
        return { chrome, palette, opens, session, hasPaletteQuery };
    };

    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.document;
    });

    it('focused at try 0 → the open is deferred by one tick, never synchronous', () => {
        const h = setupDoc({ hasPaletteQuery: true });
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: true });
        expect(h.opens).toEqual([]); // a cold navigation's focusout could still swallow it
        vi.advanceTimersByTime(100);
        expect(h.opens).toEqual(['open']);
        vi.advanceTimersByTime(1000);
        expect(h.opens).toEqual(['open']); // no second open
    });

    it('unfocused at first → opens at the tick where focus arrives', () => {
        let focusCalls = 0;
        const h = setupDoc({ hasFocus: () => ++focusCalls > 3 }); // 3 misses, then focused
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: true });
        vi.advanceTimersByTime(200); // attempts 2 and 3: still unfocused
        expect(h.opens).toEqual([]);
        vi.advanceTimersByTime(100); // attempt 4: focused → open
        expect(h.opens).toEqual(['open']);
    });

    it('never focused → the 50-try (5s) fallback opens anyway', () => {
        const h = setupDoc({ hasFocus: () => false });
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: true });
        vi.advanceTimersByTime(4900); // 49 retries in, tries = 49 < 50
        expect(h.opens).toEqual([]);
        vi.advanceTimersByTime(100); // the 50th try trips the fallback
        expect(h.opens).toEqual(['open']);
    });

    it('query + pending flag together still open exactly once', () => {
        const h = setupDoc({ hasPaletteQuery: true, pending: true });
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: true });
        vi.advanceTimersByTime(1000);
        expect(h.opens).toEqual(['open']);
        expect(h.session.data.pendingPaletteOpen).toBeUndefined(); // consumed
    });

    it('the pendingPaletteOpen path defers the same way', () => {
        const h = setupDoc({ pending: true });
        initWakeUp({ palette: h.palette, chrome: h.chrome, hasPaletteQuery: false });
        expect(h.opens).toEqual([]); // session.get resolved, but focus deferral applies
        vi.advanceTimersByTime(100);
        expect(h.opens).toEqual(['open']);
        expect(h.session.data.pendingPaletteOpen).toBeUndefined();
    });
});
