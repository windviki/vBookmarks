// Dead-view scan-tick probe (4.1.0 perf round 2) — verifies the incremental
// live render at 6000 bookmarks: while the SW scans, each 700ms blob publish
// must INSERT only the newly settled problem rows into the SAME results <ul>
// node (no whole-list rebuild per tick — the old path re-created every row
// and its _favicon <img> on every publish, O(n²/scan)).
//
//   scripts/harness/rerun.sh diag/diag-dead-ticks.js
//
// Knobs: VBM_PERF_BOOKMARKS (default 6000). The seed mixes instant-fail
// URLs (127.0.0.1:9 — connection refused) with a few HANGING URLs served by
// a local never-responding HTTP server, so the scan lasts long enough to
// observe dozens of 700ms publishes (a realistic mixed workload).
const puppeteer = require('puppeteer');
const fs = require('fs');
const http = require('http');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEED_BOOKMARKS = Math.max(100, parseInt(process.env.VBM_PERF_BOOKMARKS || '6000', 10));
const HANGING = 200; // URLs that hang until the 2s scan timeout

// A server that accepts and never answers — the probe URL's fetch hangs
// until the scan's AbortController fires (deadScanTimeout, set to 2s below).
// Started inside main (top-level await is ESM-only; this script is CJS).
const hangServer = http.createServer(() => { /* never respond */ });
let hangPort = 0;

const launch = () => puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
    headless: 'new',
    protocolTimeout: 600000, // the 1200-tab workload build is ONE long evaluate
    args: [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--load-extension=/ext',
        '--disable-extensions-except=/ext'
    ]
});

