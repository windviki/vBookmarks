import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createVisitStatsCollector, markPopupOpen, POPUP_OPENS_KEY
} from '../src/visit-stats-sw.js';

// src/visit-stats-sw.js reads the chrome global at call time, so tests
// inject a recording double on globalThis before createVisitStatsCollector()
// (same recipe as tests/sync-engine.test.js). All storage callbacks fire
// synchronously; the 2s flush debounce runs on vitest fake timers.

const flushMicrotasks = async (rounds = 10) => {
    for (let i = 0; i < rounds; i++)
        await Promise.resolve();
};

const TREE = [
    {
        id: '0', children: [
            {
                id: '1', title: 'Bar', children: [
                    { id: '11', title: 'A', url: 'https://a.com/', parentId: '1' },
                    { id: '12', title: 'A dupe', url: 'https://a.com/', parentId: '1' }
                ]
            },
            { id: '21', title: 'B', url: 'https://b.com/page', parentId: '0' }
        ]
    }
];

const makeChromeDouble = (opts = {}) => {
    const listeners = {
        bookmarks: {},
        tabs: { onUpdated: [] },
        storage: []
    };
    const localData = { ...(opts.localData || {}) };
    const syncData = { ...(opts.syncData || {}) };
    const sessionData = { ...(opts.sessionData || {}) };
    const calls = { localSet: [], sessionSet: [], getTree: 0 };
    return {
        listeners, calls, localData, syncData, sessionData,
        runtime: { lastError: undefined },
        bookmarks: {
            tree: opts.tree || TREE,
            getTree(cb) { calls.getTree++; cb(this.tree); },
            onCreated: { addListener(fn) { listeners.bookmarks.onCreated = fn; } },
            onRemoved: { addListener(fn) { listeners.bookmarks.onRemoved = fn; } },
            onChanged: { addListener(fn) { listeners.bookmarks.onChanged = fn; } },
            onMoved: { addListener(fn) { listeners.bookmarks.onMoved = fn; } },
            onImportEnded: { addListener(fn) { listeners.bookmarks.onImportEnded = fn; } }
        },
        tabs: {
            onUpdated: { addListener(fn) { listeners.tabs.onUpdated.push(fn); } }
        },
        storage: {
            local: {
                get(defaults, cb) {
                    const out = {};
                    for (const k of Object.keys(defaults))
                        out[k] = k in localData ? localData[k] : defaults[k];
                    cb(out);
                },
                set(obj, cb) {
                    Object.assign(localData, obj);
                    calls.localSet.push(obj);
                    if (cb) cb();
                }
            },
            // statsEnabled lives in the sync area since the 2026-08 storage
            // audit — the collector's start() reads it from here (string
            // form, with a local fallback when the key is absent; a real
            // storage area omits missing keys entirely).
            sync: {
                get(keys, cb) {
                    let out;
                    if (typeof keys === 'string') {
                        out = keys in syncData ? { [keys]: syncData[keys] } : {};
                    } else {
                        out = {};
                        for (const k of Object.keys(keys))
                            out[k] = k in syncData ? syncData[k] : keys[k];
                    }
                    cb(out);
                },
                set(obj, cb) {
                    Object.assign(syncData, obj);
                    if (cb) cb();
                }
            },
            session: {
                get(defaults, cb) {
                    const out = {};
                    for (const k of Object.keys(defaults))
                        out[k] = k in sessionData ? sessionData[k] : defaults[k];
                    cb(out);
                },
                set(obj, cb) {
                    Object.assign(sessionData, obj);
                    calls.sessionSet.push(obj);
                    if (cb) cb();
                }
            },
            onChanged: { addListener(fn) { listeners.storage.push(fn); } }
        }
    };
};

let chromeDouble;

beforeEach(() => {
    vi.useFakeTimers();
    chromeDouble = makeChromeDouble();
    globalThis.chrome = chromeDouble;
});

afterEach(() => {
    vi.useRealTimers();
    delete globalThis.chrome;
});

const statsBlob = () => JSON.parse(chromeDouble.localData.visitStats || '{}');

const navigate = url => {
    for (const fn of chromeDouble.listeners.tabs.onUpdated)
        fn(1, { url }, { id: 1, url });
};

