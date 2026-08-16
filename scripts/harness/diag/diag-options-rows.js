// diag-options-rows.js — verify the 4.0.8 options-page row polish:
//  * dead-scan proxy row: the edit input fills the card; Test & save flush
//    left in the action row; Clear pinned to the card's right edge
//  * backup row: Export + Import split the card width evenly, Import flush
//    against the card's right edge
//  * header: the since subtitle docks in the title row, centered in the gap
//    between the title block and the header pills (narrow wrap is covered by
//    diag-header-wrap.js)
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

    const problems = [];
    const check = (cond, msg) => { if (!cond) problems.push(msg); };

    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
    await sleep(900);

    const m = await page.evaluate(() => {
        const q = s => document.querySelector(s);
        const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(1), r: +r.right.toFixed(1), t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1) }; };

        const proxy = (() => {
            const input = q('#dead-proxy-server-input');
            const li = input.closest('li');
            const cs = getComputedStyle(li);
            const lb = li.getBoundingClientRect();
            const cardL = lb.left + parseFloat(cs.paddingLeft);
            const cardR = lb.right - parseFloat(cs.paddingRight);
            return { input: R(input), save: R(q('#dead-proxy-server-save')),
                value: R(q('#dead-proxy-server-value')), clear: R(q('#dead-proxy-server-clear')),
                cardL, cardR };
        })();

        const backup = (() => {
            const li = q('#export-settings').closest('li');
            const cs = getComputedStyle(li);
            const lb = li.getBoundingClientRect();
            const cardL = lb.left + parseFloat(cs.paddingLeft);
            const cardR = lb.right - parseFloat(cs.paddingRight);
            return { exportBtn: R(q('#export-settings')), importBtn: R(q('#import-settings')), cardL, cardR };
        })();

        const header = (() => {
            return { title: R(q('#small-options')), links: R(q('#header-links')),
                since: R(q('#header-since')), h1: R(q('h1')) };
        })();

        return { proxy, backup, header };
    });

    // --- proxy row
    const p = m.proxy;
    const cardW = p.cardR - p.cardL;
    // the edit input takes at least half the card after its label (well past
    // the old fixed 12em=168px), and its right edge meets the card's right edge
    check(p.input.w >= cardW * 0.5, `proxy input too narrow (w=${p.input.w}px, card=${cardW.toFixed(0)}px)`);
    check(Math.abs(p.input.r - p.cardR) < 4, `proxy input right not at card right (r=${p.input.r} cardR=${p.cardR})`);
    check(Math.abs(p.save.l - p.cardL) < 4, `proxy Test button not flush left (l=${p.save.l} cardL=${p.cardL})`);
    check(Math.abs(p.clear.r - p.cardR) < 4, `proxy Clear not pinned to card right (r=${p.clear.r} cardR=${p.cardR})`);
    check(p.clear.l > p.value.r, `proxy Clear should follow the saved value (clearL=${p.clear.l} valueR=${p.value.r})`);

    // --- backup row
    const b = m.backup;
    check(Math.abs(b.exportBtn.l - b.cardL) < 4, `backup Export not flush left (l=${b.exportBtn.l} cardL=${b.cardL})`);
    check(Math.abs(b.importBtn.r - b.cardR) < 4, `backup Import not flush right (r=${b.importBtn.r} cardR=${b.cardR})`);
    check(Math.abs(b.exportBtn.w - b.importBtn.w) <= 6, `backup buttons uneven (export ${b.exportBtn.w}px vs import ${b.importBtn.w}px)`);
    check(b.exportBtn.w > 120, `backup Export not lengthened (w=${b.exportBtn.w}px)`);

    // --- header since docked in the title row, centered before the pills
    const h = m.header;
    const sameRow = h.since.t < h.links.b && h.since.b > h.links.t;
    check(sameRow, `since not on the pills row (since t=${h.since.t} b=${h.since.b}; links t=${h.links.t} b=${h.links.b})`);
    check(h.since.l >= h.title.r - 1, `since starts before the title block ends (l=${h.since.l} titleR=${h.title.r})`);
    check(h.since.r <= h.links.l + 1, `since overlaps the pills (r=${h.since.r} linksL=${h.links.l})`);
    const gapCenter = (h.title.r + h.links.l) / 2;
    const sinceCx = (h.since.l + h.since.r) / 2;
    check(Math.abs(sinceCx - gapCenter) < 40, `since not centered in the gap (sinceCx=${sinceCx.toFixed(1)} gapCenter=${gapCenter.toFixed(1)})`);

    console.log(JSON.stringify(m, null, 2));
    if (problems.length) {
        console.log('OPTIONS-ROWS PROBLEMS:');
        for (const p of problems) console.log('  ' + p);
        await browser.close();
        process.exit(1);
    }
    console.log('OPTIONS-ROWS OK: proxy / backup / header layouts verified');
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