(async () => {
    hangPort = await new Promise(res => {
        hangServer.listen(0, '127.0.0.1', () => res(hangServer.address().port));
    });
    const outDir = '/tmp/shots/perf';
    fs.mkdirSync(outDir, { recursive: true });
    const out = { profile: { bookmarks: SEED_BOOKMARKS } };
    const browser = await launch();
    try {
        await sleep(2000);
        const swTarget = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        if (!swTarget)
            throw new Error('extension service worker not found');
        const extId = new URL(swTarget.url()).hostname;

        // --- seed bookmarks (perf-popup recipe, no dups) ---------------------
        const seedPage = await browser.newPage();
        await seedPage.setViewport({ width: 400, height: 620 });
        await seedPage.evaluateOnNewDocument(() => { window.close = () => {}; });
        seedPage.setDefaultTimeout(180000);
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);
        const seed = await seedPage.evaluate(async (opts) => {
            const getTree = () => new Promise(res => chrome.bookmarks.getTree(res));
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await getTree();
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__perf__' });
            const L1 = 20, L2 = 5, L3 = 3;
            // leaves live under the L2 folders (L1×L2 of them) — divide by
            // that count, not the L3 total, to actually reach opts.count
            const perL3 = Math.max(1, Math.round(opts.count / (L1 * L2)));
            const openIds = [folder.id];
            const l1Ids = [];
            for (let i = 0; i < L1; i++)
                l1Ids.push(await create({ parentId: folder.id, title: `L1-${i}` }));
            const l2Ids = [];
            for (let i = 0; i < L1; i++) {
                openIds.push(l1Ids[i].id);
                for (let j = 0; j < L2; j++) {
                    const l2 = await create({ parentId: l1Ids[i].id, title: `L1-${i}/L2-${j}` });
                    l2Ids.push(l2);
                    openIds.push(l2.id);
                }
            }
            let seq = 0;
            const hangEvery = Math.max(1, Math.round(opts.count / opts.hanging));
            for (let i = 0; i < l2Ids.length; i++) {
                const batch = [];
                for (let b = 0; b < perL3; b++) {
                    seq++;
                    // hanging host on every Nth URL, instant refusal otherwise
                    const host = seq % hangEvery === 0 ? `127.0.0.1:${opts.hangPort}` : '127.0.0.1:9';
                    const url = `http://${host}/u/${seq}`;
                    batch.push(create({ parentId: l2Ids[i].id, title: `bm ${seq}`, url }));
                }
                await Promise.all(batch);
            }
            const payload = { opens: JSON.stringify(openIds), deadScanTimeout: '2' };
            await new Promise(res => chrome.storage.local.set(payload, res));
            return { total: seq };
        }, { count: SEED_BOOKMARKS, hanging: HANGING, hangPort });
        console.log('seeded:', JSON.stringify(seed));
        await seedPage.close().catch(() => {});

        // --- dead view: start the scan and watch the ticks -------------------
        const p = await browser.newPage();
        await p.setViewport({ width: 400, height: 620 });
        await p.evaluateOnNewDocument(() => { window.close = () => {}; });
        p.setDefaultTimeout(180000);
        await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(3000);
        await p.evaluate(() => { const b = document.getElementById('view-tab-dead'); if (b) b.click(); });
        await sleep(1200);
        const diag = await p.evaluate(async () => {
            // start the scan (the executable empty-state row)
            const start = document.querySelector('.dead-start, .dead-rescan');
            if (start)
                start.click();
            const t0 = performance.now();
            const ticks = [];
            let lastSeen = 0;
            let capturedUl = null;
            let firstUl = null;
            // MutationObserver: count nodes added per burst (a tick's DOM
            // work); record ul identity at every poll below.
            const mo = new MutationObserver(mrs => {
                let nodes = 0;
                for (const m of mrs)
                    nodes += m.addedNodes.length;
                ticks.push({ t: performance.now() - t0, added: nodes });
            });
            const list = document.getElementById('dead-list');
            mo.observe(list, { childList: true, subtree: true });
            // poll until the run finishes (deadLastScan lands); the hanging
            // tail takes ~2s × (HANGING/concurrency) — up to ~3 minutes
            const polls = [];
            for (let i = 0; i < 2400; i++) {
                await new Promise(r => setTimeout(r, 100));
                const ul = document.querySelector('#dead-list ul[role="list"]');
                if (!firstUl)
                    firstUl = ul;
                if (ul) {
                    if (!ul.__vbmDiagMarker) {
                        ul.__vbmDiagMarker = true;
                        if (!capturedUl)
                            capturedUl = ul;
                    }
                    polls.push({
                        sameUl: ul === firstUl,
                        markerAlive: !!ul.__vbmDiagMarker,
                        rows: ul.querySelectorAll('li').length
                    });
                }
                const done = await new Promise(res => chrome.storage.local.get('deadLastScan', d => {
                    try { res(!!(JSON.parse(d.deadLastScan || 'null') || {}).results); } catch (_) { res(false); }
                }));
                if (done) {
                    const ul2 = document.querySelector('#dead-list ul[role="list"]');
                    polls.push({
                        sameUl: ul2 === firstUl,
                        markerAlive: !!(ul2 && ul2.__vbmDiagMarker),
                        rows: ul2 ? ul2.querySelectorAll('li').length : 0,
                        final: true
                    });
                    break;
                }
            }
            mo.disconnect();
            return { ticks, polls };
        });
        out.deadScanTicks = diag;
        // Summarize: rows appearing per tick (added nodes) and ul identity
        // stability while the scan lived (all non-final polls sameUl=true
        // proves no whole-list rebuild happened).
        const live = (diag.polls || []).filter(pl => !pl.final);
        const finals = (diag.polls || []).filter(pl => pl.final);
        out.summary = {
            tickBursts: (diag.ticks || []).length,
            maxAddedPerBurst: Math.max(0, ...(diag.ticks || []).map(t => t.added)),
            rowsAtEnd: finals.length ? finals[0].rows : 0,
            livePolls: live.length,
            // the ul identity must hold for EVERY live poll; the only
            // legitimate break is the finish transition (cache-written idle
            // render replaces the live list once, caught mid-stream)
            sameUlBreaks: live.filter(pl => !pl.sameUl).map(pl => pl.rows),
            markerAliveAlways: live.length > 0 && live.every(pl => pl.markerAlive)
        };
        console.log('dead scan ticks:', JSON.stringify(out.summary));
        console.log('bursts:', JSON.stringify(diag.ticks));
        console.log('polls:', JSON.stringify(diag.polls));
        await p.close().catch(() => {});

        fs.writeFileSync(outDir + '/diag-dead-ticks.json', JSON.stringify(out, null, 2));
        console.log('\nwritten to', outDir + '/diag-dead-ticks.json');
    } finally {
        hangServer.close();
        await browser.close();
    }
})().catch(e => {
    console.error('DIAG FAILED:', e && e.stack || e);
    process.exit(1);
});
