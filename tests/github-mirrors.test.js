import { describe, it, expect, vi } from 'vitest';
import {
    MIRROR_KEY, MIRROR_LIST_URL, MIRROR_TTL_MS, MIRROR_REFRESH_COOLDOWN_MS,
    MIRROR_BREAKER_TTL_MS, BUILTIN_MIRRORS,
    buildMirrorUrl, extractChunkSrcs, parseMirrorHostsFromJs,
    parseMirrorCache, readMirrorCache, writeMirrorCache, usableMirrorHosts,
    markMirrorDown, fetchAkamsMirrorHosts, probeMirrorHosts,
    refreshGithubMirrors, ensureGithubMirrorHosts
} from '../src/github-mirrors.js';

// GitHub mirror provider management (4.0.8 announce fallback): akams node
// discovery, bounded speed test, top-5 persistence and per-host breakers.

const makeStorage = (localData = {}) => {
    const local = new Map(Object.entries(localData));
    return {
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
        map: local
    };
};

const htmlWithChunk = src =>
    `<html><head><script src="${src}" async=""></script></head></html>`;

const jsWithNodes = hosts =>
    'use strict;var j=[' + hosts.map(h => `{label:"contribute",value:"${h}"}`).join(',') + '];';

describe('buildMirrorUrl', () => {
    it('prefixes the full GitHub URL with the mirror host', () => {
        expect(buildMirrorUrl('ghproxy.net', 'https://raw.githubusercontent.com/a/b.json'))
            .toBe('https://ghproxy.net/https://raw.githubusercontent.com/a/b.json');
    });
});

describe('node-list extraction', () => {
    it('extracts only _next/static/chunks script srcs', () => {
        const html = htmlWithChunk('/_next/static/chunks/abc.js')
            + '<script src="/vendor/x.js"></script>'
            + '<script src="https://cdn.example/x.js"></script>';
        expect(extractChunkSrcs(html)).toEqual(['/_next/static/chunks/abc.js']);
    });

    it('parses + dedupes + normalizes mirror hosts from the chunk JS', () => {
        const js = jsWithNodes(['ghproxy.net', 'gh-proxy.com', 'ghproxy.net', 'ghf.无名氏.top']);
        const hosts = parseMirrorHostsFromJs(js);
        expect(hosts).toHaveLength(3);
        expect(hosts[0]).toBe('ghproxy.net');
        expect(hosts[1]).toBe('gh-proxy.com');
        expect(hosts[2]).toBe('ghf.xn--eqrr82bzpe.top');
    });

    it('returns [] for junk', () => {
        expect(parseMirrorHostsFromJs('no nodes here')).toEqual([]);
        expect(parseMirrorHostsFromJs(null)).toEqual([]);
    });
});

describe('mirror cache', () => {
    it('normalizes nodes, dedupes, caps to 5 and parses breakers', () => {
        const cache = parseMirrorCache({
            ts: 1000, refreshedAt: 900,
            nodes: [
                { host: 'a.example', latency: 12 },
                { host: 'A.EXAMPLE', latency: 13 },
                { host: 'b.example' },
                { host: 'c.example' }, { host: 'd.example' }, { host: 'e.example' }, { host: 'f.example' }
            ],
            down: { 'b.example': 2000 }
        });
        expect(cache.nodes).toHaveLength(5);
        expect(cache.nodes[0].host).toBe('a.example');
        expect(cache.down['b.example']).toBe(2000);
    });

    it('rejects empty or malformed caches', () => {
        expect(parseMirrorCache(null)).toBeNull();
        expect(parseMirrorCache({ nodes: [] })).toBeNull();
        expect(parseMirrorCache({ nodes: [{ host: '??' }] })).toBeNull();
    });

    it('usableMirrorHosts filters breaker-tripped hosts', () => {
        const cache = parseMirrorCache({
            ts: 0, nodes: [{ host: 'a.example' }, { host: 'b.example' }],
            down: { 'a.example': 5000 }
        });
        expect(usableMirrorHosts(cache, 1000)).toEqual(['b.example']);
        expect(usableMirrorHosts(cache, 6000)).toEqual(['a.example', 'b.example']);
    });

    it('markMirrorDown trips the breaker and persists', async () => {
        const storage = makeStorage({ [MIRROR_KEY]: { ts: 0, refreshedAt: 0, nodes: [{ host: 'a.example' }] } });
        await markMirrorDown({ storage, now: () => 1000 }, 'a.example');
        const cache = parseMirrorCache(storage.map.get(MIRROR_KEY));
        expect(cache.down['a.example']).toBe(1000 + MIRROR_BREAKER_TTL_MS);
    });

    it('readMirrorCache / writeMirrorCache round-trip', async () => {
        const storage = makeStorage();
        await writeMirrorCache(storage, { v: 1, ts: 7, refreshedAt: 6, nodes: [{ host: 'a.example' }], down: {} });
        const cache = await readMirrorCache(storage);
        expect(cache.ts).toBe(7);
        expect(cache.nodes[0].host).toBe('a.example');
    });
});

