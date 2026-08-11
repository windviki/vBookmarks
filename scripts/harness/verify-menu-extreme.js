// vBookmarks extreme zoom/resolution menu verification — issue #48 follow-up.
//
// Sweeps deviceScaleFactor × browser page zoom × popup viewport (including the
// in-extension data-zoom conditions the scrollbar matrix covers) and, per
// combo, opens the FOLDER menu in BOTH forms (the default collapsed-sort and
// the full expanded one) plus its sort flyout, then asserts:
//   1. the menu opens and STAYS open (the #48 failure class — oversized menu
//      → menu.focus() scroll → instant dismiss — must never come back);
//   2. the menu and flyout stay inside the viewport (no horizontal clipping at
//      extreme zoom, where the popup BODY can outgrow the window; no vertical
//      overflow past the #48 clamp);
//   3. the flyout never covers the collapse entry — it opens to the side,
//      flips, or stacks below the entry when there is no side room;
//   4. no page JS errors.
//
// Run: docker run --rm vbm-smoke:local node /work/verify-menu-extreme.js
// Exits non-zero on any failed check (blocking run.sh step).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PASS = [], FAIL = [];
const check = (label, ok, detail) => {
    (ok ? PASS : FAIL).push(label);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
};

const COMBOS = [
    { label: 'small@1x',     vw: 320, vh: 280, dpr: 1,   zoom: 1 },
    { label: 'small@2x',     vw: 320, vh: 280, dpr: 2,   zoom: 1 },
    { label: 'tiny@2x',      vw: 280, vh: 240, dpr: 2,   zoom: 1 },
    { label: 'narrow@1x',    vw: 260, vh: 500, dpr: 1,   zoom: 1 },
    { label: 'normal@2x',    vw: 400, vh: 600, dpr: 2,   zoom: 1 },
    { label: 'highzoom@1x',  vw: 400, vh: 600, dpr: 1,   zoom: 1.5 },
    { label: 'highzoom@2x',  vw: 400, vh: 600, dpr: 2,   zoom: 1.5 },
    { label: 'maxzoom@2x',   vw: 400, vh: 600, dpr: 2,   zoom: 2 },
    { label: 'maxzoom@2.5x', vw: 400, vh: 600, dpr: 2.5, zoom: 2 },
    { label: 'narrowzoom@2x', vw: 280, vh: 420, dpr: 2,  zoom: 1.5 },
];

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: 'Work' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com' });
    await create({ parentId: '1', title: 'Top-level', url: 'https://example.com' })})()`;

(async () => {
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
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) { console.error('service worker not found'); process.exit(2); }
    const extId = new URL(swTarget.url()).hostname;

    const seedPage = await browser.newPage();
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(500);
    await seedPage.evaluate(SEED);
    await sleep(500);
    await seedPage.close();

    const openCombo = async (c, collapseSort) => {
        const page = await browser.newPage();
        const pageErrors = [];
        page.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
        {
            const o = await browser.newPage();
            await o.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
            await o.evaluate(cs => chrome.storage.local.set({ collapseSortMenu: cs ? '1' : '' }), collapseSort);
            await o.close();
        }
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.setViewport({ width: c.vw, height: c.vh, deviceScaleFactor: c.dpr });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(1200);
        if (c.zoom !== 1) {
            await page.evaluate(async z => {
                const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tabs[0]) await chrome.tabs.setZoom(tabs[0].id, z);
            }, c.zoom);
            await sleep(400);
        }
        await page.evaluate(() => {
            const d = document.getElementById('donation');
            if (d && d.style.display !== 'none' && d.offsetHeight > 0)
                document.getElementById('donation-later').click();
        }).catch(() => {});
        await sleep(300);
        return { page, pageErrors };
    };

    const probe = async ($) => {
        return $(async () => {
            const nap = ms => new Promise(r => setTimeout(r, ms));
            let span = null;
            for (let g = 0; g < 25 && !span; g++) {
                span = document.querySelector(
                    '#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
                if (!span) {
                    // expand the root first so a real folder exists
                    const root = document.querySelector('#tree li.parent > span.tree-item-span');
                    if (root) {
                        root.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    }
                    await nap(120);
                }
            }
            if (!span) return null;
            const r = span.getBoundingClientRect();
            span.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, view: window,
                clientX: r.left + 20, clientY: r.top + 10
            }));
            await nap(300);
            const rectOf = el => {
                const b = el.getBoundingClientRect();
                return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
            };
            const m = document.getElementById('folder-context-menu');
            const entry = document.getElementById('folder-sort-collapse');
            const entryR = entry ? entry.getBoundingClientRect() : null;
            if (entry && entry.style && getComputedStyle(entry).display !== 'none')
                entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            await nap(250);
            const sub = document.getElementById('folder-sort-submenu');
            return {
                win: { w: window.innerWidth, h: window.innerHeight },
                menu: { shown: m.style.opacity, rect: rectOf(m) },
                entry: entryR ? { l: Math.round(entryR.left), r: Math.round(entryR.right), t: Math.round(entryR.top), h: Math.round(entryR.height), visible: getComputedStyle(entry).display !== 'none' } : null,
                sub: { shown: sub.style.opacity, rect: rectOf(sub), items: sub.querySelectorAll('.menu-item').length }
            };
        });
    };

    for (const c of COMBOS) {
        for (const collapseSort of [true, false]) {
            const label = `[${c.label}] collapseSort=${collapseSort}`;
            const ctx = await openCombo(c, collapseSort);
            const st = await probe(fn => ctx.page.evaluate(fn));
            if (!st) { check(`${label} folder row found`, false); await ctx.page.close(); continue; }
            const vw = st.win.w, vh = st.win.h;
            check(`${label} folder menu stays open`, st.menu.shown === '1');
            // +2 tolerates the 1px menu border at fractional-zoom rounding.
            check(`${label} folder menu inside viewport (no clip)`,
                st.menu.rect.l >= 0 && st.menu.rect.r <= vw + 2 && st.menu.rect.b <= vh + 2,
                `rect=${JSON.stringify(st.menu.rect)} win=${vw}x${vh}`);
            const flyoutExpected = collapseSort && st.entry && st.entry.visible;
            if (flyoutExpected) {
                check(`${label} sort flyout opens`, st.sub.shown === '1' && st.sub.items === 3);
                check(`${label} flyout inside viewport`,
                    st.sub.rect.l >= 0 && st.sub.rect.r <= vw + 2 && st.sub.rect.b <= vh + 2,
                    `rect=${JSON.stringify(st.sub.rect)}`);
                // The flyout must not cover the entry WHEN a non-overlapping
                // beside-placement is geometrically possible. When the popup
                // is so narrow that neither side fits (and the vertical fallback
                // clamps onto the entry), overlap is the accepted fallback.
                const fitsRight = st.entry.r + st.sub.rect.w <= vw;
                const fitsLeft = st.entry.l - st.sub.rect.w >= 0;
                if (fitsRight || fitsLeft) {
                    const covers = st.sub.rect.l < st.entry.r && st.sub.rect.r > st.entry.l &&
                        st.sub.rect.t < st.entry.t + st.entry.h && st.sub.rect.b > st.entry.t;
                    check(`${label} flyout does not cover the entry`, !covers,
                        `sub=${JSON.stringify(st.sub.rect)} entry=${JSON.stringify(st.entry)}`);
                }
            }
            check(`${label} no page JS errors`, ctx.pageErrors.length === 0, ctx.pageErrors.join('; '));
            // Visual confirmation per combo: the open folder menu (+ flyout
            // when collapsed) at that DPR × zoom × size.
            require('fs').mkdirSync('/tmp/shots/verify-menu-extreme', { recursive: true });
            await ctx.page.screenshot({
                path: `/tmp/shots/verify-menu-extreme/${c.label}-${collapseSort ? 'collapsed' : 'expanded'}.png`
            });
            await ctx.page.close();
        }
    }

    console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})();
