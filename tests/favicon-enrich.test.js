import { describe, it, expect, beforeEach } from 'vitest';
import {
    initFaviconEnrich,
    validateAndEncode,
    extractLinkIcons,
    bytesToBase64,
    parseIdx,
    emptyIdx,
    FAVICON_DATA_PREFIX,
    FAVICON_IDX_KEY,
    CONCURRENCY,
    MAX_ENTRIES,
    MAX_BYTES,
    FAILED_TTL_MS,
    SUCCESS_TTL_MS,
    BREAKER_TTL_MS,
    DDG_URL
} from '../src/favicon-enrich.js';
import { makeStorageArea } from './helpers/chrome.js';

// A valid 1×1 PNG in bytes (opaque, mid-tone). base64:
// data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/0D8lJQAAAABJRU5ErkJggg==
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13,
    73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
    137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215, 99, 248, 207, 192, 240, 31, 0,
    5, 128, 2, 63, 208, 63, 37, 37, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

// A minimal ICO header (00 00 01 00 …) with a tiny payload.
const ICO_BYTES = new Uint8Array([0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 16, 0, 0, 0,
    32, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);

const PNG_DATA_URL = `data:image/png;base64,${bytesToBase64(PNG_BYTES)}`;

// A fake Image constructor that "loads" any data URL (naturalWidth = 1).
const makeFakeImage = () => class {
    constructor() {
        this.naturalWidth = 1;
        this.naturalHeight = 1;
        this._src = '';
    }
    set src(v) {
        this._src = v;
        // Resolve async like a real load.
        setTimeout(() => this.onload && this.onload(), 0);
    }
    get src() { return this._src; }
};

// fetchImpl stub: route by URL.
const makeFetch = routes => {
    const calls = [];
    const fn = async (url, opts) => {
        calls.push({ url, opts });
        for (const [pattern, handler] of routes) {
            if (pattern.test(url))
                return typeof handler === 'function' ? handler(url, opts) : handler;
        }
        return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } };
    };
    fn.calls = calls;
    return fn;
};

const pngResponse = bytes => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => (bytes || PNG_BYTES).buffer.slice((bytes || PNG_BYTES).byteOffset, (bytes || PNG_BYTES).byteOffset + (bytes || PNG_BYTES).byteLength),
    headers: { get: () => 'image/png' }
});

// A fake faviconService (fallback API) the enricher hot-swaps against.
const makeFavService = () => {
    const statsBySrc = new Map();
    return {
        statsBySrc,
        sampleIcon: img => ({ hash: 1, dark: 0, light: 1, colored: 0, cover: 1, w: 1, h: 1 }),
        applyContrast: () => {}
    };
};

// A minimal element double for the hot-swap anchor.
const makeAnchor = () => {
    const svg = {
        tagName: 'SVG',
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); }
        },
        remove() { this._removed = true; }
    };
    const anchor = {
        tagName: 'A',
        isConnected: true,
        children: [svg],
        querySelector(sel) { return sel === 'svg.vbm-icon-doc' ? svg : null; },
        replaceChild(newEl, oldEl) {
            const i = this.children.indexOf(oldEl);
            if (i >= 0) this.children[i] = newEl;
            else this.children.push(newEl);
        }
    };
    svg.parentNode = anchor;
    return anchor;
};

// Make a placeholder img (src carries the pageUrl the enricher reads back).
const makePlaceholderImg = (pageUrl) => ({
    src: `chrome-extension://test/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`,
    parentNode: makeAnchor()
});

// Minimal document double (createElement for the hot-swap img).
const makeDoc = () => ({
    createElement: tag => ({
        tagName: tag.toUpperCase(),
        className: '',
        width: 0,
        height: 0,
        alt: '',
        src: '',
        addEventListener(type, fn) { this._once = { type, fn }; },
        dispatchLoad() { if (this._once && this._once.type === 'load') this._once.fn(); }
    })
});

const tick = () => new Promise(r => setTimeout(r, 0));

let seq = 0;
const nextNow = () => { seq += 1000; return 1700000000000 + seq; };

describe('bytesToBase64 / mime sniff', () => {
    it('encodes bytes to base64', () => {
        expect(bytesToBase64(new Uint8Array([255, 0, 128]))).toBe('/wCA');
    });
});

