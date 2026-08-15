// diag-sw-targets.js — why does the extension SW never register?
// Launches Chromium with --load-extension like smoke.js, waits, then dumps
// ALL targets + extension entries, so "extension service worker not found"
// is diagnosed from ground truth. v=1 stderr logging surfaces the load error.
const puppeteer = require('puppeteer');

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        dumpio: true, // forward browser stderr to our stdout
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext',
            '--enable-logging=stderr',
            '--v=1'
        ]
    });
    await sleep(5000);
    const ts = await browser.targets();
    console.log(`--- targets @5s: ${ts.length} total ---`);
    for (const t of ts)
        console.log(`  [${t.type()}] ${t.url()}`);
    await browser.close();
})().catch(e => { console.error('PROBE ERROR:', e); process.exit(1); });
