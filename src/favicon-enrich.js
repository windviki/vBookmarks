/**
 * Missing-favicon enrichment (4.0.5, docs/favicon-补全设计.md).
 *
 * Chrome's `_favicon` API only serves icons Chrome itself has cached — for
 * bookmarks imported / never visited, it answers with a placeholder that
 * favicon-fallback.js swaps for the default SVG. This module fetches the
 * REAL icon from the user's own bookmarked site (the same origin the user
 * already bookmarked), validates it, caches it per host, and hot-swaps the
 * default SVG back to a real `<img>`. A DuckDuckGo domain lookup is an
 * opt-in, breaker-guarded LAST resort; a dead-scan proxy session (when one
 * is live) relays the direct attempts for region-limited sites.
 *
 * Design contract (docs/favicon-补全设计.md):
 *   - Discovery chain L1-L4: /favicon.ico → page <link> → proxy relay →
 *     DDG fallback. Any layer producing a valid icon short-circuits.
 *   - Icon validation: res.ok + byteLength ≤ 200KB + type sniff by magic
 *     number + Image decode (naturalWidth > 0). Bad data never cached.
 *   - Cache: per-host key `vbmFavicon:<host>` = data URL + one index key
 *     `vbmFaviconIdx` = { v, ddgDownUntil, hosts: { host: {t,s}|{f,t} } }.
 *     Double-axis LRU budget (500 entries / 2MB) with batch eviction;
 *     >96KB icons session-only; quota-error emergency eviction.
 *   - Queue: ≤6 concurrent, per-host dedup, AbortController cancel on
 *     setEnabled(false). Renders block only on the in-memory Map read.
 *
 * The module is a pure ESM unit — `fetch`/`Image`/`chrome.storage` are all
 * injectable, so it is vitest-coverable in node (no DOM dependency).
 */

import { addProxyMarker } from './dead-proxy.js';

// --- Key layout --------------------------------------------------------------
export const FAVICON_DATA_PREFIX = 'vbmFavicon:';
export const FAVICON_IDX_KEY = 'vbmFaviconIdx';

// --- Budgets / TTL -----------------------------------------------------------
export const SUCCESS_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30d
export const FAILED_TTL_MS = 24 * 60 * 60 * 1000;         // 24h
export const BREAKER_TTL_MS = 6 * 60 * 60 * 1000;         // 6h
export const MAX_ENTRIES = 500;
export const EVICT_TO_ENTRIES = 400;
export const MAX_BYTES = 2 * 1024 * 1024;                 // 2MB
export const EVICT_TO_BYTES = 1.6 * 1024 * 1024;          // 1.6MB
export const MAX_ICON_BYTES = 96 * 1024;                  // >96KB → session only
export const MAX_FETCH_BYTES = 200 * 1024;                // fetch cap
export const CONCURRENCY = 6;
export const DDG_URL = host => `https://icons.duckduckgo.com/ip3/${host}.ico`;

const HTTP_URL = /^https?:\/\//i;
const LINK_RE = /<link\b[^>]*>/gi;
const ATTR_RE = /(rel|href|sizes|type)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;

// --- Data URL encoding (pure JS, no DOM) -------------------------------------
export const bytesToBase64 = bytes => {
    // Chunked String.fromCharCode avoids the call-stack limit on large
    // arrays; btoa is a page global in the popup and a node global in 18+.
    const CHUNK = 0x8000;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK)
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    return btoa(bin);
};

const mimeFromMagic = bytes => {
    if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0)
        return 'image/x-icon';
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
        return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
        return 'image/gif';
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8)
        return 'image/jpeg';
    // SVG: leading '<' (after optional BOM/whitespace)
    for (let i = 0; i < Math.min(8, bytes.length); i++) {
        const c = bytes[i];
        if (c === 0xef || c === 0xbb || c === 0xbf || c === 0x09 || c === 0x0a || c === 0x0d || c === 0x20)
            continue;
        return c === 0x3c /* '<' */ ? 'image/svg+xml' : null;
    }
    return null;
};

export const isImageContentType = ct => /^image\//i.test(ct || '');

/**
 * Validate a fetched icon: res.ok + size cap + magic sniff + Image decode.
 * Returns { dataUrl } on success or null. `Image` is injected for tests.
 */
