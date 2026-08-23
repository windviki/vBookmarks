// 4.1.x perf diagnosis — function-level CPU profiles for the two reported
// hot spots (tab-groups view open lag at heavy tab/group counts; dupes
// regroup at 6000 bookmarks / ~2500 rows), on top of the perf-popup.js
// conventions (seed + settle + CDP Performance metrics) but adding the
// CDP Profiler domain so the fix lands on measured offenders, not guesses.
//
//   scripts/harness/rerun.sh diag/diag-41x-perf.js
//
// Env knobs (all optional):
//   VBM_PERF_BOOKMARKS     total bookmarks seeded (default 6000)
//   VBM_PERF_DUP_RATIO     duplicate-copy ratio (default 0.25)
//   VBM_DUP_COPIES         extra copies per dup group (default 3; 1 = 2-item
//                          groups — the maintainer's 2500+ groups @6000)
//   VBM_TG_WINDOWS         browser windows in the tab-groups workload (default 4)
//   VBM_TG_GROUPS_PER_WIN  tab groups per window (default 40)
//   VBM_TG_TABS_PER_GROUP  tabs inside each group (default 6)
//   VBM_TG_LOOSE           ungrouped tabs per window (default 60)
//   VBM_DIAG_SKIP_TG=1     skip the tab-groups phases
//   VBM_DIAG_SKIP_DUPES=1  skip the dupes phases
//   VBM_DIAG_VIRTUAL=1     seed virtualScrollLab=1 (the LAB virtual painter
//                          instead of chunked streaming)
//
// Phases:
//   A  seed bookmarks (perf-popup.js Phase 0 recipe) + close seed page
//   B  build the tab workload: REAL windows/tabs/tab-groups via
//      chrome.windows.create / chrome.tabs.create / chrome.tabs.group +
//      chrome.tabGroups.update (headless supports all of these — the
//      screenshots/shots-tabgroups-view.js suite has used them since 4.1.0)
//   C  tab-groups ACTIVATION: fresh popup, in-page chrome.* timing wrappers
//      + MutationObserver on the list, Profiler running; click the view tab;
//      wait until the row count is stable; report wall + per-call timings +
//      top self-time functions
//   D  tab-groups RE-RENDER: same page, click the toolbar refresh button
//      under the Profiler — the "every 300 ms while the view is open" cost
//   E  dupes REGROUP: fresh popup, activate dupes, Profiler around the
//      onCreated-triggered recompute (dupesLastResult.ts gate), top functions
const puppeteer = require('puppeteer');
const fs = require('fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEED_BOOKMARKS = Math.max(100, parseInt(process.env.VBM_PERF_BOOKMARKS || '6000', 10));
const DUP_RATIO = Math.min(0.9, Math.max(0, parseFloat(process.env.VBM_PERF_DUP_RATIO || '0.25')));
const DUP_COPIES = Math.min(6, Math.max(1, parseInt(process.env.VBM_DUP_COPIES || '3', 10)));
const TG_WINDOWS = parseInt(process.env.VBM_TG_WINDOWS || '4', 10);
const TG_GROUPS_PER_WIN = parseInt(process.env.VBM_TG_GROUPS_PER_WIN || '40', 10);
const TG_TABS_PER_GROUP = parseInt(process.env.VBM_TG_TABS_PER_GROUP || '6', 10);
const TG_LOOSE = parseInt(process.env.VBM_TG_LOOSE || '60', 10);
const SETTLE_MS = 3000;

// Aggregate a CDP Profiler profile into self-time per function.
const summarizeProfile = (profile, topN = 28) => {
    if (!profile)
        return [];
    const totalHits = profile.nodes.reduce((n, node) => n + (node.hitCount || 0), 0);
    if (!totalHits)
        return [];
    const span = profile.endTime - profile.startTime || 1;
    const byFn = new Map();
    for (const node of profile.nodes) {
        const cf = node.callFrame;
        if (!node.hitCount)
            continue;
        const url = (cf.url || '').replace(/^chrome-extension:\/\/[a-p]{32}/, '');
        const name = cf.functionName || '(anonymous)';
        const key = `${name} @ ${url}${cf.lineNumber >= 0 ? ':' + (cf.lineNumber + 1) : ''}`;
        byFn.set(key, (byFn.get(key) || 0) + node.hitCount);
    }
    return [...byFn.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([key, hits]) => ({
            fn: key,
            selfMs: +(hits / totalHits * span / 1000).toFixed(1),
            pct: +(hits / totalHits * 100).toFixed(1)
        }));
};

const launch = () => puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
    headless: 'new',
    protocolTimeout: 600000, // the 1200-tab workload build is ONE long evaluate
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
    page.setDefaultTimeout(180000);
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load', timeout: 180000 });
    await sleep(1200);
    return page;
};

