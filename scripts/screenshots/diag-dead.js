// One-off diagnostic (fifth round, items 1+2): hover a dead-view row to
// reveal the mark/delete buttons, and shoot the tree's dead/sync indicators
// at 3x device scale to inspect their shapes.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com' });
    await create({ parentId: work.id, title: 'MDN', url: 'https://developer.mozilla.org' });
    const dead1 = await create({ parentId: '1', title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
    const dead2 = await create({ parentId: '1', title: 'Bogus host 1', url: 'https://thishost.does.not.exist.example/' });
    const dead3 = await create({ parentId: '1', title: 'Bogus host 2', url: 'https://another.dead.example.com/link' });
    const now = Date.now();
    await new Promise(r => chrome.storage.local.set({
        deadMarks: JSON.stringify([dead1.id, dead2.id]),
        deadLastScan: JSON.stringify({
            ts: now - 3600e3,
            scannedCount: 6,
            results: {
                [dead1.id]: { status: 'dead', code: 404 },
                [dead2.id]: { status: 'dead', code: 0, error: 'ERR_NAME_NOT_RESOLVED' },
                [dead3.id]: { status: 'blocked' }
            }
        })
    }, r));
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext'
        ]
    });

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;

    const seedPage = await browser.newPage();
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    await seedPage.evaluate(SEED);
    await sleep(500);
    await seedPage.close();

    const page = await browser.newPage();
    page.on('pageerror', e => console.log('PAGEERROR:', e.message));
    await page.setViewport({ width: 400, height: 640, deviceScaleFactor: 3 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1600);

    // --- tree view: dead indicators on marked rows (item 2 shape check) ---
    const treeClip = await page.evaluate(() => {
        const li = document.querySelector('#tree li[data-node-id], #tree li[id^="neat-tree-item-"]');
        if (!li) return null;
        const r = li.getBoundingClientRect();
        return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: r.width + 8, height: r.height * 3 + 8 };
    });
    await page.screenshot({ path: '/tmp/shots/diag-tree-indicators.png' });
    if (treeClip)
        await page.screenshot({ path: '/tmp/shots/diag-tree-dead-row-zoom.png', clip: treeClip });

    // --- dead view ---
    await page.evaluate(() => document.querySelector('#view-tab-dead').click());
    await sleep(800);
    await page.screenshot({ path: '/tmp/shots/diag-dead-plain.png' });

    // hover the first result row → mark/delete buttons reveal
    const rowSel = '#dead-list ul li.vbm-row';
    await page.waitForSelector(rowSel);
    await page.hover(rowSel);
    await sleep(400);
    await page.screenshot({ path: '/tmp/shots/diag-dead-hover.png' });
    const clip = await page.evaluate(sel => {
        const li = document.querySelector(sel);
        const r = li.getBoundingClientRect();
        return { x: 0, y: Math.max(0, r.y - 6), width: 400, height: r.height + 12 };
    }, rowSel);
    await page.screenshot({ path: '/tmp/shots/diag-dead-hover-zoom.png', clip });

    // layout probe: where do the buttons sit relative to the anchor?
    const probe = await page.evaluate(sel => {
        const li = document.querySelector(sel);
        const a = li.querySelector('a');
        const btns = [...li.querySelectorAll('.row-btn')];
        const lr = li.getBoundingClientRect();
        const ar = a.getBoundingClientRect();
        return {
            li: { h: lr.height, display: getComputedStyle(li).display },
            anchor: { h: ar.height, w: ar.width },
            buttons: btns.map(b => {
                const r = b.getBoundingClientRect();
                return { cls: b.className, top: r.top - lr.top, h: r.height, vis: getComputedStyle(b).visibility };
            })
        };
    }, rowSel);
    console.log('PROBE narrow:', JSON.stringify(probe));

    // --- wide pass (≥480px container query): the path becomes a second muted
    // line (.row-sub), the anchor goes two lines tall — where do the buttons
    // sit now? ---
    await page.setViewport({ width: 640, height: 640, deviceScaleFactor: 3 });
    await sleep(400);
    await page.hover(rowSel);
    await sleep(300);
    await page.screenshot({ path: '/tmp/shots/diag-dead-hover-wide.png' });
    const clipWide = await page.evaluate(sel => {
        const li = document.querySelector(sel);
        const r = li.getBoundingClientRect();
        return { x: 0, y: Math.max(0, r.y - 6), width: 640, height: r.height + 12 };
    }, rowSel);
    await page.screenshot({ path: '/tmp/shots/diag-dead-hover-wide-zoom.png', clip: clipWide });
    const probeWide = await page.evaluate(sel => {
        const li = document.querySelector(sel);
        const a = li.querySelector('a');
        const btns = [...li.querySelectorAll('.row-btn')];
        const lr = li.getBoundingClientRect();
        return {
            li: { h: lr.height },
            anchor: { h: a.getBoundingClientRect().height },
            buttons: btns.map(b => {
                const r = b.getBoundingClientRect();
                return { cls: b.className, top: r.top - lr.top, h: r.height };
            })
        };
    }, rowSel);
    console.log('PROBE wide:', JSON.stringify(probeWide));

    await browser.close();
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(2); });
