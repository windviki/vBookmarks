// tree folder expand: staging 500 items vs empty — isolate the staging hook's
// cost on tree rebuilds.
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
            const root = await create({ parentId: bar.id, title: '__treecmp__' });
            let parent = root.id;
            for (let d = 0; d < 20; d++)
                parent = (await create({ parentId: parent, title: 'D' + d })).id;
            for (let i = 0; i < 500; i++) {
                const f = await create({ parentId: i % 2 ? root.id : parent, title: 'F' + i });
                await create({ parentId: f.id, title: 'b' + i, url: 'https://tc.example/' + i });
            }
            return root.id;
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        const clickExpand = () => page.evaluate(() => {
            const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
            const span = spans[3] || spans[0];
            const t0 = performance.now();
            span.click();
            return performance.now() - t0;
        });
        const clickFoldBack = () => page.evaluate(() => {
            const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
            const span = spans.find(s => s.closest('li') && s.closest('li').classList.contains('open')) || spans[0];
            const t0 = performance.now();
            if (span) span.click();
            return performance.now() - t0;
        });

        await page.click('#view-tab-tree');
        await sleep(800);
        console.log('empty-open', JSON.stringify(await clickExpand()));
        console.log('empty-close', JSON.stringify(await clickFoldBack()));

        await page.evaluate(() => {
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 500; i++)
                items.push({ id: null, url: 'https://s500.example/' + i, title: 's' + i, ts: now - i, group: null });
            return new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups: [], recentCollapsed: true, unfavCollapsed: false, lastSeenTs: 0 })
            }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-tree');
        await sleep(800);
        console.log('500-open', JSON.stringify(await clickExpand()));
        console.log('500-close', JSON.stringify(await clickFoldBack()));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
