// vBookmarks overlong localized menu-item verification — the i18n length warnings.
//
// i18n.py verify 报的 27 条"菜单项过长"全部落在 tab-group 折叠子菜单项上
// （openBookmarksInExistingGroup / bookmarkOpenInExistingGroup 等，最长 fi 48ch）。
// popup body 固定 width:320px；这些项在 popup zoom>100（.menu-item 随 data-zoom
// 放大，菜单容器保持 zoom:1）下 intrinsic 宽可超 320 —— 现有 verify-menu-* 系列
// 都用默认英文（短项），从不覆盖这个宽度维度。
//
// 本脚本在真实浏览器把 folder 菜单与 tab-group flyout 的项文本改成超长译文
// （模拟 fi 实际宽度），在 320px 视口 × zoom 100/150% × 折叠/展开两种形态下
// 打开菜单，断言：
//   1. 菜单照常弹出并保持打开（"显示不下"不能导致不弹/秒关）；
//   2. 菜单与 flyout 矩形不越界（l≥0 且 r≤视口宽，超出 320 即被窗口裁掉）；
//   3. 无 JS 错误。
//
// Run: docker run --rm vbm-smoke:local node /work/verify-menu-overlong.js
// Exits non-zero on any failed check (blocking run.sh step).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PASS = [], FAIL = [];
const check = (label, ok, detail) => {
    (ok ? PASS : FAIL).push(label);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
};

