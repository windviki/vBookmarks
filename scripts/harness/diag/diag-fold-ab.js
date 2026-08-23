// A/B fold-toggle probe: current build (/ext) vs pre-perf-merge build
// (/ext-old). Same seed in both, then measure tree folder expand/collapse,
// tabgroups group fold, dupes group fold, staging group fold.
//
// Metrics per click:
//   sync  — ms until el.click() returns (the synchronous handler work)
//   first — ms until the first DOM mutation lands (first visible change)
//   last  — ms of the last DOM mutation (streaming tail end)
// The "settle" read is a 250 ms quiet window on a MutationObserver over the
// view's list container, so the last-mutation time is the moment the list
// stops changing; a final paint may trail it by a frame or two.
const fs = require('fs');
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// /ext-old (the pre-perf-merge build) is NOT part of the standard image —
// rerun.sh's Dockerfile only ships /ext. To run the full A/B: build the old
// revision (git worktree at 8641b8d, npm run build), stage its dist at
// scripts/harness/.olddist, add ONE Dockerfile line
//   COPY vBookmarks/scripts/harness/.olddist /ext-old
// before this COPY diag line, then scripts/harness/rerun.sh diag/diag-fold-ab.js.
// Without it the probe measures /ext alone as the baseline reference.
const HAS_OLD = fs.existsSync('/ext-old/manifest.json');
if (!HAS_OLD)
    console.log('NOTE: /ext-old absent — measuring /ext only (see header for the A/B setup).');

