// Post-fix verification #2 (radio margin fixed): header centers, hint gaps,
// sort lefts, storage bar + tooltip.
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
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(sw.url()).hostname;
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    const out = await page.evaluate(() => {
        const q = s => document.querySelector(s);
        const rect = el => { const r = el.getBoundingClientRect(); return { c: +((r.top + r.bottom) / 2).toFixed(1) }; };
        const sortSec = document.querySelector('.options-group:has(> h2#sort-options)');
        const out = {
            header: ['#ext-name', '#small-options', '#header-links', '#options-version'].map(s => ({ s, ...rect(q(s)) })),
            sort: [...sortSec.querySelectorAll(':scope > .options-list > li')].map(li => {
                const inp = li.querySelector('input');
                return { type: inp.type, left: +inp.getBoundingClientRect().left.toFixed(1), id: inp.id };
            })
        };
        out.storage = {
            legendCount: q('#storage-usage-legend').children.length,
            iconAria: q('#usage-icon').getAttribute('aria-label')
        };
        return out;
    });
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
