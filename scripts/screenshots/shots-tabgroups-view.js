// vBookmarks tab-groups VIEW screenshot + functional suite (4.0.9).
//
// Captures the new tab-groups view itself (the view after Search): tabs and
// tab groups rendered from the current browser window, the selection-mode
// batch bar, and the group-head context menu. Also asserts the basics the
// unit suite cannot: the view registers its tab, renders a real Chrome tab
// group with title/color/count, and exposes the group-head menu items.
// Shots land in /tmp/shots/tabgroups-view with the 34- series.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots/tabgroups-view', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.tabs.create(p, r));
    const t1 = await create({ url: 'https://example.com', active: false });
    const t2 = await create({ url: 'https://developer.mozilla.org', active: false });
    const t3 = await create({ url: 'https://github.com/vBookmarks', active: false });
    const groupId = await new Promise(r => chrome.tabs.group({ tabIds: [t2.id, t3.id] }, r));
    await new Promise(r => chrome.tabGroups.update(groupId, { title: '工作区', color: 'blue' }, r));
    return { t1: t1.id, t2: t2.id, t3: t3.id, groupId };
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

    const errors = [];
    const watch = (page, tag) => {
        page.on('pageerror', e => {
            const msg = e.message;
            if (msg.includes('Failed to load resource') || msg.includes('net::') || msg.includes('Refused to'))
                return;
            errors.push(`${tag} pageerror: ${msg}`);
        });
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const txt = m.text();
            if (txt.includes('Failed to load resource') || txt.includes('net::') || txt.includes('Refused to'))
                return;
            errors.push(`${tag} console.error: ${txt}`);
        });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;

    const openPopup = async () => {
        const page = await browser.newPage();
        watch(page, 'tabgroups-view');
        await page.setViewport({ width: 400, height: 640 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await page.evaluate(() => chrome.storage.local.set({
            currentVersion: chrome.runtime.getManifest().version,
            donationFactor: 1,
            donationKey: 30
        }));
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(1000);
        return page;
    };

    // --- Seed tabs + a real tab group in the current window -----------------
    const seedPage = await openPopup();
    await seedPage.evaluate(SEED);
    await sleep(800);
    await seedPage.close();

    // --- Open the tab groups view -------------------------------------------
    const page = await openPopup();
    await page.evaluate(() => {
        const tab = document.querySelector('#view-tab-tabgroups');
        if (!tab) throw new Error('tabgroups view tab not found');
        tab.click();
    });
    await sleep(1500);

    // Real Chrome data must render: one group header with the chosen title,
    // blue dot, count pill, and three tab rows total.
    const viewHtml = await page.evaluate(() => {
        const list = document.querySelector('#tabgroups-list');
        if (!list) return { error: 'tabgroups list not found' };
        const group = list.querySelector('li.tabgroups-group');
        return {
            html: list.innerHTML.slice(0, 1500),
            group: !!group,
            dot: !!(group && group.querySelector('.tab-group-dot.tg-blue')),
            title: (group && group.querySelector('.tabgroups-group-title')?.textContent || ''),
            count: (group && group.querySelector('.count-pill')?.textContent || '').trim(),
            rows: list.querySelectorAll('li.tabgroups-row').length
        };
    });
    if (viewHtml.error) throw new Error(viewHtml.error);
    if (!viewHtml.group) throw new Error('group header not rendered');
    if (!viewHtml.dot) throw new Error('blue group dot not rendered');
    if (!/工作区/.test(viewHtml.title)) throw new Error('group title not rendered');
    if (viewHtml.count !== '2') throw new Error('group count pill wrong');
    if (viewHtml.rows < 3) throw new Error('expected at least 3 tab rows');
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/34-tabgroups-view.png' });

    // --- Selection mode ------------------------------------------------------
    await page.evaluate(() => {
        const btn = document.querySelector('.tabgroups-select-mode');
        if (!btn) throw new Error('select-mode button not found');
        btn.click();
    });
    await sleep(600);
    await page.evaluate(() => {
        const rows = document.querySelectorAll('#tabgroups-list li.tabgroups-row');
        if (!rows.length) throw new Error('no tab rows in selection mode');
        rows[0].click();
    });
    await sleep(400);
    await page.evaluate(() => {
        const count = document.querySelector('.tabgroups-toolbar .select-count');
        if (!count || !/1/.test(count.textContent || ''))
            throw new Error('selection count not updated');
    });
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/35-tabgroups-selection.png' });

    // --- Group-head context menu ---------------------------------------------
    await page.evaluate(() => {
        const head = document.querySelector('.tabgroups-group-head');
        if (!head) throw new Error('group head not found');
        head.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: 160, clientY: head.getBoundingClientRect().top + 10
        }));
    });
    await sleep(600);
    await page.evaluate(() => {
        for (const id of ['tabgroup-activate', 'tabgroup-rename', 'tabgroup-collapse',
            'tabgroup-save-folder', 'tabgroup-sleep', 'tabgroup-close'])
            if (!document.getElementById(id))
                throw new Error('group menu item missing: ' + id);
    });
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/36-tabgroups-group-menu.png' });

    await browser.close();

    const realErrors = errors.filter(e => !e.includes('net::'));
    if (realErrors.length) {
        console.error(realErrors.join('\n'));
        process.exit(1);
    }
    console.log('tabgroups-view suite OK — 34/35/36 captured, view + selection + group menu verified');
})();
