// Report round 5 probe: disabling the staging VIEW (showRecentBookmarks)
// must stand down every cross-view staging entry exactly like the staging
// master switch — the tree-row 暂存 plane, the search idle 暂存全部 button
// and the row relays all read api.isEnabled().
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
        await page.setViewport({ width: 900, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        // seed a bookmark so the tree has a row to render
        await page.evaluate(async () => {
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            await new Promise(res => chrome.bookmarks.create(
                { parentId: bar.id, title: 'stage gate probe', url: 'http://127.0.0.1:9/gate-probe' }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1200);

        const before = await page.evaluate(() => {
            const treeRelay = !!document.querySelector('#tree .staging-add-btn');
            return { treeRelay };
        });
        console.log('BEFORE:', JSON.stringify(before));

        // disable the view (the same value options writes for an off switch)
        await page.evaluate(async () => {
            await new Promise(res => chrome.storage.sync.set({ showRecentBookmarks: '' }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1200);

        const after = await page.evaluate(() => {
            const treeRelay = !!document.querySelector('#tree .staging-add-btn');
            const recentTab = !!document.getElementById('view-tab-recent');
            return { treeRelay, recentTab };
        });
        console.log('AFTER:', JSON.stringify(after));

        // search view: the idle 暂存全部 button must be gone too
        await page.evaluate(async () => {
            await new Promise(res => chrome.storage.sync.set({ showRecentBookmarks: '1' }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1200);
        await page.click('#view-tab-search');
        await sleep(600);
        await page.type('#search-input', 'stage gate');
        await sleep(900);
        const searchAfter = await page.evaluate(() => ({
            stageAll: !!document.querySelector('.search-stage-all'),
            resultRows: document.querySelectorAll('#results .vbm-row').length,
            count: document.querySelector('.search-result-count') ? document.querySelector('.search-result-count').textContent : null,
            searchMode: !!document.querySelector('.search-toolbar')
        }));
        console.log('SEARCH-ON:', JSON.stringify(searchAfter));
        await page.evaluate(async () => {
            await new Promise(res => chrome.storage.sync.set({ showRecentBookmarks: '' }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1200);
        await page.click('#view-tab-search');
        await sleep(600);
        await page.type('#search-input', 'stage gate');
        await sleep(900);
        const searchOff = await page.evaluate(() => ({
            stageAll: !!document.querySelector('.search-stage-all'),
            resultRows: document.querySelectorAll('#results .vbm-row').length,
            searchMode: !!document.querySelector('.search-toolbar')
        }));
        console.log('SEARCH-OFF:', JSON.stringify(searchOff));

        const pass = before.treeRelay === true && after.treeRelay === false
            && after.recentTab === false
            && searchAfter.stageAll === true && searchOff.stageAll === false;
        console.log(pass ? 'DIAG PASS' : 'DIAG FAIL');
        if (!pass)
            process.exitCode = 1;

        // the view-tab right-click DISABLE path (disableRecentView) must
        // stand down the same entries
        await page.evaluate(async () => {
            await new Promise(res => chrome.storage.sync.set({ showRecentBookmarks: '1', disableRecentView: '1' }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1200);
        const disableAfter = await page.evaluate(() => ({
            treeRelay: !!document.querySelector('#tree .staging-add-btn'),
            recentTab: !!document.getElementById('view-tab-recent')
        }));
        console.log('DISABLE:', JSON.stringify(disableAfter));
        const disableOk = disableAfter.treeRelay === false && disableAfter.recentTab === false;
        console.log(disableOk ? 'DISABLE PASS' : 'DISABLE FAIL');
        if (!disableOk)
            process.exitCode = 1;
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
