// Real-user-data performance probe — perf-popup.js's measurement phases over
// the MAINTAINER'S REAL profile export instead of the synthetic seed.
//   /work/seed/favorites-user.html   Netscape bookmark export (the real tree)
//   /work/seed/settings-user.json    settings export (local+sync, with icons)
// Seeding reuses the diag-408-user recipe (Netscape parse → chunked
// chrome.bookmarks.create → id-remapped storage import); measurement reuses
// perf-popup.js's contract (CDP Performance metrics, the same settle beat,
// the same perf.json schema) so `perf-compare.js` reads both sides directly.
//   Phase 1  popup cold open ×N with the FULL real tree expanded (opens =
//            every folder — the full generateTree is the dominant cost);
//   Phase 2  dupes regroup on a bookmarks.onCreated event ×N (the real
//            duplicate population of the export);
//   the 50-blank-tabs beat before Phase 1 matches the synthetic probe.
// Launch via perf-run.sh --probe diag/diag-perf-user.js --seed <dir>.
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RUNS = Math.max(1, parseInt(process.env.VBM_PERF_RUNS || '10', 10));
const DUPES_RUNS = Math.max(1, parseInt(process.env.VBM_PERF_DUPES_RUNS || '5', 10));
const SETTLE_MS = Math.max(0, parseInt(process.env.VBM_PERF_SETTLE_MS || '3000', 10));
const SEED_TABS = 50;
// VBM_PERF_PROFILE=1 → single-run CPU-profile mode: one cold open and one
// dupes trigger, each under the CDP Profiler domain, .cpuprofile JSONs dumped
// next to perf.json for hotspot triage. Skips the full run matrix.
// VBM_PERF_TRACE=1 → capture a DevTools timeline (tracing) around the cold
// open and dump trace.json — stage attribution (ParseHTML / RecalculateStyles
// / Layout / Scripting) for the wall-vs-scripting gap. TRACE implies the
// single-run shape of PROFILE.
// VBM_PERF_VIRTUAL=1 → seed virtualScrollLab='1' (the LAB virtual painter,
// tabgroups+dupes views) so both painter modes can be A/B'd on the same data.
const PROFILE = process.env.VBM_PERF_PROFILE === '1' || process.env.VBM_PERF_TRACE === '1';
const TRACE = process.env.VBM_PERF_TRACE === '1';

const SETTINGS_PATH = '/work/seed/settings-user.json';
const FAV_PATH = '/work/seed/favorites-user.html';
if (!fs.existsSync(SETTINGS_PATH) || !fs.existsSync(FAV_PATH)) {
    console.error('seed files missing — pass --seed <dir> with settings-user.json + favorites-user.html');
    process.exit(2);
}
const SETTINGS = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
const FAV_HTML = fs.readFileSync(FAV_PATH, 'utf8');

// --- Netscape bookmark HTML → flat DFS list (the diag-408-user parser) -----
const decodeEntities = s => s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const stripTags = s => s.replace(/<[^>]*>/g, '');

function parseNetscape(html) {
    const out = [];
    let depth = 0;
    const re = /<DT><H3(?:\s[^>]*)?>([\s\S]*?)<\/H3>|<DT><A\s+HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<(\/DL)>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1] !== undefined) {
            const title = decodeEntities(stripTags(m[1])).trim();
            out.push({ type: 'folder', title: title || '(empty)', depth });
            depth++;
        } else if (m[2] !== undefined) {
            out.push({ type: 'url', url: m[2], title: decodeEntities(stripTags(m[3])).trim(), depth });
        } else {
            depth = Math.max(0, depth - 1);
        }
    }
    return out;
}
const items = parseNetscape(FAV_HTML);
const urlCount = items.filter(i => i.type === 'url').length;
const folderCount = items.filter(i => i.type === 'folder').length;
console.log('parsed', items.length, 'entries;', urlCount, 'urls;', folderCount, 'folders');

// --- id remap helpers (diag-408-user) ---------------------------------------
const remapDeadLastScan = (raw, idMap) => {
    try {
        const scan = JSON.parse(raw || '{}');
        if (!scan.results) return raw;
        const results = {};
        const entries = Object.entries(scan.results);
        const n = Math.min(entries.length, idMap.oldToNew.length);
        for (let i = 0; i < n; i++)
            results[idMap.oldToNew[i]] = entries[i][1];
        scan.results = results;
        return JSON.stringify(scan);
    } catch (_) { return raw; }
};
const remapIdList = (raw, idMap) => {
    try {
        const arr = JSON.parse(raw || '[]');
        return JSON.stringify(arr.filter(id => idMap.map[id]));
    } catch (_) { return raw; }
};
const remapIdTimeMap = (raw, idMap) => {
    try {
        const obj = JSON.parse(raw || '{}');
        const out = {};
        for (const [id, t] of Object.entries(obj))
            if (idMap.map[id]) out[idMap.map[id]] = t;
        return JSON.stringify(out);
    } catch (_) { return raw; }
};
const remapVisitStats = (raw, idMap) => {
    try {
        const obj = JSON.parse(raw || '{}');
        const out = {};
        for (const [id, v] of Object.entries(obj))
            if (idMap.map[id]) out[idMap.map[id]] = v;
        return JSON.stringify(out);
    } catch (_) { return raw; }
};

