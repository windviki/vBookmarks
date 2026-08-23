// 4.1.0 LAB verification — the virtualScrollLab switch (options 实验室):
// with the flag ON, the dupes/tab-groups lists keep only the viewport window
// in the DOM (paddings carry the rest); scrolling re-windows; flipping the
// switch live re-renders both ways; the regroup cost is measured ON vs OFF
// in the SAME session (separating a virtual-path regression from drift).
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const launch = () => puppeteer.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--load-extension=/ext', '--disable-extensions-except=/ext']
});

const regroupRuns = (page, label, n) => {
    const one = async run => {
        const before = await page.evaluate(() => new Promise(res => {
            chrome.storage.local.get('dupesLastResult', d => {
                try {
                    res((JSON.parse(d.dupesLastResult || 'null') || {}).ts || 0);
                } catch (_) {
                    res(0);
                }
            });
        }));
        const t0 = Date.now();
        const salt = `${Date.now()}-${run}-${Math.random()}`;
        await page.evaluate(u => new Promise(res => {
            chrome.bookmarks.create({ parentId: '1', title: 'lab-trigger', url: u }, () => res());
        }), `http://127.0.0.1:9/lab-${salt}`);
        await page.waitForFunction(prevTs => new Promise(res => {
            chrome.storage.local.get('dupesLastResult', d => {
                try {
                    const ts = (JSON.parse(d.dupesLastResult || 'null') || {}).ts || 0;
                    res(ts !== prevTs);
                } catch (_) {
                    res(false);
                }
            });
        }), { timeout: 60000, polling: 200 }, before);
        await sleep(500);
        console.log(`${label} regroup wall run ${run + 1} (incl settle): ${Date.now() - t0 - 500} ms`);
    };
    return (async () => {
        for (let run = 0; run < n; run++)
            await one(run);
    })();
};

