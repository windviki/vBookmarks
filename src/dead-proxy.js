/**
 * Real-proxy support for the dead-link scan (post-v4): the dual-channel
 * checker routes its second channel through the user's OWN HTTP/SOCKS proxy
 * server (the legacy third-party relay template `deadProxyTemplate` is
 * retired). The extension never implements a proxy server — it only routes
 * requests through one the user already has.
 *
 * Mechanism (marker-PAC): chrome.proxy can only change browser-wide proxy
 * settings, and fetch() cannot pick a proxy per request. The trick that
 * keeps every OTHER page's traffic untouched is a PAC script keyed on a
 * marker query parameter:
 *
 *   startProxySession(server) installs
 *       FindProxyForURL = url contains "__vbm_px=1" ? PROXY host:port : DIRECT
 *   the scan's direct channel fetches the bare URL        → DIRECT
 *   the scan's proxy channel fetches addProxyMarker(url)  → the proxy
 *
 * so both channels run CONCURRENTLY inside the existing pool with no global
 * flip-flopping (a fixed_servers toggle would race the pool and route every
 * tab through the proxy), and no URL outside the extension's own probes ever
 * carries the marker. The PAC returns the proxy with NO "; DIRECT" fallback
 * on purpose: a fallback would let a dead proxy silently degrade to direct
 * and make both the reachability test and the blocked verdict lie.
 *
 * Scope notes (honest limits):
 *   - scope 'regular' is still a browser-wide setting; while a scan session
 *     is installed, traffic WITHOUT the marker resolves to DIRECT even for
 *     users with a system-level proxy (PAC has no "fall back to system").
 *     Scans are user-triggered and short; the popup clears the session on
 *     settle/cancel/pagehide, and the SW sweeps crash residue at startup.
 *   - chrome.proxy.settings.clear only removes what THIS extension set.
 *   - proxies needing auth are rejected at parse time (Chrome would surface
 *     an auth challenge we cannot answer without webRequest blocking).
 *   - another extension owning proxy settings (SwitchyOmega & co.) makes
 *     levelOfControl 'controlled_by_other_extensions' — the view reports it
 *     and the scan degrades to direct-only.
 *
 * The `proxy` permission is a REQUIRED install-time permission in the
 * manifest: Chrome refuses proxy in optional_permissions ("cannot be listed
 * as optional"), and requesting an unlisted permission fails at runtime.
 * The add flow therefore only VERIFIES it via chrome.permissions.contains
 * (always true in practice) with a request fallback that never prompts
 * while granted. Holding the permission is inert on its own — no PAC is
 * ever installed unless the user saved a proxy server AND a scan (or the
 * add-flow probe) is actually running; users who never configure a proxy
 * or never open the dead view exercise zero proxy code paths.
 *
 * Pure parts (parse/marker/PAC text) are chrome-free; the chrome wrappers
 * touch chrome.* only when called, so vitest imports the module in node and
 * doubles the globals. Unit-tested by tests/dead-proxy.test.js.
 */

// The query marker the PAC script routes on. Must stay a plain literal the
// generated PAC can indexOf() — no regex. A target URL carrying this string
// naturally is pathological and simply gets proxied too (harmless: it is the
// same reachability question).
export const PROXY_MARKER = '__vbm_px=1';

// Default probe target for the add-flow reachability test: small, stable,
// and — for the users who need a proxy at all — typically reachable ONLY
// through it, which makes it a meaningful end-to-end check. Any HTTP
// response counts; the status code itself does not matter.
export const DEFAULT_PROXY_TEST_URL = 'https://www.gstatic.com/generate_204';

// scheme → PAC return-token.
const PAC_TOKENS = { http: 'PROXY', https: 'HTTPS', socks5: 'SOCKS5' };

