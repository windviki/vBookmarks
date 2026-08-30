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
            const bm = await create({ parentId: sub.id, title: 'Verify BM', url: 'https://verify.example/page' });
            const now = Date.now();
            window.__vbmVerifyBmId = bm.id;
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

        const bmId = await page.evaluate(() => window.__vbmVerifyBmId);

        // ---- I0. seed visit stats for the bookmarked row (stats view) ----
        await page.evaluate(id => {
            chrome.storage.local.get('visitStats', r => {
                const d = JSON.parse(r.visitStats || '{}');
                d[id] = { c: 3, t: Date.now() };
                chrome.storage.local.set({ visitStats: JSON.stringify(d) });
            });
        }, bmId);
        await sleep(400);

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
        // ---- F0. staging view (normal mode): bookmarked row + recent row
        //      hovers the FULL info incl. the date-added line ----
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('[role="tab"]')].find(t => (t.id || '').includes('recent'));
            if (tab) tab.click();
        });
        await sleep(1200);
        const stgRows = await page.evaluate(url => {
            const read = a => (a ? (a.getAttribute('title') || '').split('\n') : []);
            const stg = [...document.querySelectorAll('#staging-items li.staging-row a.tree-item-link')]
                .find(a => a.getAttribute('href') === url);
            const rec = document.querySelector('#recent-list li.vbm-row a.tree-item-link');
            return { stg: read(stg), rec: read(rec) };
        }, 'https://verify.example/page');
        ck('F0a staging BOOKMARKED row tooltip has Added line',
            stgRows.stg.length >= 4 && /: \d/.test(stgRows.stg[stgRows.stg.length - 1] || ''),
            JSON.stringify(stgRows.stg));
        ck('F0b recent-region row tooltip has Added line',
            stgRows.rec.length >= 4 && /: \d/.test(stgRows.rec[stgRows.rec.length - 1] || ''),
            JSON.stringify(stgRows.rec));

        // ---- I. stats view: bookmarked stats row hovers the FULL info ----
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('[role="tab"]')].find(t => (t.id || '').includes('stats'));
            if (tab) tab.click();
        });
        await sleep(1500);
        const statsRow = await page.evaluate(url => {
            const a = [...document.querySelectorAll('#stats-list a.tree-item-link, [id^=view-stats] a.tree-item-link')]
                .find(x => x.getAttribute('href') === url);
            return a ? (a.getAttribute('title') || '').split('\n') : [];
        }, 'https://verify.example/page');
        ck('I stats BOOKMARKED row tooltip full info + Added',
            statsRow.length >= 4 && statsRow[1] === 'https://verify.example/page' && /: \d/.test(statsRow[statsRow.length - 1]),
            JSON.stringify(statsRow));

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

        // F3 (user report 2026-08-30): the WIDE-grid selecting twin used to
        // push the tick's ::after to inset-inline-start: 42.5px — but the
        // pseudo is BOX-RELATIVE, so the horizontal line painted at
        // 42.5+42.5=85px, floating inside the title text far right of the
        // favicon. The tick must stay at left 0 and span the whole box.
        await page.evaluate(() => { document.getElementById('container').style.width = '560px'; });
        await sleep(600);
        const wideSel = await page.evaluate(() => {
            const member = document.querySelector('#staging-items li.staging-member');
            const conn = member && member.querySelector(':scope > .staging-connector');
            const fav = member && member.querySelector('.favicon-container');
            const well = document.querySelector('#staging-items .staging-group-head .staging-group-folder');
            if (!conn || !fav)
                return null;
            const tick = getComputedStyle(conn, '::after');
            const cr = conn.getBoundingClientRect();
            const fr = fav.getBoundingClientRect();
            const wr = well ? well.getBoundingClientRect() : null;
            return {
                boxL: +(cr.left).toFixed(1), boxR: +cr.right.toFixed(1), favL: +fr.left.toFixed(1),
                tickLeft: tick.left, tickW: tick.width,
                wellL: wr ? +wr.left.toFixed(1) : null, wellR: wr ? +wr.right.toFixed(1) : null
            };
        });
        ck('F3 wide selecting: tick stays box-relative (left 0), box spans trunk→favicon, well center = trunk axis',
            wideSel && wideSel.tickLeft === '0px'
            && Math.abs(wideSel.boxR - wideSel.favL) < 1
            && Math.abs(wideSel.boxL - 42.5) < 1
            && wideSel.wellL === 32 && wideSel.wellR === 54,
            JSON.stringify(wideSel));
        // restore the popup to its natural narrow size for the later sections
        await page.evaluate(() => { document.getElementById('container').style.width = ''; });
        await sleep(400);

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

        // ---- M. 4.1.1 分层记忆 end-to-end ----
        // M1: highlight layer off — a stored focusID never re-highlights
        await page.evaluate(id => {
            chrome.storage.local.set({ focusID: id });
            chrome.storage.sync.set({ rememberHighlight: '' });
        }, bmId);
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        const hl = await page.evaluate(() => ({
            marked: document.querySelectorAll('#tree .focus').length,
            inputFocused: document.activeElement && document.activeElement.id === 'search-input'
        }));
        ck('M1 rememberHighlight off: no re-highlighted row on open', hl.marked === 0, JSON.stringify(hl));

        // M2: opens layer off — every folder renders collapsed
        await page.evaluate(() => {
            chrome.storage.sync.set({ rememberHighlight: '1', rememberOpens: '' });
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        const op = await page.evaluate(() => ({
            open: document.querySelectorAll('#tree li.open').length
        }));
        ck('M2 rememberOpens off: every folder collapsed on open', op.open === 0, JSON.stringify(op));

        // M3: query layer off — a stored searchQuery never renders
        await page.evaluate(() => {
            chrome.storage.local.set({ searchQuery: 'verify' });
            chrome.storage.sync.set({ rememberOpens: '1', rememberSearchQuery: '' });
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        const qv = await page.evaluate(() => document.getElementById('search-input').value);
        ck('M3 rememberSearchQuery off: the box opens empty', qv === '', JSON.stringify(qv));
        await page.evaluate(() => new Promise(res => chrome.storage.sync.set({ rememberSearchQuery: '1' }, res)));

        // ---- N. 4.1.1 custom-CSS standalone editor ----
        // N1: the options page carries the link, not the textarea
        const optPage = await browser.newPage();
        await optPage.goto('chrome-extension://' + extId + '/pages/options.html', { waitUntil: 'load' });
        await sleep(800);
        const optRow = await optPage.evaluate(() => ({
            link: !!document.getElementById('edit-custom-css'),
            linkText: (document.getElementById('edit-custom-css') || {}).textContent || '',
            textarea: !!document.getElementById('userstyle')
        }));
        ck('N1 options: editor LINK present, inline textarea gone',
            optRow.link && !optRow.textarea && optRow.linkText.length > 0, JSON.stringify(optRow));

        // N2: the standalone page — legacy migration + live editing (4.1.1
        // rework: TAB workbench — one .custom-css-tab per style, the enable
        // checkbox lives in the editor header)
        await page.evaluate(() => {
            chrome.storage.local.set({ userstyle: 'body { color: red; }' });
            chrome.storage.local.remove('userstyles');
        });
        const cssPage = await browser.newPage();
        await cssPage.setViewport({ width: 420, height: 640 });
        await cssPage.goto('chrome-extension://' + extId + '/pages/custom-css.html', { waitUntil: 'load' });
        await sleep(1000);
        const migrated = await cssPage.evaluate(() => ({
            tabs: document.querySelectorAll('#custom-css-tabs .custom-css-tab').length,
            active: document.querySelectorAll('#custom-css-tabs .custom-css-tab.active').length,
            css: (window.__vbmCustomCss && window.__vbmCustomCss.editor.get()) || ''
        }));
        ck('N2 custom-css page: legacy userstyle migrated into one selected tab',
            migrated.tabs === 1 && migrated.active === 1 && migrated.css.includes('color: red'),
            JSON.stringify(migrated));

        // N3: create a second style, type CSS — two tabs, second selected
        await cssPage.evaluate(async () => {
            document.getElementById('custom-css-new').click();
            await new Promise(r => setTimeout(r, 200));
            window.__vbmCustomCss.editor.set('body { color: blue; }');
            const ev = document.getElementById('custom-css-css');
            ev.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
        });

        // N4 (user report): the enable checkbox unchecks cleanly — the first
        // style drops out of the materialized cascade (the first cut's
        // label-in-row checkbox raced its own re-render and could swallow it)
        const uncheck = await cssPage.evaluate(async () => {
            // switch back to the first tab, then uncheck enable
            document.querySelector('#custom-css-tabs .custom-css-tab').click();
            await new Promise(r => setTimeout(r, 200));
            const cb = document.getElementById('custom-css-enabled');
            cb.checked = false;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            return await new Promise(res => chrome.storage.local.get(['userstyles', 'userstyle'], res));
        });
        const stylesNow = JSON.parse(uncheck.userstyles || '[]');
        ck('N4 enable checkbox unchecked: first style disabled, materialization = enabled-only',
            stylesNow.length === 2 && stylesNow[0].enabled === false && uncheck.userstyle === 'body { color: blue; }',
            JSON.stringify({ n: stylesNow.length, enabled: stylesNow.map(s => s.enabled), eff: uncheck.userstyle }));

        // N5 (user report): layout — full-width inputs, editor fills the page
        const layout = await cssPage.evaluate(() => {
            const page = document.getElementById('custom-css-page');
            const box = el => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; };
            const name = box(document.getElementById('custom-css-name'));
            const desc = box(document.getElementById('custom-css-desc-input'));
            const editor = document.querySelector('#custom-css-page .CodeMirror') || document.getElementById('custom-css-css');
            const ed = box(editor);
            const pageW = page.getBoundingClientRect().width - 40; // 20px page padding both sides
            return {
                nameW: name.w, descW: desc.w, edW: ed.w, edH: ed.h, pageW: Math.round(pageW),
                // header row = enable label + name + delete only (◀▶ moved to
                // the tab strip) — the name gets everything beyond that
                nameFull: name.w >= pageW - 200,
                descFull: Math.abs(desc.w - pageW) <= 2,
                edFull: Math.abs(ed.w - pageW) <= 2,
                edTall: ed.h >= 240 // 640px viewport minus header/tabs/meta/footer
            };
        });
        ck('N5 layout: name/description/CSS editor full width, editor fills the viewport',
            layout.nameFull && layout.descFull && layout.edFull && layout.edTall,
            JSON.stringify(layout));

        // N6: tab switching swaps the editor content; ◀/▶ reorder the cascade
        const tabflow = await cssPage.evaluate(async () => {
            const out = {};
            const tabs = () => [...document.querySelectorAll('#custom-css-tabs .custom-css-tab')];
            // re-enable style 1, then check cascade = tab order
            const cb = document.getElementById('custom-css-enabled');
            cb.checked = true;
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 200));
            out.before = (await new Promise(res => chrome.storage.local.get('userstyle', res))).userstyle;
            // move the first tab right → order flips → later tab wins
            document.getElementById('custom-css-move-right').click();
            await new Promise(r => setTimeout(r, 200));
            out.order = tabs().map(t => t.textContent.trim());
            out.after = (await new Promise(res => chrome.storage.local.get('userstyle', res))).userstyle;
            // click the (new) first tab → editor shows its css
            tabs()[0].click();
            await new Promise(r => setTimeout(r, 200));
            out.editorCss = window.__vbmCustomCss.editor.get();
            return out;
        });
        ck('N6 tab flow: ◀▶ reorder flips the cascade; tab click swaps the editor',
            tabflow.before === 'body { color: red; }\n\nbody { color: blue; }'
            && tabflow.after === 'body { color: blue; }\n\nbody { color: red; }'
            && tabflow.editorCss.includes('color: blue'),
            JSON.stringify(tabflow));

        // N5b (user report): a LONG stylesheet scrolls INSIDE the editor slot
        // — the vendored CM v2 css (height:auto + overflow-y:hidden) used to
        // grow past the wrapper and overlap the footer text
        const longCssOk = await cssPage.evaluate(async () => {
            const big = Array.from({ length: 200 }, (_, i) => `.r${i} { color: rgb(${i % 255},64,128); }`).join('\n');
            window.__vbmCustomCss.editor.set(big);
            const ev = document.getElementById('custom-css-css');
            ev.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 300));
            const wrap = document.querySelector('#custom-css-page .CodeMirror');
            const inner = (wrap && wrap.querySelector('.CodeMirror-scroll')) || document.getElementById('custom-css-css');
            const footer = document.querySelector('.custom-css-status-row');
            if (!inner || !footer)
                return { ok: false, why: 'missing elements' };
            const ir = inner.getBoundingClientRect();
            const fr = footer.getBoundingClientRect();
            const cs = getComputedStyle(inner);
            return {
                ok: ir.bottom <= fr.top + 1 && cs.overflowY !== 'hidden' && inner.scrollHeight > inner.clientHeight,
                innerH: Math.round(ir.height), footerTop: Math.round(fr.top), ovY: cs.overflowY,
                scrolls: inner.scrollHeight > inner.clientHeight
            };
        });
        ck('N5b long stylesheet: editor scrolls internally, footer never overlapped',
            longCssOk.ok, JSON.stringify(longCssOk));

        // N5c (user report): on a WIDE browser window the editor must follow
        // the viewport — a stale global `.CodeMirror { width: min(40em,100%) }`
        // (a 560px ceiling at 14px font, written for the retired inline
        // editor) used to pin it while every other control stretched
        await cssPage.setViewport({ width: 1280, height: 800 });
        await sleep(400);
        const wide = await cssPage.evaluate(() => {
            const page = document.getElementById('custom-css-page');
            const editor = document.querySelector('#custom-css-page .CodeMirror') || document.getElementById('custom-css-css');
            const name = document.getElementById('custom-css-name');
            const pageW = Math.round(page.getBoundingClientRect().width - 40);
            return {
                vw: window.innerWidth, pageW,
                edW: Math.round(editor.getBoundingClientRect().width),
                nameW: Math.round(name.getBoundingClientRect().width)
            };
        });
        ck('N5c wide viewport: the editor and inputs track the browser width (no 40em cap)',
            Math.abs(wide.edW - wide.pageW) <= 2 && wide.nameW >= wide.pageW - 220,
            JSON.stringify(wide));

        // visual capture for review (rerun.sh copies /tmp/shots → tmp/shots)
        require('fs').mkdirSync('/tmp/shots', { recursive: true });
        await cssPage.screenshot({ path: '/tmp/shots/custom-css-workbench-wide.png' });

        await optPage.close();
        await cssPage.close();
        // restore a clean css state for any later runs
        await page.evaluate(() => {
            chrome.storage.local.remove('userstyle');
            chrome.storage.local.remove('userstyles');
        });

        console.log(`\n==== ${pass} passed, ${fail} failed ====`);
        process.exit(fail ? 1 : 0);
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