// In-page instrumentation installed BEFORE the measured action:
//  - wrap the three chrome calls the tab-groups refresh chain makes
//  - MutationObserver timestamps on the view's list
const INSTALL_WRAP = (listId) => {
    window.__vbmDiag = { calls: [], mutations: [] };
    const log = (name, ms, extra) => window.__vbmDiag.calls.push({ name, ms, extra });
    const wrap2 = (obj, method, name) => {
        if (!obj || typeof obj[method] !== 'function')
            return;
        const orig = obj[method].bind(obj);
        obj[method] = (...args) => {
            const cb = args[args.length - 1];
            const t0 = performance.now();
            if (typeof cb !== 'function') {
                const r = orig(...args);
                log(name, performance.now() - t0, 'sync');
                return r;
            }
            return orig(...args.slice(0, -1), (...r) => {
                log(name, performance.now() - t0);
                cb(...r);
            });
        };
    };
    wrap2(chrome.windows, 'getAll', 'windows.getAll');
    wrap2(chrome.tabGroups, 'query', 'tabGroups.query');
    wrap2(chrome.bookmarks, 'getTree', 'bookmarks.getTree');
    wrap2(chrome.tabs, 'query', 'tabs.query');
    const list = document.getElementById(listId);
    if (list) {
        const mo = new MutationObserver(mrs => {
            const now = performance.now();
            for (const m of mrs)
                window.__vbmDiag.mutations.push({
                    t: now,
                    nodes: m.addedNodes.length
                });
        });
        mo.observe(list, { childList: true, subtree: true });
        window.__vbmDiag.t0 = performance.now();
    }
};

