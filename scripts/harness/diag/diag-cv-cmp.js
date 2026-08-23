// cv on/off: synchronous click duration for dupes group fold (open + close).
const puppeteer = require('puppeteer');
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
        const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(swTarget.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(120000);
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(1500);
        await page.evaluate(async () => {
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__cmp__' });
            for (let i = 0; i < 900; i++)
                await create({ parentId: root.id, title: 'd' + i, url: 'https://cmp.example/' + (i % 3) });
        });
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        const once = () => page.evaluate(() => {
            const head = document.querySelector('#dupes-list .dupes-group .group-head');
            const t0 = performance.now();
            head.click();
            const open = performance.now() - t0;
            const head2 = document.querySelector('#dupes-list .dupes-group .group-head');
            const t1 = performance.now();
            if (head2) head2.click();
            const foldBack = performance.now() - t1;
            return { open, foldBack };
        });

        await page.click('#view-tab-dupes');
        await sleep(1500);
        const withCv = await once();
        console.log('with-cv', JSON.stringify(withCv));
        await page.evaluate(() => {
            const s = document.createElement('style');
            s.textContent = '* { content-visibility: visible !important; contain-intrinsic-size: none !important; }';
            document.head.appendChild(s);
        });
        await sleep(300);
        const noCv = await once();
        console.log('no-cv', JSON.stringify(noCv));
    } finally {
        await browser.close();
    }
})().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
