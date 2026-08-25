// Batch-4 diagnostics: selection-mode toolbar ↓ walk into expanded groups,
// the selecting connectors' alignment, and the head icons' vertical centering.
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
        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
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
            items.push({ id: null, url: 'http://127.0.0.1:9/snap/1', title: 'zzsnap 1', ts: now, group: 'g1' });
            await new Promise(r => chrome.storage.local.set({
                staging: JSON.stringify({
                    v: 1, items,
                    groups: [{ id: 'g1', name: 'Group One', collapsed: false, createdAt: now - 5000 }],
                    recentCollapsed: false, unfavCollapsed: false, headCollapsed: false,
                    recentGroupCollapsed: {}, lastSeenTs: now - 3600000
                }),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await page.click('#view-tab-recent');
        await sleep(900);

        // --- head icon vertical alignment (idle mode) ----------------------
        console.log('align idle:', await page.evaluate(() => {
            const centers = sel => [...document.querySelectorAll(sel)].slice(0, 12).map(el => {
                const r = el.getBoundingClientRect();
                return Math.round((r.top + r.bottom) / 2 * 10) / 10;
            });
            const bigHead = document.getElementById('staging-head');
            const bigItems = [...bigHead.children].map(el => ({
                cls: el.className.split(' ')[0],
                cy: Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2 * 10) / 10
            }));
            const gHead = document.querySelector('.staging-group-head');
            const gItems = [...gHead.children].map(el => ({
                cls: el.className.split(' ')[0],
                cy: Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2 * 10) / 10
            }));
            return JSON.stringify({
                bigHeadH: Math.round(bigHead.getBoundingClientRect().height),
                bigItems, gItems,
                gHeadH: Math.round(gHead.getBoundingClientRect().height)
            });
        }));

        // --- selection mode: toolbar walk + connector geometry --------------
        await page.evaluate(() => document.querySelector('.staging-select-mode').click());
        await sleep(700);
        const walk = await page.evaluate(() => new Promise(res => {
            const describe = () => {
                const el = document.activeElement;
                if (!el || !el.closest) return '<none>';
                const li = el.closest('li');
                return `${el.tagName.toLowerCase()}.${(el.className || '').split(' ')[0]}@${li ? (li.id || li.className.split(' ')[0]) : 'toolbar'}`;
            };
            const first = document.querySelector('.staging-select-toolbar button:not([disabled])');
            if (first) first.focus();
            const seq = [describe()];
            const step = i => {
                if (i >= 10) return res(seq);
                document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
                setTimeout(() => { seq.push(describe()); step(i + 1); }, 90);
            };
            step(0);
        }));
        console.log('sel toolbar walk:', JSON.stringify(walk));
        console.log('sel connectors:', await page.evaluate(() => {
            const out = { trunk: null, memberTick: null, memberIconLeft: null, headChev: null };
            const headLi = document.querySelector('#staging-items li.staging-group');
            const cs = getComputedStyle(headLi, '::after');
            out.trunk = { left: headLi.getBoundingClientRect().left + parseFloat(cs.insetInlineStart || getComputedStyle(headLi, '::after').left), top: cs.top, displayed: cs.display };
            const member = document.querySelector('#staging-items li.staging-member');
            const conn = member.querySelector('.staging-connector');
            const ccs = getComputedStyle(conn);
            out.memberTick = { left: Math.round(conn.getBoundingClientRect().left * 10) / 10, w: ccs.width };
            const anchor = member.querySelector('a');
            out.memberIconLeft = Math.round((anchor.getBoundingClientRect().left) * 10) / 10;
            const chev = headLi.querySelector('.chevron');
            const cr = chev.getBoundingClientRect();
            out.headChev = { left: Math.round(cr.left * 10) / 10, cx: Math.round((cr.left + cr.right) / 2 * 10) / 10 };
            return JSON.stringify(out);
        }));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
