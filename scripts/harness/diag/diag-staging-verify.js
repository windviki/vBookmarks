// Verification probe (staging workbench round): loads the popup with a
// seeded staging state (groups incl. a manual empty one + members + bucket +
// recent region), then checks in a REAL browser:
//   1. CSS contract — collapsed chevron shows ONE glyph (no ▸/border-icon
//      overlap), heads are fixed-height rows, the trailing buttons share one
//      right axis and center vertically, member rows indent, the toolbar's
//      action cluster right-aligns.
//   2. DnD — synthetic dragstart/dragover/drop with a real DataTransfer moves
//      a row into a group (staging storage reflects it; no bookmark writes).
//   3. Group reorder drag — group head onto group head reorders.
//   4. Entry churn — switching to the view now produces ~1 render worth of
//      DOM mutations (echo guard + single refresh), not a re-render storm.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext'
        ]
    });
    try {
        await sleep(2000);
        const targets = await browser.targets();
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(swTarget.url()).hostname;
        console.log('extension id:', extId);
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        const seeded = await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__staging_verify__' });
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 4; i++) {
                const url = `http://127.0.0.1:9/anchored/${i}`;
                const n = await create({ parentId: folder.id, title: `anchored ${i}`, url });
                items.push({ id: n.id, url, title: `anchored ${i}`, ts: now - i * 1000, group: i < 2 ? 'g1' : null });
            }
            items.push({ id: null, url: 'http://127.0.0.1:9/snap/1', title: 'snapshot 1', ts: now, group: 'g2' });
            items.push({ id: null, url: 'http://127.0.0.1:9/snap/2', title: 'snapshot 2', ts: now, group: null });
            const staging = {
                v: 1,
                items,
                groups: [
                    { id: 'g1', name: 'Group One', collapsed: false, createdAt: now - 5000 },
                    { id: 'g2', name: 'Group Two', collapsed: false, createdAt: now - 4000 },
                    { id: 'g3', name: 'Manual Empty', collapsed: false, createdAt: now - 3000, manual: true }
                ],
                recentCollapsed: false,
                unfavCollapsed: false,
                lastSeenTs: now - 3600000
            };
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify(staging),
                activeView: 'tree'
            }, res));
            return { items: items.length };
        });
        console.log('seeded:', JSON.stringify(seeded));
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-recent');
        await sleep(900);

        // --- 1. CSS contract ------------------------------------------------
        const css = await page.evaluate(() => {
            const out = {};
            const collapseGroup = head => {
                head.click();
                return new Promise(r => setTimeout(r, 150));
            };
            const firstGroupHead = document.querySelector('.staging-group-head');
            const bucketHead = document.querySelector('.staging-bucket-head');
            const sectionHead = document.getElementById('recent-head');
            const rowBtn = document.querySelector('#staging-items li.staging-row .staging-remove') ||
                document.querySelector('#staging-items li.staging-row .staging-star');
            const groupPlace = document.querySelector('.staging-group-head .staging-group-place');
            const groupRename = document.querySelector('.staging-group-head .staging-group-rename');
            const bucketFav = document.querySelector('.staging-bucket-fav-all');
            const rect = el => {
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom, cy: r.top + r.height / 2, right: r.right, left: r.left, h: r.height };
            };
            out.groupHead = rect(firstGroupHead);
            out.bucketHead = rect(bucketHead);
            out.sectionHead = rect(sectionHead);
            out.rowBtn = rect(rowBtn);
            out.groupPlace = rect(groupPlace);
            out.groupRename = rect(groupRename);
            out.bucketFav = rect(bucketFav);
            const selectBtn = document.querySelector('.staging-select-mode');
            const newGroupBtn = document.querySelector('.staging-new-group');
            out.selectBtn = rect(selectBtn);
            out.newGroupBtn = rect(newGroupBtn);
            out.summaryRight = (() => {
                const el = document.querySelector('.staging-summary');
                return el ? el.getBoundingClientRect().right : null;
            })();
            out.listRight = document.getElementById('staging-list').getBoundingClientRect().right;
            // member indent: a member row's favicon x vs a loose row's favicon x
            const favX = li => li && li.querySelector('.favicon-container')
                ? li.querySelector('.favicon-container').getBoundingClientRect().left : null;
            out.memberFavX = favX(document.querySelector('li.staging-member'));
            out.looseFavX = favX([...document.querySelectorAll('#staging-items li.staging-row')].find(li => !li.classList.contains('staging-member')));
            out.manualEmptyHead = !!document.querySelector('li.staging-group[data-group-id="g3"]');
            // collapsed chevron: exactly one glyph source
            const cs = getComputedStyle(firstGroupHead.querySelector('.chevron'), '::before');
            out.chevronExpanded = getComputedStyle(firstGroupHead.querySelector('.chevron'), '::before').content;
            return out;
        });
        // collapse a group and inspect the chevron (post-collapse)
        const collapsedChevron = await page.evaluate(() => {
            document.querySelector('.staging-group-head').click();
            return new Promise(r => setTimeout(() => {
                // RE-QUERY: the innerHTML swap replaced the head node — the
                // pre-click reference is detached (computed ::before = '').
                const head = document.querySelector('.staging-group-head');
                const chev = head.querySelector('.chevron');
                r({
                    content: getComputedStyle(chev, '::before').content,
                    cls: chev.className,
                    aria: head.getAttribute('aria-expanded')
                });
            }, 200));
        });
        await page.evaluate(() => document.querySelector('.staging-group-head').click());
        await sleep(200);
        console.log('CSS:', JSON.stringify(css, null, 1));
        console.log('collapsedChevron:', JSON.stringify(collapsedChevron));

        const checks = [];
        const ck = (name, ok) => checks.push(`${ok ? 'PASS' : 'FAIL'} ${name}`);
        ck('collapsed chevron = single ▸ glyph (no overlap)', collapsedChevron.content.includes('▸'));
        ck('group head fixed height 28', Math.abs(css.groupHead.h - 28) < 1.5);
        ck('bucket head fixed height 28', Math.abs(css.bucketHead.h - 28) < 1.5);
        // the axis law binds each row's LAST trailing button (rename sits
        // left of place inside the group head's quick pair by design)
        const rightAxis = [css.rowBtn, css.groupPlace, css.bucketFav]
            .every(r => r && Math.abs(r.right - css.rowBtn.right) < 1.5);
        ck('trailing buttons share one right axis', rightAxis);
        // vertical centers each within own row middle ±1.5px
        const vCenter = (btn, row) => btn && row && Math.abs(btn.cy - (row.top + row.h / 2)) < 1.5;
        ck('group quick buttons vertically centered', vCenter(css.groupPlace, css.groupHead) && vCenter(css.groupRename, css.groupHead));
        ck('bucket fav-all vertically centered', vCenter(css.bucketFav, css.bucketHead));
        ck('select-mode right-aligned inside the toolbar (8px inset)', css.selectBtn && Math.abs(css.selectBtn.right - (css.listRight - 8)) < 1.5);
        ck('summary stays left of the action cluster', css.summaryRight < css.newGroupBtn.left);
        ck('member rows indent 16px', css.memberFavX !== null && css.looseFavX !== null && Math.abs(css.memberFavX - css.looseFavX - 16) < 1.5);
        ck('manual empty group renders its head', css.manualEmptyHead);

        // --- 2+3. DnD --------------------------------------------------------
        const dnd = await page.evaluate(() => {
            const dt = new DataTransfer();
            const row = [...document.querySelectorAll('#staging-items li.staging-row')]
                .find(li => li.dataset.url === 'http://127.0.0.1:9/snap/2');
            const g2Head = document.querySelector('li.staging-group[data-group-id="g2"] .staging-group-head');
            const fire = (el, type) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
            fire(row, 'dragstart');
            fire(g2Head, 'dragover');
            const overCls = g2Head.classList.contains('drag-over');
            fire(g2Head, 'drop');
            // group reorder: g3 (manual empty) before g1
            const dt2 = new DataTransfer();
            const g3Head = document.querySelector('li.staging-group[data-group-id="g3"] .staging-group-head');
            const g1Head = document.querySelector('li.staging-group[data-group-id="g1"] .staging-group-head');
            g3Head.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
            g1Head.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
            g1Head.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 }));
            return { overCls };
        });
        await sleep(400);
        const after = await page.evaluate(() => new Promise(res => chrome.storage.local.get('staging', d => {
            const s = JSON.parse(d.staging);
            res({
                snap2Group: s.items.find(i => i.url === 'http://127.0.0.1:9/snap/2').group,
                order: s.groups.map(g => g.id),
                manualFlag: s.groups.find(g => g.id === 'g3').manual
            });
        })));
        console.log('dnd:', JSON.stringify({ ...dnd, ...after }));
        ck('drop target highlighted during dragover', dnd.overCls);
        ck('row dropped into g2', after.snap2Group === 'g2');
        ck('group reorder g3 before g1', after.order[0] === 'g3' && after.order[1] === 'g1');
        ck('manual flag persisted', after.manualFlag === true);

        // --- 4. entry churn ---------------------------------------------------
        await page.click('#view-tab-tree');
        await sleep(400);
        const churn = await page.evaluate(() => new Promise(resolve => {
            const list = document.getElementById('staging-list');
            let n = 0;
            const obs = new MutationObserver(muts => {
                for (const m of muts)
                    n += (m.addedNodes ? m.addedNodes.length : 0) + (m.removedNodes ? m.removedNodes.length : 0);
            });
            obs.observe(list, { childList: true, subtree: true });
            document.getElementById('view-tab-recent').click();
            setTimeout(() => { obs.disconnect(); resolve({ mutations: n }); }, 2500);
        }));
        console.log('entry churn:', JSON.stringify(churn));
        ck('entry re-renders once (no echo/second render)', churn.mutations < 60);

        await page.evaluate(() => { try { } catch (_) {} });
        const fs = require('fs');
        fs.mkdirSync('/tmp/shots', { recursive: true });
        await page.screenshot({ path: '/tmp/shots/diag-staging-verify.png', fullPage: false });
        console.log(checks.join('\n'));
        const fails = checks.filter(c => c.startsWith('FAIL')).length;
        console.log(fails ? `${fails} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
    } finally {
        await browser.close();
    }
})().catch(e => {
    console.error('DIAG FAIL:', e.message);
    process.exit(1);
});
