// E2E: the no-favicon bookmark row must render our SVG globe (not the
// _favicon <img>) on every theme; a real favicon row (if any) must keep img.
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const swTarget = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;
    const openPopup = async () => {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.setViewport({ width: 420, height: 600 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(900);
        return page;
    };

    const seed = await openPopup();
    await seed.evaluate(() => new Promise(r => {
        chrome.bookmarks.create({ parentId: '1', title: 'NoIcon Site', url: 'http://127.0.0.1:9/noicon' }, () =>
            chrome.storage.local.set({
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1, donationKey: 30
            }, r));
    }));
    await sleep(300);
    await seed.close();

    fs.mkdirSync('/tmp/shots', { recursive: true });
    const out = {};
    for (const theme of ['dark', 'ink', 'light']) {
        const p = await openPopup();
        await p.evaluate(t => new Promise(r => chrome.storage.local.set({ theme: t }, r)), theme);
        await p.reload({ waitUntil: 'networkidle0' });
        await sleep(1200);
        // expand the Bookmarks bar root so the seeded row renders
        await p.evaluate(() => {
            const span = [...document.querySelectorAll('#tree span.tree-item-span')][0];
            if (span) span.click();
        });
        await sleep(800);
        out[theme] = await p.evaluate(() => {
            const link = [...document.querySelectorAll('#tree a.tree-item-link')]
                .find(a => (a.querySelector('i')?.textContent || '').includes('NoIcon'));
            if (!link) return { row: false };
            const slot = link.querySelector('.favicon-container');
            const svg = slot.querySelector('svg.vbm-icon-doc');
            const img = slot.querySelector('img');
            return {
                row: true,
                swappedToSvg: !!svg,
                imgGone: !img,
                stroke: svg && svg.getAttribute('stroke'),
                slotColor: svg && getComputedStyle(svg).color,
                slotHtml: slot.innerHTML.slice(0, 140)
            };
        });
        await p.screenshot({ path: `/tmp/shots/favicon-${theme}.png` });
        await p.close();
    }
    console.log(JSON.stringify(out, null, 2));
    const pass = ['dark', 'ink', 'light'].every(t => out[t].swappedToSvg && out[t].imgGone);
    console.log(pass ? 'DIAG PASS' : 'DIAG FAIL');
    await browser.close();
    process.exit(pass ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
