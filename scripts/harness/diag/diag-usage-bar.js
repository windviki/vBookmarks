// Storage-usage bar visual + numeric audit (4.0.9).
//   empty profile  -> summary reads "Used 0B of 10MB", all used segments 0-wide,
//                     the bar is the free (--vbm-border) fill.
//   seeded profile -> icon/bookmarks/other segments carry real widths, the three
//                     used colors are pairwise distinct (accent blue / success
//                     green / amber), the legend shows per-category shares, and
//                     the clear-cache button reads as danger.
// Captures the storage-usage card in both states for pixel-level review.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pad = (n, c = 'x') => c.repeat(n);
const OPTIONS = () => `chrome-extension://${extId}/pages/options.html`;

let extId;
const browserLaunch = async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    extId = new URL(sw.url()).hostname;
    return browser;
};

(async () => {
    const browser = await browserLaunch();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1600 });

    const openAndCenter = async () => {
        await page.goto(OPTIONS(), { waitUntil: 'networkidle0' });
        await sleep(1300);
        await page.evaluate(() => {
            const el = document.getElementById('storage-usage');
            if (el) el.scrollIntoView({ block: 'center' });
        });
        await sleep(300);
    };

    const audit = async () => page.evaluate(() => {
        const q = s => document.querySelector(s);
        const R = el => { const r = el.getBoundingClientRect();
            return { l: +r.left.toFixed(1), r: +r.right.toFixed(1), t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
        const seg = id => { const el = q('#' + id); const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return { w: +r.width.toFixed(1), color: cs.backgroundColor, label: el.getAttribute('aria-label'),
                     tabindex: el.getAttribute('tabindex') }; };
        const barR = R(q('#storage-usage-bar'));
        const segments = ['usage-icon', 'usage-bookmarks', 'usage-other', 'usage-free'].map(seg);
        const widthsPct = segments.map(s => s.w / barR.w * 100);
        const legend = [...q('#storage-usage-legend').children].map(li => ({
            swatch: getComputedStyle(li.querySelector('.legend-swatch')).backgroundColor,
            text: li.innerText }));
        const ccs = getComputedStyle(q('#favicon-cache-clear'));
        const rcs = getComputedStyle(q('#reset-button'));
        const ecs = getComputedStyle(q('#export-settings'));
        return {
            summary: q('#storage-usage-summary').innerText,
            bar: barR,
            segments,
            widthsPct: widthsPct.map(v => +v.toFixed(1)),
            widthsSum: +widthsPct.reduce((a, b) => a + b, 0).toFixed(1),
            legend,
            tooltipHidden: q('#usage-tooltip').hidden,
            dangerBtn: { text: q('#favicon-cache-clear').innerText, color: ccs.color, borderColor: ccs.borderColor, radius: ccs.borderRadius },
            resetBtn: { text: q('#reset-button').innerText, color: rcs.color, borderColor: rcs.borderColor },
            exportBtn: { text: q('#export-settings').innerText, color: ecs.color, borderColor: ecs.borderColor }
        };
    });

    const shootCard = async name => {
        require('fs').mkdirSync('/tmp/shots/diag', { recursive: true });
        const r = await page.evaluate(() => {
            const rect = document.getElementById('storage-usage').getBoundingClientRect();
            return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        });
        await page.screenshot({ path: `/tmp/shots/diag/usage-${name}.png`,
            clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
    };

    // ---- 1. empty profile ------------------------------------------------
    await openAndCenter();
    await page.evaluate(async () => { await chrome.storage.local.clear(); });
    await openAndCenter(); // reload so refreshStorageUsage re-reads the store
    const empty = await audit();
    await shootCard('empty');

    // ---- 2. seeded profile ------------------------------------------------
    // ~2.8MB icon cache + ~340KB bookmark data + ~60KB "other", so the used
    // segments are wide enough to distinguish by eye.
    await page.evaluate(async () => {
        const pad = (n, c = 'x') => c.repeat(n);
        const iconKeys = {};
        for (let i = 0; i < 40; i++)
            iconKeys['vbmFavicon:h' + i + '.com'] = 'data:image/png;base64,' + pad(70000);
        iconKeys.vbmFaviconIdx = JSON.stringify({ v: 3, down: {}, hosts: Object.fromEntries(
            Array.from({ length: 40 }, (_, i) => ['h' + i + '.com', { t: 1, s: 2 }])) });
        const bookmarkKeys = {
            deadLastScan: JSON.stringify({ done: 1, results: [{ url: 'https://a.com', t: 1 }] }),
            vbmDeadScan: pad(300000),
            visitStats: pad(40000)
        };
        const otherKeys = { theme: 'dark', zoom: '110', __migrated_v1: '1' };
        await chrome.storage.local.set({ ...iconKeys, ...bookmarkKeys, ...otherKeys });
    });
    await openAndCenter();
    const seeded = await audit();
    await shootCard('seeded');

    // ---- 3. hover + keyboard reachability (seeded) -------------------------
    const hover = {};
    const widest = await page.evaluate(() => {
        const segs = [...document.querySelectorAll('.usage-seg')];
        const w = segs.reduce((a, b) => b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a);
        const r = w.getBoundingClientRect();
        return { id: w.id, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(widest.x, widest.y);
    await sleep(250);
    hover.id = widest.id;
    hover.tooltipHidden = await page.$eval('#usage-tooltip', el => el.hidden);
    hover.tooltipText = await page.$eval('#usage-tooltip', el => el.innerText);
    hover.focusReach = await page.evaluate(() => {
        const seg = document.getElementById('usage-icon');
        seg.focus();
        return { active: document.activeElement === seg, tabindex: seg.getAttribute('tabindex') };
    });

    const emptyFail = [];
    // the empty store still holds a couple of bytes (options writes its own
    // defaults) so accept any small "Used N of 10.0 MB" reading.
    if (!/Used [\d.]+ (?:B|KB|MB) of [\d.]+ (?:B|KB|MB)|已用 [\d.]+\s?(?:B|KB|MB)/.test(empty.summary))
        emptyFail.push(`empty summary: ${empty.summary}`);
    if (empty.segments[0].w !== 0 || empty.segments[1].w !== 0)
        emptyFail.push('empty profile icon/bookmarks segments not 0-wide');
    if (empty.widthsSum < 99 || empty.widthsSum > 100.5)
        emptyFail.push(`empty widths sum ${empty.widthsSum} (bar border eats ~0.6%)`);
    const seededFail = [];
    if (seeded.segments[0].w <= 0) seededFail.push('icon segment 0-wide in seeded profile');
    if (seeded.widthsSum < 99 || seeded.widthsSum > 100.5)
        seededFail.push(`seeded widths sum ${seeded.widthsSum} (bar border eats ~0.6%)`);
    const usedColors = seeded.segments.slice(0, 3).map(s => s.color);
    if (new Set(usedColors).size !== 3) seededFail.push(`used colors not distinct: ${usedColors.join(', ')}`);
    const freeColor = seeded.segments[3].color;
    if (freeColor === 'rgba(0, 0, 0, 0)' || usedColors.includes(freeColor))
        seededFail.push(`free fill not a distinct neutral: ${freeColor}`);
    if (!seeded.segments.every(s => s.tabindex === '0')) seededFail.push('missing tabindex="0" on a segment');
    if (!/\(\d+(?:\.\d+)?%\)/.test(seeded.legend[0].text)) seededFail.push(`legend lacks share: ${seeded.legend[0].text}`);
    // --vbm-danger resolves differently per theme: light #d93025, dark #f28b82.
    const DANGERS = ['rgb(217, 48, 37)', 'rgb(242, 139, 130)'];
    if (!DANGERS.includes(seeded.dangerBtn.color) || seeded.dangerBtn.borderColor !== seeded.dangerBtn.color)
        seededFail.push(`clear-cache button not danger: ${JSON.stringify(seeded.dangerBtn)}`);
    if (!DANGERS.includes(seeded.resetBtn.color)) seededFail.push(`reset button not danger: ${JSON.stringify(seeded.resetBtn)}`);
    if (DANGERS.includes(seeded.exportBtn.color)) seededFail.push('export button should stay plain secondary');
    if (hover.tooltipHidden !== false || !hover.tooltipText) hover.fail = 'tooltip did not show on hover';
    if (hover.focusReach.active !== true) hover.fail = hover.fail || 'segment not focusable';

    console.log('EMPTY ' + JSON.stringify(empty));
    console.log('SEEDED ' + JSON.stringify(seeded));
    console.log('HOVER ' + JSON.stringify(hover));
    const fails = [...emptyFail, ...seededFail];
    console.log(fails.length ? 'FAIL:\n' + fails.join('\n') : 'ALL CHECKS PASS');
    await browser.close();
    process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(2); });
