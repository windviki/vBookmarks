// vBookmarks keyboard/view verification (runs inside zenika/alpine-chrome:with-puppeteer).
// Absorbed from the view-system branch's verify-keyboard.js and adapted to
// master's DOM: view sections toggle the `hidden` attribute, search results
// live in #results directly under #view-search, dupes controls are
// class-selected, and tab buttons carry no data-view-id (id=view-tab-<id>).
//
// Scope: real-browser hard assertions for the pieces vitest cannot reach —
// the tab strip's bubble-phase keyboard handlers (←/→/Home/End/↑/↓ with
// roving tabindex + auto-activation), the focus-zone topology, the search
// view's dual-zone structure (history top / results bottom), query+results
// persistence across view switches, and per-view rendering. Esc chains are
// NOT exercised here: CDP Input.dispatchKeyEvent short-circuits the event
// dispatch pipeline and never reaches document capture-phase listeners —
// see docs/cdp-escape-limitation.md; Esc is covered by tests/keyboard.test.js.
// The one exception is the dropdown's window-capture Esc, exercised below by
// dispatching a synthetic keydown directly on window (target-phase delivery
// fires capture handlers registered on window itself).
//
// Exits non-zero on any failed check (wired as a blocking run.sh step).
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = [], FAIL = [];
const check = (label, ok, detail) => {
    (ok ? PASS : FAIL).push(label);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
};

