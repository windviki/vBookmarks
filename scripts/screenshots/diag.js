// Diagnostic: list all targets + browser version + any extension load errors
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        dumpio: true, // pipe browser stderr (manifest errors show here)
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });

    const version = await browser.version();
    console.log('CHROME VERSION:', version);

    await sleep(3000);
    const targets = await browser.targets();
    console.log('TARGETS:', targets.length);
    for (const t of targets) {
        console.log(' -', t.type(), '|', t.url());
    }
    await browser.close();
})().catch(e => {
    console.error('DIAG FAIL:', e.message);
    process.exit(2);
});
