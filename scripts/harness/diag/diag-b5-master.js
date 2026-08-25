// Batch-5 verification: tree-row hover actions, the staging master switch's
// gating across views, the selecting connector alignment, the recent-row
// plane flip, and the recentered chevrons.
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
            await create({ parentId: folder.id, title: 'zzpage', url: 'http://127.0.0.1:9/a/0' });
            await create({ parentId: bar.id, title: 'zzloose', url: 'http://127.0.0.1:9/loose' });
            const now = Date.now();
            await new Promise(r => chrome.storage.local.set({
                staging: JSON.stringify({
                    v: 1,
                    items: [{ id: null, url: 'http://127.0.0.1:9/a/0', title: 'zzpage', ts: now, group: 'g1' },
                            { id: null, url: 'http://127.0.0.1:9/loose', title: 'zzloose', ts: now - 1, group: null }],
                    groups: [{ id: 'g1', name: 'Group One', collapsed: false, createdAt: now - 5000 }],
                    recentCollapsed: false, unfavCollapsed: false, headCollapsed: false,
                    recentGroupCollapsed: {}, lastSeenTs: now - 3600000
                }),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // --- tree rows: hover actions --------------------------------------
        await page.evaluate(() => {
            // open the bookmarks bar so its rows render
            const span = document.querySelector('#tree span.tree-item-span');
            if (span) span.click();
        });
        await sleep(600);
        console.log('tree rows:', await page.evaluate(() => {
            const bm = document.querySelector('#tree a.tree-item-link:not(.separator-row)');
            const fo = document.querySelector('#tree span.tree-item-span');
            const btns = el => el ? [...el.querySelectorAll('.row-btn')].map(b => b.className.split(' ').slice(0, 2).join('.')) : null;
            return JSON.stringify({ bookmark: btns(bm), folder: btns(fo) });
        }));
        // hover a bookmark row → buttons visible; click stage → staged flip
        const bmHandle = await page.$('#tree a.tree-item-link:not(.separator-row)');
        const bb = await bmHandle.boundingBox();
        await page.mouse.move(bb.x + 80, bb.y + bb.height / 2);
        await sleep(250);
        console.log('tree hover:', await page.evaluate(() => {
            const btn = document.querySelector('#tree a .tree-row-edit');
            return JSON.stringify({ vis: getComputedStyle(btn).visibility });
        }));
        await page.evaluate(() => document.querySelector('#tree a .staging-add-btn').click());
        await sleep(400);
        console.log('tree staged flip:', await page.evaluate(() =>
            document.querySelector('#tree a .staging-add-btn').className));

        // --- recent view: workbench + flip + selecting connector ------------
        await page.click('#view-tab-recent');
        await sleep(900);
        console.log('recent head:', await page.evaluate(() => JSON.stringify({
            stagingHead: !!document.getElementById('staging-head'),
            cut: !!document.querySelector('.staging-cut'),
            badge: document.getElementById('view-tab-recent').textContent
        })));
        // recent row plane flip (a tree bookmark = the recent region's row)
        await page.evaluate(() => {
            const btn = document.querySelector('#recent-list .staging-add-btn:not(.staged)');
            if (btn) btn.click();
        });
        await sleep(400);
        console.log('recent flip:', await page.evaluate(() => {
            const btn = document.querySelector('#recent-list .staging-add-btn');
            return btn ? btn.className : 'none';
        }));
        // selecting connector alignment
        await page.evaluate(() => document.querySelector('.staging-select-mode').click());
        await sleep(700);
        console.log('sel align:', await page.evaluate(() => {
            const headLi = document.querySelector('#staging-items li.staging-group');
            const chev = headLi.querySelector('.chevron');
            const cr = chev.getBoundingClientRect();
            const conn = document.querySelector('#staging-items li.staging-member .staging-connector');
            return JSON.stringify({
                chevCx: Math.round((cr.left + cr.right) / 2 * 10) / 10,
                connLeft: Math.round(conn.getBoundingClientRect().left * 10) / 10,
                trunkLeft: Math.round(headLi.getBoundingClientRect().left + 39.5)
            });
        }));

        // --- master switch OFF ----------------------------------------------
        await page.evaluate(() => chrome.storage.local.set({ stagingEnabled: '' }));
        await sleep(800);
        console.log('switch off recent:', await page.evaluate(() => JSON.stringify({
            stagingHead: !!document.getElementById('staging-head'),
            stagingItems: !!document.getElementById('staging-items'),
            cut: !!document.querySelector('.staging-cut'),
            recentHead: !!document.getElementById('recent-head'),
            recentRows: document.querySelectorAll('#recent-list li').length,
            badge: document.getElementById('view-tab-recent').textContent
        })));
        await page.evaluate(() => { document.getElementById('view-tab-tree').click(); });
        await sleep(600);
        console.log('switch off tree:', await page.evaluate(() => JSON.stringify({
            stageBtns: document.querySelectorAll('#tree .staging-add-btn').length,
            editBtns: document.querySelectorAll('#tree .tree-row-edit').length
        })));
        await page.evaluate(() => { document.getElementById('view-tab-dead').click(); });
        await sleep(900);
        console.log('switch off dead:', await page.evaluate(() => JSON.stringify({
            stageAll: !!document.querySelector('.dead-stage-all'),
            rowPlanes: document.querySelectorAll('#dead-list .staging-add-btn').length
        })));
        await page.evaluate(() => { document.getElementById('view-tab-dupes').click(); });
        await sleep(1200);
        console.log('switch off dupes:', await page.evaluate(() => JSON.stringify({
            stageAll: !!document.querySelector('.dupes-stage-all'),
            headPlanes: document.querySelectorAll('.dupes-group .staging-add-btn').length,
            rowPlanes: document.querySelectorAll('.dupes-member .staging-add-btn').length
        })));
        await page.click('#view-tab-search');
        await sleep(400);
        await page.type('#search-input', 'zz');
        await sleep(700);
        console.log('switch off search:', await page.evaluate(() => JSON.stringify({
            planes: document.querySelectorAll('#results .staging-add-btn').length,
            dels: document.querySelectorAll('#results .search-row-del').length
        })));
        await page.evaluate(() => chrome.storage.local.set({ stagingEnabled: '1' }));
        await sleep(600);
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
