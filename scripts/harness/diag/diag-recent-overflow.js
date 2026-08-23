// Bisect the #recent-list computed-overflow-x regression: print the matched
// overflow declarations + test with the 4.1.0 content-visibility block
// neutralized via an injected override.
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
        await sleep(2000);
        let sw = null;
        for (let i = 0; i < 20 && !sw; i++) {
            sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
            if (!sw)
                await sleep(500);
        }
        if (!sw)
            throw new Error('service worker target not found');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 320, height: 600 });
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        // Replicate the harness Phase A setup: internal zoom 90 + popupWidth 320.
        await page.evaluate(() => chrome.storage.local.set({ zoom: '90', popupWidth: 320, activeView: 'recent' }));
        await page.reload({ waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(() => { const b = document.getElementById('view-tab-recent'); if (b) b.click(); });
        await sleep(800);

        const probe = async (label) => page.evaluate(tag => {
            const out = [];
            for (const id of ['recent-list', 'dupes-list', 'stats-list', 'tabgroups-list']) {
                const el = document.getElementById(id);
                const cs = getComputedStyle(el);
                out.push(`${id}:ox=${cs.overflowX},oy=${cs.overflowY},disp=${cs.display},cv-rows=${el.querySelectorAll('li').length}`);
            }
            return `[${tag}] bodyZoomAttr=${document.body.dataset.zoom || '(none)'} ` + out.join(' ');
        }, label);

        console.log(await probe('as-is'));
        // Neutralize the 4.1.0 content-visibility block on recent rows only.
        await page.addStyleTag({ content: '#recent-list ul li.vbm-row { content-visibility: visible !important; contain-intrinsic-size: none; }' });
        await sleep(300);
        console.log(await probe('cv-neutralized'));
        // Remove overflow-x entirely on the rows' parent? No — try removing the
        // cv block effect from ALL lists to see cross-effect.
        await page.addStyleTag({ content: `
#tabgroups-list ul li.vbm-row,#tabgroups-list ul li.tabgroups-group,#tabgroups-list ul li.tabgroups-window-head,
#tabgroups-list ul li.tabgroups-section-head,#tabgroups-list ul li.tabgroups-closed-group,#tabgroups-list ul li.tabgroups-closed-tab,
#dupes-list ul li.vbm-row,#dupes-list ul li.dupes-group,#dead-list ul li.vbm-row,#recent-list ul li.vbm-row,#stats-list ul li.vbm-row
{ content-visibility: visible !important; }` });
        await sleep(300);
        console.log(await probe('cv-all-neutralized'));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAILED:', e && e.stack || e); process.exit(1); });
