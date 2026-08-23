// 折叠记忆轮 browser probe: staging head fold + persistence, recent
// time-bucket folds + persistence, guide × session dismiss, assign dialog
// visibility, width-aware 移出暂存 label.
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

        // seed staging + recent
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__foldmem__' });
            const now = Date.now();
            const items = [];
            const groups = [{ id: 'g1', name: 'G1', collapsed: false, createdAt: now, sourceFolderId: null, sourceTabGroup: null, manual: true }];
            for (let i = 0; i < 6; i++) {
                const bm = await create({ parentId: root.id, title: 'bm' + i, url: 'https://fm.example/' + i });
                items.push({ id: bm.id, url: bm.url, title: 'bm' + i, ts: now - i, group: i < 3 ? 'g1' : null });
            }
            // recent items across two time buckets
            const mkRecent = async (id, ageDays) => {
                const bm = await create({ parentId: root.id, title: 'r' + id, url: 'https://fmr.example/' + id });
                return { id: bm.id, url: bm.url, title: 'r' + id, dateAdded: now - ageDays * 86400000, parentId: root.id };
            };
            const recent = [await mkRecent(1, 0), await mkRecent(2, 0), await mkRecent(3, 40)];
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups, recentCollapsed: false, unfavCollapsed: false, headCollapsed: false, recentGroupCollapsed: {}, lastSeenTs: 0 }),
                fmRecent: JSON.stringify(recent)
            }, res));
            return true;
        });
        // make getRecent return our seeded rows: easier — inject via a small
        // override is not possible; instead rely on real getRecent of created
        // bookmarks (r1,r2 today bucket, r3 older bucket).
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-recent');
        await sleep(1200);

        const check = (name, cond) => { results.push((cond ? 'PASS ' : 'FAIL ') + name); };

        await page.evaluate(() => {
            const head = document.getElementById('staging-head');
            check0 = {
                headExists: !!head,
                headClass: head ? head.className : null,
                pill: head ? head.querySelector('.count-pill') !== null : false,
                newGroup: head ? !!head.querySelector('.staging-new-group') : false,
                selectMode: head ? !!head.querySelector('.staging-select-mode') : false,
                headTitle: head ? (head.querySelector('.staging-section-title') || {}).textContent : null,
                headFont: head ? getComputedStyle(head.querySelector('.staging-section-title')).fontWeight : null,
                headFontSize: head ? getComputedStyle(head.querySelector('.staging-section-title')).fontSize : null,
                recentHeadFont: (() => {
                    const rh = document.getElementById('recent-head');
                    const t = rh && rh.querySelector('.staging-section-title');
                    return t ? getComputedStyle(t).fontWeight + '/' + getComputedStyle(t).fontSize : null;
                })(),
                stagingRows: document.querySelectorAll('#staging-items li.vbm-row').length,
                recentGroupLis: document.querySelectorAll('li.recent-group-li').length,
                recentRows: document.querySelectorAll('#recent-list li.vbm-row').length,
                guide: !!document.querySelector('.staging-guide-banner'),
                guideClose: !!document.querySelector('.staging-guide-close')
            };
        });
        const info0 = await page.evaluate(() => check0);
        check('staging head exists with pill+buttons', info0.headExists && info0.pill && info0.newGroup && info0.selectMode);
        check('staging head title = 暂存区', /暂存区|Staging/i.test(info0.headTitle || ''));
        check('big head titles are 600 weight', info0.headFont === '600' && info0.recentHeadFont.indexOf('600') === 0);
        check('big head titles enlarged (>=14px)', parseFloat(info0.headFontSize) >= 14 && parseFloat(info0.recentHeadFont.split('/')[1]) >= 14);
        check('staging rows present', info0.stagingRows === 6);
        check('recent time-bucket heads present', info0.recentGroupLis >= 1);
        check('recent rows present', info0.recentRows >= 2);
        check('guide banner shows with × close', info0.guide && info0.guideClose);

        // guide × dismisses for the session
        await page.evaluate(() => document.querySelector('.staging-guide-close').click());
        await sleep(500);
        check('guide × hides the banner', await page.evaluate(() => !document.querySelector('.staging-guide-banner')));

        // staging head fold (instant: rows stay painted, hidden by class)
        await page.evaluate(() => document.getElementById('staging-head').click());
        await sleep(600);
        check('staging head folds all rows', await page.evaluate(() => {
            const list = document.getElementById('staging-list');
            const ul = document.getElementById('staging-items');
            return list.classList.contains('staging-area-collapsed') && getComputedStyle(ul).display === 'none';
        }));
        check('head survives the fold', await page.evaluate(() => !!document.getElementById('staging-head')));

        // recent bucket fold (first bucket head)
        await page.evaluate(() => {
            const li = document.querySelector('li.recent-group-li[data-recent-group="0"]');
            const span = li && li.querySelector('.recent-group-head');
            if (span) span.click();
        });
        await sleep(600);
        const bucketState = await page.evaluate(() => ({
            bucket0Rows: document.querySelectorAll('#recent-list li.vbm-row[data-recent-group="0"]').length,
            bucket1Rows: document.querySelectorAll('#recent-list li.vbm-row[data-recent-group="3"]').length
        }));
        check('today bucket folds its own rows', bucketState.bucket0Rows === 0 && await page.evaluate(() => !!document.querySelector('li.recent-group-li[data-recent-group="0"] .recent-group-head')));

        // persistence across reload
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-recent');
        await sleep(1200);
        const persisted = await page.evaluate(() => ({
            stagingRows: document.querySelectorAll('#staging-items li.vbm-row').length,
            bucket0Rows: document.querySelectorAll('#recent-list li.vbm-row[data-recent-group="0"]').length,
            bucket3Rows: document.querySelectorAll('#recent-list li.vbm-row[data-recent-group="3"]').length,
            areaHidden: document.getElementById('staging-list').classList.contains('staging-area-collapsed')
        }));
        check('staging head fold persists across reopen', persisted.stagingRows === 0 && persisted.areaHidden);
        check('today bucket fold persists across reopen', persisted.bucket0Rows === 0);

        // unfold the staging head again (first unfold after a folded-open:
        // the cached pieces drop in ONE innerHTML) — and TIME it
        const unfoldMs = await page.evaluate(() => {
            const t0 = performance.now();
            document.getElementById('staging-head').click();
            const t1 = performance.now();
            return new Promise(res => requestAnimationFrame(() => requestAnimationFrame(() => res({ sync: +(t1 - t0).toFixed(1), settled: +(performance.now() - t0).toFixed(1) }))));
        });
        console.log('UNFOLD-TIMING', JSON.stringify(unfoldMs));
        check('staging head unfold is instant (<60ms settled)', unfoldMs.settled < 60, JSON.stringify(unfoldMs));
        await sleep(600);
        // selection mode + assign dialog
        await page.evaluate(() => document.querySelector('.staging-select-mode').click());
        await sleep(600);
        check('selection mode entered', await page.evaluate(() => !!document.querySelector('.staging-actions-toolbar')));
        // select all then open the assign dialog
        await page.evaluate(() => document.querySelector('.staging-select-all').click());
        await sleep(400);
        await page.evaluate(() => document.querySelector('.staging-assign').click());
        await sleep(500);
        const dialog = await page.evaluate(() => {
            const d = document.getElementById('staging-group-assign-dialog');
            const cs = getComputedStyle(d);
            const r = d.getBoundingClientRect();
            return { bodyClass: document.body.className.indexOf('needStagingGroupAssign') !== -1, opacity: cs.opacity, visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' };
        });
        check('分组 dialog opens and is visible', dialog.bodyClass && dialog.opacity === '1' && dialog.visible);
        await page.evaluate(() => document.getElementById('staging-group-assign-cancel-button').click());
        await sleep(300);
        // wide container: 移出暂存 label shows at >=680
        await page.evaluate(() => document.querySelector('.staging-select-exit').click());
        await sleep(400);
        await page.setViewport({ width: 900, height: 620 });
        await sleep(800);
        // the popup body keeps its own stored width (auto-resize) — grow the
        // container directly so the @container tiers re-evaluate (this is
        // what a user's drag-resize does to #container).
        await page.evaluate(() => { document.getElementById('container').style.width = '900px'; });
        await sleep(500);
        // re-enter selection to see the rung2
        await page.evaluate(() => document.querySelector('.staging-select-mode').click());
        await sleep(500);
        const labelInfo = await page.evaluate(() => {
            const btn = document.querySelector('.staging-icon-btn.staging-remove');
            if (!btn) return null;
            const lab = btn.querySelector('.staging-btn-label');
            const cont = document.getElementById('container');
            return {
                disp: lab ? getComputedStyle(lab).display : null,
                text: lab ? lab.textContent : null,
                containerW: cont ? cont.getBoundingClientRect().width : null,
                innerW: window.innerWidth
            };
        });
        console.log('LABEL-INFO:', JSON.stringify(labelInfo));
        check('移出暂存 label visible at wide width', !!(labelInfo && labelInfo.disp !== 'none' && /移出暂存|Remove/i.test(labelInfo.text)));

        // icons: full-size glyph + bottom-right × (path count 3, no transform scale)
        const iconInfo = await page.evaluate(() => {
            const unfav = document.querySelector('.staging-icon-btn.staging-unfav svg');
            const rem = document.querySelector('.staging-icon-btn.staging-remove svg');
            const g = s => ({ paths: s.querySelectorAll('path').length, hasTransform: !!s.querySelector('g[transform]') });
            return { unfav: g(unfav), remove: g(rem) };
        });
        check('unfav icon = star + 2 × arms, no shrink transform', iconInfo.unfav.paths === 3 && !iconInfo.unfav.hasTransform);
        if (!(iconInfo.unfav.paths === 3)) console.log('UNFAV-SVG:', JSON.stringify(iconInfo));
        check('remove icon = plane + 2 × arms, no shrink transform', iconInfo.remove.paths === 3 && !iconInfo.remove.hasTransform);

        console.log(results.join('\n'));
        console.log('SUMMARY', results.filter(r => r.startsWith('FAIL')).length + ' fail / ' + results.length);
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });