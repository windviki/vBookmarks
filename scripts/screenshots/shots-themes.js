// vBookmarks theme screenshot harness — captures the explicit fable-taste
// themes (ink = dark, paper = light) on the popup tree and the options page.
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
    await create({ parentId: '1', title: 'Hacker News', url: 'https://news.ycombinator.com' });
    await create({ parentId: '1', title: 'Planet Mozilla', url: 'https://planet.mozilla.org' });
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

    // --- seed -------------------------------------------------------------
    const seedPage = await browser.newPage();
    watch(seedPage, 'seed');
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    await seedPage.evaluate(SEED);
    await sleep(500);
    await seedPage.close();

    // Idempotent: persisted open-state carries over between page loads in
    // the same profile, so only click folders that are actually closed.
    const clickFolder = async (page, name) => page.evaluate(n => {
        const span = [...document.querySelectorAll('#tree span.tree-item-span')]
            .find(s => (s.querySelector('i')?.textContent || '').trim() === n);
        if (!span) throw new Error('folder not found: ' + n);
        if (!span.parentNode.classList.contains('open')) span.click();
    }, name);

    for (const theme of ['ink', 'paper']) {
        // Popup tree in this theme. chrome.storage.local overrides the
        // localStorage prefill once loaded (options page does the same),
        // so seed BOTH stores and reload — otherwise a previous theme
        // iteration's chrome.storage value leaks into this shot.
        const page = await browser.newPage();
        watch(page, `popup-${theme}`);
        await page.setViewport({ width: 400, height: 640 });
        await page.evaluateOnNewDocument(t => {
            try { localStorage.setItem('theme', t); } catch (e) {}
        }, theme);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await page.evaluate(t => chrome.storage.local.set({ theme: t }), theme);
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(1200);
        await clickFolder(page, 'Bookmarks bar').catch(() => clickFolder(page, '书签栏'));
        await sleep(400);
        await clickFolder(page, '工作区');
        await sleep(400);
        await clickFolder(page, '开发参考');
        await sleep(400);
        await page.screenshot({ path: `/tmp/shots/theme-${theme}-tree.png` });
        await page.close();

        // Options page in this theme. chrome.storage.local is the options
        // page's source of truth (it overrides the localStorage prefill),
        // so seed both stores, then reload for a clean read.
        const opts = await browser.newPage();
        watch(opts, `options-${theme}`);
        await opts.setViewport({ width: 760, height: 640 });
        await opts.evaluateOnNewDocument(t => {
            try { localStorage.setItem('theme', t); } catch (e) {}
        }, theme);
        await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
        await opts.evaluate(t => chrome.storage.local.set({ theme: t }), theme);
        await opts.reload({ waitUntil: 'networkidle0' });
        await sleep(1000);
        await opts.screenshot({ path: `/tmp/shots/theme-${theme}-options.png` });
        await opts.close();

        // Advanced options (CodeMirror editor) in this theme
        const adv = await browser.newPage();
        watch(adv, `adv-${theme}`);
        await adv.setViewport({ width: 760, height: 640 });
        await adv.evaluateOnNewDocument(t => {
            try { localStorage.setItem('theme', t); } catch (e) {}
        }, theme);
        await adv.goto(`chrome-extension://${extId}/pages/advanced-options.html`, { waitUntil: 'networkidle0' });
        await adv.evaluate(t => chrome.storage.local.set({ theme: t }), theme);
        await adv.reload({ waitUntil: 'networkidle0' });
        await sleep(1000);
        await adv.evaluate(() => {
            const cm = document.querySelector('.CodeMirror');
            if (cm) cm.scrollIntoView({ block: 'center' });
        });
        await sleep(300);
        await adv.screenshot({ path: `/tmp/shots/theme-${theme}-advanced.png` });
        await adv.close();
    }

    console.log(errors.length ? errors.join('\n') : 'NO PAGE ERRORS');
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
