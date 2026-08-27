// vBookmarks store-asset composer (velvet §6.3 F / task-1 N7) — the WebStore
// image specs, produced from live popup states instead of hand assembly.
// The store shows at most FIVE screenshots; this suite emits six candidates
// covering all seven views — pick the five keepers at upload time:
//
//   promo    1280×800 — sheet 1, entry points: main popup (tree + fully
//                       expanded context menu) left; right two columns of
//                       stacked pairs: search (normal + selection) and
//                       tab-groups (normal + selection)
//   promo2   1280×800 — sheet 2, the staging workbench: command palette long
//                       shot left; right columns: staging upper region +
//                       staging selection, staging recent region + stats
//   promo3   1280×800 — sheet 3, cleanup: dead-links and duplicates, each as
//                       normal + selection stacked pairs
//   strip    1400×560 — four theme tiles (light/dark/ink/paper) in a band
//   themes   1280×800 — the two crafted themes split (ink | paper)
//   options  1280×800 — the whole options page in one panorama
//
// Clipping discipline (no blind crops anywhere):
//   - width always the live #container box, widened for visible overlays;
//   - plain tiles trim trailing dead space to the real content bottom;
//   - selection tiles start BELOW the view-tab strip (batch bar + rows only);
//   - staging splits at #recent-head (upper = groups, recent = timeline);
//   - composites pre-read every tile's PNG size and derive box geometry from
//     the tile's own aspect — a tile is never stretched or cover-cropped.
//
// Output: /tmp/shots/store/{promo,promo2,promo3,strip,themes,options}.png,
// plus the raw tiles under tiles/ for manual re-mixing. Keepers are synced to
// assets/store/ by a human and uploaded via the Developer Dashboard.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUT = '/tmp/shots/store';
fs.mkdirSync(path.join(OUT, 'tiles'), { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Store typography (Inter + 思源黑体), installed OS-level by the Dockerfile
// from scripts/screenshots/fonts/ (fetch.sh; git-ignored) and forced over the
// containers' bare message-box stack.
const FONT_CSS = "*{font-family:'Inter','Noto Sans SC','Noto Sans CJK SC',system-ui,sans-serif !important;}";

// Column pairs per sheet: [normal tile, selection tile]. Capture order note:
// the search pair runs LAST — its typed query persists in storage and would
// leak into the search boxes of every page opened before it.
const PROMO_PAIRS = [['view-search', 'view-search-sel'], ['view-tabgroups', 'view-tabgroups-sel']];
const PROMO2_PAIRS = [['view-staging-upper', 'view-staging-sel'], ['view-staging-recent', 'view-stats']];
const PROMO3_PAIRS = [['view-dead', 'view-dead-sel'], ['view-dupes', 'view-dupes-sel']];
// Strip: four theme tiles (classic joins this list when velvet S5 lands).
const STRIP_THEMES = ['light', 'dark', 'ink', 'paper'];

const SEED = `
(async () => {
    // Widen the popup to a photogenic 400px — the real window hugs content,
    // but the fake test page would otherwise render a skinny 320px column
    // with dead margin (and an overflowing palette overlay on top of it).
    await new Promise(r => chrome.storage.local.set({ popupWidth: '400' }, r));
    await new Promise(r => chrome.storage.sync.set({ popupWidth: '400' }, r));
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    const github = await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'Linear — Issues', url: 'https://linear.app/issues' });
    const figma = await create({ parentId: work.id, title: 'Figma — Design System', url: 'https://www.figma.com/files/design-system' });
    const devref = await create({ parentId: work.id, title: '开发参考' });
    const mdn = await create({ parentId: devref.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: devref.id, title: 'Chrome Extensions Docs', url: 'https://developer.chrome.com/docs/extensions' });
    await create({ parentId: devref.id, title: 'Can I Use', url: 'https://caniuse.com' });
    const later = await create({ parentId: work.id, title: '稍后读' });
    const so = await create({ parentId: later.id, title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/tagged/chrome-extension' });
    await create({ parentId: later.id, title: 'GitHub (old)', url: 'https://github.com/vBookmarks' });
    const mdnCopy = await create({ parentId: later.id, title: 'MDN Web Docs (copy)', url: 'https://developer.mozilla.org/docs/Web' });
    const dead1 = await create({ parentId: later.id, title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
    const dead2 = await create({ parentId: later.id, title: 'Bogus host', url: 'https://thishost.does.not.exist.example/' });
    const other = await create({ parentId: '1', title: '其他收藏' });
    const hn = await create({ parentId: other.id, title: 'Hacker News', url: 'https://news.ycombinator.com' });
    await create({ parentId: other.id, title: 'Planet Mozilla', url: 'https://planet.mozilla.org' });
    await create({ parentId: other.id, title: 'A List Apart — Typography', url: 'https://alistapart.com/topics/typography' });
    await create({ parentId: other.id, title: 'Vercel Dashboard', url: 'https://vercel.com/dashboard' });
    await create({ parentId: other.id, title: 'Archive Page (bookmarklet)', url: 'javascript:void(location.href="https://web.archive.org/web/*/"+location.href)' });

    // Ids by URL — the seed runs against a fresh profile every time.
    const all = await new Promise(r => chrome.bookmarks.getTree(r));
    const byUrl = {};
    (function walk(nodes) { for (const n of nodes) { if (n.url) byUrl[n.url] = n.id; if (n.children) walk(n.children); } })(all);

    // Real Chrome tabs in two named groups → the tab-groups view renders
    // live browser data. data: URLs load offline and carry their page title
    // in the markup — ASCII only, non-ASCII mojibakes in data: URLs.
    const mk = async t => new Promise(r => chrome.tabs.create({ url: t.url, active: false }, r));
    const tA1 = await mk({ url: 'data:text/html,<title>GitHub - vBookmarks</title><h1>gh</h1>' });
    const tA2 = await mk({ url: 'data:text/html,<title>Linear - Issues</title><h1>lin</h1>' });
    const tA3 = await mk({ url: 'data:text/html,<title>Figma - Design System</title><h1>fig</h1>' });
    const tB1 = await mk({ url: 'data:text/html,<title>MDN Web Docs</title><h1>mdn</h1>' });
    const tB2 = await mk({ url: 'data:text/html,<title>Can I Use</title><h1>ciu</h1>' });
    const gA = await new Promise(r => chrome.tabs.group({ tabIds: [tA1.id, tA2.id, tA3.id] }, r));
    const gB = await new Promise(r => chrome.tabs.group({ tabIds: [tB1.id, tB2.id] }, r));
    await new Promise(r => chrome.tabGroups.update(gA, { title: '工作区', color: 'blue' }, r));
    await new Promise(r => chrome.tabGroups.update(gB, { title: '开发参考', color: 'green' }, r));

    await new Promise(r => chrome.storage.local.set({
        deadLastScan: JSON.stringify({
            ts: Date.now() - 1800e3,
            scannedCount: 16,
            results: {
                [byUrl['https://example.invalid/dead-page']]: { status: 'dead', code: 404 },
                [byUrl['https://thishost.does.not.exist.example/']]: { status: 'dead', code: 0, error: 'ERR_NAME_NOT_RESOLVED' }
            }
        }),
        visitStats: JSON.stringify({
            [github.id]: { c: 128, t: Date.now() - 120e3 },
            [so.id]:      { c: 32,  t: Date.now() - 3600e3 },
            [figma.id]:   { c: 12,  t: Date.now() - 7200e3 },
            [hn.id]:      { c: 7,   t: Date.now() - 6 * 86400e3 },
            [dead1.id]:   { c: 2,   t: Date.now() - 20 * 86400e3 }
        }),
        // Staging workbench: one named group holding all rows — starred and
        // plain (id:null) side by side, the dual-state rows being the feature
        // shot. The recently-added timeline below the group comes from
        // bookmarks.getRecent (dateAdded fudged in openThemed).
        staging: JSON.stringify({
            v: 1,
            items: [
                { id: byUrl['https://github.com/vBookmarks'], url: 'https://github.com/vBookmarks', title: 'GitHub', ts: Date.now() - 300e3, group: 'stg1' },
                { id: byUrl['https://www.figma.com/files/design-system'], url: 'https://www.figma.com/files/design-system', title: 'Figma — Design System', ts: Date.now() - 240e3, group: 'stg1' },
                { id: null, url: 'https://alistapart.com/topics/typography', title: 'A List Apart — Typography', ts: Date.now() - 180e3, group: 'stg1' },
                { id: byUrl['https://news.ycombinator.com'], url: 'https://news.ycombinator.com', title: 'Hacker News', ts: Date.now() - 120e3, group: 'stg1' },
                { id: null, url: 'https://planet.mozilla.org', title: 'Planet Mozilla', ts: Date.now() - 60e3, group: 'stg1' }
            ],
            groups: [
                { id: 'stg1', name: '稍后整理', collapsed: false, createdAt: Date.now() - 600e3 }
            ],
            recentCollapsed: false,
            unfavCollapsed: false,
            lastSeenTs: 0
        }),
        currentVersion: chrome.runtime.getManifest().version,
        donationFactor: 1,
        donationKey: 30,
        statsEnabled: '1'
    }, r));
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--allow-file-access-from-files',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });

    const errors = [];
    const watch = (page, tag) => {
        // Hermetic render: abort every non-extension request. Favicon
        // enrichment / announce probes would otherwise fire real fetches that
        // hang on the offline container and stall navigation forever.
        page.setRequestInterception(true).then(() => {
            page.on('request', req => {
                const url = req.url();
                if (url.startsWith('chrome-extension://') || url.startsWith('data:') || url.startsWith('blob:'))
                    req.continue();
                else
                    req.abort();
            });
        }).catch(() => {});
        page.on('pageerror', e => {
            const msg = e.message;
            if (msg.includes('Failed to load resource') || msg.includes('net::') || msg.includes('Refused to')) return;
            errors.push(`${tag} pageerror: ${msg}`);
        });
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const txt = m.text();
            if (txt.includes('Failed to load resource') || txt.includes('net::') || txt.includes('Refused to')) return;
            errors.push(`${tag} console.error: ${txt}`);
        });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;

    const seedPage = await browser.newPage();
    watch(seedPage, 'seed');
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'domcontentloaded' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(800);
    await seedPage.close();

    // Theme in BOTH stores (localStorage prefill + storage) then reload —
    // same discipline as shots-matrix; otherwise values leak across pages.
    const openThemed = async (theme, dpr = 2, viewportHeight = 900) => {
        const page = await browser.newPage();
        watch(page, `tile-${theme}`);
        await page.setViewport({ width: 400, height: viewportHeight, deviceScaleFactor: dpr });
        await page.evaluateOnNewDocument((t, css) => {
            try {
                localStorage.setItem('theme', t);
                const s = document.createElement('style');
                s.textContent = css;
                document.documentElement.appendChild(s);
            } catch (e) {}
            // Recent view: fudge dateAdded by index range so the coarse time
            // groups all render (bookmarks.create rejects past dateAdded).
            const DAY = 86400e3;
            const orig = chrome.bookmarks.getRecent.bind(chrome.bookmarks);
            chrome.bookmarks.getRecent = (n, cb) => orig(n, items => {
                const age = i => (i >= 9 ? 45 * DAY : i >= 6 ? 20 * DAY : i >= 3 ? 5 * DAY : 0);
                cb(items.map((it, i) => (age(i) ? { ...it, dateAdded: Date.now() - age(i) } : it)));
            });
        }, theme, FONT_CSS);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'domcontentloaded' });
        // theme is a SYNC_KEYS member — the read path routes to the sync area,
        // so the canonical write must go to storage.sync (a local write is
        // silently ignored by the mirror).
        await page.evaluate(t => chrome.storage.sync.set({ theme: t }), theme);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(1200);
        return page;
    };

    // Expand the seeded folders so the tree tile carries depth.
    const expandTree = async page => {
        for (const name of ['Bookmarks bar', '工作区', '开发参考', '稍后读', '其他收藏']) {
            await page.evaluate(n => {
                const span = [...document.querySelectorAll('#tree span.tree-item-span')]
                    .find(s => (s.querySelector('i')?.textContent || '').trim() === n);
                if (span && !span.parentNode.classList.contains('open')) span.click();
            }, name);
            await sleep(350);
        }
    };

    const activateView = (page, id) => page.evaluate(vid => {
        const tab = document.querySelector(`#view-tab-${vid}`);
        if (!tab) throw new Error('view tab not found: ' + vid);
        tab.click();
    }, id);

    /**
     * Clip discipline, all measured in-page before the shot:
     *   width  — the #container box, widened for visible overlays;
     *   y0     — container top, below #view-tabs (`top:'tabs'` → selection
     *            tiles show only batch bar + rows), or at an element
     *            (`topSel`, e.g. #recent-head for the staging recent region);
     *   y1     — real content bottom (deepest visible element) unless
     *            `bottom:'container'` / `viewport`, or pinned to an element
     *            (`bottomSel`, e.g. #recent-head for the staging upper
     *            region — groups only, timeline cropped off).
     */
    const shootTile = async (page, name, { top = 'container', topSel = null, bottom = 'content', bottomSel = null, viewport = false } = {}) => {
        const box = await page.evaluate((topMode, topSelId, bottomMode, bottomSelId, vp) => {
            const c = document.getElementById('container');
            const r = c ? c.getBoundingClientRect()
                : { left: 0, top: 0, width: innerWidth, bottom: innerHeight };
            const tabs = document.getElementById('view-tabs');
            const tabsBottom = tabs ? tabs.getBoundingClientRect().bottom + 2 : r.top;
            let y0 = r.top;
            if (topMode === 'tabs') y0 = tabsBottom;
            if (topSelId) {
                const el = document.querySelector(topSelId);
                if (el) y0 = Math.max(y0, el.getBoundingClientRect().top - 2);
            }
            let y1;
            if (vp) y1 = innerHeight;
            else if (bottomMode === 'container') y1 = r.bottom;
            else {
                let maxBottom = y0 + 80; // floor: never produce a 0-height tile
                // Concrete content leaves only — wrapper shells (#view →
                // list div chains, full-height toolbars) can never pin the
                // trim at the container bottom.
                for (const el of c.querySelectorAll(
                    'li, a, button, input, select, textarea, p, h2, h3, img, svg, .menu-item, [class*="banner"], [class*="toolbar"]')) {
                    const st = getComputedStyle(el);
                    if (st.display === 'none' || st.visibility === 'hidden') continue;
                    const er = el.getBoundingClientRect();
                    if (er.width < 1 || er.height < 1) continue;
                    if (er.bottom <= y0) continue;
                    maxBottom = Math.max(maxBottom, er.bottom);
                }
                y1 = Math.min(maxBottom + 2, vp ? innerHeight : r.bottom);
            }
            if (bottomSelId) {
                const el = document.querySelector(bottomSelId);
                if (el) y1 = Math.min(y1, el.getBoundingClientRect().top - 2);
            }
            // Overlays (menus / palette / flyouts) may extend the box.
            for (const sel of ['#bookmark-context-menu', '#folder-context-menu',
                '#command-palette', '.submenu']) {
                for (const m of document.querySelectorAll(sel)) {
                    // Parked menus sit at left:-999; the palette doesn't use
                    // a left offset at all, so only apply that test when set.
                    const parked = m.style.left !== '' && parseFloat(m.style.left) <= -900;
                    const shown = !m.hidden && getComputedStyle(m).opacity !== '0' && !parked;
                    if (!shown) continue;
                    const mr = m.getBoundingClientRect();
                    y1 = Math.max(y1, mr.bottom);
                    r.width = Math.max(r.width, mr.right - r.left);
                }
            }
            return { x: 0, y: Math.floor(y0), width: Math.ceil(r.width),
                height: Math.ceil(Math.min(y1, innerHeight) - y0) };
        }, top, topSel, bottom, bottomSel, viewport);
        if (box.height < 40) throw new Error(`${name}: clip collapsed (${box.height}px)`);
        await page.screenshot({ path: `${OUT}/tiles/${name}.png`, clip: box });
        console.log(`  tiles/${name}.png (${box.width}x${box.height})`);
    };

    /** Enter a view's selection mode via its real entry control. */
    const enterSelection = async (page, tile) => {
        const entered = await page.evaluate(() => {
            const root = document.querySelector('#views .view:not([hidden])');
            if (!root) return false;
            const btn = [...root.querySelectorAll('button, [role=button], i, a')]
                .find(b => /select-mode/.test(b.className));
            if (!btn) return false;
            btn.click();
            return true;
        });
        if (!entered) errors.push(`${tile}: no select-mode entry`);
        await sleep(500);
        await page.evaluate(() => {
            const root = document.querySelector('#views .view:not([hidden])');
            const all = root && [...root.querySelectorAll('button, [role=button]')]
                .find(b => /select-all/.test(b.className));
            if (all) all.click();
        });
        await sleep(500);
        const sel = await page.evaluate(() => {
            const root = document.querySelector('#views .view:not([hidden])');
            return {
                exit: !!root.querySelector('[class*="select-exit"]'),
                ticked: root.querySelectorAll('.sel, [aria-checked="true"], .selected').length
            };
        });
        if (!sel.exit || !sel.ticked)
            errors.push(`${tile}: selection state wrong: ${JSON.stringify(sel)}`);
    };

    // --- 1. the four theme tree tiles (strip sources) -----------------------
    for (const theme of STRIP_THEMES) {
        const page = await openThemed(theme);
        await expandTree(page);
        await shootTile(page, `tree-${theme}`);
        if (theme !== 'light') await page.close();
    }

    // --- 2. light-tree page keeps going: context menu overlay ----------------
    // The promo's main card: expanded tree with the bookmark context menu
    // open and its collapsible entry expanded in place. The visibly rendered
    // collapsible varies by build gating (the tab-group trigger is
    // display:none here), so pick whichever has-submenu entry is laid out;
    // placement replicates positionMenu's stack-below fallback.
    {
        const page = await openThemed('light', 2, 1000);
        await expandTree(page);
        const link = await page.evaluate(() => {
            const a = [...document.querySelectorAll('#tree a.tree-item-link')]
                .find(a => (a.querySelector('i')?.textContent || '').includes('GitHub'));
            if (!a) throw new Error('bookmark row not found: GitHub');
            const rect = a.getBoundingClientRect();
            a.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + 20, clientY: rect.top + 8
            }));
            return true;
        });
        if (!link) errors.push('contextmenu dispatch failed');
        await sleep(500);
        const state = await page.evaluate(() => {
            const menu = document.getElementById('bookmark-context-menu');
            if (!menu || menu.style.opacity !== '1') return { open: false };
            return { open: true };
        });
        if (!state.open) errors.push('bookmark menu did not open');
        else {
            const forced = await page.evaluate(() => {
                for (const id of ['bookmark-add-collapse', 'bookmark-tab-group-collapse']) {
                    const e = document.getElementById(id);
                    if (!e || !e.dataset) continue;
                    if (e.getBoundingClientRect().width === 0) continue;
                    const sub = document.getElementById(e.dataset.submenu);
                    if (!sub) continue;
                    const r = e.getBoundingClientRect();
                    sub.style.maxHeight = '';
                    sub.style.maxWidth = '';
                    sub.style.left = `${r.left + window.scrollX}px`;
                    sub.style.top = `${r.bottom + window.scrollY + 2}px`;
                    sub.style.opacity = '1';
                    sub.style.transform = 'scale(1)';
                    e.setAttribute('aria-expanded', 'true');
                    return id;
                }
                return null;
            });
            if (!forced)
                errors.push('no laid-out submenu trigger to expand');
            await sleep(300);
        }
        await shootTile(page, 'tree-menu-light', { viewport: true });
        await page.close();
    }

    // --- 3. staging regions (upper = groups, recent = timeline) + selection --
    {
        const page = await openThemed('light');
        await activateView(page, 'recent');
        await sleep(900);
        await shootTile(page, 'view-staging-upper', { top: 'tabs', bottomSel: '#recent-head' });
        await shootTile(page, 'view-staging-recent', { top: 'tabs', topSel: '#recent-head', bottom: 'container' });
        await enterSelection(page, 'view-staging-sel');
        await shootTile(page, 'view-staging-sel', { top: 'tabs' });
        await page.close();
    }

    // --- 4. tab-groups pair --------------------------------------------------
    {
        const page = await openThemed('light');
        await activateView(page, 'tabgroups');
        await sleep(900);
        const rows = await page.evaluate(
            () => document.querySelectorAll('#views .view:not([hidden]) ul li').length);
        if (!rows) errors.push('view-tabgroups: view rendered zero rows');
        await shootTile(page, 'view-tabgroups');
        await enterSelection(page, 'view-tabgroups-sel');
        await shootTile(page, 'view-tabgroups-sel', { top: 'tabs' });
        await page.close();
    }

    // --- 5. cleanup views: dead / dupes --------------------------------------
    for (const [viewId, base] of [['dead', 'view-dead'], ['dupes', 'view-dupes']]) {
        const page = await openThemed('light');
        await activateView(page, viewId);
        await sleep(900);
        await shootTile(page, base);
        await enterSelection(page, `${base}-sel`);
        await shootTile(page, `${base}-sel`, { top: 'tabs' });
        await page.close();
    }

    // --- 6. stats, then the search pair (search LAST: query leaks) -----------
    {
        const page = await openThemed('light');
        await activateView(page, 'stats');
        await sleep(900);
        await shootTile(page, 'view-stats');
        await page.close();
    }
    {
        const page = await openThemed('light');
        await page.click('#search-input');
        await page.keyboard.type('git', { delay: 60 });
        await sleep(900);
        const rows = await page.evaluate(
            () => document.querySelectorAll('#views .view:not([hidden]) ul li').length);
        if (!rows) errors.push('view-search: view rendered zero rows');
        await shootTile(page, 'view-search');
        await enterSelection(page, 'view-search-sel');
        await shootTile(page, 'view-search-sel', { top: 'tabs' });
        await page.close();
    }

    // --- palette open (BEFORE the search pair: its query would leak here) ------------------------------------------------------
    {
        const page = await openThemed('light');
        await expandTree(page);
        await page.keyboard.down('Control');
        await page.keyboard.press('k');
        await page.keyboard.up('Control');
        await sleep(900);
        const palOpen = await page.evaluate(() => { const p = document.getElementById('command-palette'); return !!p && !p.hidden; });
        if (!palOpen) errors.push('palette did not open');
        else {
            await sleep(600); // row list settles
            await shootTile(page, 'palette-open');
        }
        await page.close();
    }


    // --- 8. options page full-page capture (panorama source) -----------------
    // A wide viewport + forced six-column grid turns the whole options page
    // into a short sheet that fits one 1280×800 frame.
    {
        const page = await browser.newPage();
        watch(page, 'options');
        await page.setViewport({ width: 2400, height: 1200, deviceScaleFactor: 1 });
        await page.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'domcontentloaded' });
        await sleep(1000);
        await page.evaluate(() => new Promise(r => chrome.storage.sync.set({ theme: 'light' }, r)));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(1200);
        await page.evaluate(() => {
            const s = document.createElement('style');
            s.textContent = '.options-page{max-width:none !important;} .options-grid{column-count:6 !important;} '
                + "*{font-family:'Inter','Noto Sans SC','Noto Sans CJK SC',system-ui,sans-serif !important;}";
            document.head.appendChild(s);
        });
        await sleep(600);
        const geo = await page.evaluate(() => ({
            sections: document.querySelectorAll('section:not([hidden])').length,
            vw: document.documentElement.clientWidth,
            sh: document.documentElement.scrollHeight
        }));
        if (!geo.sections) errors.push('options page rendered zero sections');
        await page.screenshot({
            path: `${OUT}/tiles/options-full.png`,
            clip: { x: 0, y: 0, width: geo.vw, height: Math.min(geo.sh, 4000) },
            captureBeyondViewport: true
        });
        console.log(`  tiles/options-full.png (clip ${geo.vw}x${Math.min(geo.sh, 4000)})`);
        await page.close();
    }

    await browser.close();

    // --- 9. composites ---------------------------------------------------------
    // Every tile's PNG size is pre-read; card geometry derives from the tile's
    // own aspect so popup views land complete (never stretched/cover-cropped).
    const pngSizeOf = name => {
        const buf = fs.readFileSync(path.join(OUT, 'tiles', `${name}.png`));
        return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    };
    const aspectOf = name => { const s = pngSizeOf(name); return s.w / s.h; };
    const rel = n => `tiles/${n}.png`;
    const tileImg = (name, w, h) =>
        `<img src="${rel(name)}" style="width:${w.toFixed(1)}px;height:${h.toFixed(1)}px;object-fit:fill;">`;

    const cardCss = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; background: #fff; font-family: system-ui, sans-serif; }
        .card { overflow: hidden; position: relative;
                border-radius: 12px; border: 1px solid rgba(15,23,42,.10);
                box-shadow: 0 10px 30px rgba(15,23,42,.14); background: #fff; }
        .card img { display: block; }`;

    const compose = async (htmlName, width, height, bodyHtml) => {
        const file = path.join(OUT, htmlName);
        fs.writeFileSync(file, `<!doctype html><html><head><meta charset="utf-8"><style>${cardCss}</style></head><body>${bodyHtml}</body></html>`);
        const cBrowser = await puppeteer.launch({
            executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
            headless: 'new',
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--allow-file-access-from-files']
        });
        const page = await cBrowser.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.goto('file://' + file, { waitUntil: 'domcontentloaded' });
        await sleep(400);
        const broken = await page.evaluate(() =>
            [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute('src')));
        if (broken.length) throw new Error(`composite ${htmlName}: broken tiles: ${broken.join(', ')}`);
        const out = path.join(OUT, htmlName.replace(/\.html$/, '.png'));
        await page.screenshot({ path: out });
        console.log(`  ${path.basename(out)} (${width}x${height})`);
        await cBrowser.close();
    };

    /**
     * Sheet layout: optional left "big" tile + N columns, each column a
     * stacked pair (normal tile on top, selection tile below). Pre-calculated
     * from measured aspects:
     *   leftW = aspect_left × innerH (left tile fills the column height);
     *   colW  = min over pairs of (innerH − GAP) / (1/aN + 1/aS), capped by
     *           the width the columns actually get;
     *   selection card: natural aspect, cropped from the bottom only when the
     *   leftover column height is smaller than its natural height (the batch
     *   bar + first ticked rows are the content; the tail is blank page).
     */
    const pairColumn = (pair, colW, GAP, boxH) => {
        const [n, sname] = pair;
        const hN = colW / aspectOf(n);
        const hSnat = colW / aspectOf(sname);
        const hS = Math.min(hSnat, boxH - hN - GAP);
        return `<div style="display:flex; flex-direction:column; justify-content:center; gap:${GAP}px;
                    flex:none; width:${colW}px; height:${boxH}px;">
                <div class="card" style="width:${colW}px;height:${hN.toFixed(1)}px;">
                    ${tileImg(n, colW, hN)}
                </div>
                <div class="card" style="width:${colW}px;height:${hS.toFixed(1)}px;">
                    <img src="${rel(sname)}" style="width:${colW}px;height:auto;">
                </div>
            </div>`;
    };

    const sheetStack = async (htmlName, leftName, pairs) => {
        const PAD = 36, GAP = 22, INNERW = 1280 - PAD * 2, INNERH = 800 - PAD * 2;
        // Wide-aspect left tiles (palette) must not eat the columns' width:
        // cap the left card and letter its height from the cap instead.
        const leftW = Math.min(Math.round(aspectOf(leftName) * INNERH), 430);
        const leftH = Math.min(INNERH, leftW / aspectOf(leftName));
        const colW = Math.floor(Math.min(
            ...pairs.map(([n, sname]) => (INNERH - GAP) / (1 / aspectOf(n) + 1 / aspectOf(sname))),
            (INNERW - leftW - GAP * (pairs.length + 1)) / pairs.length));
        const columns = pairs.map(p => pairColumn(p, colW, GAP, INNERH)).join('\n');
        await compose(htmlName, 1280, 800, `
            <div style="display:flex; gap:${GAP}px; height:100vh; padding:${PAD}px;
                        background:#f4f6f9; align-items:flex-start; justify-content:center;">
                <div class="card" style="flex:none;width:${leftW}px;height:${leftH.toFixed(1)}px;
                            align-self:center;">
                    ${tileImg(leftName, leftW, leftH)}
                </div>
                ${columns}
            </div>`);
    };

    await sheetStack('promo.html', 'tree-menu-light', PROMO_PAIRS);
    await sheetStack('promo2.html', 'palette-open', PROMO2_PAIRS);

    // promo3: no left tile — two pair-columns share the full inner width.
    {
        const PAD = 36, GAP = 22, INNERW = 1280 - PAD * 2, INNERH = 800 - PAD * 2;
        const colW = Math.floor(Math.min(
            ...PROMO3_PAIRS.map(([n, sname]) => (INNERH - GAP) / (1 / aspectOf(n) + 1 / aspectOf(sname))),
            (INNERW - GAP * (PROMO3_PAIRS.length - 1)) / PROMO3_PAIRS.length));
        const columns = PROMO3_PAIRS.map(p => pairColumn(p, colW, GAP, INNERH)).join('\n');
        await compose('promo3.html', 1280, 800, `
            <div style="display:flex; gap:${GAP}px; height:100vh; padding:${PAD}px;
                        background:#f4f6f9; align-items:center; justify-content:center;">${columns}</div>`);
    }

    // strip 1400×560: the four themes in a centered band sized by their own
    // aspect (full width visible); leftover canvas height = neutral margins.
    {
        const W = 1400, H = 560, GAP = 12;
        const tiles = STRIP_THEMES.map(t => `tree-${t}`);
        const sumA = tiles.reduce((t, n) => t + aspectOf(n), 0);
        const bandH = Math.min(H, (W - GAP * (tiles.length - 1)) / sumA);
        const cards = tiles.map(n => {
            const a = aspectOf(n);
            return `<div class="card" style="flex:none;width:${(a * bandH).toFixed(1)}px;height:${bandH.toFixed(1)}px;
                        border-radius:0;border-width:0 1px 0 0;box-shadow:none;">
                    ${tileImg(n, a * bandH, bandH)}
                </div>`;
        }).join('\n');
        await compose('strip.html', W, H, `
            <div style="display:flex; gap:${GAP}px; height:100vh; background:#f4f6f9;
                        align-items:center; justify-content:center;">${cards}</div>`);
    }

    // themes 1280×800: ink | paper pair, aspect-derived, centered.
    {
        const PAIR = ['tree-ink', 'tree-paper'];
        const sumA = PAIR.reduce((t, n) => t + aspectOf(n), 0);
        const hPair = Math.min(800 - 32, (1280 - 20 - 48) / sumA);
        const cards = PAIR.map(n => {
            const a = aspectOf(n);
            return `<div class="card" style="flex:none;width:${(a * hPair).toFixed(1)}px;height:${hPair.toFixed(1)}px;">
                    ${tileImg(n, a * hPair, hPair)}
                </div>`;
        }).join('\n');
        await compose('themes.html', 1280, 800, `
            <div style="height:100vh; background:#f4f6f9; display:flex; gap:20px;
                        align-items:center; justify-content:center;">${cards}</div>`);
    }

    // options 1280×800: the whole options page in one frame. The wide-viewport
    // capture turns the masonry into a short, wide sheet; scale it to the
    // frame width and center it. If it is still too tall for one frame, fall
    // back to slicing it into full-height columns (adaptive count).
    {
        const buf = fs.readFileSync(path.join(OUT, 'tiles/options-full.png'));
        const natW = buf.readUInt32BE(16), natH = buf.readUInt32BE(20);
        const PAD = 24, GAP = 18, COLH = 800 - PAD * 2, CONTENTW = 1280 - PAD * 2;
        const dispH1 = CONTENTW * natH / natW;
        if (dispH1 <= COLH) {
            await compose('options.html', 1280, 800, `
                <div style="height:100vh; padding:${PAD}px; background:#f4f6f9;
                            display:flex; align-items:flex-start; justify-content:center;">
                    <div class="card" style="width:${CONTENTW}px;">
                        <img src="${rel('options-full')}" style="width:100%; height:auto; object-fit:unset;">
                    </div>
                </div>`);
        } else {
            let best = null;
            for (let n = 2; n <= 5; n++) {
                const colW = (CONTENTW - GAP * (n - 1)) / n;
                const coverage = (colW * natH / natW) / (n * COLH);
                const score = coverage >= 1 ? coverage - 1 : 1 - coverage;
                if (!best || score < best.score) best = { n, colW, score };
            }
            const cols = [];
            for (let i = 0; i < best.n; i++) {
                cols.push(`<div class="card" style="width:${best.colW.toFixed(1)}px; height:${COLH}px;">
                        <img src="${rel('options-full')}" style="width:100%; height:auto; object-fit:unset; margin-top:${-i * COLH}px;">
                    </div>`);
            }
            await compose('options.html', 1280, 800, `
                <div style="display:flex; gap:${GAP}px; height:100vh; padding:${PAD}px;
                            background:#f4f6f9; align-items:flex-start;">${cols.join('\n')}</div>`);
        }
    }

    console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS (store shots)');
    process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('STORE SHOTS FAIL:', e.message); process.exit(2); });
