// vBookmarks theme screenshot harness — v4 task-2 acceptance (docs/
// v4task-2.md §3.2, docs/v4task-2-list.md §5): the view tab strip on all
// five themes plus one full-state shot per view (tree with the dead-mark
// overlay, dupes keeper/will-delete rows, dead status badges, stats count
// pills). Options/advanced shots stay for the two explicit fable themes
// (ink = dark, paper = light).
// Runs inside zenika/alpine-chrome:with-puppeteer; shots land in /tmp/shots.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    const gh = await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'Linear — Issues', url: 'https://linear.app/team/issues' });
    await create({ parentId: work.id, title: 'Figma — Design System', url: 'https://www.figma.com/files/design-system' });
    const dev = await create({ parentId: work.id, title: '开发参考' });
    const mdn = await create({ parentId: dev.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: dev.id, title: 'Chrome Extensions Docs', url: 'https://developer.chrome.com/docs/extensions' });
    await create({ parentId: dev.id, title: 'Can I Use', url: 'https://caniuse.com/esmodules' });
    const read = await create({ parentId: '1', title: '稍后读' });
    await create({ parentId: read.id, title: 'The Grumpy Designer on Calm UI', url: 'https://example.com/calm-ui' });
    await create({ parentId: read.id, title: '少数派：效率工具年度盘点', url: 'https://sspai.com/post/annual-tools' });
    const so = await create({ parentId: '1', title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/tagged/google-chrome-extension' });
    // dupes group (keeper + two will-delete rows) and dead candidates
    await create({ parentId: '1', title: 'GitHub (old)', url: 'https://github.com/vBookmarks' });
    await create({ parentId: read.id, title: 'GitHub Mirror', url: 'https://github.com/vBookmarks' });
    const dead1 = await create({ parentId: '1', title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
    const dead2 = await create({ parentId: '1', title: 'Bogus host', url: 'https://thishost.does.not.exist.example/' });
    const dead3 = await create({ parentId: read.id, title: 'Rotting link', url: 'https://another.dead.example.com/link' });

    const now = Date.now();
    await new Promise(r => chrome.storage.local.set({
        visitStats: JSON.stringify({
            [so.id]: { c: 128, t: now - 60e3 },
            [gh.id]: { c: 42, t: now - 3600e3 },
            [mdn.id]: { c: 7, t: now - 2 * 864e5 }
        }),
        deadMarks: JSON.stringify([dead1.id]),
        deadLastScan: JSON.stringify({
            ts: now - 3600e3,
            scannedCount: 14,
            results: {
                [dead1.id]: { status: 'dead', code: 404 },
                [dead2.id]: { status: 'dead', code: 0, error: 'ERR_NAME_NOT_RESOLVED' },
                [dead3.id]: { status: 'blocked' }
            }
        })
    }, r));
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

    const activateView = (page, id) => page.evaluate(viewId => {
        const tab = document.querySelector(`#view-tab-${viewId}`);
        if (!tab) throw new Error('view tab not found: ' + viewId);
        tab.click();
    }, id);

    for (const theme of ['auto', 'light', 'dark', 'ink', 'paper']) {
        // Popup in this theme. chrome.storage.local overrides the
        // localStorage prefill once loaded, so seed BOTH stores and reload —
        // otherwise a previous iteration's value leaks into this shot.
        const page = await browser.newPage();
        watch(page, `popup-${theme}`);
        await page.setViewport({ width: 400, height: 640 });
        await page.evaluateOnNewDocument(t => {
            try { localStorage.setItem('theme', t); } catch (e) {}
        }, theme);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await page.evaluate(t => chrome.storage.local.set({
            theme: t,
            currentVersion: chrome.runtime.getManifest().version,
            donationFactor: 1,
            donationKey: 30
        }), theme);
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(1200);
        // §3.2 acceptance: tab strip (all six views) + the tree carrying a
        // dead-mark × overlay row (the marked GitHub (old) sits at the bar
        // root — expanding the bar root is enough).
        await clickFolder(page, 'Bookmarks bar').catch(() => clickFolder(page, '书签栏'));
        await sleep(400);
        await clickFolder(page, '工作区');
        await sleep(400);
        await page.screenshot({ path: `/tmp/shots/theme-${theme}-tabs.png` });

        // Full-state rows of the remaining list views (§5 五主题验收截图).
        await activateView(page, 'dupes');
        await sleep(500);
        await page.screenshot({ path: `/tmp/shots/theme-${theme}-dupes.png` });
        await activateView(page, 'dead');
        await sleep(500);
        await page.screenshot({ path: `/tmp/shots/theme-${theme}-dead.png` });
        await activateView(page, 'stats');
        await sleep(500);
        await page.screenshot({ path: `/tmp/shots/theme-${theme}-stats.png` });
        await page.close();

        // Options + advanced options keep their ink/paper coverage.
        if (theme !== 'ink' && theme !== 'paper')
            continue;

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
        // the Views group (with the per-view show/hide switches) sits below
        // the fold — scroll it into view like the advanced page's CodeMirror
        await opts.evaluate(() => {
            const el = document.getElementById('views-options');
            if (el) el.scrollIntoView({ block: 'start' });
        });
        await sleep(300);
        await opts.screenshot({ path: `/tmp/shots/theme-${theme}-options.png` });
        await opts.close();

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
