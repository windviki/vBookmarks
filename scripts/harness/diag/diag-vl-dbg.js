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
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = props => new Promise((res, rej) =>
                chrome.bookmarks.create(props, n => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(n)));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__dbg__' });
            for (let u = 0; u < 100; u++)
                for (let c = 0; c < 8; c++)
                    await create({ parentId: root.id, title: 'd' + u + 'c' + c, url: 'https://h' + u + '.example.com/p' });
            await new Promise(res => chrome.storage.local.set({ virtualScrollLab: '1' }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-dupes');
        await sleep(1500);
        const info = await page.evaluate(() => {
            const list = document.getElementById('dupes-list');
            const rows = list.querySelectorAll('li.vbm-row');
            const row = rows[2];
            const cs = row ? getComputedStyle(row) : null;
            return {
                listClass: list.className,
                rows: rows.length,
                cv: cs ? cs.contentVisibility : null,
                cis: cs ? cs.containIntrinsicSize : null,
                headLiClass: (list.querySelector('li.dupes-group') || {}).className
            };
        });
        console.log(JSON.stringify(info));
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
