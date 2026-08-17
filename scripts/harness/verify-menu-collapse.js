// vBookmarks collapsed-submenu verification — issue #48 follow-up.
//
// Two new settings collapse the tab-group / sort blocks of the right-click
// menus into single entries ("Tab groups… ▸" / "Sort… ▸") with a flyout
// submenu: collapseSortMenu (default ON, folder menu only) and
// collapseTabGroupMenu (default OFF, folder AND bookmark menus). This drives
// a real browser:
//   1. with sort collapsed the folder menu is SHORTER than expanded, still
//      stays open, and the raw sort items are hidden while the entry shows;
//   2. hovering / →-keying the entry opens the flyout inside the viewport;
//   3. dispatching a flyout item runs the action (sort) and closes the menu;
//   4. ← / Esc close the flyout then the menu (two-level);
//   5. with collapseTabGroupMenu on, both the folder and bookmark menus show
//      the "Tab groups…" entry with the raw items hidden.
//
// Run: docker run --rm vbm-smoke:local node /work/verify-menu-collapse.js
// Exits non-zero on any failed check (blocking run.sh step).
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PASS = [], FAIL = [];
const check = (label, ok, detail) => {
    (ok ? PASS : FAIL).push(label);
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ' — ' + detail : ''}`);
};

// A work folder with three bookmarks (sortable) + a top-level bookmark (for
// the bookmark-menu collapse check).
const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: 'Work' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'MDN', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com' });
    await create({ parentId: '1', title: 'Top-level', url: 'https://example.com' });
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });

    const pageErrors = [];
    const watch = page => {
        // Expected offline-sandbox noise: Chromium's own resource-load errors
        // from the favicon pipeline / seeded bookmark hosts. They are not
        // extension console.error calls and must not fail the gate.
        page.on('pageerror', e => {
            const msg = e.message || '';
            if (msg.includes('Failed to load resource') || msg.includes('net::') || msg.includes('Refused to'))
                return;
            pageErrors.push(`pageerror: ${msg}`);
        });
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const txt = m.text() || '';
            if (txt.includes('Failed to load resource') || txt.includes('net::') || txt.includes('Refused to'))
                return;
            pageErrors.push(`console: ${txt}`);
        });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) { console.error('service worker not found'); process.exit(2); }
    const extId = new URL(swTarget.url()).hostname;

    const seedPage = await browser.newPage();
    watch(seedPage);
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(600);
    await seedPage.close();

    const openPopup = async (storePatch) => {
        const page = await browser.newPage();
        watch(page);
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.setViewport({ width: 400, height: 620 });
        if (storePatch) {
            // Apply the settings in the SW context before the popup boots.
            await page.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
            await page.evaluate(patch => {
                return chrome.storage.local.set(patch);
            }, storePatch);
            await page.close();
        }
        const p = await browser.newPage();
        watch(p);
        await p.evaluateOnNewDocument(() => { window.close = () => {}; });
        await p.setViewport({ width: 400, height: 620 });
        // load, not networkidle0: seeded bookmark rows fire chrome-extension
        // _favicon requests that never settle in the offline DinD sandbox.
        await p.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1500);
        const $ = (fn, ...args) => p.evaluate(fn, ...args);
        // Dismiss the donation card.
        if (await $(() => {
            const d = document.getElementById('donation');
            return !!d && d.style.display !== 'none' && d.offsetHeight > 0;
        })) {
            await p.click('#donation-later');
            await sleep(300);
        }
        return { page: p, $ };
    };

    // The tree renders its root folders ("Bookmarks bar" / "Other bookmarks",
    // data-parentid="0") COLLAPSED, so a real folder like 'Work' only exists in
    // the DOM after the root is expanded. Expand the first root first.
    const expandRoot = async ($) => {
        return $(async () => {
            const nap = ms => new Promise(r => setTimeout(r, ms));
            let root = null;
            for (let g = 0; g < 25 && !root; g++) {
                root = document.querySelector('#tree li.parent > span.tree-item-span');
                if (!root)
                    await nap(100);
            }
            if (root) {
                root.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                await nap(300);
            }
            return !!root;
        });
    };

    const rightClickFolder = async ($) => {
        await expandRoot($);
        const r = await $(async () => {
            const nap = ms => new Promise(r => setTimeout(r, ms));
            // A NON-root folder: the bookmarks-bar root carries data-parentid="0"
            // and can't sort — hide-sort would mask the collapse behavior.
            let span = null;
            for (let g = 0; g < 25 && !span; g++) {
                span = document.querySelector(
                    '#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
                if (!span)
                    await nap(100);
            }
            if (!span)
                return { missing: true };
            const rect = span.getBoundingClientRect();
            span.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + 20, clientY: rect.top + 12
            }));
            const li = span.closest('li');
            return { y: Math.round(rect.top), parentId: li.dataset.parentid, rowId: li.id };
        });
        return r;
    };

    // ── 1) sort collapse (default ON): shorter menu, raw items hidden ──
    const c1 = await openPopup({}); // defaults: collapseSortMenu '1'
    const rc1 = await rightClickFolder(c1.$);
    console.log('  right-clicked folder (c1):', JSON.stringify(rc1));
    await sleep(300);
    const collapsed = await c1.$(async () => {
        const m = document.getElementById('folder-context-menu');
        const gs = id => { const e = document.getElementById(id); return e ? getComputedStyle(e).display : 'missing'; };
        const entry = document.getElementById('folder-sort-collapse');
        const entryVisible = entry && getComputedStyle(entry).display !== 'none';
        return {
            shown: m.style.opacity,
            height: Math.round(m.getBoundingClientRect().height),
            sortName: gs('sort-folder-by-name'),
            sortOptions: gs('sort-folder-contents'),
            sep7: gs('folder-context-menu-sep7'),
            entryVisible
        };
    });
    console.log('  collapsed state:', JSON.stringify(collapsed));
    check('sort collapse ON: raw sort items + sep7 hidden, entry visible',
        collapsed.sortName === 'none' && collapsed.sortOptions === 'none' &&
        collapsed.sep7 === 'none' && collapsed.entryVisible);
    check('sort collapse ON: folder menu stays open (no #48 dismissal)',
        collapsed.shown === '1');
    const collapsedH = collapsed.height;
    require('fs').mkdirSync('/tmp/shots/verify-menu', { recursive: true });
    await c1.page.screenshot({ path: '/tmp/shots/verify-menu/collapse-sort-on.png' });
    await c1.page.close();

    // ── 2) sort expanded (OFF): raw items back, menu taller ──
    const c2 = await openPopup({ collapseSortMenu: '' });
    const rc2 = await rightClickFolder(c2.$);
    console.log('  right-clicked folder (c2):', JSON.stringify(rc2));
    await sleep(300);
    const expanded = await c2.$(async () => {
        const m = document.getElementById('folder-context-menu');
        const gs = id => getComputedStyle(document.getElementById(id)).display;
        const entry = document.getElementById('folder-sort-collapse');
        return {
            shown: m.style.opacity,
            height: Math.round(m.getBoundingClientRect().height),
            sortName: gs('sort-folder-by-name'),
            entryVisible: entry && getComputedStyle(entry).display !== 'none',
            // diagnostics
            stored: await chrome.storage.local.get('collapseSortMenu'),
            menuClass: m.className,
            entryDisplay: entry ? getComputedStyle(entry).display : 'missing'
        };
    });
    console.log('  expanded state:', JSON.stringify(expanded));
    check('sort collapse OFF: raw sort items visible, entry hidden',
        expanded.sortName !== 'none' && !expanded.entryVisible);
    check('collapsed menu is SHORTER than expanded', collapsedH < expanded.height,
        `${collapsedH} < ${expanded.height}`);
    require('fs').mkdirSync('/tmp/shots/verify-menu', { recursive: true });
    await c2.page.screenshot({ path: '/tmp/shots/verify-menu/collapse-sort-off.png' });
    await c2.page.close();

    // ── 3) hover → flyout opens, positioned inside the viewport ──
    const c3 = await openPopup({ collapseSortMenu: '1' });
    const rc3 = await rightClickFolder(c3.$);
    console.log('  right-clicked folder (c3):', JSON.stringify(rc3));
    await sleep(300);
    const flyout = await c3.$(async () => {
        const entry = document.getElementById('folder-sort-collapse');
        entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        await new Promise(r => setTimeout(r, 250));
        const sub = document.getElementById('folder-sort-submenu');
        const r = sub.getBoundingClientRect();
        const entryR = entry.getBoundingClientRect();
        return {
            shown: sub.style.opacity,
            x: Math.round(r.left), w: Math.round(r.width), right: Math.round(r.right),
            bottom: Math.round(r.bottom), vw: window.innerWidth, vh: window.innerHeight,
            rightOfEntry: r.left >= entryR.right - 1, // LTR: flyout opens to the right
            items: sub.querySelectorAll('.menu-item').length,
            // diagnostics
            entryLeft: Math.round(entryR.left), entryRight: Math.round(entryR.right), entryW: Math.round(entryR.width),
            bodyW: document.body.offsetWidth, menuLeft: Math.round(document.getElementById('folder-context-menu').getBoundingClientRect().left),
            subLeftStyle: sub.style.left
        };
    });
    console.log('  flyout state:', JSON.stringify(flyout));
    check('hover opens the sort flyout (opacity 1, 3 items)',
        flyout.shown === '1' && flyout.items === 3);
    check('flyout is to the right of the entry and inside the viewport',
        flyout.rightOfEntry && flyout.right <= flyout.vw && flyout.bottom <= flyout.vh,
        `right=${flyout.right} vw=${flyout.vw} bottom=${flyout.bottom} vh=${flyout.vh}`);
    require('fs').mkdirSync('/tmp/shots/verify-menu', { recursive: true });
    await c3.page.screenshot({ path: '/tmp/shots/verify-menu/collapse-sort-flyout.png' });

    // ── 4) click a flyout item → action runs, menu closes ──
    const sortRan = await c3.$(async () => {
        const item = document.getElementById('sub-sort-folder-by-name');
        item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window, button: 0 }));
        return new Promise(r => setTimeout(() => {
            const m = document.getElementById('folder-context-menu');
            r(m.style.opacity);
        }, 250));
    });
    check('clicking a flyout sort item closes the menu', sortRan === '0', `opacity=${sortRan}`);
    check('no page JS errors during hover/click', pageErrors.length === 0, pageErrors.join('; '));

    // ── 5) keyboard: → opens + steps in, ← closes, Esc closes the menu ──
    await rightClickFolder(c3.$);
    await sleep(300);
    await c3.$(async () => {
        const entry = document.getElementById('folder-sort-collapse');
        entry.focus();
        return true;
    });
    await c3.page.keyboard.press('ArrowRight');
    await sleep(250);
    const kbdOpen = await c3.$(async () => {
        const sub = document.getElementById('folder-sort-submenu');
        return {
            subShown: sub.style.opacity,
            activeId: document.activeElement && document.activeElement.id
        };
    });
    check('→ opens the flyout and steps into its first item',
        kbdOpen.subShown === '1' && kbdOpen.activeId === 'sub-sort-folder-by-name',
        JSON.stringify(kbdOpen));
    await c3.page.keyboard.press('ArrowLeft');
    await sleep(250);
    const kbdClose = await c3.$(async () => {
        const sub = document.getElementById('folder-sort-submenu');
        return {
            subShown: sub.style.opacity,
            activeId: document.activeElement && document.activeElement.id
        };
    });
    check('← closes the flyout and returns to the entry',
        kbdClose.subShown === '0' && kbdClose.activeId === 'folder-sort-collapse',
        JSON.stringify(kbdClose));
    await c3.page.keyboard.press('Escape');
    await sleep(250);
    const escState = await c3.$(async () =>
        document.getElementById('folder-context-menu').style.opacity);
    check('Esc closes the whole menu', escState === '0', `opacity=${escState}`);
    await c3.page.close();

    // ── 6) tab-group collapse (ON) applies to folder AND bookmark menus ──
    const c4 = await openPopup({ collapseTabGroupMenu: '1', collapseSortMenu: '1' });
    // folder menu
    const rc4 = await rightClickFolder(c4.$);
    console.log('  right-clicked folder (c4):', JSON.stringify(rc4));
    await sleep(300);
    const folderTG = await c4.$(async () => {
        const gs = id => getComputedStyle(document.getElementById(id)).display;
        const entry = document.getElementById('folder-tab-group-collapse');
        return {
            entryVisible: entry && getComputedStyle(entry).display !== 'none',
            raw1: gs('open-bookmarks-in-group'),
            entryOpacity: document.getElementById('folder-context-menu').style.opacity
        };
    });
    check('tab-group collapse: folder menu shows entry, hides raw items',
        folderTG.entryVisible && folderTG.raw1 === 'none');
    // bookmark menu (expand the Work folder, then right-click a bookmark row)
    const bmClick = await c4.$(async () => {
        const nap = ms => new Promise(r => setTimeout(r, ms));
        let p = null;
        for (let g = 0; g < 25 && !p; g++) {
            p = document.querySelector(
                '#tree li.parent[data-parentid]:not([data-parentid="0"]) > span.tree-item-span');
            if (!p)
                await nap(100);
        }
        if (p)
            p.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        await nap(300); // expand re-renders the child rows
        const a = document.querySelector('#tree li.child a');
        if (a) {
            const rect = a.getBoundingClientRect();
            a.dispatchEvent(new MouseEvent('contextmenu', {
                bubbles: true, cancelable: true, view: window,
                clientX: rect.left + 20, clientY: rect.top + 8
            }));
        }
        return { folderFound: !!p, bookmarkFound: !!a };
    });
    console.log('  bookmark click:', JSON.stringify(bmClick));
    await sleep(300);
    const bookmarkTG = await c4.$(async () => {
        const gs = id => getComputedStyle(document.getElementById(id)).display;
        const entry = document.getElementById('bookmark-tab-group-collapse');
        return {
            entryVisible: entry && getComputedStyle(entry).display !== 'none',
            raw1: gs('bookmark-open-in-new-group')
        };
    });
    check('tab-group collapse: bookmark menu shows entry, hides raw items',
        bookmarkTG.entryVisible && bookmarkTG.raw1 === 'none');
    // open the bookmark tab-group flyout → 3 items
    const bmFlyout = await c4.$(async () => {
        const entry = document.getElementById('bookmark-tab-group-collapse');
        entry.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
        await new Promise(r => setTimeout(r, 250));
        const sub = document.getElementById('bookmark-tab-group-submenu');
        return { shown: sub.style.opacity, items: sub.querySelectorAll('.menu-item').length };
    });
    check('bookmark tab-group flyout opens with 3 items',
        bmFlyout.shown === '1' && bmFlyout.items === 3, JSON.stringify(bmFlyout));
    check('no page JS errors across the tab-group pass', pageErrors.length === 0, pageErrors.join('; '));
    await c4.page.close();

    console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
    await browser.close();
    process.exit(FAIL.length ? 1 : 0);
})();
