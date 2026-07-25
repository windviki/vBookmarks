// vBookmarks UI/UX screenshot harness — seeds a realistic bookmark tree and
// captures the main interaction states in light + dark themes.
// Runs inside zenika/alpine-chrome:with-puppeteer; shots land in /tmp/shots.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'Linear — Issues', url: 'https://linear.app/team/issues' });
    await create({ parentId: work.id, title: 'Figma — Design System', url: 'https://www.figma.com/files/design-system' });
    await create({ parentId: work.id, title: 'Vercel Dashboard', url: 'https://vercel.com/dashboard' });
    const dev = await create({ parentId: work.id, title: '开发参考' });
    await create({ parentId: dev.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: dev.id, title: 'Chrome Extensions Docs', url: 'https://developer.chrome.com/docs/extensions' });
    await create({ parentId: dev.id, title: 'Can I Use', url: 'https://caniuse.com/esmodules' });
    await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/tagged/google-chrome-extension' });
    const read = await create({ parentId: '1', title: '稍后读' });
    await create({ parentId: read.id, title: 'The Grumpy Designer on Calm UI', url: 'https://example.com/calm-ui' });
    await create({ parentId: read.id, title: '少数派：效率工具年度盘点', url: 'https://sspai.com/post/annual-tools' });
    await create({ parentId: read.id, title: 'A List Apart — Typography', url: 'https://alistapart.com/topic/typography' });
    await create({ parentId: '1', title: '分隔符', url: 'http://separatethis.com/' });
    await create({ parentId: '1', title: 'Hacker News', url: 'https://news.ycombinator.com' });
    await create({ parentId: '1', title: 'Planet Mozilla', url: 'https://planet.mozilla.org' });
    await create({ parentId: '1', title: 'Archive Page (bookmarklet)', url: 'javascript:void(location.href="https://web.archive.org/web/"+location.href)' });
    const misc = await create({ parentId: '2', title: '灵感' });
    await create({ parentId: misc.id, title: 'Awwwards', url: 'https://www.awwwards.com' });
    await create({ parentId: misc.id, title: 'Dribbble', url: 'https://dribbble.com/shots' });
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
    const light = async page =>
        page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    // --- seed -------------------------------------------------------------
    const seedPage = await browser.newPage();
    watch(seedPage, 'seed');
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    await seedPage.evaluate(SEED);
    await sleep(500);
    await seedPage.close();

    // --- popup states -----------------------------------------------------
    const page = await browser.newPage();
    watch(page, 'popup');
    await page.setViewport({ width: 400, height: 640 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    // Silence the donation ask until state 12 explicitly enables it (the
    // seed page's storage writes race this first open, so newOrUpgrade is
    // not deterministic otherwise).
    await page.evaluate(() => chrome.storage.local.set({
        currentVersion: chrome.runtime.getManifest().version,
        donationFactor: 1,
        donationKey: 30
    }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1200);

    const clickFolder = async name => page.evaluate(n => {
        const span = [...document.querySelectorAll('#tree span.tree-item-span')]
            .find(s => (s.querySelector('i')?.textContent || '').trim() === n);
        if (!span) throw new Error('folder not found: ' + n);
        span.click();
    }, name);

    // Expand: Bookmarks bar root → 工作区 → 开发参考 (nested)
    await clickFolder('Bookmarks bar').catch(() => clickFolder('书签栏'));
    await sleep(400);
    await clickFolder('工作区');
    await sleep(400);
    await clickFolder('开发参考');
    await sleep(400);

    await light(page);
    await sleep(300);
    await page.screenshot({ path: '/tmp/shots/01-tree-light.png' });
    await dark(page);
    await sleep(300);
    await page.screenshot({ path: '/tmp/shots/02-tree-dark.png' });

    // Search state (dark): fuzzy results with <mark> highlights
    await page.focus('#search-input');
    await page.type('#search-input', 'git', { delay: 40 });
    await sleep(700);
    await page.screenshot({ path: '/tmp/shots/03-search-dark.png' });
    await page.evaluate(() => { document.querySelector('#search-input').value = ''; });
    await page.keyboard.press('Escape');
    await sleep(400);

    // Command palette (dark): Ctrl+K, then filter folders
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.type('#palette-input', '工作', { delay: 60 }).catch(() => {});
    await sleep(500);
    await page.screenshot({ path: '/tmp/shots/04-palette-dark.png' });
    await page.keyboard.press('Escape');
    await sleep(400);

    // Context menu (light): right-click the GitHub bookmark row
    await light(page);
    await sleep(300);
    await page.evaluate(() => {
        const link = [...document.querySelectorAll('#tree a.tree-item-link')]
            .find(a => (a.querySelector('i')?.textContent || '').includes('GitHub'));
        if (!link) throw new Error('GitHub row not found');
        link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: link.getBoundingClientRect().top + 8 }));
    });
    await sleep(500);
    await page.screenshot({ path: '/tmp/shots/05-contextmenu-light.png' });

    // Edit dialog (dark): Escape closes the menu (row stays active), F2 opens it
    await dark(page);
    await sleep(200);
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.keyboard.press('F2');
    await sleep(500);
    const dialogOpen = await page.evaluate(() =>
        !document.querySelector('#edit-dialog').matches('[style*="opacity: 0"]') &&
        getComputedStyle(document.querySelector('#edit-dialog')).opacity === '1');
    console.log('edit dialog open:', dialogOpen);
    await page.screenshot({ path: '/tmp/shots/06-dialog-dark.png' });
    await page.keyboard.press('Escape');
    await sleep(400);

    // Undo toast (light): right-click another row, Escape, then Delete
    await light(page);
    await sleep(200);
    await page.evaluate(() => {
        const link = [...document.querySelectorAll('#tree a.tree-item-link')]
            .find(a => (a.querySelector('i')?.textContent || '').includes('Planet Mozilla'));
        if (!link) throw new Error('Planet Mozilla row not found');
        link.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: link.getBoundingClientRect().top + 8 }));
    });
    await sleep(400);
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.keyboard.press('Delete');
    await sleep(700);
    const toastVisible = await page.evaluate(() => {
        const t = document.querySelector('#undo-toast');
        return t && !t.hidden && getComputedStyle(t).display !== 'none';
    });
    console.log('undo toast visible:', toastVisible);
    await page.screenshot({ path: '/tmp/shots/07-toast-light.png' });

    // Donation card (light): max the snooze counter so the gentle-ask card
    // shows on the next open (newOrUpgrade is false by now — the seed page
    // was the first open, so this run takes the donationFactor path).
    await page.evaluate(() => chrome.storage.local.set({ donationFactor: 100, donationKey: 30 }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1200);
    const donationShown = await page.evaluate(() => {
        const d = document.querySelector('#donation');
        return d && getComputedStyle(d).display !== 'none';
    });
    console.log('donation card visible:', donationShown);
    await page.screenshot({ path: '/tmp/shots/12-donation-light.png' });

    // Recent view (light): the in-tree recent section became its own tab in
    // v4 task-2 slice B — state 13 now captures the view.
    await page.evaluate(() => chrome.storage.local.set({ donationFactor: 1 }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(1200);
    await page.evaluate(() => {
        const tab = document.querySelector('#view-tab-recent');
        if (!tab) throw new Error('recent view tab not found');
        tab.click();
    });
    await sleep(500);
    await page.screenshot({ path: '/tmp/shots/13-recent-view-light.png' });
    await page.close();

    // --- options page ------------------------------------------------------
    const opts = await browser.newPage();
    watch(opts, 'options');
    await opts.setViewport({ width: 760, height: 700 });
    await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    await light(opts);
    await sleep(300);
    await opts.screenshot({ path: '/tmp/shots/08-options-light.png' });
    await dark(opts);
    await sleep(300);
    await opts.screenshot({ path: '/tmp/shots/09-options-dark.png' });
    await opts.close();

    // --- advanced options (dark, CodeMirror) -------------------------------
    const adv = await browser.newPage();
    watch(adv, 'advanced');
    await adv.setViewport({ width: 760, height: 700 });
    await adv.goto(`chrome-extension://${extId}/pages/advanced-options.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    await dark(adv);
    await sleep(300);
    await adv.screenshot({ path: '/tmp/shots/10-advanced-dark.png' });
    await adv.close();

    // --- side panel (light) -------------------------------------------------
    const panel = await browser.newPage();
    watch(panel, 'panel');
    await panel.setViewport({ width: 360, height: 720 });
    await panel.goto(`chrome-extension://${extId}/pages/sidepanel.html`, { waitUntil: 'networkidle0' });
    await panel.evaluate(() => chrome.storage.local.set({
        currentVersion: chrome.runtime.getManifest().version,
        donationFactor: 1,
        donationKey: 30
    }));
    await panel.reload({ waitUntil: 'networkidle0' });
    await sleep(1200);
    await light(panel);
    await sleep(300);
    await panel.evaluate(() => {
        const span = [...document.querySelectorAll('#tree span.tree-item-span')]
            .find(s => (s.querySelector('i')?.textContent || '').trim() === 'Bookmarks bar');
        if (span) span.click();
    });
    await sleep(500);
    await panel.screenshot({ path: '/tmp/shots/11-panel-light.png' });
    await panel.close();

    console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => {
    console.error('SHOTS FAIL:', e.message);
    process.exit(2);
});
