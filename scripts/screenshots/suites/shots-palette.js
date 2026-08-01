// vBookmarks view-system screenshot harness (v4 task-2) — the palette modes
// retired in slice C became full views; this suite captures them.
// Seeds duplicates, dead links, visit stats, dead marks and a cached dead
// scan, then shoots: the palette command table, recent/stats/dupes/dead
// views, a live dead rescan (progress + results) and the surviving palette
// surfaces (/session, plain-query bridge row).
// Runs inside zenika/alpine-chrome:with-puppeteer; shots land in /tmp/shots.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// One evaluate: build the tree, then seed the view datasets keyed by the
// freshly created bookmark ids (visitStats/deadMarks/deadLastScan mirror the
// shapes src/visit-stats.js and src/view-dead.js read).
const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));

    // --- Normal bookmarks (so the tree isn't empty) ---
    const work = await create({ parentId: '1', title: '工作区' });
    const gh = await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com' });
    const mdn = await create({ parentId: work.id, title: 'MDN', url: 'https://developer.mozilla.org' });
    const so = await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com' });

    // --- Duplicate URLs (3 groups) for the dupes view ---
    await create({ parentId: work.id, title: 'GitHub Mirror', url: 'https://github.com' });
    await create({ parentId: '1', title: 'GitHub (old)', url: 'https://github.com' });

    await create({ parentId: '1', title: 'MDN CSS', url: 'https://developer.mozilla.org/docs/Web/CSS' });
    await create({ parentId: work.id, title: 'MDN CSS dup', url: 'https://developer.mozilla.org/docs/Web/CSS' });

    await create({ parentId: '1', title: 'Stack Overflow Q', url: 'https://stackoverflow.com/questions/12345' });
    await create({ parentId: work.id, title: 'SO dup', url: 'https://stackoverflow.com/questions/12345' });

    // --- Dead/non-routable URLs for the dead view (enough entries that a
    // rescan takes long enough to capture the progress line) ---
    const dead1 = await create({ parentId: '1', title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
    const dead2 = await create({ parentId: '1', title: 'Bogus host 1', url: 'https://thishost.does.not.exist.example/' });
    const dead3 = await create({ parentId: '1', title: 'Bogus host 2', url: 'https://another.dead.example.com/link' });
    await create({ parentId: '1', title: 'Bogus host 3', url: 'https://no-such-domain.invalid/page' });
    await create({ parentId: '1', title: 'Bogus host 4', url: 'https://definitely.not.a.real.host.test/' });

    // --- A separator so the dead view's filtering is visible ---
    await create({ parentId: '1', title: '|', url: 'http://separatethis.com/sep-1' });

    // --- View datasets ---
    const now = Date.now();
    await new Promise(r => chrome.storage.local.set({
        // Silence the donation ask + the 3.x→4.x upgrade notice in every shot
        currentVersion: chrome.runtime.getManifest().version,
        donationFactor: 1,
        donationKey: 30,
        // stats view: three rows across count magnitudes and ages
        visitStats: JSON.stringify({
            [so.id]: { c: 128, t: now - 60e3 },
            [gh.id]: { c: 42, t: now - 3600e3 },
            [mdn.id]: { c: 7, t: now - 2 * 864e5 }
        }),
        // dead view: one pre-marked row + a cached scan (dead/dead/blocked)
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
        page.on('pageerror', e => {
            // The dead-view rescan probes dead URLs and the browser logs
            // network errors. These are the expected outcome, not app bugs.
            const msg = e.message;
            if (msg.includes('Failed to load resource') || msg.includes('net::'))
                return;
            errors.push(`${tag} pageerror: ${msg}`);
        });
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const txt = m.text();
            if (txt.includes('Failed to load resource') || txt.includes('net::'))
                return;
            errors.push(`${tag} console.error: ${txt}`);
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

    // --- Popup page for the captures --------------------------------------
    const page = await browser.newPage();
    watch(page, 'popup-views');
    await page.setViewport({ width: 400, height: 640 });
    // 第四轮项8: bookmarks.create rejects dateAdded, so fudge the read side —
    // age whole index ranges (keeping the desc order monotonic) and the
    // recent view's coarse groups (Today/Week/Month/Older) all render.
    await page.evaluateOnNewDocument(() => {
        const DAY = 86400e3;
        const orig = chrome.bookmarks.getRecent.bind(chrome.bookmarks);
        chrome.bookmarks.getRecent = (n, cb) => orig(n, items => {
            const age = i => (i >= 9 ? 45 * DAY : i >= 6 ? 20 * DAY : i >= 3 ? 5 * DAY : 0);
            cb(items.map((it, i) => (age(i) ? { ...it, dateAdded: Date.now() - age(i) } : it)));
        });
    });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1600);

    await dark(page);
    await sleep(200);

    const activateView = id => page.evaluate(viewId => {
        const tab = document.querySelector(`#view-tab-${viewId}`);
        if (!tab) throw new Error('view tab not found: ' + viewId);
        tab.click();
    }, id);

    // --- 14-palette-open: the unified command table (slash aliases) -------
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.screenshot({ path: '/tmp/shots/14-palette-open.png' });
    await page.keyboard.press('Escape');
    await sleep(300);

    // --- 15-view-recent: recently added with relative times ---------------
    await activateView('recent');
    await sleep(600);
    await page.screenshot({ path: '/tmp/shots/15-view-recent.png' });

    // --- 16-view-stats: count pills + relative times, count sort ----------
    await activateView('stats');
    await sleep(600);
    await page.screenshot({ path: '/tmp/shots/16-view-stats.png' });

    // --- 17-view-dupes: groups, keeper radios, will-delete preview --------
    await activateView('dupes');
    await sleep(600);
    await page.screenshot({ path: '/tmp/shots/17-view-dupes.png' });

    // --- 18-view-dead: cached scan — status badges, marks, filter ---------
    await activateView('dead');
    await sleep(600);
    await page.screenshot({ path: '/tmp/shots/18-view-dead.png' });

    // --- 19/20-view-dead-rescan: live progress, then the fresh results ----
    await page.evaluate(() => {
        const btn = document.querySelector('.dead-rescan');
        if (!btn) throw new Error('dead rescan button not found');
        btn.click();
    });
    await sleep(1500);
    await page.screenshot({ path: '/tmp/shots/19-view-dead-scanning.png' });
    // bogus hosts burn the 8s direct timeout (+ GET retry); concurrency 4
    await sleep(45000);
    await page.screenshot({ path: '/tmp/shots/20-view-dead-results.png' });

    // --- 21-palette-session: /session save (alert over the palette) -------
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.type('#palette-input', '/session', { delay: 50 });
    await sleep(400);
    await page.keyboard.press('Enter');
    await sleep(800);
    await page.screenshot({ path: '/tmp/shots/21-palette-session.png' });

    // /session opened an alert over the (still-open, keepOpen) palette.
    // The palette's Escape handler stopPropagates, so the first Escape
    // closes the palette; a second Escape dismisses the alert dialog.
    await page.keyboard.press('Escape');
    await sleep(200);
    await page.keyboard.press('Escape');
    await sleep(300);

    // --- 22-palette-search: plain query + the search-view bridge row ------
    await page.keyboard.down('Control');
    await page.keyboard.press('k');
    await page.keyboard.up('Control');
    await sleep(500);
    await page.type('#palette-input', 'git', { delay: 60 });
    await sleep(500);
    await page.screenshot({ path: '/tmp/shots/22-palette-search.png' });

    console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'NO ERRORS (view shots)');
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => {
    console.error('VIEW SHOTS FAIL:', e.message);
    process.exit(2);
});
