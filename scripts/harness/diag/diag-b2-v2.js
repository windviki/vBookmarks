// Batch-2 diagnostics v2: real-mouse history clicks (hit-testing!), synthetic
// keydown walks (CDP key events never reach container capture listeners),
// staging walk from a LOOSE row, tabgroups seeded before the popup opens,
// virtual OFF then ON, plus a panel-mode history pass.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const launch = () => puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--load-extension=/ext', '--disable-extensions-except=/ext']
});

const walk = (page, n) => page.evaluate(count => new Promise(res => {
    const describe = () => {
        const el = document.activeElement;
        if (!el || !el.closest) return '<none>';
        const li = el.closest('li');
        return `${el.tagName.toLowerCase()}@${li ? (li.id || li.className.split(' ')[0]) : '?'}`;
    };
    const seq = [describe()];
    const step = i => {
        if (i >= count) return res(seq);
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', bubbles: true, cancelable: true
        }));
        setTimeout(() => { seq.push(describe()); step(i + 1); }, 90);
    };
    step(0);
}), n);

(async () => {
    const browser = await launch();
    try {
        await sleep(2000);
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;

        // --- seed tabs + groups FIRST, from a throwaway popup page ---------
        const seedPage = await browser.newPage();
        await seedPage.evaluateOnNewDocument(() => { window.close = () => {}; });
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await seedPage.evaluate(async () => {
            const create = p => new Promise(r => chrome.tabs.create(p, r));
            const group = (t, props) => new Promise(r => chrome.tabs.group({ tabIds: [t.id] }, gid =>
                chrome.tabGroups.update(gid, props, () => r(gid))));
            for (let i = 0; i < 8; i++) {
                const t = await create({ url: `http://127.0.0.1:9/tg/${i}`, active: false });
                if (i === 1 || i === 2) await group(t, { title: `G${i}`, color: 'blue' });
                if (i === 4) await group(t, { title: 'G4', color: 'green' });
            }
        });
        await sleep(500);
        await seedPage.close();

        // --- the measurement popup -----------------------------------------
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: 'zzfolder' });
            const now = Date.now();
            const items = [];
            for (let i = 0; i < 4; i++) {
                const url = `http://127.0.0.1:9/stg/${i}`;
                const n = await create({ parentId: folder.id, title: `zzstaging ${i}`, url });
                items.push({ id: n.id, url, title: `zzstaging ${i}`, ts: now - i * 1000, group: i < 2 ? 'g1' : null });
            }
            items.push({ id: null, url: 'http://127.0.0.1:9/snap/1', title: 'zzsnap 1', ts: now, group: null });
            await new Promise(r => chrome.storage.local.set({
                staging: JSON.stringify({
                    v: 1, items,
                    groups: [{ id: 'g1', name: 'Group One', collapsed: false, createdAt: now - 5000 }],
                    recentCollapsed: false, unfavCollapsed: false, headCollapsed: false,
                    recentGroupCollapsed: {}, lastSeenTs: now - 3600000
                }),
                searchHistory: JSON.stringify([
                    { q: 'zzalpha', ts: now - 60e3, n: 3 },
                    { q: 'zzbeta', ts: now - 120e3, n: 5 }
                ]),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // --- A. search history with REAL mouse (hit-tested) ----------------
        await page.click('#view-tab-search');
        await sleep(600);
        const hover = await page.evaluate(async () => {
            const li = document.querySelector('#search-history-area li.search-history-row');
            li.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            await new Promise(r => setTimeout(r, 100));
            const btn = li.querySelector('.search-history-remove');
            return { vis: getComputedStyle(btn).visibility, liHover: li.matches(':hover') };
        });
        console.log('A synth-hover:', JSON.stringify(hover));
        const link = await page.$('#search-history-area a[data-q]');
        const lr = await link.boundingBox();
        await page.mouse.click(lr.x + lr.width / 2, lr.y + lr.height / 2);
        await sleep(400);
        console.log('A real-mouse rerun:', await page.evaluate(() => JSON.stringify({
            inputValue: document.getElementById('search-input').value
        })));
        // elementFromPoint at the link center — who really receives the click?
        console.log('A hit test:', await page.evaluate(() => {
            const a = document.querySelector('#search-history-area a[data-q]');
            if (!a) return 'no-link';
            const r = a.getBoundingClientRect();
            const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return el ? `${el.tagName}.${el.className.split(' ')[0] || ''}` : 'null';
        }));
        // where did the click land? clear input again, then click row ×2 via mouse
        await page.evaluate(() => {
            const input = document.getElementById('search-input');
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await sleep(200);

        // --- B. selection mode geometry ------------------------------------
        await page.type('#search-input', 'zz');
        await sleep(700);
        console.log('B idle bar:', await page.evaluate(() => {
            const bar = document.querySelector('#results .search-toolbar');
            const btn = bar.querySelector('.search-select-mode');
            const rb = bar.getBoundingClientRect();
            const bb = btn.getBoundingClientRect();
            return JSON.stringify({ barRight: Math.round(rb.right), btnRight: Math.round(bb.right), atRightEdge: Math.abs(rb.right - bb.right) < 12 });
        }));
        await page.evaluate(() => document.querySelector('#results .search-select-mode').click());
        await sleep(400);
        console.log('B selecting:', await page.evaluate(() => {
            const li = document.querySelector('#results-ul li.vbm-row');
            const cs = getComputedStyle(li);
            const before = getComputedStyle(li, '::before');
            return JSON.stringify({
                display: cs.display, h: Math.round(li.getBoundingClientRect().height),
                beforeW: before.width, beforeH: before.height
            });
        }));

        // --- C. staging walk from the FIRST loose row (synthetic keys) -----
        await page.click('#view-tab-recent');
        await sleep(900);
        const structure = await page.evaluate(() => {
            const out = [];
            for (const li of document.querySelectorAll('#staging-items > li'))
                out.push(li.id || li.className.split(' ')[0]);
            return out;
        });
        console.log('C staging DOM order:', JSON.stringify(structure));
        await page.evaluate(() => {
            const loose = [...document.querySelectorAll('#staging-items li.staging-row')]
                .find(li => !li.classList.contains('staging-member'));
            loose.querySelector('a').focus();
        });
        console.log('C staging walk:', JSON.stringify(await walk(page, 10)));

        // --- D. tabgroups walk (virtual OFF → ON) ---------------------------
        await page.click('#view-tab-tabgroups');
        await sleep(1500);
        console.log('D tg DOM (virtual OFF):', await page.evaluate(() => {
            const out = [];
            document.querySelectorAll('#tabgroups-list ul > li').forEach(li =>
                out.push(li.id || li.className.split(' ')[0]));
            return out;
        }));
        await page.evaluate(() => {
            const first = document.querySelector('#tabgroups-list a, #tabgroups-list span');
            if (first) first.focus();
        });
        console.log('D tg walk (virtual OFF):', JSON.stringify(await walk(page, 14)));
        await page.evaluate(() => chrome.storage.local.set({ virtualScrollLab: '1' }));
        await sleep(1500);
        console.log('D virtual info:', await page.evaluate(() => {
            const ul = document.querySelector('#tabgroups-list ul');
            return JSON.stringify({
                lis: ul.children.length, padTop: ul.style.paddingTop, padBottom: ul.style.paddingBottom
            });
        }));
        await page.evaluate(() => {
            const first = document.querySelector('#tabgroups-list a, #tabgroups-list span');
            if (first) first.focus();
        });
        console.log('D tg walk (virtual ON):', JSON.stringify(await walk(page, 14)));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
