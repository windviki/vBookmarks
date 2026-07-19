// vBookmarks command-palette feature screenshots — /dupes, /dead, /session.
// Seeds bookmark data (including duplicate URLs for the dupes scan) then
// captures each palette mode. Runs inside zenika/alpine-chrome:with-puppeteer.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));

    // --- Normal bookmarks (so the tree isn't empty) ---
    const work = await create({ parentId: '1', title: '工作区' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com' });
    await create({ parentId: work.id, title: 'MDN', url: 'https://developer.mozilla.org' });
    await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com' });

    // --- Duplicate URLs (3 groups) for /dupes ---
    await create({ parentId: work.id, title: 'GitHub Mirror', url: 'https://github.com' });
    await create({ parentId: '1', title: 'GitHub (old)', url: 'https://github.com' });

    await create({ parentId: '1', title: 'MDN CSS', url: 'https://developer.mozilla.org/docs/Web/CSS' });
    await create({ parentId: work.id, title: 'MDN CSS dup', url: 'https://developer.mozilla.org/docs/Web/CSS' });

    await create({ parentId: '1', title: 'Stack Overflow Q', url: 'https://stackoverflow.com/questions/12345' });
    await create({ parentId: work.id, title: 'SO dup', url: 'https://stackoverflow.com/questions/12345' });

    // --- A dead/non-routable URL for /dead ---
    await create({ parentId: '1', title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
    await create({ parentId: '1', title: 'Bogus host', url: 'https://thishost.does.not.exist.example/' });

    // --- A separator so we can see /dead filtering it ---
    await create({ parentId: '1', title: '|', url: 'http://separatethis.com/sep-1' });
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });

    const errors = [];
    const watch = (page, tag) => {
        page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
        page.on('console', m => {
            if (m.type() === 'error') errors.push(`${tag} console.error: ${m.text()}`);
        });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;
    console.log('extension id:', extId);

    const dark = async page =>
        page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);

    // --- Seed -------------------------------------------------------------
    const seedPage = await browser.newPage();
    watch(seedPage, 'seed');
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    await seedPage.evaluate(SEED);
    await sleep(500);
    await seedPage.close();

    // --- Popup page for palette captures ---------------------------------
    const page = await browser.newPage();
    watch(page, 'popup-palette');
    await page.setViewport({ width: 400, height: 640 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1600);

    await dark(page);
    await sleep(200);

    // --- 14-palette-open: palette in normal mode (command list) ----------
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.screenshot({ path: '/tmp/shots/14-palette-open.png' });

    // --- 15-palette-dupes: /dupes mode after seed -------------------------
    // First close palette, then reopen to trigger the /dupes command
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.type('#palette-input', '/dupes', { delay: 50 });
    await sleep(400);
    await page.keyboard.press('Enter');
    await sleep(800);
    await page.screenshot({ path: '/tmp/shots/15-palette-dupes.png' });

    // --- 16-palette-session: /session save (alert dialog shown) ----------
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.type('#palette-input', '/session', { delay: 50 });
    await sleep(400);
    await page.keyboard.press('Enter');
    await sleep(800);
    await page.screenshot({ path: '/tmp/shots/16-palette-session.png' });

    // Close any alert that popped up
    await page.keyboard.press('Escape');
    await sleep(300);

    // --- 17-palette-dead-scan: /dead mode while scanning -----------------
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.type('#palette-input', '/dead', { delay: 50 });
    await sleep(400);
    await page.keyboard.press('Enter');
    // The scan starts immediately; wait a moment then capture mid-scan
    await sleep(600);
    await page.screenshot({ path: '/tmp/shots/17-palette-dead-scanning.png' });

    // --- 18-palette-dead-results: wait for scan to finish ----------------
    await sleep(15000); // dead links will timeout ~8s each
    await page.screenshot({ path: '/tmp/shots/18-palette-dead-results.png' });

    // --- 19-palette-search: search bookmarks from the palette ------------
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.type('#palette-input', 'git', { delay: 60 });
    await sleep(500);
    await page.screenshot({ path: '/tmp/shots/19-palette-search.png' });

    console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'NO ERRORS (palette shots)');
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => {
    console.error('PALETTE SHOTS FAIL:', e.message);
    process.exit(2);
});
