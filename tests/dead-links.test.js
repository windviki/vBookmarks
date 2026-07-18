import { describe, it, expect, afterEach } from 'vitest';

// dead-links.js is pure logic: fetch/AbortController are platform globals in
// node 18+, so the tests double globalThis.fetch directly. Every double
// records its (url, opts) calls; the abort-respecting variant mimics real
// fetch by rejecting with an AbortError-named error when the signal fires.

import {
    checkUrl, scanBookmarks, filterScannable, collectDead, statusLabel, startDeadScan
} from '../src/dead-links.js';

const realFetch = globalThis.fetch;
afterEach(() => {
    globalThis.fetch = realFetch;
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

const stubFetch = handler => {
    const calls = [];
    globalThis.fetch = (url, opts = {}) => {
        calls.push({ url, opts });
        return handler(url, opts);
    };
    return calls;
};

const respond = status => () => Promise.resolve({ status });

const abortableHang = () => {
    const signals = [];
    globalThis.fetch = (url, opts = {}) => {
        signals.push(opts.signal);
        return new Promise((resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                reject(err);
            });
        });
    };
    return signals;
};

describe('checkUrl', () => {
    it('resolves ok for a 200 HEAD response', async () => {
        stubFetch(respond(200));
        expect(await checkUrl('https://a.com/')).toEqual({ status: 200, ok: true });
    });

    it('flags 404 as dead with the numeric status', async () => {
        stubFetch(respond(404));
        expect(await checkUrl('https://a.com/')).toEqual({ status: 404, ok: false });
    });

    it('flags 500 as dead', async () => {
        stubFetch(respond(500));
        expect(await checkUrl('https://a.com/')).toEqual({ status: 500, ok: false });
    });

    it('sends HEAD with redirect:"follow" and the abort signal', async () => {
        const calls = stubFetch(respond(301));
        const result = await checkUrl('https://a.com/');
        expect(calls).toHaveLength(1);
        expect(calls[0].opts.method).toBe('HEAD');
        expect(calls[0].opts.redirect).toBe('follow');
        expect(calls[0].opts.signal).toBeInstanceOf(AbortSignal);
        // 3xx arrives only when follow gave up; it is still not a dead link
        expect(result).toEqual({ status: 301, ok: true });
    });

    it.each([405, 501, 403])('falls back to GET once when HEAD is refused with %i', async status => {
        const calls = stubFetch((url, opts) =>
            Promise.resolve({ status: opts.method === 'HEAD' ? status : 200 }));
        const result = await checkUrl('https://a.com/');
        expect(calls.map(c => c.opts.method)).toEqual(['HEAD', 'GET']);
        expect(result).toEqual({ status: 200, ok: true });
    });

    it('does not retry with GET on a plain 404', async () => {
        const calls = stubFetch(respond(404));
        await checkUrl('https://a.com/');
        expect(calls).toHaveLength(1);
    });

    it('keeps the GET fallback status when it is also dead', async () => {
        const calls = stubFetch((url, opts) =>
            Promise.resolve({ status: opts.method === 'HEAD' ? 405 : 404 }));
        const result = await checkUrl('https://a.com/');
        expect(calls.map(c => c.opts.method)).toEqual(['HEAD', 'GET']);
        expect(result).toEqual({ status: 404, ok: false });
    });

    it('maps a network failure to status:"error" with the error name', async () => {
        stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
        expect(await checkUrl('https://a.com/')).toEqual({
            status: 'error', ok: false, error: 'TypeError'
        });
    });

    it('falls back to a generic error name for nameless rejections', async () => {
        stubFetch(() => Promise.reject({}));
        expect(await checkUrl('https://a.com/')).toEqual({
            status: 'error', ok: false, error: 'Error'
        });
    });

    it('times out via AbortController when fetch never settles', async () => {
        abortableHang();
        const result = await checkUrl('https://hang.example/', { timeoutMs: 10 });
        expect(result).toEqual({ status: 'error', ok: false, error: 'AbortError' });
    });

    it('skips non-http(s) URLs without calling fetch', async () => {
        const calls = stubFetch(respond(200));
        for (const url of [
            'javascript:alert(1)', 'chrome://extensions/', 'file:///tmp/x',
            'ftp://ftp.example/x', 'data:text/html,hi', ''
        ]) {
            expect(await checkUrl(url)).toEqual({ status: 'skipped', ok: true });
        }
        expect(calls).toHaveLength(0);
    });

    it('accepts an uppercase HTTP scheme', async () => {
        const calls = stubFetch(respond(200));
        expect(await checkUrl('HTTP://EXAMPLE.COM/')).toEqual({ status: 200, ok: true });
        expect(calls[0].url).toBe('HTTP://EXAMPLE.COM/');
    });
});

