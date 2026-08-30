// One-off repro: custom-css editor — long stylesheet must scroll INSIDE the
// flexed slot (the vendored CM v2 css ships .CodeMirror-scroll
// height:auto/overflow-y:hidden, which grows past the wrapper and overlaps
// the footer). Also captures the native-textarea fallback path (codemirror.js
// request blocked) and measures which element the N5 probe actually saw.
const puppeteer = require('puppeteer');
const fs = require('fs');
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
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;

        // 200 lines of CSS
        const longCss = Array.from({ length: 200 }, (_, i) =>
            `/* line ${i + 1} */ .rule-${i + 1} { color: rgb(${i % 255}, 64, 128); padding: ${i}px; }`).join('\n');

        const run = async (blockCM, tag) => {
            const page = await browser.newPage();
            await page.setViewport({ width: 420, height: 640 });
            page.on('pageerror', e => console.log(`[${tag}] PAGEERROR:`, e.message));
            page.on('console', m => { if (m.type() === 'error') console.log(`[${tag}] CONSOLE:`, m.text()); });
            if (blockCM) {
                await page.setRequestInterception(true);
                page.on('request', r => (r.url().includes('/vendor/codemirror.js') ? r.abort() : r.continue()));
            }
            await page.evaluate(() => { /* storage prep must be on an extension page */ }, []);
            const seed = await browser.newPage();
            await seed.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
            await sleep(600);
            await seed.evaluate(async css => {
                await new Promise(res => chrome.storage.local.set({
                    userstyles: JSON.stringify([{ id: 'a', name: 'A', desc: '', css, enabled: true }]),
                    userstyle: css
                }, res));
            }, longCss);
            await seed.close();
            await page.goto('chrome-extension://' + extId + '/pages/custom-css.html', { waitUntil: 'load' });
            await sleep(1000);
            const m = await page.evaluate(() => {
                const cmWrap = document.querySelector('#custom-css-page .CodeMirror');
                const scroll = cmWrap ? cmWrap.querySelector('.CodeMirror-scroll') : null;
                const area = document.getElementById('custom-css-css');
                const footer = document.querySelector('.custom-css-status-row');
                const editor = document.getElementById('custom-css-editor');
                const r = el => { const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) }; };
                const inner = scroll || area; // the thing that must scroll
                const cs = getComputedStyle(inner);
                return {
                    path: cmWrap ? 'codemirror' : 'native-textarea',
                    cmWrap: cmWrap ? r(cmWrap) : null,
                    scroller: scroll ? { ...r(scroll), scrollH: scroll.scrollHeight, clientH: scroll.clientHeight, ovY: cs.overflowY } : null,
                    area: area ? { ...r(area), display: getComputedStyle(area).display, scrollH: area.scrollHeight, clientH: area.clientHeight } : null,
                    editorBox: r(editor),
                    footer: r(footer),
                    editorBottom: Math.round(editor.getBoundingClientRect().bottom),
                    overlap: inner.getBoundingClientRect().bottom > footer.getBoundingClientRect().top,
                    footerPushed: footer.getBoundingClientRect().bottom > 640,
                    vh: window.innerHeight
                };
            });
            fs.mkdirSync('/tmp/shots', { recursive: true });
            await page.screenshot({ path: `/tmp/shots/css-editor-${tag}.png` });
            await page.close();
            return m;
        };

        const cm = await run(false, 'cm');
        console.log('CM path:', JSON.stringify(cm, null, 1));
        const nat = await run(true, 'native');
        console.log('NATIVE path:', JSON.stringify(nat, null, 1));
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
