// Report round 2 probe: a TAB dragged onto a WINDOW HEAD appends to that
// window's END (index -1). The move goes through chrome.tabs.move with
// index:-1, and the popup's window stays focused afterwards (the moved tab
// is the source window's ACTIVE tab — the cross-window move would focus
// the target without the refocus guard).
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
        await page.setViewport({ width: 420, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);

        const winIds = await page.evaluate(async () => {
            const mk = urls => new Promise(res => chrome.windows.create({ url: urls, focused: false }, w => res(w.id)));
            const a = await mk(['http://a.example/1', 'http://a.example/2', 'http://a.example/3']);
            const b = await mk(['http://b.example/1', 'http://b.example/2', 'http://b.example/3']);
            const popupWin = await new Promise(res => chrome.windows.getCurrent(res));
            return { a, b, popup: popupWin.id };
        });
        await page.click('#view-tab-tabgroups');
        await sleep(900);
        await page.click('.tabgroups-refresh');
        await sleep(900);

        // expand A and B (non-focused windows render folded). ONE click per
        // evaluate: the first expand re-renders the list, replacing the
        // other head's DOM node (a stale reference would click nothing).
        const expanded = {};
        for (const key of ['a', 'b']) {
            const done = await page.evaluate(win => {
                const id = String(win[win.key]);
                const h = [...document.querySelectorAll('li.tabgroups-window-head')]
                    .find(x => String(x.dataset.windowId) === id);
                if (!h)
                    return false;
                const row = h.querySelector('.tabgroups-window-head-row');
                if (!row)
                    return false;
                row.click();
                return true;
            }, { ...winIds, key });
            expanded[winIds[key]] = done;
            await sleep(500);
        }
        const rowsByWin = await page.evaluate(() => {
            const m = {};
            for (const r of document.querySelectorAll('li.tabgroups-row'))
                m[r.dataset.windowId] = (m[r.dataset.windowId] || 0) + 1;
            return m;
        });
        console.log('EXPANDED:', JSON.stringify({ expanded, rowsByWin }));

        const tabDrag = await page.evaluate(win => {
            const headA = [...document.querySelectorAll('li.tabgroups-window-head')]
                .find(h => String(h.dataset.windowId) === String(win.a));
            const rowB = [...document.querySelectorAll('li.tabgroups-row')]
                .find(r => r.dataset && r.dataset.windowId === String(win.b));
            if (!headA || !rowB)
                return { ok: false, reason: 'headA/rowB missing', hasHeadA: !!headA, hasRowB: !!rowB };
            const dt = new DataTransfer();
            rowB.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
            headA.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
            const marked = headA.classList.contains('drag-over');
            headA.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
            document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
            return { ok: true, marked, movedTabId: rowB.dataset.tabId, movedUrl: rowB.querySelector('a') ? rowB.querySelector('a').getAttribute('href') : null };
        }, winIds);
        console.log('TABDRAG:', JSON.stringify(tabDrag));
        await sleep(1500);

        const outcome = await page.evaluate(async win => {
            const wins = await new Promise(res => chrome.windows.getAll({ populate: true }, res));
            const target = wins.find(w => w.id === win.a);
            const moved = target ? target.tabs.find(t => t.url === 'http://b.example/1') : null;
            const aTabs = target ? target.tabs.filter(t => (t.url || '').startsWith('http://a.example/')) : [];
            const lastA = aTabs[aTabs.length - 1];
            const popupWin = wins.find(w => w.id === win.popup);
            const sourceStill = wins.some(w => w.id === win.b && w.tabs && w.tabs.length === 2);
            return {
                movedInTarget: !!moved,
                appendedAtEnd: !!(moved && lastA && moved.index > lastA.index),
                sourceKept2Tabs: sourceStill,
                popupStillFocused: popupWin ? popupWin.focused : null
            };
        }, winIds);
        console.log('OUTCOME:', JSON.stringify(outcome));

        const pass = tabDrag.ok && tabDrag.marked && outcome.movedInTarget
            && outcome.appendedAtEnd && outcome.sourceKept2Tabs && outcome.popupStillFocused === true;
        console.log(pass ? 'DIAG PASS' : 'DIAG FAIL');
        if (!pass)
            process.exitCode = 1;
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
