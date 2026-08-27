// Hierarchy probe: dump the exact rendered X axes (left/right edges of
// chevron / leading glyph / favicon / title) for the staging workbench,
// the recent region and the tabgroups view, at two widths. Ground truth
// for the tree-law realignment round.
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
        await sleep(2000);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);

        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const read = await create({ parentId: bar.id, title: '稍后读' });
            const dead1 = await create({ parentId: read.id, title: 'Dead Link', url: 'https://example.invalid/d1' });
            const now = Date.now();
            const items = [
                { id: null, url: 'https://loose.example/x', title: 'Loose Row', ts: now, group: null },
                { id: null, url: 'https://member.example/1', title: 'Member One', ts: now, group: 'g1' },
                { id: null, url: 'https://member.example/2', title: 'Member Two', ts: now, group: 'g1' }
            ];
            // A recently-closed group record for the closed-section grid
            const closed = [{
                id: 'cg_1', color: 'blue', title: '已关闭分组', savedAt: now - 60e3,
                tabs: [
                    { url: 'https://closed.example/1', title: 'Closed Tab 1' },
                    { url: 'https://closed.example/2', title: 'Closed Tab 2' }
                ]
            }];
            await new Promise(res => chrome.storage.local.set({
                tabGroupsClosed: JSON.stringify(closed),
                staging: JSON.stringify({ v: 1, items, groups: [{ id: 'g1', name: '工作分组', collapsed: false, createdAt: now, sourceFolderId: null, sourceTabGroup: null, manual: true }], recentCollapsed: false, unfavCollapsed: false, headCollapsed: false, recentGroupCollapsed: {}, lastSeenTs: 0 }),
                searchHistoryEnabled: '1',
                deadLastScan: JSON.stringify({ ts: now - 3600e3, scannedCount: 3, results: { [dead1.id]: { status: 'dead', code: 404 } } }),
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1,
                donationKey: 30
            }, res));
        });
        // A real Chrome tab group for the dot-column measurement
        await page.evaluate(async () => {
            const tabs = await new Promise(res => chrome.tabs.query({ currentWindow: true }, res));
            const two = tabs.filter(t => !t.pinned).slice(0, 2).map(t => t.id);
            const gid = await new Promise(res => chrome.tabs.group({ tabIds: two }, res));
            await new Promise(res => chrome.tabGroups.update(gid, { title: '测试组', color: 'red' }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1800);

        const dump = sel => page.evaluate(async sel => {
            const pick = (label, root, parts) => {
                if (!root) return { [label]: 'ABSENT' };
                const out = { label };
                for (const p of parts) {
                    const el = typeof p === 'string' ? root.querySelector(p) : null;
                    if (!el) { out[p] = '-'; continue; }
                    const r = el.getBoundingClientRect();
                    out[p] = `${Math.round(r.left)}..${Math.round(r.right)}`;
                }
                return out;
            };
            const res = [];
            // staging group head
            const gh = document.querySelector('#staging-items li.staging-group.has-members > .staging-group-head') ||
                       document.querySelector('.staging-group-head');
            res.push(pick('groupHead', gh && gh.closest('li'), ['.chevron', '.staging-group-folder', '.staging-section-title']));
            // bucket head
            const bh = document.querySelector('.staging-bucket-head');
            res.push(pick('bucketHead', bh && bh.closest('li'), ['.chevron', '.staging-bucket-star', '.staging-section-title']));
            // member row
            const mem = document.querySelector('#staging-items li.vbm-row.staging-member > a.tree-item-link');
            if (mem) {
                const r = mem.getBoundingClientRect();
                res.push({ label: 'memberRow', li: `${Math.round(r.left)}..`, favicon: (() => { const f = mem.querySelector('.favicon-container'); return f ? `${Math.round(f.getBoundingClientRect().left)}..${Math.round(f.getBoundingClientRect().right)}` : '-'; })(), title: (() => { const t = mem.querySelector('i'); return t ? `${Math.round(t.getBoundingClientRect().left)}..` : '-'; })() });
            }
            // loose row
            const loose = [...document.querySelectorAll('#staging-items li.vbm-row:not(.staging-member) > a.tree-item-link')][0];
            if (loose) {
                const r = loose.getBoundingClientRect();
                const f = loose.querySelector('.favicon-container');
                const t = loose.querySelector('i');
                res.push({ label: 'looseRow', a: `${Math.round(r.left)}..`, favicon: f ? `${Math.round(f.getBoundingClientRect().left)}..${Math.round(f.getBoundingClientRect().right)}` : '-', title: t ? `${Math.round(t.getBoundingClientRect().left)}..` : '-' });
            }
            // recent region: bucket head + member
            const rg = document.querySelector('.recent-group-head');
            res.push(pick('recentGroupHead', rg && rg.closest('li'), ['.chevron', '.recent-group-clock', '.staging-section-title']));
            const rmem = document.querySelector('#recent-list li.vbm-row > a.tree-item-link');
            if (rmem) {
                const f = rmem.querySelector('.favicon-container');
                const t = rmem.querySelector('i');
                res.push({ label: 'recentRow', favicon: f ? `${Math.round(f.getBoundingClientRect().left)}..${Math.round(f.getBoundingClientRect().right)}` : '-', title: t ? `${Math.round(t.getBoundingClientRect().left)}..` : '-' });
            }
            // big section heads
            const sm = document.getElementById('staging-head');
            if (sm) {
                const c = sm.querySelector('.chevron'), t = sm.querySelector('.staging-section-title');
                const rc = c ? c.getBoundingClientRect() : null, rt = t ? t.getBoundingClientRect() : null;
                res.push({ label: 'stagingHeadMain', chevron: rc ? `${Math.round(rc.left)}..${Math.round(rc.right)}` : '-', title: rt ? `${Math.round(rt.left)}..` : '-' });
            }
            return res;
        }, sel);

        for (const w of [420, 900]) {
            await page.setViewport({ width: w, height: 800 });
            await sleep(500);
            // staging/recent
            await page.click('#view-tab-recent').catch(() => {});
            await sleep(800);
            console.log(`W=${w} STAGING+RECENT ${JSON.stringify(await dump())}`);
            await page.screenshot({ path: `/tmp/shots/hier-${w}-staging.png` });
            // tabgroups
            await page.click('#view-tab-tabgroups').catch(() => {});
            await sleep(900);
            const tg = await page.evaluate(async () => {
                const out = [];
                const wh = document.querySelector('.tabgroups-window-head-row');
                if (wh) {
                    const c = wh.querySelector('.chevron');
                    const em = wh.querySelector('em');
                    out.push({ label: 'windowHead', chevron: c ? `${Math.round(c.getBoundingClientRect().left)}..${Math.round(c.getBoundingClientRect().right)}` : '-', title: em ? Math.round(em.getBoundingClientRect().left) : '-' });
                }
                const grp = document.querySelector('.tabgroups-group-head');
                if (grp) {
                    const parts = {};
                    for (const [k, s] of [['chevron', '.chevron'], ['dot', '.tab-group-dot'], ['title', '.tabgroups-group-title']]) {
                        const el = grp.querySelector(s);
                        if (el) { const r = el.getBoundingClientRect(); parts[k] = `${Math.round(r.left)}..${Math.round(r.right)}`; }
                    }
                    out.push({ label: 'groupHead', parts });
                }
                const favs = [...document.querySelectorAll('#tabgroups-list li.tabgroups-row .favicon-container')].filter(el => el.getClientRects().length).slice(0, 3);
                out.push({ label: 'tabFavicons', xs: favs.map(f => `${Math.round(f.getBoundingClientRect().left)}..${Math.round(f.getBoundingClientRect().right)}`) });
                const ch = document.querySelector('.tabgroups-closed-head');
                if (ch) {
                    const d = ch.querySelector('.tab-group-dot');
                    const t = ch.querySelector('.tabgroups-group-title');
                    const dr = d ? d.getBoundingClientRect() : null;
                    out.push({ label: 'closedGroupHead', dot: dr ? `${Math.round(dr.left)}..${Math.round(dr.right)}` : '-', title: t ? Math.round(t.getBoundingClientRect().left) : '-' });
                }
                const cm = document.querySelector('li.tabgroups-closed-tab.tabgroups-closed-member > a.tree-item-link .favicon-container');
                if (cm) {
                    const r = cm.getBoundingClientRect();
                    out.push({ label: 'closedMemberFav', xs: `${Math.round(r.left)}..${Math.round(r.right)}` });
                }
                const cs = document.querySelector('li.tabgroups-closed-tab:not(.tabgroups-closed-member) > a.tree-item-link .favicon-container');
                if (cs) {
                    const r = cs.getBoundingClientRect();
                    out.push({ label: 'closedStandaloneFav', xs: `${Math.round(r.left)}..${Math.round(r.right)}` });
                }
                // expand the closed group and measure its members
                if (ch) {
                    ch.click();
                    await new Promise(r2 => setTimeout(r2, 400));
                    const cmx = [...document.querySelectorAll('li.tabgroups-closed-tab.tabgroups-closed-member > a.tree-item-link .favicon-container')].filter(el => el.getClientRects().length).map(el => `${Math.round(el.getBoundingClientRect().left)}..${Math.round(el.getBoundingClientRect().right)}`);
                    out.push({ label: 'closedMemberFavs', xs: cmx });
                }
                return out;
            });
            console.log(`W=${w} TABGROUPS ${JSON.stringify(tg)}`);
            // selection-mode pass: dot / favicons / trunk on one axis?
            await page.evaluate(() => { const b = document.querySelector('.tabgroups-select-mode'); if (b) b.click(); });
            await sleep(700);
            const sel = await page.evaluate(() => {
                const vis = el => !!(el && el.getClientRects().length);
                const r = el => { const b = el.getBoundingClientRect(); return `${Math.round(b.left)}..${Math.round(b.right)}`; };
                const dot = document.querySelector('ul.selecting .tabgroups-group-head .tab-group-dot');
                const uFav = [...document.querySelectorAll('ul.selecting li.tabgroups-row:not(.grouped) .favicon-container')].find(vis);
                const gFav = [...document.querySelectorAll('ul.selecting li.tabgroups-row.grouped .favicon-container')].find(vis);
                const conn = [...document.querySelectorAll('ul.selecting li.tabgroups-row.grouped > .tg-connector')].find(vis);
                const chev = document.querySelector('ul.selecting .tabgroups-group-head .chevron');
                return {
                    dot: dot ? r(dot) : null,
                    chevronHidden: chev ? getComputedStyle(chev).display === 'none' : null,
                    ungroupedFav: uFav ? r(uFav) : null,
                    groupedFav: gFav ? r(gFav) : null,
                    trunkLeft: conn ? Math.round(parseFloat(getComputedStyle(conn).left) * 10) / 10 : null
                };
            });
            console.log(`W=${w} TG-SELECT ${JSON.stringify(sel)}`);
            await page.evaluate(() => { const b = document.querySelector('.tabgroups-select-mode'); if (b) b.click(); });
            await sleep(500);
            await page.screenshot({ path: `/tmp/shots/hier-${w}-tabgroups.png` });
        }
        // computed-style chain for one member row and one loose row
        await page.click('#view-tab-recent').catch(() => {});
        await sleep(700);
        const cs = await page.evaluate(() => {
            const info = el => {
                if (!el) return null;
                const c = getComputedStyle(el);
                return { pls: c.paddingInlineStart || c.paddingLeft, mis: c.marginInlineStart || c.marginLeft, rectL: Math.round(el.getBoundingClientRect().left) };
            };
            const mem = document.querySelector('#staging-items li.vbm-row.staging-member');
            const memA = mem && mem.querySelector('a');
            const memFav = memA && memA.querySelector('.favicon-container');
            const loose = document.querySelector('#staging-items li.vbm-row:not(.staging-member)');
            const looseA = loose && loose.querySelector('a');
            const ul = document.getElementById('staging-items');
            const listUl = document.getElementById('staging-list');
            return {
                stagingListUl: info(listUl), itemsUl: info(ul),
                memberLi: info(mem), memberA: info(memA), memberFav: info(memFav),
                looseLi: info(loose), looseA: info(looseA)
            };
        });
        console.log('CHAIN ' + JSON.stringify(cs));
        const html = await page.evaluate(() => {
            const mem = document.querySelector('#staging-items li.vbm-row.staging-member');
            return {
                memPrefix: mem ? mem.innerHTML.slice(0, 400) : null,
                memCS: mem ? (() => { const c = getComputedStyle(mem.querySelector('a')); return { disp: c.display, gap: c.gap, padL: c.paddingLeft, marL: c.marginLeft }; })() : null,
                favCS: (() => { const f = mem && mem.querySelector('.favicon-container'); if (!f) return null; const c = getComputedStyle(f); return { w: c.width, ml: c.marginLeft, mr: c.marginRight, pos: c.position }; })()
            };
        });
        console.log('HTMLDUMP ' + JSON.stringify(html));
        // panel-mode twin: force the wide two-line form
        await page.setViewport({ width: 900, height: 800 });
        await page.click('#view-tab-recent').catch(() => {});
        await sleep(500);
        await page.evaluate(() => { document.body.classList.add('panel-mode'); window.dispatchEvent(new Event('resize')); });
        await sleep(700);
        console.log('PANEL STAGING ' + JSON.stringify(await dump()));
        await page.screenshot({ path: '/tmp/shots/hier-panel-staging.png' });
        console.log('done');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
