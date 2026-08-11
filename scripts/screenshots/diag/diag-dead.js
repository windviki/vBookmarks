// One-off diagnostic (fifth round, items 1+2): hover a dead-view row to
// reveal the mark/delete buttons, and shoot the tree's dead/sync indicators
// at 3x device scale to inspect their shapes.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots/diag', { recursive: true });

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
    // Expand the bar root so the seeded (marked) bookmarks are visible…
    await page.evaluate(() => {
        const span = [...document.querySelectorAll('#tree span.tree-item-span')][0];
        if (span && !span.parentNode.classList.contains('open')) span.click();
    });
    await sleep(600);
    const dbg = await page.evaluate(async () => {
        const marks = await new Promise(r => chrome.storage.local.get('deadMarks', r));
        const inds = document.querySelectorAll('#tree .dead-indicator').length;
        const lis = [...document.querySelectorAll('#tree li')].slice(0, 8).map(li => li.id || '(no id)');
        return { marks, inds, lis };
    });
    console.log('DBG:', JSON.stringify(dbg));
    const indProbe = await page.evaluate(() => {
        const ind = document.querySelector('#tree .dead-indicator');
        if (!ind) return null;
        const cs = getComputedStyle(ind);
        const r = ind.getBoundingClientRect();
        return {
            display: cs.display, position: cs.position,
            width: cs.width, height: cs.height,
            top: cs.top, right: cs.right,
            borderRadius: cs.borderRadius, fontSize: cs.fontSize,
            lineHeight: cs.lineHeight, boxSizing: cs.boxSizing,
            rect: { w: r.width, h: r.height }
        };
    });
    console.log('IND:', JSON.stringify(indProbe));
    // …and inject sync dots on two unmarked rows for a side-by-side shape
    // comparison (the real sync mirror needs the background sync backend;
    // the CSS classes are what we're inspecting).
    await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#tree li a .favicon-container')];
        let n = 0;
        for (const fav of rows) {
            if (fav.querySelector('.dead-indicator')) continue;
            const cls = n === 0 ? 'local' : 'unsyncable';
            const s = document.createElement('span');
            s.className = `sync-indicator ${cls}`;
            fav.appendChild(s);
            if (++n === 2) break;
        }
    });
    await sleep(200);
    await page.screenshot({ path: '/tmp/shots/diag/diag-tree-indicators.png' });
    const treeClip = await page.evaluate(() => {
        const ind = document.querySelector('#tree .dead-indicator');
        if (!ind) return null;
        const li = ind.closest('li');
        const r = li.getBoundingClientRect();
        return { x: 0, y: Math.max(0, r.y - 26), width: 260, height: r.height * 4 + 32 };
    });
    if (treeClip)
        await page.screenshot({ path: '/tmp/shots/diag/diag-tree-dead-row-zoom.png', clip: treeClip });

    // --- dead view ---
    await page.evaluate(() => document.querySelector('#view-tab-dead').click());
    await sleep(800);
    await page.screenshot({ path: '/tmp/shots/diag/diag-dead-plain.png' });

    // hover the first result row → mark/delete buttons reveal
    const rowSel = '#dead-list ul li.vbm-row';
    await page.waitForSelector(rowSel);
    await page.hover(rowSel);
    await sleep(400);
    await page.screenshot({ path: '/tmp/shots/diag/diag-dead-hover.png' });
    const clip = await page.evaluate(sel => {
        const li = document.querySelector(sel);
        const r = li.getBoundingClientRect();
        return { x: 0, y: Math.max(0, r.y - 6), width: 400, height: r.height + 12 };
    }, rowSel);
    await page.screenshot({ path: '/tmp/shots/diag/diag-dead-hover-zoom.png', clip });

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
    await page.screenshot({ path: '/tmp/shots/diag/diag-dead-hover-wide.png' });
    const clipWide = await page.evaluate(sel => {
        const li = document.querySelector(sel);
        const r = li.getBoundingClientRect();
        return { x: 0, y: Math.max(0, r.y - 6), width: 640, height: r.height + 12 };
    }, rowSel);
    await page.screenshot({ path: '/tmp/shots/diag/diag-dead-hover-wide-zoom.png', clip: clipWide });
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

    // --- four themes: tree dead × + sync dot zoom ---------------------------
    const shootTheme = async theme => {
        const tp = await browser.newPage();
        await tp.setViewport({ width: 400, height: 640, deviceScaleFactor: 3 });
        await tp.evaluateOnNewDocument(t => {
            try { localStorage.setItem('theme', t); } catch (e) {}
        }, theme);
        await tp.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(1200);
        await tp.evaluate(() => {
            const span = [...document.querySelectorAll('#tree span.tree-item-span')][0];
            if (span && !span.parentNode.classList.contains('open')) span.click();
        });
        await sleep(500);
        // sync dot on one unmarked row for the side-by-side
        await tp.evaluate(() => {
            for (const fav of document.querySelectorAll('#tree li a .favicon-container')) {
                if (fav.querySelector('.dead-indicator')) continue;
                const s = document.createElement('span');
                s.className = 'sync-indicator local';
                fav.appendChild(s);
                break;
            }
        });
        await sleep(150);
        const clip = await tp.evaluate(() => {
            const ind = document.querySelector('#tree .dead-indicator');
            if (!ind) return null;
            const li = ind.closest('li');
            const r = li.getBoundingClientRect();
            return { x: 0, y: Math.max(0, r.y - 26), width: 300, height: r.height * 4 + 32 };
        });
        if (clip)
            await tp.screenshot({ path: `/tmp/shots/diag/diag-tree-ind-${theme}.png`, clip });
        await tp.close();
    };
    for (const theme of ['dark', 'ink', 'paper'])
        await shootTheme(theme);

    await browser.close();
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(2); });
