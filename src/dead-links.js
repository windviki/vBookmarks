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
 * checkUrlDual (v4 task-2 §5.5b) wraps checkUrl with the two-channel
 * direct/proxy decision matrix (ok / dead / blocked / skipped). The second
 * channel is either the user's own proxy server (marker-PAC routing, see
 * dead-proxy.js) or a legacy relay template.
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
 *
 * Fourth-round item 10: startPausableScan adds pause/resume to the same
 * pool — pause() stops the pump from dispatching NEW probes (in-flight
 * probes still settle and record, so resume() continues exactly at the
 * breakpoint with no re-probing), cancel() is the old abort semantics.
 * scanBookmarks also gained an onResult(id, result, done, total) hook —
 * fired per settled check, before onProgress — so the view can render
 * dead/blocked rows incrementally instead of waiting for the full Map.
 */

import { addProxyMarker } from './dead-proxy.js';

const HTTP_URL = /^https?:\/\//i;
// HEAD responses that mean "method refused", not "bookmark dead".
const HEAD_REFUSED = [405, 501, 403];

export const checkUrl = (url, { timeoutMs = 8000, signal } = {}) => {
    if (!HTTP_URL.test(url || ''))
        return Promise.resolve({ status: 'skipped', ok: true });
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

// v4 task-2 §5.5b: two-channel probing. The direct fetch runs first; when
// it fails, a second channel gets its say — either the user's own proxy
// server (`proxyServer: true`, routed via the marker-PAC session the dead
// view installs around the scan; see dead-proxy.js) or a legacy relay
// service (`proxyTemplate`, whose `{url}` placeholder receives the encoded
// bookmark URL; the relay's own 2xx/3xx means "target reachable through the
// relay"). The proxy server wins when both exist. The decision matrix:
//   direct ok                      → ok
//   direct fail, no proxy          → dead
//   direct fail, proxy reachable   → blocked (region/ISP-limited, not dead)
//   direct fail, proxy fail        → dead (both channels agree)
//   non-http(s)                    → skipped
// `blocked` rows carry ok:false — they surface in the dead view (the user
// decides) but get the amber badge, not the dead ×.
export const checkUrlDual = (url, { proxyTemplate = '', proxyServer = false, timeoutMs = 8000, signal } = {}) => {
    if (!HTTP_URL.test(url || ''))
        return Promise.resolve({ status: 'skipped', ok: true });
    return checkUrl(url, { timeoutMs, signal }).then(direct => {
        if (direct.ok)
            return { status: 'ok', ok: true, code: direct.status, direct };
        const proxied = proxyServer ? addProxyMarker(url)
            : proxyTemplate ? proxyTemplate.replace('{url}', encodeURIComponent(url))
            : '';
        if (!proxied)
            return { status: 'dead', ok: false, code: direct.status, error: direct.error, direct };
        return checkUrl(proxied, { timeoutMs, signal }).then(proxy =>
            proxy.ok
                ? { status: 'blocked', ok: false, code: direct.status, error: direct.error, direct, proxy }
                : { status: 'dead', ok: false, code: direct.status, error: direct.error, direct, proxy });
    });
};

export const scanBookmarks = (items, { concurrency = 4, timeoutMs = 8000, onProgress, onResult, signal, checker, pauser } = {}) =>
    new Promise(resolve => {
        // checker: per-URL probe, defaults to the plain direct check; the
        // dead view injects checkUrlDual with the configured proxy template.
        // pauser (item 10): optional { paused } gate — while paused the pump
        // dispatches nothing new; pauser.pump is wired back so resume() can
        // re-enter the pump (see startPausableScan).
        const probe = checker || checkUrl;
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
            while (!settled && !(pauser && pauser.paused) && running < concurrency && next < total) {
                const item = items[next++];
                running++;
                probe(item.url, { timeoutMs, signal }).then(result => {
                    running--;
                    if (settled) // cancelled while this check was in flight
                        return;
                    results.set(item.id, result);
                    done++;
                    if (onResult)
                        onResult(item.id, result, done, total);
                    if (onProgress)
                        onProgress(done, total);
                    if (done >= total)
                        finish();
                    else
                        pump();
                });
            }
        };
        if (pauser)
            pauser.pump = pump;
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

// Owns the AbortController so the palette just keeps { promise, abort }.
export const startDeadScan = (items, opts = {}) => {
    const controller = new AbortController();
    const external = opts.signal;
    if (external) {
        if (external.aborted)
            controller.abort();
        else
            external.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const promise = scanBookmarks(items, { ...opts, signal: controller.signal });
    return { promise, abort: () => controller.abort() };
};

// Fourth-round item 10: the dead view's scan session — startDeadScan plus a
// pause gate. Returns { promise, pause, resume, cancel, isPaused }:
//   pause()  — flips the gate; the pump stops dispatching NEW probes while
//              in-flight probes still settle and record their results, so
//              nothing already paid for is lost;
//   resume() — clears the gate and re-enters the pump at the breakpoint
//              (the next un-dispatched item), never re-probing;
//   cancel() — the old abort(): in-flight fetches are aborted, dispatch
//              stops for good and the promise settles with the partial Map
//              (the caller decides whether to keep or discard it);
// the promise ALWAYS resolves — pause/resume never settle it.
export const startPausableScan = (items, opts = {}) => {
    const controller = new AbortController();
    const external = opts.signal;
    if (external) {
        if (external.aborted)
            controller.abort();
        else
            external.addEventListener('abort', () => controller.abort(), { once: true });
    }
    // The gate object scanBookmarks reads on every pump pass; `pump` is
    // wired back by the engine so resume() can restart dispatching.
    // opts.startPaused arms the gate BEFORE the first pump pass, so a
    // paused-at-birth scan (SW cold-start resume) dispatches nothing.
    const pauser = { paused: !!opts.startPaused, pump: null };
    const promise = scanBookmarks(items, { ...opts, signal: controller.signal, pauser });
    return {
        promise,
        pause: () => { pauser.paused = true; },
        resume: () => {
            if (!pauser.paused)
                return;
            pauser.paused = false;
            if (pauser.pump)
                pauser.pump();
        },
        cancel: () => controller.abort(),
        isPaused: () => pauser.paused
    };
};
