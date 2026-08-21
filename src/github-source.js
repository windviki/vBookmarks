/**
 * GitHub resource fetch chain (4.0.8 announce, built for reuse).
 *
 * This is the shared pattern for any future extension resource that lives on
 * GitHub: try the canonical GitHub URL directly, then the user's configured
 * dead-scan proxy (marker-PAC, so only this request is routed), then the
 * github.akams.cn mirror candidates (see src/github-mirrors.js).
 *
 * The chain mirrors favicon-enrich's discipline: every layer is bounded by
 * an AbortController timeout, every failure is silent, and the mirror layer
 * is a finite top-5 list with per-host 6h breakers — no unbounded retries.
 * Only the last layer differs from favicon-enrich: the "third-party list"
 * here means GitHub mirror services, not favicon aggregators.
 *
 * The module is pure ESM with injectable fetch/chrome/clock, so it is
 * vitest-coverable in node. It imports dead-proxy.js's pure marker helper
 * and the chrome.proxy wrappers (which are inert when `chrome` is absent).
 */
import { addProxyMarker, startProxySession, endProxySession, proxyControllable } from './dead-proxy.js';
import {
    ensureGithubMirrorHosts,
    buildMirrorUrl,
    markMirrorDown
} from './github-mirrors.js';

export const GITHUB_SOURCE_TIMEOUT = 4000;   // matches announce's 4s budget

const defaultFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;

const fetchWithTimeout = async (fetchImpl, url, ms, headers = {}) => {
    if (!fetchImpl)
        return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
        return await fetchImpl(url, {
            headers,
            signal: ctrl.signal,
            redirect: 'follow',
            credentials: 'omit',
            cache: 'no-store'
        });
    } catch (_) {
        return null;
    } finally {
        clearTimeout(timer);
    }
};

// One bounded fetch + validation pass. Returns null on any network/HTTP/
// validation failure; `{ notModified: true }` on 304; `{ data, etag }` on a
// validated 2xx.
const fetchOnce = async ({ fetchImpl, url, etag, timeoutMs, validate }) => {
    const res = await fetchWithTimeout(fetchImpl, url, timeoutMs, etag ? { 'If-None-Match': etag } : {});
    if (!res)
        return null;
    if (res.status === 304)
        return { notModified: true };
    if (!res.ok)
        return null;
    let data = null;
    try {
        data = validate ? await validate(res) : res;
    } catch (_) {
        data = null;
    }
    if (!data)
        return null;
    const resHeaders = res.headers;
    const respEtag = resHeaders && typeof resHeaders.get === 'function' ? resHeaders.get('etag') || '' : '';
    return { data, etag: respEtag };
};

const sessionMarkerLive = async chromeImpl => {
    if (!chromeImpl || !chromeImpl.storage || !chromeImpl.storage.session)
        return false;
    try {
        const ses = await chromeImpl.storage.session.get('vbmProxySession');
        return !!(ses && ses.vbmProxySession);
    } catch (_) {
        return false;
    }
};

const readProxyServer = async chromeImpl => {
    if (!chromeImpl || !chromeImpl.storage || !chromeImpl.storage.local)
        return null;
    try {
        const loc = await chromeImpl.storage.local.get('deadProxyServer');
        return (loc && loc.deadProxyServer) || null;
    } catch (_) {
        return null;
    }
};

// Layer 2: the user's own proxy via the marker-PAC mechanism. When a dead
// scan already installed a PAC session we ride it; otherwise we install a
// temporary one and tear it down afterwards, so no other tab's traffic is
// touched and a crashed chain cannot leave proxy residue. Note the residue
// bound: this fetch runs page-side, so closing the popup/panel mid-fetch
// destroys the context before the finally below runs and the temp PAC stays
// installed — benign (the marker PAC routes nothing else) and swept by the
// service worker's cold-start proxy sweep (this chain never sets the
// vbmProxySession marker, so the sweep treats it as residue).
const fetchViaProxy = async ({ url, timeoutMs, fetchImpl, chromeImpl, validate }) => {
    const server = await readProxyServer(chromeImpl);
    if (!server)
        return null;
    let installed = false;
    const live = await sessionMarkerLive(chromeImpl);
    if (!live) {
        const controllable = await proxyControllable();   // global chrome (dead-proxy wrapper)
        if (controllable !== 'ok')
            return null;
        const started = await startProxySession(server);
        if (!started)
            return null;
        installed = true;
    }
    try {
        return await fetchOnce({
            fetchImpl,
            url: addProxyMarker(url),
            etag: null,
            timeoutMs,
            validate
        });
    } finally {
        if (installed)
            await endProxySession();
    }
};

/**
 * The full chain. ctx:
 *   url        — canonical GitHub URL to fetch
 *   etag       — If-None-Match for the direct layer (optional)
 *   validate   — async (res) => data|null; omit to return the Response
 *   probeUrl   — resource used for mirror speed-testing (defaults to url)
 *   timeoutMs  — per-layer fetch timeout
 *   fetchImpl  — fetch to use (injectable; defaults to global fetch)
 *   chromeImpl — chrome (injectable; defaults to global chrome)
 *   now        — clock (injectable; defaults to Date.now)
 *
 * Resolves `{ data, etag, source }`, `{ notModified, source }`, or null.
 * The caller stays silent on null — this chain never throws by design.
 */
export const fetchGithubResource = async (ctx = {}) => {
    const {
        url,
        etag = null,
        validate,
        probeUrl = url,
        timeoutMs = GITHUB_SOURCE_TIMEOUT,
        fetchImpl = defaultFetch,
        chromeImpl,
        now = () => Date.now()
    } = ctx;

    // 1 — direct GitHub.
    const direct = await fetchOnce({ fetchImpl, url, etag, timeoutMs, validate });
    if (direct)
        return { ...direct, source: 'direct' };

    // 2 — user's proxy (only when configured; skips cleanly otherwise).
    const proxied = await fetchViaProxy({ url, timeoutMs, fetchImpl, chromeImpl, validate });
    if (proxied && proxied.notModified)
        return { ...proxied, source: 'proxy' };
    if (proxied && proxied.data)
        return { ...proxied, source: 'proxy' };

    // 3 — GitHub mirror candidates (top-5, breaker-guarded). The ensure call
    // is the ONLY place a node-list refresh can be triggered, and it is
    // rate-limited internally.
    const storage = chromeImpl && chromeImpl.storage;
    const probeValid = validate ? async res => {
        try {
            return !!(await validate(res));
        } catch (_) {
            return false;
        }
    } : null;
    const hosts = await ensureGithubMirrorHosts({ storage, fetchImpl, now, probeUrl, probeValid });
    for (const host of hosts) {
        const res = await fetchWithTimeout(fetchImpl, buildMirrorUrl(host, url), timeoutMs);
        if (!res) {
            // Network-level failure = the mirror itself is unreachable →
            // trip its 6h breaker (same policy as favicon-enrich's L4).
            await markMirrorDown({ storage, now }, host);
            continue;
        }
        if (res.status === 304)
            return { notModified: true, source: `mirror:${host}` };
        if (!res.ok)
            continue;   // clean HTTP failure → fail over, no breaker trip
        let data = null;
        try {
            data = validate ? await validate(res) : res;
        } catch (_) {
            data = null;
        }
        if (!data)
            continue;   // reachable but wrong content → fail over, no trip
        const resHeaders = res.headers;
        const respEtag = resHeaders && typeof resHeaders.get === 'function' ? resHeaders.get('etag') || '' : '';
        return { data, etag: respEtag, source: `mirror:${host}` };
    }
    return null;   // every layer failed → the caller fails silent
};