describe('fetchAkamsMirrorHosts', () => {
    it('fetches the homepage, then the first chunk that carries nodes', async () => {
        const fetchImpl = vi.fn(async url => {
            if (url === MIRROR_LIST_URL)
                return { ok: true, text: async () => htmlWithChunk('/_next/static/chunks/page.js') };
            if (url.endsWith('/_next/static/chunks/page.js'))
                return { ok: true, text: async () => jsWithNodes(['ghproxy.net', 'gh-proxy.com']) };
            return { ok: false };
        });
        const hosts = await fetchAkamsMirrorHosts({ fetchImpl, fetchTimeoutMs: 100 });
        expect(hosts).toEqual(['ghproxy.net', 'gh-proxy.com']);
    });

    it('returns [] when the homepage is not ok', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 }));
        expect(await fetchAkamsMirrorHosts({ fetchImpl, fetchTimeoutMs: 100 })).toEqual([]);
    });
});

describe('probeMirrorHosts', () => {
    it('keeps only reachable hosts, sorted by measured latency', async () => {
        // A monotonic clock makes every probe a tiny bit slower than the last;
        // with immediate fetches the order is still deterministic enough to
        // assert the winner and the filtering of failed hosts.
        let tick = 0;
        const now = () => ++tick;
        const fetchImpl = vi.fn(async url => {
            if (url.includes('bad.example'))
                throw new Error('unreachable');
            return { ok: true };
        });
        const probed = await probeMirrorHosts({
            hosts: ['bad.example', 'fast.example', 'slow.example'],
            probeUrl: 'https://raw.githubusercontent.com/a/b.json',
            fetchImpl,
            now,
            perTimeoutMs: 100,
            budgetMs: 10000,
            concurrency: 2
        });
        expect(probed).toHaveLength(2);
        expect(probed.map(p => p.host)).toEqual(['fast.example', 'slow.example']);
        expect(probed[0].latency).toBeLessThanOrEqual(probed[1].latency);
    });

    it('applies the valid predicate so a 200 with wrong content is not a candidate', async () => {
        const fetchImpl = vi.fn(async url => ({
            ok: true,
            json: async () => (url.includes('ok.example')
                ? { messages: [{ id: 'm' }] }
                : { nope: true })
        }));
        const probed = await probeMirrorHosts({
            hosts: ['bad.example', 'ok.example'],
            probeUrl: 'u',
            fetchImpl,
            now: () => 1,
            perTimeoutMs: 100,
            budgetMs: 1000,
            concurrency: 2,
            valid: async res => {
                const j = await res.json();
                return Array.isArray(j.messages);
            }
        });
        expect(probed.map(p => p.host)).toEqual(['ok.example']);
    });

    it('returns [] without a fetch impl or hosts', async () => {
        expect(await probeMirrorHosts({ hosts: [], fetchImpl: vi.fn() })).toEqual([]);
        expect(await probeMirrorHosts({ hosts: ['a.example'], fetchImpl: null })).toEqual([]);
    });
});

