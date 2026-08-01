// Focused probe for v4t4 #1: why doesn't the click apply .active?
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const so = await create({ parentId: '1', title: 'Stack Overflow', url: 'https://stackoverflow.com' });
    const dead1 = await create({ parentId: '1', title: 'Dead Link', url: 'https://example.invalid/dead' });
    const now = Date.now();
    await new Promise(r => chrome.storage.local.set({
        currentVersion: chrome.runtime.getManifest().version,
        donationFactor: 1, donationKey: 30,
        visitStats: JSON.stringify({ [so.id]: { c: 5, t: now } }),
        deadLastScan: JSON.stringify({ ts: now, scannedCount: 1,
            results: { [dead1.id]: { status: 'dead', code: 404 } } })
    }, r));
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const swTarget = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;
    const openPopup = async () => {
        const page = await browser.newPage();
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        return page;
    };
    const seedPage = await openPopup();
    await seedPage.evaluate(SEED);
    await sleep(400);
    await seedPage.close();

    const page = await openPopup();
    // instrument: count renders by wrapping? can't wrap module fns; instead log clicks
    await page.evaluate(() => {
        window.__clicks = [];
        document.getElementById('stats-list').addEventListener('click', e => {
            window.__clicks.push('stats-list saw click on ' + (e.target.className || e.target.tagName));
        }, true);
    });
    await page.evaluate(() => document.querySelector('#view-tab-stats').click());
    await sleep(600);
    const before = await page.evaluate(() => document.querySelector('#stats-list .stats-toolbar').outerHTML.slice(0, 400));
    console.log('BEFORE:', before);
    await page.click('#stats-list .seg-btn[data-sort="recent"]');
    await sleep(800);
    const after = await page.evaluate(() => document.querySelector('#stats-list .stats-toolbar').outerHTML.slice(0, 400));
    console.log('AFTER:', after);
    console.log('CLICKS:', await page.evaluate(() => window.__clicks));
    console.log('statsSort:', await page.evaluate(() => new Promise(r => chrome.storage.local.get('statsSort', r))));
    await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(2); });
