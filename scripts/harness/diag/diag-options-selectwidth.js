// Truncation probe: at several viewport widths, check every pinned select
// for text truncation (scrollWidth > clientWidth) and overflow past its row.
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
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        page.setDefaultTimeout(120000);
        await page.goto('chrome-extension://' + extId + '/pages/options.html', { waitUntil: 'load' });
        await sleep(1500);
        for (const w of [480, 900, 1280, 1600, 1920]) {
            await page.setViewport({ width: w, height: 1000 });
            await sleep(500);
            const r = await page.evaluate(() => {
                const out = [];
                for (const sel of document.querySelectorAll('.options-list select')) {
                    const li = sel.closest('li');
                    if (!li) continue;
                    const s = sel.getBoundingClientRect();
                    const l = li.getBoundingClientRect();
                    out.push({
                        id: sel.id,
                        trunc: sel.scrollWidth > sel.clientWidth,
                        overflow: Math.round(s.right - l.right)
                    });
                }
                return out.filter(x => x.trunc || x.overflow > 0);
            });
            console.log(w + 'px ' + JSON.stringify(r));
        }
        console.log('done');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
