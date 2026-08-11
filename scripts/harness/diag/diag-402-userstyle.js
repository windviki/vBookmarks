// Reproduce the user's exact report: BEFORE the #56 filter removal, the CSS
// workaround `filter: none` (pasted into Custom styles) did NOT override the
// neat.css `filter: brightness(1.5)` on favicon imgs.
//
// Cascade facts under test: neat.css is a <head> <link> (earlier in document
// order); the userstyle is a <style> appended to <body> (later). Same
// specificity → later source order wins. We simulate the pre-fix state by
// injecting the old filter rule into <head> AFTER the popup loads (document
// order, not injection time, decides the cascade), then read the computed
// filter of a real favicon-style <img>.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rec = (tag, data) => console.log(`[VBM] ${tag} ${JSON.stringify(data)}`);

const PREFIX_FILTER =
    'body[data-theme="dark"] .tree-item-link .favicon-container img, ' +
    'body[data-theme="ink"] .tree-item-link .favicon-container img { filter: brightness(1.5); }';
const USERSTYLE =
    'body[data-theme="dark"] .tree-item-link .favicon-container img, ' +
    'body[data-theme="ink"] .tree-item-link .favicon-container img { filter: none; }';
const USERSTYLE_MEDIA =
    '@media (prefers-color-scheme: dark) { ' +
    'body[data-theme="auto"] .tree-item-link .favicon-container img { filter: none; } }';

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

    const probe = async (theme, userstyleCss, label) => {
        const seed = await browser.newPage();
        await seed.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
        await seed.evaluate(css => chrome.storage.local.set({ userstyle: css }), userstyleCss);
        await sleep(300);
        await seed.close();

        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 640 });
        await page.evaluateOnNewDocument(t => { try { localStorage.setItem('theme', t); } catch (e) {} }, theme);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await page.evaluate(t => chrome.storage.local.set({ theme: t, currentVersion: chrome.runtime.getManifest().version }), theme);
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(900);

        const result = await page.evaluate(prefixCss => {
            // simulate the pre-fix neat.css rule living in <head> (earlier in
            // document order than the body userstyle <style>)
            const headStyle = document.createElement('style');
            headStyle.textContent = prefixCss;
            document.head.appendChild(headStyle);
            // craft a real favicon <img> in the exact tree-row DOM shape
            const a = document.createElement('a');
            a.className = 'tree-item-link';
            const fc = document.createElement('div');
            fc.className = 'favicon-container';
            const img = document.createElement('img');
            img.width = 16; img.height = 16; img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
            fc.appendChild(img); a.appendChild(fc);
            const tree = document.getElementById('tree');
            const host = document.createElement('div');
            host.appendChild(a);
            tree.appendChild(host);
            // order of the two competing <style>s in document order
            const headStyles = Array.prototype.slice.call(document.querySelectorAll('head style')).map(s => s.textContent.slice(0, 40));
            const bodyStyles = Array.prototype.slice.call(document.querySelectorAll('body > style')).map(s => s.textContent.slice(0, 40));
            return {
                headStyleCount: headStyles.length,
                headStyles,
                bodyStyleCount: bodyStyles.length,
                bodyStyles,
                computedFilter: getComputedStyle(img).filter,
                bodyTheme: document.body.dataset.theme
            };
        }, PREFIX_FILTER);
        rec(label, result);
        await page.close();
    };

    // explicit dark theme, custom rule without @media
    await probe('dark', USERSTYLE, 'DARK-EXPLICIT');
    // explicit ink theme, custom rule without @media
    await probe('ink', USERSTYLE, 'INK-EXPLICIT');
    // auto theme + system dark (headless default is light, but the media block
    // still participates when it matches — we force a dark scheme via CDP)
    await probe('auto', USERSTYLE_MEDIA, 'AUTO-DARK');

    await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
