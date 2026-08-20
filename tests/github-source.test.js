import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchGithubResource, GITHUB_SOURCE_TIMEOUT } from '../src/github-source.js';
import { MIRROR_KEY, parseMirrorCache } from '../src/github-mirrors.js';

// GitHub resource fetch chain: direct → user proxy (marker-PAC) → top-5
// mirror candidates. The dead-proxy chrome wrappers read `globalThis.chrome`
// at call time, so proxy-layer tests install a fake global.

const URL1 = 'https://raw.githubusercontent.com/windviki/vBookmarks/master/docs/announce.json';
const MARKER = '__vbm_px=1';

const makeChrome = (localData = {}) => {
    const local = new Map(Object.entries(localData));
    const session = new Map();
    return {
        storage: {
            local: {
                async get(key) {
                    return key ? { [key]: local.get(key) } : Object.fromEntries(local);
                },
                async set(obj) {
                    for (const [k, v] of Object.entries(obj)) {
                        if (v === undefined)
                            local.delete(k);
                        else
                            local.set(k, v);
                    }
                }
            },
            session: {
                async get(key) {
                    return key ? { [key]: session.get(key) } : Object.fromEntries(session);
                },
                async set(obj) {
                    for (const [k, v] of Object.entries(obj))
                        session.set(k, v);
                }
            }
        },
        local,
        session
    };
};

const okRes = (json = null, etag = '') => ({
    ok: true,
    status: 200,
    headers: { get: k => (k === 'etag' ? etag : null) },
    json: async () => json
});

const validate = async res => {
    const data = await res.json();
    return data && data.messages ? data : null;
};

afterEach(() => {
    delete globalThis.chrome;
    vi.restoreAllMocks();
});

describe('fetchGithubResource — direct layer', () => {
    it('returns validated data from the canonical GitHub URL', async () => {
        const fetchImpl = vi.fn(async () => okRes({ messages: [{ id: 'm' }] }, 'W/"x"'));
        const got = await fetchGithubResource({ url: URL1, fetchImpl, validate });
        expect(got).toEqual({ data: { messages: [{ id: 'm' }] }, etag: 'W/"x"', source: 'direct' });
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(fetchImpl.mock.calls[0][0]).toBe(URL1);
        expect(fetchImpl.mock.calls[0][1].headers).toEqual({});
    });

    it('passes If-None-Match through and returns notModified on 304', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 304 }));
        const got = await fetchGithubResource({ url: URL1, etag: 'W/"x"', fetchImpl, validate });
        expect(got).toEqual({ notModified: true, source: 'direct' });
        expect(fetchImpl.mock.calls[0][1].headers['If-None-Match']).toBe('W/"x"');
    });

    it('treats a direct validation failure as a miss (no data)', async () => {
        const fetchImpl = vi.fn(async () => okRes({ nope: true }));
        const got = await fetchGithubResource({ url: URL1, fetchImpl, validate, chromeImpl: makeChrome() });
        expect(got).toBeNull();
        // fell through to mirrors (none configured) and gave up
    });
});

describe('fetchGithubResource — proxy layer', () => {
    it('rides a live PAC session and returns proxied data', async () => {
        const chromeImpl = makeChrome({ deadProxyServer: 'http://127.0.0.1:7890' });
        chromeImpl.session.set('vbmProxySession', 1);
        const fetchImpl = vi.fn(async url => {
            if (url.includes(MARKER))
                return okRes({ messages: [{ id: 'p' }] });
            throw new Error('direct unreachable');
        });
        const got = await fetchGithubResource({ url: URL1, fetchImpl, chromeImpl, validate });
        expect(got.data).toEqual({ messages: [{ id: 'p' }] });
        expect(got.source).toBe('proxy');
        expect(fetchImpl.mock.calls[1][0]).toContain(MARKER);
    });

    it('installs a temporary PAC when no session is live, then tears it down', async () => {
        globalThis.chrome = {
            runtime: {},
            proxy: {
                settings: {
                    get: (_, cb) => cb({ levelOfControl: 'ok' }),
                    set: vi.fn((_, cb) => cb()),
                    clear: vi.fn((_, cb) => cb())
                }
            }
        };
        const chromeImpl = makeChrome({ deadProxyServer: 'http://127.0.0.1:7890' });
        const fetchImpl = vi.fn(async url => {
            if (url.includes(MARKER))
                return okRes({ messages: [{ id: 'p' }] });
            throw new Error('direct unreachable');
        });
        const got = await fetchGithubResource({ url: URL1, fetchImpl, chromeImpl, validate });
        expect(got.source).toBe('proxy');
        expect(globalThis.chrome.proxy.settings.set).toHaveBeenCalled();
        expect(globalThis.chrome.proxy.settings.clear).toHaveBeenCalled();
    });

    it('skips the proxy when none is configured', async () => {
        const chromeImpl = makeChrome({ [MIRROR_KEY]: { ts: 1000, refreshedAt: 1000, nodes: [], down: {} } });
        const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
        const got = await fetchGithubResource({ url: URL1, fetchImpl, chromeImpl, validate });
        expect(got).toBeNull();
        expect(fetchImpl.mock.calls.every(c => !c[0].includes(MARKER))).toBe(true);
    });
});

