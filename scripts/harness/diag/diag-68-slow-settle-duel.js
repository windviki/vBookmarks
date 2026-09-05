// Deep-dive probe for issues #67/#68 (2026-09-04): "v4.1.2 still fails to
// remember the scroll position — #67 with highlight ON, #68 with highlight
// OFF once scrolled a couple pages down". The unreleased HEAD fixes
// (44f3a517 campaign budget + handshake, 1e4ef0a7 settle-waited focus) were
// validated only against INSTANT layout settle — the fast harness never
// exercises the one condition the user's slow machine presents: scrollHeight
// growing across multiple frames while the restore campaign is live.
//
// Hypothesis under test (the duel): Chromium's scroll anchoring compensates
// content growth ABOVE the in-viewport anchor by moving scrollTop. The
// campaign's step() reads ANY move it did not apply as "taken over — the
// scroller owns it now" and concedes (tree-view.js step()). If anchoring
// fires between two campaign steps, the restore dies mid-climb at the
// anchored (wrong) position and the scroll listener persists that value —
// the exact #68 symptom, ON HEAD.
//
// Slow settle is simulated deterministically at POPUP OPEN (the real user
// scenario): the probe pre-seeds the `userstyle` setting (injected
// synchronously during init, before the first render) with a freeze CSS
// that forces the seeded folders' ul to height:0 (!important beats
// `#tree .open>ul{height:auto}`). The popup opens with the tree frozen ->
// the restore assignment clamps -> the campaign goes live. The probe then
// rewrites the style element to unfreeze folders in a chosen ORDER:
//   PHASE A (adversarial): bottom folder first (campaign climbs, viewport
//     clamped at the partial bottom, anchor inside the bottom folder), then
//     a TOP folder — its growth lands ABOVE the anchor: the duel moment.
//   PHASE B (benign): top-down document order — growth stays below the
//     anchor; the campaign should climb and land regardless.
// PASS = final scrollTop === 2600 in BOTH phases (and the mirror intact).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SAVED = 2600;
// 4.1.4 tree-cv lab knobs: this probe's freeze model only exists under cv,
// so treeCvLab defaults ON here (VBM_TREE_CV=0 forces it off).
// VBM_TREE_CV_REVEAL=1 picks the scrollIntoView reveal transport (PK vs the
// band walk).
const CV_ON = process.env.VBM_TREE_CV !== '0';
const CV_REVEAL = process.env.VBM_TREE_CV_REVEAL === '1';
console.log(`tree-cv mode: ${CV_ON ? (CV_REVEAL ? 'cv+reveal' : 'cv+walk') : 'cv-off'}`);
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
            const folders = [];
            for (let f = 1; f <= 4; f++) {
                const folder = await create({ parentId: bar.id, title: `__F${f}__` });
                for (let i = 1; i <= 120; i++)
                    await create({ parentId: folder.id, title: `F${f} BM ${String(i).padStart(3, '0')}`, url: `https://f${i}ex${i}.example/x` });
                folders.push(folder.id);
            }
            return folders;
        });
        console.log('seeded folders:', JSON.stringify(ids));
        // #68 config: highlight OFF, scroll + opens memory ON
        await seed.evaluate(() => new Promise(res => chrome.storage.sync.set(
            { rememberHighlight: '0', rememberScroll: '1', rememberOpens: '1' }, res)));
        await seed.evaluate(([cv, reveal]) => new Promise(res => chrome.storage.local.set(
            { treeCvLab: cv ? '1' : '', treeCvRevealLab: reveal ? '1' : '' }, res)), [CV_ON, CV_REVEAL]);
        await seed.evaluate(() => new Promise(res => chrome.storage.local.remove('userstyle', res)));
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
        const startTimeline = () => evalIn(`(() => {
            window.__tl = [];
            const t0 = performance.now();
            const tick = () => {
                const tr = document.getElementById('tree');
                if (tr) window.__tl.push([Math.round(performance.now() - t0), Math.round(tr.scrollTop), Math.round(tr.scrollHeight),
                    document.querySelectorAll('#tree li').length]);
                if (performance.now() - t0 < 9000) setTimeout(tick, 60);
            };
            tick();
            return 0;
        })(); 0`).then(() => {});
        const shot = async tag => {
            try {
                require('fs').mkdirSync('/tmp/shots', { recursive: true });
                const r = await client.send('Page.captureScreenshot', { format: 'png' });
                require('fs').writeFileSync(`/tmp/shots/diag68-${tag}.png`, Buffer.from(r.data, 'base64'));
            } catch (e) { /* screenshots best-effort */ }
        };
        const readTimeline = () => evalIn(`JSON.stringify((window.__tl || []).filter((x, i, a) => i === 0 || x[1] !== a[i - 1][1] || x[2] !== a[i - 1][2]))`);
        // userstyle deliberately stays in the LOCAL area (store.js: unbounded
        // CSS exceeds the sync per-item limit) — the popup mirror reads local.
        const setUserstyle = css => opener.evaluate((c, readback) => new Promise((res, rej) => {
            const done = () => {
                if (!readback)
                    return res();
                const t0 = Date.now();
                const poll = () => chrome.storage.local.get('userstyle', r => {
                    if ((c === null && r.userstyle === undefined)
                        || (c !== null && r.userstyle === c))
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
        }), css, true);
        const freezeCss = list => '/*vbm-freeze-probe*/'
            + list.map(id => `#neat-tree-item-${id} ul`).join(',')
            + '{height:0!important;overflow:hidden!important}';
        const setFreeze = async list => {
            const found = await evalIn(`(() => {
                const css = ${JSON.stringify(freezeCss(list))};
                for (const s of document.body.querySelectorAll('style'))
                    if (s.textContent.includes('vbm-freeze-probe')) { s.textContent = css; return 1; }
                return 0;
            })()`);
            if (!found)
                throw new Error('freeze style element not found — userstyle not applied at open?');
        };

        // ---- Step 1: expand all folders by real clicks, scroll deep, close ----
        await openRealPopup();
        await evalIn(`(() => {
            for (const li of document.querySelectorAll('#tree > ul > li.parent:not(.open)'))
                (li.querySelector(':scope > span') || li.firstElementChild).click();
        })(); 0`);
        for (let i = 0; i < 50; i++) { if (await evalIn(`document.querySelectorAll('#tree li').length`) > 4) break; await sleep(100); }
        await evalIn(`(() => {
            for (const li of document.querySelectorAll('#tree li.parent'))
                if (li.textContent.includes('__F') && !li.classList.contains('open')) {
                    const span = li.querySelector(':scope > span') || li.firstElementChild;
                    span.focus();
                    span.click();
                }
        })(); 0`);
        for (let i = 0; i < 50; i++) { if (await evalIn(`document.querySelectorAll('#tree li').length`) > 400) break; await sleep(100); }
        await sleep(500);
        // whatever async mover fights the assignment (late lazy rows +
        // anchoring on the previously focused folder span), re-asserting
        // wins: nothing user-driven is active in this popup.
        let held = false;
        for (let i = 0; i < 6 && !held; i++) {
            await evalIn(`(() => {
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                document.getElementById('tree').scrollTop = ${SAVED};
                return 0;
            })(); 0`);
            await sleep(400);
            held = await evalIn(`Math.round(document.getElementById('tree').scrollTop) === ${SAVED}`);
        }
        const savedAtClose = await evalIn(`JSON.stringify({top: Math.round(document.getElementById('tree').scrollTop), mirror: window.store.get('scrollTop')})`);
        console.log('STEP1 close-state:', savedAtClose);
        await closeRealPopup();

        // ---- Step 2: reopen — baseline instant-settle restore must be exact ----
        await openRealPopup();
        const base = JSON.parse(await evalIn(`JSON.stringify({
            top: Math.round(document.getElementById('tree').scrollTop),
            mirror: window.store.get('scrollTop'),
            rows: document.querySelectorAll('#tree li').length
        })`));
        {
            const ok = base.top === SAVED;
            console.log((ok ? 'PASS' : 'FAIL') + `  STEP2 baseline instant-settle restore = ${SAVED} — got ${JSON.stringify(base)}`);
            process.exitCode = ok ? process.exitCode : 1;
        }
        await closeRealPopup();

        // ---- The slow-settle duel, at popup open ----
        const runPhase = async (name, order) => {
            await setUserstyle(freezeCss(ids));        // frozen BEFORE first render
            await openRealPopup();
            const frozen = await evalIn(`JSON.stringify({
                top: Math.round(document.getElementById('tree').scrollTop),
                sh: Math.round(document.getElementById('tree').scrollHeight),
                mirror: window.store.get('scrollTop'),
                settling: !!document.body.dataset.vbmTreeSettling
            })`);
            console.log(`PHASE ${name} opened frozen (campaign live):`, frozen);
            await evalIn(`window.__probeMark = 1; 0`);
            await shot(`${name}-open`);
            await startTimeline();
            for (let k = 0; k < order.length; k++) {
                await sleep(250);
                const unfrozen = order.slice(0, k + 1);
                await setFreeze(ids.filter((_, i) => !unfrozen.includes(i)));
                await sleep(120);
                const probe = await evalIn(`JSON.stringify({
                    sh: Math.round(document.getElementById('tree').scrollHeight),
                    top: Math.round(document.getElementById('tree').scrollTop),
                    vis: document.visibilityState,
                    focus: document.hasFocus(),
                    mark: !!window.__probeMark,
                    liveRules: (() => {
                        for (const ss of document.styleSheets)
                            if (ss.ownerNode && ss.ownerNode.textContent.includes('vbm-freeze-probe')) {
                                try { return [...ss.cssRules].map(r => r.cssText).join(' | ').slice(0, 160); }
                                catch (e) { return 'ERR:' + e.message; }
                            }
                        return 'NO-SHEET';
                    })(),
                    firstVis: (() => {
                        const rows = [...document.querySelectorAll('#tree li a, #tree li span')];
                        const vis = rows.filter(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= 600 && r.height > 0; });
                        return (vis[0] && vis[0].textContent || '').slice(0, 24);
                    })(),
                    f1: (() => {
                        const li = document.getElementById('neat-tree-item-${ids[0]}');
                        if (!li) return null;
                        const ul = li.querySelector('ul');
                        const cs = getComputedStyle(li);
                        const r = li.getBoundingClientRect();
                        return { open: li.classList.contains('open'), liH: li.offsetHeight,
                            liCS: cs.height + '/' + cs.display + '/' + cs.overflow,
                            rect: [Math.round(r.top), Math.round(r.height)],
                            ulH: ul ? ul.offsetHeight : -1 };
                    })()
                })`);
                console.log(`PHASE ${name}: unfroze folder index ${order[k]} (F${order[k] + 1}) — probe ${probe}`);
                await shot(`${name}-${k}`);
            }
            await sleep(1500);
            const fin = JSON.parse(await evalIn(`JSON.stringify({
                top: Math.round(document.getElementById('tree').scrollTop),
                sh: Math.round(document.getElementById('tree').scrollHeight),
                mirror: window.store.get('scrollTop'),
                settling: !!document.body.dataset.vbmTreeSettling,
                vis: document.visibilityState,
                focus: document.hasFocus(),
                mark: !!window.__probeMark,
                bodyStyles: [...document.body.querySelectorAll('style')].map(s => s.textContent.slice(0, 90))
            })`));
            const tl = JSON.parse(await readTimeline());
            console.log(`PHASE ${name} final:`, JSON.stringify(fin));
            console.log(`PHASE ${name} timeline (t, scrollTop, scrollHeight):`);
            for (const row of tl.slice(0, 40))
                console.log('   ', JSON.stringify(row));
            const ok = fin.top === SAVED;
            console.log((ok ? 'PASS' : 'FAIL') + `  PHASE ${name}: final position === ${SAVED}`);
            process.exitCode = ok ? process.exitCode : 1;
            await closeRealPopup();
            await setUserstyle(null);
        };

        // PHASE A (adversarial): F4 (bottom) first, then F1 (top — growth ABOVE
        // the clamped anchor: the duel), then F2, F3.
        await runPhase('A', [3, 0, 1, 2]);
        // PHASE B (benign): F1..F4 top-down — growth below the anchor.
        await runPhase('B', [0, 1, 2, 3]);

        const fin2 = await browser.newPage();
        await fin2.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await fin2.evaluate(fs => new Promise(res => {
            let left = fs.length;
            for (const f of fs)
                chrome.bookmarks.removeTree(f, () => { if (--left === 0) res(); });
        }), ids);
        await fin2.evaluate(() => new Promise(res => chrome.storage.local.remove(
            ['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot', 'activeView', 'userstyle'], res)));
        await fin2.evaluate(() => new Promise(res => chrome.storage.sync.remove(
            ['rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
                'rememberView', 'dontRememberState'], res)));
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
