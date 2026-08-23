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
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__shot__' });
            const now = Date.now();
            const items = [];
            const groups = [{ id: 'g1', name: '工作台分组', collapsed: false, createdAt: now, sourceFolderId: null, sourceTabGroup: null, manual: true }];
            for (let i = 0; i < 5; i++) {
                const bm = await create({ parentId: root.id, title: '示例书签 ' + i, url: 'https://shot.example/' + i });
                items.push({ id: bm.id, url: bm.url, title: bm.title, ts: now - i * 90000000, group: i < 3 ? 'g1' : null });
            }
            items.push({ id: null, url: 'https://hist.example/x', title: '未收藏历史条目', ts: now - 1000, group: null });
            for (let i = 0; i < 4; i++)
                await create({ parentId: root.id, title: '最近 ' + i, url: 'https://shotr.example/' + i });
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups, recentCollapsed: false, unfavCollapsed: false, headCollapsed: false, recentGroupCollapsed: {}, lastSeenTs: 0 })
            }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-recent');
        await sleep(1800);
        {
            const fs = require('fs');
            if (!fs.existsSync('/tmp/shots')) fs.mkdirSync('/tmp/shots', { recursive: true });
            await page.screenshot({ path: '/tmp/shots/staging-heads.png' });
        }
        // collapsed states
        await page.evaluate(() => document.getElementById('staging-head').click());
        await sleep(500);
        await page.evaluate(() => {
            const li = document.querySelector('li.recent-group-li[data-recent-group="0"] .recent-group-head');
            if (li) li.click();
        });
        await sleep(500);
        await page.screenshot({ path: '/tmp/shots/staging-heads-collapsed.png' });
        console.log('shots saved');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });