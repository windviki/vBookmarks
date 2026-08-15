// Focused zoom-sweep of the user's gesture: right-click the folder row, then
// right-click the SAME row again at (a) the exposed left strip (visually
// outside the menu) and (b) the covered part (visually under the menu). The
// menu must stay open / re-open at the pointer on every click.
// Run at several in-extension zooms to find where the menu "disappears".
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const ZOOMS = (process.env.VBM_ZOOMS || '110,130,140,150').split(',');

const SEED = `
(async () => {
    const c = p => new Promise(r => chrome.bookmarks.create(p, r));
    const w = await c({parentId: '1', title: 'Work'});
    await c({parentId: w.id, title: 'GitHub', url: 'https://github.com/vBookmarks'});
    await c({parentId: w.id, title: 'MDN', url: 'https://developer.mozilla.org/docs/Web'});
    await c({parentId: w.id, title: 'Stack Overflow', url: 'https://stackoverflow.com'});
})()`;

const openPopups = async browser => {
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) { console.error('service worker not found'); process.exit(2); }
    const extId = new URL(swTarget.url()).hostname;
    const seedPage = await browser.newPage();
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(600);
    await seedPage.close();
    return extId;
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const extId = await openPopups(browser);

    for (const zoom of ZOOMS) {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.setViewport({ width: 400, height: 620 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(1200);
        const $ = (fn, ...args) => page.evaluate(fn, ...args);

        if (await $(() => {
            const d = document.getElementById('donation');
            return !!d && d.style.display !== 'none' && d.offsetHeight > 0;
        })) { await page.click('#donation-later'); await sleep(300); }

        await page.evaluate(z => { document.body.dataset.zoom = z; }, zoom);
        await sleep(400);

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
        await sleep(400);

        const row = await $(async () => {
            const nap = ms => new Promise(r => setTimeout(r, ms));
            let span = null;
            for (let g = 0; g < 25 && !span; g++) {
                span = document.querySelector('#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
                if (!span) await nap(100);
            }
            if (!span) return null;
            const b = span.getBoundingClientRect();
            return { left: b.left, top: b.top, w: b.width, h: b.height };
        });
        if (!row) { console.log(`zoom${zoom}: row not found`); await page.close(); continue; }

        const snap = () => $(() => {
            const m = document.getElementById('folder-context-menu');
            const r = m.getBoundingClientRect();
            return { op: m.style.opacity, rect: `(${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})` };
        });
        const hit = (x, y) => $(xx => {
            const el = document.elementFromPoint(xx[0], xx[1]);
            if (!el) return 'none';
            if (el.id === 'folder-context-menu') return 'MENU';
            if (el.classList && el.classList.contains('menu-item')) return 'ITEM';
            if (el.classList && el.classList.contains('tree-item-span')) return 'ROW';
            return `${el.tagName}#${el.id || ''}`;
        }, [x, y]);
        const rc = async (x, y) => {
            const h = await hit(x, y);
            const before = await snap();
            await page.mouse.click(x, y, { button: 'right' });
            await sleep(350);
            const after = await snap();
            return { h, before, after };
        };

        console.log(`\n===== zoom=${zoom}% =====`);
        console.log(`row: left=${row.left.toFixed(1)} top=${row.top.toFixed(1)} w=${row.w.toFixed(1)} h=${row.h.toFixed(1)}`);

        let a = await rc(row.left + row.w * 0.30, row.top + 8);
        console.log(`1 open row center-left   hit=${a.h}  menu ${a.before.rect} → ${a.after.rect} op=${a.after.op}`);

        a = await rc(row.left + 4, row.top + 8);
        console.log(`2 re-right far-left      hit=${a.h}  menu ${a.before.rect} → ${a.after.rect} op=${a.after.op}`);

        a = await rc(row.left + row.w * 0.85, row.top + 8);
        console.log(`3 re-right far-right     hit=${a.h}  menu ${a.before.rect} → ${a.after.rect} op=${a.after.op}`);

        a = await rc(row.left + row.w * 0.5, row.top + row.h * 0.5);
        console.log(`4 re-right mid           hit=${a.h}  menu ${a.before.rect} → ${a.after.rect} op=${a.after.op}`);

        a = await rc(row.left + row.w * 0.30, row.top + 8);
        console.log(`5 re-open center-left    hit=${a.h}  menu ${a.before.rect} → ${a.after.rect} op=${a.after.op}`);

        await page.close();
    }

    await browser.close();
    process.exit(0);
})();