describe('refreshGithubMirrors', () => {
    it('discovers nodes, probes them, persists top-5 and returns hosts', async () => {
        const storage = makeStorage();
        const hosts = ['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'f.example'];
        const fetchImpl = vi.fn(async url => {
            if (url === MIRROR_LIST_URL)
                return { ok: true, text: async () => htmlWithChunk('/_next/static/chunks/page.js') };
            if (url.endsWith('/_next/static/chunks/page.js'))
                return { ok: true, text: async () => jsWithNodes(hosts) };
            return { ok: true };   // probe fetch
        });
        const got = await refreshGithubMirrors({
            storage,
            fetchImpl,
            now: () => 1000,
            probeUrl: 'https://raw.githubusercontent.com/a/b.json'
        });
        expect(got).toHaveLength(5);
        expect(new Set(got).size).toBe(5);
        for (const host of got)
            expect(hosts).toContain(host);
        const cache = parseMirrorCache(storage.map.get(MIRROR_KEY));
        expect(cache).not.toBeNull();
        expect(cache.nodes).toHaveLength(5);
        expect(cache.ts).toBe(1000);
        expect(cache.refreshedAt).toBe(1000);
    });

    it('returns null when the node list cannot be fetched', async () => {
        const storage = makeStorage();
        const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
        expect(await refreshGithubMirrors({ storage, fetchImpl, now: () => 1, probeUrl: 'u' })).toBeNull();
    });
});

describe('ensureGithubMirrorHosts', () => {
    const freshCache = ts => ({
        v: 1, ts, refreshedAt: ts,
        nodes: [{ host: 'a.example' }, { host: 'b.example' }],
        down: {}
    });

    it('uses a fresh cache without any refresh fetch', async () => {
        const storage = makeStorage({ [MIRROR_KEY]: freshCache(1000) });
        const fetchImpl = vi.fn();
        const hosts = await ensureGithubMirrorHosts({ storage, fetchImpl, now: () => 2000, probeUrl: 'u' });
        expect(hosts).toEqual(['a.example', 'b.example']);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('seeds builtins when there is no cache and the refresh fails', async () => {
        const storage = makeStorage();
        const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
        const hosts = await ensureGithubMirrorHosts({ storage, fetchImpl, now: () => 5000, probeUrl: 'u' });
        expect(hosts).toEqual(BUILTIN_MIRRORS);
        const cache = parseMirrorCache(storage.map.get(MIRROR_KEY));
        expect(cache.nodes.map(n => n.host)).toEqual(BUILTIN_MIRRORS);
        expect(cache.refreshedAt).toBe(5000);
    });

    it('refreshes a stale cache when the cooldown allows', async () => {
        const storage = makeStorage({ [MIRROR_KEY]: freshCache(1000) });
        const fetchImpl = vi.fn(async url => {
            if (url === MIRROR_LIST_URL)
                return { ok: true, text: async () => htmlWithChunk('/_next/static/chunks/page.js') };
            if (url.endsWith('/_next/static/chunks/page.js'))
                return { ok: true, text: async () => jsWithNodes(['new.example']) };
            return { ok: true };
        });
        const now = () => 1000 + MIRROR_TTL_MS + 1000;
        const hosts = await ensureGithubMirrorHosts({ storage, fetchImpl, now, probeUrl: 'u' });
        expect(hosts).toContain('new.example');
        expect(fetchImpl).toHaveBeenCalled();
    });

    it('does not refresh a stale-but-usable cache inside the cooldown', async () => {
        const storage = makeStorage({ [MIRROR_KEY]: freshCache(1000) });
        const fetchImpl = vi.fn();
        const now = () => 1000 + MIRROR_REFRESH_COOLDOWN_MS - 1; // stale vs TTL? TTL is 7d, so still fresh; use expired ts
        const staleCache = freshCache(now() - MIRROR_TTL_MS - 1);
        storage.map.set(MIRROR_KEY, staleCache);
        const hosts = await ensureGithubMirrorHosts({ storage, fetchImpl, now, probeUrl: 'u' });
        expect(hosts).toEqual(['a.example', 'b.example']);
        expect(fetchImpl).not.toHaveBeenCalled();
    });

    it('returns [] when every cached host is tripped and refresh is on cooldown', async () => {
        const down = { 'a.example': 999999, 'b.example': 999999 };
        const storage = makeStorage({ [MIRROR_KEY]: { ...freshCache(1000), down } });
        const fetchImpl = vi.fn();
        const hosts = await ensureGithubMirrorHosts({ storage, fetchImpl, now: () => 2000, probeUrl: 'u' });
        expect(hosts).toEqual([]);
        expect(fetchImpl).not.toHaveBeenCalled();
    });
});
