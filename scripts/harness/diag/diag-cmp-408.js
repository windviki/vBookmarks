// 4.0.8 vs current build: the SHARED interaction surface at 6000 bookmarks —
// popup open, tree folder expand/collapse, search, tree scroll.
const fs = require('fs');
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// /ext408 (the v4.0.8 stable build) is NOT part of the standard image. To run
// the A/B: git worktree add /tmp/vb408 v4.0.8 (no build — 4.0.8 ships src),
// copy its root into scripts/harness/.ext408, add ONE Dockerfile line
//   COPY vBookmarks/scripts/harness/.ext408 /ext408
// then scripts/harness/rerun.sh diag/diag-cmp-408.js.
const HAS_OLD = fs.existsSync('/ext408/manifest.json');
if (!HAS_OLD) {
    console.log('NOTE: /ext408 absent — see the header for the A/B setup; aborting.');
    process.exit(0);
}

async function runBuild(label, extPath) {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=' + extPath, '--disable-extensions-except=' + extPath]
    });
    try {
        await sleep(2000);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', () => {});
        page.setDefaultTimeout(240000);
        console.log('[' + label + '] goto...');
        const t0 = performance.now();
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        const openLoad = performance.now() - t0;
        console.log('[' + label + '] loaded, seeding...');

        // seed 6000 bookmarks
        await page.evaluate(async () => {
            const create = props => new Promise((res, rej) =>
                chrome.bookmarks.create(props, n => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(n)));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__c408__' });
            for (let f = 0; f < 10; f++) {
                const folder = await create({ parentId: root.id, title: 'F' + f });
                for (let i = 0; i < 200; i++)
                    await create({ parentId: folder.id, title: 'f' + f + 'i' + i, url: 'https://s' + f + '.c408.example/' + i });
            }
            const big = await create({ parentId: root.id, title: 'BIG' });
            for (let i = 0; i < 1000; i++)
                await create({ parentId: big.id, title: 'big' + i, url: 'https://big.c408.example/' + i });
            for (let i = 0; i < 3000; i++)
                await create({ parentId: root.id, title: 'l' + i, url: 'https://l.c408.example/' + i });
        });
        console.log('[' + label + '] seeded, reload...');
        await page.reload({ waitUntil: 'load' });
        await sleep(2000);
        console.log('[' + label + '] measuring...');

        const out = { openLoadMs: +openLoad.toFixed(0) };

        // tree painted?
        out.treeRows = await page.evaluate(() => document.querySelectorAll('#tree li').length);
        console.log('[' + label + '] treeRows=' + out.treeRows);

        // drill: bar -> __c408__
        const settle = () => new Promise(res => {
            let f = 0;
            const tick = () => { if (++f > 240) return res(); setTimeout(tick, 16); };
            setTimeout(tick, 16);
        });
        const clickSpan = async text => {
            await page.evaluate(t => {
                const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
                const s = spans.find(x => (x.textContent || '').trim().startsWith(t));
                if (s) s.click();
            }, text);
            await settle();
        };
        console.log('[' + label + '] drill...');
        await clickSpan('Bookmarks bar');
        await clickSpan('__c408__');
        console.log('[' + label + '] drilled');

        // BIG expand
        console.log('[' + label + '] big-expand...');
        const expand = await page.evaluate(() => new Promise(resolve => {
            const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
            const s = spans.find(x => (x.textContent || '').trim().startsWith('BIG'));
            if (!s) return resolve(null);
            const t0 = performance.now();
            const tree = document.getElementById('tree');
            let first = -1, last = -1;
            const mo = new MutationObserver(() => {
                const n = performance.now();
                if (first < 0) first = n;
                last = n;
            });
            mo.observe(tree, { childList: true, subtree: true });
            let f = 0;
            const tick = () => {
                if (performance.now() - (last < 0 ? t0 : last) > 250 || ++f > 600) {
                    mo.disconnect();
                    return resolve({ first: +(first - t0).toFixed(0), last: +(last - t0).toFixed(0) });
                }
                setTimeout(tick, 16);
            };
            setTimeout(tick, 16);
            s.click();
        }));
        out.bigExpand = expand;
        console.log('[' + label + '] expanded ' + JSON.stringify(expand));

        // BIG collapse
        console.log('[' + label + '] big-collapse...');
        const collapse = await page.evaluate(() => new Promise(resolve => {
            const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
            const s = spans.find(x => (x.textContent || '').trim().startsWith('BIG'));
            if (!s) return resolve(null);
            const t0 = performance.now();
            let f = 0;
            const tick = () => { if (++f > 240) return resolve({ sync: null }); setTimeout(tick, 16); };
            setTimeout(tick, 16);
            s.click();
            const t1 = performance.now();
            resolve({ sync: +(t1 - t0).toFixed(1) });
        }));
        out.bigCollapse = collapse;
        console.log('[' + label + '] collapsed ' + JSON.stringify(collapse));

        // search
        console.log('[' + label + '] search...');
        const searchMs = await page.evaluate(() => new Promise(resolve => {
            const field = document.getElementById('search-field') || document.querySelector('#search input');
            if (!field) return resolve(null);
            const results = document.getElementById('results') || document.querySelector('#search-results');
            let first = -1, last = -1;
            const mo = new MutationObserver(() => {
                const n = performance.now();
                if (first < 0) first = n;
                last = n;
            });
            if (results) mo.observe(results, { childList: true, subtree: true });
            const t0 = performance.now();
            field.value = 'big';
            field.dispatchEvent(new Event('input', { bubbles: true }));
            let f = 0;
            const tick = () => {
                if (performance.now() - (last < 0 ? t0 : last) > 300 || ++f > 600) {
                    mo.disconnect();
                    return resolve({ first: +(first - t0).toFixed(0), last: +(last - t0).toFixed(0) });
                }
                setTimeout(tick, 16);
            };
            setTimeout(tick, 16);
        }));
        out.search = searchMs;

        // tree scroll steps (clear search first)
        await page.evaluate(() => {
            const field = document.getElementById('search-field') || document.querySelector('#search input');
            if (field) { field.value = ''; field.dispatchEvent(new Event('input', { bubbles: true })); }
        });
        await settle();
        await clickSpan('BIG'); // reopen BIG for scroll
        const gaps = [];
        for (let s = 0; s < 6; s++) {
            const gap = await page.evaluate(() => new Promise(resolve => {
                const tree = document.getElementById('tree');
                tree.scrollTop = (tree.scrollTop || 0) + 1000;
                const t0 = performance.now();
                const r = tree.getBoundingClientRect();
                let f = 0;
                const tick = () => {
                    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    if (el && el.closest && el.closest('li')) return resolve(+(performance.now() - t0).toFixed(0));
                    if (++f > 300) return resolve(null);
                    setTimeout(tick, 16);
                };
                setTimeout(tick, 16);
            }));
            gaps.push(gap);
        }
        out.scrollGaps = gaps;

        return { label, out };
    } finally {
        await browser.close();
    }
}

(async () => {
    const old = await runBuild('4.0.8', '/ext408');
    const cur = await runBuild('current', '/ext');
    console.log(JSON.stringify({ old408: old.out, current: cur.out }, null, 1));
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });