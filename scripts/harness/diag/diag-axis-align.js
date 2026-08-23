// Axis-law probe: staging tree-connector rendering + dupes member geometry
// aligned to the staging workbench axes.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    const results = [];
    const check = (name, cond, detail) => { results.push((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' [' + detail + ']' : '')); };
    try {
        await sleep(2000);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);

        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__axis__' });
            const now = Date.now();
            const items = [];
            const groups = [{ id: 'g1', name: 'G1', collapsed: false, createdAt: now, sourceFolderId: null, sourceTabGroup: null, manual: true }];
            for (let i = 0; i < 6; i++) {
                const bm = await create({ parentId: root.id, title: 'b' + i, url: 'https://ax.example/' + i });
                items.push({ id: bm.id, url: bm.url, title: 'b' + i, ts: now - i, group: i < 3 ? 'g1' : null });
            }
            items.push({ id: null, url: 'https://axh.example/h', title: 'hist', ts: now, group: null });
            // dupes: 1 url x 4 copies
            for (let c = 0; c < 4; c++)
                await create({ parentId: root.id, title: 'dup' + c, url: 'https://dupe.example/p' });
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups, recentCollapsed: false, unfavCollapsed: false, headCollapsed: false, recentGroupCollapsed: {}, lastSeenTs: 0 })
            }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // --- staging measurements ----------------------------------------
        await page.click('#view-tab-recent');
        await sleep(1200);
        const stg = await page.evaluate(() => {
            const cx = el => { const r = el.getBoundingClientRect(); return +(r.left + r.width / 2).toFixed(1); };
            const listLeft = document.getElementById('staging-list').getBoundingClientRect().left;
            const rel = v => +(v - listLeft).toFixed(1);
            const loose = document.querySelector('#staging-items li.staging-row:not(.staging-member) img, #staging-items li.staging-row:not(.staging-member) svg.vbm-icon-doc');
            const members = document.querySelectorAll('#staging-items li.staging-member img, #staging-items li.staging-member svg.vbm-icon-doc');
            const conn = document.querySelector('#staging-items li.staging-member .staging-connector');
            const connRect = conn ? conn.getBoundingClientRect() : null;
            const lastLi = document.querySelector('#staging-items li.staging-member.staging-last');
            const headLi = document.querySelector('#staging-items li.staging-group.has-members');
            const headAfter = headLi ? getComputedStyle(headLi, '::after') : null;
            return {
                looseIconCx: loose ? rel(cx(loose)) : null,
                memberIconCx: members.length ? rel(cx(members[0])) : null,
                connLeft: connRect ? rel(connRect.left) : null,
                connWidth: connRect ? +connRect.width.toFixed(1) : null,
                hasLast: !!lastLi,
                headAfterContent: headAfter ? headAfter.content : null,
                headAfterBg: headAfter ? headAfter.backgroundImage : null
            };
        });
        check('staging loose icon center ~26px', stg.looseIconCx !== null && Math.abs(stg.looseIconCx - 26) <= 1.5, JSON.stringify(stg.looseIconCx));
        check('staging member icon center ~50px', stg.memberIconCx !== null && Math.abs(stg.memberIconCx - 50) <= 1.5, JSON.stringify(stg.memberIconCx));
        check('connector trunk at 15.5px + 24.5px tick run', stg.connLeft !== null && Math.abs(stg.connLeft - 15.5) <= 0.5 && Math.abs(stg.connWidth - 24.5) <= 0.5, JSON.stringify({ left: stg.connLeft, w: stg.connWidth }));
        check('last member carries staging-last', stg.hasLast);
        check('group head draws its trunk half (dashed bg)', stg.headAfterContent === '""' || stg.headAfterContent === "''" || stg.headAfterBg !== 'none', JSON.stringify(stg.headAfterContent));

        // --- dupes measurements -------------------------------------------
        await page.click('#view-tab-dupes');
        await sleep(1500);
        const dup = await page.evaluate(() => {
            const cx = el => { const r = el.getBoundingClientRect(); return +(r.left + r.width / 2).toFixed(1); };
            const listLeft = document.getElementById('dupes-list').getBoundingClientRect().left;
            const rel = v => +(v - listLeft).toFixed(1);
            const member = document.querySelector('#dupes-list li.dupes-member');
            const radio = member && member.querySelector('.keeper-radio');
            const icon = member && member.querySelector('img, svg.vbm-icon-doc');
            const headTitle = document.querySelector('#dupes-list .dupes-group .dupes-key');
            return {
                radioCx: radio ? rel(cx(radio)) : null,
                iconCx: icon ? rel(cx(icon)) : null,
                headTitleLeft: headTitle ? rel(headTitle.getBoundingClientRect().left) : null
            };
        });
        check('dupes keeper-radio center ~26px (staging loose icon center)', dup.radioCx !== null && Math.abs(dup.radioCx - 26) <= 1.5, JSON.stringify(dup.radioCx));
        check('dupes member icon center ~50px (staging member icon center)', dup.iconCx !== null && Math.abs(dup.iconCx - 50) <= 1.5, JSON.stringify(dup.iconCx));

        console.log(results.join('\n'));
        console.log('SUMMARY', results.filter(r => r.startsWith('FAIL')).length + ' fail / ' + results.length);
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
