// vBookmarks performance probe — docs/plan-4.1.0/build-and-performance-plan.md §3.7
// Runs inside zenika/alpine-chrome:with-puppeteer with the extension at /ext
// (source root, or the built dist/ tree when launched via perf-run.sh --dist).
//
// Profile knobs (env, forwarded by perf-run.sh):
//   VBM_PERF_BOOKMARKS   total bookmarks (default 6000 — the maintainer's
//                        real-world scale: deep nesting + cross-level dups)
//   VBM_PERF_DUP_RATIO   duplicate-copy ratio (default 0.25): dupGroups =
//                        round(count * ratio / copies) URLs each get `copies`
//                        extra copies placed at FOUR different depths (L3
//                        originals, L2 copy, L1 copy, dups-root copy) — "many
//                        duplicates that are not on the same level".
//   VBM_DUP_COPIES       copies per dup group (default 3; 1 = 2-item groups,
//                        the maintainer's 2500+ groups at 6000 bookmarks)
//   VBM_PERF_RUNS        popup cold-open runs (default 10)
//   VBM_PERF_DUPES_RUNS  dupes-view activation runs (default 5)
//
//   Phase 0  seed: 6000 bookmarks, ~420 nested folders (L1 20 × L2 5 × L3 3,
//            every folder open so the popup renders the FULL tree), 50 tabs.
//   Phase 1  popup cold open ×N (CDP Performance domain: Scripting /
//            Rendering / Painting + LayoutCount). The full generateTree IS
//            the dominant cost of the cold open.
//   Phase 2  dupes-view activation ×N: click #view-tab-dupes, wait for the
//            first row, record the Scripting delta + wall time + row count —
//            the "6000 bookmarks with many cross-level duplicates" workload.
//   Phase 3  SW cold start ×N (unsupported in this Chromium build; kept for
//            parity with the plan's probe).
//
// Output: per-run tables + median row, and <out>/perf.json for backfill.
// All timings are RELATIVE comparisons (4.0.8 vs current, source vs dist).
const puppeteer = require('puppeteer');
const fs = require('fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RUNS = Math.max(1, parseInt(process.env.VBM_PERF_RUNS || '10', 10));
const DUPES_RUNS = Math.max(1, parseInt(process.env.VBM_PERF_DUPES_RUNS || '5', 10));
const SEED_BOOKMARKS = Math.max(100, parseInt(process.env.VBM_PERF_BOOKMARKS || '6000', 10));
const DUP_RATIO = Math.min(0.9, Math.max(0, parseFloat(process.env.VBM_PERF_DUP_RATIO || '0.25')));
const DUP_COPIES = Math.min(6, Math.max(1, parseInt(process.env.VBM_DUP_COPIES || '3', 10)));
const SEED_TABS = 50;
// Settle beat after popup load BEFORE the measurement window starts: with the
// P1-2 idle queue (master) part of the startup work (announce fetch, favicon
// hydrate, badge preloads) lands after the first render. A fixed settle makes
// the 4.0.8 vs current comparison measure the SAME window in both versions
// (default 3000 ms — enough for the idle callbacks in practice).
const SETTLE_MS = Math.max(0, parseInt(process.env.VBM_PERF_SETTLE_MS || '3000', 10));

const median = arr => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
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
    page.setDefaultTimeout(120000);
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load', timeout: 120000 });
    await sleep(1200); // absorb async init (same convention as smoke.js)
    return page;
};

