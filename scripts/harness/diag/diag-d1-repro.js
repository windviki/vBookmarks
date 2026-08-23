// Repro for the verify-keyboard D1 regression: Home on a closed dupes
// strategy-dropdown trigger must land on the first group head. Samples the
// list state at the exact keypress moment.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const work = await create({ parentId: '1', title: '工作区' });
    await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
    await create({ parentId: work.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
    await create({ parentId: work.id, title: 'SO', url: 'https://stackoverflow.com/questions/tagged/chrome-extension' });
    const read = await create({ parentId: '1', title: '稍后读' });
    await create({ parentId: read.id, title: 'GitHub (mirror)', url: 'https://github.com/vBookmarks' });
    await create({ parentId: read.id, title: 'ALA', url: 'https://alistapart.com/topic/typography' };
})()`.replace('};', '}');

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2000);
        const sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const seedPage = await browser.newPage();
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(600);
        await seedPage.evaluate(`(async () => {
            const create = p => new Promise(r => chrome.bookmarks.create(p, r));
            const work = await create({ parentId: '1', title: '工作区' });
            await create({ parentId: work.id, title: 'GitHub', url: 'https://github.com/vBookmarks' });
            await create({ parentId: work.id, title: 'MDN Web Docs', url: 'https://developer.mozilla.org/docs/Web' });
            await create({ parentId: work.id, title: 'SO', url: 'https://stackoverflow.com/q' });
            const read = await create({ parentId: '1', title: '稍后读' });
            await create({ parentId: read.id, title: 'GitHub (mirror)', url: 'https://github.com/vBookmarks' });
        })()`);
        await sleep(600);
        await seedPage.close();

        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.setViewport({ width: 400, height: 620 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1200);
        await page.click('#view-tab-dupes');
        await sleep(900);

        const state = label => page.evaluate(tag => {
            const list = document.getElementById('dupes-list');
            const lis = list.querySelectorAll('li');
            const ae = document.activeElement;
            return `[${tag}] lis=${lis.length} first=${lis[0] ? lis[0].className : '-'} ` +
                `active=${ae ? (ae.className || ae.tagName) : 'none'} ` +
                `activeInList=${!!(ae && ae.closest && ae.closest('#dupes-list'))}`;
        }, label);

        console.log(await state('activated'));
        // open the strategy dropdown, pick (fires store.set + refresh)
        await page.evaluate(() => document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-trigger').focus());
        await page.keyboard.press('ArrowDown');
        await sleep(250);
        await page.keyboard.press('ArrowRight');
        await sleep(200);
        console.log(await state('after pick'));
        // D1: focus the trigger again, press Home, sample AT the moment
        await page.evaluate(() => document.querySelector('.vbm-dropdown.dupes-strategy .vbm-dropdown-trigger').focus());
        console.log(await state('trigger focused'));
        await page.keyboard.press('Home');
        console.log(await state('Home pressed (immediately)'));
        await sleep(250);
        console.log(await state('Home +250ms'));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAILED:', e && e.stack || e); process.exit(1); });
