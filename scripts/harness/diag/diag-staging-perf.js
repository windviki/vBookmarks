// Diagnostic probe (staging view perf round): reproduce the "entering the
// staging view is extremely laggy + a multi-second favicon refresh process".
//
// Seeds a workbench-shaped staging state (id-anchored rows + id=null snapshot
// rows on unique hosts + groups), then measures, per view ENTRY (switch to
// the recent tab):
//   - long tasks (count + ms) inside the popup
//   - DOM mutation timeline inside #staging-list bucketed per 500ms (the
//     favicon refresh churn — img swaps by favicon-fallback/enrich)
//   - CDP Performance metrics (Scripting / Rendering / LayoutCount)
// Also measures a favAll-style batch (N sequential bookmark creates while the
// view is open) to quantify the per-event re-render storm.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const OBSERVER_BOOT = () => {
    window.__vbmDiag = { longTasks: [], t0: performance.now() };
    try {
        new PerformanceObserver(list => {
            for (const e of list.getEntries())
                window.__vbmDiag.longTasks.push({ t: Math.round(e.startTime), ms: Math.round(e.duration) });
        }).observe({ entryTypes: ['longtask'] });
    } catch (_) { /* longtask unsupported — metrics still collected */ }
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext'
        ]
    });
    try {
        await sleep(2000);
        const targets = await browser.targets();
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(swTarget.url()).hostname;
        console.log('extension id:', extId);

        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        await page.evaluateOnNewDocument(OBSERVER_BOOT);
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        // --- Seed: N bookmarks in one folder + a staging state shaped like a
        // real workbench (half anchored, half snapshots, three groups) -------
        const seedInfo = await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__staging_perf__' });
            const anchored = [];
            for (let i = 0; i < 80; i++) {
                const url = `http://127.0.0.1:9/anchored/${i}`;
                const n = await create({ parentId: folder.id, title: `anchored ${i}`, url });
                anchored.push({ id: n.id, url });
            }
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 80; i++)
                items.push({ id: anchored[i].id, url: anchored[i].url, title: `anchored ${i}`, ts: now - i * 1000, group: i < 20 ? 'g_seed_1' : (i < 35 ? 'g_seed_2' : null) });
            for (let i = 0; i < 80; i++)
                items.push({ id: null, url: `http://host${i}.vbm-diag.invalid/snap/${i}`, title: `snapshot ${i}`, ts: now - i * 60000, group: i < 15 ? 'g_seed_3' : null });
            const staging = {
                v: 1,
                items,
                groups: [
                    { id: 'g_seed_1', name: 'Group A', collapsed: false, createdAt: now - 5000 },
                    { id: 'g_seed_2', name: 'Group B', collapsed: true, createdAt: now - 4000 },
                    { id: 'g_seed_3', name: 'Group C', collapsed: false, createdAt: now - 3000, sourceTabGroup: null }
                ],
                recentCollapsed: false,
                unfavCollapsed: false,
                lastSeenTs: now - 3600000
            };
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify(staging),
                activeView: 'tree',
                showRecentBookmarks: '1',
                showTabBadges: '1'
            }, res));
            return { items: items.length, folder: folder.id };
        });
        console.log('seeded:', JSON.stringify(seedInfo));
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        const cdp = await page.target().createCDPSession();
        await cdp.send('Performance.enable');

        const instrumentMutations = () => page.evaluate(() => {
            // disconnect the previous window's observer — overlapping
            // observers double-count the same mutations across entries
            if (window.__vbmObs) window.__vbmObs.disconnect();
            const list = document.getElementById('staging-list');
            window.__vbmMut = { buckets: new Array(16).fill(0), started: performance.now(), total: 0 };
            const bucketOf = () => Math.min(15, Math.floor((performance.now() - window.__vbmMut.started) / 500));
            const obs = new MutationObserver(muts => {
                let n = 0;
                for (const m of muts)
                    n += (m.addedNodes ? m.addedNodes.length : 0) + (m.removedNodes ? m.removedNodes.length : 0) + (m.type === 'attributes' ? 1 : 0);
                if (!n)
                    return;
                window.__vbmMut.total += n;
                window.__vbmMut.buckets[bucketOf()] += n;
            });
            window.__vbmObs = obs;
            obs.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'class'] });
        });

        const readEntryMetrics = async label => {
            const r = await page.evaluate(label => {
                const lt = window.__vbmDiag.longTasks.splice(0);
                const mut = window.__vbmMut ? { total: window.__vbmMut.total, buckets: window.__vbmMut.buckets.slice() } : null;
                return {
                    label,
                    longTasks: lt.length,
                    longTaskMs: lt.reduce((a, b) => a + b.ms, 0),
                    worstLongTask: lt.length ? Math.max(...lt.map(x => x.ms)) : 0,
                    rowImgs: document.querySelectorAll('#staging-list img').length,
                    rows: document.querySelectorAll('#staging-list li').length,
                    mut
                };
            }, label);
            let metrics = null;
            try {
                const m = await cdp.send('Performance.getMetrics');
                const pick = name => { const x = m.metrics.find(v => v.name === name); return x ? x.value : 0; };
                metrics = { scripting: Math.round(pick('ScriptDuration')), layout: pick('LayoutCount'), recalc: pick('RecalcStyleCount') };
            } catch (_) { /* ignore */ }
            console.log(JSON.stringify({ ...r, metrics }));
        };

        const enterStaging = async nth => {
            await instrumentMutations();
            await page.evaluate(() => { window.__vbmDiag.longTasks.length = 0; });
            await page.click('#view-tab-recent');
            await sleep(5000); // watch the favicon refresh process settle
            await readEntryMetrics(`entry-${nth}`);
        };
        const enterTree = async nth => {
            await page.click('#view-tab-tree');
            await sleep(800);
            await readEntryMetrics(`tree-${nth}`);
        };

        await enterStaging(1);
        await enterTree(1);
        await enterStaging(2);

        // --- Batch organize burst: favorite-all style (N sequential creates
        // while the staging view is open) — the per-event render storm probe.
        await page.evaluate(() => {
            window.__vbmDiag.longTasks.length = 0;
            if (window.__vbmObs) window.__vbmObs.disconnect();
            const list = document.getElementById('staging-list');
            window.__vbmMut = { buckets: new Array(16).fill(0), started: performance.now(), total: 0 };
            const obs = new MutationObserver(muts => {
                let n = 0;
                for (const m of muts)
                    n += (m.addedNodes ? m.addedNodes.length : 0) + (m.removedNodes ? m.removedNodes.length : 0);
                window.__vbmMut.total += n;
            });
            window.__vbmObs = obs;
            obs.observe(list, { childList: true, subtree: true });
        });
        const burst = await page.evaluate(() => new Promise(resolve => {
            const t0 = performance.now();
            let i = 0;
            const step = () => {
                if (i >= 30) {
                    resolve({ ms: Math.round(performance.now() - t0) });
                    return;
                }
                chrome.bookmarks.create({ parentId: '1', title: `burst ${i}`, url: `http://127.0.0.1:9/burst/${i}` }, () => {
                    i++;
                    step();
                });
            };
            step();
        }));
        await sleep(500);
        await readEntryMetrics('burst-30-creates');

        const state = await page.evaluate(() => ({
            activeView: window.store ? window.store.get('activeView') : '(no store)',
            stagingItems: window.store ? (JSON.parse(window.store.get('staging') || '{}').items || []).length : -1
        }));
        console.log('final:', JSON.stringify({ burst, state }));
        require('fs').mkdirSync('/tmp/shots', { recursive: true });
        await page.screenshot({ path: '/tmp/shots/diag-staging-perf.png' });
    } finally {
        await browser.close();
    }
})().catch(e => {
    console.error('DIAG FAIL:', e.message);
    process.exit(1);
});
