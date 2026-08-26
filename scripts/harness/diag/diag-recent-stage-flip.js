// Repro probe (2026-08-26 report): the recent time-bucket head's stage
// button (发送该组) must flip EVERY bucket row's send glyph to the filled
// plane — including rows that were NOT staged before, and including the
// append-into-an-existing-same-name-group path. The report: when the named
// target group already exists in staging, a never-sent row stays hollow.
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
        const targets = await browser.targets();
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(swTarget.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 900, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1500);

        const out = await page.evaluate(async () => {
            const sleep2 = ms => new Promise(r => setTimeout(r, ms));
            try {
                const create = props => new Promise(res => chrome.bookmarks.create(props, res));
                const tree = await new Promise(res => chrome.bookmarks.getTree(res));
                const bar = tree[0].children.find(c => c.id && !c.url && c.children);
                const folder = await create({ parentId: bar.id, title: '__recent_flip__' });
                const now = Date.now();
                const a = await create({ parentId: folder.id, title: 'flip A', url: 'http://127.0.0.1:9/flip/a' });
                const b = await create({ parentId: folder.id, title: 'flip B', url: 'http://127.0.0.1:9/flip/b' });
                // seed staging: an EXISTING group named after the today bucket
                // (en: "Today") holding only A
                const groupId = 'flip-group-1';
                const staging = {
                    v: 1,
                    items: [
                        { id: a.id, url: 'http://127.0.0.1:9/flip/a', title: 'flip A', ts: now, group: groupId }
                    ],
                    groups: [{ id: groupId, name: 'Today', collapsed: false, createdAt: now - 5000 }]
                };
                await new Promise(res => chrome.storage.local.set({ staging: JSON.stringify(staging) }, res));
                // switch to the recent view via the view tab
                const tab = document.getElementById('view-tab-recent');
                let viewFound = !!tab;
                if (tab)
                    tab.click();
                await sleep2(2000);
                const rows = [...document.querySelectorAll('#recent-list li')];
                const readStaged = () => {
                    // the REAL flip check: the SOLID plane svg (vbm-icon-stage-done)
                    // must be inside the button — .staged alone only re-tints the
                    // hollow plane and the report is precisely that the icon
                    // stayed hollow.
                    const m = {};
                    for (const li of document.querySelectorAll('#recent-list li')) {
                        const btn = li.querySelector('.staging-add-btn');
                        m[li.getAttribute('data-node-id')] = btn
                            ? !!btn.querySelector('svg.vbm-icon-stage-done') : null;
                    }
                    return m;
                };
                const before = readStaged();
                const headBtn = [...document.querySelectorAll('.recent-group-stage')][0];
                let clicked = false;
                if (headBtn) {
                    headBtn.click();
                    clicked = true;
                    await sleep2(800);
                }
                const after = readStaged();
                const stored = await new Promise(res => chrome.storage.local.get('staging', res));
                let landed = null;
                try {
                    const s = JSON.parse(stored.staging || '{}');
                    landed = (s.items || []).map(i => i.url);
                } catch (e) { landed = 'parse-error'; }
                return { viewFound, clicked, before, after, landed, rowCount: rows.length };
            } catch (e) {
                return { error: e.message };
            }
        });
        console.log(JSON.stringify(out, null, 1));
        const rowVals = out.after ? Object.values(out.after).filter(v => v !== null) : [];
        const ok = !out.error && out.viewFound && out.clicked && out.rowCount >= 2
            && rowVals.length >= 2 && rowVals.every(v => v === true)
            && out.landed && out.landed.includes('http://127.0.0.1:9/flip/b');
        console.log(ok ? 'DIAG PASS' : 'DIAG FAIL');
        process.exit(ok ? 0 : 1);
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
