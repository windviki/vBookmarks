/**
 * Dead-link scanning (P3.5) — pure logic, no chrome / DOM access, so vitest
 * exercises it directly in node (fetch and AbortController are page globals
 * in the popup and platform globals in node 18+; tests double fetch).
 *
 * checkUrl probes one bookmark URL:
 *   - non-http(s) URLs (javascript:, chrome:, file:, ftp:, …) are not
 *     checkable — { status: 'skipped', ok: true }, never counted as dead;
 *   - http(s) URLs get a HEAD request with redirect:'follow' (3xx resolves
 *     inside fetch) and an AbortController timeout; servers that refuse HEAD
 *     (405 / 501 / 403) get one GET retry;
 *   - the result is { status, ok } with a numeric HTTP status (ok = < 400),
 *     or { status: 'error', ok: false, error: err.name } on network failure
 *     (TypeError) or timeout (AbortError).
 *
 * scanBookmarks runs checkUrl over a flat [{ id, title, url }] list through
 * a concurrency pool (default 4 in flight), reports onProgress(done, total)
 * after every settled check, and resolves a Map(id → result). An external
 * AbortSignal cancels the scan: the promise resolves early with the partial
 * Map, in-flight fetches are aborted and their late results dropped.
 *
 * The palette-facing helpers stay chrome-free too: filterScannable drops
 * folders and separators from a flattened tree (separator URLs are http(s)
 * and would otherwise be probed), collectDead picks the !ok entries out of
 * a result Map, statusLabel renders one result as a row badge ('404',
 * 'timeout', 'error'), and startDeadScan wraps scanBookmarks in an owned
 * AbortController so the caller gets { promise, abort }.
 */

const HTTP_URL = /^https?:\/\//i;
// HEAD responses that mean "method refused", not "bookmark dead".
const HEAD_REFUSED = [405, 501, 403];

// Single-channel probe (unchanged core logic)
const probeChannel = (url, { timeoutMs = 8000, signal } = {}) => {
    const controller = new AbortController();
    if (signal) {
        if (signal.aborted)
            controller.abort();
        else
            signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const attempt = method => fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal
    });
    return attempt('HEAD')
        .then(res => HEAD_REFUSED.indexOf(res.status) !== -1 ? attempt('GET') : res)
        .then(res => ({ status: res.status, ok: res.status < 400 }))
        .catch(err => ({ status: 'error', ok: false, error: (err && err.name) || 'Error' }))
        .finally(() => clearTimeout(timer));
};

/**
 * checkUrl — probe a bookmark URL, optionally via a proxy template.
 *
 * Dual-channel matrix (§5.5b):
 *   direct ok                    → { status, ok: true }
 *   direct fail, no proxy        → { status, ok: false }
 *   direct fail, proxy ok        → { status: 'blocked', ok: true }  (直连不可达，代理可达)
 *   direct fail, proxy fail      → { status, ok: false }            (双通道确认死链)
 *   non-http(s)                  → { status: 'skipped', ok: true }
 */
export const checkUrl = (url, { timeoutMs = 8000, signal, proxyTemplate } = {}) => {
    if (!HTTP_URL.test(url || ''))
        return Promise.resolve({ status: 'skipped', ok: true });

    return probeChannel(url, { timeoutMs, signal }).then(directResult => {
        if (directResult.ok)
            return directResult;

        // Direct failed — try proxy if configured
        if (!proxyTemplate)
            return directResult; // no proxy → it's just dead

        const proxyUrl = proxyTemplate.replace('{url}', encodeURIComponent(url));
        // Proxy channel uses longer timeout (typically slower)
        const proxyTimeout = timeoutMs * 1.5;
        return probeChannel(proxyUrl, { timeoutMs: proxyTimeout, signal }).then(proxyResult => {
            if (proxyResult.ok) {
                // Direct failed but proxy succeeded → blocked (GFW / regional)
                return { status: 'blocked', ok: true, directStatus: directResult.status };
            }
            // Both failed → confirmed dead
            return directResult;
        }).catch(() => {
            // Proxy itself errored → fall back to direct result
            return directResult;
        });
    });
};

export const scanBookmarks = (items, { concurrency = 4, timeoutMs = 8000, onProgress, signal, proxyTemplate } = {}) =>
    new Promise(resolve => {
        const results = new Map();
        const total = items.length;
        let done = 0;
        let next = 0;
        let running = 0;
        let settled = false;
        const finish = () => {
            if (!settled) {
                settled = true;
                resolve(results);
            }
        };
        if (signal)
            signal.addEventListener('abort', finish, { once: true });
        if (!total || (signal && signal.aborted)) {
            finish();
            return;
        }
        const pump = () => {
            while (!settled && running < concurrency && next < total) {
                const item = items[next++];
                running++;
                checkUrl(item.url, { timeoutMs, signal, proxyTemplate }).then(result => {
                    running--;
                    if (settled) // cancelled while this check was in flight
                        return;
                    results.set(item.id, result);
                    done++;
                    if (onProgress)
                        onProgress(done, total);
                    if (done >= total)
                        finish();
                    else
                        pump();
                });
            }
        };
        pump();
    });

// Folders have no URL to check; separators do (http(s) by construction) but
// must never be probed. isSeparator is SeparatorManager.isSeparator, injected
// so this module stays chrome-free.
export const filterScannable = (items, isSeparator) =>
    items.filter(item =>
        !item.isFolder && !(isSeparator && isSeparator(item.title, item.url)));

export const collectDead = (items, results) =>
    items.filter(item => {
        const result = results.get(item.id);
        return result && !result.ok;
    });

export const statusLabel = result => {
    if (typeof result.status === 'number')
        return `${result.status}`;
    return result.error === 'AbortError' ? 'timeout' : 'error';
};

// Owns the AbortController. Passes proxyTemplate through from opts.
export const startDeadScan = (items, opts = {}) => {
    const controller = new AbortController();
    const external = opts.signal;
    if (external) {
        if (external.aborted)
            controller.abort();
        else
            external.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const promise = scanBookmarks(items, {
        ...opts,
        signal: controller.signal,
        proxyTemplate: opts.proxyTemplate
    });
    return { promise, abort: () => controller.abort() };
};
