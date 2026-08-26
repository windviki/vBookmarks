// Options-page UI audit shots, round 2 (2026-08-26 选项页修补): full-page
// captures at three widths + the custom-icon button band + the palette
// command form opened (Add clicked) for the pinned text-field rows.
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
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.goto('chrome-extension://' + extId + '/pages/options.html', { waitUntil: 'load' });
        await sleep(1500);
        if (!fs()) fs();
        function fs() { return require('fs').mkdirSync('/tmp/shots', { recursive: true }); }

        // Custom-icon band geometry: both buttons fill the row, right button
        // lands flush on the card's content edge.
        await page.setViewport({ width: 480, height: 900 });
        await sleep(400);
        const icon = await page.evaluate(() => {
            const li = document.getElementById('default-icon-button').closest('li');
            const l = li.getBoundingClientRect();
            const b1 = document.getElementById('default-icon-button').getBoundingClientRect();
            const b2 = document.getElementById('custom-icon-pick').getBoundingClientRect();
            return { li: { r: Math.round(l.right) }, b1: { l: Math.round(b1.left), r: Math.round(b1.right), w: Math.round(b1.width) }, b2: { l: Math.round(b2.left), r: Math.round(b2.right), w: Math.round(b2.width) } };
        });
        console.log('ICONBAND ' + JSON.stringify(icon));
        await page.evaluate(() => document.getElementById('custom-icon').scrollIntoView());
        await sleep(400);
        await page.screenshot({ path: '/tmp/shots/options-icon-band.png' });

        // Palette form: click Add to reveal the editor, then measure the
        // pinned text fields + selects.
        await page.evaluate(() => document.getElementById('palette-cmd-add').click());
        await sleep(500);
        const form = await page.evaluate(() => {
            const row = id => {
                const li = document.getElementById(id).closest('li');
                const r = li.getBoundingClientRect();
                const c = document.getElementById(id).getBoundingClientRect();
                return { li: { r: Math.round(r.right) }, c: { l: Math.round(c.left), r: Math.round(c.right), w: Math.round(c.width) } };
            };
            return {
                pcName: row('pc-name'),
                pcUrl: row('pc-url'),
                pcAction: row('pc-action'),
                pcWhere: row('pc-where')
            };
        });
        console.log('PALETTEFORM ' + JSON.stringify(form));
        await page.evaluate(() => document.getElementById('palette-cmd-form').scrollIntoView());
        await sleep(400);
        await page.screenshot({ path: '/tmp/shots/options-palette-form.png' });

        // Full-page captures at three widths for the whole-page review.
        for (const w of [480, 900, 1600]) {
            await page.setViewport({ width: w, height: 1000 });
            await sleep(600);
            await page.screenshot({ path: '/tmp/shots/options-full-' + w + '.png', fullPage: true });
        }
        console.log('done');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
