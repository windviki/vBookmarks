// v4 task-4 #14: risk banner in the dead/dupes views.
//  - shows on first use, with help link + never + dismiss
//  - × dismisses for the session (reappears on next popup open)
//  - "don't show again" persists (gone on next open)
//  - Esc dismisses the banner (layer 3), Tab ring includes its controls,
//    arrows never land on it
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
        const mk = (title, url) => new Promise(res => chrome.bookmarks.create({ title, url }, b => res(b.id)));
        (async () => {
            await mk('a1', 'https://example.com/x');
            await mk('a2', 'https://example.com/x');
            const dead1 = await mk('b1', 'https://example.com/b1');
            const ok1 = await mk('b2', 'https://example.com/b2');
            const results = {};
            results[dead1] = { status: 'dead', code: 404 };
            results[ok1] = { status: 'ok', code: 200 };
            chrome.storage.local.set({
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1, donationKey: 30,
                activeView: 'tree',
                deadLastScan: JSON.stringify({ ts: Date.now(), scannedCount: 4, results })
            }, r);
        })();
    }));
    await sleep(300);
    await seed.close();

    const out = {};
    const page = await openPopup();
    await page.evaluate(() => { // donation banner out of the Esc chain
        const b = document.getElementById('donation');
        if (b && b.style.display !== 'none') {
            const l = document.getElementById('donation-later');
            if (l) l.click();
        }
    });

    // --- dead view: banner up ----------------------------------------------
    await page.click('#view-tab-dead');
    await sleep(600);
    out.deadBanner = await page.evaluate(() => ({
        shown: !!document.querySelector('#view-dead .risk-banner'),
        text: (document.querySelector('#view-dead .risk-banner i') || {}).textContent,
        href: (document.querySelector('#view-dead .risk-banner-help') || {}).href
    }));
    require('fs').mkdirSync('/tmp/shots', { recursive: true });
    await page.screenshot({ path: '/tmp/shots/v4t4-risk-banner.png' });

    // Tab ring includes banner controls: from the active tab, Tab forward
    // should reach a banner control before the toolbar buttons.
    await page.focus('#view-tab-dead');
    let hops = [];
    for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        await sleep(150);
        hops.push(await page.evaluate(() => {
            const ae = document.activeElement;
            return ae && ae.className && typeof ae.className === 'string' ? ae.className : (ae && ae.tagName);
        }));
    }
    out.tabHops = hops;

    // Arrows skip the banner: focus the scan toolbar, ArrowUp should pass
    // the proxy strip and never land on the banner (banner has no rung).
    await page.focus('.dead-toolbar button');
    await page.keyboard.press('ArrowUp');
    await sleep(200);
    out.arrowUpFromToolbar = await page.evaluate(() => {
        const ae = document.activeElement;
        return ae && ae.className && typeof ae.className === 'string' ? ae.className : '';
    });

    // Esc dismisses the banner (session semantics)
    await page.keyboard.press('Escape');
    await sleep(300);
    out.afterEsc = await page.evaluate(() =>
        !!document.querySelector('#view-dead .risk-banner'));
    await page.close();

    // --- dupes view: banner up, ack via "don't show again" ------------------
    const page2 = await openPopup();
    await page2.evaluate(() => {
        const b = document.getElementById('donation');
        if (b && b.style.display !== 'none') {
            const l = document.getElementById('donation-later');
            if (l) l.click();
        }
    });
    await page2.click('#view-tab-dupes');
    await sleep(800);
    out.dupesBannerShown = await page2.evaluate(() =>
        !!document.querySelector('#view-dupes .risk-banner'));
    // dead banner back after the session dismiss (new popup open)
    await page2.click('#view-tab-dead');
    await sleep(400);
    out.deadBannerBackNextOpen = await page2.evaluate(() =>
        !!document.querySelector('#view-dead .risk-banner'));
    // ack the dead banner
    await page2.click('#view-dead .risk-banner-never');
    await sleep(300);
    out.deadAfterAck = await page2.evaluate(() =>
        !!document.querySelector('#view-dead .risk-banner'));
    await page2.close();

    // --- next open: acked banner stays gone ---------------------------------
    const page3 = await openPopup();
    await page3.click('#view-tab-dead');
    await sleep(600);
    out.deadNextOpenAfterAck = await page3.evaluate(() =>
        !!document.querySelector('#view-dead .risk-banner'));

    console.log(JSON.stringify(out, null, 2));
    const bannerStop = out.tabHops.some(h => /risk-banner/.test(h));
    const pass =
        out.deadBanner.shown && /answer\/96816/.test(out.deadBanner.href || '') &&
        bannerStop &&
        !/risk-banner/.test(out.arrowUpFromToolbar) &&
        out.afterEsc === false &&
        out.dupesBannerShown &&
        out.deadBannerBackNextOpen === true &&
        out.deadAfterAck === false &&
        out.deadNextOpenAfterAck === false;
    console.log(pass ? 'PASS' : 'FAIL');
    await browser.close();
    process.exit(pass ? 0 : 2);
})().catch(e => { console.error('FAIL', e); process.exit(2); });