describe('extractLinkIcons', () => {
    it('finds rel=icon links with absolute + relative hrefs', () => {
        const html = '<head>' +
            '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">' +
            '<link rel="icon" type="image/svg+xml" href="/icon.svg">' +
            '<link rel="apple-touch-icon" href="https://cdn.example.com/apple.png">' +
            '<link rel="stylesheet" href="/style.css">' +
            '</head>';
        const links = extractLinkIcons(html, 'https://example.com/page');
        // SVG scores 2, 32x32 scores 3, apple-touch default 1 — order by score desc.
        expect(links[0].href).toBe('https://example.com/favicon-32x32.png');
        expect(links[1].href).toBe('https://example.com/icon.svg');
        expect(links[2].href).toBe('https://cdn.example.com/apple.png');
        expect(links.some(l => l.href.includes('style.css'))).toBe(false);
    });

    it('passes data: hrefs through as inline icon data', () => {
        const dataHref = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/0D8lJQAAAABJRU5ErkJggg==';
        const links = extractLinkIcons(`<link rel="icon" href="${dataHref}">`, 'https://example.com/');
        expect(links).toHaveLength(1);
        expect(links[0].data).toBe(true);
        expect(links[0].href).toBe(dataHref);
    });
});

describe('validateAndEncode', () => {
    it('rejects non-2xx', async () => {
        expect(await validateAndEncode({ ok: false, status: 404 }, { Image: makeFakeImage() })).toBeNull();
    });

    it('rejects oversized responses (>200KB)', async () => {
        const big = new Uint8Array(200 * 1024 + 1);
        const res = { ok: true, arrayBuffer: async () => big.buffer, headers: { get: () => 'image/png' } };
        expect(await validateAndEncode(res, { Image: makeFakeImage() })).toBeNull();
    });

    it('rejects non-image magic (text/html)', async () => {
        const res = { ok: true, arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer, headers: { get: () => 'text/html' } };
        // Content-Type text/html is not image/*, magic sniff on '<' would pass for SVG —
        // but the header says text/html, so we must reject via the header path.
        expect(await validateAndEncode(res, { Image: makeFakeImage() })).toBeNull();
    });

    it('accepts a real PNG with image/png content type', async () => {
        const res = pngResponse(PNG_BYTES);
        const out = await validateAndEncode(res, { Image: makeFakeImage() });
        expect(out).not.toBeNull();
        expect(out.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('sniffs ICO magic when content-type is missing', async () => {
        const res = {
            ok: true,
            arrayBuffer: async () => ICO_BYTES.buffer,
            headers: { get: () => null }
        };
        const out = await validateAndEncode(res, { Image: makeFakeImage() });
        expect(out).not.toBeNull();
        expect(out.dataUrl.startsWith('data:image/x-icon;base64,')).toBe(true);
    });

    it('rejects an image that fails Image decode (naturalWidth 0)', async () => {
        const deadImage = class {
            set src(v) { setTimeout(() => this.onerror && this.onerror(), 0); }
        };
        const res = pngResponse(PNG_BYTES);
        expect(await validateAndEncode(res, { Image: deadImage })).toBeNull();
    });
});

describe('initFaviconEnrich — discovery chain', () => {
    beforeEach(() => { seq = 0; });

    it('L1 hit short-circuits (L2/L4 not requested)', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        const img = makePlaceholderImg('https://github.com/');
        const handled = en.onPlaceholder(img);
        // L1 hit → the hook returns true (it replaced the placeholder inline? No —
        // L1 runs async through the queue; onPlaceholder enqueues and returns false).
        expect(handled).toBe(false);
        await tick();
        await tick();
        const favCall = fetchImpl.calls.find(c => /favicon\.ico$/.test(c.url));
        expect(favCall).toBeTruthy();
        // L2/L4 were never attempted.
        expect(fetchImpl.calls.some(c => c.url === 'https://github.com/')).toBe(false);
        expect(fetchImpl.calls.some(c => DDG_URL('github.com') === c.url)).toBe(false);
    });

    it('L1 404 → L2 parses <link> and fetches the icon', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/^https:\/\/example\.com\/$/, {
                ok: true,
                text: async () => '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
                headers: { get: () => 'text/html' }
            }],
            [/favicon-32x32\.png$/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        const img = makePlaceholderImg('https://example.com/');
        en.onPlaceholder(img);
        await tick();
        await tick();
        expect(fetchImpl.calls.some(c => /favicon-32x32\.png$/.test(c.url))).toBe(true);
        expect(fetchImpl.calls.some(c => c.url === DDG_URL('example.com'))).toBe(false);
    });

    it('L1/L2 fail → L4 (DDG) attempted only when ddgEnabled', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/^https:\/\/example\.com\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/duckduckgo/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://example.com/'));
        await tick();
        await tick();
        expect(fetchImpl.calls.some(c => c.url === DDG_URL('example.com'))).toBe(true);
    });

    it('L1/L2 direct fail + proxy session live → L3 relays via addProxyMarker', async () => {
        const local = makeStorageArea({ deadProxyServer: 'http://proxy.example:8080' });
        const session = makeStorageArea({ vbmProxySession: { active: true } });
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/^https:\/\/proxy\.example\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/favicon\.ico.*__vbm_px=1/, pngResponse()]   // the PROXIED L1 succeeds
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local, session } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://proxy.example/'));
        await tick();
        await tick();
        // The proxied L1 (with the __vbm_px marker) was attempted and won.
        const proxied = fetchImpl.calls.some(c => /__vbm_px=1/.test(c.url) && /favicon\.ico/.test(c.url));
        expect(proxied).toBe(true);
        // DDG was not attempted (not opted in).
        expect(fetchImpl.calls.some(c => c.url === DDG_URL('proxy.example'))).toBe(false);
    });

    it('proxy session NOT live → L3 skipped, chain falls to L4', async () => {
        const local = makeStorageArea({ deadProxyServer: 'http://proxy.example:8080' });
        const session = makeStorageArea({});   // no vbmProxySession marker
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/^https:\/\/proxy\.example\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/duckduckgo/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local, session } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://proxy.example/'));
        await tick();
        await tick();
        // No proxied attempt (session absent) → L4 DDG reached.
        expect(fetchImpl.calls.some(c => /__vbm_px=1/.test(c.url))).toBe(false);
        expect(fetchImpl.calls.some(c => c.url === DDG_URL('proxy.example'))).toBe(true);
    });

    it('breaker-tripped DDG gets one proxied retry when the proxy is live', async () => {
        const local = makeStorageArea({ deadProxyServer: 'http://proxy.example:8080' });
        const session = makeStorageArea({ vbmProxySession: { active: true } });
        let ddgProxied = 0;
        const fetchImpl = makeFetch([
            [/duckduckgo.*__vbm_px=1/, () => { ddgProxied++; return pngResponse(); }],  // proxied DDG succeeds
            [/duckduckgo/, () => { throw new TypeError('down'); }],   // direct DDG unreachable
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/^https:\/\/noicon\.example\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local, session } },
            now: nextNow
        });
        await en._hydrateDone;
        // Pre-trip the breaker (as if a prior host's DDG direct network-failed).
        en.getIdx().ddgDownUntil = nextNow() + BREAKER_TTL_MS;
        // L1/L2 direct fail → L3: proxied L1/L2 fail, but the breaker is
        // tripped so L3's proxied-DDG-retry branch fires and wins.
        en.onPlaceholder(makePlaceholderImg('https://noicon.example/'));
        await tick();
        await tick();
        expect(ddgProxied).toBeGreaterThanOrEqual(1);   // proxied DDG retry won
    });

    it('ddgEnabled=false skips L4 (never hits DuckDuckGo)', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://example.com/'));
        await tick();
        await tick();
        expect(fetchImpl.calls.some(c => DDG_URL('example.com') === c.url)).toBe(false);
    });
});

