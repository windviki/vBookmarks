// Reproduce the user's zoom>100 re-right-click gesture:
//  1. right-click a folder row → menu opens
//  2. right-click the SAME folder row again at a point AVOIDING the menu's
//     visible area → menu must RE-OPEN at the pointer (not disappear).
// At zoom<=100 the same gesture re-opens; at zoom>100 the user reports the
// menu disappears. This probe drives the exact clicks and logs, for every
// right-click, the element under the pointer (elementFromPoint), the event
// target path, and the resulting menu state (opacity / rect / maxHeight), so
// we can see whether the click lands on the ROW (body handler) or on the MENU
// (menuBackgroundReposition wrapper) and which path fails.
//
// Run: docker run --rm vbm-smoke:local node /work/diag/zoom-reright-repro.js
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const c = p => new Promise(r => chrome.bookmarks.create(p, r));
    const w = await c({parentId: '1', title: 'Work'});
    await c({parentId: w.id, title: 'GitHub', url: 'https://github.com/vBookmarks'});
    await c({parentId: w.id, title: 'MDN', url: 'https://developer.mozilla.org/docs/Web'});
    await c({parentId: w.id, title: 'Stack Overflow', url: 'https://stackoverflow.com'});
    await c({parentId: w.id, title: 'Long Chinese Title 中文标题很长很长很长'});
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });

    await sleep(2000);
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

    const page = await browser.newPage();
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

    const zoom = process.env.VBM_ZOOM || '120';
    await page.evaluate(z => { document.body.dataset.zoom = z; }, zoom);
    await sleep(400);
    console.log(`\n===== zoom=${zoom}% =====`);

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
    const row = await locateRow();
    console.log(`work folder row: left=${row.left.toFixed(1)} top=${row.top.toFixed(1)} w=${row.w.toFixed(1)} h=${row.h.toFixed(1)}`);

    const at = (x, y) => $(xx => {
        const el = document.elementFromPoint(xx[0], xx[1]);
        if (!el) return { hit: 'none' };
        const p = [];
        let n = el;
        for (let i = 0; i < 4 && n; i++) { p.push(n.tagName + (n.id ? '#' + n.id : '') + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').join('.') : '')); n = n.parentNode; }
        return { hit: p.join(' ← ') };
    }, [x, y]);

    const snap = () => $(() => {
        const m = document.getElementById('folder-context-menu');
        const mr = m.getBoundingClientRect();
        return {
            op: m.style.opacity,
            maxH: m.style.maxHeight || '-',
            overflow: m.style.overflowY || '-',
            rect: `(${Math.round(mr.left)},${Math.round(mr.top)} ${Math.round(mr.width)}x${Math.round(mr.height)})`,
            items: [...m.querySelectorAll('.menu-item')].map(i => i.textContent.trim().slice(0, 14))
        };
    });

    const rc = async (label, x, y) => {
        const hit = await at(x, y);
        const before = await snap();
        await page.mouse.click(x, y, { button: 'right' });
        await sleep(450);
        const after = await snap();
        console.log(`\n[${label}] rc(${Math.round(x)},${Math.round(y)})`);
        console.log(`  under pointer: ${hit.hit}`);
        console.log(`  menu before: op=${before.op} ${before.rect} maxH=${before.maxH}`);
        console.log(`  menu after:  op=${after.op} ${after.rect} maxH=${after.maxH} overflow=${after.overflow}`);
        return after;
    };

    // Gesture 1: right-click the row's middle-LEFT (the natural spot) → open.
    await rc('open', row.left + row.w * 0.30, row.top + 8);

    // Gesture 2 (the user's report): right-click the SAME row on the right
    // sliver — beyond the open menu's right edge (avoiding the visible menu).
    const rightX = row.left + row.w * 0.92;
    await rc('re-right far-right sliver', rightX, row.top + 8);

    // Gesture 3: right-click the row again at far-left — likely ON the menu.
    await rc('re-right left (on menu?)', row.left + 6, row.top + 8);

    // Gesture 4: right-click the row's right side at mid-height.
    await rc('re-right mid-right', row.left + row.w * 0.7, row.top + row.h * 0.5);

    // Gesture 5: right-click directly ON a .menu-item of the open menu — at
    // zoom>100 the tall menu covers the trigger row, so a "right-click the
    // folder area" that avoids the visible menu can still land on an ITEM.
    const firstItem = await $(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        let it = null;
        for (let g = 0; g < 25 && !it; g++) {
            it = document.querySelector('#folder-context-menu .menu-item:not(.has-submenu)');
            if (!it) await nap(100);
        }
        if (!it) return null;
        const b = it.getBoundingClientRect();
        return { left: b.left, top: b.top, w: b.width, h: b.height, text: it.textContent.trim().slice(0, 20) };
    });
    if (firstItem) {
        console.log(`\nfirst menu item: "${firstItem.text}" at (${firstItem.left.toFixed(1)},${firstItem.top.toFixed(1)} ${firstItem.w.toFixed(1)}x${firstItem.h.toFixed(1)})`);
        await rc('re-right ON menu-item', firstItem.left + 10, firstItem.top + 6);
    }

    // Map the menu's actual HIT region: scan a grid over the menu's VISUAL
    // box and report what elementFromPoint returns. CSS zoom on the items can
    // displace the hit region from the visual rect.
    console.log('\n---- hit-region map over the menu visual box ----');
    await page.mouse.click(row.left + row.w * 0.30, row.top + 8, { button: 'right' });
    await sleep(400);
    const hitMap = await $(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        let m = null;
        for (let g = 0; g < 25 && !m; g++) {
            m = document.getElementById('folder-context-menu');
            if (!m) await nap(100);
        }
        if (!m) return null;
        const b = m.getBoundingClientRect();
        const rows = [];
        for (let y = Math.floor(b.top); y < Math.min(160, b.top + b.height); y += 12) {
            const line = [`y=${y}`];
            for (let x = Math.floor(b.left) - 20; x <= b.left + b.width + 20; x += 30) {
                const el = document.elementFromPoint(x, y);
                let tag = '—';
                if (el) {
                    if (el.id === 'folder-context-menu') tag = 'MENU';
                    else if (el.classList && el.classList.contains('menu-item')) tag = 'ITEM';
                    else if (el.id === 'search' || el.id === 'search-input') tag = 'SEARCH';
                    else if (el.classList && el.classList.contains('tree-item-span')) tag = 'ROW';
                    else tag = el.tagName + (el.id ? '#' + el.id : '');
                }
                line.push(tag);
            }
            rows.push(line.join(' '));
        }
        return { box: `(${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)})`, rows };
    });
    if (hitMap) {
        console.log(`menu visual box: ${hitMap.box}`);
        console.log(hitMap.rows.join('\n'));
    } else {
        console.log('menu not found for hit map');
    }

    // Gesture 6: another row below (the Long Chinese Title bookmark row) —
    // a folder-area point that is NOT the trigger row.
    const row2 = await $(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        let li = null;
        for (let g = 0; g < 25 && !li; g++) {
            li = document.querySelector('#tree li[id^="neat-tree-item-"] a[href="https://developer.mozilla.org/docs/Web"]');
            if (!li) await nap(100);
        }
        if (!li) return null;
        const b = li.getBoundingClientRect();
        return { left: b.left, top: b.top, w: b.width, h: b.height };
    });
    if (row2) {
        console.log(`\nmdn row: left=${row2.left.toFixed(1)} top=${row2.top.toFixed(1)} w=${row2.w.toFixed(1)} h=${row2.h.toFixed(1)}`);
        await rc('re-right OTHER row (MDN, avoiding menu)', row2.left + row2.w * 0.5, row2.top + 8);
    } else {
        console.log('\nmdn row not found');
    }

    await browser.close();
    process.exit(0);
})();
