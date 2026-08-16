// Reproduce the FULL smoke gate sequence (2a→2f) on one page to find which
// step makes the palette wake-up fail inside the gate but pass in isolation.
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
    page.on('pageerror', e => console.log('PAGE-ERROR:', e.message));
    await page.setViewport({ width: 400, height: 620 });
    const url = p => `chrome-extension://${extId}/pages/popup.html${p}`;
    const reload = async () => { await page.reload({ waitUntil: 'networkidle0' }); await sleep(900); };

    const activeViewOf = () => page.evaluate(() =>
        (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id);

    const poll = async label => {
        const t0 = Date.now();
        while (Date.now() - t0 < 6000) {
            const s = await page.evaluate(() => ({
                open: !document.getElementById('command-palette').hidden,
                focused: document.activeElement && document.activeElement.id,
                paletteEl: document.getElementById('command-palette').hidden ? 'hidden' : 'SHOWN',
                stored: (async () => (await chrome.storage.local.get('paletteEnabled')).paletteEnabled)()
            }));
            s.stored = await s.stored;
            if (s.open && s.focused === 'palette-input') { console.log(`  ${label}: OPEN at t+${Date.now() - t0}ms stored=${JSON.stringify(s.stored)}`); return true; }
            await sleep(200);
        }
        const s = await page.evaluate(() => ({
            open: !document.getElementById('command-palette').hidden,
            focused: document.activeElement && document.activeElement.id,
            inputValue: document.getElementById('palette-input').value
        }));
        console.log(`  ${label}: NOT OPEN ${JSON.stringify(s)}`);
        return false;
    };

    // 2a popup
    await page.goto(url(''), { waitUntil: 'networkidle0' });
    await sleep(1200);

    // 2b rememberView
    console.log('2b rememberView');
    await page.evaluate(() => chrome.storage.local.set({ activeView: 'recent' }));
    await reload();
    console.log('  2b remembered →', await activeViewOf());
    await page.evaluate(() => chrome.storage.local.set({ rememberView: '' }));
    await reload();
    console.log('  2b classic →', await activeViewOf());
    await page.evaluate(() => chrome.storage.local.remove(['activeView', 'rememberView']));

    // 2c classic
    console.log('2c classic');
    await page.evaluate(() => chrome.storage.local.set({
        quickAddEnabled: '', showToolButton: '', paletteEnabled: '', showViewTabs: '' }));
    await reload();
    await page.evaluate(() => chrome.storage.local.remove(
        ['quickAddEnabled', 'showToolButton', 'paletteEnabled', 'showViewTabs']));
    await reload();

    // 2d v4 notice
    console.log('2d v4 notice');
    await page.evaluate(() => chrome.storage.local.set({ currentVersion: '3.3.0' }));
    await reload();
    await page.evaluate(() => chrome.storage.local.remove('currentVersion'));
    await reload();

    // 2d2 announce + dismiss click (the interactive part the earlier diag skipped)
    console.log('2d2 announce + dismiss');
    await page.evaluate(() => chrome.storage.local.set({
        donationDisabled: '1',
        vbmAnnounce: {
            ts: Date.now(), etag: null,
            data: { version: 1, messages: [{
                id: 'v408-whats-new', minVersion: '4.0.8', maxVersion: '', channel: 'all',
                once: true, display: 'banner', kind: 'tip',
                titleKey: 'announceV408Title', textKey: 'announceV408Text',
                textFallback: { en: 'favicon-enhanced release' }, links: []
            }] }
        }
    }));
    await reload();
    const announceShown = await page.evaluate(() => !document.getElementById('announce').hidden);
    console.log('  2d2 announce shown:', announceShown);
    await page.evaluate(() => document.querySelector('#announce .announce-dismiss').click());
    await sleep(400);
    await page.evaluate(() => chrome.storage.local.remove(
        ['donationDisabled', 'vbmAnnounce', 'vbmAnnounceSeen']));
    await reload();

    // 2e outside-bar reveal with the toast action click (the other skipped bit)
    console.log('2e outside-bar + toast');
    const outsideId = await page.evaluate(async () => {
        const id = (await chrome.bookmarks.create({
            title: 'smoke-diag-outside', url: 'https://diag.invalid/x' })).id;
        await chrome.storage.local.set({ onlyShowBMBar: '1' });
        return id;
    });
    await reload();
    const toastShown = await page.evaluate(() => !document.getElementById('undo-toast').hidden);
    console.log('  2e toast shown:', toastShown);
    await page.evaluate(() => document.getElementById('undo-toast-button').click());
    await sleep(1500);
    await page.evaluate(id => new Promise(resolve => chrome.bookmarks.remove(id, resolve)), outsideId);
    await page.evaluate(() => chrome.storage.local.remove('onlyShowBMBar'));
    await reload();

    // 2f wake-up tests
    console.log('2f wake-up');
    await page.goto(url('?palette=1'), { waitUntil: 'networkidle0' });
    await poll('query');
    await page.evaluate(() => chrome.storage.session.set({ pendingPaletteOpen: true }));
    await page.goto(url(''), { waitUntil: 'networkidle0' });
    await poll('flag');

    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
