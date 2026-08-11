// v4 task-4 #6: palette custom commands end-to-end.
//  - '/wo' renders the seeded open-url-group row (custom tag, usage order);
//    executing it opens the folder's bookmarks as tabs
//  - '/g kimi code' fills the url-template and opens a new tab
//  - '/clean' (view-preset) activates the dupes view with strategy/scope applied
//  - a gone folder triggers the delete-confirm; confirming removes the command
//  - a hitless slash query offers save-as; Enter hands over to the options
//    editor with the slash prefilled
//  - the options page management group: list rendering, per-action form rows,
//    create-through-the-form, delete
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const swTarget = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;
    const step = s => console.error(`… ${s}`);
    const openPopup = async () => {
        const page = await browser.newPage();
        // The harness loads popup.html as a regular tab; the actions layer's
        // "close the popup after opening a bookmark" (window.close, 200ms
        // after openBookmarkNewTab) would close that tab for real and detach
        // the CDP frame. Stub it — the palette's own close() is unaffected.
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.setViewport({ width: 420, height: 600 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(800);
        return page;
    };
    const dismissDonation = page => page.evaluate(() => {
        const b = document.getElementById('donation');
        if (b && b.style.display !== 'none') {
            const l = document.getElementById('donation-later');
            if (l) l.click();
        }
    });

    // --- seed: bookmarks + four custom commands in the sync area ------------
    // (loopback URLs: 127.0.0.1:9 refuses fast — external URLs would hang
    // the navigationless DinD network and wedge the CDP session)
    const seed = await openPopup();
    const workId = await seed.evaluate(() => new Promise(r => {
        const create = p => new Promise(res => chrome.bookmarks.create(p, res));
        (async () => {
            const work = await create({ parentId: '1', title: '工作区' });
            await create({ parentId: work.id, title: 'One', url: 'http://127.0.0.1:9/one' });
            await create({ parentId: work.id, title: 'Two', url: 'http://127.0.0.1:9/two' });
            await create({ parentId: work.id, title: 'Three', url: 'http://127.0.0.1:9/three' });
            const cmds = [
                { id: 'cc_work', name: 'Work apps', slash: 'work', aliases: ['wo'],
                  action: { type: 'open-url-group', folderId: work.id, where: 'tab' },
                  createdAt: 1, useCount: 0, lastUsedAt: 0 },
                { id: 'cc_kimi', name: 'Kimi search', slash: 'g', aliases: [],
                  action: { type: 'url-template', template: 'http://127.0.0.1:9/search?q=%s', where: 'tab' },
                  createdAt: 2, useCount: 0, lastUsedAt: 0 },
                { id: 'cc_clean', name: 'Clean duplicates', slash: 'clean', aliases: [],
                  action: { type: 'view-preset', view: 'dupes', strategy: 'keep-newest', scope: 'all' },
                  createdAt: 3, useCount: 0, lastUsedAt: 0 },
                { id: 'cc_old', name: 'Old folder', slash: 'old', aliases: [],
                  action: { type: 'open-url-group', folderId: '999', where: 'tab' },
                  createdAt: 4, useCount: 0, lastUsedAt: 0 }
            ];
            chrome.storage.sync.set({ paletteCustomCommands: JSON.stringify(cmds) }, () =>
                chrome.storage.local.set({
                    currentVersion: chrome.runtime.getManifest().version,
                    donationFactor: 1, donationKey: 30,
                    activeView: 'tree'
                }, () => r(work.id)));
        })();
    }));
    await sleep(300);
    await seed.close();

    const out = { workId };
    fs.mkdirSync('/tmp/shots/diag', { recursive: true });

    // --- session A: the palette ---------------------------------------------
    const a = await openPopup();
    await dismissDonation(a);

    // '/wo' renders the custom row last with its tag
    step('open palette, type /wo');
    await a.click('#tool-btn'); await sleep(400);
    await a.type('#palette-input', '/wo', { delay: 30 }); await sleep(400);
    out.slashWo = await a.evaluate(() => {
        const rows = [...document.querySelectorAll('#palette-results li')];
        const last = rows[rows.length - 1];
        return {
            total: rows.length,
            lastIsCustom: !!last && last.classList.contains('palette-command-custom'),
            tagged: !!last && !!last.querySelector('.palette-custom-tag'),
            slash: last && (last.querySelector('.palette-slash') || {}).textContent
        };
    });
    await a.screenshot({ path: '/tmp/shots/diag/v4t4j-palette-custom.png' });
    // execute the group (End selects the custom row)
    step('execute the group');
    await a.keyboard.press('End'); await sleep(150);
    await a.keyboard.press('Enter'); await sleep(900);
    out.groupTabs = await a.evaluate(() => new Promise(r =>
        chrome.tabs.query({}, tabs => r(tabs.map(t => t.url).filter(u =>
            /127\.0\.0\.1:9\/(one|two|three)/.test(u))))));
    out.allTabs = await a.evaluate(() => new Promise(r =>
        chrome.tabs.query({}, tabs => r(tabs.map(t => `${t.status}:${t.url}`)))));
    step(`group tabs: ${JSON.stringify(out.groupTabs)}`);

    // '/g kimi code' fills the template. The group execution foregrounded a
    // new tab; a backgrounded page answers Runtime.evaluate but a page.click
    // (needs layout) wedges until protocolTimeout — reclaim the foreground.
    step('url-template');
    await a.bringToFront(); await sleep(300);
    await a.click('#tool-btn'); await sleep(400);
    await a.type('#palette-input', '/g kimi code', { delay: 30 }); await sleep(300);
    await a.keyboard.press('Enter'); await sleep(900);
    out.templateTabs = await a.evaluate(() => new Promise(r =>
        chrome.tabs.query({}, tabs => r(tabs.map(t => t.url).filter(u => /127\.0\.0\.1:9\/search/.test(u))))));

    // '/clean' (view-preset) activates dupes with the strategy/scope applied
    step('view-preset');
    await a.bringToFront(); await sleep(300); // the template tab foregrounded
    await a.click('#tool-btn'); await sleep(400);
    await a.type('#palette-input', '/clean', { delay: 30 }); await sleep(300);
    await a.keyboard.press('Enter'); await sleep(900);
    out.preset = await a.evaluate(() => ({
        dupesActive: !document.getElementById('view-dupes').hidden,
        strategy: window.store.get('dupesStrategy', ''),
        scope: window.store.get('dupesScope', '')
    }));

    // the gone-folder command prompts the delete-confirm; confirming removes it.
    // '/old' fuzzy-hits two builtins ("New folder…", "…as folder") first, so
    // End selects the custom row before Enter (same walk as the '/wo' step).
    await a.click('#tool-btn'); await sleep(400);
    await a.type('#palette-input', '/old', { delay: 30 }); await sleep(300);
    await a.keyboard.press('End'); await sleep(150);
    await a.keyboard.press('Enter'); await sleep(600);
    out.brokenShown = await a.evaluate(() => document.body.classList.contains('needConfirm'));
    await a.screenshot({ path: '/tmp/shots/diag/v4t4j-broken-confirm.png' });
    await a.evaluate(() => document.getElementById('confirm-dialog-button-1').click());
    await sleep(500);
    out.afterBrokenDelete = await a.evaluate(() =>
        JSON.parse(window.store.getSyncSetting('paletteCustomCommands', '[]')).map(c => c.slash));

    // a hitless slash query offers save-as; Enter hands over to the editor
    await a.click('#tool-btn'); await sleep(400);
    await a.type('#palette-input', '/nosuch', { delay: 30 }); await sleep(300);
    out.saveAsRow = await a.evaluate(() => {
        const rows = [...document.querySelectorAll('#palette-results li')];
        return rows.length === 1 && /as a command/i.test(rows[0].textContent);
    });
    await a.keyboard.press('End'); await sleep(150); // in case a fuzzy builtin slipped in
    await a.keyboard.press('Enter'); await sleep(1200);
    const optPage = (await browser.pages()).find(p => p.url().includes('pages/options.html'));
    out.editorOpened = !!optPage;
    if (optPage) {
        await optPage.setViewport({ width: 900, height: 700 });
        await sleep(900);
        out.editorPrefill = await optPage.evaluate(() => ({
            formOpen: !!document.getElementById('palette-cmd-form') &&
                !document.getElementById('palette-cmd-form').hidden,
            slash: (document.getElementById('pc-slash') || {}).value
        }));
        await optPage.screenshot({ path: '/tmp/shots/diag/v4t4j-options-prefill.png' });

        // --- session B continues on the options page: management group ------
        optPage.on('dialog', d => d.accept()); // the delete button's confirm()
        await optPage.evaluate(() => document.getElementById('pc-cancel').click());
        await sleep(300);
        out.listRows = await optPage.evaluate(() =>
            [...document.querySelectorAll('#palette-cmd-list li')].map(li => li.textContent.trim()).slice(0, 6));
        // per-action form rows: open-url shows the url row only
        await optPage.evaluate(() => document.getElementById('palette-cmd-add').click());
        await sleep(400);
        const rowVisibility = () => optPage.evaluate(() => {
            const vis = id => {
                const li = document.getElementById(id).closest('li');
                return li && !li.hidden;
            };
            return {
                url: vis('pc-url'), template: vis('pc-template'),
                where: vis('pc-where'), folder: vis('pc-folder'),
                view: vis('pc-view'), scan: vis('pc-scan')
            };
        });
        out.rowsOpenUrl = await rowVisibility();
        await optPage.select('#pc-action', 'open-url-group'); await sleep(200);
        out.rowsGroup = await rowVisibility();
        await optPage.select('#pc-action', 'view-preset'); await sleep(200);
        await optPage.select('#pc-view', 'dead'); await sleep(200);
        out.rowsPresetDead = await rowVisibility();
        await optPage.screenshot({ path: '/tmp/shots/diag/v4t4j-options-form.png' });
        // create through the form: an open-url command
        await optPage.select('#pc-action', 'open-url'); await sleep(200);
        await optPage.type('#pc-name', 'Console', { delay: 10 });
        await optPage.type('#pc-slash', 'ops', { delay: 10 });
        await optPage.type('#pc-url', 'https://console.example.com/', { delay: 5 });
        await optPage.evaluate(() => document.getElementById('pc-save').click());
        await sleep(600);
        out.afterCreate = await optPage.evaluate(() =>
            JSON.parse(window.store.getSyncSetting('paletteCustomCommands', '[]')).map(c => c.slash));
        // delete it again through its row button
        await optPage.evaluate(() => {
            const li = [...document.querySelectorAll('#palette-cmd-list li')]
                .find(l => l.textContent.includes('Console'));
            li.querySelector('button:last-child').click();
        });
        await sleep(500);
        out.afterDelete = await optPage.evaluate(() =>
            JSON.parse(window.store.getSyncSetting('paletteCustomCommands', '[]')).map(c => c.slash));
        await optPage.screenshot({ path: '/tmp/shots/diag/v4t4j-options-list.png' });
    }
    await a.close();

    // --- verdicts -------------------------------------------------------------
    const checks = {
        '/wo: custom row last + tagged + both slash forms':
            out.slashWo.lastIsCustom && out.slashWo.tagged && out.slashWo.slash === '/work /wo',
        '/wo Enter: folder opened as a 3-tab group': (out.groupTabs || []).length === 3,
        '/g kimi code: template filled + opened':
            (out.templateTabs || []).some(u => u.includes('q=kimi%20code')),
        '/clean: dupes view active with the preset applied':
            out.preset.dupesActive && out.preset.strategy === 'keep-newest' && out.preset.scope === 'all',
        '/old: the gone-folder delete-confirm showed': !!out.brokenShown,
        '/old: confirming removed the command':
            (out.afterBrokenDelete || []).indexOf('old') === -1 && (out.afterBrokenDelete || []).length === 3,
        'save-as row on a hitless slash query': !!out.saveAsRow,
        'save-as Enter opens the options editor': !!out.editorOpened,
        'editor prefilled with the slash':
            !!out.editorPrefill && out.editorPrefill.formOpen && out.editorPrefill.slash === 'nosuch',
        'options list renders the seeded commands':
            (out.listRows || []).length === 3 && out.listRows.some(t => t.includes('Work apps')),
        'form rows follow the action type (open-url)':
            out.rowsOpenUrl && out.rowsOpenUrl.url && out.rowsOpenUrl.where &&
            !out.rowsOpenUrl.template && !out.rowsOpenUrl.folder && !out.rowsOpenUrl.view,
        'form rows follow the action type (group: folder, no current-window url row)':
            out.rowsGroup && out.rowsGroup.folder && out.rowsGroup.where && !out.rowsGroup.url,
        'form rows follow the view (dead preset: scan checkbox)':
            out.rowsPresetDead && out.rowsPresetDead.view && out.rowsPresetDead.scan,
        'create through the form lands in storage':
            (out.afterCreate || []).indexOf('ops') !== -1,
        'delete through the row button lands in storage':
            (out.afterDelete || []).indexOf('ops') === -1
    };
    out.checks = checks;
    console.log(JSON.stringify(out, null, 2));
    console.log(Object.values(checks).every(Boolean) ? 'DIAG PASS' : 'DIAG FAIL');
    await browser.close();
    process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