describe('fetchGithubResource — mirror layer', () => {
    it('uses a cached mirror candidate after direct + proxy fail', async () => {
        const cache = { v: 1, ts: 1000, refreshedAt: 1000, nodes: [{ host: 'mirror.example' }], down: {} };
        const chromeImpl = makeChrome({ [MIRROR_KEY]: cache });
        const fetchImpl = vi.fn(async url => {
            if (url.includes('mirror.example'))
                return okRes({ messages: [{ id: 'mirror' }] });
            throw new Error('direct unreachable');
        });
        const got = await fetchGithubResource({ url: URL1, fetchImpl, chromeImpl, validate });
        expect(got.data).toEqual({ messages: [{ id: 'mirror' }] });
        expect(got.source).toBe('mirror:mirror.example');
    });

    it('trips the breaker on a network failure and fails over to the next mirror', async () => {
        const cache = {
            v: 1, ts: 1000, refreshedAt: 1000,
            nodes: [{ host: 'bad.example' }, { host: 'good.example' }],
            down: {}
        };
        const chromeImpl = makeChrome({ [MIRROR_KEY]: cache });
        const fetchImpl = vi.fn(async url => {
            if (url.includes('bad.example'))
                throw new Error('unreachable');
            if (url.includes('good.example'))
                return okRes({ messages: [{ id: 'good' }] });
            throw new Error('direct unreachable');
        });
        const got = await fetchGithubResource({ url: URL1, fetchImpl, chromeImpl, validate, now: () => 2000 });
        expect(got.source).toBe('mirror:good.example');
        const stored = parseMirrorCache(chromeImpl.local.get(MIRROR_KEY));
        expect(stored.down['bad.example']).toBe(2000 + 6 * 60 * 60 * 1000);
    });

    it('continues past clean HTTP failures without tripping breakers', async () => {
        const cache = {
            v: 1, ts: 1000, refreshedAt: 1000,
            nodes: [{ host: 'http-fail.example' }, { host: 'good.example' }],
            down: {}
        };
        const chromeImpl = makeChrome({ [MIRROR_KEY]: cache });
        const fetchImpl = vi.fn(async url => {
            if (url.includes('http-fail.example'))
                return { ok: false, status: 404 };
            if (url.includes('good.example'))
                return okRes({ messages: [{ id: 'good' }] });
            throw new Error('direct unreachable');
        });
        const got = await fetchGithubResource({ url: URL1, fetchImpl, chromeImpl, validate });
        expect(got.source).toBe('mirror:good.example');
        const stored = parseMirrorCache(chromeImpl.local.get(MIRROR_KEY));
        expect(stored.down['http-fail.example']).toBeUndefined();
    });

    it('returns null when every layer fails', async () => {
        const chromeImpl = makeChrome();
        const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
        const got = await fetchGithubResource({ url: URL1, fetchImpl, chromeImpl, validate, now: () => 1000 });
        expect(got).toBeNull();
        expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(
            1 + 5 + 1   // direct + builtin mirrors + akams homepage
        );
    });
});

describe('fetchGithubResource — bounds', () => {
    it('exposes the shared timeout constant used by announce', () => {
        expect(GITHUB_SOURCE_TIMEOUT).toBe(4000);
    });
});