describe('start + index', () => {
    it('defers the full-tree index read until the first navigation (P1-3)', () => {
        const c = createVisitStatsCollector();
        c.start();
        expect(chromeDouble.calls.getTree).toBe(0); // no eager tree read
        expect(chromeDouble.listeners.tabs.onUpdated).toHaveLength(1);
        expect(chromeDouble.listeners.storage).toHaveLength(1);
        // a second start() is a no-op (SW re-entry safety)
        c.start();
        expect(chromeDouble.calls.getTree).toBe(0);
        // the first URL navigation builds the index on demand
        navigate('https://b.com/page');
        expect(chromeDouble.calls.getTree).toBe(1);
        vi.advanceTimersByTime(2000);
        expect(statsBlob()['21'].c).toBe(1);
    });

    it('rebuilds the index on bookmark events (lazily after start)', () => {
        createVisitStatsCollector().start();
        expect(chromeDouble.calls.getTree).toBe(0);
        chromeDouble.listeners.bookmarks.onCreated();
        expect(chromeDouble.calls.getTree).toBe(1);
    });

    // review 05-S5: onMoved is debounced — a recursive folder sort fires one
    // onMoved per moved node and must not rebuild the whole index per move.
    it('debounces a burst of onMoved events into one index rebuild', () => {
        createVisitStatsCollector().start();
        expect(chromeDouble.calls.getTree).toBe(0);
        for (let i = 0; i < 20; i++)
            chromeDouble.listeners.bookmarks.onMoved();
        vi.advanceTimersByTime(299);
        expect(chromeDouble.calls.getTree).toBe(0); // still settling
        vi.advanceTimersByTime(1);
        expect(chromeDouble.calls.getTree).toBe(1); // one rebuild for the burst
        // a later, isolated move rebuilds again after its own quiet window
        chromeDouble.listeners.bookmarks.onMoved();
        vi.advanceTimersByTime(300);
        expect(chromeDouble.calls.getTree).toBe(2);
    });
});

    it('coalesces concurrent first navigations into one lazy getTree (P1-3)', async () => {
        createVisitStatsCollector().start();
        // Make the tree read async for this test — a URL-navigation storm
        // arriving before the first build resolves must not fan out.
        const orig = chromeDouble.bookmarks.getTree.bind(chromeDouble.bookmarks);
        let releaseTree = null;
        chromeDouble.bookmarks.getTree = cb => {
            chromeDouble.calls.getTree++;
            releaseTree = () => orig(cb);
        };
        navigate('https://b.com/page');
        navigate('https://b.com/page');
        expect(chromeDouble.calls.getTree).toBe(1); // one build, two waiters
        releaseTree();
        await flushMicrotasks();
        vi.advanceTimersByTime(2000);
        expect(statsBlob()['21'].c).toBe(2); // both hits counted after the build
    });
describe('navigation counting', () => {
    it('counts a navigation to a bookmarked URL and flushes after 2s', () => {
        createVisitStatsCollector().start();
        navigate('https://b.com/page');
        vi.advanceTimersByTime(2000);
        expect(statsBlob()).toEqual({ '21': { c: 1, t: expect.any(Number) } });
    });

    it('bumps every bookmark sharing the URL (dupes stay distinguishable)', () => {
        createVisitStatsCollector().start();
        navigate('https://a.com/');
        vi.advanceTimersByTime(2000);
        const blob = statsBlob();
        expect(blob['11'].c).toBe(1);
        expect(blob['12'].c).toBe(1);
    });

    it('accumulates multiple navigations into one debounced write', () => {
        createVisitStatsCollector().start();
        navigate('https://b.com/page');
        navigate('https://b.com/page');
        navigate('https://b.com/page');
        vi.advanceTimersByTime(2000);
        expect(statsBlob()['21'].c).toBe(3);
        expect(chromeDouble.calls.localSet).toHaveLength(1);
    });

    it('merges into an existing visitStats blob (read-modify-write)', () => {
        chromeDouble = makeChromeDouble({
            localData: { visitStats: JSON.stringify({ '21': { c: 7, t: 42 }, '99': { c: 1, t: 1 } }) }
        });
        globalThis.chrome = chromeDouble;
        createVisitStatsCollector().start();
        navigate('https://b.com/page');
        vi.advanceTimersByTime(2000);
        const blob = statsBlob();
        expect(blob['21'].c).toBe(8);
        expect(blob['99']).toEqual({ c: 1, t: 1 }); // unrelated entries survive
    });

    it('ignores URLs that are not bookmarked', () => {
        createVisitStatsCollector().start();
        navigate('https://nowhere.example/');
        vi.advanceTimersByTime(5000);
        expect(chromeDouble.calls.localSet).toEqual([]);
    });

    it('ignores status-only changeInfo (reloads are not opens)', () => {
        createVisitStatsCollector().start();
        for (const fn of chromeDouble.listeners.tabs.onUpdated)
            fn(1, { status: 'complete' }, { id: 1, url: 'https://b.com/page' });
        vi.advanceTimersByTime(5000);
        expect(chromeDouble.calls.localSet).toEqual([]);
    });

    it('recovers from a corrupted stored blob', () => {
        chromeDouble = makeChromeDouble({ localData: { visitStats: '{oops' } });
        globalThis.chrome = chromeDouble;
        createVisitStatsCollector().start();
        navigate('https://b.com/page');
        vi.advanceTimersByTime(2000);
        expect(statsBlob()['21'].c).toBe(1);
    });
});

