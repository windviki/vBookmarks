// vBookmarks theme × surface screenshot matrix — 四个主题 × 全部界面。
//
// Replaces shots-themes.js. Iterates the four explicit themes
// (light / dark / ink / paper — "auto" is follow-system and renders light in
// a light environment, so it is folded into light) and, per theme, captures a
// complete surface matrix:
//   popup (400×640):   tree / search / recent / stats / dupes / dead views
//                      bookmark menu + its tab-group flyout
//                      folder menu + sort & tab-group flyouts
//                      edit / new-folder / sort / confirm dialogs
//   popup variants:    wide 640px + narrow 280px — menu positioning vs
//                      window.innerWidth (body is a fixed 320px wide)
//   options (760×640): top / backup / custom-styles (CodeMirror)
//   side panel (360×720)
// Every shot runs with the donation banner silenced (donationFactor=1,
// donationKey=30, currentVersion=manifest.version); the donation card is
// captured separately by shots.js (12-donation-light.png) only.
// Shots land in /tmp/shots as theme-<theme>-<surface>.png.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots/themes', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const THEMES = ['light', 'dark', 'ink', 'paper'];

// One evaluate: build the tree, then seed the view datasets keyed by the
// freshly created bookmark ids (shapes mirror src/visit-stats.js,
// src/view-dead.js and the search-history MRU).
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
    await create({ parentId: dev.id, title: 'Chrome Extensions Docs', url: 'https://developer.chrome.com/docs/extensions' });
    const caniuse = await create({ parentId: dev.id, title: 'Can I Use', url: 'https://caniuse.com/esmodules' });
    const read = await create({ parentId: '1', title: '稍后读' });
    await create({ parentId: read.id, title: 'A List Apart — Typography', url: 'https://alistapart.com/topic/typography' });
    await create({ parentId: read.id, title: '少数派：效率工具年度盘点', url: 'https://sspai.com/post/annual-tools' });
    const hn = await create({ parentId: '1', title: 'Hacker News', url: 'https://news.ycombinator.com' });
    const so = await create({ parentId: '1', title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/tagged/chrome-extension' });
    // dupes group: GitHub URL appears in 稍后读 + at the bar root too.
    await create({ parentId: read.id, title: 'GitHub (mirror)', url: 'https://github.com/vBookmarks' });
    await create({ parentId: '1', title: 'GitHub (old)', url: 'https://github.com/vBookmarks' });
    // dead candidates + a separator (dead view filter / separator row)
    const dead1 = await create({ parentId: '1', title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
    const dead2 = await create({ parentId: '1', title: 'Bogus host', url: 'https://thishost.does.not.exist.example/' });
    const dead3 = await create({ parentId: read.id, title: 'Rotting link', url: 'https://another.dead.example.com/link' });
    await create({ parentId: '1', title: '|', url: 'http://separatethis.com/sep-1' });
    // View datasets + silence the donation / upgrade surfaces.
    const now = Date.now();
    await set({
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
        }),
        searchHistory: JSON.stringify([
            { q: 'github', n: 3, ts: now - 1800e3 },
            { q: 'mozilla', n: 1, ts: now - 5400e3 }
        ])
    });
})()`;

(async () => {
    const errors = [];
    const watch = (page, tag) => {
        page.on('pageerror', e => {
            const msg = e.message;
            // Dead-URL favicons / rescan probes log net:: errors — expected.
            if (msg.includes('Failed to load resource') || msg.includes('net::'))
                return;
            errors.push(`${tag} pageerror: ${msg}`);
        });
        page.on('console', m => {
            if (m.type() !== 'error')
                return;
            const txt = m.text();
            if (txt.includes('Failed to load resource') || txt.includes('net::'))
                return;
            errors.push(`${tag} console.error: ${txt}`);
        });
    };

    for (const theme of THEMES) {
        const browser = await puppeteer.launch({
            executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
            headless: 'new',
            protocolTimeout: 300000,
            args: [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--load-extension=/ext',
                '--disable-extensions-except=/ext'
            ]
        });

        let count = 0;
        const shot = async (page, name) => {
            await page.screenshot({ path: `/tmp/shots/themes/theme-${theme}-${name}.png` });
            count++;
            console.log(`  theme-${theme}-${name}.png`);
        };

        await sleep(2000);
        const targets = await browser.targets();
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        if (!swTarget)
            throw new Error('extension service worker not found');
        const extId = new URL(swTarget.url()).hostname;

        // --- seed -----------------------------------------------------------
        const seedPage = await browser.newPage();
        watch(seedPage, `${theme}-seed`);
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(800);
        await seedPage.evaluate(SEED);
        await sleep(500);
        await seedPage.close();

        // --- helpers --------------------------------------------------------
        // Theme is applied in BOTH stores (localStorage prefill + storage),
        // then reload — otherwise a previous iteration's value leaks in.
        const openThemedPage = async (tag, viewport) => {
            const page = await browser.newPage();
            watch(page, `${tag}-${theme}`);
            await page.setViewport(viewport);
            await page.evaluateOnNewDocument(t => {
                try { localStorage.setItem('theme', t); } catch (e) {}
                // Recent view: fudge getRecent dateAdded by index range so the
                // coarse time groups all render (bookmarks.create rejects it).
                const DAY = 86400e3;
                const orig = chrome.bookmarks.getRecent.bind(chrome.bookmarks);
                chrome.bookmarks.getRecent = (n, cb) => orig(n, items => {
                    const age = i => (i >= 9 ? 45 * DAY : i >= 6 ? 20 * DAY : i >= 3 ? 5 * DAY : 0);
                    cb(items.map((it, i) => (age(i) ? { ...it, dateAdded: Date.now() - age(i) } : it)));
                });
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
            return page;
        };
        // Expand the roots that hold the seeded data (roots render collapsed).
        const expandTree = async page => {
            await page.evaluate(() => {
                const first = document.querySelector('#tree li.parent > span.tree-item-span');
                if (first && !first.parentNode.classList.contains('open'))
                    first.click();
            });
            await sleep(400);
            const clickFolder = async name => page.evaluate(n => {
                const span = [...document.querySelectorAll('#tree span.tree-item-span')]
                    .find(s => (s.querySelector('i')?.textContent || '').trim() === n);
                if (!span) throw new Error('folder not found: ' + n);
                if (!span.parentNode.classList.contains('open')) span.click();
            }, name);
            await clickFolder('工作区');
            await sleep(400);
            await clickFolder('开发参考');
            await sleep(400);
        };
        const activateView = (page, id) => page.evaluate(viewId => {
            const tab = document.querySelector(`#view-tab-${viewId}`);
            if (!tab) throw new Error('view tab not found: ' + viewId);
            tab.click();
        }, id);
        const rightClickBookmark = (page, titlePart) => page.evaluate(t => {
            const link = [...document.querySelectorAll('#tree a.tree-item-link')]
                .find(a => (a.querySelector('i')?.textContent || '').includes(t));
            if (!link) throw new Error('bookmark row not found: ' + t);
            const rect = link.getBoundingClientRect();
            link.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + 20, clientY: rect.top + 8
            }));
        }, titlePart);
        const rightClickFolder = (page, name) => page.evaluate(n => {
            const span = [...document.querySelectorAll('#tree span.tree-item-span')]
                .find(s => (s.querySelector('i')?.textContent || '').trim() === n);
            if (!span) throw new Error('folder row not found: ' + n);
            const rect = span.getBoundingClientRect();
            span.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + 20, clientY: rect.top + 12
            }));
        }, name);
        const hoverEntry = (page, id) => page.evaluate(elemId => {
            const el = document.getElementById(elemId);
            if (!el) throw new Error('hover target not found: ' + elemId);
            el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        }, id);
        const clickMenuItem = (page, id) => page.evaluate(menuId => {
            const item = document.getElementById(menuId);
            if (!item) throw new Error('menu item not found: ' + menuId);
            item.dispatchEvent(new MouseEvent('mouseup', {
                bubbles: true, cancelable: true, view: window, button: 0
            }));
        }, id);
        // menuVisible — the <menu> opens with inline style.opacity '1'.
        const menuShown = (page, id) => page.evaluate(mid => {
            const m = document.getElementById(mid);
            return !!m && m.style.opacity === '1';
        }, id);

        try {
            // ============ P1 — the six list views ============
            const p1 = await openThemedPage('p1', { width: 400, height: 640 });
            await expandTree(p1);
            await shot(p1, 'tree');

            await activateView(p1, 'search');
            await sleep(600);
            await p1.focus('#search-input');
            await p1.type('#search-input', 'git', { delay: 40 });
            await sleep(700);
            await shot(p1, 'search');
            // clear the query so later views don't carry it
            await p1.evaluate(() => { document.querySelector('#search-input').value = ''; });
            await p1.keyboard.press('Escape');
            await sleep(400);

            for (const v of ['recent', 'stats', 'dupes', 'dead']) {
                await activateView(p1, v);
                await sleep(600);
                await shot(p1, v);
            }
            await p1.close();

            // ============ P2 — bookmark menu + its tab-group flyout ==========
            const p2 = await openThemedPage('p2', { width: 400, height: 640 });
            await expandTree(p2);
            await rightClickBookmark(p2, 'GitHub');
            await sleep(500);
            if (!(await menuShown(p2, 'bookmark-context-menu')))
                errors.push(`${theme}: bookmark menu did not open`);
            await shot(p2, 'menu-bookmark');
            await p2.keyboard.press('Escape');
            await sleep(400);
            // tab-group collapse (default OFF) → enable, reopen, hover the entry
            await p2.evaluate(() => chrome.storage.local.set({ collapseTabGroupMenu: '1' }));
            await rightClickBookmark(p2, 'GitHub');
            await sleep(500);
            await hoverEntry(p2, 'bookmark-tab-group-collapse');
            await sleep(300);
            if (!(await menuShown(p2, 'bookmark-tab-group-submenu')))
                errors.push(`${theme}: bookmark tab-group flyout did not open`);
            await shot(p2, 'submenu-bookmark-tabgroup');
            await p2.close();

            // ============ P3 — folder menu, flyouts + dialogs ============
            const p3 = await openThemedPage('p3', { width: 400, height: 640 });
            await expandTree(p3);
            await rightClickFolder(p3, '工作区');
            await sleep(500);
            if (!(await menuShown(p3, 'folder-context-menu')))
                errors.push(`${theme}: folder menu did not open`);
            await shot(p3, 'menu-folder');
            // sort flyout (collapseSortMenu default ON)
            await hoverEntry(p3, 'folder-sort-collapse');
            await sleep(300);
            if (!(await menuShown(p3, 'folder-sort-submenu')))
                errors.push(`${theme}: folder sort flyout did not open`);
            await shot(p3, 'submenu-sort');
            await p3.keyboard.press('Escape');
            await sleep(400);
            // tab-group flyout (needs the setting patched first)
            await p3.evaluate(() => chrome.storage.local.set({ collapseTabGroupMenu: '1' }));
            await rightClickFolder(p3, '工作区');
            await sleep(500);
            await hoverEntry(p3, 'folder-tab-group-collapse');
            await sleep(300);
            if (!(await menuShown(p3, 'folder-tab-group-submenu')))
                errors.push(`${theme}: folder tab-group flyout did not open`);
            await shot(p3, 'submenu-tabgroup');
            await p3.keyboard.press('Escape');
            await sleep(400);

            // dialogs — each opens from the folder menu, then Esc closes it.
            await rightClickFolder(p3, '工作区');
            await sleep(400);
            await clickMenuItem(p3, 'add-new-folder');
            await sleep(500);
            if (!(await p3.evaluate(() => document.body.classList.contains('needInputName'))))
                errors.push(`${theme}: new-folder dialog did not open`);
            await shot(p3, 'dialog-new-folder');
            await p3.keyboard.press('Escape');
            await sleep(400);

            await rightClickFolder(p3, '工作区');
            await sleep(400);
            await hoverEntry(p3, 'folder-sort-collapse');
            await sleep(300);
            await clickMenuItem(p3, 'sub-sort-folder-contents');
            await sleep(500);
            if (!(await p3.evaluate(() => document.body.classList.contains('needSort'))))
                errors.push(`${theme}: sort dialog did not open`);
            await shot(p3, 'dialog-sort');
            await p3.keyboard.press('Escape');
            await sleep(400);

            await rightClickFolder(p3, '工作区');
            await sleep(400);
            await clickMenuItem(p3, 'folder-delete');
            await sleep(500);
            if (!(await p3.evaluate(() => document.body.classList.contains('needConfirm'))))
                errors.push(`${theme}: confirm dialog did not open`);
            await shot(p3, 'dialog-confirm');
            await p3.keyboard.press('Escape');
            await sleep(300);
            await p3.close();

            // ============ P4 — edit dialog (F2 on a visible tree row) =========
            const p4 = await openThemedPage('p4', { width: 400, height: 640 });
            await expandTree(p4);
            await p4.click('#view-tab-tree');
            await sleep(400);
            await p4.evaluate(() => {
                const link = [...document.querySelectorAll('#tree a.tree-item-link')]
                    .find(a => (a.querySelector('i')?.textContent || '').includes('GitHub'));
                if (link) link.focus();
            });
            await sleep(200);
            await p4.keyboard.press('F2');
            await sleep(500);
            if (!(await p4.evaluate(() => document.body.classList.contains('needEdit'))))
                errors.push(`${theme}: edit dialog did not open`);
            await shot(p4, 'dialog-edit');
            await p4.keyboard.press('Escape');
            await sleep(300);
            await p4.close();

            // ============ P5/P6 — wide / narrow viewport variants =============
            // body is a fixed 320px wide; menu positioning keys off
            // window.innerWidth, so a 640 vs 280 window flips/clamps it.
            for (const [tag, vw] of [['wide', 640], ['narrow', 280]]) {
                const page = await openThemedPage(tag, { width: vw, height: 640 });
                await expandTree(page);
                await rightClickFolder(page, '工作区');
                await sleep(500);
                await shot(page, tag);
                await page.close();
            }

            // ============ P7 — options page (three scroll positions) =========
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
            await shot(opts, 'options');
            await opts.evaluate(() => {
                const el = document.getElementById('backup-options');
                if (el) el.scrollIntoView({ block: 'start' });
            });
            await sleep(300);
            await shot(opts, 'options-backup');
            await opts.evaluate(() => {
                const cm = document.querySelector('.CodeMirror');
                if (cm) cm.scrollIntoView({ block: 'center' });
            });
            await sleep(300);
            await shot(opts, 'options-styles');
            await opts.close();

            // ============ P8 — side panel ============
            const panel = await browser.newPage();
            watch(panel, `panel-${theme}`);
            await panel.setViewport({ width: 360, height: 720 });
            await panel.evaluateOnNewDocument(t => {
                try { localStorage.setItem('theme', t); } catch (e) {}
            }, theme);
            await panel.goto(`chrome-extension://${extId}/pages/sidepanel.html`, { waitUntil: 'networkidle0' });
            await panel.evaluate(t => chrome.storage.local.set({
                theme: t,
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1,
                donationKey: 30
            }), theme);
            await panel.reload({ waitUntil: 'networkidle0' });
            await sleep(1200);
            await panel.evaluate(() => {
                const first = document.querySelector('#tree li.parent > span.tree-item-span');
                if (first && !first.parentNode.classList.contains('open')) first.click();
            });
            await sleep(400);
            await panel.evaluate(() => {
                const span = [...document.querySelectorAll('#tree span.tree-item-span')]
                    .find(s => (s.querySelector('i')?.textContent || '').trim() === '工作区');
                if (span && !span.parentNode.classList.contains('open')) span.click();
            });
            await sleep(500);
            await shot(panel, 'panel');
            await panel.close();

            console.log(`theme ${theme}: ${count} shots`);
        } catch (e) {
            errors.push(`${theme}: ${e.message}`);
        }
        await browser.close();
    }

    console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS (matrix shots)');
    process.exit(errors.length ? 1 : 0);
})().catch(e => {
    console.error('SHOTS-MATRIX FAIL:', e.message);
    process.exit(2);
});
