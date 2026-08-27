// vBookmarks store-asset composer (velvet §6.3 F / task-1 N7) — the WebStore
// image specs, produced from live popup states instead of hand assembly.
// The store shows at most FIVE screenshots; this suite emits exactly five:
//
//   strip    1400×560 — four theme tiles (light/dark/ink/paper) side by side
//   promo    1280×800 — sheet 1, the views as entry points: main popup
//                       (tree + context menu) plus search / staging-recent /
//                       tab-groups / stats minis, aligned with the hand-made
//                       assets/store/vBookmarks-v4.png layout
//   promo2   1280×800 — sheet 2, the maintenance crew: dead-link scanner /
//                       duplicate cleaner minis + the command palette
//   themes   1280×800 — the two crafted themes split full-bleed: ink | paper
//   options  1280×800 — the options page as one panorama (see below)
//
// Every popup tile is clipped to the #container box (menus/palettes may
// extend it downward) — the viewport-width dead margin on the right would
// otherwise read as a broken layout in the composites.
//
// Pipeline: capture each state at deviceScaleFactor 2 (crisp when downscaled)
// → compose via a temporary HTML grid of <img> tiles → one full-page
// screenshot at the exact store canvas size. Zero canvas dependency.
//
// Output: /tmp/shots/store/{strip,promo,promo2,themes,options}.png, plus the
// raw tiles under tiles/ for manual re-mixing. The keepers are synced to
// assets/store/ and uploaded via the Developer Dashboard by a human — nothing
// here is auto-uploaded.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const OUT = '/tmp/shots/store';
fs.mkdirSync(path.join(OUT, 'tiles'), { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Strip: four theme tiles (classic joins this list when velvet S5 lands).
const STRIP_THEMES = ['light', 'dark', 'ink', 'paper'];
// Promo sheet 1 minis: view id on the tab bar → tile name. Capture order
// matters: search LAST — its typed query persists in storage and would
// otherwise leak into the boxes of every page opened afterwards. The
// composite grid places the tiles in display order regardless.
const SHEET1_VIEWS = [
    ['recent', 'view-recent'],
    ['tabgroups', 'view-tabgroups'],
    ['stats', 'view-stats'],
    ['dead', 'view-dead'],
    ['dupes', 'view-dupes'],
    ['search', 'view-search']
];
// Display order per sheet (row-major).
const SHEET1_GRID = ['view-search', 'view-recent', 'view-tabgroups', 'view-stats'];
const SHEET2_GRID = ['view-dead', 'view-dupes', 'palette-open'];

const SEED = `
(async () => {
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

    // Real Chrome tabs in two named groups + one loose tab → the tab-groups
    // view renders live browser data. data: URLs load offline and carry
    // their page title in the markup — ASCII only, non-ASCII mojibakes in
    // data: URLs without an explicit charset.
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
        // shot. Keep the unbookmarked inbox empty: it renders ABOVE the
        // groups and would push the group rows below the tile fold.
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
        // hang on the offline container and stall networkidle0 forever.
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
    const openThemed = async (theme, dpr = 2, viewportHeight = 640) => {
        const page = await browser.newPage();
        watch(page, `tile-${theme}`);
        await page.setViewport({ width: 400, height: viewportHeight, deviceScaleFactor: dpr });
        await page.evaluateOnNewDocument(t => {
            try { localStorage.setItem('theme', t); } catch (e) {}
            // Recent view: fudge dateAdded by index range so the coarse time
            // groups all render (bookmarks.create rejects past dateAdded).
            const DAY = 86400e3;
            const orig = chrome.bookmarks.getRecent.bind(chrome.bookmarks);
            chrome.bookmarks.getRecent = (n, cb) => orig(n, items => {
                const age = i => (i >= 9 ? 45 * DAY : i >= 6 ? 20 * DAY : i >= 3 ? 5 * DAY : 0);
                cb(items.map((it, i) => (age(i) ? { ...it, dateAdded: Date.now() - age(i) } : it)));
            });
        }, theme);
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

    // Clip to the real UI box: #container plus any overlay (context menu /
    // palette) that extends past it. Capturing the raw viewport would ship a
    // dead right margin — the popup hugs its content in real Chrome windows.
    const shootTile = async (page, name, { height = 'content' } = {}) => {
        const box = await page.evaluate(hMode => {
            const c = document.getElementById('container');
            const r = c ? c.getBoundingClientRect()
                : { left: 0, top: 0, width: innerWidth, bottom: innerHeight };
            let bottom = r.bottom;
            for (const id of ['bookmark-context-menu', 'folder-context-menu', 'command-palette']) {
                const m = document.getElementById(id);
                const shown = m && !m.hidden && getComputedStyle(m).opacity !== '0';
                if (shown) bottom = Math.max(bottom, m.getBoundingClientRect().bottom);
            }
            const height2 = hMode === 'viewport' ? innerHeight : Math.min(bottom + 2, innerHeight);
            return { x: 0, y: 0, width: Math.ceil(r.width), height: Math.ceil(height2) };
        }, height);
        await page.screenshot({ path: `${OUT}/tiles/${name}.png`, clip: box });
        console.log(`  tiles/${name}.png (${box.width}x${box.height})`);
    };

    // --- 1. the four theme tree tiles (strip sources) -----------------------
    for (const theme of STRIP_THEMES) {
        const page = await openThemed(theme);
        await expandTree(page);
        await shootTile(page, `tree-${theme}`);
        if (theme !== 'light') await page.close();
    }

    // --- 2. light-tree page keeps going: context menu overlay ----------------
    // The promo's main card mirrors vBookmarks-v4.png top-left: expanded tree
    // with the bookmark context menu open over it. Tall viewport so the long
    // menu is not cut mid-item at the frame bottom.
    {
        const page = await openThemed('light', 2, 800);
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
        const menuOpen = await page.evaluate(() => {
            const m = document.getElementById('bookmark-context-menu');
            return m && m.style.opacity === '1';
        });
        if (!menuOpen) errors.push('bookmark menu did not open');
        await shootTile(page, 'tree-menu-light', { height: 'viewport' });
        await page.close();
    }

    // --- 3. view minis (all seven views across the two promo sheets) ---------
    // search is driven through the real input (typed query → results + mark
    // highlighting, like the reference collage); the other views via tab click.
    for (const [viewId, tile] of SHEET1_VIEWS) {
        const page = await openThemed('light');
        if (viewId === 'search') {
            await page.click('#search-input');
            await page.keyboard.type('git', { delay: 60 });
            await sleep(900);
        } else {
            await page.evaluate(id => {
                const tab = document.querySelector(`#view-tab-${id}`);
                if (!tab) throw new Error('view tab not found: ' + id);
                tab.click();
            }, viewId);
            await sleep(900);
        }
        const rows = await page.evaluate(
            () => document.querySelectorAll('#views .view:not([hidden]) ul li').length);
        if (!rows) errors.push(`${tile}: view rendered zero rows`);
        await shootTile(page, tile);
        await page.close();
    }

    // --- 4. palette open ------------------------------------------------------
    // Shot on its own page; closed by close() rather than Esc (CDP cannot
    // deliver Escape — docs/cdp-escape-limitation.md).
    {
        const page = await openThemed('light');
        await expandTree(page);
        await page.keyboard.down('Control');
        await page.keyboard.press('k');
        await page.keyboard.up('Control');
        await sleep(500);
        const palOpen = await page.evaluate(() => { const p = document.getElementById('command-palette'); return !!p && !p.hidden; });
        if (!palOpen) errors.push('palette did not open');
        else await shootTile(page, 'palette-open');
        await page.close();
    }

    // --- 5. options page full-page capture (panorama source) -----------------
    // Physics of the "all 20 sections in one 1280×800 frame" goal: the
    // multicol sheet is ~6540 column-px at 340px columns, so it only fits one
    // frame when the grid spreads to SIX columns (5 or fewer stay too tall).
    // That needs the viewport wide enough AND the .options-page max-width cap
    // overridden — hence the injected style. Scale in the composite is ~0.54,
    // a legible-at-zoom overview (the hand-made vBookmarks-v4-options.png
    // dodge was showing only half the groups; this is the real panorama).
    {
        const page = await browser.newPage();
        watch(page, 'options');
        await page.setViewport({ width: 2400, height: 1200, deviceScaleFactor: 1 });
        await page.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'domcontentloaded' });
        await sleep(1000);
        await page.evaluate(() => new Promise(r => chrome.storage.sync.set({ theme: 'light' }, r)));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await sleep(1200);
        // Injected post-load (a pre-load injection has no documentElement yet).
        await page.evaluate(() => {
            const s = document.createElement('style');
            s.textContent = '.options-page{max-width:none !important;} .options-grid{column-count:6 !important;}';
            document.head.appendChild(s);
        });
        await sleep(600);
        const geo = await page.evaluate(() => ({
            sections: document.querySelectorAll('section:not([hidden])').length,
            vw: document.documentElement.clientWidth,
            sh: document.documentElement.scrollHeight
        }));
        if (!geo.sections) errors.push('options page rendered zero sections');
        // fullPage would widen to scrollWidth if anything overflows; clamp to
        // the viewport band so the panorama keeps the intended aspect.
        await page.screenshot({
            path: `${OUT}/tiles/options-full.png`,
            clip: { x: 0, y: 0, width: geo.vw, height: Math.min(geo.sh, 4000) },
            captureBeyondViewport: true
        });
        console.log(`  tiles/options-full.png (clip ${geo.vw}x${Math.min(geo.sh, 4000)})`);
        await page.close();
    }

    await browser.close();

    // --- 6. composites ---------------------------------------------------------
    // Card look shared by all canvases: rounded frame + hairline border +
    // soft shadow so white-theme popups read against the light backdrop.
    const cardCss = `
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { width: 100%; height: 100%; background: #fff; font-family: system-ui, sans-serif; }
        .card { overflow: hidden; position: relative;
                border-radius: 12px; border: 1px solid rgba(15,23,42,.10);
                box-shadow: 0 10px 30px rgba(15,23,42,.14); background: #fff; }
        .card img { display: block; width: 100%; height: 100%;
                    object-fit: cover; object-position: top left; }`;

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
        // Tile loads must all have succeeded — a broken img would ship as blank.
        const broken = await page.evaluate(() =>
            [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute('src')));
        if (broken.length) throw new Error(`composite ${htmlName}: broken tiles: ${broken.join(', ')}`);
        const out = path.join(OUT, htmlName.replace(/\.html$/, '.png'));
        await page.screenshot({ path: out });
        console.log(`  ${path.basename(out)} (${width}x${height})`);
        await cBrowser.close();
    };

    const rel = n => `tiles/${n}.png`;

    // strip 1400×560: full-bleed band of the four themes, thin gaps.
    await compose('strip.html', 1400, 560, `
        <div style="display:grid; grid-template-columns:repeat(${STRIP_THEMES.length}, 1fr);
                    gap:14px; height:100vh; padding:0;">
            ${STRIP_THEMES.map(t =>
                `<div class="card" style="border-radius:0; border-width:0 1px 0 0; box-shadow:none;">
                     <img src="${rel(`tree-${t}`)}">
                 </div>`).join('\n')}
        </div>`);

    // promo 1280×800 (sheet 1): main popup (tree + context menu) + 2×2 view
    // minis covering the entry-point views: search / staging-recent /
    // tab-groups / stats.
    await compose('promo.html', 1280, 800, `
        <div style="display:flex; gap:34px; height:100vh; padding:46px 38px;
                    background:#f4f6f9;">
            <div class="card" style="flex:none; width:472px;">
                <img src="${rel('tree-menu-light')}">
            </div>
            <div style="flex:1; display:grid; grid-template-columns:1fr 1fr;
                        grid-template-rows:1fr 1fr; gap:22px;">
                ${SHEET1_GRID.map(tile =>
                    `<div class="card"><img src="${rel(tile)}"></div>`).join('\n')}
            </div>
        </div>`);

    // promo2 1280×800 (sheet 2): the maintenance crew — dead-link scanner,
    // duplicate cleaner, command palette — three large minis.
    await compose('promo2.html', 1280, 800, `
        <div style="display:flex; gap:26px; height:100vh; padding:46px 38px;
                    background:#f4f6f9;">
            ${SHEET2_GRID.map(tile =>
                `<div class="card" style="flex:1;"><img src="${rel(tile)}"></div>`).join('\n')}
        </div>`);

    // themes 1280×800: the two crafted themes split full-bleed (ink | paper).
    await compose('themes.html', 1280, 800, `
        <div style="display:grid; grid-template-columns:1fr 1fr; height:100vh;">
            <div class="card" style="border-radius:0; border-width:0 1px 0 0; box-shadow:none;">
                <img src="${rel('tree-ink')}">
            </div>
            <div class="card" style="border-radius:0; border-width:0; box-shadow:none;">
                <img src="${rel('tree-paper')}">
            </div>
        </div>`);

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
                // coverage ≥ 1 = the n columns carry the whole page; prefer
                // the tightest fit (least idle column height).
                const score = coverage >= 1 ? coverage - 1 : 1 - coverage;
                if (!best || score < best.score) best = { n, colW, score };
            }
            const cols = [];
            for (let i = 0; i < best.n; i++) {
                // Inline sizing overrides the shared `.card img` height:100% +
                // object-fit:cover rules — those would pin the img box inside
                // the card and make the -i×COLH shift show nothing.
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
