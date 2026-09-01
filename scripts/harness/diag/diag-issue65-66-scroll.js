// Issues #65/#66 — popup-reopen scroll memory. Two independent defects both
// reset the tree to the top despite a stored scrollTop:
//
//  1. the restore assignment runs before the freshly parsed tree has settled
//     its nested `#tree ul ul` height:0→auto layout, so it silently clamps
//     to 0 (measured: scrollHeight still == clientHeight for up to ~250ms
//     after the innerHTML swap on a 150-row tree);
//  2. the three "where I was" focus restores (tree-view's focusID branch,
//     view-manager's restoreFocusSpot, list-focus's unparkRowFocus) called a
//     bare focus(), which scrolls the focused row into view and overrides
//     the restored position — including the invisible focusSpot that
//     survives the 4s focusID cleanup (#66's "no bookmark highlighted" repro).
//
// The probe drives the real write paths (clicks/focus/scroll) through three
// reopen scenarios and asserts the remembered position survives all of them:
//   A highlight ON  — focus a top-area row, scroll deep, reopen
//   B after the 4s focusID cleanup — scroll deep, reopen (#66 exact repro:
//     no visible highlight must not matter)
//   C highlight OFF — scroll deep, reopen (#65 exact repro)
// The highlight/keyboard-focus themselves must keep working (preventScroll
// must not have neutered them).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ck = (name, ok, extra) => {
    console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? ` — ${extra}` : ''));
    ok ? pass++ : fail++;
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2500);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;

        // seed: one folder with 150 bookmarks (a tall tree); target = row #3
        const seed = await browser.newPage();
        await seed.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        const ids = await seed.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.title === 'Bookmarks bar' || c.id === '1');
            const f = await create({ parentId: bar.id, title: '__issue65_66__' });
            let target = null;
            for (let i = 1; i <= 150; i++) {
                const b = await create({ parentId: f.id, title: 'BM ' + String(i).padStart(3, '0'), url: `https://ex${i}.example/x` });
                if (i === 3) target = b.id;
            }
            return { folder: f.id, target };
        });
        await seed.evaluate(() => new Promise(res => chrome.storage.local.remove(
            ['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot', 'activeView'], res)));
        await seed.evaluate(() => new Promise(res => chrome.storage.sync.remove(
            ['rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
                'rememberView', 'dontRememberState'], res)));
        await seed.close();

        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        const openPopup = async () => {
            await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
            await sleep(1500);
        };
        const snap = () => page.evaluate(target => ({
            scrollTop: Math.round(document.getElementById('tree').scrollTop),
            focusRows: [...document.querySelectorAll('#tree .focus')].map(e => e.closest('li').id.replace('neat-tree-item-', '')),
            activeRow: (document.activeElement && document.activeElement.closest && document.activeElement.closest('#tree li') || {}).id || ''
        }), ids.target);
        const expandSeed = async () => {
            await page.evaluate(() => {
                for (const li of document.querySelectorAll('#tree > ul > li.parent:not(.open)'))
                    (li.querySelector(':scope > span') || li.firstElementChild).click();
            });
            await page.waitForFunction(f => !!document.getElementById(`neat-tree-item-${f}`), { timeout: 5000 }, ids.folder);
            await page.evaluate(f => {
                const li = document.getElementById(`neat-tree-item-${f}`);
                (li.querySelector(':scope > span') || li.firstElementChild).click();
            }, ids.folder);
            await page.waitForFunction(() => document.querySelectorAll('#tree li').length > 50, { timeout: 5000 });
        };
        const scrollDeep = async () => {
            await page.evaluate(() => { document.getElementById('tree').scrollTop = 2200; });
            await sleep(700);
        };

        // ---- A: highlight ON — focus row #3 (top area), scroll deep, reopen
        await openPopup();
        await expandSeed();
        await page.waitForFunction(t => !!document.getElementById(`neat-tree-item-${t}`), { timeout: 5000 }, ids.target);
        await page.evaluate(t => {
            const row = document.getElementById(`neat-tree-item-${t}`);
            (row.firstElementChild || row).focus();
        }, ids.target);
        await sleep(700);
        await scrollDeep();
        await openPopup();
        {
            const st = await snap();
            ck('A highlight ON: reopen keeps the deep scroll (was: yanked to the top)',
                st.scrollTop === 2200, JSON.stringify(st));
            ck('A highlight ON: the row still re-highlights and takes keyboard focus',
                st.focusRows.includes(ids.target) && st.activeRow.endsWith(ids.target), JSON.stringify(st));
        }

        // ---- B: stay >4s (focusID cleanup), scroll deep again, reopen — the
        // #66 repro: no visible highlight carrier, the invisible focusSpot
        // must not yank the position either
        await sleep(4500);
        await scrollDeep();
        await openPopup();
        {
            const st = await snap();
            ck('B after the 4s focusID cleanup: reopen keeps the deep scroll (#66)',
                st.scrollTop === 2200, JSON.stringify(st));
        }
        await sleep(400);

        // ---- C: highlight OFF — scroll deep, reopen (#65 exact repro)
        await page.evaluate(() => new Promise(res => chrome.storage.sync.set({ rememberHighlight: '' }, res)));
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await scrollDeep();
        await openPopup();
        {
            const st = await snap();
            ck('C highlight OFF: reopen keeps the deep scroll (#65)',
                st.scrollTop === 2200, JSON.stringify(st));
            ck('C highlight OFF: no row re-highlight (the layer stays off)',
                st.focusRows.length === 0 && st.activeRow === '', JSON.stringify(st));
        }

        // cleanup + restore defaults
        await page.evaluate(f => new Promise(res => chrome.bookmarks.removeTree(f, res)), ids.folder);
        await page.evaluate(() => new Promise(res => chrome.storage.local.remove(
            ['focusID', 'scrollTop', 'opens', 'searchQuery', 'viewState', 'focusSpot', 'activeView'], res)));
        await page.evaluate(() => new Promise(res => chrome.storage.sync.remove(
            ['rememberScroll', 'rememberOpens', 'rememberHighlight', 'rememberSearchQuery',
                'rememberView', 'dontRememberState'], res)));

        console.log(`\n==== ${pass} passed, ${fail} failed ====`);
        process.exit(fail ? 1 : 0);
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