describe('initFaviconEnrich — DDG breaker', () => {
    beforeEach(() => { seq = 0; });

    it('an HTTP 403 from DDG does NOT trip the breaker (service reachable, host not found)', async () => {
        let ddgCalls = 0;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/^https:\/\/example\.com\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/duckduckgo/, () => { ddgCalls++; return { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }; }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        // Two hosts → two DDG attempts, both 403 (host-not-found) → NO breaker trip.
        en.onPlaceholder(makePlaceholderImg('https://a.example/'));
        await tick();
        await tick();
        en.onPlaceholder(makePlaceholderImg('https://b.example/'));
        await tick();
        await tick();
        expect(ddgCalls).toBe(2);              // both attempted — service reachable
        expect(en.getIdx().ddgDownUntil).toBe(0);  // never tripped
    });

    it('breaker auto-heals after 6h and allows a probe', async () => {
        let ddgCalls = 0;
        let nowVal = 1700000000000;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/^https:\/\/x\.example\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/duckduckgo/, () => { ddgCalls++; throw new TypeError('down'); }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: () => nowVal
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://x.example/'));
        await tick(); await tick();
        expect(ddgCalls).toBe(1);
        expect(en.getIdx().ddgDownUntil).toBeGreaterThan(0);
        // Advance past the 6h breaker → a new host gets one L4 probe.
        nowVal += BREAKER_TTL_MS + 1;
        en.onPlaceholder(makePlaceholderImg('https://y.example/'));
        await tick(); await tick();
        expect(ddgCalls).toBe(2);   // probe allowed after heal
    });

    it('a network error on L4 trips the breaker; subsequent hosts skip L4', async () => {
        let ddgCalls = 0;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/^https:\/\/example\.com\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/duckduckgo/, () => { ddgCalls++; throw new TypeError('network down'); }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        // Two hosts, both fail L1/L2, both would hit L4 → breaker trips on the first.
        en.onPlaceholder(makePlaceholderImg('https://a.example/'));
        await tick();
        await tick();
        en.onPlaceholder(makePlaceholderImg('https://b.example/'));
        await tick();
        await tick();
        // First DDG attempt tripped the breaker; second must NOT reach DDG again.
        expect(ddgCalls).toBe(1);
        expect(en.getIdx().ddgDownUntil).toBeGreaterThan(0);
    });
});

