/**
 * Dead-scan service-worker runner (v4 task-4 #16).
 *
 * Before this module the scan lived in the popup: closing the popup (or the
 * side panel) pagehide-cancelled the session and thousands-of-bookmarks
 * users had to babysit an open popup for the whole run. The scan now runs
 * here — the SW outlives any page — and the view is a pure mirror:
 *
 * - Pages drive the scan with fire-and-forget messages
 *   (`vbm-dead-scan-start|pause|resume|cancel`), same house protocol as
 *   sync-engine.js — no sendResponse, state flows back through storage.
 * - The runner publishes a live blob to chrome.storage.local `vbmDeadScan`:
 *     { state:'scanning'|'paused', done, total, ts, items:[id…],
 *       results:{ id:{status,code,error} }, proxy:{ active, gate } }
 *   transitions publish immediately, per-check ticks publish throttled
 *   (PUBLISH_MS). Pages mirror it via chrome.storage.onChanged.
 * - A finished scan writes the `deadLastScan` cache (the exact shape the
 *   popup used to write) and removes the live blob; a cancel just removes
 *   the blob ("the run never happened", item-10 semantics).
 * - The marker-PAC proxy session (dead-proxy.js) is installed/torn down
 *   here; all of its scan-time calls are SW-safe (only the popup's
 *   permission REQUEST stays page-side, which is why the gate degrades to
 *   direct-only with a `gate` note instead of asking).
 * - MV3 cold start: `resumeIfNeeded()` runs at background.js top level. A
 *   live blob younger than STALE_MS means the SW was killed mid-run (plain
 *   fetch does not always reset the idle timer) — the scan resumes from the
 *   published remainder; a `paused` blob stays paused until a page resumes
 *   it. The blob doubles as the resume journal, so no run state is lost.
 *
 * The module only touches the chrome global inside functions, so tests
 * inject a double on globalThis before createDeadScanRunner() (same recipe
 * as visit-stats-sw.js / sync-engine.js).
 */

import { checkUrlDual, startPausableScan, filterScannable } from './dead-links.js';
import {
    parseProxyServer, proxyPermission, proxyControllable,
    startProxySession, endProxySession
} from './dead-proxy.js';
import { SeparatorManager } from './separators.js';

export const DEAD_SCAN_KEY = 'vbmDeadScan';
export const DEAD_LAST_KEY = 'deadLastScan';
export const DEAD_SCAN_MSG = {
    start: 'vbm-dead-scan-start',
    pause: 'vbm-dead-scan-pause',
    resume: 'vbm-dead-scan-resume',
    cancel: 'vbm-dead-scan-cancel'
};

const PUBLISH_MS = 700;
const STALE_MS = 24 * 3600 * 1000; // a live blob older than a day is a corpse

