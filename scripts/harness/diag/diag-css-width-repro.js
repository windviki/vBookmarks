// one-off: custom-css editor width on a WIDE viewport — the user reports the
// editor sits at ~500px instead of following the browser window width.
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
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const seed = await browser.newPage();
        await seed.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(600);
        await seed.evaluate(() => new Promise(res => chrome.storage.local.set({
            userstyles: JSON.stringify([{ id: 'a', name: 'A', desc: '', css: 'body{}', enabled: true }]),
            userstyle: 'body{}'
        }, res)));
        await seed.close();
        for (const vw of [1400, 900]) {
            const p = await browser.newPage();
            await p.setViewport({ width: vw, height: 900 });
            await p.goto('chrome-extension://' + extId + '/pages/custom-css.html', { waitUntil: 'load' });
            await sleep(1000);
            const m = await p.evaluate(() => {
                const q = s => document.querySelector(s);
                const info = el => el ? {
                    w: Math.round(el.getBoundingClientRect().width),
                    inlineW: el.style.width || '', cssW: getComputedStyle(el).width,
                    display: getComputedStyle(el).display
                } : null;
                const page = q('#custom-css-page');
                const bodyPad = getComputedStyle(document.body).padding;
                return {
                    vw: window.innerWidth,
                    body: { padding: bodyPad, w: Math.round(document.body.getBoundingClientRect().width) },
                    page: info(page),
                    editor: info(q('#custom-css-editor')),
                    metaRow: info(q('.custom-css-meta-row')),
                    nameInput: info(q('#custom-css-name')),
                    descInput: info(q('#custom-css-desc-input')),
                    cmWrap: info(q('#custom-css-page .CodeMirror')),
                    cmScroll: info(q('.CodeMirror-scroll')),
                    cmLines: info(q('.CodeMirror-lines')),
                    textarea: info(q('#custom-css-css'))
                };
            });
            console.log(`== viewport ${vw}:`, JSON.stringify(m, null, 1));
            const drill = await p.evaluate(() => {
                const wrap = document.querySelector('#custom-css-page .CodeMirror');
                if (!wrap) return null;
                const cs = getComputedStyle(wrap);
                const out = {
                    cssText: wrap.style.cssText || '(empty)',
                    attrs: [...wrap.attributes].map(a => `${a.name}=${a.value.slice(0, 40)}`),
                    alignSelf: cs.alignSelf, maxWidth: cs.maxWidth, width: cs.width,
                    parentDisplay: getComputedStyle(wrap.parentElement).display,
                    parentAlign: getComputedStyle(wrap.parentElement).alignItems
                };
                wrap.style.width = '100%';
                out.afterForceW = Math.round(wrap.getBoundingClientRect().width);
                // find every stylesheet rule mentioning CodeMirror that sets a width
                out.rules = [];
                for (const sheet of document.styleSheets) {
                    let rules;
                    try { rules = sheet.cssRules; } catch (e) { continue; }
                    for (const r of rules || []) {
                        if (!r.selectorText || !/codemirror/i.test(r.selectorText)) continue;
                        const w = r.style && (r.style.width || r.style.maxWidth || r.style.minWidth);
                        if (w) out.rules.push(`${sheet.href || 'inline'} :: ${r.selectorText} → ${w}`);
                    }
                }
                return out;
            });
            console.log(`== drill ${vw}:`, JSON.stringify(drill, null, 1));
            fs.mkdirSync('/tmp/shots', { recursive: true });
            await p.screenshot({ path: `/tmp/shots/css-wide-${vw}.png` });
            await p.close();
        }
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e); process.exit(1); });
// appended: drill into where 560px comes from — dump cssText/attrs, then try
// forcing width:100% to see if stretch was defeated by an intrinsic size