describe('statsEnabled gate (zero-write contract)', () => {
    it('counts nothing when the switch is off at start', async () => {
        chromeDouble = makeChromeDouble({ syncData: { statsEnabled: '' } });
        globalThis.chrome = chromeDouble;
        createVisitStatsCollector().start();
        await flushMicrotasks();
        navigate('https://b.com/page');
        vi.advanceTimersByTime(5000);
        expect(chromeDouble.calls.localSet).toEqual([]);
    });

    it('2026-08 review: falls back to the pre-migration local value when sync lacks the key', async () => {
        // Upgraded profile before the first page open: the local→sync
        // migration has not run yet, so the sync area is empty — the
        // collector must honor the pre-migration LOCAL off switch.
        chromeDouble = makeChromeDouble({ localData: { statsEnabled: '' } });
        globalThis.chrome = chromeDouble;
        createVisitStatsCollector().start();
        await flushMicrotasks();
        navigate('https://b.com/page');
        vi.advanceTimersByTime(5000);
        expect(chromeDouble.calls.localSet).toEqual([]);
    });

    it('flipping the switch off drops pending increments before the flush', async () => {
        createVisitStatsCollector().start();
        await flushMicrotasks();
        navigate('https://b.com/page');
        for (const fn of chromeDouble.listeners.storage)
            fn({ statsEnabled: { newValue: '' } }, 'sync');
        vi.advanceTimersByTime(5000);
        expect(chromeDouble.calls.localSet).toEqual([]);
    });
});

describe('popup-open dedupe protocol', () => {
    it('skips navigations whose URL carries a fresh popup marker', () => {
        createVisitStatsCollector().start();
        markPopupOpen('https://b.com/page');
        navigate('https://b.com/page');
        vi.advanceTimersByTime(5000);
        expect(chromeDouble.calls.localSet).toEqual([]);
    });

    it('counts again once the marker is stale', () => {
        createVisitStatsCollector().start();
        markPopupOpen('https://b.com/page');
        navigate('https://b.com/page');           // deduped
        vi.advanceTimersByTime(11000);            // marker ages out
        navigate('https://b.com/page');           // address-bar revisit
        vi.advanceTimersByTime(2000);
        expect(statsBlob()['21'].c).toBe(1);
    });

    it('markPopupOpen prunes expired entries and stamps the url', () => {
        const stale = Date.now() - 20000;
        chromeDouble.sessionData[POPUP_OPENS_KEY] = {
            'https://old.example/': stale
        };
        markPopupOpen('https://a.com/');
        const marks = chromeDouble.sessionData[POPUP_OPENS_KEY];
        expect(marks['https://old.example/']).toBeUndefined();
        expect(typeof marks['https://a.com/']).toBe('number');
    });

    it('markPopupOpen tolerates a missing/empty url', () => {
        markPopupOpen('');
        markPopupOpen(undefined);
        expect(chromeDouble.calls.sessionSet).toEqual([]);
    });
});
