// v4 task-4 #16 + #17: the dead-link scan runs in the service worker.
//  - start a scan, close the popup → the run survives (reopen: progress UI)
//  - pause persists across popup close/reopen
//  - cancel discards the run everywhere (no blob, no cache)
//  - #17: the progress label is the bare done/total counter with the full
//    sentence on the title/aria-label
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const swTarget = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;
    const openPopup = async () => {
        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 600 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        return page;
    };
    // 30 bookmarks on a blackhole IP: probes hang until the 8s timeout, so
    // with concurrency 4 the scan outlives several popup open/close cycles.
    const seed = await openPopup();
    await seed.evaluate(() => new Promise(r => {
        const mk = (title, url) => new Promise(res => chrome.bookmarks.create({ title, url }, b => res(b.id)));
        (async () => {
            for (let i = 1; i <= 30; i++)
                await mk(`hang${i}`, `http://10.255.255.${i}/`);
            chrome.storage.local.set({
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1, donationKey: 30,
                activeView: 'tree'
            }, r);
        })();
    }));
    await sleep(300);
    await seed.close();

    const out = {};
    const state = page => page.evaluate(() => {
        const label = document.querySelector('#view-dead .dead-progress-label');
        return {
            startHint: !!document.querySelector('#view-dead .dead-start'),
            progress: !!document.querySelector('#view-dead progress.dead-progress'),
            label: label ? label.textContent : null,
            labelTitle: label ? label.getAttribute('title') : null,
            pausedTag: !!document.querySelector('#view-dead .dead-paused-tag'),
            pauseBtn: (document.querySelector('#view-dead .dead-pause') || {}).textContent || null
        };
    });
    const dismissDonation = page => page.evaluate(() => {
        const b = document.getElementById('donation');
        if (b && b.style.display !== 'none') {
            const l = document.getElementById('donation-later');
            if (l) l.click();
        }
    });

    // --- session A: start the scan, then close the popup mid-run -----------
    const a = await openPopup();
    await dismissDonation(a);
    await a.click('#view-tab-dead');
    await sleep(600);
    await a.click('#view-dead .dead-start');
    await sleep(2500); // SW: getTree → publish → first probes in flight
    out.a_afterStart = await state(a);
    fs.mkdirSync('/tmp/shots/diag', { recursive: true });
    await a.screenshot({ path: '/tmp/shots/diag/v4t4i-scanning.png' });
    await a.close(); // popup gone — the SW keeps the run alive
    await sleep(2000);

    // --- session B: the run is still there ----------------------------------
    const b = await openPopup();
    await dismissDonation(b);
    await b.click('#view-tab-dead');
    await sleep(800);
    out.b_reopen = await state(b);
    // pause it, then close again
    await b.click('#view-dead .dead-pause');
    await sleep(800);
    out.b_paused = await state(b);
    await b.screenshot({ path: '/tmp/shots/diag/v4t4i-paused.png' });
    await b.close();
    await sleep(1500);

    // --- session C: the paused state survived -------------------------------
    const c = await openPopup();
    await dismissDonation(c);
    await c.click('#view-tab-dead');
    await sleep(800);
    out.c_reopen = await state(c);
    // cancel discards the run
    await c.click('#view-dead .dead-cancel');
    await sleep(1200);
    out.c_cancelled = await state(c);
    await c.close();
    await sleep(1000);

    // --- session D: nothing left — no blob, no cache, the start hint is back
    const d = await openPopup();
    await dismissDonation(d);
    await d.click('#view-tab-dead');
    await sleep(800);
    out.d_reopen = await state(d);
    out.d_storage = await d.evaluate(() => new Promise(r =>
        chrome.storage.local.get(['vbmDeadScan', 'deadLastScan'], data => r({
            blob: 'vbmDeadScan' in data,
            cache: 'deadLastScan' in data
        }))));
    await d.close();

    // --- verdicts -------------------------------------------------------------
    const checks = {
        'A: scan UI up after start': out.a_afterStart.progress && !out.a_afterStart.startHint,
        'A: #17 label is the bare counter': /^\d+\/\d+$/.test(out.a_afterStart.label || ''),
        'A: #17 full sentence on the title': (out.a_afterStart.labelTitle || '').includes('Checking'),
        'B: run survived the popup close': out.b_reopen.progress && !out.b_reopen.startHint,
        'B: pause took (tag + Resume)': out.b_paused.pausedTag && out.b_paused.pauseBtn === 'Resume',
        'C: paused survived the close': out.c_reopen.pausedTag && out.c_reopen.pauseBtn === 'Resume',
        'C: cancel back to the start hint': out.c_cancelled.startHint && !out.c_cancelled.progress,
        'D: cancel persisted (start hint)': out.d_reopen.startHint && !out.d_reopen.progress,
        'D: blob + cache both gone': !out.d_storage.blob && !out.d_storage.cache
    };
    out.checks = checks;
    console.log(JSON.stringify(out, null, 2));
    console.log(Object.values(checks).every(Boolean) ? 'DIAG PASS' : 'DIAG FAIL');
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
