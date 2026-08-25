// Find the exact element pushing #tabgroups-list to scrollW 227 at z150.
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
        await page.setViewport({ width: 320, height: 600 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html?zoom=150`, { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const t = await new Promise(r => chrome.tabs.create({ url: 'http://127.0.0.1:9/z1', active: false }, r));
            await new Promise(r => chrome.tabs.create({ url: 'http://127.0.0.1:9/z2', active: false }, r));
        });
        await sleep(600);
        await page.click('#view-tab-tabgroups');
        await sleep(1500);
        console.log(await page.evaluate(() => {
            const list = document.getElementById('tabgroups-list');
            const out = { scrollW: list.scrollWidth, clientW: list.clientWidth, wide: [] };
            for (const el of list.querySelectorAll('*')) {
                const r = el.getBoundingClientRect();
                if (r.right > list.getBoundingClientRect().right + 1)
                    out.wide.push(`${el.nodeName.toLowerCase()}.${(typeof el.className === 'string' ? el.className : '').split(' ')[0]} right=${Math.round(r.right)} w=${Math.round(r.width)}`);
            }
            out.wide = out.wide.slice(0, 10);
            const row1 = list.querySelector('.tabgroups-toolbar');
            out.row1Kids = [...row1.children].map(el => ({
                cls: (typeof el.className === 'string' ? el.className : '').split(' ')[0],
                w: Math.round(el.getBoundingClientRect().width),
                flex: getComputedStyle(el).flexShrink
            }));
            return JSON.stringify(out);
        }));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
