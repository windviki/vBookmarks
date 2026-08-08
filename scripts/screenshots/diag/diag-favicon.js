// Diag: default (no-favicon) bookmark icon visibility on dark/ink themes.
// Seeds a bookmark whose URL can never serve a favicon (127.0.0.1:9), opens
// the popup under each dark theme, then for the row's <img>:
//   - computed `filter` (is the 902304a brightness rule matching at all?)
//   - raw pixel stats of the served bitmap via canvas (same-origin _favicon,
//     not tainted): mean luminance/saturation of opaque pixels
//   - selector match check against the exact CSS rule
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
    await sleep(2000);
    const swTarget = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;
    const openPopup = async () => {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.setViewport({ width: 420, height: 600 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(800);
        return page;
    };

    // seed: one bookmark that can never have a real favicon
    const seed = await openPopup();
    await seed.evaluate(() => new Promise(r => {
        chrome.bookmarks.create({ parentId: '1', title: 'NoIcon Site', url: 'http://127.0.0.1:9/noicon' }, () =>
            chrome.storage.local.set({
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1, donationKey: 30
            }, r));
    }));
    await sleep(300);
    await seed.close();

    const probe = () => new Promise(resolve => {
        // 1. Raw bitmap the _favicon API serves for a no-favicon page
        const src = `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent('http://127.0.0.1:9/noicon')}&size=32`;
        const raw = new Image();
        raw.onload = () => {
            const c = document.createElement('canvas');
            c.width = raw.naturalWidth; c.height = raw.naturalHeight;
            const ctx = c.getContext('2d');
            let pixels = null;
            try {
                ctx.drawImage(raw, 0, 0);
                const d = ctx.getImageData(0, 0, c.width, c.height).data;
                let n = 0, lum = 0, sat = 0, minL = 255, maxL = 0;
                for (let i = 0; i < d.length; i += 4) {
                    if (d[i + 3] < 128) continue;
                    const r = d[i], g = d[i + 1], b = d[i + 2];
                    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    n++; lum += l; sat += (Math.max(r, g, b) - Math.min(r, g, b));
                    if (l < minL) minL = l;
                    if (l > maxL) maxL = l;
                }
                pixels = n ? { opaque: n, meanLum: +(lum / n).toFixed(1), meanSat: +(sat / n).toFixed(1), minL, maxL }
                    : { opaque: 0 };
            } catch (e) { pixels = { error: e.message }; }

            // 2. Does the dark-rule selector match production markup? Inject
            // a row exactly as tree-render emits it and read computed filter.
            const li = document.createElement('li');
            li.innerHTML = `<a href="#" class="tree-item-link" tabindex="-1"><div class="favicon-container"><img src="${src}" width="16" height="16" alt=""></div><i>x</i></a>`;
            (document.querySelector('#tree ul') || document.getElementById('tree') || document.body).appendChild(li);
            const img = li.querySelector('img');
            const cs = getComputedStyle(img);
            resolve({
                theme: document.body.dataset.theme,
                rawNatural: `${raw.naturalWidth}x${raw.naturalHeight}`,
                rawPixels: pixels,
                computedFilter: cs.filter,
                bg: getComputedStyle(document.body).backgroundColor
            });
        };
        raw.onerror = e => resolve({ error: 'favicon load failed', src });
        raw.src = src;
    });

    const out = {};
    for (const theme of ['dark', 'ink', 'light']) {
        const p = await openPopup();
        await p.evaluate(t => new Promise(r => chrome.storage.local.set({ theme: t }, r)), theme);
        await p.reload({ waitUntil: 'networkidle0' });
        await sleep(1200); // favicon img loads async
        out[theme] = await p.evaluate(probe);
        await p.close();
    }
    console.log(JSON.stringify(out, null, 2));
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