describe('scanBookmarks', () => {
    const items = ids => ids.map(id => ({ id, title: id, url: `https://${id}.com/` }));

    it('scans every item and resolves a Map of id to result', async () => {
        stubFetch(respond(200));
        const results = await scanBookmarks(items(['a', 'b', 'c']));
        expect(results).toBeInstanceOf(Map);
        expect(results.size).toBe(3);
        expect(results.get('b')).toEqual({ status: 200, ok: true });
    });

    it('keeps per-URL results (ok, dead, error, skipped apart)', async () => {
        stubFetch(url => {
            if (url.includes('dead')) return Promise.resolve({ status: 404 });
            if (url.includes('fail')) return Promise.reject(new TypeError('x'));
            return Promise.resolve({ status: 200 });
        });
        const results = await scanBookmarks([
            { id: 'ok', url: 'https://ok.com/' },
            { id: 'dead', url: 'https://dead.com/' },
            { id: 'fail', url: 'https://fail.com/' },
            { id: 'js', url: 'javascript:1' }
        ]);
        expect(results.get('ok').ok).toBe(true);
        expect(results.get('dead')).toEqual({ status: 404, ok: false });
        expect(results.get('fail')).toEqual({ status: 'error', ok: false, error: 'TypeError' });
        expect(results.get('js')).toEqual({ status: 'skipped', ok: true });
    });

    it('caps in-flight checks at the concurrency limit', async () => {
        let inflight = 0, maxInflight = 0;
        const gates = [];
        globalThis.fetch = () => new Promise(resolve => {
            inflight++;
            maxInflight = Math.max(maxInflight, inflight);
            gates.push(() => { inflight--; resolve({ status: 200 }); });
        });
        const p = scanBookmarks(items(['a', 'b', 'c', 'd', 'e', 'f']), { concurrency: 2 });
        expect(gates.length).toBe(2); // the pump starts synchronously
        while (gates.length) {
            gates.shift()();
            await tick();
        }
        const results = await p;
        expect(results.size).toBe(6);
        expect(maxInflight).toBeLessThanOrEqual(2);
    });

    it('reports onProgress(done, total) in ascending done order', async () => {
        stubFetch(respond(200));
        const progressed = [];
        await scanBookmarks(items(['a', 'b', 'c', 'd', 'e']), {
            concurrency: 2,
            onProgress: (done, total) => progressed.push([done, total])
        });
        expect(progressed).toEqual([[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]]);
    });

    it('resolves an empty Map for an empty list without fetching', async () => {
        const calls = stubFetch(respond(200));
        const progressed = [];
        const results = await scanBookmarks([], { onProgress: () => progressed.push(1) });
        expect(results.size).toBe(0);
        expect(calls).toHaveLength(0);
        expect(progressed).toHaveLength(0);
    });

    it('resolves immediately empty when the signal is already aborted', async () => {
        const calls = stubFetch(respond(200));
        const ac = new AbortController();
        ac.abort();
        const results = await scanBookmarks(items(['a', 'b']), { signal: ac.signal });
        expect(results.size).toBe(0);
        expect(calls).toHaveLength(0);
    });

    it('resolves partial results on mid-scan cancel and drops late completions', async () => {
        const ac = new AbortController();
        const gates = new Map();
        globalThis.fetch = url => new Promise(resolve => {
            if (url === 'https://a.com/')
                resolve({ status: 200 });
            else
                gates.set(url, resolve);
        });
        const progressed = [];
        const p = scanBookmarks(items(['a', 'b', 'c']), {
            concurrency: 2,
            signal: ac.signal,
            onProgress: (done, total) => progressed.push([done, total])
        });
        await tick(); // 'a' settles, 'b' and 'c' hang
        expect(progressed).toEqual([[1, 3]]);
        ac.abort();
        const results = await p;
        expect(results.size).toBe(1);
        expect(results.get('a')).toEqual({ status: 200, ok: true });
        // a late in-flight completion must not mutate the settled Map
        gates.get('https://b.com/')({ status: 404 });
        await tick();
        expect(results.size).toBe(1);
        expect(progressed).toEqual([[1, 3]]);
    });
});

describe('helpers', () => {
    it('filterScannable drops folders and separator URLs, keeps the rest', () => {
        const list = [
            { id: 'f', isFolder: true, url: '' },
            { id: 'a', isFolder: false, url: 'https://a.com/' },
            { id: 's', isFolder: false, url: 'http://separatethis.com/#2' },
            { id: 'j', isFolder: false, url: 'javascript:1' }
        ];
        const isSeparator = (title, url) => url.indexOf('separatethis.com') !== -1;
        expect(filterScannable(list, isSeparator).map(i => i.id)).toEqual(['a', 'j']);
    });

    it('filterScannable keeps everything bookmark-ish without a predicate', () => {
        const list = [
            { id: 'f', isFolder: true, url: '' },
            { id: 's', isFolder: false, url: 'http://separatethis.com/#2' }
        ];
        expect(filterScannable(list).map(i => i.id)).toEqual(['s']);
    });

    it('collectDead picks exactly the !ok entries, in item order', () => {
        const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
        const results = new Map([
            ['a', { status: 200, ok: true }],
            ['b', { status: 404, ok: false }],
            ['d', { status: 'error', ok: false, error: 'TypeError' }]
        ]);
        expect(collectDead(list, results).map(i => i.id)).toEqual(['b', 'd']);
    });

    it('statusLabel renders numeric statuses, timeout and generic error', () => {
        expect(statusLabel({ status: 404, ok: false })).toBe('404');
        expect(statusLabel({ status: 200, ok: true })).toBe('200');
        expect(statusLabel({ status: 'error', ok: false, error: 'AbortError' })).toBe('timeout');
        expect(statusLabel({ status: 'error', ok: false, error: 'TypeError' })).toBe('error');
    });

    it('startDeadScan.abort() cancels the scan and aborts in-flight fetches', async () => {
        const signals = abortableHang();
        const scan = startDeadScan([{ id: 'a', url: 'https://a.com/' }]);
        scan.abort();
        const results = await scan.promise;
        expect(results.size).toBe(0);
        expect(signals[0].aborted).toBe(true);
    });

    it('startDeadScan resolves the full Map when left alone', async () => {
        stubFetch(respond(503));
        const scan = startDeadScan([{ id: 'a', url: 'https://a.com/' }]);
        const results = await scan.promise;
        expect(results.get('a')).toEqual({ status: 503, ok: false });
    });
});