const SEED = {
    dupUrls: 240, dupCopies: 8,       // dupes view: 240 groups x 8 rows
    structFolders: 10, structRows: 60, // tree structure bookmarks
    bigRows: 800,                     // tree: one BIG folder to expand
    tabGroups: 8, tabsPerGroup: 30,   // tabgroups view
    staging: 800, stagingGroups: 4    // staging view (200 per group)
};

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
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(swTarget.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('[' + label + '] PAGEERROR:', e.message));
        page.setDefaultTimeout(180000);
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1500);

        // --- seed -----------------------------------------------------------
        await page.evaluate(async seed => {
            const create = props => new Promise((res, rej) =>
                chrome.bookmarks.create(props, n => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(n)));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__ab__' });
            // dupes: 120 urls x 8 copies
            for (let u = 0; u < seed.dupUrls; u++) {
                const url = 'https://dup' + u + '.example.com/page';
                for (let c = 0; c < seed.dupCopies; c++)
                    await create({ parentId: root.id, title: 'd' + u + 'c' + c, url });
            }
            // tree structure: 6 folders x 40 rows
            for (let f = 0; f < seed.structFolders; f++) {
                const folder = await create({ parentId: root.id, title: 'F' + f });
                for (let i = 0; i < seed.structRows; i++)
                    await create({ parentId: folder.id, title: 'f' + f + 'i' + i, url: 'https://s' + f + '.example.com/' + i });
            }
            // one BIG folder for the tree expand timing
            const big = await create({ parentId: root.id, title: 'BIG' });
            for (let i = 0; i < seed.bigRows; i++)
                await create({ parentId: big.id, title: 'big' + i, url: 'https://big.example.com/' + i });
            // tabs: groups of tabs
            const win = await new Promise(res => chrome.windows.getCurrent(res));
            const tabIds = [];
            for (let i = 0; i < seed.tabGroups * seed.tabsPerGroup; i++) {
                const t = await new Promise((res, rej) => chrome.tabs.create(
                    { windowId: win.id, active: false, url: 'https://tab' + i + '.example.com/' + i }, t =>
                    chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(t)));
                tabIds.push(t.id);
            }
            for (let g = 0; g < seed.tabGroups; g++) {
                const ids = tabIds.slice(g * seed.tabsPerGroup, (g + 1) * seed.tabsPerGroup);
                await new Promise((res, rej) => chrome.tabs.group({ tabIds: ids }, id =>
                    chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(id)));
            }
            // staging: 4 groups x 100 items
            const now = Date.now();
            const groups = [];
            for (let g = 0; g < seed.stagingGroups; g++)
                groups.push({ id: 'g' + g, name: 'G' + g, collapsed: false, createdAt: now + g, sourceFolderId: null, sourceTabGroup: null, manual: false });
            const items = [];
            for (let i = 0; i < seed.staging; i++)
                items.push({ id: null, url: 'https://stg.example.com/' + i, title: 's' + i, ts: now - i, group: 'g' + (i % seed.stagingGroups) });
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups, recentCollapsed: true, unfavCollapsed: false, lastSeenTs: 0 })
            }, res));
            return root.id;
        }, SEED);

        await page.reload({ waitUntil: 'load' });
        await sleep(1800);

        // --- timing helper ---------------------------------------------------
        const measure = (label, spec) => page.evaluate(async (label, spec) => {
            const t0 = performance.now();
            const el = spec.type === 'span'
                ? (() => {
                    const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
                    return spans.find(s => (s.textContent || '').trim().startsWith(spec.text)) || null;
                })()
                : document.querySelector(spec.sel);
            if (!el)
                return { label, error: 'no element' };
            const list = el.closest('#tree,#tabgroups-list,#dupes-list,#staging-list,#recent-list') || document.body;
            let first = -1, last = -1;
            let syncT = t0;
            const mo = new MutationObserver(() => {
                const n = performance.now();
                if (first < 0)
                    first = n;
                last = n;
            });
            mo.observe(list, { childList: true, subtree: true, characterData: true });
            let frames = 0;
            await new Promise(resolve => {
                const tick = () => {
                    if (performance.now() - (last < 0 ? t0 : last) > 250 || ++frames > 1200)
                        return resolve();
                    requestAnimationFrame(tick);
                };
                requestAnimationFrame(tick);
                const st0 = performance.now();
                el.click();
                syncT = performance.now();
            });
            mo.disconnect();
            return {
                label,
                sync: +(syncT - t0).toFixed(1),
                first: +(first < 0 ? -1 : (first - t0)).toFixed(1),
                last: +(last < 0 ? -1 : (last - t0)).toFixed(1)
            };
        }, label, spec);

        // --- cases ------------------------------------------------------------
        const out = [];
        // tree BIG folder: expand, then collapse
        await page.click('#view-tab-tree');
        await sleep(1200);
        // drill down: expand the bar root, then __ab__, so BIG is clickable
        for (const target of ['Bookmarks bar', '__ab__']) {
            await page.evaluate(t => {
                const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
                const hit = spans.find(s => (s.textContent || '').trim().startsWith(t));
                if (hit)
                    hit.click();
            }, target);
            await sleep(600);
        }
        await sleep(400);
        out.push(await measure('tree-expand', { type: 'span', text: 'BIG' }));
        await sleep(400);
        out.push(await measure('tree-collapse', { type: 'span', text: 'BIG' }));
        await sleep(400);

        // tabgroups: first group head fold (open by default -> collapse)
        await page.click('#view-tab-tabgroups');
        await sleep(1500);
        out.push(await measure('tabgroups-collapse', { type: 'sel', sel: '#tabgroups-list .tabgroups-group-head' }));
        await sleep(400);
        out.push(await measure('tabgroups-expand', { type: 'sel', sel: '#tabgroups-list .tabgroups-group-head' }));
        await sleep(400);

        // dupes: first group head fold (open -> collapse)
        await page.click('#view-tab-dupes');
        await sleep(1500);
        out.push(await measure('dupes-collapse', { type: 'sel', sel: '#dupes-list .group-head' }));
        await sleep(400);
        out.push(await measure('dupes-expand', { type: 'sel', sel: '#dupes-list .group-head' }));
        await sleep(400);

        // staging: first group head fold
        await page.click('#view-tab-recent');
        await sleep(1500);
        out.push(await measure('staging-collapse', { type: 'sel', sel: '#staging-items .staging-group-head' }));
        await sleep(400);
        out.push(await measure('staging-expand', { type: 'sel', sel: '#staging-items .staging-group-head' }));

        return { label, out };
    } finally {
        await browser.close();
    }
}

(async () => {
    const oldBuild = HAS_OLD ? await runBuild('old-8641b8d', '/ext-old') : null;
    const newBuild = await runBuild('new-HEAD', '/ext');
    const rows = [];
    const names = ['tree-expand', 'tree-collapse', 'tabgroups-collapse', 'tabgroups-expand',
        'dupes-collapse', 'dupes-expand', 'staging-collapse', 'staging-expand'];
    for (const n of names) {
        const a = (oldBuild && oldBuild.out.find(r => r.label === n)) || {};
        const b = newBuild.out.find(r => r.label === n) || {};
        rows.push({
            case: n,
            oldSync: a.sync, oldFirst: a.first, oldLast: a.last,
            newSync: b.sync, newFirst: b.first, newLast: b.last,
            oldErr: a.error || '', newErr: b.error || ''
        });
    }
    console.log(JSON.stringify(rows, null, 2));
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });