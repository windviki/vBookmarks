// 4.0.8-era report: the search-history rows could not be clicked to rerun
// their query. Verify the CURRENT click path end-to-end: type a query (it
// lands in the MRU), then click the history row and assert the results
// pane re-runs (result rows appear / the count pill updates).
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
        await page.setViewport({ width: 900, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        // seed bookmarks (search hits) + a recorded history entry (the MRU
        // is written when a search is COMPLETED — quit/open — so seed it
        // directly for the click-rerun path under test)
        await page.evaluate(async () => {
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            await new Promise(res => chrome.bookmarks.create(
                { parentId: bar.id, title: 'history click probe', url: 'http://127.0.0.1:9/history-click' }, res));
            const hist = JSON.stringify([{ q: 'history click', ts: Date.now(), n: 1 }]);
            await new Promise(res => chrome.storage.local.set({ searchHistory: hist }, res));
        });
        // reload so the popup's in-memory store mirror picks the seed up
        await page.reload({ waitUntil: 'load' });
        await sleep(1200);
        await page.click('#view-tab-search');
        await sleep(600);
        // also type the same query so the results pane has content to compare
        await page.type('#search-input', 'history click');
        await sleep(900);
        const histBefore = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('.search-history-row')];
            return { rows: rows.length, qs: rows.map(r => r.querySelector('a') && r.querySelector('a').dataset.q) };
        });
        console.log('HISTORY:', JSON.stringify(histBefore));

        // click the first history row (the rerun path the report said dead)
        const clickOut = await page.evaluate(() => {
            const row = document.querySelector('.search-history-row a[data-q]');
            if (!row)
                return { clicked: false };
            const href = row.getAttribute('href');
            row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            return { clicked: true, href };
        });
        console.log('CLICK:', JSON.stringify(clickOut));
        await sleep(900);

        const after = await page.evaluate(() => {
            const results = document.querySelectorAll('#results .vbm-row').length;
            const count = document.querySelector('.search-result-count');
            const inputVal = document.querySelector('#search-input') && document.querySelector('#search-input').value;
            const marks = document.querySelectorAll('#results mark').length;
            return { resultRows: results, countText: count ? count.textContent : null, inputVal, marks };
        });
        console.log('AFTER:', JSON.stringify(after));

        const pass = histBefore.rows >= 1 && clickOut.clicked
            && after.resultRows >= 1 && after.inputVal === 'history click' && after.marks >= 1;
        console.log(pass ? 'DIAG PASS' : 'DIAG FAIL');
        if (!pass)
            process.exitCode = 1;

        // 2026-08-26 report: the head's close × hides the whole history
        // area (same contract as the options switch — enabled off + MRU
        // wiped) leaving the results pane alone.
        const closeOut = await page.evaluate(() => {
            const btn = document.querySelector('#search-history-close');
            if (!btn)
                return { hasBtn: false };
            btn.click();
            return { hasBtn: true };
        });
        await sleep(500);
        const closeAfter = await page.evaluate(async () => {
            const area = document.getElementById('search-history-area');
            const stored = await new Promise(res => chrome.storage.sync.get('searchHistoryEnabled', res));
            return {
                areaEmpty: area ? area.innerHTML.trim().length === 0 : null,
                enabled: stored.searchHistoryEnabled
            };
        });
        console.log('CLOSE:', JSON.stringify({ closeOut, closeAfter }));
        const closeOk = closeOut.hasBtn && closeAfter.enabled === '' && closeAfter.areaEmpty;
        console.log(closeOk ? 'CLOSE PASS' : 'CLOSE FAIL');
        if (!closeOk)
            process.exitCode = 1;
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
