// Trash-glyph size census v2 (2026-08-26: 工具栏垃圾桶尺寸一致性): seeds the
// same data diag-guide-shots uses (plus search history), walks every view,
// and enumerates every VISIBLE .vbm-icon-trash rendered width (plus every
// visible toolbar glyph as the sibling baseline). Hidden toolbar variants
// (the idle/selection swaps) measure 0 and are excluded — only what the
// user can see counts. Law: every toolbar glyph is 16px (§2).
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    if (!fs.existsSync('/tmp/shots')) fs.mkdirSync('/tmp/shots', { recursive: true });
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
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.setViewport({ width: 420, height: 700 });
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const read = await create({ parentId: bar.id, title: '稍后读' });
            const dead1 = await create({ parentId: read.id, title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
            await create({ parentId: read.id, title: 'Dead Link (timeout)', url: 'https://example.invalid/dead-2' });
            const now = Date.now();
            const items = [
                { id: null, url: 'https://staged.example/a', title: 'Staged A', ts: now, group: null },
                { id: null, url: 'https://staged.example/b', title: 'Staged B', ts: now, group: null }
            ];
            const visitStats = { demo: { c: 3, t: now } };
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups: [], recentCollapsed: false, unfavCollapsed: false, headCollapsed: false, recentGroupCollapsed: {}, lastSeenTs: 0 }),
                searchHistory: JSON.stringify([
                    { q: 'chrome extension api', ts: now - 60e3, n: 3 },
                    { q: 'bookmark manager', ts: now - 3600e3, n: 1 }
                ]),
                searchHistoryEnabled: '1',
                visitStats: JSON.stringify(visitStats),
                deadLastScan: JSON.stringify({
                    ts: now - 3600e3,
                    scannedCount: 4,
                    results: {
                        [dead1.id]: { status: 'dead', code: 404 }
                    }
                }),
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1,
                donationKey: 30
            }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1800);

        const census = () => page.evaluate(() => {
            const visible = el => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
            const size = el => {
                const r = el.getBoundingClientRect();
                return Math.round(r.width * 10) / 10;
            };
            const ctx = el => {
                const btn = el.closest('button');
                return btn ? (btn.className.split(' ').filter(c => !c.startsWith('vbm-')).join('.') || btn.tagName) : el.parentElement.tagName;
            };
            return {
                trash: [...document.querySelectorAll('.vbm-icon-trash')].filter(visible).map(el => ({ w: size(el), in: ctx(el) })),
                toolbarGlyphs: [...document.querySelectorAll('.vbm-toolbar .vbm-icon')].filter(visible).map(el => ({ w: size(el), in: ctx(el) }))
            };
        });

        for (const tab of ['recent', 'stats', 'dead', 'search', 'tabgroups', 'dupes']) {
            await page.click('#view-tab-' + tab).catch(() => {});
            await sleep(700);
            const c = await census();
            const widths = [...new Set(c.trash.map(t => t.w))];
            const flag = widths.every(w => Math.abs(w - 16) < 0.5) ? 'OK' : 'MIXED';
            console.log(tab.toUpperCase() + ' trash=' + JSON.stringify(c.trash) + ' -> ' + flag);
            console.log('  siblings=' + JSON.stringify(c.toolbarGlyphs));
        }
        await page.click('#view-tab-stats').catch(() => {});
        await sleep(500);
        await page.screenshot({ path: '/tmp/shots/trash-stats-toolbar.png' });
        console.log('done');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
