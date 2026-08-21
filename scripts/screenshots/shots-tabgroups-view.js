// vBookmarks tab-groups VIEW screenshot + functional suite (4.1.0).
//
// Captures the new tab-groups view itself (the view after Search): tabs and
// tab groups rendered from the current browser window, the selection-mode
// batch bar, and the group-head context menu. Also asserts the basics the
// unit suite cannot: the view registers its tab, renders a real Chrome tab
// group with title/color/count, and exposes the group-head menu items.
// Shots land in /tmp/shots/tabgroups-view with the 34- series. 4.1.0 adds the
// window-head fold row, the row/selection icon-column alignment probes, both
// group-color styles, and the "recently closed" section with its own two
// context menus (mouse + keyboard).
const puppeteer = require('puppeteer');
require('fs').mkdirSync('/tmp/shots/tabgroups-view', { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.tabs.create(p, r));
    const t1 = await create({ url: 'https://example.com', active: false });
    const t2 = await create({ url: 'https://developer.mozilla.org', active: false });
    const t3 = await create({ url: 'https://github.com/vBookmarks', active: false });
    const groupId = await new Promise(r => chrome.tabs.group({ tabIds: [t2.id, t3.id] }, r));
    await new Promise(r => chrome.tabGroups.update(groupId, { title: '工作区', color: 'blue' }, r));
    return { t1: t1.id, t2: t2.id, t3: t3.id, groupId };
})()`;

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

    const errors = [];
    const watch = (page, tag) => {
        page.on('pageerror', e => {
            const msg = e.message;
            if (msg.includes('Failed to load resource') || msg.includes('net::') || msg.includes('Refused to'))
                return;
            errors.push(`${tag} pageerror: ${msg}`);
        });
        page.on('console', m => {
            if (m.type() !== 'error') return;
            const txt = m.text();
            if (txt.includes('Failed to load resource') || txt.includes('net::') || txt.includes('Refused to'))
                return;
            errors.push(`${tag} console.error: ${txt}`);
        });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;

    const openPopup = async () => {
        const page = await browser.newPage();
        watch(page, 'tabgroups-view');
        await page.setViewport({ width: 400, height: 640 });
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await page.evaluate(() => chrome.storage.local.set({
            currentVersion: chrome.runtime.getManifest().version,
            donationFactor: 1,
            donationKey: 30
        }));
        await page.reload({ waitUntil: 'networkidle0' });
        await sleep(1000);
        return page;
    };

    // --- Seed tabs + a real tab group in the current window -----------------
    const seedPage = await openPopup();
    await seedPage.evaluate(SEED);
    await sleep(800);
    await seedPage.close();

    // --- Open the tab groups view -------------------------------------------
    const page = await openPopup();
    await page.evaluate(() => {
        const tab = document.querySelector('#view-tab-tabgroups');
        if (!tab) throw new Error('tabgroups view tab not found');
        tab.click();
    });
    await sleep(1500);

    // Real Chrome data must render: one group header with the chosen title,
    // blue dot, count pill, and three tab rows total.
    const viewHtml = await page.evaluate(() => {
        const list = document.querySelector('#tabgroups-list');
        if (!list) return { error: 'tabgroups list not found' };
        const group = list.querySelector('li.tabgroups-group');
        return {
            html: list.innerHTML.slice(0, 1500),
            group: !!group,
            dot: !!(group && group.querySelector('.tab-group-dot.tg-blue')),
            title: (group && group.querySelector('.tabgroups-group-title')?.textContent || ''),
            count: (group && group.querySelector('.count-pill')?.textContent || '').trim(),
            rows: list.querySelectorAll('li.tabgroups-row').length
        };
    });
    if (viewHtml.error) throw new Error(viewHtml.error);
    if (!viewHtml.group) throw new Error('group header not rendered');
    if (!viewHtml.dot) throw new Error('blue group dot not rendered');
    if (!/工作区/.test(viewHtml.title)) throw new Error('group title not rendered');
    if (viewHtml.count !== '2') throw new Error('group count pill wrong');
    if (viewHtml.rows < 3) throw new Error('expected at least 3 tab rows');
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/34-tabgroups-view.png' });

    // --- Selection mode ------------------------------------------------------
    await page.evaluate(() => {
        const btn = document.querySelector('.tabgroups-select-mode');
        if (!btn) throw new Error('select-mode button not found');
        btn.click();
    });
    await sleep(600);
    await page.evaluate(() => {
        const rows = document.querySelectorAll('#tabgroups-list li.tabgroups-row');
        if (!rows.length) throw new Error('no tab rows in selection mode');
        rows[0].click();
    });
    await sleep(400);
    await page.evaluate(() => {
        const count = document.querySelector('.tabgroups-toolbar .select-count');
        if (!count || !/1/.test(count.textContent || ''))
            throw new Error('selection count not updated');
    });
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/35-tabgroups-selection.png' });

    // --- Group-head context menu ---------------------------------------------
    await page.evaluate(() => {
        const head = document.querySelector('.tabgroups-group-head');
        if (!head) throw new Error('group head not found');
        head.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: 160, clientY: head.getBoundingClientRect().top + 10
        }));
    });
    await sleep(600);
    await page.evaluate(() => {
        for (const id of ['tabgroup-activate', 'tabgroup-rename', 'tabgroup-collapse',
            'tabgroup-save-folder', 'tabgroup-sleep', 'tabgroup-close'])
            if (!document.getElementById(id))
                throw new Error('group menu item missing: ' + id);
    });
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/36-tabgroups-group-menu.png' });
    // dismiss the menu and LEAVE selection mode before the probes below
    // (in selection mode a head row toggles membership, not the fold)
    await page.evaluate(() => document.body.click());
    await sleep(300);
    await page.evaluate(() => {
        const exit = document.querySelector('.tabgroups-select-exit');
        if (exit) exit.click();
    });
    await sleep(500);

    // --- 4.1.0: window head row is the fold control + keyboard reachable -----
    const winHead = await page.evaluate(() => {
        const row = document.querySelector('#tabgroups-list .tabgroups-window-head-row');
        if (!row) return { error: 'window head row not found' };
        const before = document.querySelectorAll('#tabgroups-list li.tabgroups-row').length;
        // a click anywhere on the row folds the window
        row.click();
        const folded = document.querySelectorAll('#tabgroups-list li.tabgroups-row').length;
        const row2 = document.querySelector('#tabgroups-list .tabgroups-window-head-row');
        row2.focus();
        const focused = document.activeElement === row2;
        // Space unfolds it again (the group-head protocol, one level up)
        row2.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
        const unfolded = document.querySelectorAll('#tabgroups-list li.tabgroups-row').length;
        return {
            before, folded, unfolded, focused,
            role: row2.getAttribute('role'),
            tabindex: row2.getAttribute('tabindex')
        };
    });
    if (winHead.error) throw new Error(winHead.error);
    if (winHead.role !== 'button' || winHead.tabindex !== '-1')
        throw new Error('window head row is not a focusable role=button');
    if (!winHead.focused) throw new Error('window head row cannot take focus');
    if (winHead.folded !== 0) throw new Error(`row click did not fold the window (${winHead.folded} rows left)`);
    if (winHead.unfolded !== winHead.before)
        throw new Error(`Space did not restore the window section (${winHead.unfolded} vs ${winHead.before})`);

    // --- 4.1.0: the row icon columns line up with the group head's ------------
    const align = await page.evaluate(() => {
        const list = document.querySelector('#tabgroups-list');
        const head = list.querySelector('.tabgroups-group-head');
        const row = list.querySelector('li.tabgroups-row.grouped');
        const rightOf = el => Math.round(el.getBoundingClientRect().right);
        const lastControl = parent => {
            const items = parent.querySelectorAll('button, .tabgroups-slot, .tabgroups-star, .tabgroups-status-icon');
            return items[items.length - 1];
        };
        const headBtn = lastControl(head);
        const rowBtn = lastControl(row);
        const slots = row.querySelectorAll(':scope > button, :scope > .tabgroups-slot, :scope > .tabgroups-star, :scope > .tabgroups-status-icon');
        const centers = [...slots].map(s => Math.round(s.getBoundingClientRect().top + s.getBoundingClientRect().height / 2));
        const rowMid = Math.round(row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
        return {
            headRight: rightOf(headBtn),
            rowRight: rightOf(rowBtn),
            slotCount: slots.length,
            offCenter: centers.map(c => Math.abs(c - rowMid))
        };
    });
    if (align.slotCount !== 4)
        throw new Error(`expected 4 row icon columns, got ${align.slotCount}`);
    if (Math.abs(align.headRight - align.rowRight) > 1)
        throw new Error(`group-head and row icon strips are not aligned (${align.headRight} vs ${align.rowRight})`);
    for (const off of align.offCenter)
        if (off > 1)
            throw new Error(`row icon is not vertically centered (off by ${off}px)`);

    // --- 4.1.0: selection mode keeps the same four columns -------------------
    await page.evaluate(() => document.querySelector('.tabgroups-select-mode').click());
    await sleep(500);
    const selAlign = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#tabgroups-list li.tabgroups-row')];
        return rows.map(r => r.querySelectorAll(':scope > .tabgroups-slot, :scope > .tabgroups-star, :scope > .tabgroups-status-icon').length);
    });
    for (const n of selAlign)
        if (n !== 4)
            throw new Error(`selection-mode row has ${n} icon columns, expected 4`);
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/37-tabgroups-selection-align.png' });
    await page.evaluate(() => document.querySelector('.tabgroups-select-exit').click());
    await sleep(400);

    // --- 4.1.0: the color connector-line style -------------------------------
    await page.evaluate(async () => {
        await chrome.storage.local.set({ tabGroupsColorStyle: 'line' });
    });
    await sleep(800);
    const line = await page.evaluate(() => {
        const list = document.querySelector('#tabgroups-list');
        const ul = list.querySelector('ul');
        const conn = list.querySelector('li.tabgroups-row.grouped .tg-connector');
        if (!conn) return { error: 'connector not rendered', cls: ul.className };
        const head = list.querySelector('.tabgroups-group-head');
        const dot = head.querySelector('.tab-group-dot');
        const dotCenter = dot.getBoundingClientRect().left + dot.getBoundingClientRect().width / 2;
        const trunk = conn.getBoundingClientRect();
        const trunkCenter = trunk.left + 1.5;
        const width = parseFloat(getComputedStyle(conn, '::before').width);
        return {
            cls: ul.className,
            delta: Math.abs(dotCenter - trunkCenter),
            width,
            lastMarked: !!list.querySelector('li.tabgroups-row.grouped.tg-last')
        };
    });
    if (line.error) throw new Error(`${line.error} (ul class: ${line.cls})`);
    if (!/color-line/.test(line.cls)) throw new Error('list not marked color-line');
    if (line.delta > 1.5)
        throw new Error(`connector trunk is not under the group dot (off by ${line.delta}px)`);
    if (!(line.width >= 3)) throw new Error(`connector trunk too thin (${line.width}px)`);
    if (!line.lastMarked) throw new Error('last member row not marked tg-last');
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/38-tabgroups-color-line.png' });

    // …and the edge-band style still works through the same setting
    await page.evaluate(async () => {
        await chrome.storage.local.set({ tabGroupsColorStyle: 'edge' });
    });
    await sleep(800);
    const edge = await page.evaluate(() => {
        const ul = document.querySelector('#tabgroups-list ul');
        return { cls: ul.className, conn: !!document.querySelector('.tg-connector') };
    });
    if (!/color-enhanced/.test(edge.cls) || edge.conn)
        throw new Error(`edge style not applied (${edge.cls}, connector=${edge.conn})`);
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/39-tabgroups-color-edge.png' });

    // --- 4.1.0: recently closed section + its own context menus --------------
    await page.evaluate(async () => {
        await chrome.storage.local.set({
            tabGroupsColorStyle: 'off',
            faviconEnrich: '',
            tabGroupsClosed: JSON.stringify([
                {
                    id: 'cg_probe', type: 'group', title: '已关闭组', color: 'red',
                    savedAt: Date.now() - 3600000,
                    tabs: [{ title: 'Closed A', url: 'https://a.example/' },
                        { title: 'Closed B', url: 'https://b.example/' }]
                },
                {
                    id: 'ct_probe', type: 'tab', title: 'Closed single',
                    url: 'https://single.example/', windowId: 1,
                    savedAt: Date.now() - 7200000,
                    tabs: [{ title: 'Closed single', url: 'https://single.example/' }]
                }
            ])
        });
    });
    // domcontentloaded, not networkidle0: the seeded closed URLs make the
    // favicon pipeline fire requests that never settle in the offline image.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(2000);
    await page.evaluate(() => document.querySelector('#view-tab-tabgroups').click());
    await sleep(1200);
    const closed = await page.evaluate(() => {
        const list = document.querySelector('#tabgroups-list');
        const headText = list.querySelector('.tabgroups-closed-section-head em')?.textContent || '';
        const closedRow = list.querySelector('li.tabgroups-closed-tab');
        return {
            headText,
            group: !!list.querySelector('li.tabgroups-closed-group'),
            standalone: !!closedRow,
            time: closedRow ? (closedRow.querySelector('.row-path')?.textContent || '') : '',
            groupTime: list.querySelector('.tabgroups-closed-meta')?.textContent || ''
        };
    });
    if (!closed.group || !closed.standalone) throw new Error('closed records not rendered');
    if (!closed.groupTime) throw new Error('closed group time missing');
    if (!closed.time) throw new Error('closed tab close time missing');
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/40-tabgroups-closed.png' });

    // right-clicking a saved record opens ITS menu, not the bookmark menu
    const closedMenu = await page.evaluate(() => {
        const head = document.querySelector('.tabgroups-closed-head');
        head.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: 160, clientY: head.getBoundingClientRect().top + 8
        }));
        const visible = id => {
            const m = document.getElementById(id);
            return !!m && m.style.opacity === '1';
        };
        return {
            closed: visible('tabgroups-closed-context-menu'),
            folder: visible('folder-context-menu'),
            bookmark: visible('bookmark-context-menu')
        };
    });
    if (!closedMenu.closed || closedMenu.folder || closedMenu.bookmark)
        throw new Error(`closed record menu wrong: ${JSON.stringify(closedMenu)}`);
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/41-tabgroups-closed-menu.png' });
    await page.evaluate(() => document.body.click());
    await sleep(300);
    const closedTabMenu = await page.evaluate(() => {
        const row = document.querySelector('li.tabgroups-closed-tab a');
        row.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: 160, clientY: row.getBoundingClientRect().top + 8
        }));
        const visible = id => {
            const m = document.getElementById(id);
            return !!m && m.style.opacity === '1';
        };
        return {
            closedTab: visible('tabgroups-closed-tab-context-menu'),
            bookmark: visible('bookmark-context-menu'),
            revealShown: (() => {
                const it = document.getElementById('reveal-in-tree');
                return !!it && it.style.display !== 'none' && visible('bookmark-context-menu');
            })()
        };
    });
    if (!closedTabMenu.closedTab || closedTabMenu.bookmark || closedTabMenu.revealShown)
        throw new Error(`closed tab menu wrong: ${JSON.stringify(closedTabMenu)}`);
    // …and the keyboard can drive it (the 4.1.0 focus bug: the menu took focus
    // but answered no key at all)
    const menuKeys = await page.evaluate(() => {
        const menu = document.getElementById('tabgroups-closed-tab-context-menu');
        menu.focus();
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
        const first = document.activeElement && document.activeElement.id;
        menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
        return { first, second: document.activeElement && document.activeElement.id };
    });
    if (!menuKeys.first || menuKeys.first === 'tabgroups-closed-tab-context-menu')
        throw new Error(`closed-tab menu ignored ArrowDown (focus: ${menuKeys.first})`);
    if (menuKeys.second === menuKeys.first)
        throw new Error('closed-tab menu ignored ArrowUp');
    await page.screenshot({ path: '/tmp/shots/tabgroups-view/42-tabgroups-closed-tab-menu.png' });
    await page.evaluate(() => document.body.click());
    await sleep(300);

    // --- 4.1.0: narrow / wide parity with the dead + dupes views -------------
    // Narrow popup: the close time rides the inline .row-path slot and every
    // pane clips horizontally. Wide/panel (≥480px container): the second line
    // (.row-sub) takes over — the same container-query contract the dead view
    // uses. Nothing may overflow horizontally in either width.
    const widthProbe = async (w, shot) => {
        await page.setViewport({ width: w, height: 640 });
        await sleep(700);
        const res = await page.evaluate(() => {
            const list = document.querySelector('#tabgroups-list');
            const cs = getComputedStyle(list);
            const closedRow = list.querySelector('li.tabgroups-closed-tab');
            const vis = sel => {
                const el = closedRow && closedRow.querySelector(sel);
                return !!el && getComputedStyle(el).display !== 'none';
            };
            const overflow = [...list.querySelectorAll('li')]
                .filter(li => li.scrollWidth > li.clientWidth + 1).length;
            return {
                overflowX: cs.overflowX,
                paneOverflow: list.scrollWidth > list.clientWidth + 1,
                rowOverflow: overflow,
                path: vis('.row-path'),
                sub: vis('.row-sub')
            };
        });
        await page.screenshot({ path: `/tmp/shots/tabgroups-view/${shot}` });
        return res;
    };
    const narrow = await widthProbe(320, '43-tabgroups-narrow.png');
    if (narrow.overflowX !== 'hidden')
        throw new Error(`narrow: list does not clip overflow-x (${narrow.overflowX})`);
    if (narrow.paneOverflow || narrow.rowOverflow)
        throw new Error(`narrow: horizontal overflow (pane=${narrow.paneOverflow}, rows=${narrow.rowOverflow})`);
    if (!narrow.path || narrow.sub)
        throw new Error(`narrow: expected the inline time slot only (${JSON.stringify(narrow)})`);
    const wide = await widthProbe(640, '44-tabgroups-wide.png');
    if (wide.paneOverflow || wide.rowOverflow)
        throw new Error(`wide: horizontal overflow (pane=${wide.paneOverflow}, rows=${wide.rowOverflow})`);
    if (wide.path || !wide.sub)
        throw new Error(`wide: expected the second-line time slot only (${JSON.stringify(wide)})`);

    await browser.close();

    const realErrors = errors.filter(e => !e.includes('net::'));
    if (realErrors.length) {
        console.error(realErrors.join('\n'));
        process.exit(1);
    }
    console.log('tabgroups-view suite OK — 34-44 captured; view, selection alignment, '
        + 'window fold, both color styles, closed records + menus and narrow/wide parity verified');
})();
