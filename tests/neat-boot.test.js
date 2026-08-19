import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeEl } from './helpers/dom.js';

// neat.js is the app shell (IIFE, runs at import). Its store.ready.then block
// wires 17 modules and needs the full DOM + chrome surface — too much to
// mock faithfully here, and the real-browser smoke gate already covers the
// "does it load" question end-to-end. This suite instead pins the BOOT
// WIRING that runs BEFORE store.ready resolves:
//
//   1. the early contextmenu preventDefault (closes the native-menu gap
//      before initContextMenu attaches its own handler);
//   2. the favicon-fallback installation;
//   3. the store.ready.then hook is registered exactly once (the init chain
//      is attached, ready to run when storage resolves).
//
// A TDZ/ReferenceError in the import graph or the pre-ready wiring fails here
// in milliseconds instead of only in the Docker smoke tier.

// favicon-fallback fetches a .invalid favicon at install time — stub it.
vi.mock('../src/favicon-fallback.js', () => ({
    initFaviconFallback: vi.fn()
}));
// favicon-enrich's real instance needs chrome.storage for hydrate; the boot
// suite only cares that neat.js wires pagehide → flushIndex (audit T4).
vi.mock('../src/favicon-enrich.js', () => ({
    initFaviconEnrich: vi.fn()
}));
import { initFaviconFallback } from '../src/favicon-fallback.js';
import { initFaviconEnrich } from '../src/favicon-enrich.js';

const makeWindow = store => {
    const document = {
        body: makeEl('body'),
        getElementById: id => makeEl(id),
        addEventListener: vi.fn()
    };
    return {
        document,
        location: { search: '' },
        navigator: { platform: 'Win32', userAgent: 'Mozilla/5.0 Chrome/120.0.0.0' },
        store,
        addEventListener: vi.fn()
    };
};

// A store whose `ready` never resolves — the pre-ready wiring must still run,
// and the init hook must be registered (not executed).
const makePendingStore = () => {
    const ready = {
        then(cb) { ready.cbs.push(cb); return ready; },
        catch() { return ready; },
        cbs: []
    };
    return {
        get: vi.fn((k, d) => d),
        set: vi.fn(),
        remove: vi.fn(),
        getSyncSetting: vi.fn((k, d) => d),
        setSyncSetting: vi.fn(),
        syncKeys: [],
        flush: vi.fn(),
        clearAll: vi.fn(),
        ready
    };
};

beforeEach(() => {
    vi.resetModules();
    initFaviconFallback.mockClear();
    initFaviconEnrich.mockClear();
});

describe('neat.js boot wiring (pre-store.ready)', () => {
    it('imports without crashing and registers the init hook once', async () => {
        const store = makePendingStore();
        globalThis.window = makeWindow(store);
        globalThis.document = globalThis.window.document;
        globalThis.chrome = { i18n: { getMessage: k => k } };
        globalThis.localStorage = {
            getItem: () => null, setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn()
        };

        await import('../src/neat.js');

        // the init chain is attached (not yet run — ready is pending)
        expect(store.ready.cbs).toHaveLength(1);

        // the early contextmenu guard is bound on <body> (native-menu gap)
        const body = globalThis.window.document.body;
        const guards = body._listeners['contextmenu'] || [];
        expect(guards).toHaveLength(1);

        // the bookmark-row click guard is capture-phase on <body>: a left
        // click on a tree-item-link must never navigate the popup itself
        const clickGuards = body._listeners['click'] || [];
        expect(clickGuards.length).toBeGreaterThanOrEqual(1);
        let prevented = 0;
        clickGuards[0]({
            target: { closest: sel => sel === 'a.tree-item-link' ? { href: 'https://x.test/' } : null },
            preventDefault() { prevented++; }
        });
        expect(prevented).toBe(1);

        // favicon fallback installed against the document, wired with the
        // contrast-service context (lazy getters — no store access here)
        expect(initFaviconFallback).toHaveBeenCalledTimes(1);
        const [docArg, ctxArg] = initFaviconFallback.mock.calls[0];
        expect(docArg).toBe(globalThis.window.document);
        expect(typeof ctxArg.contrastEnabled).toBe('function');
        expect(typeof ctxArg.themeIsDark).toBe('function');
    });

    it('wires pagehide → enricher.flushIndex() so debounced index writes flush on close (audit T4)', async () => {
        const store = makePendingStore();
        globalThis.window = makeWindow(store);
        globalThis.document = globalThis.window.document;
        globalThis.chrome = { i18n: { getMessage: k => k } };
        globalThis.localStorage = {
            getItem: () => null, setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn()
        };
        const flushIndex = vi.fn();
        initFaviconEnrich.mockReturnValue({ flushIndex });

        await import('../src/neat.js');

        expect(initFaviconEnrich).toHaveBeenCalledTimes(1);
        const [enrichCtx] = initFaviconEnrich.mock.calls[0];
        expect(enrichCtx.doc).toBe(globalThis.window.document);
        expect(typeof enrichCtx.isEnabled).toBe('function');
        expect(typeof enrichCtx.fallbackEnabled).toBe('function');

        const pagehideCalls = globalThis.window.addEventListener.mock.calls
            .filter(([type]) => type === 'pagehide');
        expect(pagehideCalls.length).toBeGreaterThanOrEqual(1);
        pagehideCalls[0][1]();
        expect(flushIndex).toHaveBeenCalledTimes(1);
    });
});
