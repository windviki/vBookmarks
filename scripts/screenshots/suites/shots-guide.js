// vBookmarks guide screenshots — two states the acceptance suites don't
// cover: the search view's dual zone with a populated history, and the
// options page's Views group card (both used by docs/guide-v4*.md).
// Runs inside zenika/alpine-chrome:with-puppeteer; shots land in /tmp/shots.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'Figma — Design System', url: 'https://www.figma.com/files/design-system' });
    await create({ parentId: work.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/tagged/chrome-extension' });
    await create({ parentId: '1', title: 'Hacker News', url: 'https://news.ycombinator.com' });

    // Duplicate groups for the dupes selection-mode shot
    await create({ parentId: work.id, title: 'MDN Web Docs (copy)', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: '1', title: 'MDN Web Docs (old)', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: '1', title: 'GitHub mirror', url: 'https://github.com/vBookmarks' });

    // Dead links + a cached scan for the dead selection-mode shot
    const dead1 = await create({ parentId: '1', title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
    const dead2 = await create({ parentId: '1', title: 'Bogus host', url: 'https://thishost.does.not.exist.example/' });
    await new Promise(r => chrome.storage.local.set({
        deadLastScan: JSON.stringify({
            ts: Date.now() - 3600e3,
            scannedCount: 8,
            results: {
                [dead1.id]: { status: 'dead', code: 404 },
                [dead2.id]: { status: 'dead', code: 0, error: 'ERR_NAME_NOT_RESOLVED' }
            }
        }),
        // Silence the donation ask + the 3.x→4.x upgrade notice in every shot
        currentVersion: chrome.runtime.getManifest().version,
        donationFactor: 1,
        donationKey: 30
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
        page.on('console', m => { if (m.type() === 'error') errors.push(`${tag} console.error: ${m.text()}`); });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;

    const seedPage = await browser.newPage();
    watch(seedPage, 'seed');
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(600);
    await seedPage.close();

    // --- 1. search dual zone -------------------------------------------------
    // Drive the real UI: two queries recorded via the leave-view timing, then
    // re-enter — the guide's "box kept as-is + history top zone + results
    // bottom zone retained" state (docs/v4task-2.md appendix B item 5). The
    // empty-box variant is NOT reachable here: every clear path except the
    // capture-phase Esc (which CDP cannot dispatch — docs/cdp-escape-limitation.md)
    // quits back to the tree.
    const page = await browser.newPage();
    watch(page, 'popup');
    await page.setViewport({ width: 400, height: 640 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    const typeQuery = async q => {
        await page.evaluate(() => {
            const i = document.getElementById('search-input');
            i.value = '';
            i.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await page.click('#search-input');
        await page.keyboard.type(q, { delay: 40 });
        await sleep(600);
    };
    await typeQuery('github');
    await page.click('#view-tab-tree'); await sleep(400);   // records 'github'
    await typeQuery('figma');
    await page.click('#view-tab-tree'); await sleep(400);   // records 'figma'
    await page.click('#view-tab-search'); await sleep(600);
    const dual = await page.evaluate(() => ({
        input: document.getElementById('search-input').value,
        searchVisible: !document.getElementById('view-search').hidden,
        histRows: document.querySelectorAll('#search-history-area li.search-history-row').length,
        resRows: document.querySelectorAll('#results li').length
    }));
    console.log('dual zone state:', JSON.stringify(dual));
    if (!dual.searchVisible || dual.input !== 'figma' || !dual.histRows || !dual.resRows)
        errors.push(`dual zone not populated: ${JSON.stringify(dual)}`);
    await page.screenshot({ path: '/tmp/shots/guide-search-dualzone.png' });

    // --- 1b. dupes view: selection mode with one group ticked --------------
    // The batch bar (count + all/invert/clear/apply/exit) replaces the idle
    // toolbar; head/member clicks toggle the whole group (guide §3.5).
    // Clear the search box first so the shot isn't carrying the dual-zone
    // query over an unrelated view.
    await page.evaluate(() => {
        const i = document.getElementById('search-input');
        i.value = '';
        i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(400);
    await page.click('#view-tab-dupes'); await sleep(700);
    const dupesSelect = await page.evaluate(() => {
        const btn = document.querySelector('#view-dupes .dupes-select-mode');
        if (!btn) return { entry: false };
        btn.click();
        return { entry: true };
    });
    await sleep(400);
    if (!dupesSelect.entry)
        errors.push('dupes select-mode entry button not found');
    else {
        await page.evaluate(() => {
            const li = document.querySelector('#view-dupes ul.selecting li[data-key]');
            if (!li) throw new Error('no dupes group row in selection mode');
            li.querySelector('.group-head, a, span').click();
        });
        await sleep(400);
        const st = await page.evaluate(() => ({
            bar: !!document.querySelector('#view-dupes .dupes-toolbar.selecting-bar'),
            sel: document.querySelectorAll('#view-dupes .dupes-group.sel').length
        }));
        if (!st.bar || !st.sel)
            errors.push(`dupes selection state wrong: ${JSON.stringify(st)}`);
        await page.screenshot({ path: '/tmp/shots/guide-dupes-select.png' });
    }

    // --- 1c. dead view: selection mode with one row ticked ------------------
    // Cached scan from the seed puts results on screen (the 选择 entry only
    // renders with results); row clicks toggle membership (guide §3.4).
    await page.click('#view-tab-dead'); await sleep(700);
    const deadSelect = await page.evaluate(() => {
        const btn = document.querySelector('#view-dead .dead-select-mode');
        if (!btn) return { entry: false };
        btn.click();
        return { entry: true };
    });
    await sleep(400);
    if (!deadSelect.entry)
        errors.push('dead select-mode entry button not found');
    else {
        await page.evaluate(() => {
            const li = document.querySelector('#view-dead ul.selecting li[data-node-id]');
            if (!li) throw new Error('no dead result row in selection mode');
            li.querySelector('a, span').click();
        });
        await sleep(400);
        const st = await page.evaluate(() => ({
            bar: !!document.querySelector('#view-dead .select-count'),
            sel: document.querySelectorAll('#view-dead li.sel').length
        }));
        if (!st.bar || !st.sel)
            errors.push(`dead selection state wrong: ${JSON.stringify(st)}`);
        await page.screenshot({ path: '/tmp/shots/guide-dead-select.png' });
    }

    // --- 2. options page: the Views group card -------------------------------
    const opts = await browser.newPage();
    watch(opts, 'options');
    await opts.setViewport({ width: 960, height: 800 });
    await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    const group = await opts.evaluateHandle(() =>
        document.getElementById('views-options').closest('section'));
    await opts.evaluate(() =>
        document.getElementById('views-options').closest('section').scrollIntoView());
    await sleep(300);
    await group.screenshot({ path: '/tmp/shots/guide-options-views.png' });

    console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS (guide shots)');
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('GUIDE SHOTS FAIL:', e.message); process.exit(2); });
