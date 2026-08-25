// Diagnostic: replicate verify-scrollbars Phase B2 (browser zoom 0.9 ×
// viewport 600, autoResize on) and list every element whose box extends
// below the viewport — the "documentElement no vertical overflow (2px)"
// regression hunt. Prints the offender list + menu geometry, exits 0.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const PREF_KEYS = ['popupWidth', 'popupHeight', 'autoResizePopup', 'rememberView', 'activeView',
    'onlyShowBMBar', 'showViewTabs', 'showToolButton', 'paletteEnabled'];
const SYNC_PREF_KEYS = new Set(['rememberView', 'onlyShowBMBar', 'showViewTabs', 'showToolButton', 'paletteEnabled']);

const makeInitScript = (browserZoom, screenW, screenH) => `(() => {
    try {
        const gz = chrome.tabs.getZoom;
        chrome.tabs.getZoom = cb => gz.call(chrome.tabs, () => cb(${browserZoom}));
    } catch (e) {
        try { Object.defineProperty(chrome.tabs, 'getZoom', { configurable: true, value: cb => cb(${browserZoom}) }); } catch (e2) {}
    }
    try { Object.defineProperty(window.screen, 'width',  { configurable: true, get: () => ${screenW} }); } catch (e) {}
    try { Object.defineProperty(window.screen, 'height', { configurable: true, get: () => ${screenH} }); } catch (e) {}
    try { Object.defineProperty(window, 'screenY', { configurable: true, get: () => 0 }); } catch (e) {}
    try { window.close = () => {}; } catch (e) {}
})()`;

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const worker = await swTarget.worker();
    const extId = new URL(swTarget.url()).hostname;

    const values = [320, 600, '1', '', '', '', '1', '1', '1'];
    await worker.evaluate(({ keys, values, syncKeys }) => {
        const local = {}, sync = {};
        keys.forEach((k, i) => (syncKeys.includes(k) ? sync : local)[k] = values[i]);
        return Promise.all([chrome.storage.local.set(local), chrome.storage.sync.set(sync)]);
    }, { keys: PREF_KEYS, values, syncKeys: [...SYNC_PREF_KEYS] });

    const page = await browser.newPage();
    await page.evaluateOnNewDocument(makeInitScript(0.9, 1920, 1080));
    await page.setViewport({ width: 320, height: 600 });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(1200);

    // sweep the views like B2 does
    for (const id of ['tree', 'search', 'recent', 'stats', 'dead', 'dupes', 'tabgroups']) {
        await page.evaluate(vid => {
            const el = document.getElementById('view-tab-' + vid);
            if (el)
                el.click();
        }, id);
        await sleep(300);
    }
    await sleep(400);

    const m = await page.evaluate(() => {
        const de = document.documentElement;
        const out = {
            bodyH: document.body.offsetHeight,
            vp: window.innerHeight,
            htmlOverflow: de.scrollHeight - de.clientHeight,
            scrollH: de.scrollHeight,
            clientH: de.clientHeight,
            offenders: []
        };
        const all = document.querySelectorAll('*');
        for (const el of all) {
            const r = el.getBoundingClientRect();
            if (r.bottom > window.innerHeight + 0.5 && r.height > 0) {
                const cs = getComputedStyle(el);
                out.offenders.push({
                    sel: `${el.tagName.toLowerCase()}#${el.id || '-'}${(el.className && typeof el.className === 'string') ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''}`,
                    top: Math.round(r.top * 10) / 10,
                    bottom: Math.round(r.bottom * 10) / 10,
                    h: Math.round(r.height * 10) / 10,
                    pos: cs.position,
                    display: cs.display,
                    zoom: cs.zoom
                });
            }
        }
        out.offenders.sort((a, b) => b.bottom - a.bottom);
        out.offenders = out.offenders.slice(0, 12);
        const fm = document.getElementById('folder-context-menu');
        const bm = document.getElementById('bookmark-context-menu');
        const rect = el => {
            if (!el)
                return null;
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { top: r.top, bottom: r.bottom, h: r.height, pos: cs.position, zoom: cs.zoom, display: cs.display,
                items: el.querySelectorAll('.menu-item').length };
        };
        out.folderMenu = rect(fm);
        out.bookmarkMenu = rect(bm);
        return out;
    });
    console.log(JSON.stringify(m, null, 2));
    await browser.close();
})().catch(e => {
    console.error('DIAG FAIL:', e.message);
    process.exit(2);
});
