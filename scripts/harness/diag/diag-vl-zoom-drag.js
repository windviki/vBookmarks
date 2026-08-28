// AUDIT diag: LAB virtual painter × zoom / popup-resize, on the dupes view
// (the biggest virtualized list). NOT part of the gate — run via rerun.sh.
// Phases:
//   A. control: no zoom, deep jump-scroll → 0 blank samples expected
//   B. zoom 120% (real Ctrl+= path) + same jump → top blank samples expected
//   C. zoom 120% + jump to bottom → near-total blank expected
//   D. zoom back to 100% (Ctrl+0) + jump → still blank (model re-stale)
//   E. view switch away+back (fresh render, savedScroll is real px) → still blank
//   F. page reload (fresh painter, scrollTop 0) → healed
//   G. height drag 240→600px without scrolling → bottom blank until 1px scroll
//   H. width 320→520px (crosses the 480px container query, rows go two-line)
//      at a deep scroll → blank; a 1px scroll re-windows
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SEED = { dupUrls: 150, dupCopies: 8 };

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
        await page.setViewport({ width: 420, height: 640 });
        page.on('pageerror', e => console.log('PAGEERROR:', e.message));
        page.setDefaultTimeout(240000);
        await page.goto('chrome-extension://' + extId + '/pages/popup.html', { waitUntil: 'load' });
        await sleep(1200);

        await page.evaluate(async seed => {
            const create = props => new Promise((res, rej) =>
                chrome.bookmarks.create(props, n => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res(n)));
            const tree = await new Promise(res => chrome.bookmarks.getTree(res));
            const bar = tree[0].children.find(c => c.id && !c.url && c.children);
            const root = await create({ parentId: bar.id, title: '__vlza__' });
            for (let u = 0; u < seed.dupUrls; u++) {
                const url = 'https://host' + u + '.example.com/page';
                for (let c = 0; c < seed.dupCopies; c++)
                    await create({ parentId: root.id, title: 'd' + u + 'c' + c, url });
            }
            return true;
        }, SEED);
        console.log('seeded', SEED.dupUrls * SEED.dupCopies, 'dup rows');

        await page.evaluate(() => chrome.storage.local.set({ virtualScrollLab: '1' }));
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);

        // Helpers are (re)installed before every phase — defensive against
        // any document replacement between phases.
        const HELPERS = `(() => {
            window.__settle = frames => new Promise(res => {
                let n = 0;
                const tick = () => (++n >= frames) ? res() : requestAnimationFrame(tick);
                requestAnimationFrame(tick);
            });
            window.__probe = () => {
                const list = document.getElementById('dupes-list');
                // The painter owns the LAST ul child (the head may carry its
                // own toolbar ul) — mirror that discovery.
                let ul = null;
                for (let el = list.lastElementChild; el; el = el.previousElementSibling)
                    if (el.tagName === 'UL') { ul = el; break; }
                const lr = list.getBoundingClientRect();
                const samples = [0.08, 0.3, 0.5, 0.7, 0.92];
                let blanks = 0;
                const blankHits = [];
                for (const s of samples) {
                    const el = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height * s);
                    const li = el && el.closest ? el.closest('li') : null;
                    if (!li || !list.contains(li)) {
                        blanks++;
                        blankHits.push(el ? el.tagName + '.' + (el.className || '') : 'null');
                    }
                }
                const rows = ul ? ul.children : [];
                const mid = rows[Math.floor(rows.length / 2)];
                return {
                    zoom: document.body.dataset.zoom || '100',
                    virtualClass: list.classList.contains('virtual-paint'),
                    scrollTop: Math.round(list.scrollTop),
                    scrollH: Math.round(list.scrollHeight),
                    clientH: Math.round(list.clientHeight),
                    rowH: mid ? Math.round(mid.getBoundingClientRect().height) : null,
                    rowsPainted: rows.length,
                    firstRow: rows[0] ? (rows[0].id || rows[0].className || '').slice(0, 40) : null,
                    pad: ul ? ul.style.paddingTop + '/' + ul.style.paddingBottom : null,
                    blank: blanks + '/5',
                    blankHits
                };
            };
            window.__jump = async (frac) => {
                const list = document.getElementById('dupes-list');
                list.scrollTop = list.scrollHeight * frac;
                await window.__settle(6);
                return window.__probe();
            };
            window.__zoomKey = key => document.dispatchEvent(
                new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
            return typeof window.__probe;
        })()`;
        const step = async (name, fn) => {
            console.log('step', name);
            await page.evaluate(HELPERS);
            return fn();
        };
        const inPage = (fn, ...args) => page.evaluate(fn, ...args);

        const results = {};
        // Layout anatomy: what each chrome element reports before/after zoom.
        const anatomy = label => page.evaluate(l => {
            const g = id => {
                const el = document.getElementById(id) || document.querySelector(id);
                if (!el) return null;
                return {
                    h: Math.round(el.offsetHeight),
                    ch: Math.round(el.clientHeight || 0),
                    zoom: getComputedStyle(el).zoom || '',
                    top: Math.round(el.getBoundingClientRect().top)
                };
            };
            return {
                label: l,
                bodyZoom: document.body.dataset.zoom || '100',
                body: g('body-ish') === null ? { h: document.body.offsetHeight } : null,
                container: g('container'),
                search: g('search'),
                tabs: g('view-tabs'),
                views: g('views'),
                list: g('dupes-list'),
                winInner: window.innerHeight
            };
        }, label).then(r => { console.log('ANATOMY ' + JSON.stringify(r)); return r; });

        await step('open-dupes', () => inPage(() => document.querySelector('#view-tab-dupes').click()));
        await inPage(() => window.__settle(20));
        await anatomy('pre-zoom');

        results.A_control_deep = await step('A', () => inPage(() => window.__jump(0.4)));
        await step('A-reset', () => inPage(() => { document.getElementById('dupes-list').scrollTop = 0; }));
        await inPage(() => window.__settle(6));

        await step('B-zoom', () => inPage(() => { window.__zoomKey('='); window.__zoomKey('='); }));
        await inPage(() => window.__settle(6));
        await anatomy('post-zoom-120');
        results.B_zoom120_jump40 = await step('B-jump', () => inPage(() => window.__jump(0.4)));
        results.C_zoom120_bottom = await step('C', () => inPage(() => window.__jump(1)));
        await page.screenshot({ path: '/tmp/shots/vl-audit-C-zoom120-bottom.png', clip: { x: 0, y: 0, width: 340, height: 640 } });

        await step('D-unzoom', () => inPage(() => window.__zoomKey('0')));
        await inPage(() => window.__settle(6));
        results.D_backTo100_bottom = await step('D-jump', () => inPage(() => window.__jump(1)));

        await step('E-tree', () => inPage(() => document.querySelector('#view-tab-tree').click()));
        await inPage(() => window.__settle(10));
        await step('E-dupes', () => inPage(() => document.querySelector('#view-tab-dupes').click()));
        await inPage(() => window.__settle(20));
        results.E_viewSwitchRender_bottom = await step('E-jump', () => inPage(() => window.__jump(1)));

        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await step('F-dupes', () => inPage(() => document.querySelector('#view-tab-dupes').click()));
        await inPage(() => window.__settle(20));
        results.F_freshReload_bottom = await step('F-jump', () => inPage(() => window.__jump(1)));

        // Height drag simulation: the real resizer writes body.style.height.
        await step('G-reset', () => inPage(() => { document.getElementById('dupes-list').scrollTop = 0; }));
        await inPage(() => window.__settle(6));
        await step('G-240', () => inPage(() => { document.body.style.height = '240px'; }));
        await inPage(() => window.__settle(8));
        results.G1_height240_top = await step('G-probe1', () => inPage(() => window.__probe()));
        await step('G-600', () => inPage(() => { document.body.style.height = '600px'; }));
        await inPage(() => window.__settle(8));   // NO scroll in between — that IS the scenario
        results.G2_height600_noscroll = await step('G-probe2', () => inPage(() => window.__probe()));
        await page.screenshot({ path: '/tmp/shots/vl-audit-G2-height600.png', clip: { x: 0, y: 0, width: 340, height: 640 } });
        results.G3_height600_1pxscroll = await step('G-probe3', () => inPage(async () => {
            const list = document.getElementById('dupes-list');
            list.scrollTop = 1;
            await window.__settle(6);
            return window.__probe();
        }));

        // Width drag across the 480px container query (single→two-line rows).
        await page.reload({ waitUntil: 'load' });
        await sleep(1500);
        await step('H-dupes', () => inPage(() => document.querySelector('#view-tab-dupes').click()));
        await inPage(() => window.__settle(20));
        results.H1_w320_deep = await step('H-jump320', () => inPage(() => window.__jump(0.35)));
        await step('H-520', () => inPage(() => {
            // the real resizer writes both roots
            document.documentElement.style.width = '520px';
            document.body.style.width = '520px';
        }));
        await inPage(() => window.__settle(8));   // no scroll — pure CSS reflow
        results.H2_w520_noscroll = await step('H-probe2', () => inPage(() => window.__probe()));
        results.H3_w520_1pxscroll = await step('H-probe3', () => inPage(async () => {
            const list = document.getElementById('dupes-list');
            list.scrollTop += 1;
            await window.__settle(6);
            return window.__probe();
        }));
        await page.screenshot({ path: '/tmp/shots/vl-audit-H3-w520.png', clip: { x: 0, y: 0, width: 340, height: 640 } });

        console.log('AUDIT-RESULTS ' + JSON.stringify(results, null, 1));
    } finally {
        await browser.close();
    }
}
main().catch(e => { console.error('DIAG FAIL:', e.message); process.exit(1); });
