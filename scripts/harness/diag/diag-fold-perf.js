// Fold-toggle latency probe: dupes group fold, tabgroups group fold, tree folder
// fold — with the current CSS (content-visibility on) vs a temporary
// override (content-visibility: visible everywhere) to isolate a cv
// regression in expand/collapse.
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
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(swTarget.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1500);

        // seed: many bookmarks sharing a few URLs (dupes groups) + deep tree folders
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__fold_perf__' });
            const dupUrl = 'https://fold-dupe.example.com/page';
            for (let i = 0; i < 400; i++) {
                await create({ parentId: folder.id, title: 'Dup ' + i, url: dupUrl + (i % 3) });
            }
            let parent = folder.id;
            for (let d = 0; d < 12; d++) {
                parent = (await create({ parentId: parent, title: 'F' + d })).id;
            }
            await create({ parentId: parent, title: 'Deep leaf', url: 'https://deep.example.com/x' });
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        const measure = async (label, viewTab, openSel, closeSel, openNextSel) => {
            await page.click(viewTab);
            await sleep(800);
            const t = await page.evaluate(({ openSel, closeSel, openNextSel }) => {
                const open = document.querySelector(openSel);
                if (!open) return { err: 'missing open ' + openSel };
                const t0 = performance.now();
                open.click();
                const afterOpen = performance.now() - t0;
                return new Promise(r => setTimeout(() => {
                    const c = document.querySelector(closeSel) || document.querySelector(openNextSel);
                    const t1 = performance.now();
                    if (c) c.click();
                    r({ afterOpen, afterClose: performance.now() - t1 });
                }, 120));
            }, { openSel, closeSel, openNextSel });
            console.log(label, JSON.stringify(t));
        };

        await measure('dupes-group-fold', '#view-tab-dupes', '#dupes-list .dupes-group .group-head', '#dupes-list .dupes-group .group-head', '#dupes-list .dupes-group .group-head');
        await measure('tree-folder-fold', '#view-tab-tree', '#tree li > span.tree-item-span:not(.selected)', '#tree li.open > span.tree-item-span', '#tree li > span.tree-item-span');
        await measure('tabgroups-window-fold', '#view-tab-tabgroups', '#tabgroups-list .tabgroups-window-head-row', '#tabgroups-list .tabgroups-window-head-row', '#tabgroups-list .tabgroups-window-head-row');
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
