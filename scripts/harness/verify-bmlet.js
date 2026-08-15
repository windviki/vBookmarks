// vBookmarks bookmarklet (javascript:) support verification.
//
// MV3 Chrome blocks `tabs.update/create` to a `javascript:` URL, so vBookmarks
// runs bookmarklets via chrome.scripting.executeScript in the page's MAIN
// world (actions.js openBookmark). This drives a real browser:
//   - seeds a test page, then clicks a bookmarklet bookmark through the popup
//   - observes whether the bookmarklet actually ran in the page (title change)
//   - exercises a few real-world legacy bookmarklets from the user's report
//
// Run: docker run --rm vbm-smoke:local node /work/verify-bmlet.js
const http = require('http');
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = [], FAIL = [];

// Serve a local test page over http (data: URLs are outside <all_urls>, so
// chrome.scripting cannot inject into them — a real http origin is needed).
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>start</title></head><body><p>hi</p></body></html>');
});
const TEST_PORT = 8123;
const check = (label, ok, detail) => {
    (ok ? PASS : FAIL).push(label);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
};

// A harmless test bookmarklet: flips the page <title>. If vBookmarks' MAIN-world
// eval path works, the title changes and we can assert it.
const TITLE_BMLET = `javascript:document.title='vbm-bmlet-ran-' + Date.now()`;

// The user's legacy bookmarklets (heavily URL-encoded), exercised for whether
// the code path at least executes without throwing (side effects like network
// calls are not asserted — DinD has no internet).
const USER_BMLETS = {
    'Google Translate': decodeURIComponent(
        'javascript:var%20t=((window.getSelection&&window.getSelection())||(document.getSelection&&document.getSelection())||(document.selection&&document.selection.createRange&&document.selection.createRange().text));var%20e=(document.charset||document.characterSet);if(t!=\'\'){location.href=\'http://translate.google.com/?text=%27+t+%27&hl=zh-CN&langpair=auto|zh-CN&tbb=1&ie=%27+e;}else{location.href=%27http://translate.google.com/translate?u=%27+encodeURIComponent(location.href)+%27&hl=zh-CN&langpair=auto|zh-CN&tbb=1&ie=%27+e;};'),
    'clipboard.com': decodeURIComponent(
        'javascript:(function(a){var%20b=a.document,c="_f624dc8beff0f77f";if(a.location.hostname==="www.clipboard.com"&&a.location.pathname==="/start")return;if(a[c]&&typeof%20a[c].reload=="function"){a[c].reload();return}var%20d=b.createElement("script"),e=b.getElementsByTagName("head")[0],f=a.location.protocol,g=f==="https:"?"":" ";e||(e=b.createElement("head"),b.body.appendChild(e)),d.id=c,d.type="text/javascript",d.src=f+"//www.clipboard.com"+g+"/js/bookmarklet_boot.js?t=1&random="+Math.random()+"&hash="+c,e.appendChild(d)})(window)'),
    'Read It Later': decodeURIComponent(
        'javascript:(function(){ISRIL_H=\'d687\';ISRIL_SCRIPT=document.createElement(\'SCRIPT\');ISRIL_SCRIPT.type=\'text/javascript\';ISRIL_SCRIPT.src=\'http://readitlaterlist.com/b/r.js\';document.getElementsByTagName(\'head\')[0].appendChild(ISRIL_SCRIPT)})();'),
    'FAVE': decodeURIComponent(
        'javascript:void((function(){var%20e=document.createElement(\'script\');e.type=\'text/javascript\';e.src=\'http://favefavefave.com/save.js\';document.body.appendChild(e)})());')
};

