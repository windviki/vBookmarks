// vBookmarks i18n screenshot harness — one browser launch per UI language
// (--lang is process-wide), reseeding the same tree each time, capturing
// the main localized surfaces: tree, view tab strip, bookmark context menu,
// folder context menu, edit dialog, the options page and — seeded with
// visit counts, a search-history MRU, a dead-scan cache and a duplicate
// pair — the search/recent/dupes/dead/stats feature views (item 1). 'ar'
// doubles as the RTL check — note the docker chromium ships en-US.pak
// only, so locale negotiation silently falls back to en there; the ar
// tab-strip mirroring assertion therefore emulates `direction: rtl` when
// negotiation failed.
// Runs inside zenika/alpine-chrome:with-puppeteer; shots land in
// /tmp/shots/i18n/<lang>-*.png.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots/i18n', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const LANGS = (process.env.SHOT_LANGS || 'en,zh-CN,ja,ko,fr,de,es,ar').split(',');

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const set = o => new Promise(r => chrome.storage.local.set(o, r));
    const work = await create({ parentId: '1', title: '工作区' });
    const gh = await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'Linear — Issues', url: 'https://linear.app/team/issues' });
    await create({ parentId: work.id, title: 'Figma — Design System', url: 'https://www.figma.com/files/design-system' });
    const dev = await create({ parentId: work.id, title: '开发参考' });
    const mdn = await create({ parentId: dev.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    const caniuse = await create({ parentId: dev.id, title: 'Can I Use', url: 'https://caniuse.com/esmodules' });
    const read = await create({ parentId: '1', title: '稍后读' });
    const ala = await create({ parentId: read.id, title: 'A List Apart — Typography', url: 'https://alistapart.com/topic/typography' });
    const hn = await create({ parentId: '1', title: 'Hacker News', url: 'https://news.ycombinator.com' });
    // Spread a few dateAdded values so the recent view's coarse time groups
    // (Today / This week / This month / Older) all appear (第四轮项8).
    const DAY = 86400e3;
    const now0 = Date.now();
    await create({ parentId: read.id, title: 'Week-old read', url: 'https://example.com/week', dateAdded: now0 - 5 * DAY });
    await create({ parentId: read.id, title: 'Month-old read', url: 'https://example.com/month', dateAdded: now0 - 20 * DAY });
    await create({ parentId: read.id, title: 'Ancient read', url: 'https://example.com/ancient', dateAdded: now0 - 45 * DAY });
    // A duplicate pair for the dupes view (same URL as MDN, other folder).
    await create({ parentId: read.id, title: 'MDN Web Docs (mirror)', url: 'https://developer.mozilla.org/docs/Web' });
    // Feature-view data (item 1): visit counts, a search-history MRU and a
    // finished dead-scan cache so every view tab renders a real state.
    const now = Date.now();
    await set({
        visitStats: JSON.stringify({
            [gh.id]: { c: 12, t: now - 3600e3 },
            [mdn.id]: { c: 5, t: now - 7200e3 },
            [hn.id]: { c: 2, t: now - 86400e3 }
        }),
        searchHistory: JSON.stringify([
            { q: 'design', n: 3, ts: now - 1800e3 },
            { q: 'mozilla', n: 1, ts: now - 5400e3 }
        ]),
        deadLastScan: JSON.stringify({
            ts: now - 3600e3,
            scannedCount: 10,
            results: {
                [caniuse.id]: { status: 'dead', code: 404 },
                [ala.id]: { status: 'blocked', error: 'proxy timeout' }
            }
        })
    });
})()`;

const errors = [];
const watch = (page, tag) => {
    page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', m => {
        if (m.type() === 'error') errors.push(`${tag} console.error: ${m.text()}`);
    });
};

(async () => {
    for (const lang of LANGS) {
        const browser = await puppeteer.launch({
            executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                `--lang=${lang}`,
                '--load-extension=/ext',
                '--disable-extensions-except=/ext'
            ]
        });
        try {
            await sleep(2000);
            const targets = await browser.targets();
            const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
            if (!swTarget) throw new Error('service worker not found');
            const extId = new URL(swTarget.url()).hostname;

            // --- seed (fresh profile per launch, so a plain replay is exact) ---
            const seedPage = await browser.newPage();
            watch(seedPage, `${lang}-seed`);
            await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
            await sleep(800);
            await seedPage.evaluate(SEED);
            await sleep(500);
            await seedPage.close();

            const page = await browser.newPage();
            watch(page, lang);
            await page.setViewport({ width: 400, height: 640 });
            await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
            // Silence the donation ask so every localized shot focuses on the
            // surface under review (storage writes from the seed page race
            // with this open, so newOrUpgrade is not deterministic here).
            await page.evaluate(() => chrome.storage.local.set({
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1,
                donationKey: 30
            }));
            await page.reload({ waitUntil: 'networkidle0' });
            await sleep(1200);

            // Expand the first root (whatever its localized name) → 工作区 → 开发参考
            const clickFolder = async name => page.evaluate(n => {
                const span = [...document.querySelectorAll('#tree span.tree-item-span')]
                    .find(s => (s.querySelector('i')?.textContent || '').trim() === n);
                if (!span) throw new Error('folder not found: ' + n);
                if (!span.parentNode.classList.contains('open')) span.click();
            }, name);
            await page.evaluate(() => {
                const first = document.querySelector('#tree > ul > li span.tree-item-span');
                if (first && !first.parentNode.classList.contains('open')) first.click();
            });
            await sleep(400);
            await clickFolder('工作区');
            await sleep(400);
            await clickFolder('开发参考');
            await sleep(400);
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-tree.png` });

            // View tab strip with localized labels (v4 task-2 §3.2)
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-tabs.png` });

            // 'ar' doubles as the RTL mirror check — tab order must flip.
            // The docker chromium ships en-US.pak only, so --lang=ar cannot
            // negotiate the ar locale there (everything falls back to en);
            // when negotiation did not happen, emulate the RTL direction to
            // still assert the strip's mirroring behaviour deterministically.
            // The injected style is removed afterwards so the remaining shots
            // stay in the negotiated state.
            if (lang === 'ar') {
                const readStrip = () => page.evaluate(() => {
                    const strip = document.querySelector('#view-tabs');
                    const tabs = [...document.querySelectorAll('#view-tabs .view-tab')];
                    return {
                        dir: strip ? getComputedStyle(strip).direction : '(missing)',
                        count: tabs.length,
                        mirrored: tabs.length > 1 && tabs[0].offsetLeft > tabs[tabs.length - 1].offsetLeft
                    };
                });
                let tabStrip = await readStrip();
                let mode = 'negotiated';
                let styleEl = null;
                if (tabStrip.dir !== 'rtl') {
                    styleEl = await page.addStyleTag({ content: 'body { direction: rtl; }' });
                    await sleep(300);
                    tabStrip = await readStrip();
                    mode = 'emulated';
                }
                console.log(`ar RTL tab strip (${mode}): ${JSON.stringify(tabStrip)}`);
                if (tabStrip.dir !== 'rtl' || !tabStrip.mirrored)
                    errors.push(`ar: tab strip not mirrored (${mode}: ${JSON.stringify(tabStrip)})`);
                if (styleEl)
                    await styleEl.evaluate(el => el.remove());
            }

            // Bookmark context menu (GitHub row)
            await page.evaluate(() => {
                const link = [...document.querySelectorAll('#tree a.tree-item-link')]
                    .find(a => (a.querySelector('i')?.textContent || '').includes('GitHub'));
                if (!link) throw new Error('GitHub row not found');
                link.dispatchEvent(new MouseEvent('contextmenu',
                    { bubbles: true, cancelable: true, clientX: 120, clientY: link.getBoundingClientRect().top + 8 }));
            });
            await sleep(500);
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-menu-bookmark.png` });
            await page.keyboard.press('Escape');
            await sleep(400);

            // Folder context menu (工作区 row)
            await page.evaluate(() => {
                const span = [...document.querySelectorAll('#tree span.tree-item-span')]
                    .find(s => (s.querySelector('i')?.textContent || '').trim() === '工作区');
                if (!span) throw new Error('folder row not found');
                span.dispatchEvent(new MouseEvent('contextmenu',
                    { bubbles: true, cancelable: true, clientX: 120, clientY: span.getBoundingClientRect().top + 8 }));
            });
            await sleep(500);
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-menu-folder.png` });
            await page.keyboard.press('Escape');
            await sleep(400);

            // Edit dialog: focus the GitHub row, then F2
            await page.evaluate(() => {
                const link = [...document.querySelectorAll('#tree a.tree-item-link')]
                    .find(a => (a.querySelector('i')?.textContent || '').includes('GitHub'));
                if (link) link.focus();
            });
            await sleep(300);
            await page.keyboard.press('F2');
            await sleep(600);
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-edit.png` });
            await page.keyboard.press('Escape');
            await sleep(300);

            // --- Feature views (item 1): one shot per important view --------
            // Search view: empty box, history MRU up top (item 5 layout).
            const openView = async id => {
                await page.evaluate(v => {
                    const tab = document.querySelector(`#view-tab-${v}`);
                    if (!tab) throw new Error('view tab not found: ' + v);
                    tab.click();
                }, id);
                await sleep(600);
            };
            await openView('search');
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-search.png` });

            // Recent view: seeded opens + the history-permission banner (7a).
            await openView('recent');
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-recent.png` });

            // Dupes view: one seeded duplicate group (URL shown once, item 4).
            await openView('dupes');
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-dupes.png` });

            // Dead view: the seeded scan cache renders a dead + a blocked row.
            await openView('dead');
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-dead.png` });

            // Stats view: seeded visit counts.
            await openView('stats');
            await page.screenshot({ path: `/tmp/shots/i18n/${lang}-stats.png` });
            await page.close();

            // Options page
            const opts = await browser.newPage();
            watch(opts, `${lang}-options`);
            await opts.setViewport({ width: 760, height: 660 });
            await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
            await sleep(900);
            await opts.screenshot({ path: `/tmp/shots/i18n/${lang}-options.png` });
            await opts.close();

            console.log(`${lang}: 11 shots done`);
        } catch (e) {
            errors.push(`${lang}: ${e.message}`);
        }
        await browser.close();
    }

    console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS (i18n shots)');
    process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('SHOTS-I18N FAIL:', e.message); process.exit(2); });
