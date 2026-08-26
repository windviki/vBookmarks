// Geometry probe (staging hierarchy round): dumps the narrow (320px body)
// and wide (800px body) rects of the staging view's structural rows — group
// head vs member row vs loose row heights, the favicon/title x columns, the
// bucket/section/time heads and the trailing button axes. Feeds the
// hierarchy-indent decision for the workbench round.
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
        await page.setViewport({ width: 900, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__staging_geo__' });
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 3; i++) {
                const url = `http://127.0.0.1:9/geo/${i}`;
                const n = await create({ parentId: folder.id, title: `geo anchored ${i}`, url });
                items.push({ id: n.id, url, title: `geo anchored ${i}`, ts: now - i * 1000, group: 'g1' });
            }
            // a LOOSE bookmarked row (no group) — the alignment baseline
            const looseUrl = 'http://127.0.0.1:9/geo/loose';
            const looseNode = await create({ parentId: bar.id, title: 'geo loose', url: looseUrl });
            items.push({ id: looseNode.id, url: looseUrl, title: 'geo loose', ts: now, group: null });
            items.push({ id: null, url: 'http://127.0.0.1:9/geo/snap', title: 'geo snapshot', ts: now, group: null });
            const staging = {
                v: 1,
                items,
                groups: [{ id: 'g1', name: 'Geo Group', collapsed: false, createdAt: now - 5000, manual: true }],
                recentCollapsed: false,
                unfavCollapsed: false,
                lastSeenTs: now - 3600000
            };
            await new Promise(res => chrome.storage.local.set({ staging: JSON.stringify(staging), activeView: 'tree' }, res));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-recent');
        await sleep(900);

        const measure = width => page.evaluate(w => {
            document.body.style.width = w + 'px';
            const out = {};
            const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.left * 10) / 10, right: Math.round(b.right * 10) / 10, cx: Math.round((b.left + b.right / 1) * 5) / 10, y: Math.round(b.top * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 }; };
            const q = s => document.querySelector(s);
            const member = q('li.staging-member');
            const loose = q('#staging-items li.staging-row:not(.staging-member)');
            out.body = r(document.body);
            out.list = r(document.getElementById('staging-list'));
            out.groupHead = r(q('.staging-group-head'));
            out.groupGlyph = r(q('.staging-group-head .staging-group-folder'));
            out.groupTitle = r(q('.staging-group-head .staging-section-title'));
            out.groupPlace = r(q('.staging-group-head .staging-group-place'));
            out.memberLi = r(member);
            out.memberAnchor = r(member && member.querySelector('a'));
            out.memberFav = r(member && member.querySelector('.favicon-container'));
            out.memberTitle = r(member && member.querySelector('i'));
            out.memberStar = r(member && member.querySelector('.staging-star'));
            out.looseLi = r(loose);
            out.looseFav = r(loose && loose.querySelector('.favicon-container'));
            out.looseTitle = r(loose && loose.querySelector('i'));
            out.bucketHead = r(q('.staging-bucket-head'));
            out.bucketStar = r(q('.staging-bucket-head .staging-bucket-star'));
            out.bucketTitle = r(q('.staging-bucket-head .staging-section-title'));
            out.sectionHead = r(document.getElementById('recent-head'));
            out.sectionTitle = r(q('#recent-head .staging-section-title'));
            out.timeHead = r(q('.recent-group-head'));
            out.timeGlyph = r(q('.recent-group-head .recent-group-clock'));
            out.rowSubVisible = member ? getComputedStyle(member.querySelector('.row-sub')).display !== 'none' : null;
            // the three alignment laws, computed (law: member fav left ==
            // loose title left; head glyph center == member fav center; head
            // title left == member title left)
            const cx = el => { if (!el) return null; const b = el.getBoundingClientRect(); return Math.round((b.left + b.right) / 2 * 10) / 10; };
            out.laws = {
                memberFavLeft_equals_looseTitleLeft: member && loose
                    ? [Math.round(member.querySelector('.favicon-container').getBoundingClientRect().left * 10) / 10,
                       Math.round(loose.querySelector('i').getBoundingClientRect().left * 10) / 10] : null,
                headGlyphCenter_equals_memberFavCenter: member && q('.staging-group-head .staging-group-folder')
                    ? [cx(q('.staging-group-head .staging-group-folder')), cx(member.querySelector('.favicon-container'))] : null,
                headTitleLeft_equals_memberTitleLeft: member && q('.staging-group-head .staging-section-title')
                    ? [Math.round(q('.staging-group-head .staging-section-title').getBoundingClientRect().left * 10) / 10,
                       Math.round(member.querySelector('i').getBoundingClientRect().left * 10) / 10] : null
            };
            return out;
        }, width);

        const narrow = await measure(320);
        await sleep(200);
        const wide = await measure(800);
        console.log('NARROW:', JSON.stringify(narrow, null, 1));
        console.log('WIDE:', JSON.stringify(wide, null, 1));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
