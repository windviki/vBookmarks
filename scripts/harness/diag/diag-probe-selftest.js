// Self-test for scripts/console/probe-408-badge-width.js: evaluate the probe
// inside the REAL action popup, capture the [VBM] console lines, and run the
// width sweep — proving the probe works before handing it to the user.
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const PROBE = fs.readFileSync('/ext/scripts/console/probe-408-badge-width.js', 'utf8');
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=zh-CN',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const swTarget = browser.targets().find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;

    const opener = await browser.newPage();
    await opener.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(800);
    await opener.evaluate(() => chrome.storage.local.set({
        popupWidth: 400, popupHeight: 599, activeView: 'tree', showTabBadges: '1',
        dupesLastResult: JSON.stringify({
            ts: Date.now(), scope: 'all', ignoreScheme: false,
            groups: [{
                key: 'https://example.com/path/0?query=abcdefghijklmnopqrstuvwxyz',
                items: [
                    { id: 'a', title: 'First copy title', url: 'https://example.com/path/0' },
                    { id: 'b', title: 'Second copy title', url: 'https://example.com/path/0' }
                ]
            }]
        })
    }));
    await opener.evaluate(() => new Promise(resolve => {
        chrome.action.openPopup(() => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok'));
    }));
    await sleep(5000);

    const openerTarget = opener.target();
    const candidates = browser.targets().filter(t => t.type() === 'page' && t.url().includes('popup.html'));
    const popupTarget = candidates.find(t => t !== openerTarget);
    if (!popupTarget) throw new Error('action popup target not found');
    const client = await popupTarget.createCDPSession();
    await client.send('Runtime.enable');
    const logs = [];
    client.on('Runtime.consoleAPICalled', e => {
        const text = e.args.map(a => a.value || a.description || '').join(' ');
        if (text.includes('[VBM]')) {
            logs.push(text);
            console.log(text);
        }
    });
    const evalIn = async expr => {
        const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        return r.result ? r.result.value : JSON.stringify(r);
    };
    const err = await evalIn(PROBE + '; true');
    if (err !== true) console.log('probe eval returned:', err);
    console.log('--- running __vbmWidthSweep() ---');
    await evalIn('__vbmWidthSweep().then(() => true)');
    await sleep(15000);
    console.log('--- running __vbmWidthDelta() ---');
    await evalIn('__vbmWidthDelta().then(() => true)');
    await sleep(6000);
    console.log('TOTAL [VBM] lines:', logs.length);
    await browser.close();
})().catch(e => {
    console.error('PROBE FAIL:', e.message);
    process.exit(2);
});
