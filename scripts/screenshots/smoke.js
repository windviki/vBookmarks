// vBookmarks headless-Chrome smoke test (runs inside zenika/alpine-chrome:with-puppeteer)
// Loads the extension from /ext, opens popup / panel / options pages,
// collects page errors and captures light/dark screenshots.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

    const errors = [];
    const watch = (page, tag) => {
        page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
        page.on('console', m => {
            if (m.type() === 'error') errors.push(`${tag} console.error: ${m.text()}`);
        });
    };

    // 1. service worker target → extension id
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found — manifest registration failed?');
    const extId = new URL(swTarget.url()).hostname;
    console.log('extension id:', extId);

    // 2. popup page (light)
    const page = await browser.newPage();
    watch(page, 'popup');
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    const stats = await page.evaluate(() => ({
        title: document.title,
        hasTree: !!document.querySelector('#tree'),
        treeRows: document.querySelectorAll('#tree li').length,
        theme: document.body.dataset.theme,
        quickAdd: !!document.querySelector('#quick-add-btn'),
        search: !!document.querySelector('#search')
    }));
    console.log('popup stats:', JSON.stringify(stats));

    // ====================================================================
    // v4 task 2 inspection: sync-indicator, tab badges, recent, search
    // ====================================================================
    const inspect = await page.evaluate(() => {
        const r = {};

        // 1. Sync-indicator in tree
        const dots = document.querySelectorAll('#tree .sync-indicator:not(.synced)');
        const dotInfos = [];
        dots.forEach((dot, i) => {
            const cs = getComputedStyle(dot);
            const rect = dot.getBoundingClientRect();
            dotInfos.push({
                w: cs.width, h: cs.height,
                rectW: Math.round(rect.width), rectH: Math.round(rect.height),
                pos: cs.position, bottom: cs.bottom, right: cs.right,
                borderRadius: cs.borderRadius,
                isCircle: cs.width === cs.height && (cs.borderRadius === '50%' || cs.borderRadius.includes('50%')),
            });
        });
        r.syncDotCount = dotInfos.length;
        r.syncDots = dotInfos.slice(0, 2);
        r.syncOK = dotInfos.length === 0 || dotInfos.every(d => d.isCircle && d.w === '6px');

        // 2. Tab badges
        const tabs = document.querySelectorAll('#view-tabs [role="tab"]');
        r.tabBadges = [];
        tabs.forEach(t => {
            const b = t.querySelector('.tab-badge');
            r.tabBadges.push({ id: t.dataset.viewId, hidden: b ? b.hidden : true, text: b ? b.textContent : '' });
        });

        // 3. Favicon-container sizing
        const fc = document.querySelector('#tree .favicon-container');
        if (fc) {
            const cs = getComputedStyle(fc);
            r.faviconContainer = { width: cs.width, position: cs.position };
        }

        // 4. Row-height token
        const rowH = getComputedStyle(document.documentElement).getPropertyValue('--vbm-row-h').trim();
        r.rowH = rowH;

        return r;
    });
    console.log('inspect:', JSON.stringify(inspect));
    if (!inspect.syncOK && inspect.syncDotCount > 0) {
        console.log('WARNING: sync-indicator not 6px circle!', JSON.stringify(inspect.syncDots));
    }

    // Switch to dupes view, check badge and rendering
    const dupesTab = await page.$('#view-tab-dupes');
    if (dupesTab) { await dupesTab.click(); await sleep(600); }
    const dupesInspect = await page.evaluate(() => {
        const badge = document.querySelector('#view-tab-dupes .tab-badge');
        const summary = document.querySelector('#dupes-content .dupes-summary');
        const groups = document.querySelectorAll('#dupes-content .dupes-group');
        const firstPill = document.querySelector('#dupes-content .vbm-count-pill');
        const keeperRadio = document.querySelector('#dupes-content .vbm-keeper-radio.filled');
        return {
            badgeHidden: badge ? badge.hidden : true,
            badgeText: badge ? badge.textContent : '',
            summaryText: summary ? summary.textContent.trim() : '',
            groupCount: groups.length,
            firstPillText: firstPill ? firstPill.textContent.trim() : '',
            hasFilledKeeper: !!keeperRadio,
        };
    });
    console.log('dupes:', JSON.stringify(dupesInspect));

    // Recent view
    const recentTab = await page.$('#view-tab-recent');
    if (recentTab) { await recentTab.click(); await sleep(500); }
    const recentInspect = await page.evaluate(() => {
        const rows = document.querySelectorAll('#recent-content li.vbm-row');
        const first = rows[0];
        const wrapper = first ? first.querySelector('.recent-row-wrapper') : null;
        const date = first ? first.querySelector('.recent-date') : null;
        return {
            rowCount: rows.length,
            hasWrapper: !!wrapper,
            dateText: date ? date.textContent : '',
            firstRowHTML: first ? first.innerHTML.substring(0, 200) : '',
        };
    });
    console.log('recent:', JSON.stringify(recentInspect));

    // Search view ESC test
    const searchTab = await page.$('#view-tab-search');
    if (searchTab) { await searchTab.click(); await sleep(400); }
    const input = await page.$('#search-input');
    if (input) {
        await input.click();
        await input.type('test', { delay: 30 });
        await sleep(400);
    }
    const searchAfterType = await page.evaluate(() => ({
        inputVal: document.getElementById('search-input')?.value,
        historyAreaDisp: document.getElementById('search-history-area')?.style.display,
        resultsAreaDisp: document.getElementById('search-results-area')?.style.display,
    }));
    console.log('search typed:', JSON.stringify(searchAfterType));

    // ESC → should clear input, stay in search
    await page.keyboard.press('Escape');
    await sleep(400);
    const afterEsc1 = await page.evaluate(() => ({
        inputVal: document.getElementById('search-input')?.value,
        historyAreaDisp: document.getElementById('search-history-area')?.style.display,
        historyHTML: document.getElementById('search-history-area')?.innerHTML?.substring(0, 200),
        resultsAreaDisp: document.getElementById('search-results-area')?.style.display,
        viewTreeHidden: document.getElementById('view-tree')?.style.display === 'none',
    }));
    console.log('after 1st Esc:', JSON.stringify(afterEsc1));

    // ESC again → should go back to tree
    await page.keyboard.press('Escape');
    await sleep(400);
    const afterEsc2 = await page.evaluate(() => ({
        inputVal: document.getElementById('search-input')?.value,
        viewTreeVisible: document.getElementById('view-tree')?.style.display !== 'none',
    }));
    console.log('after 2nd Esc:', JSON.stringify(afterEsc2));

    // Back to tree for screenshot
    await page.evaluate(() => {
        const treeTab = document.querySelector('#view-tab-tree');
        if (treeTab) treeTab.click();
    });
    await sleep(300);

    await page.screenshot({ path: '/tmp/shots/popup-light.png' });

    // 3. dark mode via emulated prefers-color-scheme (theme=auto default)
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(400);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    console.log('dark body bg:', darkBg);
    await page.screenshot({ path: '/tmp/shots/popup-dark.png' });

    // 4. side panel page
    const panel = await browser.newPage();
    watch(panel, 'panel');
    await panel.setViewport({ width: 360, height: 700 });
    await panel.goto(`chrome-extension://${extId}/pages/sidepanel.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    const isPanel = await panel.evaluate(() => document.body.classList.contains('panel-mode'));
    console.log('panel-mode:', isPanel);
    await panel.screenshot({ path: '/tmp/shots/panel-dark.png' });

    // 5. options page
    const opts = await browser.newPage();
    watch(opts, 'options');
    await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    const optsStats = await opts.evaluate(() => ({
        themeSelect: !!document.querySelector('#theme-select'),
        sidePanelRow: !!document.querySelector('#open-in-side-panel'),
        recentRow: !!document.querySelector('[id*="recent"]')
    }));
    console.log('options stats:', JSON.stringify(optsStats));
    await opts.screenshot({ path: '/tmp/shots/options.png' });

    // 6. advanced options page (vendored CodeMirror)
    const adv = await browser.newPage();
    watch(adv, 'advanced-options');
    await adv.goto(`chrome-extension://${extId}/pages/advanced-options.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    const advStats = await adv.evaluate(() => ({
        userstyle: !!document.querySelector('#userstyle'),
        codeMirror: !!document.querySelector('.CodeMirror'),
        iconPreview: !!document.querySelector('#custom-icon-preview img')
    }));
    console.log('advanced-options stats:', JSON.stringify(advStats));
    await adv.screenshot({ path: '/tmp/shots/advanced-options.png' });

    console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => {
    console.error('SMOKE FAIL:', e.message);
    process.exit(2);
});
