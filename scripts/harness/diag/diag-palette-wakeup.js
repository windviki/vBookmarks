// Reproduce the smoke gate's pre-wake-up steps to isolate why the palette
// wake-up (which opens at t+0ms on a clean page) fails inside the full gate.
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
    const url = p => `chrome-extension://${extId}/pages/popup.html${p}`;

    const reload = async () => { await page.reload({ waitUntil: 'networkidle0' }); await sleep(700); };

    // --- step 1: classic toggle (smoke.js 2c) ---
    console.log('step 1 classic');
    await page.goto(url(''), { waitUntil: 'networkidle0' });
    await page.evaluate(() => chrome.storage.local.set({
        quickAddEnabled: '', showToolButton: '', paletteEnabled: '', showViewTabs: '' }));
    await reload();
    await page.evaluate(() => chrome.storage.local.remove(
        ['quickAddEnabled', 'showToolButton', 'paletteEnabled', 'showViewTabs']));
    await reload();

    // --- step 2: v4 notice (2d) ---
    console.log('step 2 v4 notice');
    await page.evaluate(() => chrome.storage.local.set({ currentVersion: '3.3.0' }));
    await reload();
    await page.evaluate(() => chrome.storage.local.remove('currentVersion'));
    await reload();

    // --- step 3: announce (2d2) ---
    console.log('step 3 announce');
    await page.evaluate(() => chrome.storage.local.set({
        donationDisabled: '1',
        vbmAnnounce: { ts: Date.now(), etag: null, data: { version: 1, messages: [] } }
    }));
    await reload();
    await page.evaluate(() => chrome.storage.local.remove(['donationDisabled', 'vbmAnnounce', 'vbmAnnounceSeen']));
    await reload();

    // --- step 4: outside-bar reveal (2e) ---
    console.log('step 4 outside-bar');
    await page.evaluate(() => chrome.storage.local.set({ onlyShowBMBar: '1' }));
    await reload();
    await page.evaluate(() => chrome.storage.local.remove('onlyShowBMBar'));
    await reload();

    // --- wake-up tests ---
    const poll = async label => {
        for (let i = 0; i < 10; i++) {
            const s = await page.evaluate(() => ({
                hidden: document.getElementById('command-palette').hidden,
                focused: document.activeElement && document.activeElement.id,
                paletteEnabled: (chrome.storage.local.get ? 'n/a' : 'n/a')
            }));
            console.log(`  ${label} t+${i * 300}ms hidden=${s.hidden} focused=${s.focused}`);
            if (!s.hidden && s.focused === 'palette-input') { console.log(`  ${label}: OPEN`); return; }
            await sleep(300);
        }
        console.log(`  ${label}: NOT OPEN`);
    };
    console.log('--- wake ?palette=1 ---');
    await page.goto(url('?palette=1'), { waitUntil: 'networkidle0' });
    await poll('query');
    await page.evaluate(() => chrome.storage.session.set({ pendingPaletteOpen: true }));
    await page.goto(url(''), { waitUntil: 'networkidle0' });
    console.log('--- wake flag ---');
    await poll('flag');

    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
