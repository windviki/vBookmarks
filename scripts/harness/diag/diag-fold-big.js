// Large-scale fold latency: tree folder expand (2000-node tree), dupes group
// fold (600 dupes), staging group fold (500 items), tabgroups window fold.
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
        const targets = await browser.targets();
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(swTarget.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1500);

        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__big__' });
            let parent = root.id;
            const deep = [];
            for (let d = 0; d < 24; d++) {
                parent = (await create({ parentId: parent, title: 'D' + d })).id;
                deep.push(parent);
            }
            for (let i = 0; i < 600; i++) {
                const f = await create({ parentId: i % 2 ? root.id : parent, title: 'F' + i });
                await create({ parentId: f.id, title: 'b' + i, url: 'https://x.example/' + i });
            }
            // dupes
            for (let i = 0; i < 900; i++) {
                await create({ parentId: root.id, title: 'dupe' + i, url: 'https://dup.example.com/' + (i % 3) });
            }
            // staging 500
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 500; i++) {
                items.push({ id: null, url: 'https://snap.example/' + i, title: 'snap ' + i, ts: now - i, group: null });
            }
            const staging = { v: 1, items, groups: [{ id: 'g1', name: 'Big group', collapsed: false, createdAt: now - 1000, manual: true }], recentCollapsed: true, unfavCollapsed: false, lastSeenTs: 0 };
            for (let i = 0; i < 400; i++) staging.items[i].group = 'g1';
            await new Promise(res => chrome.storage.local.set({ staging: JSON.stringify(staging), activeView: 'tree' }, res));
            return { root: root.id };
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(2000);

        const t = async (label, fn) => {
            const r = await page.evaluate(fn);
            console.log(label, JSON.stringify(r));
        };

        await page.click('#view-tab-tree');
        await sleep(600);
        await t('tree-expand-deep', () => {
            const el = document.querySelector('#tree li a[href=""]') || document.querySelector('#tree li span.tree-item-span');
            const t0 = performance.now();
            (el || document.querySelector('#tree .twisty')).click();
            return new Promise(r => setTimeout(() => r({ ms: Math.round(performance.now() - t0) }), 30));
        });
        await t('tree-folder-expand', () => {
            const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
            const span = spans[2] || spans[0];
            const t0 = performance.now();
            span.click();
            return new Promise(r => setTimeout(() => r({ ms: Math.round(performance.now() - t0) }), 30));
        });
        await page.click('#view-tab-dupes');
        await sleep(1200);
        await t('dupes-group-fold', () => {
            const head = document.querySelector('#dupes-list .dupes-group .group-head');
            const t0 = performance.now();
            head.click();
            return new Promise(r => setTimeout(() => r({ ms: Math.round(performance.now() - t0) }), 30));
        });
        await page.click('#view-tab-recent');
        await sleep(1200);
        await t('staging-group-fold', () => {
            const head = document.querySelector('.staging-group-head');
            const t0 = performance.now();
            head.click();
            return new Promise(r => setTimeout(() => r({ ms: Math.round(performance.now() - t0) }), 30));
        });
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
