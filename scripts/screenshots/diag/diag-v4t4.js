// v4 task-4 diagnostics (#1 toolbar highlight, #2 tree indent alignment).
// Reuses the console/diagnose_alignment.js measurement recipe inside a real
// puppeteer popup run. Prints JSON-ish reports to stdout; optionally writes
// screenshots to /tmp/shots.
// Run: docker run --rm vbm-smoke:local node /work/diag/diag-v4t4.js
const puppeteer = require('puppeteer');
const fs = require('fs');
fs.mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Same seed recipe as suites/shots-palette.js: a tree with a nested folder,
// dupes, dead links, visit stats and a cached dead scan so every view has
// content.
const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    const gh = await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com' });
    const mdn = await create({ parentId: work.id, title: 'MDN', url: 'https://developer.mozilla.org' });
    const so = await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com' });
    const sub = await create({ parentId: work.id, title: 'SubFolder' });
    await create({ parentId: sub.id, title: 'Deep bookmark', url: 'https://deep.example.com' });
    await create({ parentId: work.id, title: 'GitHub Mirror', url: 'https://github.com' });
    await create({ parentId: '1', title: 'GitHub (old)', url: 'https://github.com' });
    const dead1 = await create({ parentId: '1', title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
    const dead2 = await create({ parentId: '1', title: 'Bogus host 1', url: 'https://thishost.does.not.exist.example/' });
    const dead3 = await create({ parentId: '1', title: 'Bogus host 2', url: 'https://another.dead.example.com/link' });
    const now = Date.now();
    await new Promise(r => chrome.storage.local.set({
        currentVersion: chrome.runtime.getManifest().version,
        donationFactor: 1,
        donationKey: 30,
        visitStats: JSON.stringify({
            [so.id]: { c: 128, t: now - 60e3 },
            [gh.id]: { c: 42, t: now - 3600e3 },
            [mdn.id]: { c: 7, t: now - 2 * 864e5 }
        }),
        deadMarks: JSON.stringify([dead1.id]),
        deadLastScan: JSON.stringify({
            ts: now - 3600e3,
            scannedCount: 12,
            results: {
                [dead1.id]: { status: 'dead', code: 404 },
                [dead2.id]: { status: 'dead', code: 0, error: 'ERR_NAME_NOT_RESOLVED' },
                [dead3.id]: { status: 'blocked' }
            }
        })
    }, r));
})()`;

// Alignment measurement, verbatim port of diag/console/diagnose_alignment.js
// (returns serializable rows instead of console.table).
const MEASURE = `(() => {
    const rows = document.querySelectorAll('#tree ul li a.tree-item-link, #tree ul li span.tree-item-span');
    const results = [];
    rows.forEach((row, index) => {
        const rect = row.getBoundingClientRect();
        const cs = getComputedStyle(row);
        const paddingLeft = parseFloat(cs.paddingLeft) || 0;
        const isFolder = row.tagName === 'SPAN';
        const title = row.querySelector('i')?.textContent?.trim()?.substring(0, 30) || '(no title)';
        const level = row.closest('li')?.getAttribute('level') || '?';
        let iconLeft = null;
        const favicon = row.querySelector('.favicon-container');
        if (favicon)
            iconLeft = favicon.getBoundingClientRect().left;
        let textLeft = null;
        const iEl = row.querySelector('i');
        if (iEl)
            textLeft = iEl.getBoundingClientRect().left;
        results.push({ index, type: isFolder ? 'FOLDER' : 'BOOKMARK', level, title,
            paddingLeft, iconLeft, textLeft });
    });
    return results;
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;

    const popupUrl = `chrome-extension://${extId}/pages/popup.html`;
    const openPopup = async () => {
        const page = await browser.newPage();
        await page.goto(popupUrl, { waitUntil: 'networkidle0' });
        await sleep(700);
        return page;
    };

    // --- Seed -------------------------------------------------------------
    const seedPage = await openPopup();
    await seedPage.evaluate(SEED);
    await sleep(500);
    await seedPage.close();

    // =====================================================================
    // #1 toolbar highlight
    // =====================================================================
    const report1 = {};
    {
        const page = await openPopup();
        // stats view: which seg button is active before/after clicking
        await page.evaluate(() => window.neat && window.neat.views
            ? window.neat.views.activate('stats') : document.querySelector('#view-tab-stats').click());
        await sleep(600);
        const statsBefore = await page.evaluate(() =>
            [...document.querySelectorAll('#stats-list .seg-btn')].map(b => ({
                sort: b.dataset.sort, active: b.getAttribute('aria-pressed') === 'true',
                pressed: b.getAttribute('aria-pressed'),
                bg: getComputedStyle(b).backgroundColor
            })));
        await page.click('#stats-list .seg-btn[data-sort="recent"]');
        await sleep(600);
        const statsAfter = await page.evaluate(() =>
            [...document.querySelectorAll('#stats-list .seg-btn')].map(b => ({
                sort: b.dataset.sort, active: b.getAttribute('aria-pressed') === 'true',
                bg: getComputedStyle(b).backgroundColor
            })));
        report1.stats = { before: statsBefore, afterClickRecent: statsAfter };

        // dead view: filter segment
        await page.evaluate(() => document.querySelector('#view-tab-dead').click());
        await sleep(600);
        const deadBefore = await page.evaluate(() =>
            [...document.querySelectorAll('#dead-list .dead-filter-btn')].map(b => ({
                filter: b.dataset.filter, active: b.getAttribute('aria-pressed') === 'true',
                bg: getComputedStyle(b).backgroundColor
            })));
        await page.click('#dead-list .dead-filter-btn[data-filter="dead"]');
        await sleep(600);
        const deadAfter = await page.evaluate(() =>
            [...document.querySelectorAll('#dead-list .dead-filter-btn')].map(b => ({
                filter: b.dataset.filter, active: b.getAttribute('aria-pressed') === 'true',
                bg: getComputedStyle(b).backgroundColor
            })));
        report1.dead = { before: deadBefore, afterClickDead: deadAfter };
        await page.close();

        // Reopen: does the selected mode's button stay highlighted?
        const page2 = await openPopup();
        await page2.evaluate(() => document.querySelector('#view-tab-stats').click());
        await sleep(600);
        report1.statsReopen = await page2.evaluate(() =>
            [...document.querySelectorAll('#stats-list .seg-btn')].map(b => ({
                sort: b.dataset.sort, active: b.getAttribute('aria-pressed') === 'true'
            })));
        await page2.evaluate(() => document.querySelector('#view-tab-dead').click());
        await sleep(600);
        report1.deadReopen = await page2.evaluate(() =>
            [...document.querySelectorAll('#dead-list .dead-filter-btn')].map(b => ({
                filter: b.dataset.filter, active: b.getAttribute('aria-pressed') === 'true'
            })));
        // dupes view: toolbar control states
        await page2.evaluate(() => document.querySelector('#view-tab-dupes').click());
        await sleep(600);
        report1.dupes = await page2.evaluate(() => ({
            strategy: document.querySelector('#dupes-list .dupes-strategy')?.value,
            scope: document.querySelector('#dupes-list .dupes-scope')?.value
        }));
        await page2.close();
    }
    console.log('=== #1 TOOLBAR HIGHLIGHT ===');
    console.log(JSON.stringify(report1, null, 2));

    // =====================================================================
    // #2 tree indent alignment
    // =====================================================================
    {
        const page = await openPopup();
        // rememberView restores the last active view — make sure the tree is
        // the visible one before measuring (#1 phase left dupes active).
        await page.evaluate(() => document.querySelector('#view-tab-tree').click());
        await sleep(600);
        // click folders open via the tree's own handler (two passes: the
        // first expands 工作区, the second the now-visible SubFolder)
        for (let pass = 0; pass < 3; pass++) {
            await page.evaluate(() => {
                [...document.querySelectorAll('#tree ul li.parent > span')].forEach(s => {
                    if (!s.closest('li').classList.contains('open'))
                        s.click();
                });
            });
            await sleep(800);
        }
        const rows = await page.evaluate(MEASURE);
        console.log('=== #2 TREE ALIGNMENT (row measurements) ===');
        for (const r of rows)
            console.log(`lv${r.level} ${r.type.padEnd(8)} padL=${String(r.paddingLeft).padStart(5)} iconL=${r.iconLeft?.toFixed(1)} textL=${r.textLeft?.toFixed(1)}  ${r.title}`);
        // parent-text vs child-icon delta per consecutive folder→child pair
        console.log('=== #2 parent-text-left vs child-icon-left deltas ===');
        for (let i = 0; i < rows.length - 1; i++) {
            const cur = rows[i], nxt = rows[i + 1];
            if (cur.type === 'FOLDER' && parseInt(nxt.level) === parseInt(cur.level) + 1)
                console.log(`${cur.title} (lv${cur.level} text ${cur.textLeft.toFixed(1)}) -> ${nxt.title} (lv${nxt.level} icon ${nxt.iconLeft?.toFixed(1)})  delta=${(nxt.iconLeft - cur.textLeft).toFixed(1)}px`);
        }
        await page.screenshot({ path: '/tmp/shots/v4t4-tree-alignment.png' });
        await page.close();
    }

    // =====================================================================
    // #4 search-history area must not scroll (rows trimmed to fit)
    // =====================================================================
    {
        const page = await openPopup();
        await page.evaluate(() => {
            const list = [];
            for (let i = 1; i <= 10; i++)
                list.push({ q: `query-${i}`, ts: Date.now() - i * 60000, n: i });
            chrome.storage.local.set({ searchHistory: JSON.stringify(list) });
        });
        await sleep(400);
        await page.close();

        for (const h of [300, 600, 900]) {
            const p = await openPopup();
            await p.setViewport({ width: 800, height: h });
            await p.evaluate(() => document.querySelector('#view-tab-search').click());
            await sleep(600);
            const m = await p.evaluate(() => {
                const area = document.getElementById('search-history-area');
                return {
                    rows: area.querySelectorAll('.search-history-row').length,
                    scrollH: area.scrollHeight,
                    clientH: area.clientHeight,
                    scrolls: area.scrollHeight > area.clientHeight + 1,
                    html: area.innerHTML.slice(0, 200),
                    activeView: document.querySelector('#views > .view-active') ?
                        document.querySelector('#views > .view-active').id : '?',
                    storedHist: ''
                };
            });
            m.storedHist = await p.evaluate(() => new Promise(r =>
                chrome.storage.local.get('searchHistory', d => r((d.searchHistory || '').slice(0, 80)))));
            console.log(`=== #4 viewport ${h}px: rows=${m.rows} scrollH=${m.scrollH} clientH=${m.clientH} scrolls=${m.scrolls} view=${m.activeView} hist=${m.storedHist}`);
            if (m.rows === 0)
                console.log('    area html:', m.html);
            await p.close();
        }
    }

    await browser.close();
})().catch(e => {
    console.error('DIAG FAIL:', e);
    process.exit(2);
});
