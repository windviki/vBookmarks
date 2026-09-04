// The maintainer's exact repro for #66's residual report (2026-09-03):
//   1. highlight ON, hundreds of bookmarks; expand a non-empty folder (a
//      REAL click — focus lands on the folder span, so the FOLDER becomes
//      the highlight memory); close; reopen — the folder row highlights
//      (correct).
//   2. scroll deep to some bookmark; close; reopen — the position DRIFTED.
// Root cause (probe-verified): Chromium's scroll anchoring prefers the
// FOCUSED row as its anchor; the off-viewport focus grant during the fresh
// render's layout settle made the height growth compensation jump the
// viewport toward the row. The fix defers the focus grant until the scroll
// campaign lands (body[data-vbm-tree-settling]).
// NOTE: on the fast harness the layout settles instantly, so the drift
// never shows here — this diag pins the CORRECT behavior of both steps
// (folder highlight restores; the deep position reopens exactly).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2500);
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const seed = await browser.newPage();
        await seed.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        let ids = await seed.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.title === 'Bookmarks bar' || c.id === '1');
            const f = await create({ parentId: bar.id, title: '__THE_FOLDER__' });
            for (let i = 1; i <= 400; i++)
                await create({ parentId: f.id, title: 'BM ' + String(i).padStart(3, '0'), url: `https://ex${i}.example/x` });
            return { folder: f.id };
        });
        ids = { folder: ids.folder.id || ids.folder };
        await seed.evaluate(() => new Promise(res => chrome.storage.local.remove(
            ['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot', 'activeView'], res)));
        await seed.evaluate(() => new Promise(res => chrome.storage.sync.remove(
            ['rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
                'rememberView', 'dontRememberState'], res)));
        await seed.close();

        const opener = await browser.newPage();
        await opener.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        const openerId = opener.target()._targetId;
        let client = null;
        const openRealPopup = async (watch) => {
            await opener.evaluate(() => new Promise(resolve => {
                chrome.action.openPopup(() => resolve('ok'));
            }));
            for (let i = 0; i < 50; i++) {
                const t = browser.targets().find(x => x.type() === 'page' && x.url().includes('popup.html') && x._targetId !== openerId);
                if (t) {
                    client = await t.createCDPSession();
                    if (watch) {
                        await evalIn(`(() => {
                            window.__tl = [];
                            const t0 = performance.now();
                            const tick = () => {
                                const tr = document.getElementById('tree');
                                if (tr) window.__tl.push([Math.round(performance.now() - t0), Math.round(tr.scrollTop), tr.scrollHeight]);
                                if (performance.now() - t0 < 5000) setTimeout(tick, 60);
                            };
                            tick();
                        })(); 0`).catch(() => {});
                    }
                    await sleep(1200);
                    return;
                }
                await sleep(100);
            }
            throw new Error('popup target not found');
        };
        const closeRealPopup = async () => {
            if (client) { try { await client.send('Runtime.evaluate', { expression: 'window.close(); 0' }); } catch (e) {} }
            await sleep(600); client = null;
        };
        const evalIn = async expr => {
            const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) {
                const d = r.exceptionDetails;
                throw new Error(`eval[${expr.slice(0, 50)}]: ${d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text}`);
            }
            return r.result ? r.result.value : undefined;
        };
        const startTimeline = () => evalIn(`(() => {
            window.__tl = [];
            const t0 = performance.now();
            const tick = () => {
                const tr = document.getElementById('tree');
                if (tr) window.__tl.push([Math.round(performance.now() - t0), Math.round(tr.scrollTop), tr.scrollHeight]);
                if (performance.now() - t0 < 5000) setTimeout(tick, 60);
            };
            tick();
            return 0;
        })(); 0`).then(() => {});
        const readTimeline = () => evalIn(`JSON.stringify((window.__tl || []).filter((x, i, a) => i === 0 || x[1] !== a[i - 1][1] || x[2] !== a[i - 1][2]))`);

        // ---- Step 1: expand THE folder by a real click, close, reopen ----
        await openRealPopup();
        await evalIn(`(() => {
            for (const li of document.querySelectorAll('#tree > ul > li.parent:not(.open)'))
                (li.querySelector(':scope > span') || li.firstElementChild).click();
        })(); 0`);
        for (let i = 0; i < 50; i++) { if (await evalIn(`!!document.getElementById('neat-tree-item-${ids.folder}')`)) break; await sleep(100); }
        await evalIn(`(() => {
            const li = document.getElementById('neat-tree-item-${ids.folder}');
            if (li && !li.classList.contains('open')) {
                const span = li.querySelector(':scope > span') || li.firstElementChild;
                span.focus(); // a REAL click focuses the span — synthetic .click() does not
                span.click();
            }
        })(); 0`);
        for (let i = 0; i < 50; i++) { if (await evalIn(`document.querySelectorAll('#tree li').length`) > 100) break; await sleep(100); }
        await sleep(500);
        await closeRealPopup();
        await openRealPopup(false);
        const step1 = await evalIn(`JSON.stringify({
            top: Math.round(document.getElementById('tree').scrollTop),
            hi: [...document.querySelectorAll('#tree .focus')].map(e => e.closest('li').id.replace('neat-tree-item-', '')),
            active: (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tree li') || {}).id || ''
        })`);
        {
            const s = JSON.parse(step1);
            const ok = s.hi.includes(ids.folder) && s.active === `neat-tree-item-${ids.folder}`;
            console.log((ok ? 'PASS' : 'FAIL') + `  STEP1: the expanded folder row re-highlights and takes focus — ${step1}`);
            process.exitCode = ok ? process.exitCode : 1;
        }

        // ---- Step 2: scroll deep to a bookmark, close, reopen — expect drift ----
        await sleep(4600); // let the 4s focusID cleanup fire (realistic dwell)
        await evalIn(`document.getElementById('tree').scrollTop = 2600; 0`);
        await sleep(800);
        const savedAtClose = await evalIn(`JSON.stringify({top: Math.round(document.getElementById('tree').scrollTop), mirror: window.store.get('scrollTop')})`);
        console.log('STEP2 close-state:', savedAtClose);
        const closeTop = JSON.parse(savedAtClose).top;
        await closeRealPopup();
        await openRealPopup(true);
        console.log('STEP2 reopen timeline (t, scrollTop, scrollHeight):');
        for (const row of JSON.parse(await readTimeline()).slice(0, 30))
            console.log('   ', JSON.stringify(row));
        const fin = await evalIn(`JSON.stringify({
            top: Math.round(document.getElementById('tree').scrollTop),
            mirror: window.store.get('scrollTop'),
            hi: [...document.querySelectorAll('#tree .focus')].map(e => e.closest('li').id.replace('neat-tree-item-', '')),
            active: (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tree li') || {}).id || ''
        })`);
        console.log('STEP2 final:', fin);
        {
            const s = JSON.parse(fin);
            const ok = s.top === closeTop;
            console.log((ok ? 'PASS' : 'FAIL') + `  STEP2: reopen keeps the exact close-time position (${closeTop}) — no drift`);
            process.exitCode = ok ? process.exitCode : 1;
        }

        await closeRealPopup();
        const fin2 = await browser.newPage();
        await fin2.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await fin2.evaluate(f => new Promise(res => chrome.bookmarks.removeTree(f, res)), ids.folder);
        await fin2.evaluate(() => new Promise(res => chrome.storage.local.remove(
            ['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot', 'activeView'], res)));
        await fin2.evaluate(() => new Promise(res => chrome.storage.sync.remove(
            ['rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
                'rememberView', 'dontRememberState'], res)));
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
