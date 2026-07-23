// v4task-2 精细 inspect: sync mark 尺寸, 搜索 ESC, tab 角标, recent 行, dupes 渲染
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
               '--load-extension=/ext','--disable-extensions-except=/ext']
    });
    const errors = [];
    const watch = (page, tag) => {
        page.on('pageerror', e => errors.push(`${tag}: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!sw) throw new Error('service worker not found');
    const extId = new URL(sw.url()).hostname;
    console.log('=== ext:', extId);

    const page = await browser.newPage();
    watch(page, 'popup');
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1500);

    // ── helper: page.evaluate shortcut ──
    const $ = (fn, ...args) => page.evaluate(fn, ...args);

    // ========================================================================
    // 1. Sync-indicator 尺寸 + 位置精确测量
    // ========================================================================
    console.log('\n── 1. sync-indicator 测量 ──');
    const syncInfo = await $(() => {
        const dots = document.querySelectorAll('#tree .sync-indicator:not(.synced)');
        const results = [];
        dots.forEach((dot, i) => {
            const cs = getComputedStyle(dot);
            const rect = dot.getBoundingClientRect();
            const parent = dot.closest('.favicon-container');
            const pRect = parent ? parent.getBoundingClientRect() : null;
            results.push({
                index: i,
                className: dot.className,
                width: cs.width,
                height: cs.height,
                rectW: Math.round(rect.width * 100) / 100,
                rectH: Math.round(rect.height * 100) / 100,
                borderRadius: cs.borderRadius,
                position: cs.position,
                bottom: cs.bottom,
                right: cs.right,
                parentW: pRect ? Math.round(pRect.width * 100) / 100 : null,
                parentH: pRect ? Math.round(pRect.height * 100) / 100 : null,
                isCircle: cs.width === cs.height && cs.borderRadius === '50%',
            });
        });
        return { count: dots.length, dots: results.slice(0, 3) };
    });
    console.log(JSON.stringify(syncInfo, null, 2));
    if (syncInfo.dots.length > 0) {
        const ok = syncInfo.dots.every(d => d.isCircle && d.width === '6px');
        console.log(ok ? '✓ sync-indicator 6px 正圆 OK' : '✗ sync-indicator 尺寸异常!');
    } else {
        console.log('(没有可见的 sync-indicator — 可能全部 synced 状态)');
    }

    // ========================================================================
    // 2. Tab 角标检查
    // ========================================================================
    console.log('\n── 2. Tab 角标 ──');
    const badges = await $(() => {
        const tabs = document.querySelectorAll('#view-tabs [role="tab"]');
        const info = [];
        tabs.forEach(t => {
            const badge = t.querySelector('.tab-badge');
            info.push({
                view: t.dataset.viewId,
                badgeExists: !!badge,
                badgeHidden: badge ? badge.hidden : null,
                badgeText: badge ? badge.textContent : null
            });
        });
        return info;
    });
    console.log(JSON.stringify(badges, null, 2));

    // 尝试切换到 dupes 视图触发数据加载
    console.log('切换到 dupes...');
    await page.click('#view-tab-dupes');
    await sleep(800);
    const badges2 = await $(() => {
        const tabs = document.querySelectorAll('#view-tabs [role="tab"]');
        const info = [];
        tabs.forEach(t => {
            const badge = t.querySelector('.tab-badge');
            info.push({
                view: t.dataset.viewId,
                badgeHidden: badge ? badge.hidden : null,
                badgeText: badge ? badge.textContent : null
            });
        });
        return info;
    });
    console.log('切换后:', JSON.stringify(badges2, null, 2));

    // ========================================================================
    // 3. Recent 视图行结构
    // ========================================================================
    console.log('\n── 3. Recent 视图 ──');
    await page.click('#view-tab-recent');
    await sleep(800);
    const recentInfo = await $(() => {
        const rows = document.querySelectorAll('#recent-content li.vbm-row');
        const info = [];
        rows.forEach((row, i) => {
            const date = row.querySelector('.recent-date');
            const path = row.querySelector('.row-path');
            const wrapper = row.querySelector('.recent-row-wrapper');
            info.push({
                index: i,
                hasRowWrapper: !!wrapper,
                dateText: date ? date.textContent : null,
                pathText: path ? path.textContent : null,
                childCount: row.children.length,
                // Check if it's single-line (only tree-item-link + meta in one row)
                displayStyle: row.style.display,
                totalHeight: row.getBoundingClientRect().height
            });
        });
        return { rowCount: rows.length, rows: info.slice(0, 3) };
    });
    console.log(JSON.stringify(recentInfo, null, 2));

    // ========================================================================
    // 4. 搜索视图 ESC 行为 + 双区
    // ========================================================================
    console.log('\n── 4. 搜索视图 ──');
    // 先切到搜索视图看初始状态
    await page.click('#view-tab-search');
    await sleep(500);

    const searchInit = await $(() => {
        const input = document.getElementById('search-input');
        const historyArea = document.getElementById('search-history-area');
        const resultsArea = document.getElementById('search-results-area');
        return {
            inputValue: input ? input.value : null,
            historyDisplay: historyArea ? historyArea.style.display : null,
            historyHTML: historyArea ? historyArea.innerHTML.substring(0, 200) : null,
            resultsDisplay: resultsArea ? resultsArea.style.display : null,
            resultsRows: resultsArea ? resultsArea.querySelectorAll('li').length : 0
        };
    });
    console.log('初始:', JSON.stringify(searchInit, null, 2));

    // 输入搜索关键词
    const input = await page.$('#search-input');
    await input.click();
    await input.type('github');
    await sleep(600);

    const searchAfterType = await $(() => {
        const historyArea = document.getElementById('search-history-area');
        const resultsArea = document.getElementById('search-results-area');
        return {
            inputValue: document.getElementById('search-input').value,
            historyDisplay: historyArea ? historyArea.style.display : null,
            historyVisible: historyArea ? historyArea.offsetHeight > 0 : false,
            resultsDisplay: resultsArea ? resultsArea.style.display : null,
            resultsRows: resultsArea ? resultsArea.querySelectorAll('li').length : 0,
            searchActive: document.getElementById('search-input').closest('body') ?
                document.body.classList.contains('searchFocus') : false
        };
    });
    console.log('输入 github 后:', JSON.stringify(searchAfterType, null, 2));

    // 首次 ESC — 应该清空搜索栏, 记录历史, 留在搜索视图
    await page.keyboard.press('Escape');
    await sleep(500);

    const afterEsc1 = await $(() => {
        const historyArea = document.getElementById('search-history-area');
        const resultsArea = document.getElementById('search-results-area');
        const viewSearch = document.getElementById('view-search');
        return {
            inputValue: document.getElementById('search-input').value,
            historyDisplay: historyArea ? historyArea.style.display : null,
            historyHTML: historyArea ? historyArea.innerHTML.substring(0, 300) : null,
            resultsDisplay: resultsArea ? resultsArea.style.display : null,
            resultsRows: resultsArea ? resultsArea.querySelectorAll('li').length : 0,
            // Check if we're still in search view (not tree)
            viewSearchVisible: viewSearch ? (viewSearch.style.display !== 'none') : false,
            treeVisible: document.getElementById('view-tree') ?
                (document.getElementById('view-tree').style.display !== 'none') : false
        };
    });
    console.log('首次 ESC 后:', JSON.stringify(afterEsc1, null, 2));

    // 二次 ESC — 应该退回树视图
    await page.keyboard.press('Escape');
    await sleep(400);

    const afterEsc2 = await $(() => {
        const viewSearch = document.getElementById('view-search');
        const viewTree = document.getElementById('view-tree');
        return {
            viewSearchVisible: viewSearch ? (viewSearch.style.display !== 'none') : false,
            viewTreeVisible: viewTree ? (viewTree.style.display !== 'none') : true,
            inputValue: document.getElementById('search-input').value,
        };
    });
    console.log('二次 ESC 后:', JSON.stringify(afterEsc2, null, 2));

    // 再次进入搜索视图 — 搜索栏应为空, 上区有历史, 下区有上次结果
    await page.click('#view-tab-search');
    await sleep(500);
    const reenter = await $(() => {
        const historyArea = document.getElementById('search-history-area');
        const resultsArea = document.getElementById('search-results-area');
        return {
            inputValue: document.getElementById('search-input').value,
            historyHTML: historyArea ? historyArea.innerHTML.substring(0, 300) : null,
            historyVisible: historyArea ? historyArea.offsetHeight > 0 : false,
            resultsRows: resultsArea ? resultsArea.querySelectorAll('li').length : 0
        };
    });
    console.log('再次进入搜索:', JSON.stringify(reenter, null, 2));

    // ========================================================================
    // 5. Dupes 视图
    // ========================================================================
    console.log('\n── 5. Dupes 视图 ──');
    await page.click('#view-tab-dupes');
    await sleep(1000);
    const dupesInfo = await $(() => {
        const groups = document.querySelectorAll('#dupes-content .dupes-group');
        const summary = document.querySelector('#dupes-content .dupes-summary');
        const strategy = document.querySelector('#dupes-content #dupes-strategy');
        const info = {
            groupCount: groups.length,
            summaryText: summary ? summary.textContent : null,
            strategyValue: strategy ? strategy.value : null,
            firstGroup: null
        };
        if (groups.length > 0) {
            const g = groups[0];
            const pill = g.querySelector('.vbm-count-pill');
            const url = g.querySelector('.dupes-group-url');
            const rows = g.querySelectorAll('.vbm-row:not(.dupes-group-header)');
            info.firstGroup = {
                countPill: pill ? pill.textContent : null,
                urlText: url ? url.textContent : null,
                memberCount: rows.length,
                keeperMark: rows.length > 0 ? rows[0].querySelector('.vbm-keeper-radio')?.className : null
            };
        }
        return info;
    });
    console.log(JSON.stringify(dupesInfo, null, 2));

    // ========================================================================
    // 6. Dead 视图
    // ========================================================================
    console.log('\n── 6. Dead 视图 ──');
    await page.click('#view-tab-dead');
    await sleep(600);
    const deadInfo = await $(() => {
        const rows = document.querySelectorAll('#dead-content .dead-row');
        const header = document.querySelector('#dead-content .dead-header');
        return {
            rowCount: rows.length,
            headerText: header ? header.textContent : null,
            firstRow: rows.length > 0 ? {
                badgeHtml: rows[0].querySelector('.vbm-badge')?.textContent,
                titleText: rows[0].querySelector('.vbm-title')?.textContent,
                height: Math.round(rows[0].getBoundingClientRect().height * 100) / 100
            } : null
        };
    });
    console.log(JSON.stringify(deadInfo, null, 2));

    // ========================================================================
    // 截图
    // ========================================================================
    await page.screenshot({ path: '/tmp/shots/inspect-tree.png' });
    console.log('\n截图: /tmp/shots/inspect-tree.png');

    // Errors
    if (errors.length) console.log('\nERRORS:\n' + errors.join('\n'));
    else console.log('\nNO ERRORS');

    await browser.close();
    process.exit(0);
})().catch(e => {
    console.error('INSPECT FAIL:', e.message, e.stack);
    process.exit(2);
});
