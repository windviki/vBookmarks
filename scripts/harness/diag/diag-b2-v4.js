// Batch-2 diagnostics v4: bisect the zero-size history rows —
//   case 1: panel mode only (no selection round trip)
//   case 2: popup mode + selection round trip
//   case 3: panel mode + selection round trip (the v3 repro)
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

        const run = async (label, panel, roundTrip, w, h) => {
            const page = await browser.newPage();
            await page.setViewport({ width: w, height: h });
            page.on('pageerror', e => console.log(`[${label}] PAGEERROR:`, e.message));
            await page.goto(`chrome-extension://${extId}/pages/popup.html${panel ? '?panel=1' : ''}`, { waitUntil: 'load' });
            await sleep(1200);
            await page.evaluate(async () => {
                const now = Date.now();
                await new Promise(r => chrome.storage.local.set({
                    searchHistory: JSON.stringify([
                        { q: 'zzalpha', ts: now - 60e3, n: 3 },
                        { q: 'zzbeta', ts: now - 120e3, n: 5 }
                    ]),
                    activeView: 'tree'
                }, r));
            });
            await page.reload({ waitUntil: 'load' });
            await sleep(1200);
            await page.click('#view-tab-search');
            await sleep(500);
            const before = await page.evaluate(() => {
                const a = document.querySelector('#search-history-area a[data-q]');
                const area = document.getElementById('search-history-area');
                const sec = document.getElementById('view-search');
                const r = a ? a.getBoundingClientRect() : null;
                return {
                    rows: document.querySelectorAll('#search-history-area a[data-q]').length,
                    aRect: r ? { top: Math.round(r.top), h: Math.round(r.height) } : null,
                    areaH: Math.round(area.getBoundingClientRect().height),
                    secH: Math.round(sec.getBoundingClientRect().height),
                    areaCS: { maxH: getComputedStyle(area).maxHeight, disp: getComputedStyle(area).display, ov: getComputedStyle(area).overflow },
                    bodyClass: document.body.className
                };
            });
            if (roundTrip) {
                await page.type('#search-input', 'zz');
                await sleep(600);
                await page.evaluate(() => {
                    const btn = document.querySelector('#results .search-select-mode');
                    if (btn) btn.click();
                });
                await sleep(400);
                await page.evaluate(() => {
                    const btn = document.querySelector('.search-select-exit');
                    if (btn) btn.click();
                });
                await sleep(400);
                await page.evaluate(() => {
                    const input = document.getElementById('search-input');
                    input.value = '';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                });
                await sleep(400);
            }
            const after = await page.evaluate(() => {
                const a = document.querySelector('#search-history-area a[data-q]');
                const area = document.getElementById('search-history-area');
                const r = a ? a.getBoundingClientRect() : null;
                return {
                    aRect: r ? { top: Math.round(r.top), h: Math.round(r.height) } : null,
                    areaH: Math.round(area.getBoundingClientRect().height),
                    areaScrollH: area.scrollHeight, areaClientH: area.clientHeight
                };
            });
            console.log(`[${label}] before:`, JSON.stringify(before));
            console.log(`[${label}] after:`, JSON.stringify(after));
            await page.close();
        };

        await run('panel-only', true, false, 800, 800);
        await run('popup+roundtrip', false, true, 800, 800);
        await run('panel+roundtrip', true, true, 800, 800);
        await run('popup-narrow+roundtrip', false, true, 400, 620);
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
