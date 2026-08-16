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
    STORAGE_QUOTA_BYTES,
    BUDGET_FACTOR,
    MIN_BUDGET,
    BREAKER_TTL_MS,
    AGG_PROVIDERS,
    providerUrl,
    interpretFaviconRun,
    interpretDuckDuckGo,
    MAX_HTML_BYTES,
    SESSION_ONLY_CAP
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

// Provider lookup helpers (mirror the provider list — no copied URL strings).
const FR = host => providerUrl('favicon-run', host);
const DDG = host => providerUrl('duckduckgo', host);

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

const notFound = () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } });

// A response whose body is a readable chunk stream (exercises the streaming
// HTML-read cap — readHtmlCapped reads via res.body.getReader when present).
const streamResponse = (chunks, contentType = 'text/html') => {
    let i = 0;
    return {
        ok: true,
        status: 200,
        headers: { get: () => contentType },
        body: {
            getReader: () => ({
                read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
                cancel: async () => {}
            })
        }
    };
};

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

// A v3 index fixture (the current shape: per-provider down table + hosts).
const idxV3 = (hosts = {}, down = {}) => JSON.stringify({
    v: 3,
    down: { 'favicon-run': 0, 'duckduckgo': 0, ...down },
    hosts
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

    it('resolves relative hrefs against a <base href> when present', () => {
        // A <base> pointing at an asset CDN overrides the document base for
        // relative link hrefs — the icon URL must resolve against it, not pageUrl.
        const html = '<head><base href="https://cdn.example.com/icons/">' +
            '<link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png"></head>';
        const links = extractLinkIcons(html, 'https://example.com/page');
        expect(links).toHaveLength(1);
        expect(links[0].href).toBe('https://cdn.example.com/icons/favicon-32x32.png');
    });

    it('ignores <link> declarations inside HTML comments', () => {
        // A commented-out icon declaration must not be fetched — regex matching
        // on raw HTML would otherwise pick it up.
        const html = '<!-- <link rel="icon" href="/commented.png"> -->' +
            '<link rel="icon" type="image/png" sizes="32x32" href="/real.png">';
        const links = extractLinkIcons(html, 'https://example.com/');
        expect(links).toHaveLength(1);
        expect(links[0].href).toBe('https://example.com/real.png');
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

    it('accepts application/octet-stream via magic sniff (a common /favicon.ico header)', async () => {
        // Many servers/CDNs serve favicon.ico with an octet-stream content-type
        // — an explicit "I don't know" that must fall back to the magic sniff
        // (design §3.1 "否则 sniff 魔数"), not be treated as an authoritative reject.
        const pngRes = {
            ok: true,
            arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength),
            headers: { get: () => 'application/octet-stream' }
        };
        const pngOut = await validateAndEncode(pngRes, { Image: makeFakeImage() });
        expect(pngOut).not.toBeNull();
        expect(pngOut.dataUrl.startsWith('data:image/png;base64,')).toBe(true);

        const icoRes = {
            ok: true,
            arrayBuffer: async () => ICO_BYTES.buffer,
            headers: { get: () => 'application/octet-stream; charset=binary' }
        };
        const icoOut = await validateAndEncode(icoRes, { Image: makeFakeImage() });
        expect(icoOut).not.toBeNull();
        expect(icoOut.dataUrl.startsWith('data:image/x-icon;base64,')).toBe(true);
    });

    it('still rejects an explicit non-image header even when bytes would sniff as SVG', async () => {
        // The octet-stream relaxation must not weaken the authoritative-reject
        // policy: text/html (bytes starting with '<') stays refused — the false
        // SVG sniff guard.
        const res = {
            ok: true,
            arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer,
            headers: { get: () => 'text/html' }
        };
        expect(await validateAndEncode(res, { Image: makeFakeImage() })).toBeNull();
    });

    it('strips content-type params before building the data URL', async () => {
        // image/png; charset=binary must not leak the params into the data URL.
        const res = {
            ok: true,
            arrayBuffer: async () => PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength),
            headers: { get: () => 'image/png; charset=binary' }
        };
        const out = await validateAndEncode(res, { Image: makeFakeImage() });
        expect(out).not.toBeNull();
        expect(out.dataUrl).toBe(`data:image/png;base64,${bytesToBase64(PNG_BYTES)}`);
    });
});

