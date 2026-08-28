// Repro probe: drag a tree row toward the popup's right edge and watch the
// viewport's horizontal scroll range (the "view shifts left, blank right"
// report). Real mouse events drive dnd.js's custom drag; geometry is sampled
// at every step. Also samples the tabgroups view (HTML5 drags) for whether
// any horizontal scroll range exists there at all.
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        fs.mkdirSync('/tmp/shots', { recursive: true });
        await sleep(2000);
        const targets = await browser.targets();
        const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        const extId = new URL(sw.url()).hostname;
        const page = await browser.newPage();
        await page.setViewport({ width: 324, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(240000);
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);

        await page.evaluate(async () => {
            const create = props => new Promise((res, rej) =>
                chrome.bookmarks.create(props, n => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(n)));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const folder = await create({ parentId: bar.id, title: '__edge__' });
            for (let i = 0; i < 40; i++)
                await create({ parentId: folder.id, title: 'edge row ' + i, url: 'https://edge' + i + '.example.com/page' });
            return true;
        });
        // open the folder so rows render
        const openDump = await page.evaluate(() => {
            const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
            const el = spans.find(s => (s.textContent || '').trim().includes('__edge__'));
            const dbg = {
                spanCount: spans.length,
                titles: spans.map(s => (s.textContent || '').trim().slice(0, 30)),
                found: !!el,
                childRows: document.querySelectorAll('#tree li.child').length,
                parentRows: document.querySelectorAll('#tree li.parent').length,
                treeHtmlHead: (document.getElementById('tree').innerHTML || '').slice(0, 200)
            };
            {
                // open "Bookmarks bar" first — __edge__ lives inside it and
                // only renders once the bar expands
                const barSpan = spans.find(s => (s.textContent || '').trim().includes('Bookmarks bar'));
                if (barSpan)
                    barSpan.click();
            }
            return dbg;
        });
        console.log('open-dump', JSON.stringify(openDump));
        await sleep(400);
        // now open the seeded folder (rendered after the bar expanded)
        await page.evaluate(() => {
            const spans = [...document.querySelectorAll('#tree li span.tree-item-span')];
            const el = spans.find(s => (s.textContent || '').trim().includes('__edge__'));
            if (el)
                el.click();
        });
        await sleep(800);
        const rowsAfter = await page.evaluate(() => ({
            childRows: document.querySelectorAll('#tree li.child').length,
            firstRowHtml: (document.querySelector('#tree li.child') || {}).outerHTML ? document.querySelector('#tree li.child').outerHTML.slice(0, 120) : null
        }));
        console.log('rows-after', JSON.stringify(rowsAfter));

        const geom = () => page.evaluate(() => {
            const clone = document.getElementById('bookmark-clone');
            const de = document.documentElement;
            const body = document.body;
            return {
                deScrollLeft: de.scrollLeft, deScrollW: de.scrollWidth, deClientW: de.clientWidth,
                bodyScrollLeft: body.scrollLeft, bodyScrollW: body.scrollWidth,
                innerW: window.innerWidth,
                treeScrollLeft: document.getElementById('tree').scrollLeft,
                treeScrollW: document.getElementById('tree').scrollWidth,
                cloneLeft: clone ? clone.style.left : null,
                cloneRectRight: clone ? Math.round(clone.getBoundingClientRect().right) : null,
                scrollableX: de.scrollWidth > de.clientWidth
            };
        });

        const results = { tree: [] };
        const row = await page.$('#tree li.child a');
        if (!row) {
            console.log('NO ROW FOUND');
            return;
        }
        const bb = await row.boundingBox();
        console.log('row at', JSON.stringify(bb));
        // Start on plain empty <a> space: the row's left is the <i> title
        // text, its right end is the staging/action buttons — dnd's
        // mousedown only accepts the <a> itself.
        const startX = bb.x + Math.min(200, bb.width - 120);
        // instrument the event flow to see what dnd actually receives
        await page.evaluate(() => {
            window.__dbg = [];
            document.getElementById('tree').addEventListener('mousedown', e => {
                window.__dbg.push('tree-mousedown btn=' + e.button + ' target=' + e.target.tagName + '.' + e.target.className);
            }, true);
            document.addEventListener('mousedown', e => {
                window.__dbg.push('doc-mousedown btn=' + e.button + ' target=' + e.target.tagName);
            }, true);
            document.addEventListener('mousemove', e => {
                if (window.__dbg.length < 40)
                    window.__dbg.push('mousemove ' + e.clientX + ',' + e.clientY + ' target=' + e.target.tagName);
            }, true);
        });
        const hitInfo = await page.evaluate((x, y) => {
            const el = document.elementFromPoint(x, y);
            return {
                tag: el ? el.tagName : null,
                cls: el ? el.className : null,
                parentTag: el && el.parentNode ? el.parentNode.tagName : null,
                parentCls: el && el.parentNode ? el.parentNode.className : null,
                treeHasMousedown: typeof document.getElementById('tree') === 'object'
            };
        }, startX, bb.y + 4);
        console.log('hit-at-start', JSON.stringify(hitInfo));
        await page.mouse.move(startX, bb.y + 4);
        await page.mouse.down();
        // leave the source row first (the clone hides while the pointer
        // hovers the dragged element itself), then sweep toward the edge
        await page.mouse.move(startX, bb.y + 44, { steps: 4 });
        await sleep(80);
        // The decisive sweep stays INSIDE the body (320px) with the clone
        // swung out to its right — the state where the clone's box pokes
        // past the body and (pre-fix) extended the document's scroll range.
        for (let step = 0; step <= 9; step++) {
            const x = Math.min(312, startX + 20 + step * 14);
            await page.mouse.move(x, bb.y + 44, { steps: 2 });
            await sleep(60);
            const g = await geom();
            results.tree.push({ step, x: Math.round(x), ...g });
        }
        // screenshot mid-drag at the edge (mouse still down)
        await page.screenshot({ path: '/tmp/shots/edge-drag-tree-at-edge.png' });
        // try to make the viewport scroll horizontally while the drag is live
        // (wheel pan — the trackpad user's path)
        await page.mouse.wheel({ deltaX: 240 });
        await sleep(120);
        await page.mouse.wheel({ deltaX: 240 });
        await sleep(200);
        results.afterWheel = await geom();
        await page.screenshot({ path: '/tmp/shots/edge-drag-tree-after-wheel.png' });
        await page.mouse.up();
        await sleep(200);
        results.eventFlow = await page.evaluate(() => (window.__dbg || []).slice(0, 40));
        results.afterDrop = await geom();

        // Tabgroups view (HTML5 drags): any horizontal scroll range at all?
        results.tabgroups = await page.evaluate(() => {
            const de = document.documentElement;
            const list = document.getElementById('tabgroups-list');
            return {
                deScrollW: de.scrollWidth, deClientW: de.clientWidth,
                listScrollW: list.scrollWidth, listClientW: list.clientWidth
            };
        });
        console.log('EDGE-DRAG-RESULTS ' + JSON.stringify(results, null, 1));
    } finally {
        await browser.close();
    }
}
main().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
