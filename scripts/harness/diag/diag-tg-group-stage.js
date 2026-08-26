// Report round 4 probe: the tab-group head's 发送到暂存 button must land
// the whole group in a staging group NAMED after the tab group. The pre-fix
// code compared the DOM dataset STRING groupId against the populate NUMBER
// groupId with ===, so every send fell into the "no bookmarkable tabs"
// toast — this probe drives the real head button end-to-end.
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
        const targets = await browser.targets();
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(swTarget.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        // one extra window with 2 tabs; group them via the SW message so a
        // REAL tab group with a title exists
        const winIds = await page.evaluate(async () => {
            const mk = urls => new Promise(res => chrome.windows.create({ url: urls, focused: false }, w => res(w.id)));
            const a = await mk(['http://a.example/1', 'http://a.example/2']);
            const tabs = await new Promise(res => chrome.tabs.query({ windowId: a }, res));
            const groupId = await new Promise(res => chrome.tabs.group({ tabIds: tabs.map(t => t.id) }, res));
            await new Promise(res => chrome.tabGroups.update(groupId, { title: 'Probe Group' }, res));
            const popupWin = await new Promise(res => chrome.windows.getCurrent(res));
            return { a, popup: popupWin.id };
        });
        await page.click('#view-tab-tabgroups');
        await sleep(900);
        await page.click('.tabgroups-refresh');
        await sleep(900);

        // click the group head's 发送到暂存 button
        const clicked = await page.evaluate(() => {
            const btn = document.querySelector('.tabgroups-group-stage');
            if (!btn)
                return false;
            btn.click();
            return true;
        });
        console.log('CLICKED:', clicked);
        await sleep(1200);

        // 2026-08-26 report: the member rows' 发送到暂存 planes must flip
        // to the SOLID icon IMMEDIATELY (the pre-fix rows stayed hollow
        // until the next view entry re-rendered them).
        const flipCheck = await page.evaluate(() => {
            // ONLY the group's own member rows must flip (other windows'
            // rows stay hollow — they were not part of the send)
            const head = document.querySelector('li.tabgroups-group');
            const gid = head && head.dataset.groupId;
            const rows = gid
                ? [...document.querySelectorAll(`li.tabgroups-row[data-group-id="${gid}"] .tabgroups-stage`)]
                : [];
            return {
                rowCount: rows.length,
                allSolid: rows.length > 0 && rows.every(b => !!b.querySelector('svg.vbm-icon-stage-done')),
                headSolid: (() => {
                    const b = head && head.querySelector('.tabgroups-group-stage');
                    return b ? !!b.querySelector('svg.vbm-icon-stage-done') : null;
                })()
            };
        });
        console.log('FLIP:', JSON.stringify(flipCheck));

        const out = await page.evaluate(async () => {
            const stored = await new Promise(res => chrome.storage.local.get('staging', res));
            let s = null;
            try { s = JSON.parse(stored.staging || '{}'); } catch (e) { return { parseError: e.message }; }
            return {
                groups: (s.groups || []).map(g => ({ id: g.id, name: g.name, sourceTabGroup: g.sourceTabGroup })),
                items: (s.items || []).map(i => ({ url: i.url, group: i.group }))
            };
        });
        console.log('STAGING:', JSON.stringify(out));

        const named = out.groups && out.groups.find(g => g.name === 'Probe Group');
        // match items to their group by id → name
        const groupById = {};
        for (const g of out.groups || []) groupById[g.id] = g;
        const pass2 = clicked && !!named && out.items.length === 2
            && out.items.every(i => (groupById[i.group] || {}).name === 'Probe Group')
            && flipCheck.rowCount === 2 && flipCheck.allSolid && flipCheck.headSolid === true;
        console.log(pass2 ? 'DIAG PASS' : 'DIAG FAIL');
        if (!pass2)
            process.exitCode = 1;
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
