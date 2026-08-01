// Probe: boot straight into the search view (rememberView) — does the
// history area render?
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        return page;
    };
    const seed = await openPopup();
    await seed.evaluate(() => new Promise(r => {
        const list = [];
        for (let i = 1; i <= 5; i++)
            list.push({ q: `query-${i}`, ts: Date.now() - i * 60000, n: i });
        chrome.storage.local.set({
            currentVersion: chrome.runtime.getManifest().version,
            donationFactor: 1, donationKey: 30,
            searchHistory: JSON.stringify(list),
            activeView: 'search'
        }, r);
    }));
    await sleep(300);
    await seed.close();

    const page = await openPopup();
    const state = await page.evaluate(() => ({
        activeViewStorage: null, // filled below
        areaLen: document.getElementById('search-history-area').innerHTML.length,
        rows: document.querySelectorAll('#search-history-area .search-history-row').length,
        searchVisible: document.getElementById('view-search').offsetParent !== null,
        treeVisible: document.getElementById('view-tree').offsetParent !== null,
        activeTab: (document.querySelector('.view-tab[aria-selected="true"]') || {}).id
    }));
    console.log(JSON.stringify(state, null, 2));
    await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(2); });