// Real fi (Finnish) translations from _locales/fi — the longest flagged items.
const OVERLONG = {
    'open-bookmarks-in-group': 'Avaa kaikki olemassa olevassa välilehtiryhmässä…',
    'open-bookmarks-in-group-setup': 'Avaa kaikki uudessa välilehtiryhmässä…',
    'folder-tab-group-collapse': 'Välilehtiryhmä',
    'sub-open-bookmarks-in-group': 'Avaa kaikki olemassa olevassa välilehtiryhmässä…',
    'sub-open-bookmarks-in-group-setup': 'Avaa kaikki uudessa välilehtiryhmässä…',
    'sub-folder-open-in-existing-group': 'Avaa olemassa olevassa välilehtiryhmässä…',
    'sub-sort-folder-by-name': 'Lajittele nimen mukaan…',
    'sub-sort-folder-by-date': 'Lajittele päivämäärän mukaan…',
    'sub-sort-folder-contents': 'Lajittele sisällön mukaan…'
};

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
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(500);
    await seedPage.evaluate(SEED);
    await sleep(500);
    await seedPage.close();

    const openCombo = async (zoomLevel, collapseTabGroup) => {
        const page = await browser.newPage();
        const pageErrors = [];
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
        {
            const o = await browser.newPage();
            await o.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'load' });
            // collapse*Menu are sync-routed (2026-08 storage audit).
            await o.evaluate(v => Promise.all([
                chrome.storage.sync.set({
                    collapseSortMenu: '1',
                    collapseTabGroupMenu: v ? '1' : ''
                }),
                chrome.storage.local.remove(['collapseSortMenu', 'collapseTabGroupMenu'])
            ]), collapseTabGroup);
            await o.close();
        }
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        // The real popup footprint; narrower than every seed bookmark's title.
        await page.setViewport({ width: 320, height: 600 });
        // load, not networkidle0: seeded bookmark rows fire chrome-extension
        // _favicon requests that never settle in the offline DinD sandbox.
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);
        if (zoomLevel !== 100) {
            await page.evaluate(z => { document.body.setAttribute('data-zoom', z); }, zoomLevel);
            await sleep(300);
        }
        await page.evaluate(() => {
            const d = document.getElementById('donation');
            if (d && d.style.display !== 'none' && d.offsetHeight > 0)
                document.getElementById('donation-later').click();
        }).catch(() => {});
        await sleep(300);
        return { page, pageErrors };
    };

    const probe = async (page) => page.evaluate(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        // Overlong labels BEFORE the menu opens, so the handler measures the
        // real text-driven width (not the short English labels).
        for (const [id, text] of Object.entries(window.__OVERLONG)) {
            const el = document.getElementById(id);
            if (el) el.textContent = text;
        }
        let span = null;
        for (let g = 0; g < 25 && !span; g++) {
            span = document.querySelector(
                '#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
            if (!span) {
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
        const openFlyout = async id => {
            const entry = document.getElementById(id);
            if (!entry) return null;
            if (getComputedStyle(entry).display === 'none') return null;
            entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
            await nap(250);
        };
        const m = document.getElementById('folder-context-menu');
        const out = {
            win: { w: window.innerWidth, h: window.innerHeight },
            menu: { shown: m.style.opacity, rect: rectOf(m), items: m.querySelectorAll('.menu-item').length },
            sort: null,
            tab: null
        };
        // Sort flyout (overlong sub-sort labels) when the sort block is collapsed.
        await openFlyout('folder-sort-collapse');
        const sortSub = document.getElementById('folder-sort-submenu');
        if (sortSub && getComputedStyle(sortSub).opacity === '1')
            out.sort = { shown: sortSub.style.opacity, rect: rectOf(sortSub), items: sortSub.querySelectorAll('.menu-item').length };
        // Tab-group flyout — the longest flagged items live here.
        await openFlyout('folder-tab-group-collapse');
        const tabSub = document.getElementById('folder-tab-group-submenu');
        if (tabSub && getComputedStyle(tabSub).opacity === '1')
            out.tab = { shown: tabSub.style.opacity, rect: rectOf(tabSub), items: tabSub.querySelectorAll('.menu-item').length };
        return out;
    });

    const COMBOS = [
        { label: 'zoom100-collapsed', zoom: 100, collapseTabGroup: true },
        { label: 'zoom100-expanded',  zoom: 100, collapseTabGroup: false },
        { label: 'zoom150-collapsed', zoom: 150, collapseTabGroup: true },
        { label: 'zoom150-expanded',  zoom: 150, collapseTabGroup: false }
    ];

    for (const c of COMBOS) {
        const { page, pageErrors } = await openCombo(c.zoom, c.collapseTabGroup);
        await page.evaluate(overlong => { window.__OVERLONG = overlong; }, OVERLONG);
        const st = await probe(page);
        if (!st) {
            check(`[${c.label}] folder row found`, false);
            await page.close();
            continue;
        }
        const vw = st.win.w, vh = st.win.h;
        check(`[${c.label}] folder menu stays open`, st.menu.shown === '1',
            `shown=${st.menu.shown}`);
        check(`[${c.label}] folder menu inside viewport (overlong labels, no clip)`,
            st.menu.rect.l >= 0 && st.menu.rect.r <= vw + 2 && st.menu.rect.b <= vh + 2,
            `rect=${JSON.stringify(st.menu.rect)} win=${vw}x${vh}`);
        if (st.sort) {
            check(`[${c.label}] sort flyout opens with overlong labels`, st.sort.shown === '1' && st.sort.items === 3);
            check(`[${c.label}] sort flyout inside viewport`,
                st.sort.rect.l >= 0 && st.sort.rect.r <= vw + 2 && st.sort.rect.b <= vh + 2,
                `rect=${JSON.stringify(st.sort.rect)}`);
        }
        if (st.tab) {
            check(`[${c.label}] tab-group flyout opens with overlong labels`, st.tab.shown === '1' && st.tab.items === 3);
            check(`[${c.label}] tab-group flyout inside viewport`,
                st.tab.rect.l >= 0 && st.tab.rect.r <= vw + 2 && st.tab.rect.b <= vh + 2,
                `rect=${JSON.stringify(st.tab.rect)}`);
        }
        check(`[${c.label}] no page JS errors`, pageErrors.length === 0, pageErrors.join('; '));
        require('fs').mkdirSync('/tmp/shots/verify-menu-overlong', { recursive: true });
        await page.screenshot({ path: `/tmp/shots/verify-menu-overlong/${c.label}.png` });
        await page.close();
    }

    console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})();
