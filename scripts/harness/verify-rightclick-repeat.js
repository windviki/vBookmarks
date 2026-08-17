// vBookmarks right-click-repeat regression — the zoom alternation bug.
//
// User repro (zoom > 100): right-click a folder row at several points on the
// SAME row consecutively. The zoom-scaled context menu is TALLER than the
// space around the trigger, so positionMenu flips it up to menuMinY where it
// COVERS the triggered row — a follow-up right-click on the covered row is
// dispatched by the browser to the MENU (not the row). The 4.0.5-era fix
// compressed the menu down to the space below the row so it never covered it,
// but that shrank the menu (a regression: the menu must show AS COMPLETELY AS
// POSSIBLE). The current fix: the menu keeps its full height (viewport-clamped
// to a scrollable box only), and a right-click on an open menu's background
// RE-OPENS it at the pointer (menuBackgroundReposition) instead of dismissing
// it — so every right-click shows the menu again, at a stable full height.
//
// This drives a real browser at zoom 120: right-click the Work folder at 4
// row points (including mid-row points the old bug covered) and assert the
// folder menu is visible after EVERY right-click, its height never varies (no
// compression clamp), and right-clicks that land on the open menu background
// still re-open it.
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
        // Expected offline-sandbox noise: Chromium's own resource-load errors
        // from the favicon pipeline / seeded bookmark hosts. They are not
        // extension console.error calls and must not fail the gate.
        page.on('pageerror', e => {
            const msg = e.message || '';
            if (msg.includes('Failed to load resource') || msg.includes('net::') || msg.includes('Refused to'))
                return;
            pageErrors.push(`pageerror: ${msg}`);
        });
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const txt = m.text() || '';
            if (txt.includes('Failed to load resource') || txt.includes('net::') || txt.includes('Refused to'))
                return;
            pageErrors.push(`console: ${txt}`);
        });
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
    // load, not networkidle0: seeded bookmark rows fire chrome-extension
    // _favicon requests that never settle in the offline DinD sandbox.
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
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

    // Re-locate the Work folder row per phase — CSS zoom on the tree moves the
    // rows, so the trigger geometry must be read after each zoom change.
    const locateRow = async () => {
        const r = await $(async () => {
            const nap = ms => new Promise(r => setTimeout(r, ms));
            let span = null;
            for (let g = 0; g < 25 && !span; g++) {
                span = document.querySelector(
                    '#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
                if (!span) await nap(100);
            }
            if (!span) return null;
            const b = span.getBoundingClientRect();
            return { left: b.left, top: b.top, w: b.width, h: b.height };
        });
        if (!r) { console.error('work folder not found'); process.exit(2); }
        return r;
    };
    const row0 = await locateRow();
    console.log(`work folder row: left=${row0.left.toFixed(1)} top=${row0.top.toFixed(1)} w=${row0.w.toFixed(1)} h=${row0.h.toFixed(1)}`);

    const snap = () => $(() => {
        const m = document.getElementById('folder-context-menu');
        const mr = m.getBoundingClientRect();
        const s = document.getElementById('search');
        // The viewport clamp's TOTAL box height — positionMenu clamps the
        // menu to the space below the search bar (content maxHeight + the
        // menu's own chrome = viewportH - menuMinY - 8). menuMinY in viewport
        // space is the search bar's rect bottom, directly comparable to
        // window.innerHeight (both are CSS-zoom-independent viewport px).
        const clampH = Math.round(window.innerHeight - s.getBoundingClientRect().bottom - 8);
        return {
            op: m.style.opacity,
            ml: Math.round(mr.left), mw: Math.round(mr.width),
            mt: Math.round(mr.top), mb: Math.round(mr.bottom),
            // visible content height vs the natural full-content height:
            // equal → the menu shows completely; when the natural height
            // overflows, the total box must sit exactly at the clamp.
            clientH: m.clientHeight,
            scrollH: m.scrollHeight,
            rectH: Math.round(mr.height),
            clampH,
            maxHeight: m.style.maxHeight
        };
    });

    // Right-click the row at 4 points (including mid-row points the old bug
    // covered), consecutively — the menu stays open between rounds. Every
    // click must show the menu: when the click lands on the row the body
    // handler opens it, and when it lands on the open menu's background the
    // menuBackgroundReposition wrapper re-opens it at the pointer.
    //
    // Full-height rule (把关): the menu must show as completely as the popup
    // allows. The ONLY compression permitted is the viewport-level clamp — when
    // even the whole space below the search bar cannot fit the menu (zoom
    // enlarged it past the popup), the menu turns scrollable and its total box
    // sits exactly at that clamp. Anything SMALLER is the 4.0.5-era regression
    // (the menu shrank to the space below its row). Run at two zooms: one where
    // the menu fits (120) and one where it is forced scrollable (180).
    // Click at fractions across the row's current width (zoom scales the row,
    // so fixed pixel offsets would drift off it at the higher zoom phase).
    const pts = [0.12, 0.38, 0.62, 0.85];
    const runPhase = async label => {
        const row = await locateRow();
        const y = row.top + 8;
        let allShown = true, allFullHeight = true, stableNatural = true, scrollH = null;
        let bgClicks = 0, bgShown = 0;
        for (let i = 0; i < 12; i++) {
            const x = Math.round(row.left + row.w * pts[i % 4]);
            // Was the previous open menu covering this point? (the alternation
            // bug's path — the browser dispatches the click to the menu, not
            // the row; it must re-open instead of hide.)
            const prev = await snap();
            const onMenu = i > 0 && prev.op === '1'
                && x >= prev.ml && x <= prev.ml + prev.mw
                && y >= prev.mt && y <= prev.mb;
            await page.mouse.click(x, y, { button: 'right' });
            await sleep(400);
            const st = await snap();
            const shown = st.op === '1';
            const fullHeight = st.clientH === st.scrollH ||
                (st.scrollH > st.clientH && st.rectH === st.clampH);
            if (scrollH === null) scrollH = st.scrollH;
            else if (st.scrollH !== scrollH) stableNatural = false;
            if (!shown) allShown = false;
            if (!fullHeight) allFullHeight = false;
            if (onMenu) { bgClicks++; if (shown) bgShown++; }
            console.log(`  ${label} rc#${i + 1} x=${x} onMenu=${onMenu} → op=${st.op} vis=${st.clientH} nat=${st.scrollH} clamp=${st.clampH} maxH=${st.maxHeight || '-'} fullH=${fullHeight} menu@(${st.ml},${st.mt} ${st.mw}x${st.mb - st.mt})`);
        }
        check(`${label}: every right-click shows the folder menu`, allShown,
            allShown ? 'all 12' : 'alternation (zoom bug)');
        check(`${label}: the menu shows at full height (only the viewport clamp may add a scrollbar)`, allFullHeight,
            allFullHeight ? 'never shrank below the row' : 'compressed (4.0.5 regression)');
        check(`${label}: the menu natural height never varies`, stableNatural,
            stableNatural ? `${scrollH}px content every time` : 'content height varied');
        check(`${label}: right-clicks landing on the menu background still re-open it`, bgClicks === 0 || bgShown === bgClicks,
            bgClicks ? `${bgShown}/${bgClicks} on-menu clicks re-opened` : 'no click landed on the menu');
    };

    // The scrollable case — a zoom-enlarged menu taller than the whole popup
    // turning into a viewport-clamped scrollable box — is the ONE permitted
    // "compression", and it is gated separately by verify-menu-overflow.js
    // (maxHeight + overflowY auto, fits inside the popup, stays open).
    await runPhase(`zoom${zoom}`);

    console.log('\n═══ summary ═══');
    console.log(`PASS ${PASS.length} / FAIL ${FAIL.length}`);
    if (pageErrors.length) {
        console.log('page errors:', pageErrors.slice(0, 5));
        FAIL.push('page errors');
    }
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})();
