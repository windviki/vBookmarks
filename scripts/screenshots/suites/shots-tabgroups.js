// vBookmarks tab-group screenshot + functional suite (P3.4 hardening).
//
// Exercises the whole "open bookmarks as a tab group" surface end-to-end in a
// real browser — the part vitest cannot reach, because the popup closes the
// moment its first (active) tab opens and the tab creation + grouping happens
// in the service worker:
//   1. the folder context menu shows the one-click / named-setup / existing-
//      group entries;
//   2. the named-setup GroupDialog (title input + 9 Chrome color swatches)
//      confirms into a real tab group — verified from the SW that a group
//      titled and colored as chosen now exists with the folder's tabs;
//   3. the existing-group GroupPickDialog lists that group and "open into
//      existing group" actually joins new tabs to it — verified via the SW;
//   4. the bookmark context menu shows its three tab-group entries.
// Shots land in /tmp/shots with the 30- series (the other suites use 01-29).
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const PALETTE = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// Seed one folder "工作区" with three bookmarks plus two stray top-level
// bookmarks (the bookmark-menu screenshot needs a bookmark row that is not
// inside the folder).
const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com' });
    await create({ parentId: work.id, title: 'MDN', url: 'https://developer.mozilla.org' });
    await create({ parentId: work.id, title: 'Stack Overflow', url: 'https://stackoverflow.com' });
    await create({ parentId: '1', title: 'Example Home', url: 'https://example.com' });
    await create({ parentId: '1', title: 'Wikipedia', url: 'https://www.wikipedia.org' });
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
        page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
        page.on('console', m => {
            if (m.type() === 'error')
                errors.push(`${tag} console.error: ${m.text()}`);
        });
    };

    await sleep(2000);
    const findSw = async () => {
        const targets = await browser.targets();
        return targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    };
    const swTarget = await findSw();
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;

    // Runs a query inside the extension's service worker — the only context
    // that survives the popup closing when its first tab activates.
    const swQuery = async fn => {
        const worker = await (await findSw()).worker();
        return worker.evaluate(`(${fn})()`);
    };
    const swGroups = () => swQuery(() => new Promise(r => chrome.tabGroups.query({}, r)));
    const swTabs = () => swQuery(() => new Promise(r => chrome.tabs.query({}, r)));

    const openPopup = async (dark = false) => {
        const page = await browser.newPage();
        watch(page, 'tabgroups');
        await page.setViewport({ width: 400, height: 640 });
        if (dark)
            await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        // Silence the donation ask / upgrade notice so no card covers the tree
        // (storage writes from the seed page race with this open, hence the
        // reload — same recipe as shots-i18n).
        await page.evaluate(() => chrome.storage.local.set({
            currentVersion: chrome.runtime.getManifest().version,
            donationFactor: 1,
            donationKey: 30
        }));
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(1200);
        // Expand the bookmarks bar root so the seeded 工作区 folder is in the
        // DOM (roots render collapsed on first paint, like shots-i18n).
        await page.evaluate(() => {
            const first = document.querySelector('#tree > ul > li span.tree-item-span');
            if (first && !first.parentNode.classList.contains('open'))
                first.click();
        });
        await sleep(400);
        return page;
    };

    // --- Seed ---------------------------------------------------------------
    const seedPage = await openPopup();
    await seedPage.evaluate(SEED);
    await sleep(500);
    await seedPage.close();

    const rightClickFolder = page => page.evaluate(() => {
        const span = [...document.querySelectorAll('#tree span.tree-item-span')]
            .find(s => (s.querySelector('i')?.textContent || '').trim() === '工作区');
        if (!span) throw new Error('folder row not found');
        span.dispatchEvent(new MouseEvent('contextmenu',
            { bubbles: true, cancelable: true, clientX: 120, clientY: span.getBoundingClientRect().top + 8 }));
    });
    const clickMenuItem = (page, id) => page.evaluate(menuId => {
        const item = document.querySelector(`#${menuId}`);
        if (!item) throw new Error('menu item not found: ' + menuId);
        item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    }, id);

    // --- 30-folder-tabgroup-menu: the folder menu with all three entries ----
    const page = await openPopup(true);
    await rightClickFolder(page);
    await sleep(500);
    await page.evaluate(() => {
        for (const id of ['open-bookmarks-in-group', 'open-bookmarks-in-group-setup',
            'folder-open-in-existing-group'])
            if (!document.getElementById(id))
                throw new Error('folder menu item missing: ' + id);
    });
    await page.screenshot({ path: '/tmp/shots/30-folder-tabgroup-menu.png' });

    // --- 31-tabgroup-dialog: named-setup dialog (title + 9 swatches) --------
    await clickMenuItem(page, 'open-bookmarks-in-group-setup');
    await sleep(500);
    await page.evaluate(() => {
        if (document.getElementById('tab-group-name').value !== '工作区')
            throw new Error('GroupDialog title default wrong');
        const radios = document.querySelectorAll('input[name="tab-group-color"]');
        if (radios.length !== 9)
            throw new Error('expected 9 color swatches, got ' + radios.length);
        if (!radios.length || ![...radios].some(r => r.checked))
            throw new Error('no color pre-selected');
    });
    await page.screenshot({ path: '/tmp/shots/31-tabgroup-dialog.png' });

    // Functional: confirm with a custom title + orange; the SW must form a
    // group named/colored exactly as chosen and hold the folder's 3 tabs.
    await page.evaluate(() => {
        document.querySelector('#tab-group-name').value = '工作区 (组)';
        document.querySelector('input[name="tab-group-color"][value="orange"]').checked = true;
    });
    await page.evaluate(() => document.querySelector('#tab-group-dialog-button').click());
    await sleep(2500); // popup closes when the first tab activates; SW keeps going
    let groups = await swGroups();
    let setupGroup = groups.find(g => g.title === '工作区 (组)');
    if (!setupGroup || setupGroup.color !== 'orange')
        throw new Error('setup-dialog group not formed: ' + JSON.stringify(groups));
    let groupTabs = (await swTabs()).filter(t => t.groupId === setupGroup.id);
    if (groupTabs.length !== 3)
        throw new Error(`expected 3 tabs in the setup group, got ${groupTabs.length}`);

    // --- 32-tabgroup-pick: existing-group picker now lists that group -------
    const page2 = await openPopup(true);
    await rightClickFolder(page2);
    await sleep(300);
    await clickMenuItem(page2, 'folder-open-in-existing-group');
    await sleep(700);
    await page2.evaluate(() => {
        const row = document.querySelector('.tab-group-pick-row');
        if (!row || !row.textContent.includes('工作区 (组)'))
            throw new Error('picker does not list the group: ' + (row && row.textContent));
    });
    await page2.screenshot({ path: '/tmp/shots/32-tabgroup-pick.png' });

    // Functional: picking the row must open MORE tabs into the same group
    // (open-into-existing-group). Group 3 -> 6 tabs.
    await page2.evaluate(() => {
        const row = document.querySelector('.tab-group-pick-row');
        if (!row) throw new Error('picker row not found');
        row.click();
    });
    await sleep(2500);
    groups = await swGroups();
    const joined = groups.find(g => g.title === '工作区 (组)');
    if (!joined)
        throw new Error('group disappeared after open-into: ' + JSON.stringify(groups));
    const joinedTabs = (await swTabs()).filter(t => t.groupId === joined.id);
    if (joinedTabs.length !== 6)
        throw new Error(`expected 6 tabs after open-into, got ${joinedTabs.length}`);
    await page2.close();

    // --- 33-bookmark-tabgroup-menu: bookmark menu's three entries -----------
    // Use a top-level bookmark (Example Home, directly under the expanded
    // bookmarks bar root) so no subfolder needs expanding.
    const page3 = await openPopup(true);
    await page3.evaluate(() => {
        const link = [...document.querySelectorAll('#tree a.tree-item-link')]
            .find(a => (a.querySelector('i')?.textContent || '').trim() === 'Example Home');
        if (!link) throw new Error('bookmark row not found');
        link.dispatchEvent(new MouseEvent('contextmenu',
            { bubbles: true, cancelable: true, clientX: 120, clientY: link.getBoundingClientRect().top + 8 }));
    });
    await sleep(500);
    await page3.evaluate(() => {
        for (const id of ['bookmark-open-in-new-group', 'bookmark-open-in-new-group-setup',
            'bookmark-open-in-existing-group'])
            if (!document.getElementById(id))
                throw new Error('bookmark menu item missing: ' + id);
    });
    await page3.screenshot({ path: '/tmp/shots/33-bookmark-tabgroup-menu.png' });

    await browser.close();

    const realErrors = errors.filter(e => !e.includes('net::'));
    if (realErrors.length) {
        console.error(realErrors.join('\n'));
        process.exit(1);
    }
    console.log('tab-groups suite OK — 30/31/32/33 captured, setup + open-into verified');
})();
