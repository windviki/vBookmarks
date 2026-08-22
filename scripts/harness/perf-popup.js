// vBookmarks performance probe — docs/build-and-performance-plan.md §3.7
// Runs inside zenika/alpine-chrome:with-puppeteer with the extension at /ext
// (source root, or the built dist/ tree when launched via run.sh --dist).
//
//   Phase 0  seed: 3000+ bookmarks (deep nesting) under an OPEN folder,
//            50+ browser tabs (a few grouped), stored view state so the
//            popup cold-opens straight into the big tree render.
//   Phase 1  popup cold open ×10 (CDP Performance domain: Scripting /
//            Rendering / Painting + LayoutCount).
//   Phase 2  tree rebuild ×10 (create a bookmark → poll for its row →
//            remove; the tree view re-renders the whole tree on the event).
//   Phase 3  SW cold start ×10 (ServiceWorker.stopAllWorkers → respawn wall
//            time + first-script duration).
//
// Output: a per-run table + median row, and /tmp/shots/perf/perf.json for
// the plan's appendix A backfill. All timings are RELATIVE comparisons
// (source vs dist, before vs after) — headless absolutes are not gospel.
const puppeteer = require('puppeteer');
const fs = require('fs');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RUNS = 10;
const SEED_BOOKMARKS = 3000;
const SEED_TABS = 50;

const median = arr => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const launch = () => puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
    headless: 'new',
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
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(1200); // absorb async init (same convention as smoke.js)
    return page;
};

(async () => {
    fs.mkdirSync('/tmp/shots/perf', { recursive: true });
    const out = { mode: process.env.VBM_PERF_MODE || 'source', runs: RUNS, seeded: {} };

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
        const seed = await seedPage.evaluate(async (count) => {
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await new Promise(res =>
                chrome.bookmarks.create({ parentId: bar.id, title: '__perf__' }, res));
            // deep nesting: 100 subfolders × 30 bookmarks each = 3000 leaves
            const subIds = [];
            for (let f = 0; f < 100; f++) {
                const sub = await new Promise(res =>
                    chrome.bookmarks.create({ parentId: folder.id, title: `d${f}` }, res));
                subIds.push(sub.id);
                const batch = [];
                for (let i = 0; i < count / 100; i++) {
                    batch.push(new Promise(res =>
                        chrome.bookmarks.create({
                            parentId: sub.id,
                            title: `bm ${f}-${i}`,
                            url: `http://127.0.0.1:9/${f}/${i}`
                        }, res)));
                }
                await Promise.all(batch);
            }
            // Open bar + seed folder + every subfolder so the next popup
            // cold-open renders the FULL 3000-leaf tree (that is the big
            // render both cold-open and tree-rebuild are measuring). Write
            // both areas — local seeds migrate into sync-owned keys on load.
            const opens = [bar.id, folder.id, ...subIds];
            const payload = { opens: JSON.stringify(opens) };
            await new Promise(res => chrome.storage.local.set(payload, res));
            await new Promise(res => chrome.storage.sync.set(payload, res));
            return { folderId: folder.id, barId: bar.id };
        }, SEED_BOOKMARKS);
        out.seeded = seed;
        console.log('seeded:', JSON.stringify(seed));

        // 50 tabs (about:blank is offline-safe), then group the first 10
        const tabPages = [];
        for (let i = 0; i < SEED_TABS; i++)
            tabPages.push(await browser.newPage());
        await sleep(500);
        const grouped = await seedPage.evaluate(() => new Promise(res => {
            chrome.tabs.query({}, tabs => {
                const ids = tabs.filter(t => t.url && t.url.startsWith('about:blank')).slice(0, 10).map(t => t.id);
                if (!ids.length || !chrome.tabGroups) {
                    res(0);
                    return;
                }
                chrome.tabGroups.group({ tabIds: ids, createProperties: { title: 'perf', color: 'blue' } }, g => res(ids.length));
            });
        }));
        out.seeded.groupedTabs = grouped;
        console.log('grouped tabs:', grouped);
        seedPage.close();

        // --- Phase 1: popup cold open ×10 -------------------------------------
        const cold = [];
        for (let i = 0; i < RUNS; i++) {
            const p = await browser.newPage();
            const cdp = await p.target().createCDPSession();
            await cdp.send('Performance.enable');
            await p.setViewport({ width: 400, height: 620 });
            await p.evaluateOnNewDocument(() => { window.close = () => {}; });
            const t0 = Date.now();
            await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
            await sleep(600);
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
        console.log('\n== popup cold open (ms) ==');
        console.log('run | wall | scripting | rendering | painting | layouts');
        cold.forEach((r, i) =>
            console.log(`${i + 1}   | ${r.wallMs} | ${r.scriptingMs} | ${r.renderingMs} | ${r.paintingMs} | ${r.layoutCount}`));
        const med = k => median(cold.map(r => r[k]));
        console.log(`med | ${med('wallMs')} | ${med('scriptingMs')} | ${med('renderingMs')} | ${med('paintingMs')} | ${med('layoutCount')}`);

        // --- Phase 2: tree rebuild ×10 ----------------------------------------
        const warm = await openPopup(browser, extId);
        const rebuilds = [];
        const perfFolderId = out.seeded.folderId;
        for (let i = 0; i < RUNS; i++) {
            const ms = await warm.evaluate((folderId) => new Promise(res => {
                chrome.bookmarks.create({
                    parentId: folderId,
                    title: '__perf_tmp__',
                    url: 'http://127.0.0.1:9/perf'
                }, node => {
                    const t0 = performance.now();
                    const poll = () => {
                        if (document.getElementById(`neat-tree-item-${node.id}`))
                            chrome.bookmarks.remove(node.id, () => res(performance.now() - t0));
                        else
                            setTimeout(poll, 16);
                    };
                    poll();
                });
            }), perfFolderId).catch(() => -1);
            rebuilds.push(ms);
        }
        out.treeRebuildMs = rebuilds;
        console.log('\n== tree rebuild (create→row visible, ms) ==');
        console.log(rebuilds.map((r, i) => `${i + 1}: ${r}`).join('  '));
        console.log('median:', median(rebuilds.filter(r => r >= 0)));
        warm.close();

        // --- Phase 3: SW cold start ×10 ---------------------------------------
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
                // wait for respawn
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

        fs.writeFileSync('/tmp/shots/perf/perf.json', JSON.stringify(out, null, 2));
        console.log('\nperf.json written to /tmp/shots/perf/perf.json');
    } finally {
        await browser.close();
    }
})().catch(e => {
    console.error('PERF FAILED:', e && e.stack || e);
    process.exit(1);
});
