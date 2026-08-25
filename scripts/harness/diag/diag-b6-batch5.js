// Batch-6 (fifth fix round) verification: dead/stats two-rung iconified
// selecting bars, tree folder plane, tabgroups window plane, bucket
// remove-all, recent-list overflow restore.
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

        // seed tabs first (throwaway popup page)
        const seedPage = await browser.newPage();
        await seedPage.evaluateOnNewDocument(() => { window.close = () => {}; });
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await seedPage.evaluate(async () => {
            const create = p => new Promise(r => chrome.tabs.create(p, r));
            for (let i = 0; i < 4; i++)
                await create({ url: `http://127.0.0.1:9/tg/${i}`, active: false });
        });
        await sleep(400);
        await seedPage.close();

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
            await create({ parentId: folder.id, title: 'zza', url: 'http://127.0.0.1:9/a' });
            await create({ parentId: folder.id, title: 'zzb', url: 'http://127.0.0.1:9/b' });
            const dead = await create({ parentId: bar.id, title: 'zzdead', url: 'http://127.0.0.1:9/dead' });
            const now = Date.now();
            const items = [
                { id: null, url: 'http://127.0.0.1:9/snap/1', title: 's1', ts: now, group: null },
                { id: null, url: 'http://127.0.0.1:9/snap/2', title: 's2', ts: now - 1, group: null }
            ];
            await new Promise(r => chrome.storage.local.set({
                staging: JSON.stringify({
                    v: 1, items,
                    groups: [],
                    recentCollapsed: false, unfavCollapsed: false, headCollapsed: false,
                    recentGroupCollapsed: {}, lastSeenTs: now - 3600000
                }),
                recentCount: '50',
                deadLastScan: JSON.stringify({
                    ts: now - 3600e3, scannedCount: 1,
                    results: { [dead.id]: { status: 'dead', code: 404 } }
                }),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // --- tree: folder plane --------------------------------------------
        await page.evaluate(() => {
            const span = document.querySelector('#tree span.tree-item-span');
            if (span) span.click();
        });
        await sleep(600);
        console.log('tree folder row:', await page.evaluate(() => {
            const fo = document.querySelector('#tree span.tree-item-span');
            return JSON.stringify([...fo.querySelectorAll('.row-btn')].map(b => b.className.split(' ').slice(0, 2).join('.')));
        }));
        await page.evaluate(() => {
            const planes = [...document.querySelectorAll('#tree .staging-add-btn')];
            const folderPlane = planes[planes.length - 1]; // folder rows come after their children? pick the one inside a span
            const target = document.querySelector('#tree span.tree-item-span .staging-add-btn');
            if (target) target.click();
        });
        await sleep(700);
        console.log('folder send:', await page.evaluate(() => JSON.stringify({
            badge: document.getElementById('view-tab-recent').textContent,
            folderPlaneCls: (document.querySelector('#tree span.tree-item-span .staging-add-btn') || {}).className
        })));

        // --- staging view: bucket remove-all --------------------------------
        await page.click('#view-tab-recent');
        await sleep(900);
        console.log('bucket head:', await page.evaluate(() => {
            const head = document.querySelector('.staging-bucket-head');
            return JSON.stringify([...head.querySelectorAll('.row-btn')].map(b => b.className.split(' ').slice(0, 2).join('.')));
        }));
        await page.evaluate(() => document.querySelector('.staging-bucket-remove-all').click());
        await sleep(500);
        console.log('bucket removed:', await page.evaluate(() => JSON.stringify({
            bucketGone: !document.querySelector('.staging-bucket'),
            badge: document.getElementById('view-tab-recent').textContent
        })));

        // --- dead: two-rung iconified selecting bar ---------------------------
        await page.click('#view-tab-dead');
        await sleep(1000);
        await page.evaluate(() => document.querySelector('.dead-select-mode').click());
        await sleep(700);
        console.log('dead bars:', await page.evaluate(() => {
            const bars = [...document.querySelectorAll('#dead-list .dead-toolbar')];
            return JSON.stringify(bars.map(b => [...b.querySelectorAll('button')].map(x => x.className.replace('vbm-fit-btn ', '').trim())));
        }));
        console.log('dead fit:', await page.evaluate(() => {
            const bar = document.querySelector('.dead-actions-toolbar');
            const labels = [...bar.querySelectorAll('.vbm-fit-label')];
            return JSON.stringify(labels.map(l => l.style.display));
        }));

        // --- stats: two-rung bar (needs stats rows) ---------------------------
        await page.evaluate(() => chrome.storage.local.set({ statsEnabled: '1' }));
        await sleep(300);
        await page.click('#view-tab-stats');
        await sleep(1000);
        const hasStats = await page.evaluate(() => !!document.querySelector('.stats-select-mode'));
        if (hasStats) {
            await page.evaluate(() => document.querySelector('.stats-select-mode').click());
            await sleep(700);
            console.log('stats bars:', await page.evaluate(() => {
                const bars = [...document.querySelectorAll('#stats-list .stats-toolbar')];
                return JSON.stringify(bars.map(b => [...b.querySelectorAll('button')].map(x => x.className.replace('vbm-fit-btn ', '').trim())));
            }));
        } else {
            console.log('stats bars: (no rows to select — skipped)');
        }

        // --- tabgroups: window head plane -------------------------------------
        await page.click('#view-tab-tabgroups');
        await sleep(1500);
        console.log('window head:', await page.evaluate(() => {
            const head = document.querySelector('.tabgroups-window-head-row');
            return JSON.stringify([...head.querySelectorAll('.row-btn')].map(b => b.className.split(' ').slice(0, 2).join('.')));
        }));
        await page.evaluate(() => document.querySelector('.tabgroups-window-stage').click());
        await sleep(600);
        console.log('window staged:', await page.evaluate(() => JSON.stringify({
            head: document.querySelector('.tabgroups-window-stage').className,
            rowPlanes: [...document.querySelectorAll('.tabgroups-row .tabgroups-stage')].map(b => b.className).slice(0, 2),
            badge: document.getElementById('view-tab-recent').textContent
        })));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
