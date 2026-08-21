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
    // Every navigation in this script uses waitUntil:'load', never
    // 'networkidle0': the extension's own background fetch chains (announce
    // feed, favicon enrichment, sync) can stay in flight past the 30 s
    // navigation timeout in the offline DinD sandbox — the same reasoning as
    // the seeded-dead-hosts reload below. The post-navigation sleeps absorb
    // the async init the assertions depend on.
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
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
    await page.reload({ waitUntil: 'load' });
    await sleep(900);
    const remembered = await activeViewOf(page);
    console.log('rememberView default →', remembered);
    if (remembered !== 'view-tab-recent') errors.push(`rememberView default: got ${remembered}`);
    // rememberView is sync-routed (2026-08 storage audit) — seed the sync area.
    await page.evaluate(() => chrome.storage.sync.set({ rememberView: '' }));
    await page.reload({ waitUntil: 'load' });
    await sleep(900);
    const classic = await activeViewOf(page);
    console.log('rememberView off →', classic);
    if (classic !== 'view-tab-tree') errors.push(`rememberView off: got ${classic}`);
    // Clean BOTH areas: sync-routed keys migrate out of local on load, so
    // a local-only remove would leak the sync copy into later sections.
    await page.evaluate(() => {
        chrome.storage.local.remove(['activeView', 'rememberView']);
        chrome.storage.sync.remove('rememberView');
    });

    // 2c. v4 task-3 #20: the classic-experience switches hide their chrome.
    // These four switches are sync-routed (2026-08 storage audit).
    await page.evaluate(() => chrome.storage.sync.set({
        quickAddEnabled: '', showToolButton: '', paletteEnabled: '', showViewTabs: ''
    }));
    await page.reload({ waitUntil: 'load' });
    await sleep(900);
    const hiddenChrome = await page.evaluate(() => ({
        quickAdd: getComputedStyle(document.getElementById('quick-add-btn')).display === 'none',
        tool: getComputedStyle(document.getElementById('tool-btn')).display === 'none',
        tabs: getComputedStyle(document.getElementById('view-tabs')).display === 'none'
    }));
    console.log('classic chrome hidden:', JSON.stringify(hiddenChrome));
    if (!hiddenChrome.quickAdd || !hiddenChrome.tool || !hiddenChrome.tabs)
        errors.push(`classic hiding broken: ${JSON.stringify(hiddenChrome)}`);
    await page.evaluate(() => {
        const keys = ['quickAddEnabled', 'showToolButton', 'paletteEnabled', 'showViewTabs'];
        chrome.storage.local.remove(keys); // pre-migration residue, if any
        chrome.storage.sync.remove(keys);
    });
    await page.reload({ waitUntil: 'load' });
    await sleep(900);

    // 2d. The donation card (redesigned): a 3.x→4.x upgrade forces the card
    // up; the consolidated v4 identity line + guide link head it (no minor
    // version numbers anywhere on the card), the new illustration renders,
    // and the store-rating button rides beside Donate.
    await page.evaluate(() => chrome.storage.local.set({ currentVersion: '3.3.0' }));
    await page.reload({ waitUntil: 'load' });
    await sleep(900);
    const v4Notice = await page.evaluate(() => ({
        donationShown: document.getElementById('donation').style.display === 'block',
        noticeVisible: !document.getElementById('v4-notice').hidden,
        text: document.getElementById('v4-notice-text').textContent,
        href: document.getElementById('v4-guide-link').href,
        rate: (() => { const b = document.getElementById('donation-rate'); return !!b && !!b.querySelector('svg'); })(),
        illustration: !!document.getElementById('donation-illustration')
    }));
    console.log('donation card (v4 upgrade):', JSON.stringify(v4Notice));
    if (!v4Notice.donationShown || !v4Notice.noticeVisible || !v4Notice.href.includes('guide-v4')
        || !v4Notice.rate || !v4Notice.illustration || /4\.0\.\d/.test(v4Notice.text))
        errors.push(`donation card broken: ${JSON.stringify(v4Notice)}`);
    await page.screenshot({ path: '/tmp/shots/smoke/popup-v4-upgrade.png' });
    await page.evaluate(() => chrome.storage.local.remove('currentVersion'));
    await page.reload({ waitUntil: 'load' });
    await sleep(900);

    // 2d2. 4.0.8 announce banner: the remote announcement layer renders a
    // cached message offline (the fetch fails silently in DinD). The seeded
    // message dogfoods the minor-version shape: a `version` condition and a
    // single changelog link (the v4 guide lives on the donation card now).
    // donationDisabled pins the donation card off so it can't defer the banner.
    await page.evaluate(() => chrome.storage.local.set({
        donationDisabled: '1',
        vbmAnnounce: {
            ts: Date.now(), etag: null,
            data: { version: 1, messages: [{
                id: 'v408-whats-new', version: '>=4.0.8', channel: 'all',
                once: true, display: 'banner', kind: 'tip',
                titleKey: 'announceV408Title', textKey: 'announceV408Text',
                textFallback: { en: 'favicon-enhanced release' },
                links: [
                    { labelKey: 'whatsNewChangelog', url: 'https://github.com/windviki/vBookmarks/blob/master/docs/README.md#v408' }
                ]
            }] }
        }
    }));
    await page.reload({ waitUntil: 'load' });
    await sleep(900);
    const announce = await page.evaluate(() => ({
        shown: !document.getElementById('announce').hidden,
        text: document.getElementById('announce').textContent,
        icon: !!document.querySelector('#announce .announce-icon'),
        changelog: [...document.querySelectorAll('#announce .announce-link')]
            .map(a => a.href).find(h => h.includes('README.md#v')) || ''
    }));
    console.log('announce banner:', JSON.stringify(announce));
    if (!announce.shown || !announce.icon || !announce.changelog)
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
    await page.reload({ waitUntil: 'load' });
    await sleep(900);

    // 2d3. 4.0.8 local what's-new banner: the network-independent twin of the
    // remote announce — a 4.x → 4.0.8 crossing (version gate, fires once) shows
    // it even when the raw.githubusercontent.com fetch fails (offline DinD, or
    // a proxy that blocks it). A minor-release banner carries only the version
    // summary + the changelog link (docs/README.md anchor, audit B3/O13).
    await page.evaluate(() => chrome.storage.local.set({ currentVersion: '4.0.6' }));
    await page.reload({ waitUntil: 'load' });
    await sleep(900);
    const whatsNew = await page.evaluate(() => ({
        shown: !document.getElementById('whats-new').hidden,
        text: document.getElementById('whats-new-text').textContent,
        icon: !!document.querySelector('#whats-new .announce-icon'),
        guideGone: !document.getElementById('whats-new-guide'),
        changelog: document.getElementById('whats-new-changelog').href
    }));
    console.log('whats-new 4.0.8 banner:', JSON.stringify(whatsNew));
    if (!whatsNew.shown || !whatsNew.text.includes('favicon') || !whatsNew.icon
        || !whatsNew.guideGone || !whatsNew.changelog.includes('README.md#v'))
        errors.push(`whats-new banner broken: ${JSON.stringify(whatsNew)}`);
    await page.screenshot({ path: '/tmp/shots/smoke/popup-whats-new.png' });
    await page.evaluate(() => chrome.storage.local.remove('currentVersion'));
    await page.reload({ waitUntil: 'load' });
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
    // Area-split seed (2026-08 storage audit): the two filters are
    // sync-routed, the scan cache / marks / active view stay local.
    await page.evaluate(([a, b]) => new Promise(resolve => {
        chrome.storage.sync.set({ deadFilter: 'all', deadMarkFilter: '' }, () =>
            chrome.storage.local.set({
                activeView: 'dead',
                deadMarks: JSON.stringify([a]),
                deadLastScan: JSON.stringify({
                    ts: Date.now(), scannedCount: 2,
                    results: {
                        [a]: { status: 'dead', code: 404 },
                        [b]: { status: 'blocked', code: 403 }
                    }
                })
            }, resolve));
    }), [deadA, deadB]);
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
    // Poll for the seeded scan to render instead of trusting the fixed sleep:
    // the store's sync migration (2026-08 storage audit) added a storage
    // round-trip before store.ready, and the earlier sections' startup work
    // (announce chain, favicon enrichment) stretches init under DinD load —
    // 900 ms proved too tight for the dead view's activate → storage read →
    // getTree → render chain. Same pattern as waitForPalette above.
    const waitForDeadRows = async (ms = 15000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            const s = await deadRowsOf();
            if (s.buttons === 3 && s.a && s.b) return { ...s, waited: Date.now() - t0 };
            await sleep(250);
        }
        return { ...(await deadRowsOf()), waited: Date.now() - t0 };
    };
    const deadFilterAll = await waitForDeadRows();
    console.log('dead filter 全部:', JSON.stringify(deadFilterAll));
    if (deadFilterAll.buttons !== 3 || !deadFilterAll.a || !deadFilterAll.b) {
        // Dump the storage/view state on failure so the next regression is
        // diagnosable from the gate log alone.
        const diag = await page.evaluate(() => new Promise(res =>
            chrome.storage.local.get(null, l => chrome.storage.sync.get(null, sy => res({
                localKeys: Object.keys(l).sort(), syncKeys: Object.keys(sy).sort(),
                activeView: l.activeView, deadFilterSync: sy.deadFilter,
                hasScan: !!l.deadLastScan, deadMarks: l.deadMarks,
                storeDeadFilter: window.store && window.store.get('deadFilter', 'DEF'),
                storeScan: !!(window.store && window.store.get('deadLastScan')),
                viewDeadHidden: document.getElementById('view-dead')?.hidden,
                deadListHtml: (document.getElementById('dead-list')?.innerHTML || '(none)').slice(0, 400),
                activeTab: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id
            })))));
        console.log('DEAD DIAG:', JSON.stringify(diag));
        errors.push(`dead second toolbar missing: ${JSON.stringify(deadFilterAll)}`);
        throw new Error('dead filter section failed — see DEAD DIAG above');
    }
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
    await page.evaluate(([a, b]) => new Promise(resolve => {
        const filters = ['deadFilter', 'deadMarkFilter'];
        chrome.storage.local.remove(
            filters.concat(['deadMarks', 'deadLastScan', 'activeView']), () =>
                chrome.storage.sync.remove(filters, () =>
                    chrome.bookmarks.remove(a, () => chrome.bookmarks.remove(b, resolve))));
    }), [deadA, deadB]);
    await page.reload({ waitUntil: 'load' });
    await sleep(900);

    // 2e. v4 task-3 #14: with onlyShowBMBar on, "reveal in tree" on a target
    // OUTSIDE the bar toasts a hint instead of silently failing; the toast
    // action shows the full tree (session only) and completes the reveal.
    const outsideId = await page.evaluate(() => new Promise(resolve =>
        chrome.bookmarks.create(
            { parentId: '2', title: 'Outside BM', url: 'https://outside.example/' },
            n => resolve(n.id))));
    // onlyShowBMBar is sync-routed (2026-08 storage audit).
    await page.evaluate(() => chrome.storage.sync.set({ onlyShowBMBar: '1' }));
    await page.reload({ waitUntil: 'load' });
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
    // #14b (audit 4.0.8): any real view switch dismisses a lingering toast —
    // pins neat.js's dismissToast wiring into initViewManager's ctx (the unit
    // suites can only cover the view-manager side given the ctx key).
    await page.evaluate(() => document.getElementById('view-tab-tree').click());
    await sleep(500);
    const toastAfterSwitch = await page.evaluate(() => document.getElementById('undo-toast').hidden);
    if (!toastAfterSwitch) errors.push('#14b: toast survived a manual view switch');
    // re-trigger the reveal toast for the action assertions below
    await page.evaluate(() => document.getElementById('view-tab-recent').click());
    await sleep(500);
    await page.evaluate(id => {
        const row = document.querySelector(`#view-recent [data-node-id="${id}"]`)
            || document.querySelector(`[data-node-id="${id}"]`);
        (row.querySelector('a') || row).dispatchEvent(
            new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
        document.getElementById('reveal-in-tree').dispatchEvent(
            new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    }, outsideId);
    await sleep(400);
    const toastAgain = await page.evaluate(() => !document.getElementById('undo-toast').hidden);
    if (!toastAgain) errors.push('#14b: reveal toast did not reappear for the action test');
    // pick the action: full tree shows, reveal completes, tree view activates
    await page.evaluate(() => document.getElementById('undo-toast-button').click());
    await sleep(1500);
    const revealState = await page.evaluate(id => ({
        active: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id,
        rowInTree: !!document.querySelector(`#tree #neat-tree-item-${id}`)
    }), outsideId);
    const settingAfter = await page.evaluate(() => chrome.storage.sync.get('onlyShowBMBar'));
    console.log('after toast action:', JSON.stringify(revealState), 'setting:', JSON.stringify(settingAfter));
    if (revealState.active !== 'view-tab-tree' || !revealState.rowInTree)
        errors.push(`#14: override reveal broken: ${JSON.stringify(revealState)}`);
    if (settingAfter.onlyShowBMBar !== '1')
        errors.push(`#14: onlyShowBMBar setting was rewritten: ${JSON.stringify(settingAfter)}`);
    await page.screenshot({ path: '/tmp/shots/smoke/popup-outside-bar-reveal.png' });
    await page.evaluate(id => new Promise(resolve => chrome.bookmarks.remove(id, resolve)), outsideId);
    await page.evaluate(() => {
        chrome.storage.local.remove('onlyShowBMBar');
        chrome.storage.sync.remove('onlyShowBMBar');
    });
    await page.reload({ waitUntil: 'load' });
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
    // paletteEnabled is sync-routed (2026-08 storage audit).
    await page.evaluate(() => chrome.storage.sync.set({ paletteEnabled: '1' }));
    await page.goto(`chrome-extension://${extId}/pages/popup.html?palette=1`, { waitUntil: 'load' });
    const paletteViaQuery = await waitForPalette(page);
    console.log('palette via ?palette=1:', JSON.stringify(paletteViaQuery));
    if (!paletteViaQuery.open || !paletteViaQuery.focused)
        errors.push(`palette=1 wake-up broken: ${JSON.stringify(paletteViaQuery)}`);
    await page.evaluate(() => chrome.storage.session.set({ pendingPaletteOpen: true }));
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    const paletteViaFlag = await waitForPalette(page);
    const flagConsumed = await page.evaluate(async () =>
        !(await chrome.storage.session.get('pendingPaletteOpen')).pendingPaletteOpen);
    console.log('palette via session flag:', JSON.stringify({ ...paletteViaFlag, flagConsumed }));
    if (!paletteViaFlag.open || !paletteViaFlag.focused || !flagConsumed)
        errors.push(`pendingPaletteOpen wake-up broken: ${JSON.stringify({ ...paletteViaFlag, flagConsumed })}`);
    await page.reload({ waitUntil: 'load' });
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
    await panel.goto(`chrome-extension://${extId}/pages/sidepanel.html`, { waitUntil: 'load' });
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
    await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'load' });
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
        await opts.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'load' });
        await sleep(600);
        await opts.screenshot({ path: `/tmp/shots/smoke/options-${res.name}.png`, fullPage: true });
    }

    // 5b. 4.0.8: the favicon gallery page renders the seeded enrichment cache
    // (host card + source badge + the bookmark row with its folder path) with
    // zero page errors, and follows the theme. Seed from the OPTIONS page: the
    // popup's own enricher would debounce-rewrite the index from its in-memory
    // cache and could race the seed away.
    const fav = await browser.newPage();
    watch(fav, 'favicons');
    await fav.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'load' });
    await sleep(400);
    const favSeed = await fav.evaluate(() => {
        const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/0D8lJQAAAABJRU5ErkJggg==';
        return new Promise(resolve => {
            chrome.bookmarks.create({ title: 'Smoke Icon', url: 'http://127.0.0.1:9/smoke' }, bm => {
                const idx = { v: 3, down: { 'favicon-run': 0, 'icon-horse': 0, 'duckduckgo': 0 },
                    hosts: { '127.0.0.1:9': { t: Date.now(), s: icon.length, src: 'direct' } } };
                chrome.storage.local.set({
                    vbmFaviconIdx: JSON.stringify(idx),
                    'vbmFavicon:127.0.0.1:9': icon
                }, () => resolve({ bmId: bm && bm.id }));
            });
        });
    });
    await fav.goto(`chrome-extension://${extId}/pages/favicons.html`, { waitUntil: 'load' });
    await sleep(600);
    const favStats = await fav.evaluate(() => ({
        cards: document.querySelectorAll('#fav-grid .fav-card').length,
        host: (document.querySelector('.fav-host') || {}).textContent || '',
        srcBadge: (document.querySelector('.fav-src') || {}).textContent || '',
        rows: document.querySelectorAll('.fav-bm').length,
        path: (document.querySelector('.fav-bm-path') || {}).textContent || '',
        chips: document.querySelectorAll('.fav-chip').length,
        stats: (document.getElementById('fav-stats') || {}).textContent || '',
        theme: document.body.dataset.theme || ''
    }));
    console.log('favicons stats:', JSON.stringify(favStats));
    if (favStats.cards !== 1) errors.push(`favicons: expected 1 card, got ${favStats.cards}`);
    if (favStats.host !== '127.0.0.1:9') errors.push(`favicons: host card missing: ${favStats.host}`);
    if (!favStats.srcBadge) errors.push('favicons: source badge missing');
    if (favStats.rows !== 1 || !favStats.path)
        errors.push(`favicons: bookmark row/path missing: rows=${favStats.rows} path=${favStats.path}`);
    if (favStats.chips < 2) errors.push(`favicons: source chips missing: ${favStats.chips}`);
    if (!favStats.stats) errors.push('favicons: stats strip empty');
    if (!favStats.theme) errors.push('favicons: theme not applied');
    await fav.screenshot({ path: '/tmp/shots/smoke/favicons.png' });
    // Clean up the seed (the gallery itself is display-only).
    await fav.evaluate(bmId => new Promise(resolve => {
        chrome.storage.local.remove(['vbmFaviconIdx', 'vbmFavicon:127.0.0.1:9'], () =>
            chrome.bookmarks.remove(bmId, () => resolve()));
    }), favSeed.bmId);
    await fav.close();

    // 6. the legacy advanced-options URL must forward to the merged page
    const adv = await browser.newPage();
    watch(adv, 'advanced-options');
    await adv.goto(`chrome-extension://${extId}/pages/advanced-options.html`, { waitUntil: 'load' });
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
