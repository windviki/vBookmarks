// v4 task-4 #8: select-mode Space semantics + PageUp/PageDown coverage.
//  - dupes select mode: Space on a head toggles membership (NOT fold),
//    Space on a member row toggles its group (NOT open), focus restored.
//  - dead select mode: Space on a row toggles membership, focus restored.
//  - non-select mode: dupes head Space still folds.
//  - PageDown/PageUp move focus in dead and dupes views.
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

    // Seed: one dupes pair + enough plain bookmarks to make the dead list
    // scrollable; deadLastScan cache marks two of them dead.
    const seed = await openPopup();
    const ids = await seed.evaluate(() => new Promise(r => {
        const mk = (title, url) => new Promise(res => chrome.bookmarks.create({ title, url }, b => res(b.id)));
        (async () => {
            const d1 = await mk('dup1', 'https://example.com/dup');
            const d2 = await mk('dup2', 'https://example.com/dup');
            const rest = [];
            for (let i = 1; i <= 30; i++)
                rest.push(await mk(`b${i}`, `https://example.com/b${i}`));
            const results = {};
            results[rest[0]] = { status: 'dead', code: 404 };
            results[rest[1]] = { status: 'dead', code: 404 };
            for (let i = 2; i < rest.length; i++)
                results[rest[i]] = { status: 'ok', code: 200 };
            results[d1] = { status: 'ok', code: 200 };
            results[d2] = { status: 'ok', code: 200 };
            chrome.storage.local.set({
                currentVersion: chrome.runtime.getManifest().version,
                donationFactor: 1, donationKey: 30,
                activeView: 'tree',
                deadLastScan: JSON.stringify({
                    ts: Date.now(), scannedCount: rest.length + 2, results
                })
            }, () => r({ d1, d2, dead1: rest[0], dead2: rest[1] }));
        })();
    }));
    await sleep(300);
    await seed.close();

    const page = await openPopup();
    const out = {};
    const key = async k => { await page.keyboard.press(k); await sleep(250); };
    // Dismiss the donation banner if it is up — it is Esc layer 3 and would
    // eat the first Escape meant for select mode.
    await page.evaluate(() => {
        const b = document.getElementById('donation');
        if (b && b.style.display !== 'none') {
            const l = document.getElementById('donation-later');
            if (l) l.click();
        }
    });
    await sleep(200);

    // --- dupes view, select mode ------------------------------------------
    await page.click('#view-tab-dupes');
    await sleep(800);
    await page.click('.dupes-select-mode');
    await sleep(300);
    await page.focus('.dupes-group .group-head');
    await key('Space');
    out.dupesHeadSpace = await page.evaluate(() => ({
        selected: !!document.querySelector('.dupes-group.sel'),
        expanded: (document.querySelector('.group-head') || {}).getAttribute
            ? document.querySelector('.group-head').getAttribute('aria-expanded') : null,
        count: (document.querySelector('.select-count') || {}).textContent,
        focusOnHead: !!(document.activeElement && document.activeElement.classList
            && document.activeElement.classList.contains('group-head'))
    }));
    // member row Space toggles the group back off
    await page.focus(`#dupes-item-${ids.d1} a`);
    await key('Space');
    out.dupesMemberSpace = await page.evaluate(() => ({
        count: (document.querySelector('.select-count') || {}).textContent,
        selected: !!document.querySelector('.dupes-group.sel'),
        focusInRow: !!(document.activeElement && document.activeElement.closest
            && document.activeElement.closest('li.dupes-member'))
    }));
    // PageDown/PageUp walk the rows in select mode too
    await key('PageDown');
    out.dupesPageDown = await page.evaluate(() =>
        !!(document.activeElement && /^(A|SPAN|BUTTON|SELECT)$/.test(document.activeElement.tagName)
            && document.activeElement.closest('#view-dupes')));
    // leave select mode
    out.preEscape = await page.evaluate(() => ({
        activeEl: document.body.querySelector('.active') ? 'yes' : 'no',
        banner: (document.getElementById('donation') || {}).style
            ? document.getElementById('donation').style.display : 'missing',
        focusTag: document.activeElement && document.activeElement.tagName,
        focusInDupes: !!(document.activeElement && document.activeElement.closest
            && document.activeElement.closest('#view-dupes'))
    }));
    await key('Escape');
    await sleep(300);
    out.afterEscape = await page.evaluate(() => ({
        selectModeBtnBack: !!document.querySelector('.dupes-select-mode'),
        selectBarGone: !document.querySelector('.dupes-apply-selected')
    }));

    // --- dupes view, NON-select mode: head Space still folds ---------------
    await page.focus('.dupes-group .group-head');
    await key('Space');
    await sleep(400);
    out.dupesHeadSpacePlain = await page.evaluate(() => ({
        expanded: document.querySelector('.group-head').getAttribute('aria-expanded'),
        chevronCollapsed: !!document.querySelector('.chevron.collapsed')
    }));
    await key('Space'); // unfold again

    // --- dead view, select mode -------------------------------------------
    await page.click('#view-tab-dead');
    await sleep(800);
    await page.click('.dead-select-mode');
    await sleep(300);
    await page.focus(`#dead-item-${ids.dead1} a`);
    await key('Space');
    out.deadRowSpace = await page.evaluate(id => ({
        selected: !!(document.getElementById(`dead-item-${id}`) || {}).classList
            && document.getElementById(`dead-item-${id}`).classList.contains('sel'),
        count: (document.querySelector('.select-count') || {}).textContent,
        focusInRow: !!(document.activeElement && document.activeElement.closest
            && document.activeElement.closest(`#dead-item-${id}`))
    }), ids.dead1);
    await key('Space'); // off again
    out.deadRowSpaceOff = await page.evaluate(() =>
        (document.querySelector('.select-count') || {}).textContent);
    // PageDown/PageUp walk the dead rows
    await page.focus(`#dead-item-${ids.dead1} a`);
    await key('PageDown');
    out.deadPageDown = await page.evaluate(() =>
        !!(document.activeElement && document.activeElement.closest
            && document.activeElement.closest('#view-dead li')));
    await key('PageUp');
    out.deadPageUp = await page.evaluate(() =>
        !!(document.activeElement && document.activeElement.closest
            && document.activeElement.closest('#view-dead')));

    console.log(JSON.stringify(out, null, 2));
    const pass =
        out.dupesHeadSpace.selected && out.dupesHeadSpace.expanded === 'true' &&
        out.dupesHeadSpace.focusOnHead &&
        out.dupesMemberSpace.selected === false && out.dupesMemberSpace.focusInRow &&
        out.dupesPageDown &&
        out.afterEscape && out.afterEscape.selectModeBtnBack && out.afterEscape.selectBarGone &&
        out.dupesHeadSpacePlain.expanded === 'false' && out.dupesHeadSpacePlain.chevronCollapsed &&
        out.deadRowSpace.selected && out.deadRowSpace.focusInRow &&
        /0/.test(out.deadRowSpaceOff || '') &&
        out.deadPageDown && out.deadPageUp;
    console.log(pass ? 'PASS' : 'FAIL');
    await browser.close();
    process.exit(pass ? 0 : 2);
})().catch(e => { console.error('FAIL', e); process.exit(2); });
