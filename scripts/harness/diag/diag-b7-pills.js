// Batch-7: measure the current-TAB pill vs current-WINDOW pill right edges
// (+ the dupes/dead toolbar button heights for the size-normalization item).
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
        const seedPage = await browser.newPage();
        await seedPage.evaluateOnNewDocument(() => { window.close = () => {}; });
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await seedPage.evaluate(async () => {
            const create = p => new Promise(r => chrome.tabs.create(p, r));
            const group = (t, props) => new Promise(r => chrome.tabs.group({ tabIds: [t.id] }, gid =>
                chrome.tabGroups.update(gid, props, () => r(gid))));
            for (let i = 0; i < 5; i++) {
                const t = await create({ url: `http://127.0.0.1:9/tg/${i}`, active: false });
                if (i === 1) await group(t, { title: 'G1', color: 'blue' });
            }
        });
        await sleep(400);
        await seedPage.close();

        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-tabgroups');
        await sleep(1500);
        console.log('pills:', await page.evaluate(() => {
            const ul = document.querySelector('#tabgroups-list ul');
            const W = ul.getBoundingClientRect().right;
            const rowBadge = document.querySelector('li.tabgroups-current .row-badge.current');
            const winPill = document.querySelector('b.tabgroups-window-current');
            const winRow = document.querySelector('.tabgroups-window-head-row');
            const r1 = rowBadge ? rowBadge.getBoundingClientRect() : null;
            const r2 = winPill ? winPill.getBoundingClientRect() : null;
            const row = document.querySelector('li.tabgroups-current');
            const anchor = row ? row.querySelector('a') : null;
            const ar = anchor ? anchor.getBoundingClientRect() : null;
            return JSON.stringify({
                rowBadgeRightFromEdge: r1 ? Math.round(W - r1.right) : null,
                rowAnchorRightFromEdge: ar ? Math.round(W - ar.right) : null,
                winPillRightFromEdge: r2 ? Math.round(W - r2.right) : null,
                winRowPosition: getComputedStyle(winRow).position,
                rowBtnStrip: (() => {
                    const btns = row ? [...row.querySelectorAll('.row-btn, .tabgroups-slot, .tabgroups-status-icon')] : [];
                    return btns.map(b => Math.round(b.getBoundingClientRect().width));
                })()
            });
        }));

        // dupes toolbar heights
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            await create({ parentId: bar.id, title: 'dA', url: 'http://127.0.0.1:9/dup' });
            await create({ parentId: bar.id, title: 'dB', url: 'http://127.0.0.1:9/dup' });
            await new Promise(r => chrome.storage.local.set({ activeView: 'tree' }, r));
        });
        await sleep(1500);
        await page.click('#view-tab-dupes');
        await sleep(1500);
        console.log('dupes toolbar:', await page.evaluate(() => {
            const h = el => el ? Math.round(el.getBoundingClientRect().height) : null;
            return JSON.stringify({
                stageAll: h(document.querySelector('.dupes-stage-all')),
                applyAll: h(document.querySelector('.dupes-apply-all')),
                selectMode: h(document.querySelector('.dupes-select-mode'))
            });
        }));
        // dead toolbar for comparison
        await page.evaluate(() => chrome.storage.local.set({
            deadLastScan: JSON.stringify({ ts: Date.now() - 3600e3, scannedCount: 1, results: {} })
        }));
        await sleep(400);
        await page.click('#view-tab-dead');
        await sleep(1000);
        console.log('dead toolbar:', await page.evaluate(() => {
            const h = el => el ? Math.round(el.getBoundingClientRect().height) : null;
            return JSON.stringify({
                rescan: h(document.querySelector('.dead-rescan')),
                selectMode: h(document.querySelector('.dead-select-mode'))
            });
        }));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
