// vBookmarks 4.0.2 视觉现状探测 — runs inside zenika/alpine-chrome:with-puppeteer.
// Dumps computed-style + geometry facts for the design doc as TEXT (the model
// that reads this cannot view PNGs), so every decision number is authoritative.
// Run: docker run --rm vbm-smoke:local node /work/diag/diag-402-visual.js
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: [
            '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext'
        ]
    });
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;

    const dump = async (theme) => {
        const page = await browser.newPage();
        page.on('pageerror', e => console.log(`  [${theme}] pageerror: ${e.message}`));
        await page.setViewport({ width: 400, height: 640 });
        await page.evaluateOnNewDocument(t => { try { localStorage.setItem('theme', t); } catch (e) {} }, theme);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await page.evaluate(t => chrome.storage.local.set({
            theme: t,
            currentVersion: chrome.runtime.getManifest().version,
            donationFactor: 1, donationKey: 30
        }), theme);
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(1000);

        const out = await page.evaluate(() => {
            const R = (el) => {
                if (!el) return null;
                const cs = getComputedStyle(el);
                const b = el.getBoundingClientRect();
                return {
                    tag: el.tagName, id: el.id || '', cls: (el.className || '').toString().slice(0, 50),
                    w: Math.round(b.width), h: Math.round(b.height),
                    radius: cs.borderRadius,
                    margin: cs.marginTop + ' ' + cs.marginRight + ' ' + cs.marginBottom + ' ' + cs.marginLeft,
                    padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
                    bg: cs.backgroundColor, border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
                    boxShadow: cs.boxShadow,
                    display: cs.display, overflow: cs.overflow + '/' + cs.overflowY
                };
            };
            const q = s => document.querySelector(s);
            const listRects = (sel) => [...document.querySelectorAll(sel)].map(el => {
                const b = el.getBoundingClientRect();
                return { id: el.id || '', w: Math.round(b.width), h: Math.round(b.height),
                         radius: getComputedStyle(el).borderRadius, cls: (el.className || '').toString().slice(0, 40) };
            });

            // header row children geometry + right edges (hover-alignment probe)
            const headerChildren = [...document.querySelector('#search').children].map(el => {
                const b = el.getBoundingClientRect();
                const cs = getComputedStyle(el);
                return { tag: el.tagName, id: el.id || '', cls: (el.className || '').toString().slice(0, 30),
                         x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height),
                         right: Math.round(b.right), radius: cs.borderRadius, vis: cs.visibility, disp: cs.display };
            });

            // tree rows: right-edge of fixed slots vs hover-only buttons
            const firstRows = [...document.querySelectorAll('#tree ul li')].slice(0, 4).map(li => {
                const b = li.getBoundingClientRect();
                const btns = [...li.querySelectorAll('.row-btn')].map(btn => {
                    const bb = btn.getBoundingClientRect();
                    return { cls: btn.className, right: Math.round(bb.right), vis: getComputedStyle(btn).visibility, disp: getComputedStyle(btn).display };
                });
                const time = li.querySelector('.time, .row-time, .relative-time');
                return { liW: Math.round(b.width), right: Math.round(b.right),
                         btns, timeRight: time ? Math.round(time.getBoundingClientRect().right) : null };
            });

            return {
                header: {
                    searchRow: R(q('#search')), searchField: R(q('#search-field')),
                    searchInput: R(q('#search input')), quickAdd: R(q('#quick-add-btn')), toolBtn: R(q('#tool-btn')),
                    headerChildren,
                    searchRowChildrenSpacing: [...document.querySelector('#search').children].map(el => ({
                        id: el.id, gapAfter: el.nextElementSibling ? null : null
                    }))
                },
                viewTabs: R(q('#view-tabs')),
                tabs: listRects('.view-tab'),
                tabIndicator: R(q('.tab-indicator')),
                panes: {
                    tree: R(q('#tree')), results: R(q('#results')),
                    recentList: R(q('#recent-list')),
                    viewContainer: R(q('#views'))
                },
                treeRows: firstRows,
                dialog: R(q('.vbm-dialog, #edit-dialog, #confirm-dialog')),
                menu: R(q('menu[type=context]')),
                radiusTokens: {
                    vbmRadius: getComputedStyle(document.body).getPropertyValue('--vbm-radius'),
                    rowH: getComputedStyle(document.body).getPropertyValue('--vbm-row-h')
                }
            };
        });
        console.log(`\n===== THEME ${theme} =====`);
        console.log(JSON.stringify(out, null, 1));
        await page.close();
    };

    for (const theme of ['light', 'dark', 'ink', 'paper']) await dump(theme);

    // search-history area probe (light theme): full layout facts
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 640 });
    await page.evaluateOnNewDocument(() => { try { localStorage.setItem('theme', 'light'); } catch (e) {} });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => chrome.storage.local.set({
        theme: 'light', currentVersion: chrome.runtime.getManifest().version,
        searchHistory: JSON.stringify([
            { q: 'github bookmarks', t: Date.now() - 60000 },
            { q: 'chrome extension docs', t: Date.now() - 3600000 },
            { q: 'design system tokens', t: Date.now() - 86400000 }
        ])
    }));
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(800);
    const hist = await page.evaluate(() => {
        const area = document.querySelector('#search-history-area');
        const head = document.querySelector('.search-history-head');
        const rows = [...document.querySelectorAll('.search-history-row')];
        const rowInfo = rows.map(r => {
            const cs = getComputedStyle(r);
            const b = r.getBoundingClientRect();
            return { h: Math.round(b.height), padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft,
                     gap: cs.gap, cls: (r.className || '').toString() };
        });
        return {
            area: area ? (() => { const cs = getComputedStyle(area); const b = area.getBoundingClientRect();
                return { h: Math.round(b.height), padding: cs.padding, margin: cs.margin, borderBottom: cs.borderBottomWidth } })() : null,
            head: head ? (() => { const cs = getComputedStyle(head); const b = head.getBoundingClientRect();
                return { h: Math.round(b.height), padding: cs.paddingTop + ' ' + cs.paddingRight + ' ' + cs.paddingBottom + ' ' + cs.paddingLeft, fontSize: cs.fontSize } })() : null,
            rowCount: rows.length, rowInfo
        };
    });
    console.log(`\n===== SEARCH HISTORY AREA (light) =====`);
    console.log(JSON.stringify(hist, null, 1));
    await page.close();

    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
