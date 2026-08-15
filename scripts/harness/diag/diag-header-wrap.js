// diag-header-wrap.js — options header 3-element auto-layout at narrow widths.
// The h1 row holds the title block (icon + #ext-name + #small-options) and the
// right-pinned #header-links pills; #header-since sits on its own line below.
// Under narrow viewports each piece must WRAP onto its own line instead of
// being flex-crushed into truncation or overlap. Probe measures geometry at a
// width sweep and hard-fails on any overlap / horizontal overflow / truncation.
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
    const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!sw) throw new Error('no sw');
    const extId = new URL(sw.url()).hostname;
    const page = await browser.newPage();

    const WIDTHS = [1920, 1024, 800, 700, 640, 600, 560, 520, 480, 440, 400, 360, 320];
    const problems = [];
    const rows = [];

    for (const w of WIDTHS) {
        await page.setViewport({ width: w, height: 800 });
        await page.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        const m = await page.evaluate(() => {
            const q = s => document.querySelector(s);
            const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
            const h1 = R(q('h1'));
            const titleBlock = R(q('#small-options'));
            const links = R(q('#header-links'));
            const since = R(q('#header-since'));
            const page = R(q('.options-page'));
            const pills = [...document.querySelectorAll('#header-links .header-btn')].map(R);
            const vpW = window.innerWidth;
            const h1style = getComputedStyle(q('h1'));
            // any pill text clipped by overflow hidden?
            const clipped = [...document.querySelectorAll('#header-links .header-btn')].some(a => {
                const cs = getComputedStyle(a);
                return cs.textOverflow === 'ellipsis' || cs.overflowX !== 'visible';
            });
            return { h1, titleBlock, links, since, page, pills, vpW, h1flexWrap: h1style.flexWrap, clipped };
        });

        const vpW = m.vpW;
        const overlap = (a, b) => a && b && a.l < b.r - 1 && a.r > b.l + 1 && a.t < b.b - 1 && a.b > b.t + 1;
        // 1) no horizontal overflow: header never sticks out of the viewport
        if (m.h1 && m.h1.r > vpW + 1) problems.push(`${w}px: h1 overflows viewport (r=${m.h1.r.toFixed(1)} > ${vpW})`);
        if (m.links && m.links.r > vpW + 1) problems.push(`${w}px: header-links overflows (r=${m.links.r.toFixed(1)})`);
        // 2) title block never overlaps the links (wrap, don't crush) — proper rect test
        if (overlap(m.titleBlock, m.links))
            problems.push(`${w}px: title block overlaps links`);
        // 3) since subtitle stays below h1 on its own line, never overlapping
        if (overlap(m.since, m.h1))
            problems.push(`${w}px: #header-since overlaps h1 (sinceT=${m.since.t.toFixed(1)} h1B=${m.h1.b.toFixed(1)})`);
        // 4) pills never truncated (all within viewport) and never overlap each other
        for (let i = 0; i < m.pills.length; i++) {
            const p = m.pills[i];
            if (p && p.r > vpW + 1) problems.push(`${w}px: pill #${i} right overflows (r=${p.r.toFixed(1)})`);
            for (let j = i + 1; j < m.pills.length; j++)
                if (overlap(p, m.pills[j])) problems.push(`${w}px: pills #${i} and #${j} overlap`);
        }

        rows.push({ w, h1R: m.h1 && +m.h1.r.toFixed(1), linksT: m.links && +m.links.t.toFixed(1), linksL: m.links && +m.links.l.toFixed(1), sinceT: m.since && +m.since.t.toFixed(1), h1h: m.h1 && +m.h1.h.toFixed(1) });
    }

    for (const r of rows) console.log(JSON.stringify(r));
    if (problems.length) {
        console.log('HEADER-WRAP PROBLEMS:');
        for (const p of problems) console.log('  ' + p);
        process.exit(1);
    }
    console.log('HEADER-WRAP OK: wraps without overlap/overflow at all widths');
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