export const validateAndEncode = async (res, { Image: ImageCtor = Image, maxBytes = MAX_FETCH_BYTES } = {}) => {
    if (!res || !res.ok)
        return null;
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length === 0 || bytes.length > maxBytes)
        return null;
    const ct = res.headers ? res.headers.get('content-type') : null;
    let mime;
    if (ct) {
        // An explicit non-image Content-Type is authoritative — a server that
        // says text/html must not be accepted because the bytes happen to
        // start with '<' (a false SVG sniff). image/* or absent → magic sniff.
        if (!isImageContentType(ct))
            return null;
        mime = ct;
    } else {
        mime = mimeFromMagic(bytes);
    }
    if (!mime)
        return null;
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    // Final line of defense: the bytes must actually decode as an image.
    if (ImageCtor) {
        const ok = await new Promise(resolve => {
            const img = new ImageCtor();
            img.onload = () => resolve(img.naturalWidth > 0);
            img.onerror = () => resolve(false);
            img.src = dataUrl;
        });
        if (!ok)
            return null;
    }
    return { dataUrl, bytes: bytes.length };
};

// --- <link> extraction (attribute-level regex, no DOMParser) -----------------
export const extractLinkIcons = (html, pageUrl) => {
    const found = [];
    const seen = new Set();
    for (const m of String(html || '').matchAll(LINK_RE)) {
        const tag = m[0];
        const attrs = {};
        for (const a of tag.matchAll(ATTR_RE)) {
            const k = a[1].toLowerCase();
            const v = a[2] ?? a[3] ?? a[4];
            if (v !== undefined && v !== '')
                attrs[k] = v;
        }
        const rel = String(attrs.rel || '').toLowerCase().split(/\s+/);
        const isIcon = rel.some(r =>
            r === 'icon' || r === 'shortcut icon' || r === 'apple-touch-icon' ||
            r === 'apple-touch-icon-precomposed' || r === 'mask-icon');
        if (!isIcon || !attrs.href)
            continue;
        const href = attrs.href;
        // data: href is already the icon bytes — skip the URL score, callers
        // pass it straight to the encoder.
        if (/^data:/i.test(href)) {
            if (!seen.has(href)) {
                seen.add(href);
                found.push({ href, data: true, size: 0, type: 'data' });
            }
            continue;
        }
        let abs;
        try { abs = new URL(href, pageUrl).href; } catch (_) { continue; }
        if (!HTTP_URL.test(abs) || seen.has(abs))
            continue;
        seen.add(abs);
        // Score: 16/32 sizes preferred, SVG preferred over unknown bitmaps.
        let score = 1;
        const sizes = String(attrs.sizes || '').split(/\s+/).filter(Boolean);
        if (sizes.some(s => s === '16x16' || s === '32x32'))
            score = 3;
        if (String(attrs.type || '').toLowerCase() === 'image/svg+xml')
            score = 2;
        found.push({ href: abs, data: false, size: score, type: attrs.type });
    }
    // Highest score first; ties keep document order (stable sort).
    return found.sort((a, b) => b.size - a.size);
};

// --- Index shape helpers -----------------------------------------------------
export const emptyIdx = () => ({ v: 1, ddgDownUntil: 0, hosts: {} });

export const parseIdx = raw => {
    try {
        const idx = JSON.parse(raw);
        if (!idx || idx.v !== 1 || !idx.hosts || typeof idx.hosts !== 'object')
            return null;
        return idx;
    } catch (_) {
        return null;
    }
};

/**
 * Create the enricher. ctx:
 *   doc              — document (createElement for the hot-swap img)
 *   faviconService   — favicon-fallback API (sampleIcon / statsBySrc / applyContrast)
 *   isEnabled()      — live getter for the master switch (decide-time read)
 *   ddgEnabled()     — live getter for the DuckDuckGo sub-switch
 *   fetchImpl        — fetch to use (injectable for tests; defaults to global)
 *   ImageCtor        — Image constructor (injectable; defaults to global)
 *   chromeImpl       — chrome (injectable; defaults to global chrome)
 *   now()            — clock (injectable; defaults to Date.now)
 */
