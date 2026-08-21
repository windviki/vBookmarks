// Diagnostic probe (2026-08 storage-audit fix round): the smoke gate's dead
// filter section renders zero rows/buttons after the sync migration. Seed the
// exact smoke state, reload, and dump storage areas + the dead view DOM.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });
    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;
    const page = await browser.newPage();
    page.on('pageerror', e => console.log('PAGEERROR:', e.message));
    page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(900);

    const deadIds = await page.evaluate(() => new Promise(resolve => {
        chrome.bookmarks.create(
            { parentId: '2', title: 'Dead A', url: 'https://dead-a.example/' },
            a => chrome.bookmarks.create(
                { parentId: '2', title: 'Dead B', url: 'https://dead-b.example/' },
                b => resolve([a.id, b.id])));
    }));
    const [deadA, deadB] = deadIds;
    console.log('seeded ids:', deadA, deadB);
    await page.evaluate(([a, b]) => new Promise(resolve => chrome.storage.local.set({
        activeView: 'dead',
        deadFilter: 'all',
        deadMarkFilter: '',
        deadMarks: JSON.stringify([a]),
        deadLastScan: JSON.stringify({
            ts: Date.now(), scannedCount: 2,
            results: {
                [a]: { status: 'dead', code: 404 },
                [b]: { status: 'blocked', code: 403 }
            }
        })
    }, resolve)), [deadA, deadB]);
    await page.reload({ waitUntil: 'load' });
    await sleep(1200);

    const dump = await page.evaluate(([a, b]) => new Promise(resolve => {
        chrome.storage.local.get(null, local => {
            chrome.storage.sync.get(null, sync => {
                const dead = document.getElementById('view-dead');
                const list = document.getElementById('dead-list');
                resolve({
                    localKeys: Object.keys(local).sort(),
                    syncKeys: Object.keys(sync).sort(),
                    deadFilterLocal: local.deadFilter,
                    deadFilterSync: sync.deadFilter,
                    deadLastScanLocal: (local.deadLastScan || '').slice(0, 120),
                    activeView: local.activeView,
                    storeDeadFilter: window.store && window.store.get('deadFilter', 'DEF'),
                    storeDeadLastScan: !!(window.store && window.store.get('deadLastScan')),
                    deadContainer: dead ? { hidden: dead.hidden, display: getComputedStyle(dead).display } : null,
                    listHtml: list ? list.innerHTML.slice(0, 600) : '(no #dead-list)',
                    tabs: Array.from(document.querySelectorAll('.view-tab')).map(t => ({
                        id: t.dataset.view, active: t.classList.contains('active'), hidden: t.hidden
                    }))
                });
            });
        });
    }), [deadA, deadB]);
    console.log(JSON.stringify(dump, null, 2));
    await browser.close();
})().catch(e => {
    console.error('DIAG FAIL:', e.message);
    process.exit(2);
});
