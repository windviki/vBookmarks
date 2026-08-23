// Virtual-scroll repro at the user's scale (6000+ bookmarks): dupes scroll
// gaps + tree-view slowdown after dupes scrolling, virtualScrollLab on/off.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = { dupUrls: 300, dupCopies: 8, structFolders: 6, structRows: 60, bigRows: 600 };

async function main() {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2000);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.on('console', m => { if (m.text().startsWith('BLANK')) console.log('PAGE:', m.text()); });
        page.setDefaultTimeout(240000);
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1500);

        // --- seed ---------------------------------------------------------
        await page.evaluate(async seed => {
            const create = props => new Promise((res, rej) =>
                chrome.bookmarks.create(props, n => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(n)));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__vl6k__' });
            for (let u = 0; u < seed.dupUrls; u++) {
                const url = 'https://host' + u + '.example.com/page';
                for (let c = 0; c < seed.dupCopies; c++)
                    await create({ parentId: root.id, title: 'd' + u + 'c' + c, url });
            }
            for (let f = 0; f < seed.structFolders; f++) {
                const folder = await create({ parentId: root.id, title: 'F' + f });
                for (let i = 0; i < seed.structRows; i++)
                    await create({ parentId: folder.id, title: 'f' + f + 'i' + i, url: 'https://s' + f + '.example.com/' + i });
            }
            const big = await create({ parentId: root.id, title: 'BIG' });
            for (let i = 0; i < seed.bigRows; i++)
                await create({ parentId: big.id, title: 'big' + i, url: 'https://big.example.com/' + i });
            return true;
        }, SEED);
        console.log('seeded 6000');

        const results = {};
        for (const mode of ['virtual-on', 'virtual-off']) {
            await page.evaluate(m => chrome.storage.local.set({ virtualScrollLab: m === 'virtual-on' ? '1' : '' }), mode);
            await page.reload({ waitUntil: 'load' });
            await sleep(1800);

            const phase = await page.evaluate(async () => {
                const out = { mode: '', longTasks: [], scrollGaps: [], treeExpand: null, treeScrollGaps: [], dupesAgain: [] };
                let lt = [];
                const po = new PerformanceObserver(list => {
                    for (const e of list.getEntries())
                        lt.push({ t: Math.round(e.startTime), d: Math.round(e.duration) });
                });
                try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}

                const settle = () => new Promise(res => {
                    let frames = 0;
                    const tick = () => {
                        if (++frames > 300) return res();
                        requestAnimationFrame(tick);
                    };
                    requestAnimationFrame(tick);
                });

                // --- dupes view -------------------------------------------------
                const dupTab = document.querySelector('#view-tab-dupes');
                dupTab.click();
                await settle();
                const list = document.getElementById('dupes-list');
                const rowsNow = () => list.querySelectorAll('li.vbm-row').length;
                out.rowsInDom = rowsNow();
                out.listScrollH = list.scrollHeight;
                const scrollStep = async () => {
                    const target = (list.scrollTop || 0) + 1500;
                    const t0 = performance.now();
                    list.scrollTop = target;
                    // wait until a row is painted under the viewport center
                    let firstPaint = -1, done = -1;
                    const cx = list.clientWidth / 2;
                    const cy = list.clientHeight / 2;
                    for (let f = 0; f < 600; f++) {
                        await new Promise(r => requestAnimationFrame(r));
                        const t = performance.now();
                        if (firstPaint < 0) {
                            const el = document.elementFromPoint(list.getBoundingClientRect().left + cx, list.getBoundingClientRect().top + cy);
                            if (el && el.closest && el.closest('li')) {
                                firstPaint = t - t0;
                                done = t - t0;
                                break;
                            }
                        }
                    }
                    if (firstPaint < 0) {
                        // dump the window geometry at the blank position
                        const uls = list.querySelectorAll('ul');
                        const rows = list.querySelectorAll('li.vbm-row');
                        const r0 = rows[0] && rows[0].getBoundingClientRect();
                        const r1 = rows[rows.length - 1] && rows[rows.length - 1].getBoundingClientRect();
                        const lr = list.getBoundingClientRect();
                        const x = lr.left + list.clientWidth / 2;
                        const y = lr.top + list.clientHeight / 2;
                        const hit = document.elementFromPoint(x, y);
                        const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y).slice(0, 4).map(e => e.tagName + '.' + (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className)) : null;
                        const rowEl = hit && hit.closest ? hit.closest('li') : null;
                        const dump = {
                            hit: hit ? hit.tagName + '#' + hit.id + '.' + (hit.className && hit.className.baseVal !== undefined ? hit.className.baseVal : hit.className) : null,
                            hitRowClass: rowEl ? rowEl.className : null,
                            stack,
                            scrollTop: list.scrollTop,
                            scrollH: list.scrollHeight,
                            clientH: list.clientHeight,
                            rows: rows.length,
                            ulPad: uls.length ? uls[0].style.paddingTop + '/' + uls[0].style.paddingBottom : null,
                            firstTop: r0 ? +r0.top.toFixed(0) : null,
                            lastBot: r1 ? +r1.bottom.toFixed(0) : null,
                            listTop: +lr.top.toFixed(0), listBottom: +lr.bottom.toFixed(0),
                            center: +(lr.top + list.clientHeight / 2).toFixed(0)
                        };
                        console.log('BLANK-DUMP', JSON.stringify(dump));
                    }
                    return { firstPaint: firstPaint < 0 ? null : +firstPaint.toFixed(0) };
                };
                for (let s = 0; s < 12; s++)
                    out.scrollGaps.push(await scrollStep());

                // --- tree view after dupes --------------------------------------
                document.querySelector('#view-tab-tree').click();
                await settle();
                // drill: bar root -> __vl6k__ -> BIG
                for (const text of ['Bookmarks bar', '__vl6k__']) {
                    const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
                    const el = spans.find(s => (s.textContent || '').trim().startsWith(text));
                    if (el) el.click();
                    await settle();
                }
                const spans2 = [...document.querySelectorAll('#tree li span.tree-item-span')];
                const bigSpan = spans2.find(s => (s.textContent || '').trim().startsWith('BIG'));
                if (bigSpan) {
                    const t0 = performance.now();
                    bigSpan.click();
                    let first = -1, last = -1;
                    const tree = document.getElementById('tree');
                    const mo = new MutationObserver(() => {
                        const n = performance.now();
                        if (first < 0) first = n;
                        last = n;
                    });
                    mo.observe(tree, { childList: true, subtree: true });
                    for (let f = 0; f < 600; f++) {
                        await new Promise(r => requestAnimationFrame(r));
                        if (performance.now() - (last < 0 ? t0 : last) > 300) break;
                    }
                    mo.disconnect();
                    out.treeExpand = { first: +(first - t0).toFixed(0), last: +(last - t0).toFixed(0) };
                }
                // tree scroll steps
                const tree = document.getElementById('tree');
                for (let s = 0; s < 6; s++) {
                    const t0 = performance.now();
                    tree.scrollTop = (tree.scrollTop || 0) + 1200;
                    let painted = -1;
                    for (let f = 0; f < 300; f++) {
                        await new Promise(r => requestAnimationFrame(r));
                        if (painted < 0) {
                            const r = tree.getBoundingClientRect();
                            const el2 = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                            if (el2 && el2.closest && el2.closest('li')) painted = performance.now() - t0;
                        }
                    }
                    out.treeScrollGaps.push(painted < 0 ? null : +painted.toFixed(0));
                }

                // back to dupes
                document.querySelector('#view-tab-dupes').click();
                await settle();
                for (let s = 0; s < 4; s++)
                    out.dupesAgain.push(await scrollStep());

                po.disconnect();
                out.longTasks = lt.filter(x => x.d > 50);
                out.longTaskMs = lt.reduce((a, x) => a + x.d, 0);
                out.longTaskCount = lt.length;
                return out;
            });
            phase.mode = mode;
            results[mode] = phase;
        }
        console.log(JSON.stringify(results, null, 1));
    } finally {
        await browser.close();
    }
}
main().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });