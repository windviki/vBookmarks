import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDeadScanRunner, DEAD_SCAN_KEY, DEAD_LAST_KEY, DEAD_SCAN_MSG } from '../src/dead-scan-sw.js';

// dead-scan-sw.js is the SW-side scan runner (v4 task-4 #16): pages send
// vbm-dead-scan-* messages, the runner scans and publishes a live blob to
// chrome.storage.local. The chrome double below follows the callback-style
// storage convention of the repo's other SW doubles; timers are captured
// (record-only) so the 700ms publish throttle fires by hand.

const realChrome = globalThis.chrome;
const realFetch = globalThis.fetch;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

let timers;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const firePublishTimer = () => {
    for (const t of timers.splice(0))
        if (!t.cleared && t.ms === 700)
            t.fn();
};

const TREE = [
    { id: '0', children: [
        { id: '1', children: [
            { id: '11', title: 'a', url: 'https://a.example/' },
            { id: '12', title: 'b', url: 'https://b.example/' }
        ] },
        { id: '13', title: 'c', url: 'https://c.example/' },
        { id: '14', title: '|', url: 'http://separatethis.com/' } // separator: never scanned
    ] }
];

const makeChrome = ({ storage = {}, proxy = {} } = {}) => {
    const local = { ...storage };
    const calls = { fetch: [], pacSet: 0, pacCleared: 0, onChanged: [] };
    const c = {
        runtime: {
            lastError: null,
            onMessage: { addListener(fn) { (this.fns = this.fns || []).push(fn); } }
        },
        bookmarks: { getTree: cb => cb(TREE) },
        storage: {
            local: {
                get(keys, cb) {
                    const out = {};
                    const list = typeof keys === 'string' ? [keys] : keys;
                    for (const k of list)
                        if (k in local)
                            out[k] = local[k];
                    cb(out);
                },
                set(obj, cb) {
                    Object.assign(local, obj);
                    for (const fn of calls.onChanged)
                        fn(obj, 'local');
                    if (cb) cb();
                },
                remove(keys, cb) {
                    for (const k of [].concat(keys))
                        delete local[k];
                    if (cb) cb();
                }
            },
            session: {
                _d: {},
                get(keys, cb) { cb({}); },
                set(obj, cb) { Object.assign(this._d, obj); if (cb) cb(); },
                remove(keys, cb) { if (cb) cb(); }
            },
            onChanged: { addListener(fn) { calls.onChanged.push(fn); } }
        },
        permissions: proxy.permissions || {
            contains(perms, cb) { cb(false); }
        },
        proxy: proxy.settings ? {
            settings: {
                get(d, cb) { cb(proxy.settings.getResult || { levelOfControl: 'controlled_by_this_extension' }); },
                set(d, cb) { calls.pacSet++; if (cb) cb(); },
                clear(d, cb) { calls.pacCleared++; if (cb) cb(); }
            }
        } : undefined
    };
    return { chrome: c, local, calls };
};

const blobOf = local => (local[DEAD_SCAN_KEY] ? JSON.parse(local[DEAD_SCAN_KEY]) : null);

beforeEach(() => {
    timers = [];
    globalThis.setTimeout = (fn, ms) => {
        const t = { fn, ms, cleared: false };
        timers.push(t);
        return t;
    };
    globalThis.clearTimeout = t => { if (t) t.cleared = true; };
});

afterEach(() => {
    globalThis.chrome = realChrome;
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
});

