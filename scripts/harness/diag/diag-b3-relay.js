// Batch-3 relay verification: staging row menu label, dead/dupes/search
// stage buttons (position law + toggle), selection-bar stage wiring.
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
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: 'zzfolder' });
            const ids = [];
            for (let i = 0; i < 3; i++) {
                const n = await create({ parentId: folder.id, title: `zzpage ${i}`, url: `http://127.0.0.1:9/a/${i}` });
                ids.push(n.id);
            }
            // dupes: same URL twice
            await create({ parentId: bar.id, title: 'zzdup A', url: 'http://127.0.0.1:9/dup' });
            await create({ parentId: bar.id, title: 'zzdup B', url: 'http://127.0.0.1:9/dup' });
            const now = Date.now();
            await new Promise(r => chrome.storage.local.set({
                deadLastScan: JSON.stringify({
                    ts: now - 3600e3, scannedCount: 3,
                    results: {
                        [ids[0]]: { status: 'dead', code: 404 },
                        [ids[1]]: { status: 'blocked', code: 0, error: 'BLOCKED' }
                    }
                }),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // 0. staging row menu label (the label-map gap)
        console.log('menu label:', await page.evaluate(() =>
            JSON.stringify({ remove: document.getElementById('staging-remove-item').textContent })));

        // 1. search rows
        await page.click('#view-tab-search');
        await sleep(400);
        await page.type('#search-input', 'zzpage');
        await sleep(700);
        console.log('search row:', await page.evaluate(() => {
            const li = document.querySelector('#results-ul li.vbm-row');
            const kids = [...li.children].map(c => c.className.split(' ')[0]);
            return JSON.stringify({ kids, liFlex: getComputedStyle(li).display });
        }));
        // click stage → staged; click again → gone
        await page.evaluate(() => document.querySelector('#results-ul .staging-add-btn').click());
        await sleep(500);
        const staged1 = await page.evaluate(() => JSON.stringify({
            cls: document.querySelector('#results-ul .staging-add-btn').className,
            badge: document.getElementById('view-tab-recent').textContent
        }));
        console.log('search stage 1:', staged1);
        // selection bar stage wiring (was a silent no-op before)
        await page.evaluate(() => document.querySelector('#results .search-select-mode').click());
        await sleep(500);
        await page.evaluate(() => {
            document.querySelector('#results-ul li.vbm-row').click();
        });
        await sleep(300);
        const barStage = await page.evaluate(() => {
            const btn = document.querySelector('.search-stage');
            if (btn) btn.click();
            return btn ? 'clicked' : 'missing';
        });
        await sleep(500);
        console.log('search bar stage:', barStage, await page.evaluate(() =>
            JSON.stringify({ badge: document.getElementById('view-tab-recent').textContent })));

        // 2. dead view
        await page.click('#view-tab-dead');
        await sleep(900);
        console.log('dead toolbar:', await page.evaluate(() => {
            const bar = document.querySelector('.dead-mark-toolbar');
            const order = [...bar.querySelectorAll('button')].map(b => b.className.split(' ')[0]);
            return JSON.stringify(order);
        }));
        console.log('dead row:', await page.evaluate(() => {
            const li = document.querySelector('#dead-list ul li.vbm-row');
            return JSON.stringify([...li.querySelectorAll('button')].map(b => b.className.split(' ')[0]));
        }));
        await page.evaluate(() => document.querySelector('#dead-list .staging-add-btn').click());
        await sleep(500);
        console.log('dead staged:', await page.evaluate(() =>
            document.querySelector('#dead-list .staging-add-btn').className));

        // 3. dupes view
        await page.click('#view-tab-dupes');
        await sleep(1200);
        console.log('dupes toolbar:', await page.evaluate(() => {
            const bar = document.querySelector('.dupes-actions-toolbar');
            return JSON.stringify([...bar.querySelectorAll('button')].map(b => b.className.split(' ')[0]));
        }));
        console.log('dupes head+row:', await page.evaluate(() => {
            const head = document.querySelector('.dupes-group .group-head');
            const row = document.querySelector('.dupes-member');
            return JSON.stringify({
                head: [...head.querySelectorAll('button')].map(b => b.className.split(' ')[0]),
                row: [...row.querySelectorAll('button')].map(b => b.className.split(' ')[0])
            });
        }));
        await page.evaluate(() => document.querySelector('.dupes-group .staging-add-btn').click());
        await sleep(600);
        console.log('dupes group staged:', await page.evaluate(() => {
            const btns = [...document.querySelectorAll('.dupes-member .staging-add-btn')];
            return JSON.stringify(btns.map(b => b.className));
        }));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
