// one-off: light theme blocked pill = white text (like the dead pill), dark
// themes unchanged (black on the paler amber). Seeds a blocked verdict the
// way smoke.js does, then reads the rendered pill color per theme.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2500);
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 420, height: 640 });
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(() => new Promise(resolve => {
            chrome.bookmarks.create({ parentId: '2', title: 'Blocked one', url: 'https://blocked.example/' }, bm => {
                chrome.storage.local.set({
                    activeView: 'dead',
                    deadLastScan: JSON.stringify({
                        ts: Date.now(), scannedCount: 1,
                        results: { [bm.id]: { status: 'blocked', code: 403 } }
                    })
                }, resolve);
            });
        }));
        await sleep(600);
        const read = async () => {
            await page.reload({ waitUntil: 'load' });
            await sleep(1200);
            await page.evaluate(() => {
                const tab = [...document.querySelectorAll('[role="tab"]')].find(t => (t.id || '').includes('dead'));
                if (tab) tab.click();
            });
            await sleep(900);
            return page.evaluate(() => {
                const pill = document.querySelector('.vbm-row .row-badge.blocked');
                if (!pill) return { err: 'no blocked pill' };
                const cs = getComputedStyle(pill);
                return { color: cs.color, bg: cs.backgroundColor, theme: document.body.dataset.theme };
            });
        };
        const light = await read();
        await page.evaluate(() => new Promise(r => chrome.storage.sync.set({ theme: 'dark' }, r)));
        const dark = await read();
        console.log('light:', JSON.stringify(light));
        console.log('dark:', JSON.stringify(dark));
        const ok = light.color === 'rgb(255, 255, 255)' && dark.color === 'rgb(0, 0, 0)'
            && light.err === undefined && dark.err === undefined;
        console.log(ok ? 'VERDICT: PASS' : 'VERDICT: FAIL');
        process.exit(ok ? 0 : 1);
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
