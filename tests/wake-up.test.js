import { describe, it, expect } from 'vitest';
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
