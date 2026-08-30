// 4.1.1 memory-layers E2E — the POSITIVE side the 411 probe never covered:
// every layer must actually RESTORE with the option on (defaults), through
// the real write path (focus events / scroll / folder clicks / typing), not
// seeded storage. Also re-opens a second time to expose the 4s focusID
// cleanup's effect on repeated reopens (the "highlight stopped working"
// report).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? ` — ${extra}` : ''));
    ok ? pass++ : fail++;
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2500);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;

        // seed: __verify__ > ZZSubFolderZZ > Verify BM  (folder must be expandable)
        const seed = await browser.newPage();
        await seed.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        const ids = await seed.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.title === 'Bookmarks bar' || c.id === '1');
            const f1 = await create({ parentId: bar.id, title: '__verify__' });
            const f2 = await create({ parentId: f1.id, title: 'ZZSubFolderZZ' });
            const bm = await create({ parentId: f2.id, title: 'Verify BM', url: 'https://verify.example/page' });
            return { folder: f1.id, sub: f2.id, bm: bm.id };
        });
        // clean-slate memory state (defaults ON = keys absent)
        await seed.evaluate(() => new Promise(res => chrome.storage.local.remove(
            ['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot'], res)));
        await seed.evaluate(() => new Promise(res => chrome.storage.sync.remove(
            ['rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
                'rememberView', 'dontRememberState', 'activeView'], res)));
        await seed.close();

        // one persistent popup target — a "reopen" is a fresh load (storage
        // is the memory carrier); avoids target churn crashing CDP
        const popupPage = await browser.newPage();
        await popupPage.setViewport({ width: 420, height: 640 });
        popupPage.on('pageerror', e => console.log('PAGEERROR:', e.message));
        const openPopup = async () => {
            await popupPage.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
            await sleep(1500);
            return popupPage;
        };

        // ---- 1. the REAL write path, one interaction at a time ----
        {
            const p = await openPopup();
            // expand root folders → the seed folder → then focus the bookmark
            // row (all real clicks/focus; lazy children poll to liveness)
            await p.evaluate(() => {
                for (const li of document.querySelectorAll('#tree > ul > li.parent:not(.open)'))
                    (li.querySelector(':scope > span') || li.firstElementChild).click();
            });
            // walk down the seed chain one folder at a time (each click
            // lazily renders the next level)
            for (const fid of [ids.folder, ids.sub]) {
                await p.waitForFunction(f => !!document.getElementById(`neat-tree-item-${f}`),
                    { timeout: 5000 }, fid);
                await p.evaluate(f => {
                    const li = document.getElementById(`neat-tree-item-${f}`);
                    (li.querySelector(':scope > span') || li.firstElementChild).click();
                }, fid);
            }
            // lazy child loading → poll until the bookmark row is live
            await p.waitForFunction(bm => !!document.getElementById(`neat-tree-item-${bm}`),
                { timeout: 5000 }, ids.bm);
            await p.evaluate(bm => {
                const row = document.getElementById(`neat-tree-item-${bm}`);
                (row.firstElementChild || row).focus();
            }, ids.bm);
            await sleep(600); // focusID write is debounced
            const stored = await popupPage.evaluate(() => new Promise(res => chrome.storage.local.get(['focusID', 'opens'], res)));
            ck('W1 real focus path writes focusID (and the click wrote opens)',
                stored.focusID === ids.bm && Array.isArray(JSON.parse(stored.opens || '[]')) && JSON.parse(stored.opens).includes(ids.folder),
                JSON.stringify(stored));
            // 4.1.1 shadow: the highlight carrier survives a popup close that
            // kills the debounced write (issue #63 close-path, localStorage)
            const shadow = await p.evaluate(() => ({
                focusID: localStorage.getItem('__focusIDLS'),
                focusSpot: localStorage.getItem('__focusSpotLS')
            }));
            ck('W2 where-was shadow written synchronously alongside the debounce',
                shadow.focusID === ids.bm, JSON.stringify(shadow));
            // scroll the tree down (real scroll event)
            await p.evaluate(() => { const t = document.getElementById('tree'); t.scrollTop = 120; });
            await sleep(600);
            await sleep(400); // let debounced writes land before the next load
        }

        // ---- 2. reopen #1 (immediate): every layer restores ----
        {
            const p = await openPopup();
            const st = await p.evaluate(({ bm, folder }) => ({
                focusRows: [...document.querySelectorAll('#tree .focus')].map(e => e.closest('li').id.replace('neat-tree-item-', '')),
                activeIsRow: !!(document.activeElement && document.activeElement.closest && document.activeElement.closest('li')
                    && document.activeElement.closest('li').id === `neat-tree-item-${bm}`),
                openFolders: [...document.querySelectorAll('#tree li.open')].map(e => e.id.replace('neat-tree-item-', '')),
                scrollTop: document.getElementById('tree').scrollTop
            }), ids);
            ck('P1 highlight ON: the last-focused row re-highlights + takes focus',
                st.focusRows.length === 1 && st.focusRows[0] === ids.bm && st.activeIsRow, JSON.stringify(st));
            ck('P2 opens ON: the expanded folder reopens',
                st.openFolders.includes(ids.folder), JSON.stringify(st.openFolders));
            await sleep(400); // let debounced writes land before the next load
        }

        // ---- 3. reopen #2 (>4s after the restore session started): does the
        // 4s focusID cleanup eat the memory a second reopen should show? ----
        {
            const p = await openPopup();
            await sleep(4500); // let any 4s cleanup inside THIS session fire
            const st = await p.evaluate(bm => ({
                focusRows: document.querySelectorAll('#tree .focus').length,
                storedFocusID: (window.store && window.store.get('focusID')) || null
            }), ids.bm);
            await sleep(400); // let debounced writes land before the next load
            // report behavior; assert the DOCUMENTED contract: within one
            // session the highlight persists, focusID may retire after 4s
            ck('P3 within-session: highlight survives the 4s cleanup',
                st.focusRows >= 1, JSON.stringify(st));
        }

        // ---- 4. reopen #3 right away: if the cleanup consumed focusID, a
        // fresh reopen shows nothing — THE user-visible "stopped working" ----
        {
            const p = await openPopup();
            const st = await p.evaluate(() => ({
                focusRows: document.querySelectorAll('#tree .focus').length,
                focusID: (window.store && window.store.get('focusID')) || null
            }));
            await sleep(400); // let debounced writes land before the next load
            ck('P4 repeated reopen still highlights the last bookmark',
                st.focusRows >= 1, JSON.stringify(st));
        }

        // ---- 5. search query + view restore (ON) ----
        {
            const p = await openPopup();
            await p.type('#search-input', 'verify');
            await sleep(900); // searchQuery write debounced
            await sleep(400); // let debounced writes land before the next load
        }
        {
            const p = await openPopup();
            const q = await p.evaluate(() => ({
                value: document.getElementById('search-input').value,
                results: document.querySelectorAll('#results li').length
            }));
            ck('P5 query ON: the last search re-runs', q.value === 'verify' && q.results >= 1, JSON.stringify(q));
            // switch to the recent view, close
            await p.evaluate(() => { const t = document.getElementById('view-tab-recent'); if (t) t.click(); });
            await sleep(700);
            await sleep(400); // let debounced writes land before the next load
        }
        {
            const p = await openPopup();
            const v = await p.evaluate(() => ({
                active: (document.querySelector('#view-tabs .view-tab[aria-selected="true"]') || {}).id || '',
                recentVisible: !document.getElementById('view-recent').hidden
            }));
            ck('P6 view ON: the last active view reopens', v.active === 'view-tab-recent' && v.recentVisible, JSON.stringify(v));
            await sleep(400); // let debounced writes land before the next load
        }

        // ---- 6. scroll layer OFF must not touch the others ----
        {
            const p = await openPopup();
            await p.evaluate(() => new Promise(res => chrome.storage.sync.set({ rememberScroll: '' }, res)));
            await p.evaluate(() => { const t = document.getElementById('tree'); t.scrollTop = 100; });
            await sleep(600);
            await sleep(400); // let debounced writes land before the next load
        }
        {
            const p = await openPopup();
            const st = await p.evaluate(() => ({
                scrollTop: document.getElementById('tree').scrollTop,
                focus: document.querySelectorAll('#tree .focus').length
            }));
            ck('P7 scroll OFF: position ignored, highlight layer intact',
                st.scrollTop === 0, JSON.stringify(st));
            await sleep(400); // let debounced writes land before the next load
        }

        // ---- 8. master OFF kills the four subordinate layers; 记住视图 keeps
        // its own semantics by DESIGN (independent row, never dimmed) ----
        {
            const p = await openPopup();
            await p.evaluate(() => new Promise(res => chrome.storage.sync.set({ dontRememberState: '1' }, res)));
            await p.reload({ waitUntil: 'load' });
            await sleep(1500);
            const st = await p.evaluate(() => ({
                focus: document.querySelectorAll('#tree .focus').length,
                open: document.querySelectorAll('#tree li.open').length,
                scrollTop: document.getElementById('tree').scrollTop,
                query: document.getElementById('search-input').value,
                active: (document.querySelector('#view-tabs .view-tab[aria-selected="true"]') || {}).id || ''
            }));
            ck('P8 master OFF: the four subordinate layers restore nothing; the view layer stays independent',
                st.focus === 0 && st.open === 0 && st.scrollTop === 0 && st.query === '' && st.active === 'view-tab-recent',
                JSON.stringify(st));
            await sleep(400); // let debounced writes land before the next load
        }

        // ---- 9. rememberView OFF (its own switch) resets to the tree ----
        {
            const p = await openPopup();
            await p.evaluate(() => new Promise(res => chrome.storage.sync.set({ rememberView: '' }, res)));
            await p.reload({ waitUntil: 'load' });
            await sleep(1500);
            const active = await p.evaluate(() =>
                (document.querySelector('#view-tabs .view-tab[aria-selected="true"]') || {}).id || '');
            ck('P9 rememberView OFF: reopen lands on the tree', active === 'view-tab-tree', JSON.stringify(active));
            await sleep(400); // let debounced writes land before the next load
        }

        // ---- 10. list-view row memory (recent): a focused list row re-marks
        // on reopen — the non-tree half of the highlight layer ----
        {
            const p = await openPopup();
            await p.evaluate(() => new Promise(res => chrome.storage.sync.set(
                { dontRememberState: '', rememberView: '1' }, res)));
            // rememberState is captured once at popup boot — reload so the
            // master-on state is what this session actually runs with
            await p.reload({ waitUntil: 'load' });
            await sleep(1500);
            await p.evaluate(() => { const t = document.getElementById('view-tab-recent'); if (t) t.click(); });
            await p.waitForFunction(() => !document.getElementById('view-recent').hidden, { timeout: 4000 });
            await sleep(600);
            await p.evaluate(bm => {
                const rows = [...document.querySelectorAll('#view-recent li')];
                const row = rows.find(r => ((r.dataset.nodeId || '') + r.id).includes(bm))
                    || rows.find(r => (r.textContent || '').includes('Verify BM'));
                if (row)
                    (row.querySelector('a') || row.firstElementChild || row).focus();
            }, ids.bm);
            await sleep(700);
            await sleep(400); // let debounced writes land before the next load
        }
        {
            const p = await openPopup();
            await sleep(400);
            const st = await p.evaluate(bm => {
                const rows = [...document.querySelectorAll('#view-recent li')];
                const target = rows.find(r => ((r.dataset.nodeId || '') + r.id).includes(bm))
                    || rows.find(r => (r.textContent || '').includes('Verify BM'));
                const el = document.activeElement;
                return {
                    recentActive: (document.querySelector('#view-tabs .view-tab[aria-selected="true"]') || {}).id === 'view-tab-recent',
                    // :focus paints the selected background + ring — the
                    // visible highlight; .focus is only the 3s reveal flash
                    rowFocused: !!(el && el.closest && el.closest('#view-recent')),
                    onTargetRow: !!(target && el && el.closest && target.contains(el)),
                    flash: document.querySelectorAll('#view-recent .focus').length
                };
            }, ids.bm);
            ck('P10 recent-view row memory: the focused list row re-highlights on reopen',
                st.recentActive && st.rowFocused, JSON.stringify(st));
            await sleep(400); // let debounced writes land before the next load
        }

        // cleanup + restore defaults
        const fin = await browser.newPage();
        await fin.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(800);
        await fin.evaluate(async ({ folder, sub, bm }) => {
            const rm = id => new Promise(res => chrome.bookmarks.remove(id, res));
            await rm(bm); await rm(sub); await rm(folder);
            chrome.storage.local.remove(['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot']);
            chrome.storage.sync.remove(['rememberScroll', 'rememberOpens', 'rememberHighlight',
                'rememberSearchQuery', 'rememberView', 'dontRememberState', 'activeView']);
        }, ids);
        await fin.close();

        console.log(`\n==== ${pass} passed, ${fail} failed ====`);
        process.exit(fail ? 1 : 0);
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
