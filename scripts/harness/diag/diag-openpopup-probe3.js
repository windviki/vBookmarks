// Probe v3: the REAL action popup target is auto-attached by puppeteer but
// target.page() returns null for it. createCDPSession() works on every known
// target — measure the real popup's window size across view switches.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--lang=zh-CN',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });
    await sleep(2000);
    const swTarget = browser.targets().find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;

    const opener = await browser.newPage();
    await opener.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(800);
    await opener.evaluate(() => chrome.storage.local.set({
        popupWidth: 400, popupHeight: 599, activeView: 'tree', showTabBadges: '1'
    }));
    const opened = await opener.evaluate(() => new Promise(resolve => {
        chrome.action.openPopup(() => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok'));
    }));
    console.log('openPopup:', opened);
    await sleep(2000);

    // find the popup target: the popup.html page that is NOT the opener
    const openerTarget = opener.target();
    const candidates = browser.targets().filter(t => t.type() === 'page' && t.url().includes('popup.html'));
    console.log('popup.html targets:', candidates.length);
    const popupTarget = candidates.find(t => t !== openerTarget) || candidates[0];
    console.log('chosen target url:', popupTarget.url());
    const client = await popupTarget.createCDPSession();
    const evalIn = async expr => {
        const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        return r.result ? r.result.value : JSON.stringify(r);
    };
    const measure = async label => {
        const m = await evalIn(`JSON.stringify({
            innerW: window.innerWidth, outerW: window.outerWidth,
            bodyW: document.body.offsetWidth,
            rootW: document.documentElement.offsetWidth,
            docScrollW: document.documentElement.scrollWidth,
            active: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id || '',
            badges: Array.from(document.querySelectorAll('.view-tab .tab-badge')).map(b => b.textContent).join(',')
        })`);
        console.log(label, m);
    };
    await measure('open');
    for (const v of ['stats', 'dead', 'dupes', 'recent', 'tree']) {
        await evalIn(`document.getElementById('view-tab-${v}').click(); true`);
        await sleep(1500);
        await measure(`view: ${v}`);
    }
    await browser.close();
})().catch(e => {
    console.error('PROBE FAIL:', e.message);
    process.exit(2);
});