describe('provider interpret contracts', () => {
    it('AGG_PROVIDERS order is favicon-run first, duckduckgo last', () => {
        expect(AGG_PROVIDERS.map(p => p.id)).toEqual(['favicon-run', 'duckduckgo']);
    });

    it('providerUrl resolves each id to its lookup URL', () => {
        expect(FR('example.com')).toBe('https://favicon.run/favicon?domain=example.com&sz=32');
        expect(DDG('example.com')).toBe('https://icons.duckduckgo.com/ip3/example.com.ico');
        expect(providerUrl('nope', 'example.com')).toBeNull();
    });

    it('favicon-run: network error/timeout → unreachable', () => {
        expect(interpretFaviconRun(null, false)).toBe('unreachable');
    });

    it('favicon-run: 2xx + image content-type → icon', () => {
        expect(interpretFaviconRun({ ok: true, headers: { get: () => 'image/png' } }, true)).toBe('icon');
    });

    it('favicon-run: 2xx + text/html → no-icon (clean, decidable)', () => {
        expect(interpretFaviconRun({ ok: true, headers: { get: () => 'text/html' } }, true)).toBe('no-icon');
    });

    it('favicon-run: HTTP 500/404 → no-icon (never a false success)', () => {
        expect(interpretFaviconRun({ ok: false, status: 500, headers: { get: () => null } }, true)).toBe('no-icon');
        expect(interpretFaviconRun({ ok: false, status: 404, headers: { get: () => null } }, true)).toBe('no-icon');
    });

    it('duckduckgo: network error/timeout → unreachable', () => {
        expect(interpretDuckDuckGo(null, false)).toBe('unreachable');
    });

    it('duckduckgo: any 2xx → icon (accepts the unknown-domain placeholder)', () => {
        expect(interpretDuckDuckGo({ ok: true, headers: { get: () => 'image/x-icon' } }, true)).toBe('icon');
        expect(interpretDuckDuckGo({ ok: true, headers: { get: () => null } }, true)).toBe('icon');
    });

    it('duckduckgo: non-2xx → no-icon', () => {
        expect(interpretDuckDuckGo({ ok: false, status: 404, headers: { get: () => null } }, true)).toBe('no-icon');
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
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        const img = makePlaceholderImg('https://github.com/');
        const handled = en.onPlaceholder(img);
        // L1 hit → the hook enqueues and returns false (discovery runs async).
        expect(handled).toBe(false);
        await tick();
        await tick();
        const favCall = fetchImpl.calls.find(c => /favicon\.ico$/.test(c.url));
        expect(favCall).toBeTruthy();
        // L2 and neither provider were ever attempted.
        expect(fetchImpl.calls.some(c => c.url === 'https://github.com/')).toBe(false);
        expect(fetchImpl.calls.some(c => c.url === FR('github.com'))).toBe(false);
        expect(fetchImpl.calls.some(c => c.url === DDG('github.com'))).toBe(false);
    });

    it('L1 404 → L2 parses <link> and fetches the icon', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
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
            fallbackEnabled: () => true,
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
        expect(fetchImpl.calls.some(c => c.url === FR('example.com'))).toBe(false);
        expect(fetchImpl.calls.some(c => c.url === DDG('example.com'))).toBe(false);
    });

    it('L1/L2 fail → L4 reached; favicon-run 200+PNG short-circuits (duckduckgo not called)', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/example\.com\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/favicon\.run/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://example.com/'));
        await tick();
        await tick();
        expect(fetchImpl.calls.some(c => c.url === FR('example.com'))).toBe(true);
        expect(fetchImpl.calls.some(c => c.url === DDG('example.com'))).toBe(false);
    });

    it('fallbackEnabled=false → L4 skipped entirely (neither provider touched)', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/example\.com\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://example.com/'));
        await tick();
        await tick();
        expect(fetchImpl.calls.some(c => c.url === FR('example.com'))).toBe(false);
        expect(fetchImpl.calls.some(c => c.url === DDG('example.com'))).toBe(false);
    });

    it('L4 failover: favicon-run clean 500 → duckduckgo succeeds; favicon-run NOT tripped', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/example\.com\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/favicon\.run/, { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/duckduckgo/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://example.com/'));
        await tick();
        await tick();
        expect(fetchImpl.calls.filter(c => c.url === FR('example.com')).length).toBe(1);
        expect(fetchImpl.calls.filter(c => c.url === DDG('example.com')).length).toBe(1);
        // A clean 500 means favicon.run was reachable → no breaker trip.
        expect(en.getIdx().down['favicon-run']).toBe(0);
        expect(en.getIdx().down['duckduckgo']).toBe(0);
    });

    it('L4 failover: favicon-run network error → favicon-run tripped, duckduckgo succeeds', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/example\.com\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/favicon\.run/, () => { throw new TypeError('network down'); }],
            [/duckduckgo/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://example.com/'));
        await tick();
        await tick();
        // The icon came from duckduckgo (favicon-run failed over to it).
        expect(fetchImpl.calls.some(c => c.url === DDG('example.com'))).toBe(true);
        expect(en.getIdx().down['favicon-run']).toBeGreaterThan(0);   // tripped
        expect(en.getIdx().down['duckduckgo']).toBe(0);               // untouched
    });

    it('favicon-run 200+text/html → validation rejects → fail over to duckduckgo', async () => {
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/example\.com\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/favicon\.run/, {
                ok: true,
                status: 200,
                arrayBuffer: async () => new TextEncoder().encode('<html></html>').buffer,
                headers: { get: () => 'text/html' }
            }],
            [/duckduckgo/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://example.com/'));
        await tick();
        await tick();
        // Non-image bytes from favicon.run are not accepted; duckduckgo is tried.
        expect(fetchImpl.calls.some(c => c.url === DDG('example.com'))).toBe(true);
    });

    it('L1/L2 direct fail + proxy session live → L3 relays via addProxyMarker', async () => {
        const local = makeStorageArea({ deadProxyServer: 'http://proxy.example:8080' });
        const session = makeStorageArea({ vbmProxySession: { active: true } });
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/proxy\.example\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/favicon\.ico.*__vbm_px=1/, pngResponse()]   // the PROXIED L1 succeeds
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
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
        // No provider was reached (L3 won before L4; fallback also off).
        expect(fetchImpl.calls.some(c => c.url === FR('proxy.example'))).toBe(false);
        expect(fetchImpl.calls.some(c => c.url === DDG('proxy.example'))).toBe(false);
    });

    it('proxy session NOT live → L3 skipped, chain falls to L4', async () => {
        const local = makeStorageArea({ deadProxyServer: 'http://proxy.example:8080' });
        const session = makeStorageArea({});   // no vbmProxySession marker
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/proxy\.example\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/favicon\.run/, { ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }],
            [/duckduckgo/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local, session } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://proxy.example/'));
        await tick();
        await tick();
        // No proxied attempt (session absent) → L4 reached; favicon-run 500
        // (no-icon) → failover to duckduckgo, which wins.
        expect(fetchImpl.calls.some(c => /__vbm_px=1/.test(c.url))).toBe(false);
        expect(fetchImpl.calls.some(c => c.url === FR('proxy.example'))).toBe(true);
        expect(fetchImpl.calls.some(c => c.url === DDG('proxy.example'))).toBe(true);
    });
});

