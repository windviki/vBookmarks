// Batch-2 diagnostics v3: full user-like flow — panel mode, virtualScrollLab
// ON from the start, search selection mode entered (broken visuals) then
// exited, then search-history probes with REAL mouse: hover reveal, rerun
// click, row × click, clear-all click, plus capture-phase event loggers.
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
        const page = await browser.newPage();
        await page.setViewport({ width: 800, height: 800 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(60000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html?panel=1`, { waitUntil: 'load' });
        await sleep(1200);
        await page.evaluate(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const tree = await new Promise(r => chrome.bookmarks.getTree(r));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            for (let i = 0; i < 3; i++)
                await create({ parentId: bar.id, title: `zzanchored ${i}`, url: `http://127.0.0.1:9/a/${i}` });
            const now = Date.now();
            await new Promise(r => chrome.storage.local.set({
                virtualScrollLab: '1',
                searchHistory: JSON.stringify([
                    { q: 'zzalpha', ts: now - 60e3, n: 3 },
                    { q: 'zzbeta', ts: now - 120e3, n: 5 },
                    { q: 'zzgamma', ts: now - 180e3, n: 1 }
                ]),
                activeView: 'tree'
            }, r));
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // event loggers on the history area
        await page.evaluate(() => {
            window.__log = [];
            const area = document.getElementById('search-history-area');
            area.addEventListener('click', e => window.__log.push(`area-click:${e.target.tagName}.${(e.target.className || '').split(' ')[0]}`), true);
            area.addEventListener('contextmenu', e => window.__log.push(`area-ctx:${e.target.tagName}`), true);
        });

        // selection-mode round trip first
        await page.click('#view-tab-search');
        await sleep(500);
        await page.type('#search-input', 'zz');
        await sleep(700);
        await page.evaluate(() => document.querySelector('#results .search-select-mode').click());
        await sleep(400);
        await page.evaluate(() => document.querySelector('#results-ul li.vbm-row').click());
        await sleep(300);
        // exit via the exit button (id-less: .search-select-exit)
        const exited = await page.evaluate(() => {
            const btn = document.querySelector('.search-select-exit');
            if (!btn) return 'no-exit-btn';
            btn.click();
            return 'clicked';
        });
        await sleep(500);
        console.log('v3 exit selection:', exited);
        await page.evaluate(() => {
            const input = document.getElementById('search-input');
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await sleep(400);

        // history probes with real mouse
        const probe = async label => {
            const info = await page.evaluate(() => {
                const out = { rows: document.querySelectorAll('#search-history-area a[data-q]').length };
                const a = document.querySelector('#search-history-area a[data-q]');
                if (!a) return Object.assign(out, { err: 'no-rows' });
                const r = a.getBoundingClientRect();
                const el = document.elementFromPoint(r.left + 30, r.top + r.height / 2);
                out.hit = el ? `${el.tagName}.${(el.className || '').split(' ')[0] || ''}` : 'null';
                out.rect = { top: Math.round(r.top), left: Math.round(r.left), h: Math.round(r.height) };
                out.areaOverflow = getComputedStyle(document.getElementById('search-history-area')).overflow;
                return out;
            });
            console.log(`v3 ${label}:`, JSON.stringify(info));
        };
        await probe('history state');
        // real hover over the first row
        const bb = await (await page.$('#search-history-area li.search-history-row')).boundingBox();
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await sleep(250);
        console.log('v3 hover:', await page.evaluate(() => JSON.stringify({
            hoverMatch: document.querySelector('.search-history-row').matches(':hover'),
            removeVis: getComputedStyle(document.querySelector('.search-history-remove')).visibility
        })));
        await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await sleep(400);
        console.log('v3 rerun:', await page.evaluate(() => JSON.stringify({
            input: document.getElementById('search-input').value,
            log: window.__log
        })));
        // clear input, then click clear-all
        await page.evaluate(() => {
            const input = document.getElementById('search-input');
            input.value = '';
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await sleep(300);
        const clear = await page.$('#search-history-clear');
        if (clear) {
            const cb = await clear.boundingBox();
            await page.mouse.click(cb.x + cb.width / 2, cb.y + cb.height / 2);
            await sleep(300);
        }
        console.log('v3 clear-all:', await page.evaluate(() => JSON.stringify({
            rows: document.querySelectorAll('#search-history-area a[data-q]').length,
            log: window.__log
        })));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL', e); process.exit(1); });
