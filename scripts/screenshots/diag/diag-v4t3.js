// v4 task-3 diagnostic probe (runs inside zenika/alpine-chrome:with-puppeteer).
// Verifies in a real browser:
//   #1 recent/stats lists — no horizontal scrollbar (scrollWidth <= clientWidth)
//   #2 stats sort segment — click moves the .active class + persists statsSort
//   #3 dead rows (wide layout) — mark/delete buttons vertically centered
//   #8 search clear button — becomes visible after typing
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    const b1 = await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    const b2 = await create({ parentId: work.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    const b3 = await create({ parentId: '2', title: 'Awwwards', url: 'https://www.awwwards.com' });
    // visitStats with distinct counts so count/recent sorts visibly differ
    const stats = {};
    stats[b1.id] = { c: 9, t: Date.now() - 3600e3 };
    stats[b2.id] = { c: 1, t: Date.now() - 60e3 };
    stats[b3.id] = { c: 4, t: Date.now() - 7200e3 };
    await chrome.storage.local.set({
        visitStats: JSON.stringify(stats),
        deadLastScan: JSON.stringify({
            ts: Date.now(), scannedCount: 3,
            results: {
                [b1.id]: { status: 'dead', code: 404 },
                [b2.id]: { status: 'blocked', code: 'ERR_ABORTED' },
                [b3.id]: { status: 'ok', code: 200 }
            }
        })
    });
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
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
    await page.setViewport({ width: 520, height: 620 }); // wide → two-line rows
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const $ = (fn, ...args) => page.evaluate(fn, ...args);

    // #1 horizontal scrollbar probe
    console.log('═══ #1 横向滚动条 ═══');
    for (const tab of ['recent', 'stats', 'dead']) {
        await page.click(`#view-tab-${tab}`); await sleep(900);
        const m = await $(id => {
            const el = document.getElementById(id);
            if (!el) return null;
            const listRight = el.getBoundingClientRect().right;
            const li = el.querySelector('li.vbm-row');
            if (!li) return { scrollW: el.scrollWidth, clientW: el.clientWidth, noRow: true };
            const a = li.querySelector('a');
            const kids = a ? [...a.children].map(n =>
                `${n.className || n.tagName}:x${Math.round(n.getBoundingClientRect().left)}-r${Math.round(n.getBoundingClientRect().right)}`) : [];
            const liR = li.getBoundingClientRect();
            const aR = a ? a.getBoundingClientRect() : null;
            const head = li.querySelector('.recent-group-head, .stats-section-head');
            const cs = getComputedStyle(li);
            const liKids = [...li.children].map(n => {
                const r = n.getBoundingClientRect();
                const c = getComputedStyle(n);
                return `${n.tagName}.${String(n.className).slice(0, 30)} x${Math.round(r.left)}-r${Math.round(r.right)} order=${c.order} flex=${c.flex} disp=${c.display}`;
            });
            return {
                scrollW: el.scrollWidth, clientW: el.clientWidth,
                liCls: li.className, liDisplay: cs.display, liWrap: cs.flexWrap,
                liKids,
                aParent: a ? a.parentNode.tagName + '.' + String(a.parentNode.className).slice(0, 30) : '',
                aFlex: a ? getComputedStyle(a).flex : '',
                listRight: Math.round(listRight)
            };
        }, `${tab}-list`);
        console.log(`  ${tab}:`, JSON.stringify(m, null, 1));
    }

    // #2 stats sort segment
    console.log('═══ #2 stats 排序切换 ═══');
    await page.click('#view-tab-stats'); await sleep(900);
    const before = await $(() => ({
        active: (document.querySelector('.stats-toolbar .seg-btn.active') || {}).dataset && document.querySelector('.stats-toolbar .seg-btn.active').dataset.sort,
        heads: [...document.querySelectorAll('#stats-list .stats-section-head')].map(h => h.textContent),
        firstRow: (document.querySelector('#stats-list li.vbm-row i') || {}).textContent
    }));
    console.log('  before:', JSON.stringify(before));
    await page.click('.stats-toolbar .seg-btn[data-sort="recent"]'); await sleep(900);
    const after = await $(() => ({
        active: document.querySelector('.stats-toolbar .seg-btn.active') && document.querySelector('.stats-toolbar .seg-btn.active').dataset.sort,
        ariaPressed: document.querySelector('.stats-toolbar .seg-btn[data-sort="recent"]').getAttribute('aria-pressed'),
        stored: null,
        firstRow: (document.querySelector('#stats-list li.vbm-row i') || {}).textContent,
        activeStyles: (() => {
            const b = document.querySelector('.stats-toolbar .seg-btn.active');
            if (!b) return null;
            const cs = getComputedStyle(b);
            return { bg: cs.backgroundColor, color: cs.color };
        })()
    }));
    after.stored = await $(() => new Promise(r => chrome.storage.local.get('statsSort', d => r(d.statsSort))));
    console.log('  after :', JSON.stringify(after));

    // #3 dead wide-layout button centering
    console.log('═══ #3 dead 宽行按钮对齐 ═══');
    await page.click('#view-tab-dead'); await sleep(900);
    const deadAlign = await $(() => {
        const li = document.querySelector('#dead-list li.vbm-row');
        if (!li) return null;
        const row = li.getBoundingClientRect();
        const out = { rowTop: Math.round(row.top), rowH: Math.round(row.height) };
        const btn = li.querySelector('.dead-mark-btn');
        if (btn) {
            const b = btn.getBoundingClientRect();
            out.btnCenterOffset = Math.round(b.top + b.height / 2 - row.top);
        }
        const badge = li.querySelector('.row-badge');
        if (badge) {
            const g = badge.getBoundingClientRect();
            out.badgeTopOffset = Math.round(g.top - row.top);
        }
        return out;
    });
    console.log('  dead row:', JSON.stringify(deadAlign), deadAlign ? `(row center=${Math.round(deadAlign.rowH / 2)})` : '');

    // #8 search clear button
    console.log('═══ #8 搜索清空按钮 ═══');
    await page.click('#search-input');
    await page.keyboard.type('github', { delay: 30 });
    await sleep(500);
    const clear = await $(() => {
        const b = document.getElementById('search-clear');
        const cs = getComputedStyle(b);
        const r = b.getBoundingClientRect();
        return { visibility: cs.visibility, w: r.width, hasQuery: document.getElementById('search').classList.contains('has-query') };
    });
    console.log('  clear button:', JSON.stringify(clear));

    console.log('pageErrors:', pageErrors.length ? pageErrors.join('; ') : 'none');
    await browser.close();
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(2); });
