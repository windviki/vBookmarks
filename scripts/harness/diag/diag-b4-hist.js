// Batch-4: the search-history dead-zone report against the REAL
// sidepanel.html page (body.panel-mode from markup, not the ?panel=1 form)
// plus a saved-query restore boot path, both with real mouse clicks.
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
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;

        const probe = async (label, url, opts) => {
            const page = await browser.newPage();
            await page.setViewport({ width: opts.w || 420, height: opts.h || 640 });
            page.on('pageerror', e => console.log(`[${label}] PAGEERROR:`, e.message));
            page.setDefaultTimeout(60000);
            await page.goto(url, { waitUntil: 'load' });
            await sleep(1200);
            if (opts.seed) {
                await page.evaluate(opts.seed);
                await page.reload({ waitUntil: 'load' });
                await sleep(1500);
            }
            if (!opts.stayView) {
                await page.click('#view-tab-search');
                await sleep(600);
            }
            const state = await page.evaluate(() => {
                const a = document.querySelector('#search-history-area a[data-q]');
                if (!a) return { rows: 0 };
                const r = a.getBoundingClientRect();
                const el = document.elementFromPoint(r.left + 30, r.top + r.height / 2);
                const li = a.closest('li');
                const btn = li.querySelector('.search-history-remove');
                const area = document.getElementById('search-history-area');
                return {
                    rows: document.querySelectorAll('#search-history-area a[data-q]').length,
                    rect: { top: Math.round(r.top), h: Math.round(r.height) },
                    hit: el ? `${el.tagName}.${(el.className || '').split(' ')[0] || ''}` : 'null',
                    removeVis: getComputedStyle(btn).visibility,
                    areaH: Math.round(area.getBoundingClientRect().height),
                    areaCS: getComputedStyle(area).display,
                    bodyCls: document.body.className
                };
            });
            console.log(`[${label}]`, JSON.stringify(state));
            // real-mouse rerun click
            const a = await page.$('#search-history-area a[data-q]');
            if (a) {
                const bb = await a.boundingBox();
                await page.mouse.click(bb.x + 30, bb.y + bb.height / 2);
                await sleep(400);
                console.log(`[${label}] rerun:`, await page.evaluate(() =>
                    JSON.stringify({ input: document.getElementById('search-input').value })));
            }
            await page.close();
        };

        const seed = async () => {
            await new Promise(r => chrome.storage.local.set({
                searchHistory: JSON.stringify([
                    { q: 'zzalpha', ts: Date.now() - 60e3, n: 3 },
                    { q: 'zzbeta', ts: Date.now() - 120e3, n: 5 }
                ]),
                rememberView: '1',
                activeView: 'tree',
                donationDisabled: '1',
                announceEnabled: '0'
            }, r));
        };

        await probe('sidepanel', `chrome-extension://${extId}/pages/sidepanel.html`, { seed });
        await probe('popup-restored-query', `chrome-extension://${extId}/pages/popup.html`, {
            seed: async () => {
                await seed();
                await new Promise(r => chrome.storage.local.set({ activeView: 'search', searchQuery: 'zz' }, r));
            },
            stayView: true
        });
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