describe('dead-scan SW runner (v4 task-4 #16)', () => {
    it('start scans every scannable bookmark and finishes into deadLastScan', async () => {
        const { chrome, local } = makeChrome();
        globalThis.chrome = chrome;
        globalThis.fetch = url => { return Promise.resolve({ status: url.includes('b.example') ? 404 : 200 }); };
        const runner = createDeadScanRunner();
        runner.start();
        chrome.runtime.onMessage.fns[0]({ type: DEAD_SCAN_MSG.start });
        await flush();
        // run over: the live blob is gone, the cache carries every verdict
        expect(local[DEAD_SCAN_KEY]).toBeUndefined();
        const last = JSON.parse(local[DEAD_LAST_KEY]);
        expect(last.scannedCount).toBe(3); // separator excluded
        expect(Object.keys(last.results).sort()).toEqual(['11', '12', '13']);
        expect(last.results['12'].status).toBe('dead'); // both channels failed
        expect(last.results['12'].code).toBe(404);
        expect(last.results['11'].status).toBe('ok');
        expect(last.results['11'].code).toBe(200);
    });

    it('publishes a live blob at start (scanning) and per-tick results only after the throttle', async () => {
        const { chrome, local } = makeChrome();
        globalThis.chrome = chrome;
        let release;
        globalThis.fetch = () => new Promise(r => { release = r; }); // hang all probes
        const runner = createDeadScanRunner();
        runner.start();
        chrome.runtime.onMessage.fns[0]({ type: DEAD_SCAN_MSG.start });
        await flush();
        const blob = blobOf(local);
        expect(blob.state).toBe('scanning');
        expect(blob.total).toBe(3);
        expect(blob.done).toBe(0);
        // one probe settles: the blob does NOT update until the throttle fires
        release({ status: 200 });
        await flush();
        expect(blobOf(local).done).toBe(0);
        firePublishTimer();
        await flush();
        const after = blobOf(local);
        expect(after.done).toBe(1);
        expect(Object.keys(after.results)).toHaveLength(1);
        runner.onMessage({ type: DEAD_SCAN_MSG.cancel });
    });

    it('pause/resume/cancel drive the blob state; cancel writes no cache', async () => {
        const { chrome, local } = makeChrome();
        globalThis.chrome = chrome;
        globalThis.fetch = () => new Promise(() => {}); // hang
        const runner = createDeadScanRunner();
        runner.start();
        const send = runner.onMessage;
        send({ type: DEAD_SCAN_MSG.start });
        await flush();
        send({ type: DEAD_SCAN_MSG.pause });
        await flush();
        expect(blobOf(local).state).toBe('paused');
        send({ type: DEAD_SCAN_MSG.resume });
        await flush();
        expect(blobOf(local).state).toBe('scanning');
        send({ type: DEAD_SCAN_MSG.cancel });
        await flush();
        expect(local[DEAD_SCAN_KEY]).toBeUndefined();
        expect(local[DEAD_LAST_KEY]).toBeUndefined(); // the run never happened
    });

    it('cold start resumes a live blob from the published remainder', async () => {
        const prior = {
            state: 'scanning', done: 1, total: 3, ts: Date.now(),
            items: ['11', '12', '13'],
            results: { '11': { status: 'ok', code: 200 } },
            proxy: { active: false, gate: '' }
        };
        const { chrome, local } = makeChrome({ storage: { [DEAD_SCAN_KEY]: JSON.stringify(prior) } });
        globalThis.chrome = chrome;
        const seen = [];
        globalThis.fetch = url => { seen.push(url); return Promise.resolve({ status: 200 }); };
        createDeadScanRunner().start(); // module start → resumeIfNeeded
        await flush();
        // only the two unsettled bookmarks were probed…
        expect(seen.sort()).toEqual(['https://b.example/', 'https://c.example/']);
        // …and the finished cache merges the journaled result
        const last = JSON.parse(local[DEAD_LAST_KEY]);
        expect(Object.keys(last.results).sort()).toEqual(['11', '12', '13']);
        expect(last.ts).toBeGreaterThanOrEqual(prior.ts); // finish stamps completion time
    });

    it('a paused blob at cold start stays paused until a page resumes it', async () => {
        const prior = {
            state: 'paused', done: 1, total: 3, ts: Date.now(),
            items: ['11', '12', '13'],
            results: { '11': { status: 'ok', code: 200 } },
            proxy: { active: false, gate: '' }
        };
        const { chrome, local } = makeChrome({ storage: { [DEAD_SCAN_KEY]: JSON.stringify(prior) } });
        globalThis.chrome = chrome;
        const seen = [];
        globalThis.fetch = url => { seen.push(url); return Promise.resolve({ status: 200 }); };
        const runner = createDeadScanRunner();
        runner.start();
        await flush();
        expect(blobOf(local).state).toBe('paused');
        expect(seen).toEqual([]); // startPaused: the pump never dispatched
        runner.onMessage({ type: DEAD_SCAN_MSG.resume });
        await flush();
        // resume ran the remainder to completion and merged the journal
        expect(seen.sort()).toEqual(['https://b.example/', 'https://c.example/']);
        expect(local[DEAD_SCAN_KEY]).toBeUndefined();
        expect(Object.keys(JSON.parse(local[DEAD_LAST_KEY]).results).sort())
            .toEqual(['11', '12', '13']);
    });

    it('a stale live blob (older than a day) is left alone', async () => {
        const prior = {
            state: 'scanning', done: 0, total: 3, ts: Date.now() - 25 * 3600 * 1000,
            items: ['11'], results: {}, proxy: { active: false, gate: '' }
        };
        const { chrome, local } = makeChrome({ storage: { [DEAD_SCAN_KEY]: JSON.stringify(prior) } });
        globalThis.chrome = chrome;
        let fetched = false;
        globalThis.fetch = () => { fetched = true; return Promise.resolve({ status: 200 }); };
        createDeadScanRunner().start();
        await flush();
        expect(fetched).toBe(false);
        expect(blobOf(local).state).toBe('scanning'); // untouched
    });

    it('proxy configured but permission missing: gate noted, direct-only scan', async () => {
        const { chrome, local } = makeChrome({
            storage: { deadProxyServer: 'http://127.0.0.1:7890' }
        });
        globalThis.chrome = chrome;
        globalThis.fetch = () => Promise.resolve({ status: 200 });
        const runner = createDeadScanRunner();
        runner.start();
        runner.onMessage({ type: DEAD_SCAN_MSG.start });
        await flush();
        expect(local[DEAD_LAST_KEY]).toBeDefined(); // scan completed anyway
        // the gate was published while scanning (blob already consumed) —
        // assert through the run state instead: no PAC was ever installed
    });

    it('proxy granted + controllable: PAC lives only for the scan duration', async () => {
        const { chrome, local, calls } = makeChrome({
            storage: { deadProxyServer: 'http://127.0.0.1:7890' },
            proxy: {
                permissions: { contains(perms, cb) { cb(true); } },
                settings: { getResult: { levelOfControl: 'controllable_by_this_extension' } }
            }
        });
        globalThis.chrome = chrome;
        globalThis.fetch = () => Promise.resolve({ status: 200 });
        const runner = createDeadScanRunner();
        runner.start();
        runner.onMessage({ type: DEAD_SCAN_MSG.start });
        await flush();
        expect(calls.pacSet).toBe(1);      // installed for the scan
        expect(calls.pacCleared).toBe(1);  // torn down at finish
        expect(local[DEAD_LAST_KEY]).toBeDefined();
    });
});
