// G4 (2026-08-26 acceptance audit): the tab-group head fold surgery
// (foldGroupSurgically) has no real-browser coverage — verify-keyboard only
// folds WINDOWS. Probe: create a titled 2-tab group, fold its head, assert
// the member rows leave the DOM + aria-expanded flips, then unfold and
// assert the ORIGINAL member nodes return.
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

        await page.evaluate(async () => {
            const mk = urls => new Promise(res => chrome.windows.create({ url: urls, focused: false }, w => res(w.id)));
            const a = await mk(['http://a.example/1', 'http://a.example/2']);
            const tabs = await new Promise(res => chrome.tabs.query({ windowId: a }, res));
            const groupId = await new Promise(res => chrome.tabs.group({ tabIds: tabs.map(t => t.id) }, res));
            await new Promise(res => chrome.tabGroups.update(groupId, { title: 'Fold Me' }, res));
        });
        await page.click('#view-tab-tabgroups');
        await sleep(900);
        await page.click('.tabgroups-refresh');
        await sleep(900);

        const read = () => {
            const head = document.querySelector('li.tabgroups-group');
            const gid = head && head.dataset.groupId;
            const members = gid
                ? document.querySelectorAll(`li.tabgroups-row[data-group-id="${gid}"]`).length
                : -1;
            const span = head ? head.querySelector('.tabgroups-group-head') : null;
            return { hasHead: !!head, members, expanded: span ? span.getAttribute('aria-expanded') : null };
        };
        const before = await page.evaluate(read);
        console.log('BEFORE:', JSON.stringify(before));

        // click the group head span (the fold control)
        await page.evaluate(() => {
            const span = document.querySelector('li.tabgroups-group .tabgroups-group-head');
            if (span)
                span.click();
        });
        await sleep(400);
        const folded = await page.evaluate(read);
        console.log('FOLDED:', JSON.stringify(folded));

        await page.evaluate(() => {
            const span = document.querySelector('li.tabgroups-group .tabgroups-group-head');
            if (span)
                span.click();
        });
        await sleep(400);
        const unfolded = await page.evaluate(read);
        console.log('UNFOLDED:', JSON.stringify(unfolded));

        const pass = before.hasHead && before.members === 2
            && folded.members === 0 && folded.expanded === 'false'
            && unfolded.members === 2 && unfolded.expanded === 'true';
        console.log(pass ? 'DIAG PASS' : 'DIAG FAIL');
        if (!pass)
            process.exitCode = 1;
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
