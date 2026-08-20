/**
 * GitHub mirror provider management (4.0.8 announce fallback, built to be
 * reused by future GitHub-resource fetches).
 *
 * The announce chain's third layer is NOT a generic third-party aggregator
 * like favicon-enrich's L4 list — it is a list of GitHub mirror/proxy nodes.
 * The node list is maintained by the public mirror site github.akams.cn
 * (its page ships the current node list inside a Next.js chunk), so the
 * extension refreshes candidates from there and speed-tests them itself.
 *
 * Policy (mirrors favicon-enrich's breaker/refresh discipline, docs §3.4):
 *   - top-5 candidates are persisted under `vbmGithubMirrors` in
 *     chrome.storage.local; the fetch chain consumes them in latency order
 *   - refresh (node list + speed test) happens ONLY when the fetch chain has
 *     already fallen back to the mirror layer, and only when the cache is
 *     absent / all candidates are breaker-tripped / older than TTL
 *   - refresh attempts are rate-limited by a 24h cooldown, the probe itself
 *     is bounded by a wall-clock budget + per-probe timeout + concurrency
 *     cap, so a slow mirror list can never turn into an unbounded fan-out
 *   - a network-level failure trips that mirror for 6h (same BREAKER_TTL as
 *     favicon-enrich); clean HTTP failures and validation failures do not
 *     trip — they just fail over to the next candidate
 *   - every failure is silent; an absent cache falls back to a small
 *     built-in seed so the first run still has candidates
 *
 * The module is pure ESM with injectable fetch/storage/clock, so it is
 * vitest-coverable in node (no DOM/chrome dependency).
 */

// --- Keys / budgets ----------------------------------------------------------
export const MIRROR_KEY = 'vbmGithubMirrors';
export const MIRROR_VERSION = 1;
export const MIRROR_TTL_MS = 7 * 24 * 60 * 60 * 1000;          // refresh node list after 7d
export const MIRROR_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000; // at most one refresh attempt / day
export const MIRROR_BREAKER_TTL_MS = 6 * 60 * 60 * 1000;       // same 6h breaker as favicon-enrich
export const MIRROR_MAX_CANDIDATES = 5;
export const MIRROR_LIST_URL = 'https://github.akams.cn/';
export const MIRROR_LIST_TIMEOUT = 5000;                       // homepage / chunk fetch
export const MIRROR_PROBE_TIMEOUT = 4000;                      // per-node probe fetch
export const MIRROR_PROBE_BUDGET_MS = 15000;                   // whole speed-test wall clock
export const MIRROR_PROBE_CONCURRENCY = 6;                     // same concurrency as favicon-enrich
export const MIRROR_MAX_CHUNKS = 12;                           // max page chunks to inspect for the node list

// Built-in seed: the top-5 mirror nodes measured against
// docs/announce.json on 2026-08 with the same probe + JSON validation the
// runtime refresh uses (see tests/github-mirrors.test.js for the extraction
// + probe contract). The runtime refresh replaces this with the site's
// current list; this only guarantees candidates on a first run or when the
// refresh itself cannot run.
export const BUILTIN_MIRRORS = [
    'github.xxlab.tech',
    'gh.idayer.com',
    'g.z321.cc.cd',
    'tvv.tw',
    'ghf.xn--eqrr82bzpe.top'
];

// --- URL helpers -------------------------------------------------------------
export const buildMirrorUrl = (host, githubUrl) => `https://${host}/${githubUrl}`;

const normalizeHost = value => {
    if (typeof value !== 'string' || !value)
        return null;
    try {
        const u = new URL(`https://${value}`);
        return u.hostname || null;
    } catch (_) {
        return null;
    }
};

// --- Node-list extraction (github.akams.cn) ---------------------------------
// The site's node list lives in one of the page's Next.js chunks as a JS
// array literal: [{label:"contribute",value:"ghproxy.net"}, ...]. Chunk
// names are content-hashed, so the fetcher discovers them from the homepage.
const CHUNK_RE = /<script[^>]+src="([^"]+)"/g;
const CHUNK_PATH_RE = /^\/_next\/static\/chunks\/[^"?#]+\.js$/;
const NODE_RE = /\{label:"(?:contribute|search)",value:"([^"]+)"\}/g;

export const extractChunkSrcs = html => {
    if (typeof html !== 'string' || !html)
        return [];
    const srcs = [];
    let m;
    CHUNK_RE.lastIndex = 0;
    while ((m = CHUNK_RE.exec(html))) {
        if (CHUNK_PATH_RE.test(m[1]) && !srcs.includes(m[1]))
            srcs.push(m[1]);
    }
    return srcs;
};