(async () => {
    const outDir = '/tmp/shots/perf';
    fs.mkdirSync(outDir, { recursive: true });
    const out = { profile: { bookmarks: SEED_BOOKMARKS, dupRatio: DUP_RATIO, dupCopies: DUP_COPIES, tg: { windows: TG_WINDOWS, groupsPerWin: TG_GROUPS_PER_WIN, tabsPerGroup: TG_TABS_PER_GROUP, loose: TG_LOOSE } } };
    const browser = await launch();
    try {
        await sleep(2000);
        const swTarget = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        if (!swTarget)
            throw new Error('extension service worker not found');
        const extId = new URL(swTarget.url()).hostname;
        console.log('extension id:', extId);

        // --- Phase A: seed bookmarks (perf-popup.js recipe) -------------------
        const seedPage = await openPopup(browser, extId);
        const seed = await seedPage.evaluate(async (opts) => {
            const getTree = () => new Promise(res => chrome.bookmarks.getTree(res));
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await getTree();
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__perf__' });
            const L1 = 20, L2 = 5, L3 = 3;
            const dupGroups = Math.round(opts.count * opts.dupRatio / opts.copies);
            const leavesTarget = Math.max(L1 * L2 * L3, opts.count - dupGroups * opts.copies);
            const perL3 = Math.max(1, Math.round(leavesTarget / (L1 * L2 * L3)));
            const openIds = [folder.id];
            const l1Ids = [];
            for (let i = 0; i < L1; i++)
                l1Ids.push(await create({ parentId: folder.id, title: `L1-${i}` }));
            const l2Ids = [], l3Ids = [];
            let seq = 0;
            const originals = [];
            for (let i = 0; i < L1; i++) {
                const l1 = l1Ids[i];
                const l2s = [];
                for (let j = 0; j < L2; j++) {
                    const l2 = await create({ parentId: l1.id, title: `L1-${i}/L2-${j}` });
                    l2Ids.push(l2); l2s.push(l2);
                }
                for (let j = 0; j < L2; j++)
                    for (let k = 0; k < L3; k++) {
                        const l3 = await create({ parentId: l2s[j].id, title: `L1-${i}/L2-${j}/L3-${k}` });
                        l3Ids.push(l3); openIds.push(l3.id);
                    }
                openIds.push(l1.id);
                for (const l2 of l2s) openIds.push(l2.id);
            }
            for (let i = 0; i < l3Ids.length; i++) {
                const batch = [];
                for (let b = 0; b < perL3; b++) {
                    const url = `http://127.0.0.1:9/u/${++seq}`;
                    batch.push(create({ parentId: l3Ids[i].id, title: `bm ${seq}`, url }).then(n => originals.push({ id: n.id, url })));
                }
                await Promise.all(batch);
            }
            const dupsFolder = await create({ parentId: folder.id, title: '__perf_dups__' });
            openIds.push(dupsFolder.id);
            let dupCopies = 0;
            // Copies land at different depths (cross-level duplicates): the
            // pool cycles L2 → L1 → dups-root → L2 …, copies > 3 reuse the
            // depths with the (g % copies) offset so URLs still spread.
            const copyParents = (g, c) => {
                const pool = [l2Ids[g % l2Ids.length].id, l1Ids[g % l1Ids.length].id, dupsFolder.id];
                return pool[(g + c) % pool.length];
            };
            for (let g = 0; g < Math.min(dupGroups, originals.length); g++) {
                const origin = originals[g];
                for (let c = 0; c < opts.copies; c++) {
                    await create({ parentId: copyParents(g, c), title: origin.title, url: origin.url });
                    dupCopies++;
                }
            }
            const payload = { opens: JSON.stringify(openIds) };
            if (opts.virtual)
                payload.virtualScrollLab = '1';
            await new Promise(res => chrome.storage.local.set(payload, res));
            await new Promise(res => chrome.storage.sync.set(payload, res));
            return { total: seq + dupCopies, dupGroups: Math.min(dupGroups, originals.length), copies: opts.copies, virtual: !!opts.virtual };
        }, { count: SEED_BOOKMARKS, dupRatio: DUP_RATIO, copies: DUP_COPIES, virtual: !!process.env.VBM_DIAG_VIRTUAL });
        console.log('seeded:', JSON.stringify(seed));
        await seedPage.close().catch(() => {});

        // --- Phase B: tab workload (real windows/tabs/groups) -----------------
        const totalTabs = TG_WINDOWS * (TG_GROUPS_PER_WIN * TG_TABS_PER_GROUP + TG_LOOSE);
        console.log(`stage: building tab workload — ${TG_WINDOWS} windows × (${TG_GROUPS_PER_WIN} groups × ${TG_TABS_PER_GROUP} + ${TG_LOOSE} loose) = ${totalTabs} tabs`);
        const buildPage = await browser.newPage();
        await buildPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(500);
        const built = await buildPage.evaluate(async (cfg) => {
            const create = (props) => new Promise(res => chrome.tabs.create(props, res));
            const group = (props) => new Promise((res, rej) => chrome.tabs.group(props, r => chrome.runtime.lastError ? rej(new Error(chrome.runtime.lastError.message)) : res(r)));
            const tUpdate = (id, p) => new Promise(res => chrome.tabGroups.update(id, p, res));
            const wCreate = (p) => new Promise(res => chrome.windows.create(p, res));
            const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
            let tabSeq = 0, groupSeq = 0;
            for (let w = 0; w < cfg.windows; w++) {
                const win = await wCreate({ url: 'about:blank', focused: false });
                const winId = win.id;
                const groups = [];
                // groups first (contiguous runs), then loose tabs
                for (let g = 0; g < cfg.groupsPerWin; g++) {
                    const ids = [];
                    for (let t = 0; t < cfg.tabsPerGroup; t++) {
                        const tab = await create({ windowId: winId, url: 'about:blank' });
                        ids.push(tab.id);
                    }
                    try {
                        const gid = await group({ tabIds: ids, createProperties: { windowId: winId } });
                        groups.push(gid);
                        await tUpdate(gid, { title: `组 ${++groupSeq}`, color: colors[groupSeq % colors.length] });
                    } catch (e) {
                        return { error: 'tabGroups unavailable: ' + e.message };
                    }
                }
                for (let l = 0; l < cfg.loose; l++)
                    await create({ windowId: winId, url: 'about:blank' });
                void tabSeq;
            }
            return { ok: true, windows: cfg.windows };
        }, { windows: TG_WINDOWS, groupsPerWin: TG_GROUPS_PER_WIN, tabsPerGroup: TG_TABS_PER_GROUP, loose: TG_LOOSE }).catch(e => ({ error: String(e) }));
        console.log('tab workload:', JSON.stringify(built));
        await buildPage.close().catch(() => {});
        out.tabWorkload = built;
        if (built.error || process.env.VBM_DIAG_SKIP_TG) {
            console.log('tab-groups phases skipped (' +
                (built.error ? 'workload build failed: ' + built.error : 'VBM_DIAG_SKIP_TG') + ')');
        } else {

        // --- Phase C: tab-groups ACTIVATION -----------------------------------
        const tgAct = [];
        for (let run = 0; run < 3; run++) {
            const p = await browser.newPage();
            const cdp = await p.target().createCDPSession();
            await cdp.send('Performance.enable');
            await p.setViewport({ width: 400, height: 620 });
            await p.evaluateOnNewDocument(() => { window.close = () => {}; });
            p.setDefaultTimeout(180000);
            await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
            await sleep(SETTLE_MS);
            await p.evaluate(INSTALL_WRAP, 'tabgroups-list');
            const m1 = (await cdp.send('Performance.getMetrics')).metrics;
            const pick1 = k => (m1.find(x => x.name === k) || { value: 0 }).value;
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 300 }); // 300μs
            await cdp.send('Profiler.start');
            const t0 = Date.now();
            await p.evaluate(() => { const b = document.getElementById('view-tab-tabgroups'); if (b) b.click(); });
            // wait for the row count to go stable (3 equal polls)
            let rows = -1, stable = 0;
            while (stable < 3 && Date.now() - t0 < 60000) {
                await sleep(400);
                const n = await p.evaluate(() => {
                    const l = document.getElementById('tabgroups-list');
                    return l ? l.querySelectorAll('li').length : 0;
                }).catch(() => 0);
                if (n === rows && n > 0) stable++;
                else { stable = 0; rows = n; }
            }
            const wallMs = Date.now() - t0 - 3 * 400; // subtract the stability polls
            const { profile } = await cdp.send('Profiler.stop');
            const m2 = (await cdp.send('Performance.getMetrics')).metrics;
            const pick2 = k => (m2.find(x => x.name === k) || { value: 0 }).value;
            const diag = await p.evaluate(() => window.__vbmDiag);
            tgAct.push({
                wallMs,
                rows,
                scriptingMs: +((pick2('ScriptDuration') - pick1('ScriptDuration')) * 1000).toFixed(1),
                layoutCount: Math.max(0, pick2('LayoutCount') - pick1('LayoutCount')),
                calls: diag.calls,
                firstMutationMs: diag.mutations.length ? +(diag.mutations[0].t - diag.t0).toFixed(1) : null,
                lastMutationMs: diag.mutations.length ? +(diag.mutations[diag.mutations.length - 1].t - diag.t0).toFixed(1) : null
            });
            if (run === 0)
                tgAct[0].topFns = summarizeProfile(profile);
            p.close();
        }
        out.tabgroupsActivate = tgAct;
        console.log('\n== tab-groups ACTIVATION (ms; real windows/tabs/groups) ==');
        for (const r of tgAct) {
            console.log(`wall≈${r.wallMs} | rows=${r.rows} | scripting=${r.scriptingMs} | layouts=${r.layoutCount} | firstDOM=${r.firstMutationMs} lastDOM=${r.lastMutationMs}`);
            console.log('  chrome calls:', r.calls.map(c => `${c.name}=${c.ms.toFixed(1)}ms`).join(' '));
        }
        console.log('top self-time (run 1):');
        for (const f of (tgAct[0].topFns || []))
            console.log(`  ${String(f.selfMs).padStart(8)}ms ${String(f.pct).padStart(5)}%  ${f.fn}`);

        // --- Phase D: tab-groups RE-RENDER (toolbar refresh) -------------------
        const tgRe = [];
        for (let run = 0; run < 3; run++) {
            const p = await browser.newPage();
            const cdp = await p.target().createCDPSession();
            await cdp.send('Performance.enable');
            await p.setViewport({ width: 400, height: 620 });
            await p.evaluateOnNewDocument(() => { window.close = () => {}; });
            p.setDefaultTimeout(180000);
            await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
            await sleep(SETTLE_MS);
            await p.evaluate(() => { const b = document.getElementById('view-tab-tabgroups'); if (b) b.click(); });
            await sleep(2500); // let the activation render finish
            await p.evaluate(INSTALL_WRAP, 'tabgroups-list');
            const m1 = (await cdp.send('Performance.getMetrics')).metrics;
            const pick1 = k => (m1.find(x => x.name === k) || { value: 0 }).value;
            await cdp.send('Profiler.enable');
            await cdp.send('Profiler.setSamplingInterval', { interval: 300 });
            await cdp.send('Profiler.start');
            const t0 = Date.now();
            await p.evaluate(() => {
                const b = document.querySelector('#tabgroups-list .tabgroups-refresh');
                if (b) b.click();
            });
            let rows = -1, stable = 0;
            while (stable < 3 && Date.now() - t0 < 60000) {
                await sleep(400);
                const n = await p.evaluate(() => {
                    const l = document.getElementById('tabgroups-list');
                    return l ? l.querySelectorAll('li').length : 0;
                }).catch(() => 0);
                if (n === rows && n > 0) stable++;
                else { stable = 0; rows = n; }
            }
            const wallMs = Date.now() - t0 - 3 * 400;
            const { profile } = await cdp.send('Profiler.stop');
            const m2 = (await cdp.send('Performance.getMetrics')).metrics;
            const pick2 = k => (m2.find(x => x.name === k) || { value: 0 }).value;
            const diag = await p.evaluate(() => window.__vbmDiag);
            tgRe.push({
                wallMs, rows,
                scriptingMs: +((pick2('ScriptDuration') - pick1('ScriptDuration')) * 1000).toFixed(1),
                layoutCount: Math.max(0, pick2('LayoutCount') - pick1('LayoutCount')),
                calls: diag.calls
            });
            if (run === 0)
                tgRe[0].topFns = summarizeProfile(profile);
            p.close();
        }
        out.tabgroupsRerender = tgRe;
        console.log('\n== tab-groups RE-RENDER (toolbar refresh click) ==');
        for (const r of tgRe) {
            console.log(`wall≈${r.wallMs} | rows=${r.rows} | scripting=${r.scriptingMs} | layouts=${r.layoutCount}`);
            console.log('  chrome calls:', r.calls.map(c => `${c.name}=${c.ms.toFixed(1)}ms`).join(' '));
        }
        console.log('top self-time (run 1):');
        for (const f of (tgRe[0].topFns || []))
            console.log(`  ${String(f.selfMs).padStart(8)}ms ${String(f.pct).padStart(5)}%  ${f.fn}`);
        }

        // --- Phase E: dupes REGROUP --------------------------------------------
        if (!process.env.VBM_DIAG_SKIP_DUPES) {
            const dupes = [];
            for (let run = 0; run < 3; run++) {
                const p = await browser.newPage();
                const cdp = await p.target().createCDPSession();
                await cdp.send('Performance.enable');
                await p.setViewport({ width: 400, height: 620 });
                await p.evaluateOnNewDocument(() => { window.close = () => {}; });
                p.setDefaultTimeout(180000);
                await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
                await sleep(SETTLE_MS);
                await p.evaluate(() => { const b = document.getElementById('view-tab-dupes'); if (b) b.click(); });
                await p.waitForFunction(() => {
                    const l = document.getElementById('dupes-list');
                    return !!l && l.querySelectorAll('li').length > 0;
                }, { timeout: 120000 }).catch(() => {});
                await sleep(600);
                const before = await p.evaluate(() => new Promise(res => {
                    chrome.storage.local.get('dupesLastResult', d => {
                        try { res((JSON.parse(d.dupesLastResult || 'null') || {}).ts || 0); } catch (_) { res(0); }
                    });
                })).catch(() => 0);
                const m1 = (await cdp.send('Performance.getMetrics')).metrics;
                const pick1 = k => (m1.find(x => x.name === k) || { value: 0 }).value;
                await cdp.send('Profiler.enable');
                await cdp.send('Profiler.setSamplingInterval', { interval: 300 });
                await cdp.send('Profiler.start');
                const t0 = Date.now();
                await p.evaluate(() => new Promise(res => {
                    chrome.bookmarks.create({ parentId: '1', title: 'diag-trigger', url: 'http://127.0.0.1:9/diag-' + Date.now() }, () => res());
                }));
                await p.waitForFunction(prevTs => new Promise(res => {
                    chrome.storage.local.get('dupesLastResult', d => {
                        try { const ts = (JSON.parse(d.dupesLastResult || 'null') || {}).ts || 0; res(ts !== prevTs); } catch (_) { res(false); }
                    });
                }), { timeout: 120000, polling: 200 }, before).catch(() => {});
                await sleep(500);
                const wallMs = Date.now() - t0 - 500;
                const { profile } = await cdp.send('Profiler.stop');
                const m2 = (await cdp.send('Performance.getMetrics')).metrics;
                const pick2 = k => (m2.find(x => x.name === k) || { value: 0 }).value;
                const rows = await p.evaluate(() => {
                    const l = document.getElementById('dupes-list');
                    return l ? l.querySelectorAll('li').length : 0;
                }).catch(() => 0);
                dupes.push({
                    wallMs, rows,
                    scriptingMs: +((pick2('ScriptDuration') - pick1('ScriptDuration')) * 1000).toFixed(1),
                    layoutCount: Math.max(0, pick2('LayoutCount') - pick1('LayoutCount'))
                });
                if (run === 0)
                    dupes[0].topFns = summarizeProfile(profile);
                p.close();
            }
            out.dupesRegroup = dupes;
            console.log('\n== dupes REGROUP (onCreated recompute) ==');
            for (const r of dupes)
                console.log(`wall≈${r.wallMs} | rows=${r.rows} | scripting=${r.scriptingMs} | layouts=${r.layoutCount}`);
            console.log('top self-time (run 1):');
            for (const f of (dupes[0].topFns || []))
                console.log(`  ${String(f.selfMs).padStart(8)}ms ${String(f.pct).padStart(5)}%  ${f.fn}`);
        }

        fs.writeFileSync(outDir + '/diag-perf.json', JSON.stringify(out, null, 2));
        console.log('\nwritten to', outDir + '/diag-perf.json');
    } finally {
        await browser.close();
    }
})().catch(e => {
    console.error('DIAG FAILED:', e && e.stack || e);
    process.exit(1);
});
