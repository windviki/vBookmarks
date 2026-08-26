// pc-save/pc-cancel row geometry: click Add to reveal the form, measure
// the footer buttons against the card edges.
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    if (!fs.existsSync('/tmp/shots')) fs.mkdirSync('/tmp/shots', { recursive: true });
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2500);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.setViewport({ width: 480, height: 900 });
        await page.goto('chrome-extension://' + extId + '/pages/options.html', { waitUntil: 'load' });
        await sleep(1500);
        await page.evaluate(() => document.getElementById('palette-cmd-add').click());
        await sleep(500);
        const r = await page.evaluate(() => {
            const row = document.getElementById('pc-save').closest('li');
            const l = row.getBoundingClientRect();
            const s = document.getElementById('pc-save').getBoundingClientRect();
            const c = document.getElementById('pc-cancel').getBoundingClientRect();
            const disp = getComputedStyle(row).display;
            return {
                li: { l: Math.round(l.left), r: Math.round(l.right), w: Math.round(l.width) },
                save: { l: Math.round(s.left), r: Math.round(s.right), w: Math.round(s.width) },
                cancel: { l: Math.round(c.left), r: Math.round(c.right), w: Math.round(c.width) },
                liDisplay: disp
            };
        });
        console.log('PCROW ' + JSON.stringify(r));
        await page.evaluate(() => document.getElementById('palette-cmd-form').scrollIntoView());
        await sleep(400);
        await page.screenshot({ path: '/tmp/shots/pc-save-row.png' });
        console.log('done');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