// 'host:port' | 'scheme://host:port' (bare input defaults to http) →
// { scheme, host, port } or null. Bracketed IPv6 ([::1]:1080) keeps its
// brackets — PAC wants them. Credentials, paths, queries and unknown schemes
// are rejected.
export const parseProxyServer = input => {
    let s = (input || '').trim();
    if (!s)
        return null;
    let scheme = 'http';
    const schemeMatch = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/(.+)$/.exec(s);
    if (schemeMatch) {
        scheme = schemeMatch[1].toLowerCase();
        s = schemeMatch[2];
    }
    if (!PAC_TOKENS[scheme])
        return null;
    if (/[@/?#]/.test(s)) // user:pass@, /path, ?query, #frag — unsupported
        return null;
    let host;
    let port;
    const v6 = /^\[([0-9A-Fa-f:]+)\]:(\d+)$/.exec(s);
    if (v6) {
        host = `[${v6[1]}]`;
        port = parseInt(v6[2], 10);
    } else {
        const plain = /^([A-Za-z0-9.-]+):(\d+)$/.exec(s);
        if (!plain)
            return null;
        host = plain[1].toLowerCase();
        port = parseInt(plain[2], 10);
    }
    if (!port || port < 1 || port > 65535)
        return null;
    return { scheme, host, port };
};

// Canonical storage form of a parsed server ('http://127.0.0.1:7890').
export const formatProxyServer = server =>
    `${server.scheme}://${server.host}:${server.port}`;

// Inserts the PAC marker as a query parameter, ahead of any #fragment.
export const addProxyMarker = url => {
    const hash = url.indexOf('#');
    const base = hash === -1 ? url : url.slice(0, hash);
    const frag = hash === -1 ? '' : url.slice(hash);
    return `${base}${base.indexOf('?') === -1 ? '?' : '&'}${PROXY_MARKER}${frag}`;
};

// The PAC source startProxySession installs: marked URLs → the proxy (no
// DIRECT fallback, see the header), everything else → DIRECT.
export const buildPacScript = server =>
    'function FindProxyForURL(url, host) {\n' +
    `    if (url.indexOf("${PROXY_MARKER}") !== -1)\n` +
    `        return "${PAC_TOKENS[server.scheme]} ${server.host}:${server.port}";\n` +
    '    return "DIRECT";\n' +
    '}';

// --- chrome wrappers (call-time chrome access; tests double the globals) ---

const lastError = () => (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) || null;

export const proxyPermission = () => {
    if (typeof chrome === 'undefined' || !(chrome.permissions && chrome.permissions.contains))
        return Promise.resolve(false);
    return new Promise(resolve =>
        chrome.permissions.contains({ permissions: ['proxy'] }, granted => resolve(!!granted)));
};

// Chrome requires a user gesture for permissions.request — callers invoke
// this synchronously inside the add/save button's click handler (the same
// contract the stats view's history Enable link follows).
export const requestProxyPermission = () => {
    if (typeof chrome === 'undefined' || !(chrome.permissions && chrome.permissions.request))
        return Promise.resolve(false);
    return new Promise(resolve =>
        chrome.permissions.request({ permissions: ['proxy'] }, granted => resolve(!!granted)));
};

// 'ok' | 'other-extension' | 'unavailable' — whether this extension may
// drive proxy settings at all.
export const proxyControllable = () => {
    if (typeof chrome === 'undefined' || !(chrome.proxy && chrome.proxy.settings && chrome.proxy.settings.get))
        return Promise.resolve('unavailable');
    return new Promise(resolve =>
        chrome.proxy.settings.get({}, details => {
            const level = details && details.levelOfControl;
            resolve(level === 'controlled_by_other_extensions' ? 'other-extension' : 'ok');
        }));
};

// Installs the marker-PAC. Resolves false when the API is missing or the
// write was rejected (another controller), never rejects.
export const startProxySession = server => {
    if (typeof chrome === 'undefined' || !(chrome.proxy && chrome.proxy.settings && chrome.proxy.settings.set))
        return Promise.resolve(false);
    return new Promise(resolve =>
        chrome.proxy.settings.set({
            value: { mode: 'pac_script', pacScript: { data: buildPacScript(server) } },
            scope: 'regular'
        }, () => resolve(!lastError())));
};

// Removes this extension's proxy settings (a no-op when none are ours).
export const endProxySession = () => {
    if (typeof chrome === 'undefined' || !(chrome.proxy && chrome.proxy.settings && chrome.proxy.settings.clear))
        return Promise.resolve(false);
    return new Promise(resolve =>
        chrome.proxy.settings.clear({ scope: 'regular' }, () => resolve(!lastError())));
};

// One HEAD through the just-installed session: ANY HTTP response proves the
// proxy tunnel works (status is irrelevant — a 405/404 still arrived via the
// proxy); a network error or the timeout means unreachable. The session is
// always torn down again. Kept local instead of reusing dead-links.js's
// checkUrl so this module never imports back into the scan module.
const probeOnce = (url, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { method: 'HEAD', redirect: 'follow', signal: controller.signal })
        .then(() => true)
        .catch(() => false)
        .finally(() => clearTimeout(timer));
};

// The add-flow gate: install the PAC, probe the test URL through the proxy,
// tear down. Resolves true only when the proxy delivered a response; the
// caller must NOT persist an unreachable server. Callers are expected to
// hold off while a scan session is live (the view disables the add UI
// mid-scan) so the test never clobbers a running scan's PAC.
export const testProxyReachable = (server, { testUrl = DEFAULT_PROXY_TEST_URL, timeoutMs = 8000 } = {}) =>
    startProxySession(server)
        .then(started => started ? probeOnce(addProxyMarker(testUrl), timeoutMs) : false)
        .then(reachable => endProxySession().then(() => reachable),
            () => endProxySession().then(() => false));
