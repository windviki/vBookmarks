// Axis audit: for every view, the toolbar icon-cluster columns vs the rows'
// trailing hover-icon columns — all must stack (20px boxes, 24px stride,
// last center on the 8px axis).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2000);
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;

        // seed tabs + groups
        const seedPage = await browser.newPage();
        await seedPage.evaluateOnNewDocument(() => { window.close = () => {}; });
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await seedPage.evaluate(async () => {
            const create = p => new Promise(r => chrome.tabs.create(p, r));
            const group = (t, props) => new Promise(r => chrome.tabs.group({ tabIds: [t.id] }, gid =>
                chrome.tabGroups.update(gid, props, () => r(gid))));
            for (let i = 0; i < 3; i++) {
                const t = await create({ url: `http://127.0.0.1:9/tg/${i}`, active: false });
                if (i === 0) await group(t, { title: 'GX', color: 'blue' });
            }
        });
        await sleep(400);
        await seedPage.close();

        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1300);
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const f = await create({ parentId: bar.id, title: 'zzf' });
            const gh = await create({ parentId: f.id, title: 'zzgh', url: 'http://127.0.0.1:9/gh' });
            const dp = await create({ parentId: f.id, title: 'zzdp', url: 'http://127.0.0.1:9/dp' });
            await create({ parentId: bar.id, title: 'zzdup2', url: 'http://127.0.0.1:9/dp' });
            const now = Date.now();
            await new Promise(r => chrome.storage.local.set({
                visitStats: JSON.stringify({ [gh.id]: { c: 5, t: now } }),
                statsEnabled: '1',
                deadLastScan: JSON.stringify({
                    ts: now - 3600e3, scannedCount: 1,
                    results: { [dp.id]: { status: 'dead', code: 404 } }
                }),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        const measure = () => {
            const W = (document.querySelector('.view:not([hidden])') || document.body).getBoundingClientRect().right;
            const centers = els => els.map(el => {
                const r = el.getBoundingClientRect();
                return Math.round(r.left + r.width / 2);
            });
            const cluster = sel => {
                const c = document.querySelector(sel);
                return c ? centers([...c.querySelectorAll('button')]) : null;
            };
            const rowIcons = (rowSel, btnSel) => {
                const row = document.querySelector(rowSel);
                if (!row) return null;
                return centers([...row.querySelectorAll(btnSel)]);
            };
            return { W, cluster, rowIcons };
        };

        const report = {};

        // dead
        await page.click('#view-tab-dead');
        await sleep(1000);
        report.dead = await page.evaluate(() => {
            const W = document.getElementById('dead-list').getBoundingClientRect().right;
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
            const row = document.querySelector('#dead-list ul li.vbm-row');
            return JSON.stringify({
                marksCluster: cx(document.querySelectorAll('.dead-mark-toolbar .dead-icon-cluster button')),
                rowIcons: cx(row.querySelectorAll('.row-btn')),
                rowBtnWs: [...row.querySelectorAll('.row-btn')].map(b => Math.round(b.getBoundingClientRect().width))
            });
        });

        // dupes
        await page.click('#view-tab-dupes');
        await sleep(1600);
        report.dupes = await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
            const cluster = document.querySelector('.dupes-icon-cluster');
            const row = document.querySelector('.dupes-member');
            return JSON.stringify({
                cluster: cx(cluster.querySelectorAll('button')),
                rowIcons: cx(row.querySelectorAll('.row-btn'))
            });
        });

        // stats
        await page.click('#view-tab-stats');
        await sleep(1000);
        report.stats = await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
            const row = document.querySelector('#stats-list ul li.vbm-row');
            return JSON.stringify({
                selectMode: cx(document.querySelectorAll('.stats-select-mode')),
                rowIcons: row ? cx(row.querySelectorAll('.row-btn')) : null
            });
        });

        // tabgroups
        await page.click('#view-tab-tabgroups');
        await sleep(1600);
        report.tabgroups = await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
            const cluster = document.querySelector('.tabgroups-icon-cluster');
            const row = document.querySelector('.tabgroups-row');
            return JSON.stringify({
                cluster: cluster ? cx(cluster.querySelectorAll('button')) : null,
                rowIcons: row ? cx(row.querySelectorAll('.row-btn, .tabgroups-slot, .tabgroups-status-icon')) : null
            });
        });

        // staging/recent
        await page.click('#view-tab-recent');
        await sleep(900);
        report.staging = await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
            const row = document.querySelector('#staging-items li.staging-row');
            const head = document.getElementById('staging-head');
            return JSON.stringify({
                headIcons: cx(head.querySelectorAll('.staging-icon-btn')),
                rowIcons: row ? cx(row.querySelectorAll('.row-btn')) : null
            });
        });

        // search
        await page.click('#view-tab-search');
        await sleep(400);
        await page.type('#search-input', 'zz');
        await sleep(700);
        report.search = await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
            const row = document.querySelector('#results-ul li.vbm-row');
            return JSON.stringify({
                selectMode: cx(document.querySelectorAll('.search-select-mode')),
                rowIcons: row ? cx(row.querySelectorAll('.row-btn')) : null
            });
        });

        // tree
        await page.evaluate(() => document.getElementById('view-tab-tree').click());
        await sleep(600);
        await page.evaluate(() => {
            const span = document.querySelector('#tree span.tree-item-span');
            if (span) span.click();
        });
        await sleep(700);
        report.tree = await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return Math.round(r.left + r.width / 2); });
            const row = document.querySelector('#tree a.tree-item-link:not(.separator-row)');
            return JSON.stringify({
                rowIcons: row ? cx(row.querySelectorAll('.row-btn')) : null
            });
        });

        for (const k of Object.keys(report))
            console.log(k + ':', report[k]);
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
