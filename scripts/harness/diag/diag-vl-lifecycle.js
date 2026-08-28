// Tiny probe: does the popup page reload itself shortly after boot (which
// would wipe window.* helpers defined by a diag)?
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
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
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.on('framenavigated', f => { if (f === page.mainFrame()) console.log('NAV →', f.url()); });
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(() => { window.__marker = 1; });
        for (let i = 0; i < 12; i++) {
            await sleep(500);
            const alive = await page.evaluate(() => ({ m: window.__marker || 0, href: location.href }));
            console.log('t+' + ((i + 1) * 0.5).toFixed(1) + 's marker=' + alive.m + ' ' + alive.href.slice(-24));
        }
    } finally {
        await browser.close();
    }
}
main().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
