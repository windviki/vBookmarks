// 4.0.2 header + search-history compact probe — one line of facts per theme.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    if (!swTarget) throw new Error('sw not found');
    const extId = new URL(swTarget.url()).hostname;

    const compact = (page) => page.evaluate(() => {
        const R = (el, extra) => {
            if (!el) return null;
            const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
            const o = { id: el.id || '', w: Math.round(b.width), h: Math.round(b.height),
                r: cs.borderRadius, mt: cs.marginTop, mb: cs.marginBottom, ml: cs.marginLeft,
                pt: cs.paddingTop, pr: cs.paddingRight, pb: cs.paddingBottom, pl: cs.paddingLeft,
                bg: cs.backgroundColor, fz: cs.fontSize, fs: cs.fontStyle, ls: cs.lineHeight };
            if (extra) Object.assign(o, extra(el, cs, b));
            return o;
        };
        const q = s => document.querySelector(s);
        const headerChildren = [...document.querySelector('#search').children].map(el => {
            const b = el.getBoundingClientRect();
            return { id: el.id, x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height),
                right: Math.round(b.right), vis: getComputedStyle(el).visibility, disp: getComputedStyle(el).display };
        });
        // row-btn right-edge alignment probe: tree row slots
        const row = q('#tree ul li');
        const rowBtns = row ? [...row.querySelectorAll('.row-btn')].map(btn => {
            const b = btn.getBoundingClientRect();
            return { cls: btn.className, right: Math.round(b.right), vis: getComputedStyle(btn).visibility, disp: getComputedStyle(btn).display };
        }) : [];
        return {
            search: R(q('#search')), input: R(q('#search input')),
            field: R(q('#search-field')), clear: R(q('#search-clear')),
            quickAdd: R(q('#quick-add-btn')), toolBtn: R(q('#tool-btn')),
            headerChildren, rowBtns,
            searchRow: R(q('.search-history-head')),
            tabsH: R(q('#view-tabs')),
            radiusVar: getComputedStyle(document.body).getPropertyValue('--vbm-radius')
        };
    });

    for (const theme of ['light', 'dark', 'ink', 'paper']) {
        const page = await browser.newPage();
        page.on('pageerror', e => console.log(`[${theme}] pageerror: ${e.message}`));
        await page.setViewport({ width: 400, height: 640 });
        await page.evaluateOnNewDocument(t => { try { localStorage.setItem('theme', t); } catch (e) {} }, theme);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await page.evaluate(t => chrome.storage.local.set({ theme: t, currentVersion: chrome.runtime.getManifest().version,
            donationFactor: 1, donationKey: 30 }), theme);
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(900);
        console.log(`THEME ${theme}: ` + JSON.stringify(await compact(page)));
        await page.close();
    }

    // search-history: activate the search view with proper {q,ts,n} entries
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 640 });
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('theme', 'light'); } catch (e) {} });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => chrome.storage.local.set({
        theme: 'light', currentVersion: chrome.runtime.getManifest().version,
        searchHistory: JSON.stringify([
            { q: 'github bookmarks', ts: Date.now() - 60000, n: 12 },
            { q: 'chrome extension docs', ts: Date.now() - 3600000, n: 5 },
            { q: 'design system tokens', ts: Date.now() - 86400000, n: 3 }
        ])
    }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(800);
    // open search view: click the search view tab
    await page.evaluate(() => document.querySelector('#view-tab-search').click());
    await sleep(600);
    const hist = await page.evaluate(() => {
        const area = document.querySelector('#search-history-area');
        const head = document.querySelector('.search-history-head');
        const rows = [...document.querySelectorAll('.search-history-row')];
        const g = el => { if (!el) return null; const cs = getComputedStyle(el); const b = el.getBoundingClientRect();
            return { h: Math.round(b.height), pt: cs.paddingTop, pr: cs.paddingRight, pb: cs.paddingBottom, pl: cs.paddingLeft,
                     mt: cs.marginTop, mb: cs.marginBottom, gap: cs.gap, fz: cs.fontSize, disp: cs.display, vis: cs.visibility };
        };
        return {
            area: g(area), head: g(head), headChildren: head ? [...head.children].map(c => ({ cls: c.className, fz: getComputedStyle(c).fontSize })) : [],
            rows: rows.map(r => g(r)),
            rowMeta: rows.map(r => { const m = r.querySelector('.history-meta'); const t = r.querySelector('.history-time'); const c = r.querySelector('.history-clock');
                return { meta: g(m), time: g(t), clock: g(c), rowBtn: r.querySelector('.row-btn') ? g(r.querySelector('.row-btn')) : null }; })
        };
    });
    console.log('SEARCH-HISTORY: ' + JSON.stringify(hist, null, 1));
    await page.close();
    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
