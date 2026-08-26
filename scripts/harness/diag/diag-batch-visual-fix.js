// 2026-08-26 audit-round visual check, v2: seeds a real workbench, then
// verifies — ① staging toolbar cluster boxes (20px grid) + select-mode
// entry; ② the FULL-PAINT head-plane sync (staging holds every recent url
// → first paint already shows the solid recent-stage-all / bucket planes);
// ③ tabgroups empty state (muted/centered); ④ search selecting-bar closing
// border. View switching via the real #view-tab-* tab ids.
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    if (!fs.existsSync('/tmp/shots')) fs.mkdirSync('/tmp/shots', { recursive: true });
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
        const page = await browser.newPage();
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.setViewport({ width: 420, height: 820 });
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__shot__' });
            const now = Date.now();
            const items = [];
            const groups = [{ id: 'g1', name: '工作台分组', collapsed: false, createdAt: now, sourceFolderId: null, sourceTabGroup: null, manual: true }];
            for (let i = 0; i < 5; i++) {
                const bm = await create({ parentId: root.id, title: '示例书签 ' + i, url: 'https://shot.example/' + i });
                items.push({ id: bm.id, url: bm.url, title: bm.title, ts: now - i * 90000000, group: i < 3 ? 'g1' : null });
            }
            // the recent region's urls — staged here so the first paint's
            // sync must flip the bucket/region planes solid
            const recents = [];
            for (let i = 0; i < 4; i++) {
                const bm = await create({ parentId: root.id, title: '最近 ' + i, url: 'https://shotr.example/' + i });
                recents.push(bm);
                items.push({ id: bm.id, url: bm.url, title: bm.title, ts: now, group: null });
            }
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups, recentCollapsed: false, unfavCollapsed: false, headCollapsed: false, recentGroupCollapsed: {}, lastSeenTs: 0 })
            }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1800);
        await page.click('#view-tab-recent');
        await sleep(1500);

        // ① toolbar geometry + ② head planes on FIRST paint
        const g = await page.evaluate(() => {
            const box = el => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { w: Math.round(r.width), h: Math.round(r.height) };
            };
            const stageAll = document.querySelector('.recent-stage-all');
            const headBtn = document.querySelector('.recent-group-stage');
            return {
                shortcutAdd: box(document.querySelector('.staging-shortcut-add')),
                shortcutEdit: box(document.querySelector('.staging-shortcut-edit-mode')),
                selectModeEntry: box(document.querySelector('.staging-select-mode')),
                stageAllStaged: stageAll ? stageAll.classList.contains('staged') : null,
                stageAllIcon: stageAll ? stageAll.innerHTML.slice(0, 40) : null,
                bucketHeadStaged: headBtn ? headBtn.classList.contains('staged') : null,
                delInset: getComputedStyle(document.querySelector('.staging-shortcut-del') || document.body).left
            };
        });
        console.log('GEOM ' + JSON.stringify(g));
        await page.screenshot({ path: '/tmp/shots/fix-staging-toolbar.png' });

        // ③ tabgroups empty state
        await page.click('#view-tab-tabgroups');
        await sleep(1200);
        const empty = await page.evaluate(() => {
            const li = document.querySelector('#tabgroups-list ul li.empty-state, #tabgroups-list li.empty-state');
            if (!li) return { err: 'no empty-state li', html: document.getElementById('tabgroups-list').innerHTML.slice(0, 120) };
            const cs = getComputedStyle(li);
            return { text: li.textContent.trim().slice(0, 40), color: cs.color, align: cs.textAlign, pad: cs.padding };
        });
        console.log('TG-EMPTY ' + JSON.stringify(empty));
        await page.screenshot({ path: '/tmp/shots/fix-tabgroups-empty.png' });

        // ④ search selecting-bar closing border
        await page.click('#view-tab-search');
        await sleep(900);
        await page.evaluate(() => {
            const btn = document.querySelector('.search-select-mode');
            if (btn) btn.click();
        });
        await sleep(900);
        const border = await page.evaluate(() => {
            const rung2 = document.querySelector('.search-actions-toolbar');
            return rung2 ? { cls: rung2.className, bb: getComputedStyle(rung2).borderBottomWidth } : null;
        });
        console.log('SEARCH-RUNG ' + JSON.stringify(border));
        await page.screenshot({ path: '/tmp/shots/fix-search-selectbar.png' });
        console.log('done');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