(async () => {
    const outDir = '/tmp/shots/perf';
    fs.mkdirSync(outDir, { recursive: true });
    const out = {
        mode: process.env.VBM_PERF_MODE || 'source',
        runs: RUNS,
        dupesRuns: DUPES_RUNS,
        profile: { bookmarks: SEED_BOOKMARKS, dupRatio: DUP_RATIO, dupCopies: DUP_COPIES, settleMs: SETTLE_MS },
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

        // --- Phase 0: seed ----------------------------------------------------
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
            const leaves = perL3 * L1 * L2 * L3;

            const openIds = [folder.id];
            const l1Ids = [];
            for (let i = 0; i < L1; i++)
                l1Ids.push(await create({ parentId: folder.id, title: `L1-${i}` }));

            const l2Ids = [];
            const l3Ids = [];
            let seq = 0;
            const originals = [];
            for (let i = 0; i < L1; i++) {
                const l1 = l1Ids[i];
                const l2s = [];
                for (let j = 0; j < L2; j++) {
                    const l2 = await create({ parentId: l1.id, title: `L1-${i}/L2-${j}` });
                    l2Ids.push(l2);
                    l2s.push(l2);
                }
                for (let j = 0; j < L2; j++) {
                    const l2 = l2s[j];
                    for (let k = 0; k < L3; k++) {
                        const l3 = await create({ parentId: l2.id, title: `L1-${i}/L2-${j}/L3-${k}` });
                        l3Ids.push(l3);
                        openIds.push(l3.id);
                    }
                }
                openIds.push(l1.id);
                for (const l2 of l2s)
                    openIds.push(l2.id);
            }

            // Leaves: per-L3 parallel batches.
            for (let i = 0; i < l3Ids.length; i++) {
                const l3 = l3Ids[i];
                const batch = [];
                for (let b = 0; b < perL3; b++) {
                    const url = `http://127.0.0.1:9/u/${++seq}`;
                    batch.push(create({ parentId: l3.id, title: `bm ${seq}`, url }).then(n => {
                        originals.push({ id: n.id, url, parentId: l3.id });
                    }));
                }
                await Promise.all(batch);
            }

            // Cross-level duplicates: `copies` extra copies per dup group at
            // FOUR different depths (L3 original / L2 copy / L1 copy / dups-root).
            const dupsFolder = await create({ parentId: folder.id, title: '__perf_dups__' });
            openIds.push(dupsFolder.id);
            let dupCopies = 0;
            const dupGroupsActual = Math.min(dupGroups, originals.length);
            const copyParents = (g, c) => {
                const pool = [l2Ids[g % l2Ids.length].id, l1Ids[g % l1Ids.length].id, dupsFolder.id];
                return pool[(g + c) % pool.length];
            };
            for (let g = 0; g < dupGroupsActual; g++) {
                const origin = originals[g];
                for (let c = 0; c < opts.copies; c++) {
                    await create({ parentId: copyParents(g, c), title: origin.title, url: origin.url });
                    dupCopies++;
                }
            }

            // Open bar + everything so the cold open renders the FULL tree.
            const payload = { opens: JSON.stringify(openIds) };
            await new Promise(res => chrome.storage.local.set(payload, res));
            await new Promise(res => chrome.storage.sync.set(payload, res));
            return {
                folderId: folder.id,
                barId: bar.id,
                leaves,
                folders: 1 + L1 + L1 * L2 + L1 * L2 * L3 + 1,
                dupGroups: dupGroupsActual,
                dupCopies,
                total: leaves + dupCopies,
                depth: 5 // bar → L1 → L2 → L3 → bookmark
            };
        }, { count: SEED_BOOKMARKS, dupRatio: DUP_RATIO, copies: DUP_COPIES });
        out.seeded = seed;
        console.log('seeded:', JSON.stringify(seed));
        console.log('stage: seed done — closing seed page before tab seeding');

        // Close the heavy seed popup FIRST (6000-row page + 50 new pages in
        // one headless browser is memory pressure that caused protocol hangs).
        await seedPage.close().catch(() => {});
        console.log('stage: opening ' + SEED_TABS + ' blank tabs');
        // 50 tabs (about:blank is offline-safe).
        const tabPages = [];
        for (let i = 0; i < SEED_TABS; i++)
            tabPages.push(await browser.newPage());
        await sleep(3000);

        // --- Phase 1: popup cold open ×RUNS -----------------------------------
        const cold = [];
        for (let i = 0; i < RUNS; i++) {
            const p = await browser.newPage();
            const cdp = await p.target().createCDPSession();
            await cdp.send('Performance.enable');
            await p.setViewport({ width: 400, height: 620 });
            await p.evaluateOnNewDocument(() => { window.close = () => {}; });
            p.setDefaultTimeout(120000);
            const t0 = Date.now();
            console.log('stage: cold run ' + (i + 1) + ' goto');
            await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load', timeout: 120000 });
            console.log('stage: cold run ' + (i + 1) + ' loaded; settle ' + SETTLE_MS + 'ms');
            await sleep(SETTLE_MS);
            const m = (await cdp.send('Performance.getMetrics')).metrics;
            const pick = k => (m.find(x => x.name === k) || { value: 0 }).value;
            cold.push({
                wallMs: Date.now() - t0,
                scriptingMs: +(pick('ScriptDuration') * 1000).toFixed(1),
                renderingMs: +(pick('RenderingDuration') * 1000).toFixed(1),
                paintingMs: +(pick('PaintingDuration') * 1000).toFixed(1),
                layoutCount: pick('LayoutCount')
            });
            p.close();
        }
        out.popupColdOpen = cold;
        console.log('\n== popup cold open (ms; full tree render inside) ==');
        console.log('run | wall | scripting | rendering | painting | layouts');
        cold.forEach((r, i) =>
            console.log(`${i + 1}   | ${r.wallMs} | ${r.scriptingMs} | ${r.renderingMs} | ${r.paintingMs} | ${r.layoutCount}`));
        const med = k => median(cold.map(r => r[k]));
        console.log(`med | ${med('wallMs')} | ${med('scriptingMs')} | ${med('renderingMs')} | ${med('paintingMs')} | ${med('layoutCount')}`);

        // --- Phase 2: dupes regroup ×DUPES_RUNS -----------------------------------
        // The activation itself is NOT the workload: both versions hydrate a
        // dupesLastResult snapshot at startup, so a fresh page can paint the
        // dupes view from cache almost for free. The real user workload is
        // "recompute the duplicate groups" — measured here by firing a
        // bookmarks.onCreated event with the dupes view ACTIVE and timing
        // until refresh() recomputes (signaled by the dupesLastResult ts
        // moving) and repaints.
        const dupes = [];
        for (let i = 0; i < DUPES_RUNS; i++) {
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
            // Make the dupes view active (paint from snapshot; not measured).
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
            // Unique URL — adds one bookmark, fires onCreated, never changes
            // the duplicate-group row count (so runs stay comparable).
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
            await sleep(400); // render settle after saveCache
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
        console.log('\n== dupes regroup on bookmark event (ms; cross-level duplicate workload) ==');
        console.log('run | wall | scripting | layouts | rows');
        dupes.forEach((r, i) =>
            console.log(`${i + 1}   | ${r.wallMs} | ${r.scriptingMs} | ${r.layoutCount} | ${r.rows}`));
        const dmed = k => median(dupes.map(r => r[k]));
        console.log(`med | ${dmed('wallMs')} | ${dmed('scriptingMs')} | ${dmed('layoutCount')} | ${dmed('rows')}`);

        // --- Phase 3: SW cold start ×RUNS (unsupported in this build) ----------
        const swStarts = [];
        let swSupported = true;
        try {
            const bsession = await browser.target().createCDPSession();
            await bsession.send('ServiceWorker.enable');
            for (let i = 0; i < RUNS; i++) {
                const t0 = Date.now();
                await bsession.send('ServiceWorker.stopAllWorkers').catch(() => {
                    throw new Error('stopAllWorkers unsupported');
                });
                let target = null;
                while (Date.now() - t0 < 15000) {
                    const ts = await browser.targets();
                    target = ts.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
                    if (target)
                        break;
                    await sleep(100);
                }
                if (!target) {
                    swStarts.push(-1);
                    continue;
                }
                const sess = await target.createCDPSession();
                await sess.send('Performance.enable');
                await sleep(800);
                const m = (await sess.send('Performance.getMetrics')).metrics;
                const script = (m.find(x => x.name === 'ScriptDuration') || { value: 0 }).value * 1000;
                swStarts.push({ wallMs: Date.now() - t0, scriptMs: +script.toFixed(1) });
                await sleep(300);
            }
        } catch (e) {
            swSupported = false;
            console.log('SW cold-start measurement unsupported:', e.message);
        }
        if (swSupported) {
            out.swColdStart = swStarts;
            console.log('\n== SW cold start (stop→respawn, ms) ==');
            swStarts.forEach((r, i) => console.log(`${i + 1}: wall ${r.wallMs} script ${r.scriptMs}`));
            console.log('median wall:', median(swStarts.map(r => r.wallMs)));
        }

        fs.writeFileSync(outDir + '/perf.json', JSON.stringify(out, null, 2));
        console.log('\nperf.json written to ' + outDir + '/perf.json');
    } finally {
        await browser.close();
    }
})().catch(e => {
    console.error('PERF FAILED:', e && e.stack || e);
    process.exit(1);
});