// Compact seed: one work folder with three bookmarks, one read-later folder
// holding a DUPLICATE of the GitHub row (gives the dupes view one group),
// plus two rows in Other Bookmarks. visitStats/deadLastScan give the stats
// and dead views real rows so the per-view ↑↓ navigation checks have
// something to walk.
const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    const gh = await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    const mdn = await create({ parentId: work.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    const so = await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/tagged/chrome-extension' });
    const read = await create({ parentId: '1', title: '稍后读' });
    await create({ parentId: read.id, title: 'GitHub (mirror)', url: 'https://github.com/vBookmarks' });
    await create({ parentId: read.id, title: 'A List Apart', url: 'https://alistapart.com/topic/typography' });
    const aw = await create({ parentId: '2', title: 'Awwwards', url: 'https://www.awwwards.com' });
    const hn = await create({ parentId: '2', title: 'Hacker News', url: 'https://news.ycombinator.com' });
    const now = Date.now();
    await new Promise(r => chrome.storage.local.set({
        visitStats: JSON.stringify({
            [gh.id]: { c: 42, t: now - 3600e3 },
            [mdn.id]: { c: 7, t: now - 864e5 },
            [so.id]: { c: 3, t: now }
        }),
        deadLastScan: JSON.stringify({
            ts: now - 3600e3,
            scannedCount: 8,
            results: {
                [aw.id]: { status: 'dead', code: 404 },
                [hn.id]: { status: 'dead', code: 0, error: 'ERR_NAME_NOT_RESOLVED' }
            }
        })
    }, r));
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });

    const pageErrors = [];
    const watch = page => {
        // The offline DinD sandbox makes the favicon pipeline (and the real
        // seeded bookmark hosts) emit expected network failures — "Failed to
        // load resource: net::… / 4xx / 5xx" is Chromium's own resource log,
        // not an extension console.error. Same allowlist as smoke.js / shots.
        page.on('pageerror', e => {
            const msg = e.message || '';
            if (msg.includes('Failed to load resource') || msg.includes('net::') || msg.includes('Refused to'))
                return;
            pageErrors.push(`pageerror: ${msg}`);
        });
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const txt = m.text() || '';
            if (txt.includes('Failed to load resource') || txt.includes('net::') || txt.includes('Refused to'))
                return;
            pageErrors.push(`console: ${txt}`);
        });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) { console.error('service worker not found'); process.exit(2); }
    const extId = new URL(swTarget.url()).hostname;

    // Seed, then open the popup fresh so the tree boots with data.
    const seedPage = await browser.newPage();
    watch(seedPage);
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(600);
    await seedPage.close();

    const page = await browser.newPage();
    watch(page);
    // popup.html runs here as a regular tab: the actions layer's
    // post-open window.close (openBookmarkNewTab & friends) would close that
    // tab for real and detach the CDP frame. Stub it out for the harness.
    await page.evaluateOnNewDocument(() => { window.close = () => {}; });
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const $ = (fn, ...args) => page.evaluate(fn, ...args);

    // Fresh-install grace means the donation card is up on this profile.
    // Dismiss it through its own Later button so the canonical zone walks
    // below run without the transient rung (keyboard-model §7: the banner
    // joins the Tab ring only while up — §7 at the end re-arms and walks it).
    if (await $(() => {
        const d = document.getElementById('donation');
        return !!d && d.style.display !== 'none' && d.offsetHeight > 0;
    })) {
        await page.click('#donation-later');
        await sleep(300);
    }

    // ====================================================================
    // §2.1 focus zones: header / tab strip / list all present
    // ====================================================================
    console.log('═══ §2.1 焦点区域 ═══');
    check('Header: search-input', await $(() => !!document.getElementById('search-input')));
    check('Header: quick-add-btn', await $(() => !!document.getElementById('quick-add-btn')));
    check('Header: tool-btn', await $(() => !!document.getElementById('tool-btn')));
    const tabs = await $(() => ({
        count: document.querySelectorAll('#view-tabs [role="tab"]').length,
        active: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id,
        roving: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).tabIndex,
        others: [...document.querySelectorAll('#view-tabs [aria-selected="false"]')].every(b => b.tabIndex === -1)
    }));
    check('TabStrip: 6 tabs', tabs.count === 6, String(tabs.count));
    check('TabStrip: tree active on boot', tabs.active === 'view-tab-tree', tabs.active);
    check('TabStrip: roving tabindex (active=0, rest=-1)', tabs.roving === 0 && tabs.others);
    check('List: tree rows exist', await $(() => document.querySelectorAll('#tree li').length > 0));

    // ====================================================================
    // §2.2 tab strip keyboard (bubble-phase handlers — CDP can drive these)
    // ====================================================================
    console.log('═══ §2.2 TabStrip 键盘 ═══');
    const focusedTab = () => $(() => document.activeElement && document.activeElement.id);
    const selectedTab = () => $(() => (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id);
    await page.click('#view-tab-tree'); await sleep(300);
    await page.keyboard.press('ArrowRight'); await sleep(300);
    check('→: focus tree→search', await focusedTab() === 'view-tab-search', await focusedTab());
    check('→: auto-activates the view', await selectedTab() === 'view-tab-search');
    await page.keyboard.press('ArrowRight'); await sleep(300);
    check('→: search→recent', await focusedTab() === 'view-tab-recent');
    await page.keyboard.press('Home'); await sleep(300);
    // 4.0.1 (item e): strip Home/End are view-scoped — Home focuses the
    // CURRENT view's first row (recent is active here), never the first tab.
    check('Home: view-scoped → recent first row', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#recent-list');
    }), await $(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
    await page.click('#view-tab-tree'); await sleep(300);
    // ↓ from the strip enters the active view's list (first row takes focus)
    await page.keyboard.press('ArrowDown'); await sleep(400);
    check('↓: strip→list (tree row focused)', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#view-tree') && el !== document.getElementById('view-tab-tree');
    }), await $(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
    await page.click('#view-tab-tree'); await sleep(300);
    await page.keyboard.press('End'); await sleep(300);
    // 4.0.1 (item e): strip End focuses the CURRENT view's last row — the
    // tree stays active; no more jump to the last tab.
    check('End: view-scoped → tree last row, no view switch', await $(() => {
        const el = document.activeElement;
        const sel = (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id;
        return !!el && !!el.closest('#tree') && sel === 'view-tab-tree';
    }), await $(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
    // Re-anchor the tree's remembered row at the top — the tree section
    // below assumes the strip's ↓ restores the FIRST row.
    await page.keyboard.press('Home'); await sleep(200);
    check('Home from the last row: tree first row (memory re-anchored)', await $(() => {
        const rows = [...document.querySelectorAll('#tree li')];
        const el = document.activeElement;
        return rows.length > 0 && !!el && rows[0].contains(el);
    }), await $(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
    await page.click('#view-tab-dupes'); await sleep(300);
    await page.keyboard.press('ArrowLeft'); await sleep(300);
    check('←: dupes→dead', await focusedTab() === 'view-tab-dead');
    await page.keyboard.press('ArrowUp'); await sleep(300);
    check('↑: strip→search input', await $(() => document.activeElement && document.activeElement.id === 'search-input'));

    // ====================================================================
    // §2.1 Tab region cycle (v4 task-3 #7): header → tab strip → list row,
    // Shift+Tab backwards; rows are tabindex=-1 so the cycle is the only
    // Tab path into a list. Tab keydowns reach bubble-phase document
    // listeners over CDP (only Esc is short-circuited).
    // ====================================================================
    console.log('═══ §2.1 Tab 区域循环 ═══');
    const activeDesc = () => $(() => {
        const el = document.activeElement;
        return el ? (el.id || el.className || el.tagName) : '(none)';
    });
    await page.click('#view-tab-tree'); await sleep(300);
    await page.click('#search-input'); await sleep(200);
    const tabTo = async (label, expected) => {
        await page.keyboard.press('Tab'); await sleep(150);
        const got = await activeDesc();
        check(label, got === expected, got);
    };
    check('rows are tabindex=-1 (roving list model)', await $(() => {
        const rows = [...document.querySelectorAll('#tree li > a, #tree li > span')];
        return rows.length > 0 && rows.every(el => el.tabIndex === -1);
    }));
    await tabTo('Tab: search→quick-add', 'quick-add-btn');
    await tabTo('Tab: quick-add→tool', 'tool-btn');
    await tabTo('Tab: tool→active tab', 'view-tab-tree');
    await page.keyboard.press('Tab'); await sleep(150);
    check('Tab: strip→list row', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#tree');
    }), await activeDesc());
    await tabTo('Tab: list→wraps to search', 'search-input');
    // Shift+Tab backwards: search → list row → tab strip
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    await sleep(150);
    check('Shift+Tab: search→list row', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#tree');
    }), await activeDesc());
    await page.keyboard.down('Shift'); await page.keyboard.press('Tab'); await page.keyboard.up('Shift');
    await sleep(150);
    check('Shift+Tab: list→tab strip', await activeDesc() === 'view-tab-tree', await activeDesc());

    // ====================================================================
    // §2.1 region focus memory (v4 task-3 #7): the focused row is remembered
    // per view and re-marked (.focus) when the view is re-entered.
    // ====================================================================
    console.log('═══ §2.1 区域焦点记忆 ═══');
    await page.click('#view-tab-recent'); await sleep(900);
    // Tab into the list (first row), ArrowDown onto the second row.
    await page.click('#search-input'); await sleep(150);
    await page.keyboard.press('Tab'); await sleep(150); // quick-add
    await page.keyboard.press('Tab'); await sleep(150); // tool
    await page.keyboard.press('Tab'); await sleep(150); // tab strip
    await page.keyboard.press('Tab'); await sleep(150); // list row 1
    check('memory setup: landed on a recent row', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#recent-list');
    }), await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(200);
    const remembered = await $(() => {
        const el = document.activeElement;
        const li = el && el.closest('#recent-list li');
        return li ? li.id : null;
    });
    check('memory setup: arrowed to a second recent row', !!remembered, String(remembered));
    await page.click('#view-tab-tree'); await sleep(400);
    await page.click('#view-tab-recent'); await sleep(500);
    check('memory: .focus re-marked on the remembered row', await $(id => {
        const li = id && document.getElementById(id);
        const a = li && li.querySelector('a.focus, span.focus');
        return !!a || (li && li.classList.contains('focus'));
    }, remembered));

    // ====================================================================
    // §2.2c per-view ↑↓ row navigation + crossings (v4 final polish):
    // every registered list walks rows with ↑/↓; views with an in-list
    // toolbar (stats/dead/dupes) treat it as a rung — strip ↓ lands on its
    // first control, ←/→ walk the rung (a dropdown trigger's own ↓ opens
    // its listbox instead of walking the rung), control ↓ enters the rows,
    // first-row ↑ returns to the rung, rung ↑ crosses to the tab strip;
    // toolbar-less views cross strip-wards directly. Dupes member ←
    // returns to the group head and head ←/→ collapses/expands the group.
    // ====================================================================
    console.log('═══ §2.2c 各视图行导航/越顶 ═══');
    const activeLiIndex = listSel => $(sel => {
        // the custom dropdowns' option <li>s live inside the list container
        // but are NOT rows — exclude them from the row index
        const rows = [...document.querySelectorAll(sel + ' li')]
            .filter(li => !li.closest('.vbm-dropdown-list'));
        const el = document.activeElement;
        const li = el && el.closest('li');
        return { idx: rows.indexOf(li), total: rows.length,
                 focus: el ? (el.id || el.className || el.tagName) : '(none)' };
    }, listSel);

    // --- tree: ↓↓ walk, ↑ back, ↑ past the top lands on the tab strip ---
    await page.click('#view-tab-tree'); await sleep(300);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    let st = await activeLiIndex('#tree');
    check('tree ↓: first row focused', st.idx === 0, JSON.stringify(st));
    await page.keyboard.press('ArrowDown'); await sleep(200);
    st = await activeLiIndex('#tree');
    check('tree ↓: next row', st.idx === 1, JSON.stringify(st));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    st = await activeLiIndex('#tree');
    check('tree ↑: previous row', st.idx === 0, JSON.stringify(st));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('tree ↑ past top: crosses to the tab strip',
        await focusedTab() === 'view-tab-tree', await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(200);
    await page.keyboard.press('End'); await sleep(200);
    st = await activeLiIndex('#tree');
    check('tree End: last visible row', st.idx > 0 && st.idx === st.total - 1, JSON.stringify(st));
    await page.keyboard.press('Home'); await sleep(200);
    st = await activeLiIndex('#tree');
    check('tree Home: first row', st.idx === 0, JSON.stringify(st));

    // --- recent (the §2.1 memory walk left a remembered row here, so the
    // strip's ↓ restores THAT row instead of the first — by design; Home
    // then re-anchors the walk at the top) ---
    await page.click('#view-tab-recent'); await sleep(700);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    st = await activeLiIndex('#recent-list');
    check('recent ↓ from strip: remembered row restored',
        st.idx >= 0 && /focus/.test(st.focus), JSON.stringify(st));
    await page.keyboard.press('Home'); await sleep(200);
    st = await activeLiIndex('#recent-list');
    check('recent Home: first row', st.idx === 0, JSON.stringify(st));
    await page.keyboard.press('ArrowDown'); await sleep(200);
    st = await activeLiIndex('#recent-list');
    check('recent ↓: next row', st.idx === 1, JSON.stringify(st));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    st = await activeLiIndex('#recent-list');
    check('recent ↑: previous row', st.idx === 0, JSON.stringify(st));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('recent ↑ past top: tab strip',
        await focusedTab() === 'view-tab-recent', await activeDesc());

    // --- stats (three seeded bookmark rows + the §2.5 toolbar rung) ---
    await page.click('#view-tab-stats'); await sleep(700);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('stats ↓ from strip: the toolbar rung (first control)', await $(() =>
        document.activeElement && !!document.activeElement.closest('.stats-toolbar')),
        await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('stats toolbar →: next control', await $(() =>
        document.activeElement && document.activeElement.dataset.sort === 'recent'),
        await activeDesc());
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    check('stats toolbar ←: back', await $(() =>
        document.activeElement && document.activeElement.dataset.sort === 'count'),
        await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    st = await activeLiIndex('#stats-list');
    check('stats toolbar ↓: first bookmark-stats row', st.idx === 0, JSON.stringify(st));
    await page.keyboard.press('ArrowDown'); await sleep(200);
    st = await activeLiIndex('#stats-list');
    check('stats ↓: next row', st.idx === 1, JSON.stringify(st));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('stats ↑ past top: back to the toolbar rung', await $(() =>
        document.activeElement && !!document.activeElement.closest('.stats-toolbar')),
        await activeDesc());
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('stats toolbar ↑: tab strip',
        await focusedTab() === 'view-tab-stats', await activeDesc());

    // --- dead (cached scan renders two result rows + FOUR rungs) ---
    // v4 task-4 #13: the proxy strip sits above the toolbars and each is its
    // own arrow rung in visual order (keyboard-model §2.5). 4.0.8 (4f9e97b)
    // stacks the idle toolbar as THREE .vbm-toolbar rows — detection
    // (last-scan / rescan / clear-scan), mark (category filter + batch
    // icons), status (mark-status filter + sort) — so the chain is: strip ↓
    // → proxy strip → detection row → mark row → status row → rows, and back
    // up in reverse. Every rung crossing lands on that rung's FIRST enabled
    // control.
    await page.click('#view-tab-dead'); await sleep(700);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dead ↓ from strip: the proxy strip rung', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dead-proxy-add')),
        await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dead proxy strip ↓: the detection row rung (rescan)', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dead-rescan')),
        await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dead detection row ↓: the mark row rung (category filter)', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dead-filter-btn')),
        await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dead mark row ↓: the status row rung (mark-status filter)', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dead-mark-filter-btn')),
        await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    st = await activeLiIndex('#dead-list');
    check('dead status row ↓: first result row', st.idx === 0, JSON.stringify(st));
    await page.keyboard.press('ArrowDown'); await sleep(200);
    st = await activeLiIndex('#dead-list');
    check('dead ↓: next row', st.idx === 1, JSON.stringify(st));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('dead ↑ past top: the lowest toolbar rung (status row)', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dead-mark-filter-btn')),
        await activeDesc());
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('dead status row ↑: the mark row rung', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dead-filter-btn')),
        await activeDesc());
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('dead mark row ↑: the detection row rung', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dead-rescan')),
        await activeDesc());
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('dead detection row ↑: the proxy strip rung', await $(() =>
        document.activeElement && !!document.activeElement.closest('.dead-proxy-strip')),
        await activeDesc());
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('dead proxy strip ↑: tab strip',
        await focusedTab() === 'view-tab-dead', await activeDesc());

    // K14: the proxy strip's text inputs own their caret keys — ←/→/Home/End
    // move the caret inside the value, never walk the rung's controls or jump
    // to the list's first/last row (the same passthrough the SELECT's ↑/↓
    // already had). ↑ still leaves the field through the rung walk. The panel
    // (add → input + test-url) is opened through its own button first.
    await page.click('.dead-proxy-add'); await sleep(400);
    check('K14 setup: the proxy panel opens with its URL input focused', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dead-proxy-input')),
        await activeDesc());
    await page.keyboard.type('127.0.0.1:7890', { delay: 20 });
    await sleep(200);
    const k14len = await $(() => document.querySelector('.dead-proxy-input').value.length);
    await page.keyboard.press('ArrowLeft'); await sleep(150);
    const k14left = await $(() => ({
        caret: document.activeElement && document.activeElement.selectionStart,
        inField: document.activeElement && document.activeElement.classList.contains('dead-proxy-input')
    }));
    check('K14: ← moves the caret, focus stays in the field (no rung walk)',
        k14left.inField && k14left.caret === k14len - 1, JSON.stringify(k14left));
    await page.keyboard.press('Home'); await sleep(150);
    const k14home = await $(() => ({
        caret: document.activeElement && document.activeElement.selectionStart,
        inField: document.activeElement && document.activeElement.classList.contains('dead-proxy-input')
    }));
    check('K14: Home goes to the caret start, not the first row',
        k14home.inField && k14home.caret === 0, JSON.stringify(k14home));
    await page.keyboard.press('End'); await sleep(150);
    const k14end = await $(() => ({
        caret: document.activeElement && document.activeElement.selectionStart,
        inField: document.activeElement && document.activeElement.classList.contains('dead-proxy-input')
    }));
    check('K14: End goes to the caret end, not the last row',
        k14end.inField && k14end.caret === k14len, JSON.stringify(k14end));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('K14: ↑ still leaves the field through the rung walk (tab strip)',
        await focusedTab() === 'view-tab-dead', await activeDesc());

    // --- dupes: TWO toolbar rungs — row 1 (.dupes-controls-toolbar:
    // strategy/scope custom dropdowns + scheme checkbox), row 2
    // (.dupes-actions-toolbar: summary span + apply-all + select-mode) ---
    // ←/→ rove WITHIN one rung and wrap at its edge; ↓/↑ cross rungs and
    // land on the target rung's first enabled control (keyboard-model §2.5).
    // The dropdowns keep their protocol (dropdown.js: trigger ↓ opens,
    // →/Enter picks, ←/Esc cancels), then head ⇄ members, member ← returns,
    // head ←/→ folds ---
    await page.click('#view-tab-dupes'); await sleep(900);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dupes ↓ from strip: the controls rung (strategy dropdown)', await $(() =>
        document.activeElement && !!document.activeElement.closest('.vbm-dropdown.dupes-strategy')),
        await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('dupes toolbar →: scope dropdown', await $(() =>
        document.activeElement && !!document.activeElement.closest('.vbm-dropdown.dupes-scope')),
        await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('dupes toolbar →: scheme checkbox', await $(() =>
        document.activeElement && document.activeElement.type === 'checkbox'),
        await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('dupes controls rung → wraps at the row edge: back to the strategy dropdown', await $(() =>
        document.activeElement && !!document.activeElement.closest('.vbm-dropdown.dupes-strategy')),
        await activeDesc());
    // a closed dropdown trigger's ↓ opens its listbox instead of crossing —
    // walk back to the checkbox (a plain control) to cross down a rung
    await page.keyboard.press('ArrowRight'); await sleep(150);
    await page.keyboard.press('ArrowRight'); await sleep(150);
    check('dupes toolbar →→: back on the scheme checkbox', await $(() =>
        document.activeElement && document.activeElement.type === 'checkbox'),
        await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dupes controls rung ↓: the actions rung (apply-all)', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dupes-apply-all')),
        await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('dupes actions rung →: select-mode button', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dupes-select-mode')),
        await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('dupes actions rung → wraps at the row edge: back to apply-all', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dupes-apply-all')),
        await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dupes actions rung ↓: group head focused', await $(() =>
        document.activeElement && document.activeElement.classList.contains('group-head')),
        await activeDesc());
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('dupes head ↑ past top: the LOWEST rung (actions row, apply-all)', await $(() =>
        document.activeElement && document.activeElement.classList.contains('dupes-apply-all')),
        await activeDesc());
    // ↓ from the actions rung enters the rows: head → first member
    await page.keyboard.press('ArrowDown'); await sleep(250);
    await page.keyboard.press('ArrowDown'); await sleep(200);
    st = await activeLiIndex('#dupes-list');
    check('dupes ↓: head→first member', st.idx === 1, JSON.stringify(st));
    await page.keyboard.press('ArrowDown'); await sleep(200);
    st = await activeLiIndex('#dupes-list');
    check('dupes ↓: member→member', st.idx === 2, JSON.stringify(st));
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    check('dupes member ←: jumps back to the group head', await $(() =>
        document.activeElement && document.activeElement.classList.contains('group-head')),
        await activeDesc());
    await page.keyboard.press('ArrowLeft'); await sleep(300);
    st = await activeLiIndex('#dupes-list');
    check('dupes head ←: collapses the group (members unmounted)',
        st.total === 1, JSON.stringify(st));
    await page.keyboard.press('ArrowRight'); await sleep(300);
    st = await activeLiIndex('#dupes-list');
    check('dupes head →: expands back', st.total === 3, JSON.stringify(st));

    // dropdown protocol (kept at the END — a pick changes the strategy and
    // must not disturb the row walks above): ↓ on the trigger opens the list,
    // → picks + closes back on the trigger
    await page.evaluate(() => document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-trigger').focus());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dupes strategy ↓: the dropdown opens', await $(() =>
        !document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-list').hidden &&
        !!document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-list li:focus')),
        await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('dupes strategy →: picks + closes back on the trigger', await $(() =>
        document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-list').hidden &&
        document.activeElement && !!document.activeElement.closest('.vbm-dropdown-trigger')),
        await activeDesc());

    // D1: with the trigger focused (list CLOSED), Home falls through to the
    // list's own row walk — the strategy listbox's <li>s are excluded from
    // the row selector, so the landing spot is the first real row (the
    // group head), never a text-only option (null.focus() used to throw).
    await page.evaluate(() =>
        document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-trigger').focus());
    await page.keyboard.press('Home'); await sleep(250);
    st = await activeLiIndex('#dupes-list');
    check('D1: Home on a closed dropdown trigger lands on the first row (group head)',
        st.idx === 0 && await $(() =>
            document.activeElement && document.activeElement.classList.contains('group-head')),
        JSON.stringify(st));

    // dropdown Esc layering: the window-capture handler closes an open list
    // before keyboard.js's document chain. CDP key events do not reach the
    // window-capture listeners in this harness, so dispatch a synthetic
    // keydown ON window — target-phase delivery fires the capture handler.
    await page.evaluate(() =>
        document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-trigger').focus());
    await page.keyboard.press('ArrowDown'); await sleep(250); // open the list
    await page.evaluate(() =>
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    await sleep(250);
    check('dropdown Esc: listbox closes and focus returns to the trigger', await $(() =>
        document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-list').hidden &&
        document.activeElement && !!document.activeElement.closest('.vbm-dropdown.dupes-strategy .vbm-dropdown-trigger')),
        await activeDesc());

    // 4.0.1 regression gate: opening (and closing) the strategy dropdown used
    // to let the listbox option steal the `.focus` row marker — the toolbar's
    // ↓ then targeted the HIDDEN option (querySelector('.focus')) and the
    // button area could no longer enter the rows. After the open/close above,
    // the →→ checkbox, ↓ actions rung, ↓ rows walk must STILL land on the
    // group head.
    await page.keyboard.press('ArrowRight'); await sleep(150);
    await page.keyboard.press('ArrowRight'); await sleep(150);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('dupes rung ↓ still enters the rows after the dropdown was open/closed (marker-steal gate)', await $(() =>
        document.activeElement && document.activeElement.classList.contains('group-head')),
        await activeDesc());
    await page.evaluate(() =>
        document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-trigger').focus());
    await sleep(150);

    // 失焦即关 (D3/K8): an open listbox must not survive a view switch. A
    // real tab click doubles for Ctrl+2 here — CDP digits do not reach the
    // document-capture view-switch listener, and activate() moves focus the
    // same way (plus the click's own mousedown lands outside the dropdown).
    await page.keyboard.press('ArrowDown'); await sleep(250); // open again from the trigger
    await page.click('#view-tab-search'); await sleep(400);
    check('view switch closes the open dropdown (no floating listbox)', await $(() =>
        !document.querySelector('.vbm-dropdown.open') &&
        document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-list').hidden),
        await activeDesc());
    await page.click('#view-tab-dupes'); await sleep(500);
    check('back in dupes: the re-rendered toolbar starts fully closed', await $(() =>
        !document.querySelector('.vbm-dropdown.open') &&
        [...document.querySelectorAll('#dupes-list .vbm-dropdown-list')].every(l => l.hidden)),
        await activeDesc());

    // K1: a freshly opened context menu holds focus on the CONTAINER — ↓
    // must enter through the same walkable rules as the item-to-item walk.
    // The bookmark menu's first four children are display:none outside
    // their views (reveal/dead-mark/keeper entries), so the landing spot
    // is #bookmark-new-tab; focusing a hidden item would strand every arrow.
    await page.click('#view-tab-tree'); await sleep(400);
    // the fresh profile renders every folder collapsed (opens=[]), so expand
    // through the app's own click toggle until a bookmark row exists
    await page.evaluate(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        for (let guard = 0; guard < 12 && !document.querySelector('#tree li.child'); guard++) {
            const p = document.querySelector('#tree li.parent:not(.open) > span');
            if (!p)
                break;
            p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            await nap(150); // expand re-renders via async chrome.bookmarks.getChildren
        }
        const a = document.querySelector('#tree li.child a');
        if (a)
            a.focus();
    });
    await sleep(300);
    check('K1 setup: a bookmark row focused', await $(() => {
        const el = document.activeElement;
        const li = el && el.closest('li');
        return !!el && el.tagName === 'A' && !!li && li.classList.contains('child');
    }), await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(400); // → synthetic contextmenu
    check('K1: row → opens the bookmark menu (container focused)', await $(() =>
        document.activeElement && document.activeElement.id === 'bookmark-context-menu'),
        await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('K1: menu ↓ from the container skips the hidden head items',
        await $(() => document.activeElement && document.activeElement.id === 'bookmark-new-tab'),
        await activeDesc());
    await page.keyboard.press('ArrowLeft'); await sleep(300); // close, back to the row
    check('K1: menu ← closes and focus returns to the tree row', await $(() =>
        document.getElementById('bookmark-context-menu').style.opacity === '0' &&
        document.activeElement && !!document.activeElement.closest('#tree li.child')),
        await activeDesc());

    // ====================================================================
    // §2.1d header-row direction chain (final polish): the naive layout
    // walk — box ↓ → strip, strip ↑ → box, box → → quick-add → tool,
    // ← all the way back, and ↓ from a header button → the strip.
    // (Only while browsing: with a live query the box's ↓ jumps straight
    // into the results — §4.3b — and an empty box in the search view
    // lands on the history rows; those dual-zone transfers stay.)
    // ====================================================================
    console.log('═══ §2.1d 头部行方向链 ═══');
    await page.click('#view-tab-tree'); await sleep(300);
    await page.click('#search-input'); await sleep(150);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('box ↓ (browse): lands on the tab strip',
        await focusedTab() === 'view-tab-tree', await activeDesc());
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('strip ↑: back to the box', await $(() =>
        document.activeElement && document.activeElement.id === 'search-input'), await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('box → (caret at end): quick-add focused', await $(() =>
        document.activeElement && document.activeElement.id === 'quick-add-btn'), await activeDesc());
    await page.keyboard.press('ArrowRight'); await sleep(200);
    check('quick-add →: tool button focused', await $(() =>
        document.activeElement && document.activeElement.id === 'tool-btn'), await activeDesc());
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    check('tool ←: back to quick-add', await $(() =>
        document.activeElement && document.activeElement.id === 'quick-add-btn'), await activeDesc());
    await page.keyboard.press('ArrowLeft'); await sleep(200);
    const boxState = await $(() => ({
        id: document.activeElement && document.activeElement.id,
        caretAtEnd: document.activeElement &&
            document.activeElement.selectionEnd === document.activeElement.value.length
    }));
    check('quick-add ←: back to the box with the caret parked at the end',
        boxState.id === 'search-input' && boxState.caretAtEnd, JSON.stringify(boxState));
    await page.keyboard.press('ArrowRight'); await sleep(200); // → quick-add again
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('quick-add ↓: lands on the tab strip',
        await focusedTab() === 'view-tab-tree', await activeDesc());

    // ====================================================================
    // §4.3 search view: dual zone + persistence across view switches
    // ====================================================================
    console.log('═══ §4.3 搜索双区/重进 ═══');
    await page.click('#view-tab-tree'); await sleep(300);
    await page.click('#search-input');
    await page.keyboard.type('github', { delay: 40 });
    await sleep(800);
    const s1 = await $(() => ({
        input: document.getElementById('search-input').value,
        searchVisible: !document.getElementById('view-search').hidden,
        dualZone: !!document.querySelector('#view-search > #search-history-area') &&
                  !!document.querySelector('#view-search > #results'),
        resRows: document.querySelectorAll('#results li').length
    }));
    check('typing drives the search view active', s1.searchVisible);
    check('query lands in the box', s1.input === 'github', s1.input);
    check('dual-zone structure (history top / results bottom)', s1.dualZone);
    check('results render', s1.resRows > 0, `rows:${s1.resRows}`);

    // Leaving the view records the non-empty query; re-entering keeps the
    // box as-is, keeps the results DOM, and renders the history top zone.
    await page.click('#view-tab-tree'); await sleep(500);
    await page.click('#view-tab-search'); await sleep(600);
    const s2 = await $(() => ({
        input: document.getElementById('search-input').value,
        resRows: document.querySelectorAll('#results li').length,
        histRows: [...document.querySelectorAll('#search-history-area li.search-history-row i')]
            .map(el => el.textContent)
    }));
    check('re-entry: box kept as-is', s2.input === 'github', s2.input);
    check('re-entry: results DOM persisted', s2.resRows > 0, `rows:${s2.resRows}`);
    check('re-entry: history recorded the query', s2.histRows.some(t => t === 'github'),
        s2.histRows.join(','));

    // ====================================================================
    // §4.3b dual-zone focus transfers: with a query the box's ↓ lands on
    // the results; with an empty box ↓ walks history rows and crosses
    // into the kept results; ↑ past either zone's top takes the universal
    // crossing (keyboard-model §3): the strip, then the box.
    // ====================================================================
    console.log('═══ §4.3b 搜索双区焦点转移 ═══');
    await page.click('#search-input'); await sleep(200);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('search box ↓ (query): first result row focused', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#results li');
    }), await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(200);
    st = await activeLiIndex('#results');
    check('search results ↓: next row', st.idx === 1, JSON.stringify(st));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    st = await activeLiIndex('#results');
    check('search results ↑: previous row', st.idx === 0, JSON.stringify(st));
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('search results ↑ past top: tab strip',
        await focusedTab() === 'view-tab-search', await activeDesc());

    // Empty the box (quits back to the tree), re-enter the search view:
    // the box is empty, the history rows sit above the kept results.
    await page.click('#search-input'); await sleep(150);
    await $(() => {
        const i = document.getElementById('search-input');
        i.value = '';
        i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(400);
    await page.click('#view-tab-search'); await sleep(500);
    await page.click('#search-input'); await sleep(150);
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('empty box ↓: first history row focused', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#search-history-area') &&
            el.dataset && typeof el.dataset.q !== 'undefined';
    }), await activeDesc());
    await page.keyboard.press('ArrowDown'); await sleep(250);
    check('history ↓ past bottom: crosses into the kept results', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#results li');
    }), await activeDesc());
    await $(() => {
        const a = document.querySelector('#search-history-area a[data-q]');
        if (a) a.focus();
    });
    await sleep(150);
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('history ↑ past top: crosses to the tab strip (not the box)',
        await focusedTab() === 'view-tab-search', await activeDesc());
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('strip ↑: back to the box',
        await $(() => document.activeElement && document.activeElement.id === 'search-input'),
        await activeDesc());

    // ====================================================================
    // View rendering: recent / stats / dead / dupes
    // ====================================================================
    console.log('═══ 视图渲染 ═══');
    await page.click('#view-tab-recent'); await sleep(900);
    const recent = await $(() => ({
        rows: document.querySelectorAll('#recent-list li.vbm-row').length,
        groupHeads: document.querySelectorAll('#recent-list .recent-group-head').length,
        timeLabels: [...document.querySelectorAll('#recent-list .row-path')]
            .filter(el => el.textContent.trim()).length
    }));
    check('Recent: rows render', recent.rows > 0, `rows:${recent.rows}`);
    check('Recent: coarse time group heads', recent.groupHeads > 0, `heads:${recent.groupHeads}`);
    check('Recent: relative-time right slot', recent.timeLabels > 0);

    await page.click('#view-tab-stats'); await sleep(700);
    check('Stats: list renders (empty state or rows)',
        await $(() => document.querySelectorAll('#stats-list li').length > 0));

    await page.click('#view-tab-dead'); await sleep(700);
    check('Dead: list renders (start hint)', await $(() => {
        const el = document.getElementById('dead-list');
        return !!el && el.querySelectorAll('li').length > 0;
    }));

    await page.click('#view-tab-dupes'); await sleep(1000);
    const dupes = await $(() => ({
        groups: document.querySelectorAll('#dupes-list .dupes-group').length,
        pill: !!document.querySelector('#dupes-list .count-pill'),
        strategy: !!document.querySelector('#dupes-list .vbm-dropdown.dupes-strategy'),
        scope: !!document.querySelector('#dupes-list .vbm-dropdown.dupes-scope'),
        keeper: document.querySelectorAll('#dupes-list .keeper-radio.checked').length
    }));
    check('Dupes: one group from the seeded pair', dupes.groups === 1, `groups:${dupes.groups}`);
    check('Dupes: count pill', dupes.pill);
    check('Dupes: strategy + scope controls', dupes.strategy && dupes.scope);
    check('Dupes: exactly one keeper checked', dupes.keeper === 1, String(dupes.keeper));

    // ====================================================================
    // v4 task-4 #6: palette custom commands — the slash dispatch into a
    // seeded pair (open-url-group on the 工作区 folder + a url-template),
    // the ↑↓/Home/End walk over custom rows, the → edit/delete menu and
    // the save-as hand-off into the options editor. The palette is opened
    // through the tool button: its Ctrl/Cmd+K binding is a capture-phase
    // listener, which CDP never reaches (docs/cdp-escape-limitation.md).
    // ====================================================================
    console.log('═══ 面板自定义指令（v4 task-4 #6）═══');
    // Loopback URLs: 127.0.0.1:9 refuses fast — external URLs would hang the
    // navigationless DinD network and wedge the CDP session.
    const ccSeed = await $(async () => {
        const create = p => new Promise(res => chrome.bookmarks.create(p, res));
        const folder = await create({ parentId: '1', title: '面板组' });
        await create({ parentId: folder.id, title: 'One', url: 'http://127.0.0.1:9/one' });
        await create({ parentId: folder.id, title: 'Two', url: 'http://127.0.0.1:9/two' });
        await create({ parentId: folder.id, title: 'Three', url: 'http://127.0.0.1:9/three' });
        const cmds = [
            { id: 'cc_work', name: 'Work apps', slash: 'work', aliases: ['wo'],
              action: { type: 'open-url-group', folderId: folder.id, where: 'tab' },
              createdAt: 1, useCount: 0, lastUsedAt: 0 },
            { id: 'cc_kimi', name: 'Kimi search', slash: 'g', aliases: [],
              action: { type: 'url-template', template: 'http://127.0.0.1:9/search?q=%s', where: 'tab' },
              createdAt: 2, useCount: 0, lastUsedAt: 0 }
        ];
        await new Promise(r => chrome.storage.sync.set({ paletteCustomCommands: JSON.stringify(cmds) }, r));
        return folder.id;
    });
    check('custom commands seeded into the sync area', !!ccSeed);
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(1500);

    // '/wo': builtin fuzzy hits first, the custom group row last.
    await page.click('#tool-btn'); await sleep(400);
    check('tool button opens the palette', await $(() => {
        const p = document.getElementById('command-palette');
        return !!p && !p.hidden;
    }));
    await page.type('#palette-input', '/wo', { delay: 30 }); await sleep(400);
    let cc = await $(() => {
        const rows = [...document.querySelectorAll('#palette-results li')];
        const last = rows[rows.length - 1];
        return {
            total: rows.length,
            lastIsCustom: !!last && last.classList.contains('palette-command-custom'),
            ccId: last && last.dataset.ccId,
            tagged: !!last && !!last.querySelector('.palette-custom-tag'),
            slash: !!last && (last.querySelector('.palette-slash') || {}).textContent
        };
    });
    check('/wo: the custom group row lands last (builtins keep table order)',
        cc.total >= 2 && cc.lastIsCustom && cc.ccId === 'cc_work', JSON.stringify(cc));
    check('custom row: tag + every slash form as the suffix',
        cc.tagged && cc.slash === '/work /wo', cc.slash);

    // The ↑↓/End walk treats custom rows like any other row.
    await page.keyboard.press('End'); await sleep(200);
    const selAfterEnd = await $(() =>
        [...document.querySelectorAll('#palette-results li')]
            .findIndex(li => li.classList.contains('selected')));
    check('End: selects the custom row', selAfterEnd === cc.total - 1, `idx:${selAfterEnd}`);
    await page.keyboard.press('ArrowUp'); await sleep(200);
    const selAfterUp = await $(() =>
        [...document.querySelectorAll('#palette-results li')]
            .findIndex(li => li.classList.contains('selected')));
    check('↑: moves off the custom row', selAfterUp === cc.total - 2, `idx:${selAfterUp}`);
    await page.keyboard.press('ArrowDown'); await sleep(200);

    // → on a custom row opens its own edit/delete menu (not the bookmark one).
    await page.keyboard.press('ArrowRight'); await sleep(300);
    check('→ on the custom row opens the edit/delete menu', await $(() => {
        const m = document.getElementById('palette-cmd-context-menu');
        const item = id => (document.getElementById(id) || {}).textContent || '';
        return !!m && m.style.opacity === '1' && !!item('palette-cmd-edit') && !!item('palette-cmd-delete');
    }), await $(() => {
        const m = document.getElementById('palette-cmd-context-menu');
        return m ? `opacity:${m.style.opacity}` : '(missing)';
    }));

    // Executing the group opens the folder's bookmarks as tabs.
    await page.click('#tool-btn'); await sleep(400); // menu+panel cycle closed/open
    await page.type('#palette-input', '/wo', { delay: 30 }); await sleep(300);
    await page.keyboard.press('End'); await sleep(150);
    await page.keyboard.press('Enter'); await sleep(800);
    const groupTabs = await $(async () => {
        const tabs = await new Promise(r => chrome.tabs.query({}, r));
        return tabs.map(t => t.url).filter(u =>
            /127\.0\.0\.1:9\/(one|two|three)/.test(u));
    });
    check('/wo Enter: the folder opens as a URL group', groupTabs.length === 3, `tabs:${groupTabs.length}`);
    check('the panel closed behind the execution', await $(() =>
        document.getElementById('command-palette').hidden));

    // The url-template fills %s from the slash rest words. The group run
    // foregrounded one of its new tabs; a backgrounded page still answers
    // Runtime.evaluate but a page.click (needs layout) wedges until
    // protocolTimeout — reclaim the foreground before clicking again.
    await page.bringToFront(); await sleep(300);
    await page.click('#tool-btn'); await sleep(400);
    await page.type('#palette-input', '/g kimi code', { delay: 30 }); await sleep(300);
    await page.keyboard.press('Enter'); await sleep(800);
    const tplTabs = await $(async () => {
        const tabs = await new Promise(r => chrome.tabs.query({}, r));
        return tabs.map(t => t.url).filter(u => /127\.0\.0\.1:9\/search/.test(u));
    });
    check('/g kimi code: %s filled, opened in a new tab',
        tplTabs.some(u => u.includes('q=kimi%20code')), tplTabs.join(','));

    // A hitless slash query offers the save-as closure; Enter hands over to
    // the options editor with the slash prefilled. (Foreground again: the
    // template run opened its tab active.)
    await page.bringToFront(); await sleep(300);
    await page.click('#tool-btn'); await sleep(400);
    await page.type('#palette-input', '/nosuchcmd', { delay: 30 }); await sleep(300);
    check('hitless slash query: the save-as-command row', await $(() => {
        const rows = [...document.querySelectorAll('#palette-results li')];
        return rows.length === 1 && /as a command/i.test(rows[0].textContent);
    }), await $(() => (document.querySelector('#palette-results li') || {}).textContent));
    await page.keyboard.press('Enter'); await sleep(1200);
    const optPage = (await browser.pages()).find(p => p.url().includes('pages/options.html'));
    check('save-as row opens the options editor in a tab', !!optPage);
    if (optPage) {
        await sleep(800);
        const pre = await optPage.evaluate(() => ({
            formOpen: !!document.getElementById('palette-cmd-form') &&
                !document.getElementById('palette-cmd-form').hidden,
            slash: (document.getElementById('pc-slash') || {}).value
        }));
        check('editor open with the slash prefilled', pre.formOpen && pre.slash === 'nosuchcmd',
            JSON.stringify(pre));
        await optPage.close();
    }
    // Closing the options tab may leave the panel page backgrounded; reclaim
    // the foreground before the reload + keyboard walk below.
    await page.bringToFront(); await sleep(300);

    // ====================================================================
    // §7 banner keyboard reachability (keyboard-model §5/§7): the donation
    // card is transient chrome — never an arrow rung, but its controls join
    // the Tab ring at their visual spot whenever the card is up. Seeding a
    // donationFactor past any snoozed donationKey forces it on at reload.
    // (Esc dismissal stays in vitest — docs/cdp-escape-limitation.md.)
    // ====================================================================
    console.log('═══ §7 横幅键盘可达 ═══');
    await $(() => new Promise(r => chrome.storage.local.set({ donationFactor: '9999' }, r)));
    await page.reload({ waitUntil: 'networkidle0' }); await sleep(1200);
    check('banner up after the seeded reload', await $(() => {
        const d = document.getElementById('donation');
        return !!d && d.style.display !== 'none' && d.offsetHeight > 0;
    }), await $(() => {
        const d = document.getElementById('donation');
        return d ? `display:${d.style.display} h:${d.offsetHeight}` : '(missing)';
    }));
    await page.focus('#tool-btn'); await sleep(150);
    await page.keyboard.press('Tab'); await sleep(150);
    check('Tab: tool → banner first control (go)',
        await $(() => document.activeElement && document.activeElement.id === 'donation-go'),
        await activeDesc());
    await page.keyboard.press('Tab'); await sleep(150);
    check('Tab: go → later',
        await $(() => document.activeElement && document.activeElement.id === 'donation-later'),
        await activeDesc());
    await page.keyboard.press('Tab'); await sleep(150);
    check('Tab: later → never',
        await $(() => document.activeElement && document.activeElement.id === 'donation-never'),
        await activeDesc());
    await page.keyboard.press('Tab'); await sleep(150);
    check('Tab: never → the active view tab',
        await $(() => document.activeElement && /^view-tab-/.test(document.activeElement.id)),
        await activeDesc());
    await page.keyboard.press('Tab'); // Shift not needed — walk on into the view
    await sleep(150);
    check('Tab: strip → view content (toolbar control or row)',
        await $(() => {
            const el = document.activeElement;
            return !!el && !!el.closest('#views');
        }), await activeDesc());
    // Dismissing the card (the Later path) removes the rung from the ring.
    await page.click('#donation-later'); await sleep(300);
    check('Later dismisses the card', await $(() => {
        const d = document.getElementById('donation');
        return d && d.style.display === 'none';
    }));
    await page.focus('#tool-btn'); await sleep(150);
    await page.keyboard.press('Tab'); await sleep(150);
    check('Tab: tool → active tab directly (banner rung gone)',
        await $(() => document.activeElement && /^view-tab-/.test(document.activeElement.id)),
        await activeDesc());

    // ====================================================================
    // Summary (+ zero page errors gate)
    // ====================================================================
    check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
    console.log(`\n═══ ${PASS.length} pass, ${FAIL.length} fail ═══`);
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})().catch(e => { console.error('VERIFY FAIL:', e.message); process.exit(2); });