const median = arr => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const launch = () => puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
    headless: 'new',
    protocolTimeout: 600000,
    args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--load-extension=/ext',
        '--disable-extensions-except=/ext'
    ]
});

const openPopup = async (browser, extId) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 620 });
    await page.evaluateOnNewDocument(() => { window.close = () => {}; });
    page.setDefaultTimeout(120000);
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load', timeout: 120000 });
    await sleep(1200);
    return page;
};

// Longtask instrumentation: main-thread busy time is the user-felt metric
// (jank), immune to idle settle time and frame-spreading — wall alone read
// a cv:auto frame-spread as a REGRESSION while the busy total had dropped.
// Installed per measurement page; read back after the settle beat.
const installLongtasks = p => p.evaluateOnNewDocument(() => {
    window.__lt = { entries: [] };
    try {
        new PerformanceObserver(list => {
            for (const e of list.getEntries())
                window.__lt.entries.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
        }).observe({ entryTypes: ['longtask'] });
    } catch (_) { /* longtask unsupported — totals stay empty */ }
});
const readLongtasks = p => p.evaluate(() => {
    const e = (window.__lt && window.__lt.entries) || [];
    return {
        count: e.length,
        totalMs: e.reduce((a, x) => a + x.dur, 0),
        maxMs: e.reduce((a, x) => Math.max(a, x.dur), 0)
    };
}).catch(() => ({ count: 0, totalMs: 0, maxMs: 0 }));

