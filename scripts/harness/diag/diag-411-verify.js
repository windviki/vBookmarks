// 4.1.1 issue-batch verification probe (real browser, hard assertions).
// Covers the three maintainer reports of 2026-08-29 afternoon plus the
// original #62/#64 acceptance items, view by view:
//   A. TREE rows: full-info tooltip (标题/URL/Path/Added) AND single-line
//      height (no path label slots — the "行撑高" regression).
//   B. TREE folder rows: title+path tooltip.
//   C. SEARCH bookmark rows: full-info tooltip + toolbar.
//   D. SEARCH all-folder hit: toolbar (count) survives, buttons drop.
//   E. TABGROUPS: a tab bookmarked in the tree hovers full info.
//   F. STAGING selection mode: no chevron on small heads, connector at the
//      icon-axis column (41.5px narrow).
//   G. OPTIONS page: the three new checkboxes exist with labels + defaults.
//   H. reverseItemPath end-to-end: meta line flips to nearest-first.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? ` — ${extra}` : ''));
    ok ? pass++ : fail++;
};

(async () => {
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
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);

        // ---- seed: __verify__ > ZZSubFolderZZ > Verify BM + a root-level bm + staging ----
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__verify__' });
            const sub = await create({ parentId: root.id, title: 'ZZSubFolderZZ' });
            await create({ parentId: sub.id, title: 'Verify BM', url: 'https://verify.example/page' });
            const now = Date.now();
            const items = [
                { id: null, url: 'https://verify.example/page', title: 'Verify BM', ts: now, group: 'g1' },
                { id: null, url: 'https://stg.example/x', title: 'Staged Item', ts: now - 5000, group: null }
            ];
            await new Promise(res => chrome.storage.local.set({
                staging: JSON.stringify({ v: 1, items, groups: [{ id: 'g1', name: 'Verify Group', collapsed: false, createdAt: now, manual: true }], recentCollapsed: false, unfavCollapsed: false, headCollapsed: false, recentGroupCollapsed: {}, lastSeenTs: 0 })
            }, res));
        });
        // a live tab whose URL IS the bookmark (tabgroups bookmarked-tab
        // case) — the sandbox has no network, so race the goto: the TAB
        // exists with the requested URL the moment navigation starts.
        const tab = await browser.newPage();
        await Promise.race([tab.goto('https://verify.example/page').catch(() => {}), sleep(4000)]);

        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // ---- expand the seeded chain (folders render COLLAPSED by default) ----
        const clickSpan = async name => {
            await page.evaluate(n => {
                const spans = [...document.querySelectorAll('#tree .tree-item-span')];
                const s = spans.find(x => x.textContent.trim().startsWith(n));
                if (s) s.click();
            }, name);
            await sleep(600);
        };
        // the seeded chain nests under the (collapsed) bookmarks-bar root
        await clickSpan('Bookmarks bar');
        await clickSpan('__verify__');
        await clickSpan('ZZSubFolderZZ');

        console.log('[step] A. tree rows');
        // evaluate-driven typing (puppeteer's click/type waits for element
        // stability — a popup mid-animation never settles in the sandbox)
        const setSearch = async q => {
            await page.evaluate(text => {
                const i = document.getElementById('search-input');
                i.focus();
                i.value = text;
                i.dispatchEvent(new Event('input', { bubbles: true }));
            }, q);
            await sleep(600);
        };

        // ---- A. tree bookmark row: tooltip + single-line height ----
        const treeRow = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('#tree li.child a')];
            const a = rows.find(r => r.textContent.trim() === 'Verify BM');
            if (!a) return null;
            return {
                title: a.getAttribute('title') || '',
                liH: a.closest('li').offsetHeight,
                hasLabelSlots: !!(a.querySelector('.row-path') || a.querySelector('.row-sub') || a.querySelector('.row-main'))
            };
        });
        if (!treeRow) {
            ck('A tree: Verify BM row exists', false);
        } else {
            const lines = treeRow.title.split('\n');
            ck('A1 tree tooltip line1 = 标题', lines[0] === 'Verify BM', JSON.stringify(lines));
            ck('A2 tree tooltip line2 = URL', lines[1] === 'https://verify.example/page');
            ck('A3 tree tooltip has labeled Path line w/ folder', lines.length > 2 && /: .*(ZZSubFolderZZ|__verify__)/.test(lines[2]), lines[2]);
            ck('A4 tree tooltip has labeled Added line', lines.length > 3 && /: \d/.test(lines[3]), lines[3]);
            ck('A5 tree row stays SINGLE-LINE (no 行撑高)', treeRow.liH <= 30 && !treeRow.hasLabelSlots, `liH=${treeRow.liH}`);
        }

        // ---- B. tree folder row tooltip ----
        const folderTip = await page.evaluate(() => {
            const spans = [...document.querySelectorAll('#tree .tree-item-span')];
            const s = spans.find(x => x.textContent.trim().startsWith('ZZSubFolderZZ'));
            return s ? (s.getAttribute('title') || '') : '';
        });
        ck('B tree folder tooltip = 标题 + Path line', /^ZZSubFolderZZ\n\S+: /.test(folderTip), JSON.stringify(folderTip.split('\n')));

        console.log('[step] C. search bookmark');
        // ---- C. search: bookmark row full tooltip + toolbar ----
        await setSearch('verify');
        const searchRow = await page.evaluate(() => {
            const a = document.querySelector('#results-ul li.vbm-row a.tree-item-link');
            return {
                title: a ? (a.getAttribute('title') || '') : '',
                toolbar: !!document.querySelector('#results .search-toolbar'),
                count: (document.querySelector('#results .search-result-count') || {}).textContent || ''
            };
        });
        const sl = searchRow.title.split('\n');
        ck('C1 search tooltip full info', sl[0] === 'Verify BM' && sl[1] === 'https://verify.example/page' && sl.length >= 4, JSON.stringify(sl));
        ck('C2 search toolbar exists', searchRow.toolbar, searchRow.count);

        console.log('[step] D. all-folder search');
        // ---- D. all-folder hit keeps the header ----
        await setSearch('zzsubfolder');
        const folderOnly = await page.evaluate(() => ({
            toolbar: !!document.querySelector('#results .search-toolbar'),
            count: (document.querySelector('#results .search-result-count') || {}).textContent || '',
            folders: document.querySelectorAll('#results .link-folder').length,
            selectBtn: !!document.querySelector('#results .search-select-mode')
        }));
        ck('D all-folder hit: header stays, buttons drop',
            folderOnly.toolbar && folderOnly.folders > 0 && !folderOnly.selectBtn,
            JSON.stringify(folderOnly));

        console.log('[step] E. tabgroups');
        // ---- E. tabgroups: bookmarked tab full tooltip ----
        await setSearch('');
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('[role="tab"]')].find(t => (t.id || '').includes('tabgroups'));
            if (tab) tab.click();
        });
        await sleep(1200);
        await sleep(1200);
        const tgRow = await page.evaluate(() => {
            const rows = [...document.querySelectorAll('#tabgroups-list a.tree-item-link, #staging-list a.tree-item-link, [id^=view-tabgroups] a.tree-item-link')];
            const a = rows.find(r => (r.getAttribute('title') || '').includes('verify.example/page'));
            return a ? a.getAttribute('title') : '';
        });
        const tl = tgRow.split('\n');
        ck('E tabgroups bookmarked tab hovers FULL info',
            tl[0] && tl[1] === 'https://verify.example/page' && tl.length >= 4 && /: /.test(tl[2]),
            JSON.stringify(tl));

        console.log('[step] F. staging selecting');
        // ---- F. staging selection mode: no chevron + icon-axis connector ----
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('[role="tab"]')].find(t => (t.id || '').includes('recent'));
            if (tab) tab.click();
        });
        await sleep(1200);
        await page.evaluate(() => {
            const btn = document.querySelector('.staging-select-mode');
            if (btn) btn.click();
        });
        await sleep(700);
        const sel = await page.evaluate(() => {
            const headChev = document.querySelectorAll('#staging-items .staging-group-head .chevron, #staging-items .staging-bucket-head .chevron').length;
            const conn = document.querySelector('#staging-items li.staging-member .staging-connector');
            const left = conn ? parseFloat(getComputedStyle(conn).left) : -1;
            return { headChev, left, members: document.querySelectorAll('#staging-items li.staging-member').length };
        });
        ck('F1 selecting: small heads carry NO chevron', sel.headChev === 0, `chevrons=${sel.headChev} members=${sel.members}`);
        ck('F2 connector on the icon center axis (~41.5px)', Math.abs(sel.left - 41.5) < 1.5, `left=${sel.left}`);

        console.log('[step] G. options page');
        // ---- G. options page: the three new checkboxes ----
        const opt = await browser.newPage();
        await opt.goto('chrome-extension://' + extId + '/pages/options.html', { waitUntil: 'load' });
        await sleep(800);
        const optState = await opt.evaluate(() => {
            const read = id => {
                const el = document.getElementById(id);
                if (!el) return null;
                const label = document.getElementById('option-' + id);
                return { checked: el.checked, label: label ? label.textContent.trim() : '' };
            };
            return {
                focus: read('focus-search-on-open'),
                folders: read('search-show-folders'),
                reverse: read('reverse-item-path')
            };
        });
        ck('G options: 3 checkboxes with labels + defaults',
            optState.focus && optState.focus.checked === false && optState.focus.label &&
            optState.folders && optState.folders.checked === true && optState.folders.label &&
            optState.reverse && optState.reverse.checked === false && optState.reverse.label,
            JSON.stringify(optState));
        await opt.close();

        console.log('[step] H. reverse e2e');
        // ---- H. reverseItemPath end-to-end: meta line flips ----
        await page.evaluate(() => new Promise(res => chrome.storage.sync.set({ reverseItemPath: '1' }, res)));
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await setSearch('verify');
        const meta = await page.evaluate(() => {
            const p = document.querySelector('#results .row-path') || document.querySelector('#results .row-sub');
            return p ? p.textContent.trim() : '';
        });
        ck('H reverseItemPath on: meta line nearest-first', /ZZSubFolderZZ\s*<\s*__verify__/.test(meta), JSON.stringify(meta));

        console.log(`\n==== ${pass} passed, ${fail} failed ====`);
        process.exit(fail ? 1 : 0);
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