export const parseMirrorHostsFromJs = js => {
    if (typeof js !== 'string' || !js)
        return [];
    const hosts = [];
    let m;
    NODE_RE.lastIndex = 0;
    while ((m = NODE_RE.exec(js))) {
        const host = normalizeHost(m[1]);
        if (host && !hosts.includes(host))
            hosts.push(host);
    }
    return hosts;
};

// --- Cache read/write --------------------------------------------------------
export const parseMirrorCache = raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const seen = new Set();
    const nodes = [];
    if (Array.isArray(raw.nodes)) {
        for (const n of raw.nodes) {
            if (!n || typeof n.host !== 'string')
                continue;
            const host = normalizeHost(n.host);
            if (!host || seen.has(host))
                continue;
            seen.add(host);
            nodes.push({
                host,
                latency: typeof n.latency === 'number' && n.latency >= 0 ? n.latency : null
            });
            if (nodes.length >= MIRROR_MAX_CANDIDATES)
                break;
        }
    }
    if (!nodes.length)
        return null;
    const down = {};
    if (raw.down && typeof raw.down === 'object') {
        for (const host of Object.keys(raw.down)) {
            const until = raw.down[host];
            if (typeof until === 'number' && until > 0)
                down[host] = until;
        }
    }
    return {
        v: MIRROR_VERSION,
        ts: typeof raw.ts === 'number' && raw.ts >= 0 ? raw.ts : 0,
        refreshedAt: typeof raw.refreshedAt === 'number' && raw.refreshedAt >= 0
            ? raw.refreshedAt
            : (typeof raw.ts === 'number' && raw.ts >= 0 ? raw.ts : 0),
        nodes,
        down
    };
};

const localGet = async (storage, key) => {
    if (!storage || !storage.local || typeof storage.local.get !== 'function')
        return {};
    try {
        return await storage.local.get(key);
    } catch (_) {
        return {};
    }
};

const localSet = async (storage, key, value) => {
    if (!storage || !storage.local || typeof storage.local.set !== 'function')
        return;
    try {
        await storage.local.set({ [key]: value });
    } catch (_) { /* quota / session-only degrade — silent */ }
};

export const readMirrorCache = async storage => {
    const got = await localGet(storage, MIRROR_KEY);
    return parseMirrorCache(got && got[MIRROR_KEY]);
};

export const writeMirrorCache = (storage, cache) =>
    localSet(storage, MIRROR_KEY, cache);

export const usableMirrorHosts = (cache, nowMs) => {
    if (!cache || !Array.isArray(cache.nodes))
        return [];
    return cache.nodes
        .filter(n => n && typeof n.host === 'string' && n.host
            && nowMs >= ((cache.down && cache.down[n.host]) || 0))
        .map(n => n.host);
};

export const markMirrorDown = async ({ storage, now = () => Date.now() }, host) => {
    if (!host)
        return;
    const cache = await readMirrorCache(storage);
    if (!cache)
        return;
    cache.down[host] = now() + MIRROR_BREAKER_TTL_MS;
    await writeMirrorCache(storage, cache);
};

// --- Fetch plumbing ----------------------------------------------------------
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

export const fetchAkamsMirrorHosts = async ({
    fetchImpl,
    fetchTimeoutMs = MIRROR_LIST_TIMEOUT,
    maxChunks = MIRROR_MAX_CHUNKS
}) => {
    if (!fetchImpl)
        return [];
    const page = await fetchWithTimeout(fetchImpl, MIRROR_LIST_URL, fetchTimeoutMs);
    if (!page || !page.ok)
        return [];
    let html;
    try {
        html = await page.text();
    } catch (_) {
        return [];
    }
    const srcs = extractChunkSrcs(html).slice(0, maxChunks);
    for (const src of srcs) {
        let chunkUrl;
        try {
            chunkUrl = new URL(src, MIRROR_LIST_URL).href;
        } catch (_) {
            continue;
        }
        const chunk = await fetchWithTimeout(fetchImpl, chunkUrl, fetchTimeoutMs);
        if (!chunk || !chunk.ok)
            continue;
        let js;
        try {
            js = await chunk.text();
        } catch (_) {
            continue;
        }
        const hosts = parseMirrorHostsFromJs(js);
        if (hosts.length)
            return hosts;
    }
    return [];
};

