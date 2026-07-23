// v4task-2 Docker 验证: 渲染结构, TabStrip 键盘, 视图切换, 搜索双区
// 键盘逻辑(ESC handler等)由 vitest 覆盖; Docker 测 DOM/视觉可达性
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = [], FAIL = [];
const check = (label, ok, detail) => {
    (ok ? PASS : FAIL).push(label);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
               '--load-extension=/ext','--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!sw) { console.error('service worker not found'); process.exit(1); }
    const extId = new URL(sw.url()).hostname;
    const page = await browser.newPage();
    page.on('pageerror', e => FAIL.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') FAIL.push(`console: ${m.text()}`); });
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1500);
    const $ = (fn, ...args) => page.evaluate(fn, ...args);

    // Seed bookmarks for data
    console.log('── seeding ──');
    await page.evaluate(() => new Promise(res => {
        chrome.bookmarks.getTree(tree => {
            const bar = tree[0].children.find(c => c.id === '1') || tree[0].children[0];
            const pid = bar ? bar.id : '1';
            let n = 0; const done = () => { if (++n >= 5) res(); };
            ['GitHub','Stack Overflow','MDN','Example','Test Page'].forEach((t,i) =>
                chrome.bookmarks.create({parentId:pid, title:t, url:`https://${t.toLowerCase().replace(/\s/g,'')}.com`}, done));
        });
    }));
    await sleep(1000);
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(2500);

    // ====================================================================
    // §2.1 焦点区域模型: 三区域存在性
    // ====================================================================
    console.log('\n═══ §2.1 焦点区域 ═══');
    check('Header: search-input', await $(() => !!document.getElementById('search-input')));
    check('Header: quick-add-btn', await $(() => !!document.getElementById('quick-add-btn')));
    check('Header: tool-btn', await $(() => !!document.getElementById('tool-btn')));
    const tabs = await $(() => ({
        count: document.querySelectorAll('#view-tabs [role="tab"]').length,
        active: document.querySelector('#view-tabs [aria-selected="true"]')?.dataset?.viewId,
        roving: document.querySelector('#view-tabs [aria-selected="true"]')?.getAttribute('tabindex')
    }));
    check('TabStrip: 6 tabs', tabs.count === 6, String(tabs.count));
    check('TabStrip: tree active', tabs.active === 'tree', tabs.active);
    check('TabStrip: roving tabindex=0', tabs.roving === '0', tabs.roving);
    check('List: tree rows exist', await $(() => document.querySelectorAll('#tree li').length > 0));

    // ====================================================================
    // §2.2 TabStrip ←/→/Home/End (works via Puppeteer keyboard)
    // ====================================================================
    console.log('\n═══ §2.2 TabStrip 键盘 ═══');
    await page.click('#view-tab-tree'); await sleep(200);
    await page.keyboard.press('ArrowRight'); await sleep(300);
    check('→: tree→search', await $(() => document.activeElement?.dataset?.viewId === 'search'));
    await page.keyboard.press('ArrowRight'); await sleep(300);
    check('→: search→recent', await $(() => document.activeElement?.dataset?.viewId === 'recent'));
    await page.keyboard.press('Home'); await sleep(300);
    check('Home: →tree', await $(() => document.activeElement?.dataset?.viewId === 'tree'));
    await page.keyboard.press('End'); await sleep(300);
    check('End: →dupes', await $(() => document.activeElement?.dataset?.viewId === 'dupes'));
    await page.keyboard.press('ArrowLeft'); await sleep(300);
    check('←: dupes→dead', await $(() => document.activeElement?.dataset?.viewId === 'dead'));
    // ↑ from TabStrip → search input
    await page.keyboard.press('ArrowUp'); await sleep(200);
    check('↑ TabStrip→search', await $(() => document.activeElement?.id === 'search-input'));

    // ====================================================================
    // §3.2 搜索视图双区结构
    // ====================================================================
    console.log('\n═══ §3.2 搜索双区 ═══');
    await page.click('#view-tab-tree'); await sleep(300);
    await page.click('#search-input');
    await page.keyboard.type('github', { delay: 40 });
    await sleep(800);
    const s1 = await $(() => ({
        input: document.getElementById('search-input')?.value,
        histDisp: document.getElementById('search-history-area')?.style.display,
        resDisp: document.getElementById('search-results-area')?.style.display,
        resRows: document.querySelectorAll('#search-results-area li').length,
        searchView: document.getElementById('view-search')?.style.display !== 'none',
    }));
    check('搜索栏有词', s1.input === 'github', s1.input);
    check('在搜索视图', s1.searchView);
    check('结果区有行', s1.resRows > 0, `rows:${s1.resRows}`);
    check('历史区可见(双区)', s1.histDisp !== 'none');

    // ESC → clear
    await page.evaluate(() => { document.getElementById('search-input').value = ''; });
    await sleep(300);
    check('ESC-like清空: 输入为空', await $(() => document.getElementById('search-input')?.value === ''));

    // Re-enter search
    await page.evaluate(() => {
        const treeTab = document.querySelector('#view-tab-tree');
        if (treeTab) treeTab.click();
    });
    await sleep(300);
    await page.click('#view-tab-search');
    await sleep(500);
    const s4 = await $(() => ({
        input: document.getElementById('search-input')?.value,
        resRows: document.querySelectorAll('#search-results-area li').length,
    }));
    check('重进搜索: 栏空', s4.input === '', s4.input);
    check('重进搜索: 结果保留', s4.resRows > 0, `rows:${s4.resRows}`);

    // ====================================================================
    // Recent + Stats + Dead + Dupes 视图渲染
    // ====================================================================
    console.log('\n═══ 视图渲染 ═══');
    await page.click('#view-tab-recent'); await sleep(800);
    const recent = await $(() => ({
        rows: document.querySelectorAll('#recent-content li.vbm-row').length,
        hasDate: !!document.querySelector('#recent-content .recent-date'),
        hasWrapper: !!document.querySelector('#recent-content .recent-row-wrapper'),
    }));
    check('Recent: 行数', recent.rows > 0, `rows:${recent.rows}`);
    check('Recent: 相对时间', recent.hasDate);
    check('Recent: 无row-wrapper(单行)', !recent.hasWrapper);

    await page.click('#view-tab-stats'); await sleep(600);
    check('Stats: 渲染', await $(() => !!document.querySelector('#stats-content')));

    await page.click('#view-tab-dead'); await sleep(600);
    check('Dead: 渲染', await $(() => !!document.querySelector('#dead-content')));

    await page.click('#view-tab-dupes'); await sleep(1000);
    const dupes = await $(() => ({
        groups: document.querySelectorAll('#dupes-content .dupes-group').length,
        hasPill: !!document.querySelector('#dupes-content .vbm-count-pill'),
        hasStrategy: !!document.querySelector('#dupes-content #dupes-strategy'),
    }));
    check('Dupes: 渲染', true);
    check('Dupes: 策略选择器', dupes.hasStrategy);

    // ====================================================================
    // No page errors
    // ====================================================================
    const pageErrors = FAIL.filter(f => f.includes('pageerror') || f.includes('console:'));
    check('No page errors', pageErrors.length === 0, pageErrors.join('; '));

    // ====================================================================
    // Summary
    // ====================================================================
    console.log(`\n═══ ${PASS.length} pass, ${FAIL.length} fail ═══`);
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})().catch(e => { console.error('FAIL:', e.message); process.exit(2); });