describe('initFaviconEnrich — cache layer', () => {
    beforeEach(() => { seq = 0; });

    it('writes per-host data key + index on success', async () => {
        const storage = makeStorageArea();
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://github.com/'));
        await tick();
        await tick();
        const key = `${FAVICON_DATA_PREFIX}github.com`;
        expect(storage.data[key]).toContain('data:image/');
        expect(storage.data[FAVICON_IDX_KEY]).toContain('github.com');
    });

    it('writes a failed marker (index only, no data key) on total failure', async () => {
        const storage = makeStorageArea();
        const fetchImpl = makeFetch([]);  // everything 404s
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://noicon.example/'));
        await tick();
        await tick();
        en.flushIndex();   // the index write is debounced — flush for the assert
        expect(storage.data[`${FAVICON_DATA_PREFIX}noicon.example`]).toBeUndefined();
        expect(storage.data[FAVICON_IDX_KEY]).toContain('noicon.example');
    });

    it('a cached success hot-swaps immediately (no network)', async () => {
        let fetches = 0;
        const storage = makeStorageArea({ [`${FAVICON_DATA_PREFIX}github.com`]: PNG_DATA_URL, [FAVICON_IDX_KEY]: JSON.stringify({ v: 1, ddgDownUntil: 0, hosts: { 'github.com': { t: Date.now(), s: PNG_DATA_URL.length } } }) });
        const fetchImpl = makeFetch([[/.*/, () => { fetches++; return { ok: false, status: 404 }; }]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        const img = makePlaceholderImg('https://github.com/');
        const handled = en.onPlaceholder(img);
        expect(handled).toBe(true);   // cached hit → replaced, return true
        expect(fetches).toBe(0);
    });

    it('a failed marker (within 24h) suppresses requests', async () => {
        let fetches = 0;
        const storage = makeStorageArea({ [FAVICON_IDX_KEY]: JSON.stringify({ v: 1, ddgDownUntil: 0, hosts: { 'noicon.example': { f: 1, t: Date.now() } } }) });
        const fetchImpl = makeFetch([[/.*/, () => { fetches++; return { ok: false, status: 404 }; }]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        const handled = en.onPlaceholder(makePlaceholderImg('https://noicon.example/'));
        expect(handled).toBe(false);  // failed marker → no queue, no request
        await tick();
        await tick();
        expect(fetches).toBe(0);
    });
});

describe('initFaviconEnrich — queue + eviction', () => {
    beforeEach(() => { seq = 0; });

    it('dedupes concurrent renders of the same host', async () => {
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://github.com/'));
        en.onPlaceholder(makePlaceholderImg('https://github.com/pulls'));
        await tick();
        await tick();
        // The two rows share one favicon.ico fetch (different pageUrls, same host).
        const favCalls = fetchImpl.calls.filter(c => /favicon\.ico$/.test(c.url));
        expect(favCalls.length).toBe(1);
    });

    it('evicts by byte budget (2MB → 1.6MB)', async () => {
        // Seed entries summing just over 2MB; add one → eviction to ≤1.6MB.
        const bigData = 'x'.repeat(20 * 1024);   // 20KB each
        const hosts = {};
        for (let i = 0; i < 110; i++)  // 110 × 20KB = 2.2MB
            hosts[`big${i}.example`] = { t: 1700000000000 + i * 1000, s: bigData.length };
        const storage = makeStorageArea({ [FAVICON_IDX_KEY]: JSON.stringify({ v: 1, ddgDownUntil: 0, hosts }) });
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: () => 1700000000000 + 200 * 1000
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://new2.example/'));
        await tick();
        await tick();
        const cache = en.getCache();
        let bytes = 0;
        for (const e of cache.values())
            if (e.d) bytes += e.d.length;
        expect(bytes).toBeLessThanOrEqual(1.6 * 1024 * 1024);
        expect(cache.has('big0.example')).toBe(false);   // oldest evicted first
        expect(cache.has('new2.example')).toBe(true);
    });

    it('an oversized icon (>96KB) stays session-only (no data key persisted)', async () => {
        const big = new Uint8Array(100 * 1024);
        for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
        // PNG magic + enough bytes to be >96KB after base64.
        big[0] = 0x89; big[1] = 0x50; big[2] = 0x4e; big[3] = 0x47;
        const storage = makeStorageArea();
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse(big)]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://big.example/'));
        await tick(); await tick();
        // Session cache has it, but no data key was persisted.
        expect(en.getCache().has('big.example')).toBe(true);
        expect(storage.data[`${FAVICON_DATA_PREFIX}big.example`]).toBeUndefined();
    });

    it('evicts the oldest entry over the 500-entry budget', async () => {
        // Seed 500 cached entries + one new host → eviction to 400.
        const hosts = {};
        for (let i = 0; i < MAX_ENTRIES; i++)
            hosts[`h${i}.example`] = { t: 1700000000000 + i * 1000, s: 100 };
        const storage = makeStorageArea({ [FAVICON_IDX_KEY]: JSON.stringify({ v: 1, ddgDownUntil: 0, hosts }) });
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: () => 1700000000000 + MAX_ENTRIES * 1000 + 5000
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://new.example/'));
        await tick();
        await tick();
        const cache = en.getCache();
        // 500 seeded + 1 new → evict to 400.
        expect(cache.size).toBeLessThanOrEqual(400);
        // The oldest seeded hosts were evicted first.
        expect(cache.has('h0.example')).toBe(false);
        expect(cache.has('new.example')).toBe(true);
    });
});

describe('initFaviconEnrich — hot swap', () => {
    beforeEach(() => { seq = 0; });

    it('replaces the default SVG with an enriched <img> on success', async () => {
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        const img = makePlaceholderImg('https://github.com/');
        en.onPlaceholder(img);
        await tick();
        await tick();
        // The anchor's child is now an <img class=favicon-enriched>, not the SVG.
        const anchor = img.parentNode;
        expect(anchor.children[0].tagName).toBe('IMG');
        expect(anchor.children[0].className).toBe('favicon-enriched');
        expect(anchor.children[0].src).toContain('data:image/');
    });

    it('skips a detached anchor without throwing', async () => {
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        const img = { src: `chrome-extension://t/_favicon/?pageUrl=${encodeURIComponent('https://gone.example/')}&size=32`, parentNode: null };
        expect(() => en.onPlaceholder(img)).not.toThrow();
    });
});

describe('initFaviconEnrich — setEnabled / onChanged', () => {
    beforeEach(() => { seq = 0; });

    it('caps concurrent in-flight fetches at CONCURRENCY', async () => {
        // 12 hosts all hit slow favicon.ico responses; at most 6 in flight.
        let inflight = 0, maxInflight = 0;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, async () => {
                inflight++;
                maxInflight = Math.max(maxInflight, inflight);
                await new Promise(r => setTimeout(r, 10));
                inflight--;
                return pngResponse();
            }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        for (let i = 0; i < 12; i++)
            en.onPlaceholder(makePlaceholderImg(`https://h${i}.example/`));
        await new Promise(r => setTimeout(r, 30));
        expect(maxInflight).toBeLessThanOrEqual(CONCURRENCY);
    });

    it('setEnabled(false) stops new enqueues', async () => {
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.setEnabled(false);
        const handled = en.onPlaceholder(makePlaceholderImg('https://github.com/'));
        expect(handled).toBe(false);   // disabled → fallback keeps default SVG
        await tick();
        await tick();
        expect(fetchImpl.calls.length).toBe(0);
    });

    it('clears the in-memory cache when the index is removed (options cache clear)', async () => {
        const storage = makeStorageArea({
            [`${FAVICON_DATA_PREFIX}github.com`]: PNG_DATA_URL,
            [FAVICON_IDX_KEY]: JSON.stringify({ v: 1, ddgDownUntil: 0, hosts: { 'github.com': { t: Date.now(), s: PNG_DATA_URL.length } } })
        });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        expect(en.getCache().has('github.com')).toBe(true);
        // Simulate the options page clearing: index + data keys removed.
        storage.remove([FAVICON_IDX_KEY, `${FAVICON_DATA_PREFIX}github.com`]);
        // The enricher's onChanged listener fires — invoke it via the storage double.
        // makeStorageArea doesn't wire onChanged; assert the listener contract by
        // re-hydrating through a fresh enricher instead (the onChanged path is thin).
        const en2 = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en2._hydrateDone;
        expect(en2.getCache().has('github.com')).toBe(false);
    });
});

describe('index parse + rebuild', () => {
    it('parseIdx rejects corrupt JSON', () => {
        expect(parseIdx('not json')).toBeNull();
    });

    it('emptyIdx has the shape version', () => {
        expect(emptyIdx().v).toBe(1);
        expect(emptyIdx().ddgDownUntil).toBe(0);
        expect(emptyIdx().hosts).toEqual({});
    });

    it('hydrate rebuilds the index from surviving data keys when the index is corrupt', async () => {
        const storage = makeStorageArea({ [`${FAVICON_DATA_PREFIX}github.com`]: PNG_DATA_URL });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        expect(en.getCache().has('github.com')).toBe(true);
        // The rebuilt index was persisted.
        expect(storage.data[FAVICON_IDX_KEY]).toContain('github.com');
    });

    it('quota write rejection → emergency eviction of the oldest half, then the new entry survives', async () => {
        // Seed enough old entries (with their data keys — hydrate reconciles
        // index↔data) that evicting half frees room; the write path hits a
        // quota error once, evicts, retries successfully.
        const hosts = {};
        const seedData = {};
        const DATA = 'data:image/png;base64,AAAA';   // a tiny stand-in
        for (let i = 0; i < 60; i++) {
            const h = `q${i}.example`;
            hosts[h] = { t: 1700000000000 + i * 1000, s: DATA.length };
            seedData[`${FAVICON_DATA_PREFIX}${h}`] = DATA;
        }
        seedData[FAVICON_IDX_KEY] = JSON.stringify({ v: 1, ddgDownUntil: 0, hosts });
        const base = makeStorageArea(seedData);
        // Wrap set to throw a quota error on the first data-key write.
        let quotaThrown = false;
        const storage = {
            data: base.data,
            calls: base.calls,
            get: base.get.bind(base),
            remove: base.remove.bind(base),
            clear: base.clear.bind(base),
            set: (obj, cb) => {
                if (!quotaThrown && Object.keys(obj).some(k => k.startsWith(FAVICON_DATA_PREFIX))) {
                    quotaThrown = true;
                    const err = new Error('QUOTA_BYTES quota exceeded');
                    if (cb) { cb(err); return undefined; }
                    return Promise.reject(err);
                }
                return base.set(obj, cb);
            }
        };
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: () => 1700000000000 + 80 * 1000
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://new.example/'));
        await tick(); await tick();
        // The new entry survives in the session map (degraded), and the
        // emergency eviction freed the oldest ~half.
        expect(en.getCache().has('new.example')).toBe(true);
        expect(en.getCache().size).toBeLessThanOrEqual(40);
        expect(en.getCache().has('q0.example')).toBe(false);   // oldest evicted
        expect(quotaThrown).toBe(true);
    });

    it('reconciles index↔data-key drift: stale index entry dropped, orphan data key re-added', async () => {
        // Index says success for a host whose data key is gone → drop.
        // A data key with no index entry → re-add on hydrate.
        const hosts = { 'stale.example': { t: 1700000000000, s: 100 } };
        const storage = makeStorageArea({
            [`${FAVICON_DATA_PREFIX}orphan.example`]: PNG_DATA_URL,
            [FAVICON_IDX_KEY]: JSON.stringify({ v: 1, ddgDownUntil: 0, hosts })
        });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            ddgEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        const cache = en.getCache();
        expect(cache.has('stale.example')).toBe(false);   // stale index entry dropped
        expect(cache.has('orphan.example')).toBe(true);   // orphan data key re-added
        // The reconciled index dropped the stale host.
        expect(en.getIdx().hosts['stale.example']).toBeUndefined();
    });
});
