// Custom-styles (userstyle) end-to-end probe v3 — full real-user flow.
// Part 1: options page real typing → persisted.
// Part 2: popup with a SEEDED tree — a custom rule must actually APPLY
//   (computed style) and must WIN a same-specificity cascade tie vs neat.css
//   (injected later, no !important needed).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rec = (tag, data) => console.log(`[VBM] ${tag} ${JSON.stringify(data)}`);

const SEED = `
(async () => {
    const p = () => new Promise(r => chrome.bookmarks.create({ parentId: '1', title: 'Seed folder' }, r));
    const f = await p();
    await new Promise(r => chrome.bookmarks.create({ parentId: f.id, title: 'Alpha Bookmark', url: 'https://alpha.example.com/' }, r));
    await new Promise(r => chrome.bookmarks.create({ parentId: f.id, title: 'Beta Bookmark', url: 'https://beta.example.com/' }, r));
})()`;

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
    rec('ENV', { extId });

    // ── Part 1: options real typing → persisted ───────────────────────────
    {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
        await page.setViewport({ width: 900, height: 700 });
        await page.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
        await sleep(900);
        await page.evaluate(() => document.querySelector('.CodeMirror').scrollIntoView({ block: 'center' }));
        await sleep(150);
        const box = await page.evaluate(() => {
            const r = document.querySelector('.CodeMirror').getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
        await page.mouse.click(box.x, box.y);
        await sleep(100);
        await page.keyboard.type('body { --vbm-radius: 20px; }', { delay: 1 });
        await sleep(600);
        const stored = await page.evaluate(async () => ({
            mirror: store.get('userstyle'),
            chromeLocal: (await chrome.storage.local.get('userstyle')).userstyle
        }));
        rec('OPTIONS-STORED', stored);
        rec('OPTIONS-ERRORS', errors);
        await page.close();
    }

    // ── Part 2: popup, seeded tree, custom rule must apply + win cascade ──
    {
        const seedPage = await browser.newPage();
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(600);
        await seedPage.evaluate(SEED);
        await sleep(500);
        await seedPage.close();

        // Two rules, both WITHOUT !important:
        //  R1 same-specificity as neat.css (#search input, specificity 1,0,1)
        //  R2 lower specificity than neat.css (#tree a i -> (0,0,2)+element)
        // R1 must WIN (later source order). R2 must LOSE (lower specificity) —
        //   proving cascade semantics are as-designed, not "custom never works".
        const RULES =
            '#search input { background: rgb(200, 0, 0); }\n' +
            '#tree ul li a i { color: rgb(0, 200, 0); }';
        const seed2 = await browser.newPage();
        await seed2.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
        await seed2.evaluate(css => chrome.storage.local.set({ userstyle: css }), RULES);
        await sleep(300);
        await seed2.close();

        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
        await page.setViewport({ width: 400, height: 640 });
        await page.evaluateOnNewDocument(() => { try { localStorage.setItem('theme', 'light'); } catch (e) {} });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await page.evaluate(() => chrome.storage.local.set({ theme: 'light', currentVersion: chrome.runtime.getManifest().version }));
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(900);
        // open a folder so a real tree row exists
        await page.evaluate(() => {
            const span = [...document.querySelectorAll('#tree span.tree-item-span')]
                .find(s => (s.querySelector('i')?.textContent || '').trim() === 'Seed folder');
            if (span && !span.parentNode.classList.contains('open')) span.click();
        });
        await sleep(400);
        const result = await page.evaluate(() => {
            const styles = Array.prototype.slice.call(document.querySelectorAll('body > style'))
                .map(s => (s.textContent || '').slice(0, 80));
            const input = document.querySelector('#search input');
            const rowTitle = document.querySelector('#tree ul li a i');
            const neatBg = (() => {
                // neat.css default for #search input
                const probe = document.createElement('style');
                probe.textContent = '#search input { background: rgb(1,2,3); }';
                return probe.textContent; // unused; we read computed instead
            })();
            return {
                bodyStyles: styles,
                searchInputBg: input ? getComputedStyle(input).backgroundColor : null,
                rowTitleColor: rowTitle ? getComputedStyle(rowTitle).color : null,
                hasTreeRow: !!rowTitle,
                neatBg // placeholder to keep tree-shaking honest
            };
        });
        rec('POPUP-APPLIED', result);
        rec('POPUP-ERRORS', errors);
        await page.close();
    }

    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
