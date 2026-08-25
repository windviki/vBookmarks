// Batch-9: measure the dupes actions-toolbar icon columns vs the rows'
// trailing icon columns (the repeatedly-requested one-axis law).
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
        page.on('console', m => console.log('PAGE:', m.text()));
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            for (const t of ['a', 'b', 'c'])
                await create({ parentId: bar.id, title: `dup ${t}`, url: 'http://127.0.0.1:9/dup' });
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-dupes');
        await sleep(1800);
        console.log(await page.evaluate(() => {
            const W = document.getElementById('dupes-list').getBoundingClientRect().right;
            const x = el => {
                const r = el.getBoundingClientRect();
                return { cx: Math.round(r.left + r.width / 2), rightFromEdge: Math.round(W - r.right), w: Math.round(r.width) };
            };
            const bar = document.querySelector('.dupes-actions-toolbar');
            const toolbarIcons = {};
            for (const cls of ['dupes-apply-all', 'dupes-stage-all', 'dupes-collapse-all', 'dupes-expand-all', 'dupes-select-mode']) {
                const el = bar.querySelector('.' + cls);
                if (el)
                    toolbarIcons[cls] = x(el);
            }
            const row = document.querySelector('.dupes-member');
            const rowDel = row.querySelector('.dupes-member-del');
            const rowRadio = row.querySelector('.keeper-radio');
            const selMatch = document.querySelector('.dupes-toolbar .dupes-actions-toolbar .dupes-icon-cluster button');
            const probe = bar.querySelector('.dupes-stage-all');
            console.log('MATCH', !!selMatch, probe ? (probe.closest('.dupes-icon-cluster') ? 'in-cluster' : 'NO-CLUSTER') : 'no-probe',
                bar ? bar.className : 'no-bar');
            const pcs = probe ? getComputedStyle(probe) : null;
            const clusterDebug = probe ? {
                cls: probe.className,
                width: pcs.width, padding: pcs.padding, border: pcs.borderTopWidth,
                boxSizing: pcs.boxSizing
            } : null;
            return JSON.stringify({
                clusterDebug,
                toolbar: toolbarIcons,
                rowDelete: x(rowDel),
                rowRadio: x(rowRadio),
                barPadRight: getComputedStyle(bar).paddingRight
            });
        }));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
