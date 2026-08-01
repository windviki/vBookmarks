// v4 task-4 #7: dupes select-mode button text — placeholders must render
// without leftover `$` ("应用去重所选 (2)", "共选择 1 项").
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
    const swTarget = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;
    const openPopup = async () => {
        const page = await browser.newPage();
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(700);
        return page;
    };

    // Seed duplicate bookmarks (same URL twice → one dupes group).
    const seed = await openPopup();
    await seed.evaluate(() => new Promise(r => {
        chrome.bookmarks.create({ title: 'a1', url: 'https://example.com/x' }, () => {
            chrome.bookmarks.create({ title: 'a2', url: 'https://example.com/x' }, () => {
                chrome.storage.local.set({
                    currentVersion: chrome.runtime.getManifest().version,
                    donationFactor: 1, donationKey: 30,
                    activeView: 'tree'
                }, r);
            });
        });
    }));
    await sleep(300);
    await seed.close();

    const page = await openPopup();
    await page.click('#view-tab-dupes');
    await sleep(800);
    const hasGroups = await page.evaluate(() => !!document.querySelector('.dupes-group'));
    if (!hasGroups) {
        console.log(JSON.stringify({ fail: 'no dupes groups rendered' }));
        process.exit(2);
    }
    await page.click('.dupes-select-mode');
    await sleep(300);
    // Select the first group by clicking its head.
    await page.click('.dupes-group .group-head');
    await sleep(300);
    const out = await page.evaluate(() => ({
        selectCount: (document.querySelector('.select-count') || {}).textContent,
        applySelected: (document.querySelector('.dupes-apply-selected') || {}).textContent,
        confirmSelectedSample: null
    }));
    // Also read the confirm-dialog message template via i18n API directly.
    out.confirmSelectedSample = await page.evaluate(() =>
        chrome.i18n.getMessage('dupesConfirmSelected', ['2', '1']));
    console.log(JSON.stringify(out, null, 2));
    const bad = [out.selectCount, out.applySelected, out.confirmSelectedSample]
        .some(t => !t || t.includes('$'));
    console.log(bad ? 'FAIL: placeholder residue' : 'PASS');
    await browser.close();
    process.exit(bad ? 2 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(2); });
