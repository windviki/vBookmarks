// vBookmarks context-menu overflow verification — issue #48.
//
// Reproduces the reported "right-click a folder does nothing": the 19-entry
// folder menu can be TALLER than the popup viewport (seen at Windows 150%
// display scaling / page zoom ≥ ~90%: a ~760px menu in a ~600px popup, and at
// any short popup). The menu handler positions it and calls menu.focus();
// focus() scrolls the document to reveal the oversized menu, that scroll fires
// the menu's scroll-dismiss listeners, and the menu closes INSTANTLY — the
// user sees nothing. Fixed by clamping the menu height to the available
// viewport (max-height + internal overflow-y) before positioning, so it always
// fits and focus() never scrolls the page.
//
// The check drives a real contextmenu on a folder row in a SHORT viewport and
// asserts the menu is still shown 300ms later (opacity 1, .active kept) and
// fits within the viewport. Without the fix the menu is dismissed by the
// focus-induced scroll (FAIL); with the fix it stays open and scrolls
// internally (PASS).
//
// Run: docker run --rm vbm-smoke:local node /work/verify-menu-overflow.js
// Exits non-zero on any failed check (blocking run.sh step).
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = [], FAIL = [];
const check = (label, ok, detail) => {
    (ok ? PASS : FAIL).push(label);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
};

// One work folder with a couple of bookmarks so the tree has a folder row.
const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: 'Work' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
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
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
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

    // Seed, then open the popup fresh so the tree boots with data.
    const seedPage = await browser.newPage();
    watch(seedPage);
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(600);
    await seedPage.close();

    // The popup as a regular tab: the actions layer's post-open window.close
    // would close it for real and detach the CDP frame — stub it.
    const page = await browser.newPage();
    watch(page);
    await page.evaluateOnNewDocument(() => { window.close = () => {}; });
    // SHORT viewport: the tall folder menu cannot fit, which is exactly the
    // reported overflow condition.
    await page.setViewport({ width: 400, height: 320 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const $ = (fn, ...args) => page.evaluate(fn, ...args);

    // Fresh-install grace: dismiss the donation card through its own button.
    if (await $(() => {
        const d = document.getElementById('donation');
        return !!d && d.style.display !== 'none' && d.offsetHeight > 0;
    })) {
        await page.click('#donation-later');
        await sleep(300);
    }

    // Focus the tree and locate the Work folder row (a li.parent span).
    const folderReady = await $(async () => {
        for (let guard = 0; guard < 20 && !document.querySelector('#tree li.parent > span.tree-item-span'); guard++)
            await new Promise(r => setTimeout(r, 100));
        const span = document.querySelector('#tree li.parent > span.tree-item-span');
        return span ? (span.focus(), true) : false;
    });
    check('setup: a folder row exists and is focused', folderReady);

    // Right-click the folder — the exact gesture that opens the folder menu.
    const rect = await $(() => {
        const span = document.querySelector('#tree li.parent > span.tree-item-span');
        const r = span.getBoundingClientRect();
        span.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true, view: window,
            clientX: r.left + 20, clientY: r.top + 12
        }));
        return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    await sleep(300); // well past the 200ms dismissal window

    // The bug: the menu opens then the focus-induced document scroll fires the
    // scroll-dismiss and closes it — opacity returns to 0, .active is dropped.
    const state = await $(() => {
        const m = document.getElementById('folder-context-menu');
        const cs = getComputedStyle(m);
        const r = m.getBoundingClientRect();
        return {
            shown: m.style.opacity,          // '1' = handler set it visible
            computed: cs.opacity,            // ~1 once the fade-in finishes
            active: !!document.querySelector('.active'),
            maxHeight: m.style.maxHeight,
            overflowY: m.style.overflowY,
            rect: { x: Math.round(r.x), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
            vh: window.innerHeight,
            docScrollY: window.scrollY || document.documentElement.scrollTop,
            rectBottom: Math.round(r.bottom)
        };
    });
    console.log('  menu state:', JSON.stringify(state));

    check('menu is shown and STAYS open at 300ms (not dismissed by a scroll)',
        state.shown === '1' && state.active,
        state.shown !== '1' ? 'menu was closed (opacity back to 0) — the focus-induced scroll dismissed it'
            : !state.active ? '.active dropped' : undefined);
    check('menu is clamped to the popup viewport (fits, internal scroll)',
        state.maxHeight !== '' && state.overflowY === 'auto' && state.rectBottom <= state.vh,
        `maxHeight=${state.maxHeight} overflowY=${state.overflowY} bottom=${state.rectBottom} vh=${state.vh}`);
    // The menu must actually have opened over the right-click (folder menu).
    check('menu rect is inside the viewport (not parked at -999px)',
        state.rect.x > -500 && state.rect.h > 0,
        `x=${state.rect.x} h=${state.rect.h}`);

    check('no page JS errors during the gesture', pageErrors.length === 0, pageErrors.join('; '));

    console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})();
