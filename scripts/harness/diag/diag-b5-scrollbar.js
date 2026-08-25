// Batch-5: the reported DOUBLE SCROLLBAR under the recent section head —
// find which elements own scrollbars, their geometry, and capture a shot.
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
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: 'zzfolder' });
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 8; i++) {
                const url = `http://127.0.0.1:9/stg/${i}`;
                const n = await create({ parentId: folder.id, title: `zzstaging ${i}`, url });
                items.push({ id: n.id, url, title: `zzstaging ${i}`, ts: now - i * 1000, group: i < 2 ? 'g1' : null });
            }
            items.push({ id: null, url: 'http://127.0.0.1:9/snap/1', title: 'zzsnap 1', ts: now, group: null });
            await new Promise(r => chrome.storage.local.set({
                staging: JSON.stringify({
                    v: 1, items,
                    groups: [{ id: 'g1', name: 'Group One', collapsed: false, createdAt: now - 5000 }],
                    recentCollapsed: false, unfavCollapsed: false, headCollapsed: false,
                    recentGroupCollapsed: {}, lastSeenTs: now - 3600000
                }),
                recentCount: '50',
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-recent');
        await sleep(1200);
        const info = await page.evaluate(() => {
            const probe = el => {
                if (!el) return null;
                const cs = getComputedStyle(el);
                return {
                    id: el.id || el.className.split(' ')[0],
                    overflow: `${cs.overflowX}/${cs.overflowY}`,
                    clientH: el.clientHeight, scrollH: el.scrollHeight, offsetH: el.offsetHeight,
                    clientW: el.clientWidth, scrollW: el.scrollHeight,
                    rectH: Math.round(el.getBoundingClientRect().height),
                    vScroll: el.scrollHeight > el.clientHeight + 1,
                    hScroll: el.scrollWidth > el.clientWidth + 1
                };
            };
            const out = {
                list: probe(document.getElementById('staging-list')),
                recentList: probe(document.getElementById('recent-list')),
                recentHead: probe(document.getElementById('recent-head')),
                view: probe(document.getElementById('view-recent')),
                bodyScroll: { bodyH: document.body.scrollHeight, docH: document.documentElement.scrollHeight }
            };
            // every descendant that actually owns a vertical scrollbar
            out.scrollers = [...document.querySelectorAll('#staging-list, #staging-list *')]
                .filter(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)
                .map(el => `${el.nodeName.toLowerCase()}#${el.id || ''}.${(typeof el.className === 'string' ? el.className : '').split(' ')[0]} h=${el.clientHeight}/${el.scrollHeight} w=${el.clientWidth}/${el.scrollWidth}`)
                .slice(0, 12);
            return out;
        });
        console.log('scrollbar info:', JSON.stringify(info, null, 1));
        await page.screenshot({ path: '/tmp/shots/b5-scrollbar.png', fullPage: false });
        console.log('shot: /tmp/shots/b5-scrollbar.png');
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
