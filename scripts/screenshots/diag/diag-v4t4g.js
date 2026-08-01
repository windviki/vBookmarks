// v4 task-4 #13: the dead view's two stacked toolbars are two arrow rungs.
// Chain under test: strip ⇅ proxy strip ⇅ scan toolbar ⇅ rows.
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
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        return page;
    };
    const seed = await openPopup();
    const ids = await seed.evaluate(() => new Promise(r => {
        const mk = (title, url) => new Promise(res => chrome.bookmarks.create({ title, url }, b => res(b.id)));
        (async () => {
            const rest = [];
            for (let i = 1; i <= 5; i++)
                rest.push(await mk(`b${i}`, `https://example.com/b${i}`));
            const results = {};
            results[rest[0]] = { status: 'dead', code: 404 };
            for (let i = 1; i < rest.length; i++)
                results[rest[i]] = { status: 'ok', code: 200 };
            chrome.storage.local.set({
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1, donationKey: 30,
                activeView: 'tree',
                deadLastScan: JSON.stringify({ ts: Date.now(), scannedCount: rest.length, results })
            }, () => r({ dead1: rest[0] }));
        })();
    }));
    await sleep(300);
    await seed.close();

    const page = await openPopup();
    await page.evaluate(() => { // keep the donation banner out of the Esc chain
        const b = document.getElementById('donation');
        if (b && b.style.display !== 'none') {
            const l = document.getElementById('donation-later');
            if (l) l.click();
        }
    });
    await page.click('#view-tab-dead');
    await sleep(800);
    const key = async k => { await page.keyboard.press(k); await sleep(250); };
    const where = () => page.evaluate(() => {
        const ae = document.activeElement;
        return {
            cls: ae && ae.className && ae.className.baseVal === undefined ? String(ae.className) : (ae && ae.tagName),
            id: ae && ae.id,
            inProxyStrip: !!(ae && ae.closest && ae.closest('.dead-proxy-strip')),
            inDeadToolbar: !!(ae && ae.closest && ae.closest('.dead-toolbar')),
            inRows: !!(ae && ae.closest && ae.closest('#view-dead li')),
            isTab: !!(ae && ae.classList && ae.classList.contains('view-tab'))
        };
    });

    const out = {};
    // Start on the proxy strip's only control (no proxy configured → Add).
    await page.focus('.dead-proxy-strip button');
    out.start = await where();
    await key('ArrowDown');           // proxy strip → scan toolbar
    out.down1 = await where();
    await key('ArrowDown');           // scan toolbar → rows
    out.down2 = await where();
    await key('ArrowUp');             // rows → LOWEST toolbar (scan toolbar)
    // focus was on first row; ArrowUp from first row crosses out
    out.up1 = await where();
    await key('ArrowUp');             // scan toolbar → proxy strip
    out.up2 = await where();
    await key('ArrowUp');             // proxy strip → tab strip
    out.up3 = await where();
    // ←/→ stay within one rung (walk the scan toolbar's controls)
    await page.focus('.dead-toolbar button');
    await key('ArrowRight');
    out.rightWalk = await where();

    console.log(JSON.stringify(out, null, 2));
    const pass =
        out.start.inProxyStrip &&
        out.down1.inDeadToolbar &&
        out.down2.inRows &&
        out.up1.inDeadToolbar &&
        out.up2.inProxyStrip &&
        out.up3.isTab &&
        out.rightWalk.inDeadToolbar;
    console.log(pass ? 'PASS' : 'FAIL');
    await browser.close();
    process.exit(pass ? 0 : 2);
})().catch(e => { console.error('FAIL', e); process.exit(2); });
