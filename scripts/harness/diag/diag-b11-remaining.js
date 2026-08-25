// Measure the three remaining misalignments: (1) search-history × vs results
// delete; (2) tabgroups window head icons vs row columns; (3) staging group
// head quick-tail vs member row icons.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2000);
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;

        const seedPage = await browser.newPage();
        await seedPage.evaluateOnNewDocument(() => { window.close = () => {}; });
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await seedPage.evaluate(async () => {
            const create = p => new Promise(r => chrome.tabs.create(p, r));
            const group = (t, props) => new Promise(r => chrome.tabs.group({ tabIds: [t.id] }, gid =>
                chrome.tabGroups.update(gid, props, () => r(gid))));
            for (let i = 0; i < 3; i++) {
                const t = await create({ url: `http://127.0.0.1:9/tg/${i}`, active: false });
                if (i === 0) await group(t, { title: 'GX', color: 'blue' });
            }
        });
        await sleep(400);
        await seedPage.close();

        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1300);
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const f = await create({ parentId: bar.id, title: 'zzf' });
            for (let i = 0; i < 3; i++)
                await create({ parentId: f.id, title: `zzp ${i}`, url: `http://127.0.0.1:9/p/${i}` });
            const now = Date.now();
            await new Promise(r => chrome.storage.local.set({
                searchHistory: JSON.stringify([{ q: 'zzalpha', ts: now - 60e3, n: 3 }]),
                staging: JSON.stringify({
                    v: 1,
                    items: [{ id: null, url: 'http://127.0.0.1:9/p/0', title: 'p0', ts: now, group: 'g1' },
                            { id: null, url: 'http://127.0.0.1:9/p/1', title: 'p1', ts: now - 1, group: 'g1' }],
                    groups: [{ id: 'g1', name: 'G1', collapsed: false, createdAt: now - 5000 }],
                    recentCollapsed: false, unfavCollapsed: false, headCollapsed: false,
                    recentGroupCollapsed: {}, lastSeenTs: now - 3600000
                }),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        const cx = els => [...els].map(el => {
            const r = el.getBoundingClientRect();
            return { c: Math.round(r.left + r.width / 2), w: Math.round(r.width) };
        });

        // 1) search: history × vs results delete
        await page.click('#view-tab-search');
        await sleep(500);
        await page.type('#search-input', 'zz');
        await sleep(700);
        console.log('search:', await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return { c: Math.round(r.left + r.width / 2), w: Math.round(r.width) }; });
            const hist = document.querySelector('.search-history-row .search-history-remove');
            const res = document.querySelector('#results-ul li.vbm-row .search-row-del');
            const histLi = document.querySelector('.search-history-row');
            return JSON.stringify({
                histRemove: hist ? cx([hist]) : null,
                resDelete: res ? cx([res]) : null,
                histLiPadEnd: getComputedStyle(histLi).paddingInlineEnd
            });
        }));

        // 2) tabgroups window head vs rows
        await page.click('#view-tab-tabgroups');
        await sleep(1600);
        console.log('tabgroups:', await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return { c: Math.round(r.left + r.width / 2), w: Math.round(r.width) }; });
            const head = document.querySelector('.tabgroups-window-head-row');
            const row = document.querySelector('.tabgroups-row');
            return JSON.stringify({
                headBtns: cx(head.querySelectorAll('.row-btn')),
                headPadEnd: getComputedStyle(head).paddingInlineEnd,
                rowIcons: cx(row.querySelectorAll('.row-btn, .tabgroups-slot, .tabgroups-status-icon'))
            });
        }));

        // 3) staging group head vs member rows
        await page.click('#view-tab-recent');
        await sleep(900);
        console.log('staging:', await page.evaluate(() => {
            const cx = els => [...els].map(el => { const r = el.getBoundingClientRect(); return { c: Math.round(r.left + r.width / 2), w: Math.round(r.width) }; });
            const head = document.querySelector('.staging-group-head');
            const member = document.querySelector('#staging-items li.staging-member');
            const loose = document.querySelector('#staging-items li.staging-row:not(.staging-member)');
            return JSON.stringify({
                headBtns: head ? cx(head.querySelectorAll('.row-btn')) : null,
                headPadEnd: head ? getComputedStyle(head).paddingInlineEnd : null,
                memberIcons: member ? cx(member.querySelectorAll('.row-btn')) : null,
                memberPadEnd: member ? getComputedStyle(member).paddingInlineEnd : null,
                looseIcons: loose ? cx(loose.querySelectorAll('.row-btn')) : null
            });
        }));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
