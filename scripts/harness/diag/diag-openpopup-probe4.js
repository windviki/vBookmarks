// Probe v4: does a fractional devicePixelRatio (1.5 — the user's stored
// popupWidth 513.6666259765625 ≈ 513.67 smells of a 1.5× display) produce a
// per-view popup-width delta in the real action popup? Uses the global
// --force-device-scale-factor=1.5 launch flag (popup targets reject
// Emulation.setDeviceMetricsOverride), then sweeps the views measuring
// innerWidth + the active list's scrollWidth.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=zh-CN',
            '--force-device-scale-factor=1.5',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const swTarget = browser.targets().find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;

    const opener = await browser.newPage();
    await opener.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(800);
    await opener.evaluate(() => chrome.storage.local.set({
        popupWidth: 513.6666259765625, popupHeight: 599, activeView: 'tree', showTabBadges: '1'
    }));
    // a few dupes groups so the dupes view renders toolbar rows + list
    await opener.evaluate(() => chrome.storage.local.set({
        dupesLastResult: JSON.stringify({
            ts: Date.now(), scope: 'all', ignoreScheme: false,
            groups: Array.from({ length: 20 }, (_, i) => ({
                key: `https://example.com/path/${i}?query=abcdefghijklmnopqrstuvwxyz`,
                items: [
                    { id: `${i}a`, title: 'First copy title', url: 'https://example.com/path/0' },
                    { id: `${i}b`, title: 'Second copy title', url: 'https://example.com/path/0' }
                ]
            }))
        })
    }));
    await opener.evaluate(() => new Promise(resolve => {
        chrome.action.openPopup(() => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok'));
    }));
    await sleep(6000);

    const openerTarget = opener.target();
    const candidates = browser.targets().filter(t => t.type() === 'page' && t.url().includes('popup.html'));
    const popupTarget = candidates.find(t => t !== openerTarget);
    if (!popupTarget) throw new Error('action popup target not found');
    const client = await popupTarget.createCDPSession();
    const evalIn = async expr => {
        const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        return r.result ? r.result.value : JSON.stringify(r);
    };
    // DPR already forced globally at launch — just wait for the popup layout.
    await sleep(1500);
    const measure = async label => {
        const m = JSON.parse(await evalIn(`JSON.stringify({
            innerW: window.innerWidth, outerW: window.outerWidth, dpr: window.devicePixelRatio,
            rootW: document.documentElement.offsetWidth,
            docScrollW: document.documentElement.scrollWidth,
            bodyW: document.body.offsetWidth,
            list: (() => {
                const l = document.querySelector('.view:not([hidden]) [id$="-list"], .view:not([hidden]) #tree');
                return l ? { id: l.id, sw: l.scrollWidth, cw: l.clientWidth } : null;
            })()
        })`));
        console.log(label, JSON.stringify(m));
    };
    await measure('open (tree)');
    for (const v of ['stats', 'dead', 'dupes', 'recent', 'search', 'tree']) {
        await evalIn(`document.getElementById('view-tab-${v}').click(); true`);
        await sleep(1500);
        await measure(`view: ${v}`);
    }
    await browser.close();
})().catch(e => {
    console.error('PROBE FAIL:', e.message);
    process.exit(2);
});