// Speed-test a list of hosts by fetching `probeUrl` through each mirror.
// Bounded by a wall-clock budget AND per-probe timeouts; results are sorted
// fastest-first and sliced to the top candidates.
export const probeMirrorHosts = async ({
    hosts,
    probeUrl,
    fetchImpl,
    now = () => Date.now(),
    perTimeoutMs = MIRROR_PROBE_TIMEOUT,
    budgetMs = MIRROR_PROBE_BUDGET_MS,
    concurrency = MIRROR_PROBE_CONCURRENCY,
    valid = null
}) => {
    if (!fetchImpl || !hosts.length)
        return [];
    const results = [];
    const start = now();
    let next = 0;
    const worker = async () => {
        let running = true;
        while (running) {
            if (now() - start >= budgetMs)
                break;
            const idx = next++;
            if (idx >= hosts.length)
                break;
            const host = hosts[idx];
            const t0 = now();
            let ok = false;
            try {
                const res = await fetchWithTimeout(fetchImpl, buildMirrorUrl(host, probeUrl), perTimeoutMs);
                ok = !!(res && res.ok);
                if (ok && valid) {
                    try {
                        ok = !!(await valid(res));
                    } catch (_) {
                        ok = false;
                    }
                }
            } catch (_) {
                ok = false;
            }
            if (ok)
                results.push({ host, latency: now() - t0 });
        }
    };
    const workers = Array.from({ length: Math.min(concurrency, hosts.length) }, worker);
    await Promise.all(workers);
    results.sort((a, b) => a.latency - b.latency);
    return results.slice(0, MIRROR_MAX_CANDIDATES);
};

// Fetch the current node list + speed-test it, persist the top-5. Returns
// the candidate hosts or null when the node list could not be obtained.
export const refreshGithubMirrors = async ({
    storage,
    fetchImpl,
    now = () => Date.now(),
    probeUrl,
    probeValid = null
}) => {
    const hosts = await fetchAkamsMirrorHosts({ fetchImpl });
    if (!hosts.length)
        return null;
    const probed = await probeMirrorHosts({ hosts, probeUrl, fetchImpl, now, valid: probeValid });
    const nodes = probed.slice(0, MIRROR_MAX_CANDIDATES);
    if (nodes.length < MIRROR_MAX_CANDIDATES) {
        for (const host of BUILTIN_MIRRORS) {
            if (nodes.length >= MIRROR_MAX_CANDIDATES)
                break;
            if (!nodes.some(n => n.host === host))
                nodes.push({ host, latency: null });
        }
    }
    const ts = now();
    await writeMirrorCache(storage, {
        v: MIRROR_VERSION,
        ts,
        refreshedAt: ts,
        nodes,
        down: {}
    });
    return nodes.map(n => n.host);
};

// The mirror layer's gatekeeper. It returns a usable host list, refreshing
// the node list ONLY when the fetch chain already needs the mirrors AND the
// cache is absent / exhausted / older than TTL; refresh attempts themselves
// are rate-limited by MIRROR_REFRESH_COOLDOWN_MS so a broken mirror site
// cannot turn into a per-popup-open fetch storm.
export const ensureGithubMirrorHosts = async ({
    storage,
    fetchImpl,
    now = () => Date.now(),
    probeUrl,
    probeValid = null
}) => {
    const nowMs = now();
    const cache = await readMirrorCache(storage);
    const usable = cache ? usableMirrorHosts(cache, nowMs) : [];
    const refreshAllowed = !cache
        || nowMs - (cache.refreshedAt || 0) >= MIRROR_REFRESH_COOLDOWN_MS;
    const needRefresh = !cache
        || usable.length === 0
        || nowMs - cache.ts >= MIRROR_TTL_MS;

    if (needRefresh && refreshAllowed) {
        const hosts = await refreshGithubMirrors({ storage, fetchImpl, now, probeUrl, probeValid });
        if (hosts && hosts.length)
            return hosts;
        if (cache) {
            await writeMirrorCache(storage, { ...cache, refreshedAt: nowMs });
        } else {
            await writeMirrorCache(storage, {
                v: MIRROR_VERSION,
                ts: nowMs,
                refreshedAt: nowMs,
                nodes: BUILTIN_MIRRORS.map(host => ({ host, latency: null })),
                down: {}
            });
            return [...BUILTIN_MIRRORS];
        }
    }
    if (cache && usable.length)
        return usable;
    if (cache)
        return [];
    return [...BUILTIN_MIRRORS];
};