(async () => {
    const browser = await launch();
    try {
        await sleep(2000);
        let sw = null;
        for (let i = 0; i < 20 && !sw; i++) {
            sw = (await browser.targets()).find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
            if (!sw)
                await sleep(500);
        }
        if (!sw)
            throw new Error('service worker target not found');
        const extId = new URL(sw.url()).hostname;

        // --- seed 6000 bookmarks / 25% dups (perf-popup.js recipe) ---------
        const seedPage = await browser.newPage();
        await seedPage.evaluateOnNewDocument(() => { window.close = () => {}; });
        await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        const seeded = await seedPage.evaluate(async (opts) => {
            const getTree = () => new Promise(res => chrome.bookmarks.getTree(res));
            const create = props => new Promise(res => chrome.bookmarks.create(props, res));
            const tree = await getTree();
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__perf__' });
            const L1 = 20, L2 = 5, L3 = 3;
            const dupGroups = Math.round(opts.count * opts.dupRatio / 3);
            const perL3 = Math.max(1, Math.round((opts.count - dupGroups * 3) / (L1 * L2 * L3)));
            const l1Ids = [], l2Ids = [], l3Ids = [];
            for (let i = 0; i < L1; i++)
                l1Ids.push(await create({ parentId: folder.id, title: `L1-${i}` }));
            let seq = 0;
            const originals = [];
            for (let i = 0; i < L1; i++) {
                for (let j = 0; j < L2; j++) {
                    const l2 = await create({ parentId: l1Ids[i].id, title: `L1-${i}/L2-${j}` });
                    l2Ids.push(l2);
                    for (let k = 0; k < L3; k++) {
                        const l3 = await create({ parentId: l2.id, title: `L1-${i}/L2-${j}/L3-${k}` });
                        l3Ids.push(l3);
                    }
                }
            }
            for (let i = 0; i < l3Ids.length; i++) {
                const batch = [];
                for (let b = 0; b < perL3; b++) {
                    const url = `http://127.0.0.1:9/u/${++seq}`;
                    batch.push(create({ parentId: l3Ids[i].id, title: `bm ${seq}`, url }).then(n => { originals.push({ url }); }));
                }
                await Promise.all(batch);
            }
            const dups = await create({ parentId: folder.id, title: '__perf_dups__' });
            for (let g = 0; g < Math.min(dupGroups, originals.length); g++) {
                for (const parentId of [l2Ids[g % l2Ids.length].id, l1Ids[g % l1Ids.length].id, dups.id]) {
                    await create({ parentId, title: 'dup', url: originals[g].url });
                }
            }
            return { total: seq + Math.min(dupGroups, originals.length) * 3 };
        }, { count: 6000, dupRatio: 0.25 });
        console.log('seeded:', JSON.stringify(seeded));
        await seedPage.close();

        // --- flag ON: window rendering + re-windowing + regroup cost -------
        const page = await browser.newPage();
        await page.setViewport({ width: 400, height: 620 });
        await page.evaluateOnNewDocument(() => { window.close = () => {}; });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(3000);
        await page.evaluate(() => chrome.storage.local.set({ virtualScrollLab: '1' }));
        await sleep(300);
        await page.evaluate(() => { const b = document.getElementById('view-tab-dupes'); if (b) b.click(); });
        await page.waitForFunction(() => {
            const l = document.getElementById('dupes-list');
            return !!l && l.querySelectorAll('li').length > 0;
        }, { timeout: 60000 });
        await sleep(500);

        const winState = await page.evaluate(() => {
            const list = document.getElementById('dupes-list');
            const ul = list.querySelector('ul:not(.vbm-dropdown-list)');
            const cs = getComputedStyle(ul);
            return {
                renderedLis: ul.querySelectorAll('li').length,
                totalLis: list.querySelectorAll('li').length,
                padTop: cs.paddingTop,
                padBottom: cs.paddingBottom,
                scrollH: list.scrollHeight,
                clientH: list.clientHeight,
                scrollTop: list.scrollTop
            };
        });
        console.log('VIRTUAL ON  dupes window:', JSON.stringify(winState));

        // scroll deep → the rendered slice must swap
        await page.evaluate(() => {
            const l = document.getElementById('dupes-list');
            l.scrollTop = Math.floor(l.scrollHeight * 0.5);
        });
        await sleep(600);
        const midState = await page.evaluate(() => {
            const list = document.getElementById('dupes-list');
            const ul = list.querySelector('ul:not(.vbm-dropdown-list)');
            const key = ul.querySelector('li .dupes-key');
            return {
                renderedLis: ul.querySelectorAll('li').length,
                firstText: key ? key.textContent : '',
                padTop: getComputedStyle(ul).paddingTop,
                scrollTop: Math.round(list.scrollTop)
            };
        });
        console.log('VIRTUAL ON  mid-scroll :', JSON.stringify(midState));

        // back to the top, then regroup ×3 under virtual
        await page.evaluate(() => { document.getElementById('dupes-list').scrollTop = 0; });
        await sleep(400);
        await regroupRuns(page, 'VIRTUAL ON ', 3);

        // --- live toggle OFF: the storage event must re-render fully -------
        await page.evaluate(() => chrome.storage.local.set({ virtualScrollLab: '' }));
        await sleep(800);
        const offState = await page.evaluate(() => {
            const list = document.getElementById('dupes-list');
            const ul = list.querySelector('ul:not(.vbm-dropdown-list)');
            return {
                flagOff: true,
                totalLis: ul.querySelectorAll('li').length,
                padTop: getComputedStyle(ul).paddingTop
            };
        });
        console.log('VIRTUAL OFF (live)     :', JSON.stringify(offState));

        // control: the same regroup ×3 with the flag OFF (same session)
        await regroupRuns(page, 'VIRTUAL OFF', 3);

        // --- live toggle ON again (idempotence of the switch) ---------------
        await page.evaluate(() => chrome.storage.local.set({ virtualScrollLab: '1' }));
        await sleep(800);
        const onAgain = await page.evaluate(() => {
            const ul = document.querySelector('#dupes-list ul:not(.vbm-dropdown-list)');
            return {
                renderedLis: ul.querySelectorAll('li').length,
                padTop: getComputedStyle(ul).paddingTop
            };
        });
        console.log('VIRTUAL ON  (live)     :', JSON.stringify(onAgain));

        // options page: the Labs section renders and the checkbox reflects storage
        const opt = await browser.newPage();
        await opt.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'load' });
        await sleep(800);
        const optState = await opt.evaluate(() => ({
            labsHeading: (document.getElementById('labs-options') || {}).innerText || null,
            label: (document.getElementById('option-virtual-scroll-lab') || {}).innerText || null,
            checked: (document.getElementById('virtual-scroll-lab') || {}).checked
        }));
        console.log('OPTIONS labs section   :', JSON.stringify(optState));

        console.log('\nDIAG OK');
    } finally {
        await browser.close();
    }
})().catch(e => {
    console.error('DIAG FAILED:', e && e.stack || e);
    process.exit(1);
});
