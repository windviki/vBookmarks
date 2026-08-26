// End-to-end probe for the 2026-08-26 tab-groups round:
//   ① the window head's computed font-size == a tab row's (item 1)
//   ② the toolbar 新建窗口 button renders left of 刷新 and creates a
//      BACKGROUND window (focused:false — the popup keeps the foreground)
//   ③ dragging one window head onto another window's area merges the
//      dragged window into the target as ONE tab group titled 窗口 N
//      (HTML5 DnD simulated with synthetic DragEvents; the SW pipeline does
//      the real chrome.tabs.move/group), and the POPUP's window stays
//      focused afterwards (the move must not steal the foreground)
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

        // Two extra windows: A (the merge target, 3 tabs) + B (the drag
        // source, 3 tabs). The puppeteer tab's own window sorts last (it is
        // the focused one → first, actually current-first ordering).
        const winIds = await page.evaluate(async () => {
            const mk = urls => new Promise(res => chrome.windows.create({ url: urls, focused: false }, w => res(w.id)));
            const a = await mk(['http://a.example/1', 'http://a.example/2', 'http://a.example/3']);
            const b = await mk(['http://b.example/1', 'http://b.example/2', 'http://b.example/3']);
            // the popup's own window (for the focus assertions)
            const popupWin = await new Promise(res => chrome.windows.getCurrent(res));
            return { a, b, popup: popupWin.id };
        });
        await page.click('#view-tab-tabgroups');
        await sleep(900);
        // a fresh render picks the new windows up
        await page.click('.tabgroups-refresh');
        await sleep(900);

        // ① font parity: window head vs tab row
        const fonts = await page.evaluate(() => {
            const head = document.querySelector('.tabgroups-window-head-row em');
            const row = document.querySelector('li.tabgroups-row a i');
            const btn = document.querySelector('.tabgroups-new-window');
            const refresh = document.querySelector('.tabgroups-refresh');
            const cluster = document.querySelector('.tabgroups-icon-cluster');
            return {
                headFont: head ? getComputedStyle(head).fontSize : null,
                rowFont: row ? getComputedStyle(row).fontSize : null,
                headH: document.querySelector('.tabgroups-window-head-row') ?
                    getComputedStyle(document.querySelector('.tabgroups-window-head-row')).height : null,
                newWinBtn: !!btn,
                newWinBeforeRefresh: !!(btn && refresh && cluster
                    && (cluster.innerHTML.indexOf('tabgroups-new-window') < cluster.innerHTML.indexOf('tabgroups-refresh')))
            };
        });
        console.log('FONTS/BUTTON:', JSON.stringify(fonts));

        // ② the + button creates a fresh BACKGROUND window (report round 1)
        const before = await page.evaluate(() => new Promise(res => chrome.windows.getAll({}, w => res(w.length))));
        await page.click('.tabgroups-new-window');
        await sleep(700);
        const newWinState = await page.evaluate(async popupId => {
            const wins = await new Promise(res => chrome.windows.getAll({ populate: true }, res));
            const fresh = wins.find(w => w.tabs && w.tabs.length === 1
                && (w.tabs[0].url || '').startsWith('chrome://newtab') && w.id !== popupId);
            return { count: wins.length, freshFocused: fresh ? fresh.focused : null };
        }, winIds.popup);
        console.log('NEWWINDOW:', JSON.stringify({ before, after: newWinState.count, created: newWinState.count === before + 1, freshFocused: newWinState.freshFocused }));
        // close the fresh empty window to keep the rest deterministic
        await page.evaluate(() => new Promise(res => chrome.windows.getAll({}, wins => {
            const empty = wins.find(w => w.tabs && w.tabs.length === 1 && (w.tabs[0].url || '').startsWith('chrome://newtab'));
            if (empty)
                chrome.windows.remove(empty.id, () => res());
            else
                res();
        })));
        await sleep(500);
        await page.click('.tabgroups-refresh');
        await sleep(900);

        // ③ drag window B's head onto window A's head (B now has 2 tabs)
        const drag = await page.evaluate(win => {
            const heads = [...document.querySelectorAll('li.tabgroups-window-head')];
            if (heads.length < 2)
                return { ok: false, reason: 'heads=' + heads.length };
            const src = heads.find(h => String(h.dataset.windowId) === String(win.b));
            const dst = heads.find(h => String(h.dataset.windowId) === String(win.a));
            if (!src || !dst)
                return { ok: false, reason: 'src/dst not found' };
            const dt = new DataTransfer();
            src.querySelector('.tabgroups-window-head-row').dispatchEvent(
                new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
            dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
            const marked = dst.classList.contains('window-drop-target');
            dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
            document.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
            return { ok: true, marked };
        }, winIds);
        console.log('DRAG:', JSON.stringify(drag));
        await sleep(1500);

        const outcome = await page.evaluate(async win => {
            const wins = await new Promise(res => chrome.windows.getAll({ populate: true }, res));
            const groups = await new Promise(res => chrome.tabGroups.query({}, res));
            const target = wins.find(w => w.id === win.a);
            const sourceGone = !wins.some(w => w.id === win.b);
            const bTabs = target ? target.tabs.filter(t => (t.url || '').startsWith('http://b.example/')) : [];
            const grp = groups.find(g => g.windowId === win.a);
            const popupWin = wins.find(w => w.id === win.popup);
            // the moved tab from ④ sits at A's END (last index among A)
            const movedAtEnd = (() => {
                if (!target) return false;
                const moved = target.tabs.find(t => t.url === 'http://b.example/1');
                if (!moved) return false;
                const aTabs = target.tabs.filter(t => (t.url || '').startsWith('http://a.example/'));
                const lastA = aTabs[aTabs.length - 1];
                return moved.index > lastA.index;
            })();
            return {
                sourceWindowClosed: sourceGone,
                targetTabCount: target ? target.tabs.length : 0,
                bTabsInTarget: bTabs.length,
                bTabsGrouped: bTabs.every(t => t.groupId !== -1 && t.groupId !== undefined) && bTabs.length > 0,
                groupTitle: grp ? grp.title : null,
                groupWindowMatches: grp ? grp.windowId === win.a : false,
                movedTabAppended: movedAtEnd,
                popupStillFocused: popupWin ? popupWin.focused : null
            };
        }, winIds);
        console.log('OUTCOME:', JSON.stringify(outcome));

        const pass = fonts.headFont === fonts.rowFont && fonts.newWinBtn && fonts.newWinBeforeRefresh
            && newWinState.count === before + 1 && newWinState.freshFocused === false
            && drag.ok && drag.marked
            && outcome.sourceWindowClosed && outcome.bTabsInTarget === 3
            && outcome.bTabsGrouped && !!outcome.groupTitle && outcome.groupWindowMatches
            && outcome.popupStillFocused === true;
        console.log(pass ? 'DIAG PASS' : 'DIAG FAIL');
        if (!pass)
            process.exitCode = 1;
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