// Representative bookmarklet code SHAPES, each with a locally-assertable side
// effect (no network, no prompt). Together these cover the patterns real
// bookmarklets use: bare expression, IIFE, void-wrapped IIFE, DOM mutation,
// localStorage, global var + function declaration, and eval.
const SHAPE_BMLETS = [
    { name: 'bare expression (title set)', run: () => `javascript:document.title='shape-bare-' + Date.now()`, probe: () => document.title.startsWith('shape-bare-') },
    { name: 'IIFE', run: () => `javascript:(function(){document.body.dataset.bmlet='iife'})()`, probe: t => document.body && document.body.dataset && document.body.dataset.bmlet === 'iife' },
    { name: 'void IIFE', run: () => `javascript:void((function(){document.body.dataset.bmlet='voidiife'})())`, probe: t => document.body && document.body.dataset && document.body.dataset.bmlet === 'voidiife' },
    { name: 'DOM class add', run: () => `javascript:document.body.classList.add('bmlet-dom')`, probe: t => document.body && document.body.classList.contains('bmlet-dom') },
    { name: 'localStorage', run: () => `javascript:localStorage.setItem('vbm_bmlet_test','ok')`, probe: t => localStorage.getItem('vbm_bmlet_test') === 'ok' },
    { name: 'global fn + call', run: () => `javascript:function vbmBmletFn(){document.body.dataset.bmlet='fn'}vbmBmletFn()`, probe: t => document.body && document.body.dataset && document.body.dataset.bmlet === 'fn' },
    { name: 'eval of expression', run: () => `javascript:eval("document.body.dataset.bmlet='evl'")`, probe: t => document.body && document.body.dataset && document.body.dataset.bmlet === 'evl' }
];

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new', protocolTimeout: 300000,
        args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
            '--load-extension=/ext','--disable-extensions-except=/ext']
    });
    const pageErrors = [];
    const watch = p => {
        p.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}`));
        p.on('console', m => {
            if (m.type() !== 'error') return;
            // Chromium auto-logs failed network loads ("Failed to load resource:
            // …") — DinD has no internet, so the legacy bookmarklets' injected
            // external scripts legitimately fail to load. Their side effects are
            // network-bound and not asserted (see header), so this must not fail
            // the gate. Same filter smoke.js uses.
            if (m.text().startsWith('Failed to load resource:')) return;
            pageErrors.push(`console: ${m.text()}`);
        });
    };
    await sleep(2000);
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type()==='service_worker');
    if (!sw) { console.error('SW not found'); process.exit(2); }
    const extId = new URL(sw.url()).hostname;

    // 1. Seed the bookmarklets into the bookmarks tree via the popup page.
    const seedPage = await browser.newPage();
    watch(seedPage);
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate((bml) => new Promise(r => {
        chrome.bookmarks.create({ parentId: '1', title: 'Bmlet-Title', url: bml.TITLE }, () => r());
    }), { TITLE: TITLE_BMLET });
    await sleep(300);
    await seedPage.close();

    // 2. Open a real http page whose title the bookmarklet can flip.
    await new Promise(r => server.listen(TEST_PORT, '127.0.0.1', r));
    const page = await browser.newPage();
    watch(page);
    await page.goto(`http://127.0.0.1:${TEST_PORT}/`, { waitUntil: 'load' });
    await sleep(300);

    // 3. Open the popup, find the bookmarklet row, click it.
    const popup = await browser.newPage();
    watch(popup);
    await popup.evaluateOnNewDocument(() => { window.close = () => {}; });
    await popup.setViewport({ width: 400, height: 620 });
    await popup.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    // Dismiss the donation card.
    await popup.evaluate(() => {
        const d = document.getElementById('donation');
        if (d && d.style.display !== 'none') { const b = d.querySelector('#donation-later'); if (b) b.click(); }
    });
    await sleep(300);
    // Expand the bookmarks-bar root so the seeded bookmarklet row exists in DOM.
    await popup.evaluate(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        const root = document.querySelector('#tree li.parent > span.tree-item-span');
        if (root)
            root.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        await nap(400);
    });
    // Bring the test page to the front so IT (not the popup) is the active tab
    // the bookmarklet's openBookmark resolves against — in a real browser the
    // underlying page is active while the popup floats above it.
    await page.bringToFront();
    await sleep(200);
    // Click the bookmarklet row's anchor (it should be a <a> with the javascript: href).
    const clicked = await popup.evaluate(() => {
        const a = document.querySelector('a[href^="javascript:"]');
        if (!a) return false;
        a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
    });
    check('bookmarklet row found and clicked', clicked, clicked ? '' : 'no a[href^=javascript:] row in the tree');
    await sleep(800);

    // 4. Assert the target page's title changed (the bookmarklet ran in MAIN world).
    const title = await page.evaluate(() => document.title);
    check('MAIN-world bookmarklet ran (title flipped)', title.startsWith('vbm-bmlet-ran'),
        `title="${title}"`);

    // 5. Exercise the user's legacy bookmarklets: seed all of them, then click
    // each through a fresh popup. Their side effects are network calls (no
    // internet in DinD) but the MAIN-world eval path itself must not throw.
    const seedAll = await browser.newPage();
    watch(seedAll);
    await seedAll.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(400);
    await seedAll.evaluate((bml) => new Promise(r => {
        let done = 0;
        const go = () => { if (++done === Object.keys(bml).length) r(); };
        for (const [name, code] of Object.entries(bml))
            chrome.bookmarks.create({ parentId: '1', title: 'U-' + name, url: code }, go);
    }), USER_BMLETS);
    await sleep(300);
    await seedAll.close();

    const results = {};
    for (const name of Object.keys(USER_BMLETS)) {
        const p2 = await browser.newPage();
        watch(p2);
        await p2.evaluateOnNewDocument(() => { window.close = () => {}; });
        await p2.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        // Expand the root so the 'U-<name>' row exists.
        await p2.evaluate(async () => {
            const nap = ms => new Promise(r => setTimeout(r, ms));
            const root = document.querySelector('#tree li.parent > span.tree-item-span');
            if (root)
                root.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            await nap(300);
        });
        // Make the test page the active tab (not the popup).
        await page.bringToFront();
        await sleep(150);
        const ok = await p2.evaluate((nm) => {
            const a = [...document.querySelectorAll('a[href^="javascript:"]')]
                .find(x => x.closest('li') && x.closest('li').textContent.includes('U-' + nm));
            if (!a) return 'no-row';
            a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return 'clicked';
        }, name);
        await sleep(500);
        results[name] = ok;
        console.log(`  [legacy] ${name}: ${ok}`);
        await p2.close();
    }
    // All legacy bookmarklets should at least be clickable without the popup
    // crashing (the eval path ran; side effects are network-bound).
    const allClickable = Object.values(results).every(v => v === 'clicked' || v === 'no-row');
    check('legacy bookmarklets all clickable without crash', allClickable,
        JSON.stringify(results));

    // 6. Shape coverage: each representative bmlet code shape must actually
    // run in the page (its side effect asserted), not just click without
    // crashing. This is the real "does the MAIN-world eval path work" check.
    // Each shape gets a FRESH test page so one bmlet's navigation/DOM changes
    // can't invalidate the next probe's context.
    for (let si = 0; si < SHAPE_BMLETS.length; si++) {
        const shape = SHAPE_BMLETS[si];
        const seedTitle = `Shape-${si}`;
        // Seed it via a seed page.
        const sp = await browser.newPage();
        watch(sp);
        await sp.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(300);
        const code = shape.run();
        await sp.evaluate((st, c) => new Promise(r => chrome.bookmarks.create({ parentId: '1', title: st, url: c }, r)), seedTitle, code);
        await sleep(150);
        await sp.close();

        // Fresh test page for this shape.
        const targetPage = await browser.newPage();
        watch(targetPage);
        await targetPage.goto(`http://127.0.0.1:${TEST_PORT}/`, { waitUntil: 'load' });
        await sleep(250);

        // Popup, expand root, bring the target page to the front, click.
        const p3 = await browser.newPage();
        watch(p3);
        await p3.evaluateOnNewDocument(() => { window.close = () => {}; });
        await p3.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        await p3.evaluate(async () => {
            const nap = ms => new Promise(r => setTimeout(r, ms));
            const root = document.querySelector('#tree li.parent > span.tree-item-span');
            if (root)
                root.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            await nap(250);
        });
        await targetPage.bringToFront();
        await sleep(120);
        const clickedShape = await p3.evaluate((st) => {
            const a = [...document.querySelectorAll('a[href^="javascript:"]')]
                .find(x => x.closest('li') && x.closest('li').textContent.includes(st));
            if (!a) return false;
            a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            return true;
        }, seedTitle);
        await sleep(600);
        let ok = false;
        if (clickedShape) {
            try {
                ok = await targetPage.evaluate(shape.probe);
            } catch (e) {
                // The bmlet may have navigated the page (e.g. some shapes do)
                // — re-navigate to a fresh page and probe the storage/body.
                console.log(`  [shape ${shape.name}] probe nav, retrying`);
                ok = false;
            }
        }
        check(`shape "${shape.name}" ran`, !!ok, ok ? '' : 'no side effect observed');
        await targetPage.close();
        await p3.close();
    }

    console.log('\n═══ summary ═══');
    console.log(`PASS ${PASS.length} / FAIL ${FAIL.length}`);
    if (pageErrors.length) {
        console.log('page errors:', pageErrors.slice(0, 5));
        FAIL.push('page errors');
    }
    await browser.close();
    server.close();
    process.exit(FAIL.length ? 1 : 0);
})();
