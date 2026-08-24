// staging head → member walk probe (batch-2 fix verification)
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
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: 'zzfolder' });
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 4; i++) {
                const url = `http://127.0.0.1:9/stg/${i}`;
                const n = await create({ parentId: folder.id, title: `zzstaging ${i}`, url });
                items.push({ id: n.id, url, title: `zzstaging ${i}`, ts: now - i * 1000, group: i < 2 ? 'g1' : null });
            }
            await new Promise(r => chrome.storage.local.set({
                staging: JSON.stringify({
                    v: 1, items,
                    groups: [{ id: 'g1', name: 'Group One', collapsed: false, createdAt: now - 5000 }],
                    recentCollapsed: false, unfavCollapsed: false, headCollapsed: false,
                    recentGroupCollapsed: {}, lastSeenTs: now - 3600000
                }),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-recent');
        await sleep(900);
        const walk = await page.evaluate(() => new Promise(res => {
            const describe = () => {
                const el = document.activeElement;
                if (!el || !el.closest) return '<none>';
                const li = el.closest('li');
                return `${el.tagName.toLowerCase()}@${li ? (li.id || li.className.split(' ')[0]) : '?'}`;
            };
            // start ON the group head
            document.querySelector('.staging-group-head').focus();
            const seq = [describe()];
            const step = i => {
                if (i >= 4) return res(seq);
                document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
                setTimeout(() => { seq.push(describe()); step(i + 1); }, 90);
            };
            step(0);
        }));
        console.log('C2 head walk:', JSON.stringify(walk));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
