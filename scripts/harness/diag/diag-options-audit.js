// Options-page UI audit shots (2026-08-26 选项页修补): captures the General
// group (theme/language selects), the Search group (recent-search count row),
// and the Backup group (export/import buttons) for alignment review.
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
        await sleep(2000);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 480, height: 900 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.goto('chrome-extension://' + extId + '/pages/options.html', { waitUntil: 'load' });
        await sleep(1500);
        if (!fs.existsSync('/tmp/shots')) fs.mkdirSync('/tmp/shots', { recursive: true });
        // General group (theme + language rows)
        const g = await page.evaluate(() => {
            const row = id => {
                const li = document.getElementById(id).closest('li');
                const r = li.getBoundingClientRect();
                const sel = li.querySelector('select');
                const s = sel ? sel.getBoundingClientRect() : null;
                return { li: { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }, sel: s ? { l: Math.round(s.left), r: Math.round(s.right), w: Math.round(s.width) } : null };
            };
            const ref = document.getElementById('stats-clear').getBoundingClientRect();
            return {
                ref: { l: Math.round(ref.left), r: Math.round(ref.right) },
                theme: row('theme-select'),
                language: row('language-select'),
                searchCount: row('search-history-count'),
                tabColor: row('tabgroups-color-style'),
                tabLimit: row('tabgroups-closed-limit'),
                recentCount: row('recent-count'),
                pcAction: row('pc-action'),
                labels: {
                    searchCount: document.getElementById('option-search-history-count').textContent,
                    searchCountHtml: document.getElementById('option-search-history-count').innerHTML.slice(0, 60)
                },
                badges: [...document.querySelectorAll('.storage-badge, .group-storage-badge, .row-storage-badge')].map(b => b.className + ':' + (b.getAttribute('title') || '').slice(0, 24))
            };
        });
        console.log('GEOM ' + JSON.stringify(g));
        await page.screenshot({ path: '/tmp/shots/options-top.png' });
        // Scroll to backup group
        await page.evaluate(() => document.getElementById('backup-options').scrollIntoView());
        await sleep(600);
        const b = await page.evaluate(() => {
            const exportBtn = document.getElementById('export-settings');
            const importBtn = document.getElementById('import-settings');
            const li = exportBtn.closest('li');
            const e = exportBtn.getBoundingClientRect(), i = importBtn.getBoundingClientRect(), l = li.getBoundingClientRect();
            return {
                li: { l: Math.round(l.left), r: Math.round(l.right), w: Math.round(l.width) },
                export: { l: Math.round(e.left), r: Math.round(e.right), w: Math.round(e.width) },
                import: { l: Math.round(i.left), r: Math.round(i.right), w: Math.round(i.width) },
                labels: { export: exportBtn.textContent, import: importBtn.textContent }
            };
        });
        console.log('BACKUP ' + JSON.stringify(b));
        await page.screenshot({ path: '/tmp/shots/options-backup.png' });
        console.log('done');
    } finally { await browser.close(); }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
