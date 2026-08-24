// Batch-2 diagnostics (real browser): reproduce the reported
//   A. search-history interactions dead (click rerun / row × / clear all)
//   B. search selection mode: checkbox squashed top-left, broken list style
//   C. staging view: ↑/↓ cannot walk into an expanded virtual group's items
//   D. tabgroups view: ↑/↓ cannot walk into an expanded group's rows
//      (both with virtualScrollLab OFF and ON)
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2000);
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        // --- seed: bookmarks, search history, staging state ----------------
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: 'zzfolder' });
            for (let i = 0; i < 3; i++)
                await create({ parentId: folder.id, title: `zzanchored ${i}`, url: `http://127.0.0.1:9/a/${i}` });
            await create({ parentId: bar.id, title: 'zzloose one', url: 'http://127.0.0.1:9/loose1' });
            await create({ parentId: bar.id, title: 'zzloose two', url: 'http://127.0.0.1:9/loose2' });
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 4; i++) {
                const url = `http://127.0.0.1:9/stg/${i}`;
                const n = await create({ parentId: folder.id, title: `zzstaging ${i}`, url });
                items.push({ id: n.id, url, title: `zzstaging ${i}`, ts: now - i * 1000, group: i < 2 ? 'g1' : null });
            }
            items.push({ id: null, url: 'http://127.0.0.1:9/snap/1', title: 'zzsnap 1', ts: now, group: null });
            await new Promise(r => chrome.storage.local.set({
                staging: JSON.stringify({
                    v: 1, items,
                    groups: [{ id: 'g1', name: 'Group One', collapsed: false, createdAt: now - 5000 }],
                    recentCollapsed: false, unfavCollapsed: false, headCollapsed: false,
                    recentGroupCollapsed: {}, lastSeenTs: now - 3600000
                }),
                searchHistory: JSON.stringify([
                    { q: 'zzalpha', ts: now - 60e3, n: 3 },
                    { q: 'zzbeta', ts: now - 120e3, n: 5 },
                    { q: 'zzgamma', ts: now - 180e3, n: 1 }
                ]),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // --- A. search history interactions --------------------------------
        await page.click('#view-tab-search');
        await sleep(600);
        const histBefore = await page.evaluate(() => ({
            rows: document.querySelectorAll('#search-history-area a[data-q]').length,
            clearBtn: !!document.getElementById('search-history-clear'),
            areaRect: (() => { const r = document.getElementById('search-history-area').getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right }; })(),
            resultsRect: (() => { const r = document.getElementById('results').getBoundingClientRect(); return { t: r.top, b: r.bottom }; })()
        }));
        console.log('A history:', JSON.stringify(histBefore));
        // click the first history row → the query should land in the input
        await page.evaluate(() => document.querySelector('#search-history-area a[data-q]').click());
        await sleep(400);
        const afterRerun = await page.evaluate(() => ({
            inputValue: document.getElementById('search-input').value,
            results: document.querySelectorAll('#results-ul li').length
        }));
        console.log('A rerun click:', JSON.stringify(afterRerun));
        // hover a row: does the × reveal?
        await page.hover('#search-history-area li.search-history-row');
        await sleep(200);
        const removeVis = await page.evaluate(() => {
            const li = document.querySelector('#search-history-area li.search-history-row');
            const btn = li.querySelector('.search-history-remove');
            return {
                visibility: getComputedStyle(btn).visibility,
                display: getComputedStyle(btn).display,
                liDisplay: getComputedStyle(li).display,
                matchesHover: li.matches(':hover')
            };
        });
        console.log('A hover-remove:', JSON.stringify(removeVis));
        // click remove
        await page.evaluate(() => document.querySelector('#search-history-area .search-history-remove').click());
        await sleep(300);
        const afterRemove = await page.evaluate(() => ({
            rows: document.querySelectorAll('#search-history-area a[data-q]').length
        }));
        console.log('A remove click:', JSON.stringify(afterRemove));
        // click clear all
        await page.evaluate(() => {
            const btn = document.getElementById('search-history-clear');
            if (btn) btn.click();
        });
        await sleep(300);
        const afterClear = await page.evaluate(() => ({
            rows: document.querySelectorAll('#search-history-area a[data-q]').length,
            hint: !!document.querySelector('#search-history-area .empty-state')
        }));
        console.log('A clear-all:', JSON.stringify(afterClear));

        // --- B. search selection mode --------------------------------------
        await page.evaluate(() => {
            const input = document.getElementById('search-input');
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await sleep(200);
        await page.type('#search-input', 'zz');
        await sleep(700);
        const idleBar = await page.evaluate(() => {
            const bar = document.querySelector('#results .search-toolbar');
            if (!bar) return null;
            const btn = bar.querySelector('.search-select-mode');
            const count = bar.querySelector('.search-result-count');
            const rb = bar.getBoundingClientRect();
            const bb = btn.getBoundingClientRect();
            const cb = count.getBoundingClientRect();
            return {
                barRight: rb.right, barLeft: rb.left,
                btnRight: bb.right, btnLeft: bb.left,
                countRight: cb.right, gap: bb.left - cb.right
            };
        });
        console.log('B idle bar geometry:', JSON.stringify(idleBar));
        await page.evaluate(() => document.querySelector('#results .search-select-mode').click());
        await sleep(500);
        const selState = await page.evaluate(() => {
            const ul = document.getElementById('results-ul');
            const li = ul.querySelector('li.vbm-row');
            if (!li) return null;
            const cs = getComputedStyle(li);
            const before = getComputedStyle(li, '::before');
            const r = li.getBoundingClientRect();
            const a = li.querySelector('a');
            const ar = a.getBoundingClientRect();
            return {
                ulClass: ul.className,
                liDisplay: cs.display, liPos: cs.position,
                beforeW: before.width, beforeH: before.height, beforePos: before.position,
                liRect: { t: r.top, h: r.height, l: r.left },
                aRect: { t: ar.top, h: ar.height, l: ar.left }
            };
        });
        console.log('B selecting state:', JSON.stringify(selState));
        await page.evaluate(() => document.querySelector('#results-ul li.vbm-row').click());
        await sleep(300);
        const afterRowClick = await page.evaluate(() => {
            const li = document.querySelector('#results-ul li.vbm-row');
            const r = li.getBoundingClientRect();
            const a = li.querySelector('a').getBoundingClientRect();
            return { cls: li.className, liH: r.height, aL: a.left };
        });
        console.log('B row click:', JSON.stringify(afterRowClick));

        // --- C. staging keyboard walk --------------------------------------
        await page.click('#view-tab-recent');
        await sleep(800);
        const stagingWalk = async () => {
            await page.evaluate(() => {
                const first = document.querySelector('#staging-items a, #staging-items span');
                if (first) first.focus();
            });
            const seq = [];
            for (let i = 0; i < 14; i++) {
                await page.keyboard.press('ArrowDown');
                await sleep(120);
                seq.push(await page.evaluate(() => {
                    const el = document.activeElement;
                    if (!el || !el.closest) return '<none>';
                    const li = el.closest('li');
                    return `${el.tagName.toLowerCase()}:${el.className.split(' ')[0] || ''}@${li ? (li.id || li.className.split(' ')[0]) : '?'}`;
                }));
            }
            return seq;
        };
        console.log('C staging walk:', JSON.stringify(await stagingWalk()));

        // --- D. tabgroups keyboard walk (virtual OFF, then ON) -------------
        await page.evaluate(() => new Promise(res => {
            const mk = (i, group) => new Promise(r => chrome.tabs.create(
                { url: `http://127.0.0.1:9/tg/${i}`, active: false }, t => {
                    if (!group) return r(t);
                    chrome.tabs.group({ tabIds: [t.id], createProperties: { windowId: t.windowId, title: group } }, () => r(t));
                }));
            const run = async () => {
                for (let i = 0; i < 12; i++)
                    await mk(i, i % 3 === 0 ? `G${i}` : null);
                res();
            };
            run();
        }));
        await sleep(1200);
        await page.click('#view-tab-tabgroups');
        await sleep(1500);
        const tgWalk = async () => {
            await page.evaluate(() => {
                const first = document.querySelector('#tabgroups-list a, #tabgroups-list span');
                if (first) first.focus();
            });
            const seq = [];
            for (let i = 0; i < 16; i++) {
                await page.keyboard.press('ArrowDown');
                await sleep(120);
                seq.push(await page.evaluate(() => {
                    const el = document.activeElement;
                    if (!el || !el.closest) return '<none>';
                    const li = el.closest('li');
                    return `${el.tagName.toLowerCase()}@${li ? (li.id || li.className.split(' ')[0]) : '?'}`;
                }));
            }
            return seq;
        };
        console.log('D tabgroups walk (virtual OFF):', JSON.stringify(await tgWalk()));
        await page.evaluate(() => chrome.storage.local.set({ virtualScrollLab: '1' }));
        await sleep(1500);
        const virtInfo = await page.evaluate(() => {
            const ul = document.querySelector('#tabgroups-list ul');
            return {
                lis: ul ? ul.children.length : -1,
                padTop: ul ? ul.style.paddingTop : '',
                padBottom: ul ? ul.style.paddingBottom : ''
            };
        });
        console.log('D virtual info:', JSON.stringify(virtInfo));
        console.log('D tabgroups walk (virtual ON):', JSON.stringify(await tgWalk()));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
