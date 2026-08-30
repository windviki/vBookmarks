// one-off: staging selection-mode GROUP connector — the maintainer reports
// the dashed HORIZONTAL line (the tick from trunk to member favicon) draws
// wrong. Measure the full geometry (checkbox / head well / trunk / tick /
// favicon) on a real grouped member row and zoom-screenshot it.
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
        await sleep(2500);
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__verify__' });
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 4; i++) {
                const url = `http://127.0.0.1:9/verify/${i}`;
                const n = await create({ parentId: folder.id, title: `verify ${i}`, url });
                items.push({ id: n.id, url, title: `verify ${i}`, ts: now - i * 1000, group: i < 2 ? 'g1' : null });
            }
            items.push({ id: null, url: 'http://127.0.0.1:9/loose/1', title: 'loose 1', ts: now, group: null });
            const staging = {
                v: 1,
                items,
                groups: [{ id: 'g1', name: 'Group One', collapsed: false, createdAt: now - 5000 }],
                recentCollapsed: false,
                unfavCollapsed: false,
                lastSeenTs: now - 3600000
            };
            await new Promise(res => chrome.storage.local.set({ staging: JSON.stringify(staging) }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('[role="tab"]')].find(t => (t.id || '').includes('recent'));
            if (tab) tab.click();
        });
        await sleep(900);
        await page.evaluate(() => {
            const btn = document.querySelector('.staging-select-mode');
            if (btn) btn.click();
        });
        await sleep(700);

        const m = await page.evaluate(() => {
            const r = el => {
                if (!el) return null;
                const b = el.getBoundingClientRect();
                return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), t: +b.top.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
            };
            const group = document.querySelector('li.staging-group');
            if (!group) return { err: 'no group' };
            // g1's own members: the .staging-member siblings FOLLOWING the group li
            const members = [];
            for (let n = group.nextElementSibling; n; n = n.nextElementSibling) {
                if (!n.classList.contains('staging-member'))
                    break;
                members.push(n);
            }
            const member = members[0];
            if (!member) return { err: 'group has no following members', domOrder: [...document.querySelectorAll('#staging-items > li')].map(li => li.className).slice(0, 12) };
            const cb = member.querySelector('input, [class*=check]');
            const anchor = member.querySelector('a.tree-item-link');
            const fav = member.querySelector('.favicon-container');
            const conn = member.querySelector(':scope > .staging-connector');
            const headWell = group.querySelector('.staging-group-folder');
            const headCb = group.querySelector('input, [class*=check]');
            const cs = conn ? getComputedStyle(conn, '::after') : null;
            const csB = conn ? getComputedStyle(conn, '::before') : null;
            const groupTrunk = getComputedStyle(group, '::after');
            return {
                domOrder: [...document.querySelectorAll('#staging-items > li')].map(li => li.className.replace('vbm-row ', '').trim()).slice(0, 12),
                group: r(group), headWell: r(headWell), headCb: r(headCb),
                member: r(member), cb: r(cb), anchor: r(anchor), fav: r(fav), conn: r(conn),
                tick: cs ? { left: cs.left, width: cs.width, top: cs.top, height: cs.height } : null,
                trunk: csB ? { left: csB.left, width: csB.width } : null,
                groupTrunk: { left: groupTrunk.left, top: groupTrunk.top, bottom: groupTrunk.bottom, width: groupTrunk.width, content: groupTrunk.content },
                memberHtml: member.innerHTML.replace(/\s+/g, ' ').slice(0, 220)
            };
        });
        console.log(JSON.stringify(m, null, 1));
        fs.mkdirSync('/tmp/shots', { recursive: true });
        // focused analysis: wide + selecting, exact rects + tight crop
        fs.mkdirSync('/tmp/shots', { recursive: true });
        await page.evaluate(() => { document.getElementById('container').style.width = '560px'; });
        await sleep(600);
        const info = await page.evaluate(() => {
            const r = el => { const b = el.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), h: +b.height.toFixed(1) }; };
            const group = document.querySelector('li.staging-group');
            const members = [];
            for (let n = group.nextElementSibling; n; n = n.nextElementSibling) {
                if (!n.classList.contains('staging-member')) break;
                members.push(n);
            }
            const m0 = members[0];
            const conn = m0.querySelector(':scope > .staging-connector');
            const fav = m0.querySelector('.favicon-container');
            return {
                group: r(group), m0: r(m0), m1: r(members[1] || members[0]),
                conn: r(conn), fav: r(fav),
                connLeft: getComputedStyle(conn).left, connW: getComputedStyle(conn).width,
                tickAfter: (() => { const c = getComputedStyle(conn, '::after'); return { left: c.left, width: c.width, top: c.top }; })(),
                trunkBefore: (() => { const c = getComputedStyle(conn, '::before'); return { left: c.left, width: c.width, top: c.top, bottom: c.bottom }; })(),
                headWell: r(group.querySelector('.staging-group-folder')),
                headTitle: r(group.querySelector('.staging-group-title, .staging-head-title, .head-title') || group.querySelector('i, b, span:last-child')),
                m0tags: [...m0.children].map(c => c.tagName + '.' + (c.className || ''))
            };
        });
        console.log('[wide-select rects]', JSON.stringify(info, null, 1));
        await page.evaluate(() => {
            document.getElementById('staging-list').style.setProperty('--stg-line', 'rgba(0,0,0,.95)');
        });
        await sleep(200);
        await page.setViewport({ width: 620, height: 640, deviceScaleFactor: 8 });
        await sleep(600);
        const g8 = await page.evaluate(() => document.querySelector('li.staging-group').getBoundingClientRect());
        await page.screenshot({
            path: '/tmp/shots/stg-wide-select-8x.png',
            clip: { x: Math.max(0, g8.left), y: Math.max(0, g8.top - 2), width: 110, height: 100 }
        });
        console.log('[crop]', JSON.stringify({ x: Math.max(0, g8.left), y: Math.max(0, g8.top - 2) }));

    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
