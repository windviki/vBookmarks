// Why does a right-click on the far-left #resizer-x handle dismiss the menu
// even though the body contextmenu handler re-opens any open menu on a non-row
// hit? Capture the full event sequence (pointerdown/mousedown/pointerup/mouseup
///contextmenu) on that single click, with stopPropagation/preventDefault flags,
// to see who eats the event before/after the body handler.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const c = p => new Promise(r => chrome.bookmarks.create(p, r));
    const w = await c({parentId: '1', title: 'Work'});
    await c({parentId: w.id, title: 'GitHub', url: 'https://github.com/vBookmarks'});
    await c({parentId: w.id, title: 'MDN', url: 'https://developer.mozilla.org/docs/Web'});
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new', protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) { console.error('sw not found'); process.exit(2); }
    const extId = new URL(swTarget.url()).hostname;
    const seedPage = await browser.newPage();
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(600);
    await seedPage.close();

    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => { window.close = () => {}; });
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const $ = (fn, ...args) => page.evaluate(fn, ...args);

    if (await $(() => {
        const d = document.getElementById('donation');
        return !!d && d.style.display !== 'none' && d.offsetHeight > 0;
    })) { await page.click('#donation-later'); await sleep(300); }

    await page.evaluate(z => { document.body.dataset.zoom = z; }, process.env.VBM_ZOOM || '120');
    await sleep(400);

    // Arm a capture listener on every interesting event, on the CAPTURE phase,
    // recording target + whether a body-level listener stopped/prevented it.
    await page.evaluate(() => {
        window.__ev = [];
        const mark = (type, ev) => {
            const t = ev.target;
            const tag = t ? (t.id ? `#${t.id}` : `${t.tagName}${t.className && typeof t.className === 'string' ? '.' + t.className.split(' ').join('.') : ''}`) : '?';
            window.__ev.push(`${type} target=${tag} defaultPrevented=${ev.defaultPrevented}`);
        };
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'contextmenu', 'click'])
            document.addEventListener(t, ev => mark(t, ev), true);
    });

    await $(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        let root = null;
        for (let g = 0; g < 25 && !root; g++) {
            root = document.querySelector('#tree li.parent > span.tree-item-span');
            if (!root) await nap(100);
        }
        if (root) { root.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); await nap(400); }
        return !!root;
    });
    await sleep(500);

    const row = await $(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        let span = null;
        for (let g = 0; g < 25 && !span; g++) {
            span = document.querySelector('#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
            if (!span) await nap(100);
        }
        if (!span) return null;
        const b = span.getBoundingClientRect();
        return { left: b.left, top: b.top, w: b.width };
    });
    console.log(`row left=${row.left.toFixed(1)} top=${row.top.toFixed(1)}`);

    const snap = () => $(() => {
        const m = document.getElementById('folder-context-menu');
        const r = m.getBoundingClientRect();
        return { op: m.style.opacity, rect: `(${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})` };
    });

    // Open via the row.
    await page.mouse.click(row.left + row.w * 0.30, row.top + 8, { button: 'right' });
    await sleep(400);
    console.log('after open:', JSON.stringify(await snap()));

    // The far-left resizer click.
    await page.evaluate(() => { window.__ev = []; });
    const x = row.left + 4;
    console.log(`\n--- right-click at (${Math.round(x)},${Math.round(row.top + 8)}) ---`);
    await page.mouse.click(x, row.top + 8, { button: 'right' });
    await sleep(400);
    console.log((await page.evaluate(() => window.__ev)).join('\n'));
    console.log('after resizer click:', JSON.stringify(await snap()));

    await browser.close();
    process.exit(0);
})();
