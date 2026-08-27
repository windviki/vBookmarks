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
        let pageErrors = 0;
        page.on('pageerror', e => { pageErrors++; console.log('PAGEERROR:', e.message); });
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        const seeded = await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__staging_verify__' });
            const target = await create({ parentId: bar.id, title: '__staging_shortcut_target__' });
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
                stagingShortcuts: JSON.stringify([{ id: 'sc1', folderId: target.id, alias: 'Tools', color: 'blue' }]),
                activeView: 'tree'
            }, res));
            return { items: items.length, folder: folder.id, target: target.id };
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
            // the bucket tail's RIGHTMOST glyph is 移除暂存 (remove-all) since
            // it joined the tail — fav-all is one stride left of the axis
            const bucketRemove = document.querySelector('.staging-bucket-head .staging-bucket-remove-all');
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
            out.bucketRemove = rect(bucketRemove);
            // the three send glyphs of the recent region (row / time
            // bucket head / section head) — the one-axis check. Each
            // button's own rect is paired with its host row's rect so
            // the vertical check measures the CENTER OFFSET, not the
            // stacked rows' differing page y.
            const rowStageEl = document.querySelector('#recent-list li .staging-add-btn');
            const groupStageEl = document.querySelector('.recent-group-head .recent-group-stage');
            const stageAllEl = document.querySelector('#recent-head .recent-stage-all');
            out.rowStage = rect(rowStageEl);
            // the button shares the ANCHOR's flex line (the li also
            // carries the wrapped time-bucket head line above it); the
            // li rect is the row-HEIGHT contract (28px like the heads)
            out.rowStageHost = rowStageEl ? rect(rowStageEl.closest('li').querySelector('a')) : null;
            out.rowStageLi = rowStageEl ? rect(rowStageEl.closest('li')) : null;
            // a STAGING row li (no wrapped time head) is the height contract
            out.stagingRowLi = rect(document.querySelector('#staging-items li.staging-row'));
            out.groupStage = rect(groupStageEl);
            out.groupStageHost = groupStageEl ? rect(groupStageEl.closest('.recent-group-head')) : null;
            out.stageAll = rect(stageAllEl);
            out.stageAllHost = rect(stageAllEl ? stageAllEl.closest('#recent-head') : null);
            out.groupPlaceVisible = groupPlace ? getComputedStyle(groupPlace).visibility : null;
            const selectBtn = document.querySelector('.staging-select-mode');
            const newGroupBtn = document.querySelector('.staging-new-group');
            out.selectBtn = rect(selectBtn);
            out.newGroupBtn = rect(newGroupBtn);
            out.summaryRight = (() => {
                const el = document.querySelector('.staging-summary');
                return el ? el.getBoundingClientRect().right : null;
            })();
            const listRect = document.getElementById('staging-list').getBoundingClientRect();
            out.listRight = listRect.right;
            out.listLeft = listRect.left;
            // group-head lead (round G hierarchy): the chevron spans 18–34px
            // so its CENTER (26px) stacks on the loose row's favicon center —
            // the fold heads' 18px inline lead, not the old 8px section-head one
            out.groupChevLeft = firstGroupHead.querySelector('.chevron').getBoundingClientRect().left;
            // hierarchy: the member favicon column == the head's LEADING
            // GLYPH (folder icon on the group head, star on the bucket) at
            // 40px — the title sits one slot further right (64px)
            out.groupGlyph = rect(firstGroupHead.querySelector('.staging-group-folder') ||
                firstGroupHead.querySelector('.staging-section-title'));
            // 2026-08-25 vertical-axis probes: every head glyph's y-CENTER vs
            // its title — the span's line box AND the text's ink box (a
            // Range around the text node; the eye compares glyph center to
            // INK center, and a line box can center differently) — plus the
            // cross-row stack against the member/loose rows' favicons.
            const inkRect = el => {
                if (!el || !el.firstChild) return null;
                const rng = document.createRange();
                rng.selectNodeContents(el);
                const r = rng.getBoundingClientRect();
                return { top: r.top, bottom: r.bottom, cy: r.top + r.height / 2, left: r.left, h: r.height };
            };
            out.chevGlyph = rect(firstGroupHead.querySelector('.chevron'));
            out.bucketStar = rect(document.querySelector('.staging-bucket-head .staging-bucket-star'));
            out.clockGlyph = rect(document.querySelector('.recent-group-head .recent-group-clock'));
            out.groupTitle = rect(firstGroupHead.querySelector('.staging-section-title'));
            out.groupTitleInk = inkRect(firstGroupHead.querySelector('.staging-section-title'));
            out.bucketTitle = rect(document.querySelector('.staging-bucket-head .staging-section-title'));
            out.clockTitle = rect(document.querySelector('.recent-group-head .staging-section-title'));
            out.bucketTitleInk = inkRect(document.querySelector('.staging-bucket-head .staging-section-title'));
            out.clockTitleInk = inkRect(document.querySelector('.recent-group-head .staging-section-title'));
            const memberLi0 = document.querySelector('li.staging-member');
            const looseLi0 = [...document.querySelectorAll('#staging-items li.staging-row')].find(li => !li.classList.contains('staging-member'));
            out.memberFav = memberLi0 ? rect(memberLi0.querySelector('.favicon-container')) : null;
            out.looseFav = looseLi0 ? rect(looseLi0.querySelector('.favicon-container')) : null;
            out.looseTitle = looseLi0 ? rect(looseLi0.querySelector('a i')) : null;
            // head quick tail: [rename][place][dissolve][remove 移出暂存];
            // narrow container keeps place/remove only
            out.groupRename = rect(groupRename);
            out.groupDissolve = rect(document.querySelector('.staging-group-head .staging-group-dissolve'));
            out.groupRemove = rect(document.querySelector('.staging-group-head .staging-group-remove'));
            const visibleNow = el => !!(el && el.getClientRects && el.getClientRects().length);
            out.renameVisible = visibleNow(groupRename);
            out.dissolveVisible = visibleNow(document.querySelector('.staging-group-head .staging-group-dissolve'));
            out.placeVisible = visibleNow(groupPlace);
            out.removeVisible = visibleNow(document.querySelector('.staging-group-head .staging-group-remove'));
            // scissors divider + iconified action rung + time-head lead
            out.cut = !!document.querySelector('#staging-list .staging-cut');
            out.actionIcons = document.querySelectorAll('.staging-actions-toolbar .staging-icon-btn').length;
            out.timeHeadLeft = (() => {
                // the fold head's LEADING GLYPH column (40px = 18 lead +
                // 16 chevron + 2 margin + 4 gap) — the clock on the time
                // buckets, the folder on the staging groups, the star on the
                // inbox bucket, all stacking on the member favicon column
                const el = document.querySelector('.recent-group-clock') ||
                    document.querySelector('.recent-group-head .staging-section-title');
                return el ? el.getBoundingClientRect().left : null;
            })();
            // member indent: a member row's favicon x vs a loose row's favicon x
            const favX = li => li && li.querySelector('.favicon-container')
                ? li.querySelector('.favicon-container').getBoundingClientRect().left : null;
            out.memberFavX = favX(document.querySelector('li.staging-member'));
            out.looseFavX = favX([...document.querySelectorAll('#staging-items li.staging-row')].find(li => !li.classList.contains('staging-member')));
            out.looseTitleX = (() => {
                const li = [...document.querySelectorAll('#staging-items li.staging-row')].find(x => !x.classList.contains('staging-member'));
                const i = li && li.querySelector('a i');
                return i ? i.getBoundingClientRect().left : null;
            })();
            out.bucketStarX = (() => {
                const el = document.querySelector('.staging-bucket-star');
                return el ? el.getBoundingClientRect().left : null;
            })();
            out.manualEmptyHead = !!document.querySelector('li.staging-group[data-group-id="g3"]');
            out.guideBanner = !!document.querySelector('.staging-guide-banner');
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
        // the axis law binds each tail's RIGHTMOST button (row remove /
        // head 移出暂存 / bucket 移除暂存) to the same 8px-off-edge column
        const rightAxis = [css.rowBtn, css.groupRemove, css.bucketRemove]
            .every(r => r && Math.abs(r.right - css.rowBtn.right) < 1.5);
        ck('trailing buttons share one right axis', rightAxis);
        // vertical centers each within own row middle ±1.5px (rename/
        // dissolve are display:none at this narrow width — skip them)
        const vCenter = (btn, row) => btn && row && Math.abs(btn.cy - (row.top + row.h / 2)) < 1.5;
        ck('group quick buttons vertically centered', vCenter(css.groupPlace, css.groupHead) && vCenter(css.groupRemove, css.groupHead));
        ck('bucket fav-all vertically centered', vCenter(css.bucketFav, css.bucketHead));
        ck('select-mode right-aligned inside the toolbar (8px inset)', css.selectBtn && Math.abs(css.selectBtn.right - (css.listRight - 8)) < 1.5);
        ck('summary stays left of the action cluster', css.summaryRight < css.newGroupBtn.left);
        // TREE-LAW restack (2026-08-26): level-0 grid [chevron @8..24][icon
        // well @24..44][title @48]; members indent so their favicon LEFT
        // edge lands on the head title axis (the TREE_INDENT child law).
        ck('member rows sit one 24px level under loose rows (favicon step)',
            css.memberFavX !== null && css.looseFavX !== null &&
            Math.abs(css.memberFavX - css.looseFavX - 24) < 1.5);
        ck('member favicon left edge == head title axis (tree child law)',
            css.memberFavX !== null && css.groupTitle && Math.abs(css.memberFavX - css.groupTitle.left) < 1.5);
        ck('head leading glyph shares the level-0 icon column with loose favicons',
            css.groupGlyph && css.looseFavX !== null && Math.abs(css.groupGlyph.left - css.looseFavX) < 1.5);
        ck('head title left-aligns with the loose row title (level-0 text axis)',
            css.groupTitle && css.looseTitle && Math.abs(css.groupTitle.left - css.looseTitle.left) < 1.5);
        // one optical y-axis per head: chevron/folder/star/clock centers vs
        // the title's LINE-BOX center, and the title's INK center too
        ck('head glyphs share one optical y-axis with their titles (line box)',
            css.chevGlyph && css.groupGlyph && css.bucketStar && css.clockGlyph &&
            css.groupTitle && css.bucketTitle && css.clockTitle &&
            Math.abs(css.chevGlyph.cy - css.groupTitle.cy) < 1.5 &&
            Math.abs(css.groupGlyph.cy - css.groupTitle.cy) < 1.5 &&
            Math.abs(css.bucketStar.cy - css.bucketTitle.cy) < 1.5 &&
            Math.abs(css.clockGlyph.cy - css.clockTitle.cy) < 1.5);
        ck('head glyph centers stack on the title INK center (optical axis)',
            css.groupGlyph && css.groupTitleInk && css.bucketTitleInk && css.clockTitleInk &&
            Math.abs(css.groupGlyph.cy - css.groupTitleInk.cy) < 1.5 &&
            Math.abs(css.bucketStar.cy - css.bucketTitleInk.cy) < 1.5 &&
            Math.abs(css.clockGlyph.cy - css.clockTitleInk.cy) < 1.5);
        // cross-row y-CENTERS are one row apart by construction (adjacent
        // rows) — the vertical stack law is EQUAL HEIGHTS, checked narrow
        // above and wide below.
        ck('narrow rows are the same 28px height as the heads',
            css.stagingRowLi && Math.abs(css.stagingRowLi.h - 28) < 1.5);
        ck('manual empty group renders its head', css.manualEmptyHead);
        ck('group head chevron starts at the 8px fold lead (flush like the tree twisty)', css.groupChevLeft !== null && Math.abs(css.groupChevLeft - css.listLeft - 8) < 1.5);
        ck('group quick tail always visible (tabgroups law)', css.groupPlaceVisible === 'visible');
        // ≤400px container (this probe runs at 320px body): the group-
        // specific pair hides, the row-shared place/delete stay
        ck('narrow quick tail = place + remove (rename/dissolve folded into menu/F2)',
            css.placeVisible && css.removeVisible && !css.renameVisible && !css.dissolveVisible);
        ck('移出暂存 is the rightmost head button (删除分组 stays in the menu)',
            css.groupRemove && Math.abs(css.groupRemove.right - (css.listRight - 8)) < 1.5);
        ck('scissors divider separates the recent region', css.cut);
        ck('guide strip renders above the toolbar', css.guideBanner);
        ck('time-bucket head glyph starts on the 24px level-0 icon column',
            css.timeHeadLeft !== null && Math.abs(css.timeHeadLeft - (css.listLeft + 24)) < 1.5);
        // the three same send buttons of the recent region: ONE right
        // axis (all end 8px off the list edge) and ONE vertical-center
        // OFFSET (each centers in its own --vbm-row-h host row — the
        // "three vertical positions" complaint)
        const sendRights = [css.rowStage, css.groupStage, css.stageAll].filter(Boolean);
        ck('row/bucket/section send buttons share one right axis',
            sendRights.length === 3 && sendRights.every(r => Math.abs(r.right - (css.listRight - 8)) < 1.5));
        ck('row/bucket/section send buttons share one vertical-center offset',
            vCenter(css.rowStage, css.rowStageHost) &&
            vCenter(css.groupStage, css.groupStageHost) &&
            vCenter(css.stageAll, css.stageAllHost));

        // --- guide strip: 不再提醒 dismisses it for good -----------------
        await page.evaluate(() => document.querySelector('.staging-guide-dismiss').click());
        await sleep(300);
        ck('guide strip: 不再提醒 dismisses the banner',
            await page.evaluate(() => !document.querySelector('.staging-guide-banner')));

        // --- 1b. selection-mode checkbox axis -----------------------------
        const selGeo = await page.evaluate(() => {
            document.querySelector('.staging-select-mode').click();
            return new Promise(r => setTimeout(() => {
                const list = document.getElementById('staging-list').getBoundingClientRect();
                const boxLeft = el => el ? parseFloat(getComputedStyle(el, '::before').width) && el.getBoundingClientRect().left + 8 : null;
                const row = [...document.querySelectorAll('#staging-items li.staging-row')];
                const member = row.find(li => li.classList.contains('staging-member'));
                const loose = row.find(li => !li.classList.contains('staging-member'));
                const groupHead = document.querySelector('#staging-items li.staging-group .staging-group-head');
                const bucketHead = document.querySelector('#staging-items li.staging-bucket .staging-bucket-head');
                const favX = li => li && li.querySelector('.favicon-container')
                    ? li.querySelector('.favicon-container').getBoundingClientRect().left : null;
                // hierarchy probes: a GROUP member (anchored/0 ∈ g1) must
                // hang under the group head's title, a BUCKET member
                // (snap/2, ungrouped unbookmarked) under the bucket's star
                const g1member = document.querySelector('li.staging-row[data-url="http://127.0.0.1:9/anchored/0"]');
                const bucketMember = document.querySelector('li.staging-row[data-url="http://127.0.0.1:9/snap/2"]');
                const groupGlyph = document.querySelector('li.staging-group .staging-group-folder') ||
                    document.querySelector('li.staging-group .staging-section-title');
                const bucketStar = document.querySelector('li.staging-bucket .staging-bucket-star');
                r({
                    listLeft: list.left,
                    memberCheck: boxLeft(member),
                    looseCheck: boxLeft(loose),
                    groupCheck: boxLeft(groupHead),
                    bucketCheck: boxLeft(bucketHead),
                    memberFavX: favX(member),
                    looseFavX: favX(loose),
                    g1FavX: favX(g1member),
                    groupGlyphX: groupGlyph ? groupGlyph.getBoundingClientRect().left : null,
                    bucketFavX: favX(bucketMember),
                    bucketStarX: bucketStar ? bucketStar.getBoundingClientRect().left : null,
                    actionIcons: document.querySelectorAll('.staging-actions-toolbar .staging-icon-btn').length,
                    shortcutChips: document.querySelectorAll('.staging-shortcuts-toolbar .staging-shortcut').length,
                    shortcutAdd: !!document.querySelector('.staging-shortcuts-toolbar .staging-shortcut-add'),
                    shortcutEditModeBtn: !!document.querySelector('.staging-shortcuts-toolbar .staging-shortcut-edit-mode'),
                    perChipBtns: document.querySelectorAll('.staging-shortcut-item .row-btn').length,
                    labelDisplay: (() => { const el = document.querySelector('.staging-shortcuts-label'); return el ? getComputedStyle(el).display : null; })()
                });
            }, 300));
        });
        console.log('selGeo:', JSON.stringify(selGeo));
        const checkAxis = selGeo.listLeft + 8;
        ck('selection checkboxes share one 8px axis (row/head/bucket)',
            [selGeo.memberCheck, selGeo.looseCheck, selGeo.groupCheck, selGeo.bucketCheck]
                .every(x => x !== null && Math.abs(x - checkAxis) < 1.5));
        ck('selection member content hangs under its head glyph (group folder / bucket star)',
            selGeo.g1FavX !== null && selGeo.groupGlyphX !== null &&
            Math.abs(selGeo.g1FavX - selGeo.groupGlyphX) < 1.5 &&
            selGeo.bucketFavX !== null && selGeo.bucketStarX !== null &&
            Math.abs(selGeo.bucketFavX - selGeo.bucketStarX) < 1.5);
        ck('selection member content keeps the 24px level step off the loose baseline (same tree-law step as normal mode)',
            selGeo.g1FavX !== null && selGeo.looseFavX !== null &&
            Math.abs((selGeo.g1FavX - selGeo.looseFavX) - 24) < 1.5);
        ck('selection action rung is iconified (9 glyph buttons)', selGeo.actionIcons === 9);
        ck('move-to shortcut rung renders chip + icon-only add + edit-mode toggle',
            selGeo.shortcutChips === 1 && selGeo.shortcutAdd && selGeo.shortcutEditModeBtn);
        ck('shortcut chips carry NO per-chip buttons in normal mode', selGeo.perChipBtns === 0);
        ck('shortcut label hidden at 320px (narrow)', selGeo.labelDisplay === 'none');
        // MOVE-TO shortcut: select a row, click the chip, the item must
        // leave staging and land in the target folder (move semantics;
        // the runtime's bookmarks.move runs for real here)
        await page.evaluate(() => document.querySelector('li.staging-row[data-url="http://127.0.0.1:9/anchored/1"]').click());
        await sleep(250);
        const preMove = await page.evaluate(() => ({
            sel: document.querySelectorAll('#staging-items li.sel').length,
            chip: !!document.querySelector('.staging-shortcut')
        }));
        await page.evaluate(() => document.querySelector('.staging-shortcut').click());
        await sleep(900);
        const shortcutAfter = await page.evaluate(() => new Promise(res => chrome.storage.local.get('staging', d => {
            const s = JSON.parse(d.staging);
            res({ left: s.items.some(i => i.url === 'http://127.0.0.1:9/anchored/1'), items: s.items.length });
        })));
        console.log('shortcutMove:', JSON.stringify({ preMove, ...shortcutAfter }));
        ck('row selected before the shortcut click', preMove.sel >= 1 && preMove.chip);
        ck('shortcut click MOVES the selected item out of staging (move-only semantics)', shortcutAfter.left === false);
        // --- shortcut edit mode: pencil toggle flips the bar, chips get
        // the dashed edit look + the floating delete ×, and clicking a
        // chip opens the editor dialog (Esc closes it) ---
        await page.evaluate(() => document.querySelector('.staging-shortcut-edit-mode').click());
        await sleep(250);
        const editGeo = await page.evaluate(() => ({
            editing: !!document.querySelector('.staging-shortcuts-toolbar.editing'),
            del: !!document.querySelector('.staging-shortcut-del'),
            dashed: (() => { const el = document.querySelector('.staging-shortcut'); return el ? getComputedStyle(el).borderStyle : null; })(),
            delRect: (() => { const el = document.querySelector('.staging-shortcut-del'); const r = el.getBoundingClientRect(); return { left: r.left, w: r.width, transform: getComputedStyle(el).transform }; })(),
            dotRect: (() => { const el = document.querySelector('.staging-shortcut .tab-group-dot'); const r = el.getBoundingClientRect(); return { left: r.left, w: r.width }; })(),
            chipRect: (() => { const el = document.querySelector('.staging-shortcut'); const r = el.getBoundingClientRect(); return { left: r.left }; })()
        }));
        console.log('editGeo:', JSON.stringify(editGeo));
        ck('edit-mode toggle: bar flips, delete × appears, chips turn dashed',
            editGeo.editing && editGeo.del && editGeo.dashed === 'dashed');
        ck('edit-mode delete × centers on (covers) the color dot',
            editGeo.delRect && editGeo.dotRect &&
            Math.abs((editGeo.delRect.left + editGeo.delRect.w / 2) - (editGeo.dotRect.left + editGeo.dotRect.w / 2)) < 1.5);
        await page.evaluate(() => document.querySelector('.staging-shortcut').click());
        await sleep(300);
        const dialogOpen = await page.evaluate(() =>
            !!document.querySelector('#staging-shortcut-dialog') &&
            document.body.classList.contains('needStagingShortcut'));
        ck('edit mode: clicking a chip opens the shortcut editor dialog', dialogOpen);
        await page.keyboard.press('Escape');
        await sleep(250);
        await page.evaluate(() => document.querySelector('.staging-shortcut-edit-mode').click());
        await sleep(200);
        // --- width-aware action labels: at 800px the DANGER pair gains
        // text first (progressive, not all-or-nothing); restore 320 ---
        await page.evaluate(() => { document.body.style.width = '800px'; });
        await sleep(250);
        const wide = await page.evaluate(() => ({
            containerW: document.getElementById('container').getBoundingClientRect().width,
            delW: document.querySelector('.staging-delete').getBoundingClientRect().width,
            delLabel: getComputedStyle(document.querySelector('.staging-delete .staging-btn-label')).display,
            openLabel: getComputedStyle(document.querySelector('.staging-open .staging-btn-label')).display,
            barLabel: getComputedStyle(document.querySelector('.staging-shortcuts-label')).display
        }));
        // wide (two-line) vertical axis: the fold head stands exactly as
        // tall as the two-line member rows, and its glyph + title ink stay
        // vertically centered in the taller row
        const wideV = await page.evaluate(() => {
            const r = el => {
                if (!el) return null;
                const b = el.getBoundingClientRect();
                return { top: b.top, cy: b.top + b.height / 2, h: b.height, left: b.left };
            };
            const head = document.querySelector('.staging-group-head');
            const row = document.querySelector('#staging-items li.staging-row');
            const glyph = head ? head.querySelector('.staging-group-folder') : null;
            const titleEl = head ? head.querySelector('.staging-section-title') : null;
            let ink = null;
            if (titleEl && titleEl.firstChild) {
                const rng = document.createRange();
                rng.selectNodeContents(titleEl);
                const b = rng.getBoundingClientRect();
                ink = { top: b.top, cy: b.top + b.height / 2, h: b.height };
            }
            const chev = head ? head.querySelector('.chevron') : null;
            return { head: r(head), row: r(row), glyph: r(glyph), chev: r(chev), ink,
                sub: row ? getComputedStyle(row.querySelector('.row-sub')).display : null };
        });
        console.log('wideV:', JSON.stringify(wideV));
        await page.evaluate(() => { document.body.style.width = ''; });
        await sleep(200);
        ck('width-aware: danger delete shows icon+text at 800px (progressive)',
            wide.delW > 22 && wide.delLabel !== 'none');
        ck('width-aware: lower-priority open stays icon-only at 800px', wide.openLabel === 'none');
        ck('shortcut label appears at 800px', wide.barLabel !== 'none');
        ck('wide: fold head height equals the two-line member row height',
            wideV.head && wideV.row && wideV.sub === 'block' &&
            Math.abs(wideV.head.h - wideV.row.h) < 1.5);
        ck('wide: head glyph/chevron/title-ink vertically centered in the taller head',
            wideV.head && wideV.glyph && wideV.chev && wideV.ink &&
            Math.abs(wideV.glyph.cy - wideV.head.cy) < 1.5 &&
            Math.abs(wideV.chev.cy - wideV.head.cy) < 1.5 &&
            Math.abs(wideV.ink.cy - wideV.head.cy) < 1.5);
        // open-as-tab-group through the icon rung: the urls-only call
        // path must send without a pageerror (the old pickGroupColor
        // crash read as a popup error toast). The runtime message is
        // stubbed here — the probe checks the POPUP-side path, not the
        // real tab open (which would flip the headless target away).
        await page.evaluate(() => document.querySelector('li.staging-row[data-url="http://127.0.0.1:9/anchored/2"]').click());
        await sleep(200);
        const errsBefore = pageErrors;
        await page.evaluate(() => {
            window.__vbmRealSend = chrome.runtime.sendMessage;
            chrome.runtime.sendMessage = (msg, cb) => { if (cb) cb(); };
        });
        await page.evaluate(() => document.querySelector('.staging-open-group').click());
        await sleep(300);
        await page.evaluate(() => { chrome.runtime.sendMessage = window.__vbmRealSend; });
        ck('open-as-tab-group icon runs the urls-only path without errors', pageErrors === errsBefore);
        await page.evaluate(() => document.querySelector('.staging-select-exit').click());
        await sleep(300);

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
