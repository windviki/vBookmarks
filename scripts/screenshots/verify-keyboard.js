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
// plus two rows in Other Bookmarks.
const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com/questions/tagged/chrome-extension' });
    const read = await create({ parentId: '1', title: '稍后读' });
    await create({ parentId: read.id, title: 'GitHub (mirror)', url: 'https://github.com/vBookmarks' });
    await create({ parentId: read.id, title: 'A List Apart', url: 'https://alistapart.com/topic/typography' });
    await create({ parentId: '2', title: 'Awwwards', url: 'https://www.awwwards.com' });
    await create({ parentId: '2', title: 'Hacker News', url: 'https://news.ycombinator.com' });
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
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
        page.on('pageerror', e => pageErrors.push(`pageerror: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); });
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
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const $ = (fn, ...args) => page.evaluate(fn, ...args);

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
    check('Home: →tree', await focusedTab() === 'view-tab-tree');
    // ↓ from the strip enters the active view's list (first row takes focus)
    await page.keyboard.press('ArrowDown'); await sleep(400);
    check('↓: strip→list (tree row focused)', await $(() => {
        const el = document.activeElement;
        return !!el && !!el.closest('#view-tree') && el !== document.getElementById('view-tab-tree');
    }), await $(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
    await page.click('#view-tab-tree'); await sleep(300);
    await page.keyboard.press('End'); await sleep(300);
    check('End: →dupes', await focusedTab() === 'view-tab-dupes');
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
        strategy: !!document.querySelector('#dupes-list select.dupes-strategy'),
        scope: !!document.querySelector('#dupes-list select.dupes-scope'),
        keeper: document.querySelectorAll('#dupes-list .keeper-radio.checked').length
    }));
    check('Dupes: one group from the seeded pair', dupes.groups === 1, `groups:${dupes.groups}`);
    check('Dupes: count pill', dupes.pill);
    check('Dupes: strategy + scope controls', dupes.strategy && dupes.scope);
    check('Dupes: exactly one keeper checked', dupes.keeper === 1, String(dupes.keeper));

    // ====================================================================
    // Summary (+ zero page errors gate)
    // ====================================================================
    check('no page errors', pageErrors.length === 0, pageErrors.join('; '));
    console.log(`\n═══ ${PASS.length} pass, ${FAIL.length} fail ═══`);
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})().catch(e => { console.error('VERIFY FAIL:', e.message); process.exit(2); });
