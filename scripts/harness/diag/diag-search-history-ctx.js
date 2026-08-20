// vBookmarks search-history right-click diagnostic (real browser, manual run):
//   scripts/harness/rerun.sh diag/diag-search-history-ctx.js
//
// Reproduces the "narrow popup + zoom>100, right-click a search-history row
// opens the full bookmark/folder menu instead of the search-history menu"
// report. Seeds searchHistory, switches to the search view, sets
// body[data-zoom], then right-clicks a grid of points across each history
// row and reports the event target (capture-phase), elementFromPoint BEFORE
// the extension handler runs, and which context menu is visible AFTER.
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2000);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        if (!sw) throw new Error('service worker not found');
        const extId = new URL(sw.url()).hostname;

        const page = await browser.newPage();
        page.on('pageerror', e => console.log('PAGEERROR', e.message));
        await page.setViewport({ width: 320, height: 600 });
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1000);

        // Seed search history and reload so the search view renders it.
        await page.evaluate(() => new Promise(res => {
            const now = Date.now();
            chrome.storage.local.set({
                searchHistory: JSON.stringify([
                    { q: 'github', ts: now - 60000, n: 12 },
                    { q: 'mdn fetch', ts: now - 120000, n: 8 },
                    { q: 'stack overflow', ts: now - 180000, n: 23 },
                    { q: 'very-long-query-text-that-ellipsizes-in-narrow-popup', ts: now - 240000, n: 4 }
                ]),
                searchHistoryEnabled: '1',
                rememberView: '1',
                activeView: 'search',
                donationDisabled: '1',
                announceEnabled: '0'
            }, res);
        }));
        await page.reload({ waitUntil: 'load' });
        await sleep(1200);

        // If the donation card still shows (shouldn't with donationDisabled), dismiss.
        const donation = await page.evaluate(() => {
            const d = document.getElementById('donation');
            return !!d && d.style.display !== 'none' && d.offsetHeight > 0;
        });
        if (donation) {
            await page.click('#donation-later').catch(() => {});
            await sleep(300);
        }

        // Ensure search view is active (stored activeView should do it, this is
        // a belt-and-braces click on the tab).
        const searchActive = await page.evaluate(() => {
            const tab = document.getElementById('view-tab-search');
            if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
            return document.getElementById('view-search').hidden === false;
        });
        console.log('searchActive after tab click:', searchActive);
        await sleep(400);

        const rowsBefore = await page.evaluate(() =>
            document.querySelectorAll('#search-history-area li.search-history-row').length);
        console.log('history rows:', rowsBefore);

        // Zoom phases: the bug report pairs extreme-narrow with zoom>100.
        for (const zoom of ['100', '120', '150']) {
            await page.evaluate(z => {
                document.body.dataset.zoom = z;
                document.body.classList.add('dummy');
                document.body.classList.remove('dummy');
            }, zoom);
            await sleep(500);

            // Install the capture-phase target recorder for this phase. It runs
            // BEFORE the extension's body-level contextmenu handler.
            await page.evaluate(() => {
                window.__vbmCtxDiag = [];
                const desc = el => {
                    if (!el) return null;
                    const cls = typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '';
                    return {
                        tag: el.tagName,
                        id: el.id || '',
                        cls: String(cls).slice(0, 80),
                        q: el.dataset ? (el.dataset.q === undefined ? undefined : el.dataset.q) : undefined,
                        li: el.closest ? (el.closest('li') || {}).className : ''
                    };
                };
                window.__vbmCtxRec = e => {
                    if (e.type !== 'contextmenu') return;
                    const efp = document.elementFromPoint(e.clientX, e.clientY);
                    window.__vbmCtxDiag.push({
                        clientX: e.clientX, clientY: e.clientY,
                        target: desc(e.target),
                        efp: desc(efp),
                        trusted: e.isTrusted,
                        button: e.button
                    });
                };
                document.addEventListener('contextmenu', window.__vbmCtxRec, true);
            });

            const z = parseInt(zoom, 10) / 100;
            // Under body[data-zoom] CSS zoom, getBoundingClientRect returns
            // LAYOUT (pre-zoom) coordinates while mouse events / elementFromPoint
            // use VIEWPORT (post-zoom) coordinates. Scale rects by z for clicks.
            const rowRects = await page.evaluate(() => {
                return Array.from(document.querySelectorAll('#search-history-area li.search-history-row'))
                    .map(li => {
                        const a = li.querySelector('a');
                        const kids = Array.from(a.children).map(k => {
                            const r = k.getBoundingClientRect();
                            return { tag: k.tagName, cls: k.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width };
                        });
                        const ar = a.getBoundingClientRect();
                        return { text: (a.querySelector('i') || a).textContent.trim().slice(0, 40), aRect: { left: ar.left, right: ar.right, top: ar.top, bottom: ar.bottom, w: ar.width }, kids };
                    });
            });
            console.log(`\n=== zoom ${zoom}%  viewport=${await page.evaluate(() => window.innerWidth)}  rectScale=${z} ===`);
            for (const row of rowRects) {
                const v = row.aRect;
                console.log(`row "${row.text}" layout=[${v.left.toFixed(1)},${v.right.toFixed(1)}] y=${v.top.toFixed(1)}..${v.bottom.toFixed(1)}  visual=[${(v.left * z).toFixed(1)},${(v.right * z).toFixed(1)}] y=${(v.top * z).toFixed(1)}..${(v.bottom * z).toFixed(1)}`);
                for (const k of row.kids)
                    console.log(`   child ${k.tag}.${k.cls} layout [${k.left.toFixed(1)},${k.right.toFixed(1)}] visual [${(k.left * z).toFixed(1)},${(k.right * z).toFixed(1)}] w=${(k.w * z).toFixed(1)}`);
            }

            // Right-click a horizontal grid across the FIRST row and each row's
            // child midpoints, in VIEWPORT coordinates (rects scaled by z).
            const first = rowRects[0];
            const y = (first && ((first.aRect.top + first.aRect.bottom) / 2) * z) || 100;
            const winW = await page.evaluate(() => window.innerWidth);
            const pts = [];
            for (const f of [0.05, 0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.97])
                pts.push({ x: Math.round(winW * f), y: Math.round(y), label: `x${Math.round(f * 100)}` });
            // Add exact child midpoints of the first row if in viewport.
            if (first) {
                for (const k of first.kids) {
                    const cx = ((k.left + k.right) / 2) * z;
                    const cy = ((k.top + k.bottom) / 2) * z;
                    if (cx >= 0 && cx <= winW && cy >= 0)
                        pts.push({ x: Math.round(cx), y: Math.round(cy), label: `child-${k.tag}.${k.cls}` });
                }
            }

            const visibleMenuAfter = () => page.evaluate(() => {
                const found = [];
                document.querySelectorAll('menu[type=context]').forEach(m => {
                    if (m.style.opacity === '1') {
                        const r = m.getBoundingClientRect();
                        found.push({ id: m.id, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
                    }
                });
                return found;
            });
            const resetMenus = () => page.evaluate(() => {
                document.querySelectorAll('menu[type=context]').forEach(m => {
                    m.style.opacity = '0';
                    m.style.left = '-999px';
                });
                const act = document.querySelector('.active');
                if (act) act.classList.remove('active');
            });

            for (const p of pts) {
                await resetMenus();
                await sleep(60);
                await page.mouse.click(p.x, p.y, { button: 'right' });
                await sleep(150);
                const last = await page.evaluate(() => {
                    const rec = window.__vbmCtxDiag || [];
                    return rec[rec.length - 1] || null;
                });
                const menus = await visibleMenuAfter();
                console.log(`rc ${p.label} @(${p.x},${p.y}) target=${JSON.stringify(last && last.target)} efp=${JSON.stringify(last && last.efp)} menus=${JSON.stringify(menus)}`);
            }

            // Remove the capture listener for the next zoom phase.
            await page.evaluate(() => {
                if (window.__vbmCtxRec)
                    document.removeEventListener('contextmenu', window.__vbmCtxRec, true);
            });
            await resetMenus();
        }

        console.log('\ndone');
    } finally {
        await browser.close();
    }
})();