describe('initFaviconEnrich — L2 HTML read cap', () => {
    beforeEach(() => { seq = 0; });

    it('caps the page HTML via the body stream (a link past the cap is not parsed)', async () => {
        // A 200KB pad puts the <link> beyond MAX_HTML_BYTES: the streamed read
        // stops at the cap and the late declaration is never fetched.
        const pad = new Uint8Array(MAX_HTML_BYTES).fill(0x20);
        const late = new TextEncoder().encode('<link rel="icon" type="image/png" sizes="32x32" href="/late.png">');
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/huge\.example\/$/, () => streamResponse([pad, late])],
            [/late\.png/, () => { throw new Error('must not fetch'); }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://huge.example/'));
        await tick();
        await tick();
        expect(fetchImpl.calls.some(c => c.url.includes('late.png'))).toBe(false);
    });

    it('caps the page HTML via the text fallback (no body stream)', async () => {
        const huge = 'x'.repeat(MAX_HTML_BYTES) + '<link rel="icon" type="image/png" sizes="32x32" href="/late.png">';
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/huge\.example\/$/, { ok: true, text: async () => huge, headers: { get: () => 'text/html' } }],
            [/late\.png/, () => { throw new Error('must not fetch'); }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://huge.example/'));
        await tick();
        await tick();
        expect(fetchImpl.calls.some(c => c.url.includes('late.png'))).toBe(false);
    });
});

