// v4 task-4 #9: dupes group head quick-apply button — ✓ glyph, always
// visible, accent color. Screenshot for visual confirmation.
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
        await page.setViewport({ width: 420, height: 600 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        return page;
    };
    const seed = await openPopup();
    await seed.evaluate(() => new Promise(r => {
        chrome.bookmarks.create({ title: 'a1', url: 'https://example.com/x' }, () => {
            chrome.bookmarks.create({ title: 'a2', url: 'https://example.com/x' }, () => {
                chrome.bookmarks.create({ title: 'a3', url: 'https://example.com/x' }, () => {
                    chrome.storage.local.set({
                        currentVersion: chrome.runtime.getManifest().version,
                        donationFactor: 1, donationKey: 30,
                        activeView: 'tree'
                    }, r);
                });
            });
        });
    }));
    await sleep(300);
    await seed.close();

    const page = await openPopup();
    await page.click('#view-tab-dupes');
    await sleep(800);
    const out = await page.evaluate(() => {
        const btn = document.querySelector('.dupes-clean-rest');
        if (!btn)
            return { fail: 'no .dupes-clean-rest button' };
        const cs = getComputedStyle(btn);
        return {
            glyph: btn.textContent,
            visibility: cs.visibility,
            color: cs.color,
            title: btn.title
        };
    });
    console.log(JSON.stringify(out, null, 2));
    require('fs').mkdirSync('/tmp/shots/diag', { recursive: true });
    await page.screenshot({ path: '/tmp/shots/diag/v4t4-dupes-apply.png' });
    const pass = out.glyph === '✓' && out.visibility === 'visible';
    console.log(pass ? 'PASS' : 'FAIL');
    await browser.close();
    process.exit(pass ? 0 : 2);
})().catch(e => { console.error('FAIL', e); process.exit(2); });