export function createDeadScanRunner() {
    let session = null;       // live startPausableScan session
    let items = [];           // scan order (full items; ids go into the blob)
    let results = new Map();  // settled checks so far
    let total = 0;
    let doneCount = 0;
    let startTs = 0;
    let proxyOn = false;      // THIS runner installed the marker-PAC
    let proxyGate = '';       // '' | i18n key — why the proxy channel is off
    let publishTimer = null;
    let started = false;

    // --- Storage helpers (callback style, like the repo's other SW doubles) --
    const storageGet = (keys, cb) => chrome.storage.local.get(keys, cb);
    const storageSet = (obj, cb) => chrome.storage.local.set(obj, cb || (() => {}));
    const dropBlob = () => chrome.storage.local.remove(DEAD_SCAN_KEY);

    // --- Publishing -------------------------------------------------------------
    const blob = state => JSON.stringify({
        state,
        done: doneCount,
        total,
        ts: startTs,
        items: items.map(item => item.id),
        results: (() => {
            const plain = {};
            results.forEach((r, id) => {
                plain[id] = { status: r.status, code: r.code, error: r.error };
            });
            return plain;
        })(),
        proxy: { active: proxyOn, gate: proxyGate }
    });

    const publishNow = state => {
        if (publishTimer) {
            clearTimeout(publishTimer);
            publishTimer = null;
        }
        storageSet({ [DEAD_SCAN_KEY]: blob(state) });
    };

    const publishTick = () => {
        if (publishTimer)
            return;
        publishTimer = setTimeout(() => {
            publishTimer = null;
            if (session)
                publishNow(session.isPaused() ? 'paused' : 'scanning');
        }, PUBLISH_MS);
    };

    // --- Proxy session ------------------------------------------------------------
    const stopProxy = () => {
        if (!proxyOn)
            return;
        proxyOn = false;
        endProxySession();
        if (chrome.storage && chrome.storage.session)
            chrome.storage.session.remove('vbmProxySession');
    };

    // Resolves true only with the PAC live; failures are noted in proxyGate
    // and the scan degrades to direct(+template)-only (popup-era semantics).
    const gateProxy = server =>
        proxyPermission().then(have => {
            if (!have) {
                proxyGate = 'deadProxyDenied';
                return false;
            }
            return proxyControllable().then(control => {
                if (control !== 'ok') {
                    proxyGate = control === 'other-extension' ? 'deadProxyControlled' : 'deadProxyUnavailable';
                    return false;
                }
                return startProxySession(server).then(ok => {
                    if (!ok) {
                        proxyGate = 'deadProxyControlled';
                        return false;
                    }
                    proxyGate = '';
                    proxyOn = true;
                    // Crash-residue marker swept by background.js on the next
                    // cold start if this runner dies without stopProxy().
                    if (chrome.storage && chrome.storage.session)
                        chrome.storage.session.set({ vbmProxySession: Date.now() });
                    return true;
                });
            });
        });

    // --- Settings + items -----------------------------------------------------------
    const readSettings = data => ({
        proxyTemplate: data.deadProxyTemplate || '',
        proxyServer: parseProxyServer(data.deadProxyServer || ''),
        concurrency: Math.min(16, Math.max(1, parseInt(data.deadScanConcurrency || '4', 10) || 4)),
        timeoutMs: Math.min(30, Math.max(2, parseInt(data.deadScanTimeout || '8', 10) || 8)) * 1000,
        // The separator double: SeparatorManager reads its keys through a
        // store-shaped { get } — a plain snapshot map satisfies it.
        separators: new SeparatorManager({ get: k => (k in data ? data[k] : undefined) })
    });

    const flattenTree = (tree, out = []) => {
        const walk = nodes => {
            for (let i = 0, l = (nodes || []).length; i < l; i++) {
                const node = nodes[i];
                if (node.children)
                    walk(node.children);
                else if (node.url)
                    out.push({ id: node.id, title: node.title || '', url: node.url });
            }
        };
        walk(tree);
        return out;
    };

    const SETTING_KEYS = ['deadProxyTemplate', 'deadProxyServer',
        'deadScanConcurrency', 'deadScanTimeout',
        'separatorTitle', 'separatorURL', 'separatorString', 'separators'];

    // --- Scan lifecycle ----------------------------------------------------------
    // priorResults: ids to skip (cold-start resume); their rows keep the
    // blob's verdicts so a resumed run never re-probes settled checks.
    const launch = (settings, allItems, priorResults, paused) => {
        items = allItems;
        results = new Map(priorResults);
        total = allItems.length;
        doneCount = priorResults.size;
        const remaining = allItems.filter(item => !priorResults.has(item.id));
        if (!remaining.length) {
            finish(); // everything settled before the SW died — just persist
            return;
        }
        const s = startPausableScan(remaining, {
            concurrency: settings.concurrency,
            timeoutMs: settings.timeoutMs,
            startPaused: paused,
            checker: (url, o) => checkUrlDual(url, {
                ...o,
                proxyTemplate: settings.proxyTemplate,
                proxyServer: proxyOn
            }),
            onResult: (id, result, done) => {
                results.set(id, result);
                doneCount = priorResults.size + done;
                publishTick();
            }
        });
        session = s;
        publishNow(paused ? 'paused' : 'scanning');
        s.promise.then(() => {
            if (session !== s)
                return; // cancelled/replaced — the run is discarded
            finish();
        });
    };

    const finish = () => {
        session = null;
        stopProxy();
        const plain = {};
        results.forEach((r, id) => {
            plain[id] = { status: r.status, code: r.code, error: r.error };
        });
        storageSet({
            [DEAD_LAST_KEY]: JSON.stringify({
                ts: Date.now(), scannedCount: total, results: plain
            })
        });
        dropBlob();
        results = new Map();
        items = [];
        total = doneCount = 0;
        startTs = 0;
    };

    // skipSettled: cold-start/resume-remainder mode (keep the blob's rows)
    const start = ({ skipSettled = false, paused = false } = {}) => {
        if (session)
            return;
        storageGet(SETTING_KEYS.concat(DEAD_SCAN_KEY), data => {
            const settings = readSettings(data);
            chrome.bookmarks.getTree(tree => {
                const mgr = settings.separators;
                const all = filterScannable(flattenTree(tree),
                    (title, url) => mgr.isSeparator(title, url));
                let prior = new Map();
                if (skipSettled && data[DEAD_SCAN_KEY]) {
                    try {
                        const old = JSON.parse(data[DEAD_SCAN_KEY]);
                        for (const id of Object.keys(old.results || {}))
                            prior.set(id, old.results[id]);
                        if (!startTs)
                            startTs = old.ts || Date.now();
                    } catch (e) { /* a corrupt blob just means a fresh run */ }
                }
                if (!startTs)
                    startTs = Date.now();
                proxyGate = '';
                if (settings.proxyServer)
                    gateProxy(settings.proxyServer).then(() => launch(settings, all, prior, paused));
                else
                    launch(settings, all, prior, paused);
            });
        });
    };

    const pause = () => {
        if (session && !session.isPaused()) {
            session.pause();
            publishNow('paused');
        }
    };

    const resume = () => {
        if (session) {
            if (session.isPaused()) {
                session.resume();
                publishNow('scanning');
            }
            return;
        }
        // No live session: the SW was restarted while the blob sat paused —
        // resume means "scan the published remainder".
        storageGet(DEAD_SCAN_KEY, data => {
            const raw = data[DEAD_SCAN_KEY];
            if (!raw)
                return;
            let state = null;
            try {
                state = JSON.parse(raw).state;
            } catch (e) { /* fresh start below covers it */ }
            if (state === 'paused' || state === 'scanning')
                start({ skipSettled: true });
        });
    };

    const cancel = () => {
        if (!session)
            return;
        const s = session;
        session = null;
        s.cancel(); // the settle handler sees session!==s and stays out
        stopProxy();
        dropBlob();
        results = new Map();
        items = [];
        total = doneCount = 0;
        startTs = 0;
    };

    // --- Messaging ----------------------------------------------------------------
    const onMessage = msg => {
        if (!msg || !msg.type)
            return;
        if (msg.type === DEAD_SCAN_MSG.start)
            start();
        else if (msg.type === DEAD_SCAN_MSG.pause)
            pause();
        else if (msg.type === DEAD_SCAN_MSG.resume)
            resume();
        else if (msg.type === DEAD_SCAN_MSG.cancel)
            cancel();
    };

    // MV3 cold start: a fresh live blob means the SW died mid-run — continue
    // from the published remainder (a paused blob stays paused).
    const resumeIfNeeded = () => {
        storageGet(DEAD_SCAN_KEY, data => {
            const raw = data[DEAD_SCAN_KEY];
            if (!raw || session)
                return;
            let old;
            try {
                old = JSON.parse(raw);
            } catch (e) {
                return;
            }
            if ((old.state !== 'scanning' && old.state !== 'paused')
                || !old.ts || Date.now() - old.ts > STALE_MS)
                return;
            startTs = old.ts;
            start({ skipSettled: true, paused: old.state === 'paused' });
        });
    };

    const start_ = () => {
        if (started)
            return;
        started = true;
        chrome.runtime.onMessage.addListener(onMessage);
        resumeIfNeeded();
    };

    // start() is what background.js calls; the rest is test surface.
    return { start: start_, onMessage, resumeIfNeeded, _state: () => ({
        running: !!session, done: doneCount, total, proxyOn, proxyGate
    }) };
}