export function initFaviconEnrich(ctx = {}) {
    const doc = ctx.doc;
    const faviconService = ctx.faviconService;
    const isEnabled = ctx.isEnabled || (() => false);
    const ddgEnabled = ctx.ddgEnabled || (() => false);
    const fetchImpl = ctx.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    const ImageCtor = ctx.ImageCtor || (typeof Image === 'function' ? Image : null);
    const chromeImpl = ctx.chromeImpl || (typeof chrome !== 'undefined' ? chrome : null);
    const now = ctx.now || (() => Date.now());

    // --- Session in-memory cache (hydrated from storage) ---------------------
    // host → { d: dataUrl, t: ts } success | { f: 1, t: ts } failed
    const cache = new Map();
    let idxData = emptyIdx();
    let hydrated = false;
    let hydrateDone = null;

    const isExpired = (host, ttlMs) => {
        const e = cache.get(host);
        if (!e)
            return false;
        return now() - e.t >= ttlMs;
    };

    const totalBytes = () => {
        let sum = 0;
        for (const e of cache.values())
            if (e.d)
                sum += e.d.length;
        return sum;
    };

    const persistIdxDebounced = (() => {
        let timer = null;
        return () => {
            if (timer)
                return;
            timer = setTimeout(() => {
                timer = null;
                persistIdxNow();
            }, 1000);
        };
    })();

    const persistIdxNow = () => {
        if (!chromeImpl || !chromeImpl.storage || !chromeImpl.storage.local)
            return;
        // Prune expired failed markers while writing (index converges).
        const hosts = {};
        for (const [host, e] of cache) {
            if (e.f && now() - e.t >= FAILED_TTL_MS)
                continue;
            hosts[host] = e.f ? { f: 1, t: e.t } : { t: e.t, s: e.d ? e.d.length : 0 };
        }
        idxData.hosts = hosts;
        try {
            chromeImpl.storage.local.set({ [FAVICON_IDX_KEY]: JSON.stringify(idxData) });
        } catch (_) { /* session-only degrade */ }
    };

    const writeEntry = (host, dataUrl) => {
        const bytes = dataUrl.length;
        if (bytes > MAX_ICON_BYTES) {
            // Oversized: session-only, not persisted.
            cache.set(host, { d: dataUrl, t: now(), persist: false });
            return;
        }
        cache.set(host, { d: dataUrl, t: now() });
        evictIfOverBudget();
        const setObj = { [`${FAVICON_DATA_PREFIX}${host}`]: dataUrl };
        idxData.hosts[host] = { t: now(), s: bytes };
        const p = chromeImpl.storage.local.set({ ...setObj, [FAVICON_IDX_KEY]: JSON.stringify(idxData) });
        if (p && typeof p.catch === 'function') {
            // chrome.storage rejects async on quota error (try/catch can't see
            // it) — trigger the emergency eviction via .catch.
            p.catch(() => emergencyEvict(host, dataUrl));
        } else {
            try { p; } catch (_) { emergencyEvict(host, dataUrl); }
        }
        persistIdxDebounced();
    };

    const writeFailed = host => {
        cache.set(host, { f: 1, t: now() });
        persistIdxDebounced();
    };

    // --- LRU / budget eviction ----------------------------------------------
    const evictIfOverBudget = () => {
        let entries = [...cache.entries()].filter(([, e]) => e.d && e.persist !== false);
        let bytes = totalBytes();
        const byOldest = () => entries.sort((a, b) => a[1].t - b[1].t);
        while ((entries.length > MAX_ENTRIES || bytes > MAX_BYTES) && entries.length > 0) {
            const evicted = entries.length > MAX_ENTRIES || bytes > MAX_BYTES;
            if (!evicted)
                break;
            byOldest();
            const [host, e] = entries.shift();
            cache.delete(host);
            bytes -= e.d.length;
            delete idxData.hosts[host];
            if (chromeImpl && chromeImpl.storage && chromeImpl.storage.local)
                chromeImpl.storage.local.remove(`${FAVICON_DATA_PREFIX}${host}`);
        }
    };

    const emergencyEvict = (host, dataUrl) => {
        // Quota error on write: cut the oldest half, retry once; if the retry
        // also fails (other data squeezed the budget), degrade to session-only.
        const entries = [...cache.entries()].filter(([, e]) => e.d && e.persist !== false)
            .sort((a, b) => a[1].t - b[1].t);
        const half = Math.ceil(entries.length / 2);
        for (let i = 0; i < half && i < entries.length; i++) {
            const [h] = entries[i];
            cache.delete(h);
            delete idxData.hosts[h];
            try {
                if (chromeImpl && chromeImpl.storage && chromeImpl.storage.local)
                    chromeImpl.storage.local.remove(`${FAVICON_DATA_PREFIX}${h}`);
            } catch (_) { /* best effort */ }
        }
        idxData.hosts[host] = { t: now(), s: dataUrl.length };
        const retry = { [`${FAVICON_DATA_PREFIX}${host}`]: dataUrl, [FAVICON_IDX_KEY]: JSON.stringify(idxData) };
        const rp = chromeImpl.storage.local.set(retry);
        if (rp && typeof rp.catch === 'function') {
            // Still over budget → degrade this entry to session-only.
            rp.catch(() => {
                cache.set(host, { d: dataUrl, t: now(), persist: false });
                delete idxData.hosts[host];   // keep the index honest
            });
        } else {
            cache.set(host, { d: dataUrl, t: now() });
        }
    };

    // --- Hydrate + self-heal ---------------------------------------------------
    const hydrate = async () => {
        if (!chromeImpl || !chromeImpl.storage || !chromeImpl.storage.local)
            return;
        let all = {};
        try {
            all = await chromeImpl.storage.local.get(null);
        } catch (_) {
            return;
        }
        const rawIdx = all[FAVICON_IDX_KEY];
        let idx = rawIdx ? parseIdx(rawIdx) : null;
        const dataKeys = Object.keys(all).filter(k => k.startsWith(FAVICON_DATA_PREFIX));
        const nowMs = now();
        if (!idx) {
            // Broken/absent index → rebuild from surviving data keys.
            idx = emptyIdx();
            for (const k of dataKeys) {
                const host = k.slice(FAVICON_DATA_PREFIX.length);
                const v = all[k];
                if (typeof v === 'string' && host)
                    idx.hosts[host] = { t: nowMs, s: v.length };
            }
            idxData = idx;
            if (dataKeys.length)
                try { chromeImpl.storage.local.set({ [FAVICON_IDX_KEY]: JSON.stringify(idx) }); } catch (_) { /* best effort */ }
        } else {
            idxData = idx;
        }
        // Build the map + reconcile index ↔ data keys.
        for (const [host, meta] of Object.entries(idx.hosts || {})) {
            if (meta.f) {
                // Failed marker: no data key expected.
                if (nowMs - meta.t < FAILED_TTL_MS)
                    cache.set(host, { f: 1, t: meta.t });
                continue;
            }
            const dataUrl = all[`${FAVICON_DATA_PREFIX}${host}`];
            if (dataUrl) {
                cache.set(host, { d: dataUrl, t: meta.t || nowMs });
            } else {
                // Index says success but data key is gone → drop the entry.
                delete idx.hosts[host];
            }
        }
        // Data keys missing from the index → re-add.
        for (const k of dataKeys) {
            const host = k.slice(FAVICON_DATA_PREFIX.length);
            if (host && !idx.hosts[host]) {
                idx.hosts[host] = { t: nowMs, s: all[k].length };
                cache.set(host, { d: all[k], t: nowMs });
            }
        }
        hydrated = true;
        persistIdxDebounced();
    };

    // --- fetchWithTimeout ------------------------------------------------------
    const fetchWithTimeout = (url, ms, signal) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms);
        const onOuter = () => ctrl.abort();
        if (signal && signal.aborted)
            ctrl.abort();
        else if (signal && signal.addEventListener)
            signal.addEventListener('abort', onOuter, { once: true });
        const p = fetchImpl(url, { signal: ctrl.signal, redirect: 'follow' });
        return p.finally(() => {
            clearTimeout(timer);
            if (signal && signal.removeEventListener)
                signal.removeEventListener('abort', onOuter);
        });
    };

    // --- Discovery chain --------------------------------------------------------
    const hostOf = pageUrl => {
        try { return new URL(pageUrl).host; } catch (_) { return null; }
    };

    // L1: classic /favicon.ico
    const tryL1 = async (host, signal) => {
        const url = `https://${host}/favicon.ico`;
        try {
            const res = await fetchWithTimeout(url, 3000, signal);
            return await validateAndEncode(res, { Image: ImageCtor });
        } catch (_) { return null; }
    };

    // L2: page HTML → <link> extraction → fetch icon
    const tryL2 = async (pageUrl, signal) => {
        try {
            const res = await fetchWithTimeout(pageUrl, 5000, signal);
            if (!res.ok)
                return null;
            const html = await res.text();
            const links = extractLinkIcons(html, pageUrl);
            for (const link of links) {
                let candidate;
                if (link.data) {
                    // data: href → validate the inline bytes directly.
                    candidate = { ok: true, arrayBuffer: async () => {
                        // Decode the base64 body back to bytes for validation.
                        const m = /^data:([^;,]+)?;base64,(.*)$/i.exec(link.href);
                        if (!m)
                            throw new Error('bad data url');
                        const bin = atob(m[2]);
                        const arr = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++)
                            arr[i] = bin.charCodeAt(i);
                        return arr.buffer;
                    }, headers: { get: () => { const m = /^data:([^;,]+)/i.exec(link.href); return m ? m[1] : null; } } };
                } else {
                    const r = await fetchWithTimeout(link.href, 3000, signal);
                    candidate = r;
                }
                const valid = await validateAndEncode(candidate, { Image: ImageCtor });
                if (valid)
                    return valid;
            }
        } catch (_) { /* fall through */ }
        return null;
    };

    // L3: proxy relay — the dead-scan's marker-PAC session (when one is live)
    // routes marker-tagged URLs through the user's own proxy. Direct-only
    // attempts fail on region/ISP-limited sites; the proxy may reach them.
    // Read session/local STRAIGHT (not through the store mirror — the mirror
    // only reflects page-load time; the PAC window is a runtime state).
    const proxyRelayAvailable = async () => {
        if (!chromeImpl || !chromeImpl.storage || !chromeImpl.storage.session)
            return false;
        try {
            const ses = await chromeImpl.storage.session.get('vbmProxySession');
            if (!ses || !ses.vbmProxySession)
                return false;
            const loc = await chromeImpl.storage.local.get('deadProxyServer');
            return !!(loc && loc.deadProxyServer);
        } catch (_) { return false; }
    };

    // Retry L1 / L2 (and a breaker-tripped L4) through the proxy. The direct
    // attempts already failed, so a proxied success is equivalent to a direct
    // one — same validation, same cache write. Returns a valid icon or null.
    const tryL3 = async (host, pageUrl, signal) => {
        if (!await proxyRelayAvailable())
            return null;
        // L1 via proxy.
        const proxiedL1 = await tryL1Proxy(host, signal);
        if (proxiedL1)
            return proxiedL1;
        // L2 via proxy.
        const proxiedL2 = await tryL2Proxy(pageUrl, signal);
        if (proxiedL2)
            return proxiedL2;
        // A breaker-tripped DDG gets ONE proxied retry (covers "DDG direct is
        // region-blocked but the proxy reaches it"). Only when DDG is opted in
        // AND the breaker is currently tripped — L4 direct normal = no point
        // double-fetching through the proxy.
        if (ddgEnabled() && now() < idxData.ddgDownUntil) {
            const proxiedL4 = await tryL4Proxy(host, signal);
            if (proxiedL4)
                return proxiedL4;
        }
        return null;
    };

    const fetchMarked = (url, ms, signal) => fetchWithTimeout(addProxyMarker(url), ms, signal);

    const tryL1Proxy = async (host, signal) => {
        try {
            const res = await fetchMarked(`https://${host}/favicon.ico`, 3000, signal);
            return await validateAndEncode(res, { Image: ImageCtor });
        } catch (_) { return null; }
    };

    const tryL2Proxy = async (pageUrl, signal) => {
        try {
            const res = await fetchMarked(pageUrl, 5000, signal);
            if (!res.ok)
                return null;
            const html = await res.text();
            const links = extractLinkIcons(html, pageUrl);
            for (const link of links) {
                let candidate;
                if (link.data) {
                    const m = /^data:([^;,]+)?;base64,(.*)$/i.exec(link.href);
                    if (!m)
                        continue;
                    const bin = atob(m[2]);
                    const arr = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++)
                        arr[i] = bin.charCodeAt(i);
                    candidate = { ok: true, arrayBuffer: async () => arr.buffer, headers: { get: () => { const mm = /^data:([^;,]+)/i.exec(link.href); return mm ? mm[1] : null; } } };
                } else {
                    candidate = await fetchMarked(link.href, 3000, signal);
                }
                const valid = await validateAndEncode(candidate, { Image: ImageCtor });
                if (valid)
                    return valid;
            }
        } catch (_) { /* fall through */ }
        return null;
    };

    // One proxied DDG retry for a breaker-tripped state (does NOT clear the
    // breaker — that describes direct reachability and heals on its own).
    const tryL4Proxy = async (host, signal) => {
        try {
            const res = await fetchMarked(DDG_URL(host), 3000, signal);
            return await validateAndEncode(res, { Image: ImageCtor });
        } catch (_) { return null; }
    };

    // L4: DuckDuckGo (final means, breaker-guarded)
    const tryL4 = async (host, signal) => {
        if (!ddgEnabled())
            return { skipped: true };
        if (now() < idxData.ddgDownUntil)
            return { skipped: true };  // breaker tripped
        const url = DDG_URL(host);
        try {
            const res = await fetchWithTimeout(url, 3000, signal);
            const valid = await validateAndEncode(res, { Image: ImageCtor });
            if (valid)
                return valid;
            // HTTP response arrived (any status) = service reachable → not a
            // network outage; the host just has no DDG icon.
            return null;
        } catch (e) {
            // Network error / timeout = service unreachable → trip the breaker.
            idxData.ddgDownUntil = now() + BREAKER_TTL_MS;
            persistIdxDebounced();
            return null;
        }
    };

    // --- Queue + concurrency -----------------------------------------------------
    const queue = new Map();   // host → { host, pageUrl, anchors:Set }
    let inflight = 0;
    const pending = [];

    const pump = () => {
        while (inflight < CONCURRENCY && pending.length) {
            const item = pending.shift();
            if (item.aborted)
                continue;
            inflight++;
            runItem(item).finally(() => {
                inflight--;
                pump();
            });
        }
    };

    const runItem = async item => {
        const signal = item.ctrl.signal;
        try {
            const result = await discover(item.host, item.pageUrl, signal);
            if (result && result.dataUrl) {
                writeEntry(item.host, result.dataUrl);
                hotSwap(item.host, result.dataUrl);
            } else {
                writeFailed(item.host);
                clearEnriching(item.anchors);
            }
        } catch (_) {
            writeFailed(item.host);
            clearEnriching(item.anchors);
        } finally {
            queue.delete(item.host);
        }
    };

    // The chain: L1 direct → L2 direct → L3 proxy relay → L4 DDG (final).
    const discover = async (host, pageUrl, signal) => {
        const l1 = await tryL1(host, signal);
        if (l1)
            return l1;
        const l2 = await tryL2(pageUrl, signal);
        if (l2)
            return l2;
        const l3 = await tryL3(host, pageUrl, signal);
        if (l3)
            return l3;
        const l4 = await tryL4(host, signal);
        return l4 && l4.dataUrl ? l4 : null;
    };

    // --- Hot swap + contrast registration ---------------------------------------
    const hotSwap = (host, dataUrl) => {
        const item = queue.get(host);
        if (!item)
            return;
        for (const anchor of item.anchors) {
            if (!anchor.isConnected)
                continue;   // row re-rendered — cache already written
            const svg = anchor.querySelector('svg.vbm-icon-doc');
            if (!svg)
                continue;
            const el = doc.createElement('img');
            el.src = dataUrl;
            el.width = 16;
            el.height = 16;
            el.alt = '';
            el.className = 'favicon-enriched';
            el.addEventListener('load', () => {
                if (faviconService && faviconService.sampleIcon) {
                    const fp = faviconService.sampleIcon(el);
                    if (fp && faviconService.statsBySrc)
                        faviconService.statsBySrc.set(dataUrl, fp);
                }
                if (faviconService && faviconService.applyContrast)
                    faviconService.applyContrast(el);
            }, { once: true });
            anchor.replaceChild(el, svg);
        }
    };

    const clearEnriching = anchors => {
        for (const anchor of anchors)
            if (anchor.isConnected) {
                const svg = anchor.querySelector('svg.vbm-icon-doc');
                if (svg && svg.classList)
                    svg.classList.remove('favicon-enriching');
            }
    };

    // --- The onPlaceholder hook (called by favicon-fallback) --------------------
    const onPlaceholder = img => {
        if (!isEnabled() || !enabled)
            return false;
        if (!img || !img.src)
            return false;
        let pageUrl = null;
        try {
            pageUrl = new URL(img.src).searchParams.get('pageUrl');
        } catch (_) { return false; }
        if (!pageUrl || !HTTP_URL.test(pageUrl))
            return false;
        const host = hostOf(pageUrl);
        if (!host)
            return false;
        const entry = cache.get(host);
        if (entry && entry.d) {
            // Cached success (respect TTL). Hot-swap immediately.
            if (isExpired(host, SUCCESS_TTL_MS)) {
                cache.delete(host);
            } else {
                injectImg(img, entry.d);
                return true;
            }
        }
        if (entry && entry.f) {
            if (isExpired(host, FAILED_TTL_MS))
                cache.delete(host);   // retry allowed
            else
                return false;         // within the 24h quiet window
        }
        enqueue(host, pageUrl, img);
        return false;
    };

    // Swap the placeholder <img> for the cached enriched <img> (or queue a
    // re-render's anchor for the in-flight host).
    const injectImg = (img, dataUrl) => {
        if (!img || !img.parentNode)
            return;
        const el = doc.createElement('img');
        el.src = dataUrl;
        el.width = 16;
        el.height = 16;
        el.alt = '';
        el.className = 'favicon-enriched';
        el.addEventListener('load', () => {
            if (faviconService && faviconService.sampleIcon) {
                const fp = faviconService.sampleIcon(el);
                if (fp && faviconService.statsBySrc)
                    faviconService.statsBySrc.set(dataUrl, fp);
            }
            if (faviconService && faviconService.applyContrast)
                faviconService.applyContrast(el);
        }, { once: true });
        img.parentNode.replaceChild(el, img);
    };

    const enqueue = (host, pageUrl, img) => {
        const anchor = img.parentNode;
        let item = queue.get(host);
        if (item) {
            // Same host already queued: merge this row's anchor.
            if (anchor)
                item.anchors.add(anchor);
            return;
        }
        item = {
            host,
            pageUrl,
            anchors: new Set(anchor ? [anchor] : []),
            ctrl: new AbortController(),
            aborted: false
        };
        queue.set(host, item);
        pending.push(item);
        pump();
        // Light "enriching" micro-visual on the default SVG (queued, not yet
        // swapped — fallback will swap it to default SVG after onPlaceholder
        // returns false; mark it then via microtask).
        queueMicrotask(() => {
            for (const a of item.anchors)
                if (a.isConnected) {
                    const svg = a.querySelector('svg.vbm-icon-doc');
                    if (svg && svg.classList)
                        svg.classList.add('favicon-enriching');
                }
        });
    };

    // --- setEnabled (abort in-flight on disable) ----------------------------------
    let enabled = true;
    const setEnabled = on => {
        enabled = !!on;
        if (!enabled) {
            for (const item of queue.values()) {
                item.aborted = true;
                try { item.ctrl.abort(); } catch (_) { /* noop */ }
            }
            queue.clear();
            pending.length = 0;
        }
    };

    // --- storage.onChanged (options page cleared the cache) -----------------------
    if (chromeImpl && chromeImpl.storage && chromeImpl.storage.onChanged) {
        chromeImpl.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes)
                return;
            if (changes[FAVICON_IDX_KEY] && changes[FAVICON_IDX_KEY].newValue === undefined) {
                // Index removed (cache clear): drop the in-memory map + breaker.
                cache.clear();
                idxData = emptyIdx();
                hydrated = true;
            }
        });
    }

    // Kick off hydrate (parallel to store.ready — not on the render path).
    hydrateDone = hydrate();

    return {
        onPlaceholder,
        setEnabled,
        // Flush any pending debounced index write immediately (tests, and the
        // popup's pagehide path if it ever wants a synchronous checkpoint).
        flushIndex: persistIdxNow,
        // Test/audit surface.
        getCache: () => cache,
        getIdx: () => idxData,
        _hydrateDone: hydrateDone,
        _hydrated: () => hydrated
    };
}
