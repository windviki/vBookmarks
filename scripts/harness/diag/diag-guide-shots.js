// Regenerates the two 4.1.0-stale guide screenshots:
//   tmp/shots/tabs-themes.png  — the 7-view tab strip with live badges
//   tmp/shots/view-recent.png  — the staging workbench (guide §3.3 walkthrough)
// Seeds the same bookmark data the guide text describes (工作区/稍后读 folders,
// dead links, dupes, visit stats, a staging group + dual-state rows), silences
// the donation/what's-new asks, then captures the popup at 400x640.
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
    try {
        await sleep(2000);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const work = await create({ parentId: bar.id, title: '工作区' });
            const read = await create({ parentId: bar.id, title: '稍后读' });
            const ref = await create({ parentId: work.id, title: '开发参考' });
            const github = await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
            const linear = await create({ parentId: work.id, title: 'Linear — Issues', url: 'https://linear.app/vBookmarks/issues' });
            const figma = await create({ parentId: work.id, title: 'Figma — Design System', url: 'https://www.figma.com/files/design-system' });
            const so = await create({ parentId: read.id, title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/tagged/chrome-extension' });
            const old = await create({ parentId: read.id, title: 'GitHub (old)', url: 'https://github.com/windviki/neat-bookmarks' });
            const dead1 = await create({ parentId: read.id, title: 'Dead Link (example)', url: 'https://example.invalid/dead-page' });
            const dead2 = await create({ parentId: read.id, title: 'Bogus host', url: 'https://thishost.does.not.exist.example/' });
            // Dupe group → dupes badge 1
            for (let c = 0; c < 4; c++)
                await create({ parentId: read.id, title: 'Stack Overflow (copy ' + c + ')', url: so.url });

            const now = Date.now();
            // Staging workbench: one manual group (3 bookmarked members), two
            // loose bookmarked rows, one unbookmarked history item → badge 6
            const items = [
                { id: github.id, url: github.url, title: github.title, ts: now - 60000, group: 'g1' },
                { id: linear.id, url: linear.url, title: linear.title, ts: now - 120000, group: 'g1' },
                { id: figma.id, url: figma.url, title: figma.title, ts: now - 180000, group: 'g1' },
                { id: so.id, url: so.url, title: so.title, ts: now - 240000, group: null },
                { id: old.id, url: old.url, title: old.title, ts: now - 300000, group: null },
                { id: null, url: 'https://hist.example/x', title: '未收藏历史条目', ts: now - 1000, group: null }
            ];
            const groups = [{ id: 'g1', name: '工作台分组', collapsed: false, createdAt: now, sourceFolderId: null, sourceTabGroup: null, manual: true }];
            // Recently-added list below the fold: 今天 2 / 本周 1 / 本月 1 / 更早 1
            for (let i = 0; i < 5; i++)
                await create({ parentId: bar.id, title: '最近 ' + i, url: 'https://shotr.example/' + i });
            // Visit stats on three 工作区 bookmarks → stats badge 3
            const visitStats = {};
            for (const id of [github.id, linear.id, figma.id])
                visitStats[id] = { c: 3 + (id === github.id ? 4 : 0), t: now };
            // Dead scan results for the two dead rows → dead badge 2
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups, recentCollapsed: false, unfavCollapsed: false, headCollapsed: false, recentGroupCollapsed: {}, lastSeenTs: 0 }),
                visitStats: JSON.stringify(visitStats),
                deadLastScan: JSON.stringify({
                    ts: now - 3600e3,
                    scannedCount: 8,
                    results: {
                        [dead1.id]: { status: 'dead', code: 404 },
                        [dead2.id]: { status: 'dead', code: 0, error: 'ERR_NAME_NOT_RESOLVED' }
                    }
                }),
                // Silence the donation ask + the 4.x→4.1.0 what's-new banner
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1,
                donationKey: 30
            }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1800);
        // Expand the Bookmarks bar so the seeded folders show, and cycle every
        // view once — activation re-runs updateBadges with hydrated data, so
        // the tab badges (staging 6 / stats 3 / dead 2 / dupes 1) are live.
        await page.evaluate(() => {
            // The tree fold toggle listens for clicks on the row's
            // .tree-item-span (a <b> twisty is not a click target).
            const barRow = document.querySelector('#tree ul li');
            const span = barRow && barRow.querySelector('.tree-item-span');
            console.log('DBG twisty:', !!span, barRow && barRow.className);
            if (span) span.click();
        });
        await sleep(600);
        console.log('DBG tree after:', await page.evaluate(() => {
            const li = document.querySelector('#tree ul li');
            return li ? li.outerHTML.slice(0, 300) : 'no li';
        }));
        console.log('DBG badges:', await page.evaluate(() =>
            [...document.querySelectorAll('.tab-badge')].map(b => `${b.hidden ? 'h' : 'v'}:${b.textContent}`).join(',')));
        for (const tab of ['search', 'tabgroups', 'recent', 'stats', 'dead', 'dupes', 'tree']) {
            await page.click('#view-tab-' + tab).catch(() => {});
            await sleep(450);
        }
        console.log('DBG badges after cycle:', await page.evaluate(() =>
            [...document.querySelectorAll('.tab-badge')].map(b => `${b.hidden ? 'h' : 'v'}:${b.textContent}`).join(',')));
        await sleep(600);
        if (!fs.existsSync('/tmp/shots')) fs.mkdirSync('/tmp/shots', { recursive: true });
        await page.screenshot({ path: '/tmp/shots/tabs-themes.png' });
        await page.click('#view-tab-recent');
        await sleep(1800);
        await page.screenshot({ path: '/tmp/shots/view-recent.png' });
        console.log('guide shots saved');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
