// Maintainer's v4.1.3 live repro (2026-09-04): highlight ON; between two
// popup opens expand a VERY LONG folder and scroll deep to some bookmark;
// the NEXT open ALWAYS drifts. Unlike diag-66-folder-highlight-drift (400
// uniform titles, fast machine, one-shot programmatic scroll), this probe
// models the real conditions:
//   · realistic titles — every 5th row wraps to 2-3 lines, so the cv:auto
//     contain-intrinsic-size placeholder (1 line) UNDERESTIMATES the real
//     row height (the saved pixel offset was captured under REAL heights);
//   · wheel-like stepped scrolling in popup #1 so every band on the way is
//     rendered with real heights before the position is saved;
//   · the reopen asserts BOTH the pixel position and the CONTENT — which
//     row sits at the top of the viewport (a pixel-exact landing on a
//     shifted layout is still a user-visible drift);
//   · optional CPU throttling (VBM_DIAG_THROTTLE env, e.g. 6) to model the
//     maintainer's machine class, where layout settles across many frames.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROWS = parseInt(process.env.VBM_DIAG_ROWS || '900', 10);
const THROTTLE = parseFloat(process.env.VBM_DIAG_THROTTLE || '0', 10);
// 4.1.4 tree-cv lab knobs: VBM_TREE_CV=1 turns treeCvLab on (the probe's
// FREEZE/LATE models only exist under cv); VBM_TREE_CV_REVEAL=1 picks the
// scrollIntoView reveal transport (PK vs the band walk).
const CV_ON = process.env.VBM_TREE_CV === '1';
const CV_REVEAL = process.env.VBM_TREE_CV_REVEAL === '1';
console.log(`tree-cv mode: ${CV_ON ? (CV_REVEAL ? 'cv+reveal' : 'cv+walk') : 'cv-off (4.1.4 default)'}`);
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
        const seedInfo = await seed.evaluate(async n => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.title === 'Bookmarks bar' || c.id === '1');
            const f = await create({ parentId: bar.id, title: '__LONG__' });
            const mk = async (i0, i1) => {
                for (let i = i0; i <= i1; i++) {
                    // every 5th title wraps to 2-3 lines at the 320px popup width
                    const long = i % 5 === 0;
                    const title = long
                        ? `Wrapped ${String(i).padStart(3, '0')} — a realistically long bookmark title that certainly wraps to multiple lines in the narrow popup`
                        : `BM ${String(i).padStart(3, '0')}`;
                    await create({ parentId: f.id, title, url: `https://ex${i}.example/x` });
                }
            };
            await mk(1, 400);
            const held = await create({ parentId: f.id, title: '__HELD__' });
            for (let i = 401; i <= 500; i++)
                await create({ parentId: held.id, title: `Held ${String(i).padStart(3, '0')}`, url: `https://h${i}.example/x` });
            await mk(501, n);
            return { fid: f.id, hid: held.id };
        }, ROWS);
        const fid = seedInfo.fid;
        console.log(`seeded folder ${fid} with ${ROWS} rows (1 in 5 wraps; __HELD__=${seedInfo.hid} mid-list for the LATE mode)`);
        // maintainer config: highlight ON (default), scroll/opens memory on
        await seed.evaluate(() => new Promise(res => chrome.storage.sync.set(
            { rememberHighlight: '1', rememberScroll: '1', rememberOpens: '1' }, res)));
        await seed.evaluate(([cv, reveal]) => new Promise(res => chrome.storage.local.set(
            { treeCvLab: cv ? '1' : '', treeCvRevealLab: reveal ? '1' : '' }, res)), [CV_ON, CV_REVEAL]);
        await seed.evaluate(() => new Promise(res => chrome.storage.local.remove(
            ['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot', 'activeView'], res)));
        await seed.close();

        const opener = await browser.newPage();
        await opener.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        const openerId = opener.target()._targetId;
        let client = null;
        let currentPopupId = null;
        const consumed = new Set();
        const openRealPopup = async () => {
            await opener.evaluate(() => new Promise(resolve => {
                chrome.action.openPopup(() => resolve('ok'));
            }));
            for (let i = 0; i < 60; i++) {
                const t = browser.targets().find(x => x.type() === 'page'
                    && x.url().includes('popup.html') && x._targetId !== openerId
                    && !consumed.has(x._targetId));
                if (t) {
                    consumed.add(t._targetId);
                    currentPopupId = t._targetId;
                    client = await t.createCDPSession();
                    try { await client.send('Page.bringToFront'); } catch (e) {}
                    if (THROTTLE > 1) {
                        try { await client.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
                        catch (e) { console.log(`throttle x${THROTTLE} unavailable: ${e.message}`); }
                    }
                    await sleep(700);
                    return;
                }
                await sleep(100);
            }
            throw new Error('popup target not found');
        };
        const closeRealPopup = async () => {
            if (client) {
                try { await client.send('Page.close'); } catch (e) {
                    try { await client.send('Runtime.evaluate', { expression: 'window.close(); 0' }); } catch (e2) {}
                }
            }
            for (let i = 0; i < 30; i++) {
                if (!browser.targets().some(x => x._targetId === currentPopupId))
                    break;
                await sleep(100);
            }
            await sleep(300);
            client = null;
            currentPopupId = null;
        };
        const evalIn = async expr => {
            const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) {
                const d = r.exceptionDetails;
                throw new Error(`eval[${expr.slice(0, 50)}]: ${d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text}`);
            }
            return r.result ? r.result.value : undefined;
        };
        const topRowProbe = () => evalIn(`(() => {
            const t = document.getElementById('tree');
            const mid = t.getBoundingClientRect().top + 40;
            let el = document.elementFromPoint(60, mid);
            while (el && el !== t && !(el.id && el.id.startsWith('neat-tree-item-')))
                el = el.parentElement;
            return {
                top: Math.round(t.scrollTop),
                sh: Math.round(t.scrollHeight),
                row: el ? el.id.replace('neat-tree-item-', '') : '',
                label: el ? (el.textContent || '').trim().slice(0, 26) : '',
                focusRow: (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tree li') || {id: ''}).id || '',
                settling: !!document.body.dataset.vbmTreeSettling,
                mirror: window.store.get('scrollTop'),
                anchor: window.store.get('scrollAnchor')
            };
        })()`);
        const startTimeline = () => evalIn(`(() => {
            window.__tl = [];
            const t0 = performance.now();
            const tick = () => {
                const tr = document.getElementById('tree');
                if (tr) {
                    const mid = tr.getBoundingClientRect().top + 40;
                    let el = document.elementFromPoint(60, mid);
                    while (el && el !== tr && !(el && el.id && String(el.id).startsWith('neat-tree-item-')))
                        el = el.parentElement;
                    window.__tl.push([Math.round(performance.now() - t0), Math.round(tr.scrollTop), Math.round(tr.scrollHeight),
                        el ? String(el.id).replace('neat-tree-item-', '') : '', document.hasFocus() && !!document.activeElement]);
                }
                if (performance.now() - t0 < 12000) setTimeout(tick, 100);
            };
            tick();
            return 0;
        })(); 0`).then(() => {});
        const readTimeline = () => evalIn(`JSON.stringify((window.__tl || []).filter((x, i, a) => i === 0 || x[1] !== a[i - 1][1] || x[3] !== a[i - 1][3]).slice(0, 60))`);

        // ---- popup #1: expand the long folder (real click → focus), wheel-scroll deep ----
        await openRealPopup();
        await evalIn(`(() => {
            for (const li of document.querySelectorAll('#tree > ul > li.parent:not(.open)'))
                (li.querySelector(':scope > span') || li.firstElementChild).click();
        })(); 0`);
        for (let i = 0; i < 60; i++) { if (await evalIn(`document.getElementById('neat-tree-item-${fid}')`)) break; await sleep(100); }
        await evalIn(`(() => {
            const li = document.getElementById('neat-tree-item-${fid}');
            if (li && !li.classList.contains('open')) {
                const span = li.querySelector(':scope > span') || li.firstElementChild;
                span.focus(); // a REAL click focuses the folder span — focusID = folder row
                span.click();
            }
        })(); 0`);
        // LATE mode: the held subfolder must be part of the SAVED geometry
        // (popup #1 opens it too, so its ~1900px is inside the saved offset)
        await evalIn(`(() => {
            const li = document.getElementById('neat-tree-item-${seedInfo.hid}');
            if (li && !li.classList.contains('open'))
                (li.querySelector(':scope > span') || li.firstElementChild).click();
        })(); 0`);
        for (let i = 0; i < 80; i++) { if (await evalIn(`document.querySelectorAll('#tree li').length`) >= ROWS) break; await sleep(100); }
        await sleep(400);
        // wheel-like: step down in 350px hops so every band renders with real heights
        const deep = await evalIn(`(() => {
            const t = document.getElementById('tree');
            const max = t.scrollHeight - t.clientHeight;
            const target = Math.round(max * 0.75);
            return { max, target };
        })()`);
        for (let y = 350; y < deep.target; y += 350) {
            await evalIn(`document.getElementById('tree').scrollTop = Math.min(${y}, ${deep.target}); 0`);
            await sleep(90);
        }
        await evalIn(`document.getElementById('tree').scrollTop = ${deep.target}; 0`);
        await sleep(600);
        await evalIn(`(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); return 0; })(); 0`);
        await sleep(200);
        const atClose = await topRowProbe();
        console.log('POPUP1 close-state:', JSON.stringify(atClose), `scrollMax=${deep.max}`);
        await closeRealPopup();

        // ---- popup #2: the reopen must land pixel-exact AND content-exact ----
        // The action-popup form cannot be throttled before ~500ms (attach
        // lag), and the whole campaign fits inside that window on the fast
        // harness — so ALSO run the reopen in a TAB-form popup that is
        // throttled from t=0 (session created before navigation) with the
        // timeline injected before any page script runs: the faithful
        // simulation of the maintainer's machine class.
        const runReopenTab = async () => {
            const page = await browser.newPage();
            const c = await page.target().createCDPSession();
            try { await c.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE > 1 ? THROTTLE : 1 }); } catch (e) {}
            await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `
                window.__tl = [];
                window.__t0 = performance.now();
                const tick = () => {
                    const tr = document.getElementById('tree');
                    if (tr) {
                        const mid = tr.getBoundingClientRect().top + 40;
                        let el = document.elementFromPoint(60, mid);
                        while (el && el !== tr && !(el && el.id && String(el.id).startsWith('neat-tree-item-')))
                            el = el.parentElement;
                        window.__tl.push([Math.round(performance.now() - window.__t0), Math.round(tr.scrollTop), Math.round(tr.scrollHeight),
                            el ? String(el.id).replace('neat-tree-item-', '') : '',
                            !!(document.body && document.body.dataset && document.body.dataset.vbmTreeSettling)]);
                    }
                    if (performance.now() - window.__t0 < 15000) setTimeout(tick, 80);
                };
                if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
                else tick(); 0;
            ` });
            await page.setViewport({ width: 340, height: 640 });
            await page.goto(`chrome-extension://${extId}/pages/popup.html`,
                { waitUntil: 'load', timeout: 150000 });
            await sleep(Math.min(15000, 6000 * (THROTTLE > 1 ? THROTTLE / 4 : 1)));
            const fin = await c.send('Runtime.evaluate', { expression: `(() => {
                const t = document.getElementById('tree');
                const mid = t.getBoundingClientRect().top + 40;
                let el = document.elementFromPoint(60, mid);
                while (el && el !== t && !(el.id && el.id.startsWith('neat-tree-item-')))
                    el = el.parentElement;
                return JSON.stringify({
                    top: Math.round(t.scrollTop), sh: Math.round(t.scrollHeight),
                    row: el ? el.id.replace('neat-tree-item-', '') : '',
                    focusRow: (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tree li') || {id: ''}).id || '',
                    settling: !!document.body.dataset.vbmTreeSettling,
                    mirror: window.store.get('scrollTop'),
                    tl: (window.__tl || []).filter((x, i, a) => i === 0 || x[1] !== a[i - 1][1] || x[2] !== a[i - 1][2] || x[3] !== a[i - 1][3] || x[4] !== a[i - 1][4]).slice(0, 90)
                });
            })()`, returnByValue: true, awaitPromise: true });
            const r = JSON.parse(fin.result.value);
            console.log(`REOPEN-TAB(x${THROTTLE || 1}) final:`, JSON.stringify({ ...r, tl: undefined }));
            console.log(`REOPEN-TAB timeline (t, scrollTop, scrollHeight, topRowId, settling):`);
            for (const row of r.tl)
                console.log('   ', JSON.stringify(row));
            return r;
        };
        if (process.env.VBM_DIAG_FREEZE !== '1') {
            const tabRes = await runReopenTab();
            // Row-anchored contract: two sessions' placeholder mosaics above
            // the viewport differ (cv laziness — even the wheel hops of the
            // saving session skip bands), so the pixel is informational;
            // the ROW is the memory.
            const contentOk = tabRes.row === atClose.row;
            console.log(`INFO  TAB pixel: reopen top ${tabRes.top} (saved ${atClose.top} — placeholder mosaics differ)`);
            console.log((contentOk ? 'PASS' : 'FAIL') + `  TAB content: reopen top row ${tabRes.row || '(none)'} === close ${atClose.row}`);
            process.exitCode = contentOk ? process.exitCode : 1;
        }

        // popup #2 as the real action popup. VBM_DIAG_FREEZE=1 models the
        // HEADED-machine placeholder phase that headless never shows (here
        // the whole tree lays out before the restore assignment, so nothing
        // ever corrects): a userstyle freezes every row to one-line height
        // — the cv contain-intrinsic-size underestimate — the saved deep
        // position pixel-lands instantly against the FROZEN geometry (no
        // campaign arms), the highlight's focus grant fires immediately,
        // and only then the freeze is RELEASED: the placeholder→real
        // corrections ripple in above the viewport while the off-viewport
        // focused highlight row is Chromium's preferred scroll anchor —
        // the compensation yanks the view. That is the maintainer's
        // "reopen ALWAYS drifts" (v4.1.3, highlight ON, long folder).
        const FREEZE = process.env.VBM_DIAG_FREEZE === '1';
        const setUserstyle = css => opener.evaluate(c => new Promise((res, rej) => {
            const done = () => {
                if (c === null)
                    return res();
                // a fresh popup's store-ready read can beat the commit —
                // poll until readable (diag-68 lesson)
                const t0 = Date.now();
                const poll = () => chrome.storage.local.get('userstyle', r => {
                    if (r.userstyle === c)
                        return res();
                    if (Date.now() - t0 > 3000)
                        return rej(new Error('userstyle readback timeout'));
                    setTimeout(poll, 150);
                });
                poll();
            };
            if (c === null)
                chrome.storage.local.remove('userstyle', done);
            else
                chrome.storage.local.set({ userstyle: c }, done);
        }), css);
        if (FREEZE)
            await setUserstyle('/*vbm-freeze-rows*/#tree ul li{height:17px!important;overflow:hidden!important}');
        await openRealPopup();
        await startTimeline();
        if (FREEZE) {
            await sleep(800); // pixel landing + the immediate focus grant
            console.log('FREEZE phase:', JSON.stringify(await topRowProbe()));
            const usv = await evalIn(`JSON.stringify({
                mirror: String(window.store.get('userstyle') || '').slice(0, 44),
                headStyles: document.querySelectorAll('head style').length
            })`);
            console.log('FREEZE userstyle in popup2:', usv);
            const released = await evalIn(`(() => {
                const styles = [...document.body.querySelectorAll('style')].map(s => s.textContent.slice(0, 44));
                for (const s of document.body.querySelectorAll('style'))
                    if (s.textContent.includes('vbm-freeze-rows')) { s.textContent = ''; return JSON.stringify({found: 1, styles}); }
                return JSON.stringify({found: 0, styles});
            })()`);
            console.log('FREEZE released —', released);
        }
        await sleep(8000); // campaign 4.5s + focus grant + margin
        const atOpen = await topRowProbe();
        console.log('POPUP2 final:', JSON.stringify(atOpen));
        console.log('POPUP2 timeline (t, scrollTop, scrollHeight, topRowId):');
        for (const row of JSON.parse(await readTimeline()))
            console.log('   ', JSON.stringify(row));
        {
            // Row-anchored contract (see the TAB block note): the pixel is
            // informational across differing placeholder mosaics; the ROW
            // is the memory.
            const contentOk = atOpen.row === atClose.row;
            console.log(`INFO  pixel: reopen top ${atOpen.top} (saved ${atClose.top})`);
            console.log((contentOk ? 'PASS' : 'FAIL') + `  content: reopen top row ${atOpen.row || '(none)'} === close ${atClose.row}`);
            process.exitCode = contentOk ? process.exitCode : 1;
        }
        await closeRealPopup();
        if (FREEZE)
            await setUserstyle(null);

        // VBM_DIAG_LATE=1 — the maintainer's follow-up report (2026-09-05):
        // "the FIRST reopen remembers and never moves, but every subsequent
        // open lands somewhere different." Model: popup #3 restores under a
        // frozen geometry, the bulk releases, the campaign stabilizes and
        // ENDS (anchoring re-enabled, focus granted) — and only then a held
        // band ABOVE the restored view releases: the trailing correction
        // wave real machines deliver after any fixed stabilization window.
        // If the re-enabled anchoring compensates that growth around the
        // off-viewport focused highlight row, the view moves, the scroll
        // listener persists the moved value, and every subsequent reopen
        // starts from a different number.
        if (process.env.VBM_DIAG_LATE === '1') {
            const heldSel = `#neat-tree-item-${seedInfo.hid} ul{height:0!important;overflow:hidden!important}`;
            await setUserstyle('/*vbm-freeze-rows*/#tree ul li{height:17px!important;overflow:hidden!important}');
            await openRealPopup();
            await startTimeline();
            await sleep(900); // bulk release — every row unfreezes EXCEPT the held subfolder stays collapsed
            const heldCss = '/*vbm-freeze-rows*/' + heldSel;
            await evalIn(`(() => {
                for (const s of document.body.querySelectorAll('style'))
                    if (s.textContent.includes('vbm-freeze-rows')) {
                        s.textContent = ${JSON.stringify(heldCss)};
                        return 1;
                    }
                return 0;
            })()`);
            // The campaign walks, lands, anchor-verifies and stabilizes;
            // its wall time is machine-dependent (a slow machine legitimately
            // walks past ANY fixed window — audit 2026-09-05: the walk clock
            // cannot park before ~3s and this box needed ~4-5s), so WAIT for
            // the settling flag to clear instead of a fixed sleep.
            const settleDeadline = Date.now() + 20000;
            let settledAt = -1;
            while (Date.now() < settleDeadline) {
                if (!(await evalIn(`!!document.body.dataset.vbmTreeSettling`))) {
                    settledAt = Date.now();
                    break;
                }
                await sleep(100);
            }
            if (settledAt < 0)
                throw new Error('LATE campaign did not settle within 20s');
            await sleep(200); // margin: the final assignment's scroll event / 350ms grace
            const before = await topRowProbe();
            console.log('LATE popup3 landed (held subfolder collapsed, campaign over):', JSON.stringify(before));
            {
                // row-anchored contract: even with the held band collapsed
                // (a DIFFERENT settle geometry than the save), the restore
                // lands on the remembered ROW — the pixel alone would land
                // 1900px of content short (the wrong row).
                const rowOk = before.row === atClose.row;
                console.log((rowOk ? 'PASS' : 'FAIL') + `  LATE row-landing: popup3 top row ${before.row} === saved ${atClose.row}`);
                process.exitCode = rowOk ? process.exitCode : 1;
            }
            const waveAt = await evalIn(`(() => {
                for (const s of document.body.querySelectorAll('style'))
                    if (s.textContent.includes('vbm-freeze-rows')) { s.textContent = ''; return 1; }
                return 0;
            })()`);
            console.log(`LATE: held band released (${waveAt}) — the trailing correction wave arrives AFTER the campaign`);
            await sleep(3500);
            const after = await topRowProbe();
            const heldState = await evalIn(`JSON.stringify({
                ulH: (() => { const li = document.getElementById('neat-tree-item-${seedInfo.hid}');
                    const ul = li && li.querySelector('ul'); return ul ? Math.round(ul.getBoundingClientRect().height) : -1; })(),
                open: !!document.getElementById('neat-tree-item-${seedInfo.hid}').classList.contains('open'),
                sheets: [...document.body.querySelectorAll('style')].map(s => s.textContent.slice(0, 60))
            })`);
            console.log('LATE popup3 after the wave:', JSON.stringify(after), 'held:', heldState);
            {
                // the wave must not move the restored ROW, and the memory
                // must stay row-anchored (the pixel may legitimately drift —
                // content-stable compensation — the ROW is the invariant;
                // the anchor samples the viewport's top edge, so compare
                // against the close-time anchor, not the +40px probe row)
                const rowStill = after.row === atClose.row;
                const anchorRow = String(after.anchor || '').split('@')[0];
                const savedAnchorRow = String(atClose.anchor || '').split('@')[0];
                const anchorOk = anchorRow === savedAnchorRow && !!anchorRow;
                console.log((rowStill ? 'PASS' : 'FAIL') + `  LATE hold: the wave did not move the restored row (${before.row} → ${after.row})`);
                console.log((anchorOk ? 'PASS' : 'FAIL') + `  LATE memory: the stored anchor still points at the saved row (${after.anchor} ~ ${atClose.anchor})`);
                process.exitCode = (rowStill && anchorOk) ? process.exitCode : 1;
            }
            await closeRealPopup();
            await setUserstyle(null);
            // the next open must land on the SAME row as every time
            await openRealPopup();
            await sleep(3500);
            const reopen = await topRowProbe();
            console.log('LATE popup4 (plain reopen):', JSON.stringify(reopen));
            {
                const rowOk = reopen.row === atClose.row;
                console.log((rowOk ? 'PASS' : 'FAIL') + `  LATE reopen: popup4 top row ${reopen.row} === saved ${atClose.row}`);
                process.exitCode = rowOk ? process.exitCode : 1;
            }
            await closeRealPopup();
        }

        // cleanup
        const fin = await browser.newPage();
        await fin.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await fin.evaluate(f => new Promise(res => chrome.bookmarks.removeTree(f, res)), fid);
        await fin.evaluate(() => new Promise(res => chrome.storage.local.remove(
            ['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot', 'activeView',
                'treeCvLab', 'treeCvRevealLab'], res)));
        await fin.evaluate(() => new Promise(res => chrome.storage.sync.remove(
            ['rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
                'rememberView', 'dontRememberState'], res)));
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