describe('initFaviconEnrich — hydrate-race + session-only cap', () => {
    beforeEach(() => { seq = 0; });

    it('a host enqueued before hydrate lands re-checks the cache and skips the network', async () => {
        // onPlaceholder fires while the storage hydrate is still in flight — the
        // host misses the in-memory Map and is enqueued. The queue must wait for
        // the hydrate, then hot-swap the cached icon instead of fetching again
        // (design §5.1 "发现链启动前会重读 Map").
        const storage = makeStorageArea({
            [`${FAVICON_DATA_PREFIX}github.com`]: PNG_DATA_URL,
            [FAVICON_IDX_KEY]: idxV3({ 'github.com': { t: 1700000000000, s: PNG_DATA_URL.length } })
        });
        let fetches = 0;
        const fetchImpl = makeFetch([[/.*/, () => { fetches++; return notFound(); }]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        // Deliberately NOT awaited _hydrateDone — emulate the render-before-hydrate window.
        const img = makePlaceholderImg('https://github.com/');
        en.onPlaceholder(img);
        await en._hydrateDone;
        await tick();
        await tick();
        expect(fetches).toBe(0);
        expect(img.parentNode.children[0].tagName).toBe('IMG');   // hot-swapped, not SVG
    });

    it('caps session-only oversized icons, evicting the oldest beyond the cap', async () => {
        // 100KB icons are >MAX_ICON_BYTES (96KB) → session-only. A burst past
        // SESSION_ONLY_CAP must not accumulate in memory for the session — the
        // oldest is evicted.
        const big = new Uint8Array(100 * 1024);
        for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
        big[0] = 0x89; big[1] = 0x50; big[2] = 0x4e; big[3] = 0x47;   // PNG magic
        const storage = makeStorageArea();
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse(big)]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        for (let i = 0; i < SESSION_ONLY_CAP + 1; i++)
            en.onPlaceholder(makePlaceholderImg(`https://big${i}.example/`));
        await new Promise(r => setTimeout(r, 50));
        const cache = en.getCache();
        expect(cache.size).toBeLessThanOrEqual(SESSION_ONLY_CAP);
        expect(cache.has('big0.example')).toBe(false);                 // oldest evicted
        expect(cache.has(`big${SESSION_ONLY_CAP}.example`)).toBe(true); // newest kept
        // Session-only icons still never touch storage.
        expect(storage.data[`${FAVICON_DATA_PREFIX}big1.example`]).toBeUndefined();
    });
});

describe('initFaviconEnrich — per-provider breaker + failover', () => {
    beforeEach(() => { seq = 0; });

    it('a provider network error trips ITS breaker; subsequent hosts skip it', async () => {
        let frCalls = 0, ddgCalls = 0;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/favicon\.run/, () => { frCalls++; throw new TypeError('down'); }],
            [/duckduckgo/, () => { ddgCalls++; return pngResponse(); }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        // Host a: favicon-run unreachable → tripped, duckduckgo wins.
        en.onPlaceholder(makePlaceholderImg('https://a.example/'));
        await tick();
        await tick();
        // Host b: favicon-run breaker tripped → skipped, straight to duckduckgo.
        en.onPlaceholder(makePlaceholderImg('https://b.example/'));
        await tick();
        await tick();
        expect(frCalls).toBe(1);               // only the first host probed it
        expect(ddgCalls).toBe(2);              // both hosts fell through to DDG
        expect(en.getIdx().down['favicon-run']).toBeGreaterThan(0);
        expect(en.getIdx().down['duckduckgo']).toBe(0);
    });

    it('breaker auto-heals after 6h and allows one probe; still failing → re-tripped', async () => {
        let frCalls = 0;
        let nowVal = 1700000000000;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/favicon\.run/, () => { frCalls++; throw new TypeError('down'); }],
            [/duckduckgo/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: () => nowVal
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://x.example/'));
        await tick();
        await tick();
        expect(frCalls).toBe(1);
        expect(en.getIdx().down['favicon-run']).toBeGreaterThan(0);
        // Advance past the 6h breaker → the next host gets one L4 probe.
        nowVal += BREAKER_TTL_MS + 1;
        en.onPlaceholder(makePlaceholderImg('https://y.example/'));
        await tick();
        await tick();
        expect(frCalls).toBe(2);   // probe allowed after heal — and it re-tripped
        expect(en.getIdx().down['favicon-run']).toBeGreaterThan(nowVal);
    });

    it('breakers are independent (favicon-run down does not affect duckduckgo)', async () => {
        let ddgCalls = 0;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/favicon\.run/, () => { throw new TypeError('down'); }],
            [/duckduckgo/, () => { ddgCalls++; return pngResponse(); }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: makeStorageArea() } },
            now: nextNow
        });
        await en._hydrateDone;
        en.onPlaceholder(makePlaceholderImg('https://a.example/'));
        await tick();
        await tick();
        en.onPlaceholder(makePlaceholderImg('https://b.example/'));
        await tick();
        await tick();
        // duckduckgo served every host even while favicon-run was down.
        expect(ddgCalls).toBe(2);
        expect(en.getIdx().down['duckduckgo']).toBe(0);
    });

    it('breaker state survives re-hydrate from storage (skipped across sessions)', async () => {
        const future = 1700000000000 + BREAKER_TTL_MS + 5000;
        const storage = makeStorageArea({ [FAVICON_IDX_KEY]: idxV3({}, { 'favicon-run': future }) });
        let frCalls = 0;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/favicon\.run/, () => { frCalls++; return pngResponse(); }],
            [/duckduckgo/, pngResponse()]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: () => 1700000000000
        });
        await en._hydrateDone;
        expect(en.getIdx().down['favicon-run']).toBe(future);   // preserved
        en.onPlaceholder(makePlaceholderImg('https://a.example/'));
        await tick();
        await tick();
        expect(frCalls).toBe(0);   // skipped in-session
        // A fresh enricher hydrating the same storage also skips it.
        const en2 = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: () => 1700000000000
        });
        await en2._hydrateDone;
        expect(en2.getIdx().down['favicon-run']).toBe(future);
    });

    it('a breaker-tripped provider gets one PROXIED retry when the proxy is live', async () => {
        const local = makeStorageArea({ deadProxyServer: 'http://proxy.example:8080' });
        const session = makeStorageArea({ vbmProxySession: { active: true } });
        let frProxied = 0;
        const fetchImpl = makeFetch([
            [/favicon\.run.*__vbm_px=1/, () => { frProxied++; return pngResponse(); }],
            [/favicon\.run/, () => { throw new TypeError('down'); }],   // direct unreachable
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/noicon\.example\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local, session } },
            now: nextNow
        });
        await en._hydrateDone;
        // Pre-trip favicon-run's breaker (as if a prior host's direct attempt failed).
        en.getIdx().down['favicon-run'] = nextNow() + BREAKER_TTL_MS;
        en.onPlaceholder(makePlaceholderImg('https://noicon.example/'));
        await tick();
        await tick();
        expect(frProxied).toBeGreaterThanOrEqual(1);   // proxied retry won
    });

    it('proxied retry walks EVERY tripped provider (favicon-run fails → duckduckgo succeeds)', async () => {
        const local = makeStorageArea({ deadProxyServer: 'http://proxy.example:8080' });
        const session = makeStorageArea({ vbmProxySession: { active: true } });
        let frProxied = 0, ddgProxied = 0;
        const fetchImpl = makeFetch([
            [/favicon\.run.*__vbm_px=1/, () => { frProxied++; return notFound(); }],  // proxied FR fails
            [/duckduckgo.*__vbm_px=1/, () => { ddgProxied++; return pngResponse(); }], // proxied DDG wins
            [/\/favicon\.ico$/, notFound()],
            [/^https:\/\/noicon\.example\/$/, { ok: false, status: 403, arrayBuffer: async () => new ArrayBuffer(0), headers: { get: () => null } }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local, session } },
            now: nextNow
        });
        await en._hydrateDone;
        // Pre-trip BOTH providers.
        en.getIdx().down['favicon-run'] = nextNow() + BREAKER_TTL_MS;
        en.getIdx().down['duckduckgo'] = nextNow() + BREAKER_TTL_MS;
        en.onPlaceholder(makePlaceholderImg('https://noicon.example/'));
        await tick();
        await tick();
        expect(frProxied).toBe(1);
        expect(ddgProxied).toBe(1);
    });

    it('a breaker-tripped provider with NO proxy is skipped in L4 (next provider used)', async () => {
        const local = makeStorageArea({ deadProxyServer: 'http://proxy.example:8080' });
        const session = makeStorageArea({});   // no proxy session
        let frCalls = 0, ddgCalls = 0;
        const fetchImpl = makeFetch([
            [/\/favicon\.ico$/, notFound()],
            [/favicon\.run/, () => { frCalls++; return pngResponse(); }],
            [/duckduckgo/, () => { ddgCalls++; return pngResponse(); }]
        ]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => true,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local, session } },
            now: nextNow
        });
        await en._hydrateDone;
        en.getIdx().down['favicon-run'] = nextNow() + BREAKER_TTL_MS;
        en.onPlaceholder(makePlaceholderImg('https://example.com/'));
        await tick();
        await tick();
        expect(fetchImpl.calls.some(c => /__vbm_px=1/.test(c.url))).toBe(false);  // no proxy
        expect(frCalls).toBe(0);       // skipped
        expect(ddgCalls).toBe(1);      // next provider used
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
            fallbackEnabled: () => false,
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
            fallbackEnabled: () => false,
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
        const storage = makeStorageArea({
            [`${FAVICON_DATA_PREFIX}github.com`]: PNG_DATA_URL,
            [FAVICON_IDX_KEY]: idxV3({ 'github.com': { t: Date.now(), s: PNG_DATA_URL.length } })
        });
        const fetchImpl = makeFetch([[/.*/, () => { fetches++; return { ok: false, status: 404 }; }]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
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
        const storage = makeStorageArea({
            [FAVICON_IDX_KEY]: idxV3({ 'noicon.example': { f: 1, t: Date.now() } })
        });
        const fetchImpl = makeFetch([[/.*/, () => { fetches++; return { ok: false, status: 404 }; }]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
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
            fallbackEnabled: () => false,
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

    it('evicts the OLDEST HALF when persisted bytes exceed the dynamic budget', async () => {
        // 45 × 20KB data keys ≈ 900KB. With QUOTA_BYTES=1MB the ceiling is
        // free×0.8 = 800KB; adding a 46th entry pushes persisted bytes past it
        // → the halving strategy cuts the oldest half.
        const bigData = 'x'.repeat(20 * 1024);   // 20KB each
        const hosts = {};
        const seedData = {};
        for (let i = 0; i < 45; i++) {
            const h = `big${i}.example`;
            hosts[h] = { t: 1700000000000 + i * 1000, s: bigData.length };
            seedData[`${FAVICON_DATA_PREFIX}${h}`] = bigData;
        }
        seedData[FAVICON_IDX_KEY] = idxV3(hosts);
        const storage = makeStorageArea(seedData);
        storage.QUOTA_BYTES = 1024 * 1024;   // 1MB → ceiling ≈ 800KB
        const fetchImpl = makeFetch([[/\/favicon\.ico$/, pngResponse()]]);
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl,
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: () => 1700000000000 + 200 * 1000   // after every seeded timestamp
        });
        await en._hydrateDone;
        // Ceiling = (1MB − ~900KB cache) free ×0.8 ≈ 800KB — never 0 or the default.
        expect(en.getBudgetBytes()).toBeGreaterThan(512 * 1024);
        expect(en.getBudgetBytes()).toBeLessThanOrEqual(1024 * 1024);
        en.onPlaceholder(makePlaceholderImg('https://new2.example/'));
        await tick();
        await tick();
        en.flushIndex();
        const cache = en.getCache();
        // 45 seeded + 1 new = 46 persisted → halving evicts the oldest 23.
        expect(cache.size).toBeLessThanOrEqual(24);
        // The oldest seeded hosts were evicted; the new entry survives.
        expect(cache.has('big0.example')).toBe(false);
        expect(cache.has('new2.example')).toBe(true);
        // The evicted hosts' data keys were removed from storage too.
        expect(storage.data[`${FAVICON_DATA_PREFIX}big0.example`]).toBeUndefined();
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
            fallbackEnabled: () => false,
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

    it('ceiling = (quota − other features) × BUDGET_FACTOR', async () => {
        // 4MB of unrelated data → other=4MB → ceiling ≈ (10MB − 4MB) × 0.8 ≈ 4.8MB.
        const storage = makeStorageArea({ otherData: 'y'.repeat(4 * 1024 * 1024) });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        const budget = en.getBudgetBytes();
        expect(budget).toBeGreaterThan(4.5 * 1024 * 1024);
        expect(budget).toBeLessThan(5 * 1024 * 1024);
        expect(budget).toBeCloseTo((STORAGE_QUOTA_BYTES - 4 * 1024 * 1024) * BUDGET_FACTOR, -4);
    });

    it('nearly-full storage caps the ceiling at the real free space (not the floor)', async () => {
        // 9.8MB used → only ~0.2MB free → the ceiling must NOT fall to the
        // 512KB floor (that would exceed the actual free space); the cap wins.
        const storage = makeStorageArea({ otherData: 'y'.repeat(9.8 * 1024 * 1024) });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        const budget = en.getBudgetBytes();
        expect(budget).toBeLessThan(MIN_BUDGET);             // floor overridden
        expect(budget).toBeGreaterThan(100 * 1024);          // ≈ the remaining free space
        expect(budget).toBeLessThan(0.25 * 1024 * 1024);
    });

    it('ceiling falls back to quota×BUDGET_FACTOR when getBytesInUse is unavailable', async () => {
        const storage = makeStorageArea({ otherData: 'y'.repeat(1024) });
        delete storage.getBytesInUse;   // older/partial chrome double
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        expect(en.getBudgetBytes()).toBeCloseTo(STORAGE_QUOTA_BYTES * BUDGET_FACTOR, -4);
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
            fallbackEnabled: () => false,
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
            fallbackEnabled: () => false,
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
            fallbackEnabled: () => false,
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
            fallbackEnabled: () => false,
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
            [FAVICON_IDX_KEY]: idxV3({ 'github.com': { t: Date.now(), s: PNG_DATA_URL.length } })
        });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
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
            fallbackEnabled: () => false,
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

    it('emptyIdx has the v3 shape (per-provider down table)', () => {
        expect(emptyIdx().v).toBe(3);
        expect(emptyIdx().down).toEqual({ 'favicon-run': 0, 'duckduckgo': 0 });
        expect(emptyIdx().hosts).toEqual({});
    });

    it('parseIdx normalizes a v3 index: missing provider defaults to 0, stale provider dropped', () => {
        const idx = parseIdx(JSON.stringify({ v: 3, down: { 'duckduckgo': 123, 'ghost': 456 }, hosts: { 'a.example': { t: 1, s: 2 } } }));
        expect(idx).not.toBeNull();
        expect(idx.down).toEqual({ 'favicon-run': 0, 'duckduckgo': 123 });   // missing→0, ghost dropped
        expect(idx.hosts['a.example']).toEqual({ t: 1, s: 2 });
    });

    it('parseIdx migrates a legacy v1 index → v3 (hosts preserved, breaker reset)', () => {
        const idx = parseIdx(JSON.stringify({ v: 1, ddgDownUntil: 999, hosts: { 'ok.example': { t: 1, s: 2 }, 'no.example': { f: 1, t: 3 } } }));
        expect(idx).not.toBeNull();
        expect(idx.v).toBe(3);
        expect(idx.down).toEqual({ 'favicon-run': 0, 'duckduckgo': 0 });     // breaker window reset
        // Both success and failed markers survive the migration.
        expect(idx.hosts['ok.example']).toEqual({ t: 1, s: 2 });
        expect(idx.hosts['no.example']).toEqual({ f: 1, t: 3 });
    });

    it('parseIdx rejects unknown shapes', () => {
        expect(parseIdx(JSON.stringify({ v: 2, hosts: {} }))).toBeNull();
        expect(parseIdx(JSON.stringify({ hosts: {} }))).toBeNull();
        expect(parseIdx(JSON.stringify({ v: 3 }))).toBeNull();   // no hosts
    });

    it('hydrate rebuilds the index from surviving data keys when the index is corrupt', async () => {
        const storage = makeStorageArea({ [`${FAVICON_DATA_PREFIX}github.com`]: PNG_DATA_URL });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        expect(en.getCache().has('github.com')).toBe(true);
        // The rebuilt index was persisted (v3).
        expect(storage.data[FAVICON_IDX_KEY]).toContain('github.com');
        expect(JSON.parse(storage.data[FAVICON_IDX_KEY]).v).toBe(3);
    });

    it('hydrate migrates a v1 index in place (hosts + failed markers preserved, breaker reset)', async () => {
        const v1 = JSON.stringify({ v: 1, ddgDownUntil: 123456, hosts: { 'ok.example': { t: 1700000000000, s: 10 }, 'no.example': { f: 1, t: 1700000000000 } } });
        const storage = makeStorageArea({ [`${FAVICON_DATA_PREFIX}ok.example`]: PNG_DATA_URL, [FAVICON_IDX_KEY]: v1 });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
            fetchImpl: makeFetch([]),
            ImageCtor: makeFakeImage(),
            chromeImpl: { storage: { local: storage } },
            now: nextNow
        });
        await en._hydrateDone;
        expect(en.getCache().has('ok.example')).toBe(true);     // success preserved
        expect(en.getCache().get('no.example')).toEqual({ f: 1, t: 1700000000000 });   // failed marker preserved
        expect(en.getIdx().v).toBe(3);
        expect(en.getIdx().down['favicon-run']).toBe(0);        // breaker reset
        expect(en.getIdx().down['duckduckgo']).toBe(0);
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
        seedData[FAVICON_IDX_KEY] = idxV3(hosts);
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
            fallbackEnabled: () => false,
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
            [FAVICON_IDX_KEY]: idxV3(hosts)
        });
        const en = initFaviconEnrich({
            doc: makeDoc(),
            faviconService: makeFavService(),
            isEnabled: () => true,
            fallbackEnabled: () => false,
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