(async () => {
    const outDir = '/tmp/shots/perf';
    fs.mkdirSync(outDir, { recursive: true });
    const out = {
        mode: (process.env.VBM_PERF_MODE || 'source') + '-userdata',
        runs: RUNS,
        dupesRuns: DUPES_RUNS,
        profile: { source: 'user-favorites', urls: urlCount, folders: folderCount, settleMs: SETTLE_MS },
        seeded: {}
    };

    const browser = await launch();
    try {
        await sleep(2000);
        const targets = await browser.targets();
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        if (!swTarget)
            throw new Error('extension service worker not found');
        const extId = new URL(swTarget.url()).hostname;
        console.log('extension id:', extId);

        // --- Phase 0: seed the real tree + settings ---------------------------
        const seedPage = await openPopup(browser, extId);
        const seed = await seedPage.evaluate(async entries => {
            const create = props => new Promise((resolve, reject) => {
                chrome.bookmarks.create(props, r => {
                    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                    else resolve(r);
                });
            });
            const stack = ['1']; // root → current folder per depth
            const createdIds = [];
            const folderIds = [];
            let maxDepth = 0;
            const CHUNK = 40;
            const pending = [];
            const flush = async () => {
                for (let i = 0; i < pending.length; i += CHUNK) {
                    const batch = pending.slice(i, i + CHUNK);
                    await Promise.all(batch.map(fn => fn()));
                }
                pending.length = 0;
            };
            for (const e of entries) {
                const parentId = stack[e.depth];
                if (e.type === 'folder') {
                    pending.push(async () => {
                        const n = await create({ parentId, title: e.title });
                        stack[e.depth + 1] = n.id;
                        folderIds.push(n.id);
                        maxDepth = Math.max(maxDepth, e.depth + 1);
                    });
                } else {
                    pending.push(async () => {
                        const n = await create({ parentId, title: e.title || e.url, url: e.url });
                        createdIds.push(n.id);
                    });
                }
                if (pending.length >= CHUNK) await flush();
            }
            await flush();
            // Expand EVERY folder for the measurement window (same full-tree
            // render workload philosophy as the synthetic probe — the full
            // generateTree is the cold open's dominant cost). The settings
            // import below must carry THIS value through, not the export's.
            const opensJson = JSON.stringify(folderIds);
            const payload = { opens: opensJson };
            await new Promise(res => chrome.storage.local.set(payload, res));
            await new Promise(res => chrome.storage.sync.set(payload, res));
            return { urls: createdIds.length, folders: folderIds.length, maxDepth, createdIds, opensJson };
        }, items);
        console.log('seeded:', JSON.stringify({ urls: seed.urls, folders: seed.folders, maxDepth: seed.maxDepth }));
        out.seeded = { urls: seed.urls, folders: seed.folders, maxDepth: seed.maxDepth };

        // settings import (the diag-408-user recipe: strip caches, remap the
        // id-keyed datasets to the re-created tree) + lab switches pinned off
        // so both sides render the classic path.
        const idMap = { map: {}, oldToNew: [] };
        const oldIds = Object.keys(JSON.parse(SETTINGS.local.deadLastScan || '{}').results || {});
        for (let i = 0; i < oldIds.length && i < seed.createdIds.length; i++) {
            idMap.map[oldIds[i]] = seed.createdIds[i];
            idMap.oldToNew.push(seed.createdIds[i]);
        }
        const localSeed = {};
        for (const [k, v] of Object.entries(SETTINGS.local || {})) {
            if (k.startsWith('vbmFavicon') || k.startsWith('vbmAnnounce')) continue;
            if (k === 'opens' || k === 'viewState' || k === 'focusSpot') continue;
            localSeed[k] = v;
        }
        localSeed.deadLastScan = remapDeadLastScan(SETTINGS.local.deadLastScan, idMap);
        localSeed.deadMarks = remapIdList(SETTINGS.local.deadMarks, idMap);
        localSeed.deadMarkTimes = remapIdTimeMap(SETTINGS.local.deadMarkTimes, idMap);
        localSeed.visitStats = remapVisitStats(SETTINGS.local.visitStats, idMap);
        localSeed.opens = seed.opensJson; // the full-expansion set from seeding
        localSeed.viewState = '{}';
        localSeed.focusSpot = '{}';
        localSeed.activeView = 'tree';
        localSeed.faviconEnrich = '';
        localSeed.faviconEnrichAgg = '';
        localSeed.virtualScrollLab = '';
        const syncSeed = { ...(SETTINGS.sync || {}) };
        syncSeed.faviconEnrich = '';
        syncSeed.faviconEnrichAgg = '';
        syncSeed.deadFilter = 'all';
        syncSeed.deadMarkFilter = '';
        syncSeed.virtualScrollLab = '';
        syncSeed.opens = seed.opensJson;
        // A/B knob: measure the cold-open price of the per-row quick-action
        // tails (treeRowActions='0' removes edit/stage/delete from all rows).
        if (process.env.VBM_PERF_NO_TREETAILS === '1') {
            localSeed.treeRowActions = '0';
            syncSeed.treeRowActions = '0';
        }
        // VBM_PERF_VIRTUAL=1: turn the LAB virtual painter ON (tabgroups +
        // dupes lists) — the seed pins it OFF by default so both sides of the
        // A/B stay deterministic.
        if (process.env.VBM_PERF_VIRTUAL === '1') {
            localSeed.virtualScrollLab = '1';
            syncSeed.virtualScrollLab = '1';
        }
        await seedPage.evaluate(([l, s]) => Promise.all([
            new Promise(r => chrome.storage.local.set(l, r)),
            new Promise(r => chrome.storage.sync.set(s, r))
        ]), [localSeed, syncSeed]);
        console.log('storage seeded: local keys', Object.keys(localSeed).length, ', sync keys', Object.keys(syncSeed).length,
            ', remapped scan ids', idMap.oldToNew.length);

        await seedPage.close().catch(() => {});
        console.log('stage: opening ' + SEED_TABS + ' blank tabs');
        const tabPages = [];
        for (let i = 0; i < SEED_TABS; i++)
            tabPages.push(await browser.newPage());
        await sleep(3000);

        // --- Phase 1: popup cold open ×RUNS (identical contract) --------------
        const cold = [];
        for (let i = 0; i < (PROFILE ? 1 : RUNS); i++) {
            const p = await browser.newPage();
            const cdp = await p.target().createCDPSession();
            await cdp.send('Performance.enable');
            await p.setViewport({ width: 400, height: 620 });
            await p.evaluateOnNewDocument(() => { window.close = () => {}; });
            installLongtasks(p);
            p.setDefaultTimeout(120000);
            if (PROFILE)
                await cdp.send('Profiler.enable');
            if (TRACE) {
                await p.tracing.start({
                    path: outDir + '/trace.json',
                    categories: [
                        'devtools.timeline',
                        'disabled-by-default-devtools.timeline',
                        'v8.execute'
                    ]
                });
            }
            const t0 = Date.now();
            console.log('stage: cold run ' + (i + 1) + ' goto');
            if (PROFILE)
                await cdp.send('Profiler.start');
            await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load', timeout: 120000 });
            console.log('stage: cold run ' + (i + 1) + ' loaded; settle ' + SETTLE_MS + 'ms');
            await sleep(SETTLE_MS);
            if (i === 0) {
                const sz = await p.evaluate(() => {
                    const t = document.getElementById('tree');
                    const row = t && t.querySelector('li.child');
                    return {
                        treeHtmlLen: t ? t.innerHTML.length : -1,
                        treeLis: t ? t.getElementsByTagName('li').length : -1,
                        bodyHtmlLen: document.body ? document.body.innerHTML.length : -1,
                        sampleRowLen: row ? row.innerHTML.length : -1,
                        sampleRowHead: row ? row.innerHTML.slice(0, 1500) : ''
                    };
                }).catch(() => null);
                if (sz) {
                    out.treeSize = { treeHtmlLen: sz.treeHtmlLen, treeLis: sz.treeLis, bodyHtmlLen: sz.bodyHtmlLen, sampleRowLen: sz.sampleRowLen };
                    console.log('tree size:', JSON.stringify(out.treeSize));
                    console.log('sample row head:\n' + sz.sampleRowHead);
                }
            }
            if (PROFILE) {
                const prof = (await cdp.send('Profiler.stop')).profile;
                fs.writeFileSync(outDir + '/cold.cpuprofile', JSON.stringify(prof));
                console.log('cold.cpuprofile written');
                // visual evidence for the cv round: top / scrolled-to rows
                await p.screenshot({ path: outDir + '/tree-cv-top.png' });
                await p.evaluate(() => {
                    const t = document.getElementById('tree');
                    if (t)
                        t.scrollTop = 20000;
                });
                await sleep(900);
                await p.screenshot({ path: outDir + '/tree-cv-scrolled.png' });
                const vis = await p.evaluate(() => {
                    const rows = [...document.querySelectorAll('#tree li.child a')];
                    const inView = rows.filter(a => {
                        const r = a.getBoundingClientRect();
                        return r.bottom > 0 && r.top < 620;
                    });
                    return {
                        total: rows.length,
                        inView: inView.length,
                        withIcons: inView.filter(a => {
                            const f = a.querySelector('.favicon-container');
                            return f && f.children.length > 0;
                        }).length
                    };
                }).catch(() => null);
                console.log('scrolled render:', JSON.stringify(vis));
            }
            if (TRACE) {
                await p.tracing.stop();
                console.log('trace.json written');
            }
            const m = (await cdp.send('Performance.getMetrics')).metrics;
            const pick = k => (m.find(x => x.name === k) || { value: 0 }).value;
            const lt = await readLongtasks(p);
            const nav = await p.evaluate(() => {
                const n = (performance.getEntriesByType('navigation') || [])[0] || {};
                return {
                    responseEnd: Math.round(n.responseEnd || 0),
                    dclEnd: Math.round(n.domContentLoadedEventEnd || 0),
                    loadEnd: Math.round(n.loadEventEnd || 0)
                };
            }).catch(() => ({}));
            cold.push({
                wallMs: Date.now() - t0,
                scriptingMs: +(pick('ScriptDuration') * 1000).toFixed(1),
                renderingMs: +(pick('RenderingDuration') * 1000).toFixed(1),
                paintingMs: +(pick('PaintingDuration') * 1000).toFixed(1),
                layoutCount: pick('LayoutCount'),
                busyMs: lt.totalMs,
                longtasks: lt.count,
                maxTaskMs: lt.maxMs,
                responseEnd: nav.responseEnd,
                dclEnd: nav.dclEnd,
                loadEnd: nav.loadEnd
            });
            p.close();
        }
        if (PROFILE) {
            console.log('PROFILE MODE — cold profile captured; one dupes run follows');
        }
        out.popupColdOpen = cold;
        console.log('\n== popup cold open, REAL tree fully expanded (ms) ==');
        console.log('run | wall | scripting | rendering | painting | layouts | busy | longtasks | maxTask | respEnd | dclEnd | loadEnd');
        cold.forEach((r, i) =>
            console.log(`${i + 1}   | ${r.wallMs} | ${r.scriptingMs} | ${r.renderingMs} | ${r.paintingMs} | ${r.layoutCount} | ${r.busyMs} | ${r.longtasks} | ${r.maxTaskMs} | ${r.responseEnd} | ${r.dclEnd} | ${r.loadEnd}`));
        const med = k => median(cold.map(r => r[k]));
        console.log(`med | ${med('wallMs')} | ${med('scriptingMs')} | ${med('renderingMs')} | ${med('paintingMs')} | ${med('layoutCount')} | ${med('busyMs')} | ${med('longtasks')} | ${med('maxTaskMs')} | ${med('responseEnd')} | ${med('dclEnd')} | ${med('loadEnd')}`);

        // --- Phase 2: dupes regroup on bookmark event ×DUPES_RUNS -------------
        const dupes = [];
        for (let i = 0; i < (PROFILE ? 1 : DUPES_RUNS); i++) {
            const p = await browser.newPage();
            const cdp = await p.target().createCDPSession();
            await cdp.send('Performance.enable');
            await p.setViewport({ width: 400, height: 620 });
            await p.evaluateOnNewDocument(() => { window.close = () => {}; });
            p.setDefaultTimeout(120000);
            console.log('stage: dupes run ' + (i + 1) + ' goto');
            await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load', timeout: 120000 });
            console.log('stage: dupes run ' + (i + 1) + ' loaded; settle ' + SETTLE_MS + 'ms');
            await sleep(SETTLE_MS);
            await p.evaluate(() => {
                const b = document.getElementById('view-tab-dupes');
                if (b)
                    b.click();
            }).catch(() => {});
            await p.waitForFunction(() => {
                const list = document.getElementById('dupes-list');
                return !!list && list.querySelectorAll('li').length > 0;
            }, { timeout: 120000 }).catch(() => {});
            await sleep(400);
            const before = await p.evaluate(() => new Promise(res => {
                chrome.storage.local.get('dupesLastResult', d => {
                    try {
                        res((JSON.parse(d.dupesLastResult || 'null') || {}).ts || 0);
                    } catch (_) {
                        res(0);
                    }
                });
            })).catch(() => 0);
            const m1 = (await cdp.send('Performance.getMetrics')).metrics;
            const pick1 = k => (m1.find(x => x.name === k) || { value: 0 }).value;
            const t1 = Date.now();
            if (PROFILE) {
                await cdp.send('Profiler.enable');
                await cdp.send('Profiler.start');
            }
            await p.evaluate(() => new Promise(res => {
                chrome.bookmarks.create({
                    parentId: '1',
                    title: 'perf-trigger',
                    url: 'http://127.0.0.1:9/trigger-' + Date.now()
                }, () => res());
            })).catch(() => {});
            await p.waitForFunction(prevTs => new Promise(res => {
                chrome.storage.local.get('dupesLastResult', d => {
                    try {
                        const ts = (JSON.parse(d.dupesLastResult || 'null') || {}).ts || 0;
                        res(ts !== prevTs);
                    } catch (_) {
                        res(false);
                    }
                });
            }), { timeout: 120000, polling: 200 }, before).catch(() => {});
            await sleep(400);
            if (PROFILE) {
                const prof = (await cdp.send('Profiler.stop')).profile;
                fs.writeFileSync(outDir + '/dupes.cpuprofile', JSON.stringify(prof));
                console.log('dupes.cpuprofile written');
            }
            const m2 = (await cdp.send('Performance.getMetrics')).metrics;
            const pick2 = k => (m2.find(x => x.name === k) || { value: 0 }).value;
            const rows = await p.evaluate(() => {
                const list = document.getElementById('dupes-list');
                return list ? list.querySelectorAll('li').length : 0;
            }).catch(() => 0);
            dupes.push({
                wallMs: Date.now() - t1,
                scriptingMs: +((pick2('ScriptDuration') - pick1('ScriptDuration')) * 1000).toFixed(1),
                layoutCount: Math.max(0, pick2('LayoutCount') - pick1('LayoutCount')),
                rows
            });
            p.close();
        }
        out.dupesActivate = dupes;
        console.log('\n== dupes regroup on bookmark event, REAL duplicates (ms) ==');
        console.log('run | wall | scripting | layouts | rows');
        dupes.forEach((r, i) =>
            console.log(`${i + 1}   | ${r.wallMs} | ${r.scriptingMs} | ${r.layoutCount} | ${r.rows}`));
        const dmed = k => median(dupes.map(r => r[k]));
        console.log(`med | ${dmed('wallMs')} | ${dmed('scriptingMs')} | ${dmed('layoutCount')} | ${dmed('rows')}`);
        if (PROFILE) {
            console.log('PROFILE MODE — done');
        }

        fs.writeFileSync(outDir + '/perf.json', JSON.stringify(out, null, 1));
        console.log('perf.json written to ' + outDir);
    } finally {
        await browser.close().catch(() => {});
    }
})().catch(e => {
    console.error('DIAG FAIL:', e);
    process.exit(2);
});
