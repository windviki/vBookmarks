// Batch-8 diagnostics: stats vs dead selecting-bar computed styles (item 2)
// and whether the tabgroups closed records survive a popup reopen (item 10).
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

        // seed: bookmarks for stats + dead, tabs incl. a group
        const seedPage = await browser.newPage();
        await seedPage.evaluateOnNewDocument(() => { window.close = () => {}; });
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await seedPage.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const gh = await create({ parentId: bar.id, title: 'zzgh', url: 'http://127.0.0.1:9/gh' });
            const now = Date.now();
            await new Promise(r => chrome.storage.local.set({
                visitStats: JSON.stringify({ [gh.id]: { c: 5, t: now } }),
                statsEnabled: '1',
                activeView: 'tree'
            }, r));
            const tabCreate = p => new Promise(r => chrome.tabs.create(p, r));
            const group = (t, props) => new Promise(r => chrome.tabs.group({ tabIds: [t.id] }, gid =>
                chrome.tabGroups.update(gid, props, () => r(gid))));
            const t1 = await tabCreate({ url: 'http://127.0.0.1:9/x1', active: false });
            await group(t1, { title: 'GX', color: 'blue' });
            await tabCreate({ url: 'http://127.0.0.1:9/x2', active: false });
        });
        await sleep(400);
        await seedPage.close();

        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1500);

        // --- item 2: stats vs dead selecting bars --------------------------------
        const dumpBars = sel => {
            const out = [];
            for (const bar of document.querySelectorAll(sel)) {
                const cs = getComputedStyle(bar);
                out.push({
                    cls: bar.className,
                    border: cs.borderBottomWidth + ' ' + cs.borderBottomColor,
                    padding: cs.padding,
                    gap: cs.gap,
                    h: Math.round(bar.getBoundingClientRect().height),
                    btns: [...bar.querySelectorAll('button')].map(b => ({
                        cls: b.className.replace('vbm-fit-btn ', '').trim(),
                        w: Math.round(b.getBoundingClientRect().width),
                        h: Math.round(b.getBoundingClientRect().height),
                        color: getComputedStyle(b).color,
                        font: getComputedStyle(b).fontSize
                    }))
                });
            }
            return JSON.stringify(out);
        };
        await page.click('#view-tab-stats');
        await sleep(900);
        await page.evaluate(() => document.querySelector('.stats-select-mode').click());
        await sleep(700);
        console.log('stats selecting bars:', await page.evaluate(dumpBars, '#stats-list .stats-toolbar'));
        await page.evaluate(() => chrome.storage.local.set({
            deadLastScan: JSON.stringify({ ts: Date.now() - 3600e3, scannedCount: 2, results: {} }),
            deadMarks: JSON.stringify({})
        }));
        await sleep(300);
        await page.click('#view-tab-dead');
        await sleep(1000);
        console.log('dead idle bars (has marks):', await page.evaluate(dumpBars, '#dead-list .dead-toolbar'));

        // --- item 10: closed records persistence ---------------------------------
        await page.click('#view-tab-tabgroups');
        await sleep(1500);
        // close one tab via the row's close button
        await page.evaluate(() => {
            const btn = document.querySelector('.tabgroups-close-tab');
            if (btn) btn.click();
        });
        await sleep(1200);
        console.log('after close (same session):', await page.evaluate(() => JSON.stringify({
            closedGroups: document.querySelectorAll('.tabgroups-closed-group, .tabgroups-closed-tab').length,
            stored: (typeof chrome !== 'undefined') ? 'see-storage' : ''
        })));
        const storedNow = await page.evaluate(() => new Promise(r =>
            chrome.storage.local.get('tabGroupsClosed', v => r(JSON.stringify(v).slice(0, 200)))));
        console.log('storage now:', storedNow);
        // reopen the popup (new page = fresh document)
        const page2 = await browser.newPage();
        await page2.setViewport({ width: 420, height: 640 });
        await page2.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1500);
        await page2.click('#view-tab-tabgroups');
        await sleep(1800);
        console.log('after reopen:', await page2.evaluate(() => JSON.stringify({
            closedRows: document.querySelectorAll('.tabgroups-closed-group, .tabgroups-closed-tab').length,
            closedHeadText: (document.querySelector('.tabgroups-section-head') || {}).textContent || ''
        })));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
