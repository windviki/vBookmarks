// vBookmarks headless-Chrome smoke test (runs inside zenika/alpine-chrome:with-puppeteer)
// Loads the extension from /ext, opens popup / panel / options pages,
// collects page errors and captures light/dark screenshots.
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots/smoke', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Poll for the palette to be open + focused instead of a single fixed sleep:
// the wake-up runs synchronously in neat.js init, but under DinD load the
// popup scripts can land a beat late, which turned a robust open into a
// spurious gate failure at the 900ms mark. Polling keeps the assertion (the
// palette MUST open) while tolerating load timing.
const waitForPalette = async (page, ms = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        const s = await page.evaluate(() => ({
            open: !document.getElementById('command-palette').hidden,
            focused: document.activeElement && document.activeElement.id === 'palette-input'
        }));
        if (s.open && s.focused) return { ...s, waited: Date.now() - t0 };
        await sleep(200);
    }
    return { open: false, focused: false, waited: Date.now() - t0 };
};

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
            if (m.type() !== 'error') return;
            // Chromium auto-logs failed network loads ("Failed to load resource:
            // net::ERR_NAME_NOT_RESOLVED") — noise from DinD's offline sandbox, not
            // extension console.error calls. Favicon fallback is designed to fail
            // silently offline, so this must not fail the gate.
            if (m.text().startsWith('Failed to load resource:')) return;
            errors.push(`${tag} console.error: ${m.text()}`);
        });
    };

    // 1. service worker target → extension id
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found — manifest registration failed?');
    const extId = new URL(swTarget.url()).hostname;
    console.log('extension id:', extId);

    // 2. popup page (light)
    const page = await browser.newPage();
    watch(page, 'popup');
    await page.setViewport({ width: 400, height: 620 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    const stats = await page.evaluate(() => ({
        title: document.title,
        hasTree: !!document.querySelector('#tree'),
        treeRows: document.querySelectorAll('#tree li').length,
        theme: document.body.dataset.theme,
        quickAdd: !!document.querySelector('#quick-add-btn'),
        search: !!document.querySelector('#search')
    }));
    console.log('popup stats:', JSON.stringify(stats));
    await page.screenshot({ path: '/tmp/shots/smoke/popup-light.png' });

    // 2b. v4 task-3 #6: rememberView — the popup reopens on the stored view
    // by default, and falls back to the tree when the option is off.
    const activeViewOf = pg => pg.evaluate(() =>
        (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id);
    await page.evaluate(() => chrome.storage.local.set({ activeView: 'recent' }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);
    const remembered = await activeViewOf(page);
    console.log('rememberView default →', remembered);
    if (remembered !== 'view-tab-recent') errors.push(`rememberView default: got ${remembered}`);
    await page.evaluate(() => chrome.storage.local.set({ rememberView: '' }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);
    const classic = await activeViewOf(page);
    console.log('rememberView off →', classic);
    if (classic !== 'view-tab-tree') errors.push(`rememberView off: got ${classic}`);
    await page.evaluate(() => chrome.storage.local.remove(['activeView', 'rememberView']));

    // 2c. v4 task-3 #20: the classic-experience switches hide their chrome.
    await page.evaluate(() => chrome.storage.local.set({
        quickAddEnabled: '', showToolButton: '', paletteEnabled: '', showViewTabs: ''
    }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);
    const hiddenChrome = await page.evaluate(() => ({
        quickAdd: getComputedStyle(document.getElementById('quick-add-btn')).display === 'none',
        tool: getComputedStyle(document.getElementById('tool-btn')).display === 'none',
        tabs: getComputedStyle(document.getElementById('view-tabs')).display === 'none'
    }));
    console.log('classic chrome hidden:', JSON.stringify(hiddenChrome));
    if (!hiddenChrome.quickAdd || !hiddenChrome.tool || !hiddenChrome.tabs)
        errors.push(`classic hiding broken: ${JSON.stringify(hiddenChrome)}`);
    await page.evaluate(() => chrome.storage.local.remove(
        ['quickAddEnabled', 'showToolButton', 'paletteEnabled', 'showViewTabs']));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);

    // 2d. v4 task-3 #9: a 3.x→4.x upgrade pins the v4 notice + guide link
    // onto the donation card (fresh installs never see it).
    await page.evaluate(() => chrome.storage.local.set({ currentVersion: '3.3.0' }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);
    const v4Notice = await page.evaluate(() => ({
        donationShown: document.getElementById('donation').style.display === 'block',
        noticeVisible: !document.getElementById('v4-notice').hidden,
        text: document.getElementById('v4-notice-text').textContent,
        href: document.getElementById('v4-guide-link').href
    }));
    console.log('v4 upgrade notice:', JSON.stringify(v4Notice));
    if (!v4Notice.donationShown || !v4Notice.noticeVisible || !v4Notice.href.includes('guide-v4'))
        errors.push(`v4 notice broken: ${JSON.stringify(v4Notice)}`);
    await page.screenshot({ path: '/tmp/shots/smoke/popup-v4-upgrade.png' });
    await page.evaluate(() => chrome.storage.local.remove('currentVersion'));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);

    // 2d2. 4.0.8 announce banner: the remote announcement layer renders a
    // cached message offline (the fetch fails silently in DinD), links go to
    // the guide + changelog, and dismiss records the id in vbmAnnounceSeen.
    // donationDisabled pins the donation card off so it can't defer the banner.
    await page.evaluate(() => chrome.storage.local.set({
        donationDisabled: '1',
        vbmAnnounce: {
            ts: Date.now(), etag: null,
            data: { version: 1, messages: [{
                id: 'v408-whats-new', minVersion: '4.0.8', maxVersion: '', channel: 'all',
                once: true, display: 'banner', kind: 'tip',
                titleKey: 'announceV408Title', textKey: 'announceV408Text',
                textFallback: { en: 'favicon-enhanced release' },
                links: [
                    { labelKey: 'donationV4GuideLink', url: 'https://github.com/windviki/vBookmarks/blob/master/docs/guide-v4.md' },
                    { labelKey: 'whatsNewChangelog', url: 'https://github.com/windviki/vBookmarks#v408' }
                ]
            }] }
        }
    }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);
    const announce = await page.evaluate(() => ({
        shown: !document.getElementById('announce').hidden,
        text: document.getElementById('announce').textContent,
        guide: [...document.querySelectorAll('#announce .announce-link')]
            .map(a => a.href).find(h => h.includes('guide-v4')) || '',
        changelog: [...document.querySelectorAll('#announce .announce-link')]
            .map(a => a.href).find(h => h.includes('#v')) || ''
    }));
    console.log('announce banner:', JSON.stringify(announce));
    if (!announce.shown || !announce.guide || !announce.changelog)
        errors.push(`announce banner broken: ${JSON.stringify(announce)}`);
    await page.screenshot({ path: '/tmp/shots/smoke/popup-announce.png' });
    await page.evaluate(() => document.querySelector('#announce .announce-dismiss').click());
    await sleep(400);
    const seen = await page.evaluate(() => new Promise(res =>
        chrome.storage.local.get('vbmAnnounceSeen', v => res(v.vbmAnnounceSeen))));
    if (!seen || !seen.includes('v408-whats-new'))
        errors.push(`announce dismiss not recorded: ${JSON.stringify(seen)}`);
    await page.evaluate(() => chrome.storage.local.remove(
        ['donationDisabled', 'vbmAnnounce', 'vbmAnnounceSeen']));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);

    // 2d3. 4.0.8 local what's-new banner: the network-independent twin of the
    // remote announce — a 4.x → 4.0.8 crossing (version gate, fires once) shows
    // it even when the raw.githubusercontent.com fetch fails (offline DinD, or
    // a proxy that blocks it). Guide + changelog links point at the repo docs.
    await page.evaluate(() => chrome.storage.local.set({ currentVersion: '4.0.6' }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);
    const whatsNew = await page.evaluate(() => ({
        shown: !document.getElementById('whats-new').hidden,
        text: document.getElementById('whats-new-text').textContent,
        guide: document.getElementById('whats-new-guide').href,
        changelog: document.getElementById('whats-new-changelog').href
    }));
    console.log('whats-new 4.0.8 banner:', JSON.stringify(whatsNew));
    if (!whatsNew.shown || !whatsNew.text.includes('favicon')
        || !whatsNew.guide.includes('guide-v4') || !whatsNew.changelog.includes('#v'))
        errors.push(`whats-new banner broken: ${JSON.stringify(whatsNew)}`);
    await page.screenshot({ path: '/tmp/shots/smoke/popup-whats-new.png' });
    await page.evaluate(() => chrome.storage.local.remove('currentVersion'));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);

    // 2d3. 4.0.7 死链视图第二工具条：已标注/未标注过滤真实点击生效。真实浏览
    // 器是最终门——单测的 closest/dataset 桩建模 `data-markfilter` →
    // `dataset.markfilter`（无连字符不变驼峰），一旦视图读 `dataset.markFilter`
    // 就取 undefined、恒回退"全部"，此处 已标注/未标注 点击会立即暴露。种入
    // 两个书签 + 扫描缓存（一死链 404、一受限 403，仅死链被标记），断言：
    // 已标注=只留已标注死链、未标注=只剩未受限未标注行、全部=两者都回。
    const deadIds = await page.evaluate(() => new Promise(resolve => {
        chrome.bookmarks.create(
            { parentId: '2', title: 'Dead A', url: 'https://dead-a.example/' },
            a => chrome.bookmarks.create(
                { parentId: '2', title: 'Dead B', url: 'https://dead-b.example/' },
                b => resolve([a.id, b.id])));
    }));
    const [deadA, deadB] = deadIds;
    await page.evaluate(([a, b]) => new Promise(resolve => chrome.storage.local.set({
        activeView: 'dead',
        deadFilter: 'all',
        deadMarkFilter: '',
        deadMarks: JSON.stringify([a]),
        deadLastScan: JSON.stringify({
            ts: Date.now(), scannedCount: 2,
            results: {
                [a]: { status: 'dead', code: 404 },
                [b]: { status: 'blocked', code: 403 }
            }
        })
    }, resolve)), [deadA, deadB]);
    // waitUntil:'load', not 'networkidle0': the two seeded invalid hosts make
    // the rows' chrome-extension://_favicon requests never settle in the
    // offline DinD sandbox, so a network-idle wait would time out even though
    // the page and the dead-view behavior under test are fully ready. The
    // favicon-fetch console noise is already allowlisted by watch().
    await page.reload({ waitUntil: 'load' });
    await sleep(900);
    const deadRowsOf = () => page.evaluate(([a, b]) => {
        const pressed = document.querySelector('#dead-list .dead-mark-filter-btn[aria-pressed="true"]');
        return {
            a: !!document.getElementById(`dead-item-${a}`),
            b: !!document.getElementById(`dead-item-${b}`),
            buttons: document.querySelectorAll('#dead-list .dead-mark-filter-btn').length,
            pressed: pressed ? pressed.dataset.markfilter : ''
        };
    }, [deadA, deadB]);
    const deadFilterAll = await deadRowsOf();
    console.log('dead filter 全部:', JSON.stringify(deadFilterAll));
    if (deadFilterAll.buttons !== 3 || !deadFilterAll.a || !deadFilterAll.b)
        errors.push(`dead second toolbar missing: ${JSON.stringify(deadFilterAll)}`);
    await page.evaluate(() => document.querySelector('#dead-list .dead-mark-filter-btn[data-markfilter="marked"]').click());
    await sleep(300);
    const deadFilterMarked = await deadRowsOf();
    console.log('dead filter 已标注:', JSON.stringify(deadFilterMarked));
    if (deadFilterMarked.a !== true || deadFilterMarked.b !== false)
        errors.push(`dead 已标注 filter broken: ${JSON.stringify(deadFilterMarked)}`);
    await page.evaluate(() => document.querySelector('#dead-list .dead-mark-filter-btn[data-markfilter="unmarked"]').click());
    await sleep(300);
    const deadFilterUnmarked = await deadRowsOf();
    console.log('dead filter 未标注:', JSON.stringify(deadFilterUnmarked));
    if (deadFilterUnmarked.a !== false || deadFilterUnmarked.b !== true)
        errors.push(`dead 未标注 filter broken: ${JSON.stringify(deadFilterUnmarked)}`);
    await page.evaluate(() => document.querySelector('#dead-list .dead-mark-filter-btn[data-markfilter=""]').click());
    await sleep(300);
    const deadFilterRestore = await deadRowsOf();
    console.log('dead filter 全部恢复:', JSON.stringify(deadFilterRestore));
    if (!deadFilterRestore.a || !deadFilterRestore.b)
        errors.push(`dead 全部 restore broken: ${JSON.stringify(deadFilterRestore)}`);
    await page.evaluate(([a, b]) => new Promise(resolve => chrome.storage.local.remove(
        ['deadFilter', 'deadMarkFilter', 'deadMarks', 'deadLastScan', 'activeView'],
        () => chrome.bookmarks.remove(a, () => chrome.bookmarks.remove(b, resolve)))), [deadA, deadB]);
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);

    // 2e. v4 task-3 #14: with onlyShowBMBar on, "reveal in tree" on a target
    // OUTSIDE the bar toasts a hint instead of silently failing; the toast
    // action shows the full tree (session only) and completes the reveal.
    const outsideId = await page.evaluate(() => new Promise(resolve =>
        chrome.bookmarks.create(
            { parentId: '2', title: 'Outside BM', url: 'https://outside.example/' },
            n => resolve(n.id))));
    await page.evaluate(() => chrome.storage.local.set({ onlyShowBMBar: '1' }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);
    const treeBefore = await page.evaluate(id =>
        !!document.querySelector(`#tree #neat-tree-item-${id}`), outsideId);
    if (treeBefore) errors.push('#14: outside bookmark rendered despite onlyShowBMBar');
    // the outside bookmark is in the recent view — right-click its row there
    await page.evaluate(() => document.getElementById('view-tab-recent').click());
    await sleep(700);
    const menuState = await page.evaluate(id => {
        const row = document.querySelector(`#view-recent [data-node-id="${id}"]`)
            || document.querySelector(`[data-node-id="${id}"]`);
        if (!row) return 'row-missing';
        (row.querySelector('a') || row).dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
        const item = document.getElementById('reveal-in-tree');
        if (!item || item.style.display === 'none') return 'reveal-item-hidden';
        item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
        return 'ok';
    }, outsideId);
    if (menuState !== 'ok') errors.push(`#14: recent-row menu path broken: ${menuState}`);
    await sleep(400);
    const toastState = await page.evaluate(() => ({
        shown: !document.getElementById('undo-toast').hidden,
        text: document.getElementById('undo-toast-text').textContent,
        label: document.getElementById('undo-toast-button').textContent,
        stillRecent: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id
    }));
    console.log('outside-bar reveal toast:', JSON.stringify(toastState));
    if (!toastState.shown || !toastState.text.includes('bookmarks bar') || !toastState.label)
        errors.push(`#14: hint toast broken: ${JSON.stringify(toastState)}`);
    if (toastState.stillRecent !== 'view-tab-recent')
        errors.push(`#14: view switched before the toast action: ${toastState.stillRecent}`);
    // pick the action: full tree shows, reveal completes, tree view activates
    await page.evaluate(() => document.getElementById('undo-toast-button').click());
    await sleep(1500);
    const revealState = await page.evaluate(id => ({
        active: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id,
        rowInTree: !!document.querySelector(`#tree #neat-tree-item-${id}`)
    }), outsideId);
    const settingAfter = await page.evaluate(() => chrome.storage.local.get('onlyShowBMBar'));
    console.log('after toast action:', JSON.stringify(revealState), 'setting:', JSON.stringify(settingAfter));
    if (revealState.active !== 'view-tab-tree' || !revealState.rowInTree)
        errors.push(`#14: override reveal broken: ${JSON.stringify(revealState)}`);
    if (settingAfter.onlyShowBMBar !== '1')
        errors.push(`#14: onlyShowBMBar setting was rewritten: ${JSON.stringify(settingAfter)}`);
    await page.screenshot({ path: '/tmp/shots/smoke/popup-outside-bar-reveal.png' });
    await page.evaluate(id => new Promise(resolve => chrome.bookmarks.remove(id, resolve)), outsideId);
    await page.evaluate(() => chrome.storage.local.remove('onlyShowBMBar'));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);

    // 2f. Final polish: the global palette command's wake-up paths — the
    // ?palette=1 query (fallback popup window) and the pendingPaletteOpen
    // session flag (chrome.action.openPopup path) both auto-open the palette.
    // Pin the master switch back on: the classic-chrome section above toggled
    // it off and, under DinD load, its later remove+reload can still be
    // settling when this step begins — an off switch would make both wake-up
    // paths correctly refuse to open and turn a load-timing flake into a
    // false gate failure. waitForPalette's generous poll window (15s) covers
    // the slow store.ready init under DinD load.
    await page.evaluate(() => chrome.storage.local.set({ paletteEnabled: '1' }));
    await page.goto(`chrome-extension://${extId}/pages/popup.html?palette=1`, { waitUntil: 'networkidle0' });
    const paletteViaQuery = await waitForPalette(page);
    console.log('palette via ?palette=1:', JSON.stringify(paletteViaQuery));
    if (!paletteViaQuery.open || !paletteViaQuery.focused)
        errors.push(`palette=1 wake-up broken: ${JSON.stringify(paletteViaQuery)}`);
    await page.evaluate(() => chrome.storage.session.set({ pendingPaletteOpen: true }));
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    const paletteViaFlag = await waitForPalette(page);
    const flagConsumed = await page.evaluate(async () =>
        !(await chrome.storage.session.get('pendingPaletteOpen')).pendingPaletteOpen);
    console.log('palette via session flag:', JSON.stringify({ ...paletteViaFlag, flagConsumed }));
    if (!paletteViaFlag.open || !paletteViaFlag.focused || !flagConsumed)
        errors.push(`pendingPaletteOpen wake-up broken: ${JSON.stringify({ ...paletteViaFlag, flagConsumed })}`);
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(900);

    // 3. dark mode via emulated prefers-color-scheme (theme=auto default)
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    await sleep(400);
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    console.log('dark body bg:', darkBg);
    await page.screenshot({ path: '/tmp/shots/smoke/popup-dark.png' });

    // 4. side panel page
    const panel = await browser.newPage();
    watch(panel, 'panel');
    await panel.setViewport({ width: 360, height: 700 });
    await panel.goto(`chrome-extension://${extId}/pages/sidepanel.html`, { waitUntil: 'networkidle0' });
    await sleep(800);
    const isPanel = await panel.evaluate(() => document.body.classList.contains('panel-mode'));
    console.log('panel-mode:', isPanel);
    // v4 task-3 #19: the panel page announces its liveness with a heartbeat,
    // so a SW restart can tell a live panel from a stale marker.
    const panelMarkers = await panel.evaluate(() => new Promise(resolve =>
        chrome.storage.session.get(['sidePanelIsOpen', 'sidePanelHeartbeat'], session =>
            resolve({
                marker: session.sidePanelIsOpen,
                beatAge: Date.now() - (session.sidePanelHeartbeat || 0)
            }))));
    console.log('panel markers:', JSON.stringify(panelMarkers));
    if (panelMarkers.marker !== true || !(panelMarkers.beatAge >= 0 && panelMarkers.beatAge < 90000))
        errors.push(`#19: panel heartbeat missing: ${JSON.stringify(panelMarkers)}`);
    await panel.screenshot({ path: '/tmp/shots/smoke/panel-dark.png' });

    // 5. options page (v4 task-3 #17: merged single page — the old advanced
    // sections live here now, vendored CodeMirror included). The page is a tall
    // multi-column layout, so a viewport-only shot would show just the top-left
    // corner — capture the FULL page at the common display resolutions.
    const opts = await browser.newPage();
    watch(opts, 'options');
    await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    const optsStats = await opts.evaluate(() => ({
        themeSelect: !!document.querySelector('#theme-select'),
        sidePanelRow: !!document.querySelector('#open-in-side-panel'),
        recentRow: !!document.querySelector('[id*="recent"]'),
        classicBtn: !!document.querySelector('#classic-experience'),
        userstyle: !!document.querySelector('#userstyle'),
        codeMirror: !!document.querySelector('.CodeMirror'),
        iconPreview: !!document.querySelector('#custom-icon-preview img'),
        groups: document.querySelectorAll('.options-group').length,
        // 4.0.9: the storage-usage summary renders "used / quota" from JS —
        // empty here (clean profile) but must be populated by refreshStorageUsage.
        usageSummary: (document.querySelector('#storage-usage-summary') || { textContent: '' }).textContent
    }));
    console.log('options stats:', JSON.stringify(optsStats));
    if (!optsStats.usageSummary) errors.push('options storage-usage summary missing');
    for (const res of [
        { name: '1080p', width: 1920, height: 1080 },
        { name: '2k', width: 2560, height: 1440 },
        { name: '4k', width: 3840, height: 2160 }
    ]) {
        await opts.setViewport({ width: res.width, height: res.height });
        await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
        await sleep(600);
        await opts.screenshot({ path: `/tmp/shots/smoke/options-${res.name}.png`, fullPage: true });
    }

    // 6. the legacy advanced-options URL must forward to the merged page
    const adv = await browser.newPage();
    watch(adv, 'advanced-options');
    await adv.goto(`chrome-extension://${extId}/pages/advanced-options.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    const advStats = await adv.evaluate(() => ({
        forwarded: window.location.pathname.endsWith('/pages/options.html'),
        groups: document.querySelectorAll('.options-group').length
    }));
    console.log('advanced-options redirect:', JSON.stringify(advStats));
    if (!advStats.forwarded) errors.push('advanced-options.html did not redirect to options.html');
    await adv.screenshot({ path: '/tmp/shots/smoke/advanced-options.png' });

    console.log(errors.length ? 'PAGE ERRORS:\n' + errors.join('\n') : 'NO PAGE ERRORS');
    await browser.close();
    process.exit(errors.length ? 1 : 0);
})().catch(e => {
    console.error('SMOKE FAIL:', e.message);
    process.exit(2);
});
