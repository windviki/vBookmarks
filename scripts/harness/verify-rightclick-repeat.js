// vBookmarks right-click-repeat regression — the zoom alternation bug.
//
// User repro (zoom > 100): right-click a folder row at several points on the
// SAME row consecutively. When the zoom-scaled context menu is TALLER than the
// space around the trigger, positionMenu used to flip it up to menuMinY where
// it COVERED the triggered row — a follow-up right-click on the covered row is
// dispatched by the browser to the MENU (not the row) and dismisses it, so the
// menu alternated shown/hidden per click. Fix: clamp the menu height to the
// space below the trigger and drop its top edge below the triggered row
// (ROW_GUESS), so the menu never covers the row and every right-click reopens.
//
// This drives a real browser at zoom 120: right-click the Work folder at 4
// row points (including mid-row ones that the OLD bug covered) and assert the
// folder menu is visible after EVERY right-click AND never covers the row.
//
// Run: docker run --rm vbm-smoke:local node /work/verify-rightclick-repeat.js
// Exits non-zero on any failed check (blocking run.sh step).
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = [], FAIL = [];
const check = (label, ok, detail) => {
    (ok ? PASS : FAIL).push(label);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
};

const SEED = `
(async () => {
    const c = p => new Promise(r => chrome.bookmarks.create(p, r));
    const w = await c({parentId: '1', title: 'Work'});
    await c({parentId: w.id, title: 'GitHub', url: 'https://github.com/vBookmarks'});
    await c({parentId: w.id, title: 'MDN', url: 'https://developer.mozilla.org/docs/Web'});
    await c({parentId: w.id, title: 'Stack Overflow', url: 'https://stackoverflow.com'});
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });

    const pageErrors = [];
    const watch = page => {
        page.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) { console.error('service worker not found'); process.exit(2); }
    const extId = new URL(swTarget.url()).hostname;

    const seedPage = await browser.newPage();
    watch(seedPage);
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(600);
    await seedPage.close();

    const page = await browser.newPage();
    watch(page);
    await page.evaluateOnNewDocument(() => { window.close = () => {}; });
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const $ = (fn, ...args) => page.evaluate(fn, ...args);

    if (await $(() => {
        const d = document.getElementById('donation');
        return !!d && d.style.display !== 'none' && d.offsetHeight > 0;
    })) {
        await page.click('#donation-later');
        await sleep(300);
    }

    // Zoom in — the bug only manifests at zoom > 100 (menu items scale via
    // body[data-zoom] menu[type=context] .menu-item, making the menu taller
    // than the space around the trigger).
    const zoom = process.env.VBM_ZOOM || '120';
    await page.evaluate(z => { document.body.dataset.zoom = z; }, zoom);
    await sleep(400);
    console.log(`zoom=${zoom}%`);

    // Expand the bookmarks bar root so a real folder exists.
    await $(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        let root = null;
        for (let g = 0; g < 25 && !root; g++) {
            root = document.querySelector('#tree li.parent > span.tree-item-span');
            if (!root) await nap(100);
        }
        if (root) {
            root.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            await nap(400);
        }
        return !!root;
    });
    await sleep(500);

    const row = await $(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        let span = null;
        for (let g = 0; g < 25 && !span; g++) {
            span = document.querySelector(
                '#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
            if (!span) await nap(100);
        }
        if (!span) return null;
        const r = span.getBoundingClientRect();
        return { left: r.left, top: r.top, w: r.width, h: r.height };
    });
    if (!row) { console.error('work folder not found'); process.exit(2); }
    console.log(`work folder row: left=${row.left.toFixed(1)} top=${row.top.toFixed(1)} w=${row.w.toFixed(1)} h=${row.h.toFixed(1)}`);

    const snap = () => $(() => {
        const m = document.getElementById('folder-context-menu');
        const mr = m.getBoundingClientRect();
        const s = document.querySelector(
            '#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
        const sr = s.getBoundingClientRect();
        return {
            op: m.style.opacity,
            ml: Math.round(mr.left), mw: Math.round(mr.width),
            mt: Math.round(mr.top), mb: Math.round(mr.bottom),
            rowT: Math.round(sr.top), rowB: Math.round(sr.bottom)
        };
    });

    // Right-click the row at 4 points (including mid-row points the OLD bug
    // covered), consecutively (menu stays open between rounds). Every click
    // must show the menu AND the menu must not cover the row.
    const pts = [20, 90, 160, 230];
    const y = row.top + 8;
    let allShown = true, allNotCovering = true;
    for (let i = 0; i < 12; i++) {
        const x = row.left + pts[i % 4];
        await page.mouse.click(x, y, { button: 'right' });
        await sleep(400);
        const st = await snap();
        const shown = st.op === '1';
        const coversRow = st.mt < st.rowB && st.mb > st.rowT;
        if (!shown) allShown = false;
        if (coversRow) allNotCovering = false;
        console.log(`  rc#${i + 1} x=${x} → op=${st.op} menu@(${st.ml},${st.mt} ${st.mw}x${st.mb - st.mt}) row=[${st.rowT},${st.rowB}] coversRow=${coversRow}`);
    }
    check('every right-click shows the folder menu', allShown,
        allShown ? 'all 12' : 'alternation (zoom bug)');
    check('the menu never covers the triggered row', allNotCovering,
        allNotCovering ? 'menu below the row' : 'menu overlapped the row');

    console.log('\n═══ summary ═══');
    console.log(`PASS ${PASS.length} / FAIL ${FAIL.length}`);
    if (pageErrors.length) {
        console.log('page errors:', pageErrors.slice(0, 5));
        FAIL.push('page errors');
    }
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})();
