// vBookmarks headless-Chrome smoke test (runs inside zenika/alpine-chrome:with-puppeteer)
// Loads the extension from /ext, opens popup / panel / options pages,
// collects page errors and captures light/dark screenshots.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

    // 1. service worker target → extension id
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found — manifest registration failed?');
    const extId = new URL(swTarget.url()).hostname;
    console.log('extension id:', extId);

    // 2. popup page (light)
    const page = await browser.newPage();
    watch(page, 'popup');
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    const stats = await page.evaluate(() => ({
        title: document.title,
        hasTree: !!document.querySelector('#tree'),
        treeRows: document.querySelectorAll('#tree li').length,
        theme: document.body.dataset.theme,
        quickAdd: !!document.querySelector('#quick-add-btn'),
        search: !!document.querySelector('#search')
    }));
    console.log('popup stats:', JSON.stringify(stats));
    await page.screenshot({ path: '/tmp/shots/popup-light.png' });

    // 3. dark mode via emulated prefers-color-scheme (theme=auto default)
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(400);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    console.log('dark body bg:', darkBg);
    await page.screenshot({ path: '/tmp/shots/popup-dark.png' });

    // 4. side panel page
    const panel = await browser.newPage();
    watch(panel, 'panel');
    await panel.setViewport({ width: 360, height: 700 });
    await panel.goto(`chrome-extension://${extId}/pages/sidepanel.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    const isPanel = await panel.evaluate(() => document.body.classList.contains('panel-mode'));
    console.log('panel-mode:', isPanel);
    await panel.screenshot({ path: '/tmp/shots/panel-dark.png' });

    // 5. options page
    const opts = await browser.newPage();
    watch(opts, 'options');
    await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    const optsStats = await opts.evaluate(() => ({
        themeSelect: !!document.querySelector('#theme-select'),
        sidePanelRow: !!document.querySelector('#open-in-side-panel'),
        recentRow: !!document.querySelector('[id*="recent"]')
    }));
    console.log('options stats:', JSON.stringify(optsStats));
    await opts.screenshot({ path: '/tmp/shots/options.png' });

    // 6. advanced options page (vendored CodeMirror)
    const adv = await browser.newPage();
    watch(adv, 'advanced-options');
    await adv.goto(`chrome-extension://${extId}/pages/advanced-options.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    const advStats = await adv.evaluate(() => ({
        userstyle: !!document.querySelector('#userstyle'),
        codeMirror: !!document.querySelector('.CodeMirror'),
        iconPreview: !!document.querySelector('#custom-icon-preview img')
    }));
    console.log('advanced-options stats:', JSON.stringify(advStats));
    await adv.screenshot({ path: '/tmp/shots/advanced-options.png' });

    console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => {
    console.error('SMOKE FAIL:', e.message);
    process.exit(2);
});
