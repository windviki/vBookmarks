#!/usr/bin/env node
// verify-scrollbars.js — 真实浏览器横向滚动条矩阵探针（阻塞层，run.sh 第 3 层）。
//
// 在真实 Chromium 里以 屏幕分辨率 × 浏览器 zoom × 扩展内 zoom 矩阵打开 popup，
// 对每个滚动容器断言"不会出现横向滚动条"。纵向滚动允许（报告性）。
//
// 三层断言（由强到弱）：
//   1. 每个滚动容器的 computed overflow-x === 'hidden' —— 容器不可能出横向
//      滚动条（这直接编码"横向滚动条防护契约"，与 tests/scrollbar-contract.test.js
//      的静态 CSS 断言互为表里；jsdom 无布局，真实测量只能在这里做）。
//   2. #tree 注入与 tree-render.js:213-216 完全相同的 .sync-indicator.synced
//      + 长 nowrap .sync-tooltip 后，断言每个注入角标 computed display === 'none'
//      —— 复现并钉死 commit 98e29b3 的根因（#tree ul li span 后代选择器曾把
//      synced 角标强制成 display:flex，tooltip 隐形文字撑出横向滚动条）。
//   3. 除 #tree 外的每个滚动容器 scrollWidth <= clientWidth + 1 —— 无隐形
//      内容溢出（省略号契约在真实布局里成立）。#tree 跳过此项：深层缩进 ×
//      高 zoom 时行固定槽（favicon 等）会合理越界，靠 overflow-x:hidden 裁剪，
//      scrollWidth 溢出属预期，不由它判定。
//
// 矩阵（解耦横向/纵向，~14 次页面加载，约 2-3 分钟）：
//   Phase A 横向   — 内部 zoom(90..150) × popup 宽(320/640)，浏览器 zoom=1.0、
//                     屏幕 1920×1080，全 6 视图 + 命令面板抽查
//   Phase B 纵向   — 浏览器 zoom(1.0/1.5) × 屏幕(1366×768/1920×1080/3840×2160/
//                     1024×600)，内部 zoom=100、宽 320，测树 + 最近视图 +
//                     body 高度哨兵（zoom=1.5 时 maxH=399，stub 未生效即 FAIL）
//   Phase C 固定高 — popup 高(300/450) × 宽(320/640)，autoResizePopup=false
//                    钉住高度，内部 zoom(100/150)，全 6 视图
//
// 与 harness 的约定（docs/cdp-escape-limitation.md）：
//   - CDP 键盘事件不达 capture-phase → 命令面板用 #palette-close 关闭，不用 Esc
//   - 打开书签的 post-open window.close 会关掉 harness tab → evaluateOnNewDocument
//     打桩 window.close（探针不点书签行，仅防御）
//   - viewport 宽必须 = body 宽（#container 绝对定位到初始包含块，宽不匹配会
//     掩盖 320 宽溢出）
// 退出码：0 = 全 PASS；1 = 有 FAIL；2 = 探针自身异常。
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FAILURES = [];
let checks = 0;
const check = (ok, label) => {
    checks++;
    if (ok) console.log(`  ✓ ${label}`);
    else { console.log(`  ✗ ${label}`); FAILURES.push(label); }
};
const SECTION = title => console.log(`\n═══ ${title} ═══`);

// ── 对抗性 seed：深链、长标题、dupes/dead/stats/历史 ──────────────────────
// 运行一次即把书签与各视图的存储数据写满；测量页只读。
const SEED = `
(async () => {
    const create = p => new Promise(r => chrome.bookmarks.create(p, r));
    const longAscii = 'Abcdefgh'.repeat(30);   // 240 字符无空格
    const longCjk = '中文标题好长'.repeat(20); // 100 字符 CJK
    const dupUrl = 'https://dupe.example.com/deep/path/' + longAscii.slice(0, 50);
    let parent = '1';
    const deepIds = [];
    for (let i = 1; i <= 8; i++) {             // 8 层深链 → 24px×8 缩进
        const f = await create({ parentId: parent, title: 'L' + i + ' 深文件夹'.repeat(2) + i });
        deepIds.push(f.id);
        parent = f.id;
    }
    const deepBook = await create({ parentId: parent, title: longAscii, url: 'https://deep.example.com/x' });
    await create({ parentId: '1', title: longCjk, url: 'https://cjk.example.com/x' });
    await create({ parentId: '1', title: 'Dup 一', url: dupUrl });
    await create({ parentId: '1', title: 'Dup 二', url: dupUrl });
    await create({ parentId: '1', title: 'Dup 三', url: dupUrl });
    const dead1 = await create({ parentId: '1', title: 'Dead ' + longAscii.slice(0, 40),
        url: 'http://127.0.0.1:9/dead-' + Date.now() });
    const now = Date.now();
    await chrome.storage.local.set({
        currentVersion: chrome.runtime.getManifest().version,
        donationFactor: 1,                       // 静默捐赠横幅
        donationKey: 30,
        visitStats: JSON.stringify({
            [deepBook.id]: { c: 99, t: now - 60e3 },
            [deepIds[0]]: { c: 42, t: now - 3600e3 }
        }),
        deadMarks: JSON.stringify([dead1.id]),
        deadLastScan: JSON.stringify({
            ts: now - 3600e3, scannedCount: 5,
            results: { [dead1.id]: { status: 'dead', code: 404 } }
        }),
        searchHistory: JSON.stringify(
            Array.from({ length: 10 }, (_, i) => ({ q: '很长的搜索查询词' + '啊'.repeat(12) + i, ts: now - i * 60e3, n: i })))
    });
})()`;

// 在 document-start 给 chrome.tabs.getZoom / screen / screenY 打桩。
// 浏览器 zoom 只在 resetHeight 的高度 clamp 里被消费，stub 即完整建模。
const makeInitScript = (browserZoom, screenW, screenH) => `(() => {
    try {
        const gz = chrome.tabs.getZoom;
        chrome.tabs.getZoom = cb => gz.call(chrome.tabs, () => cb(${browserZoom}));
    } catch (e) {
        try { Object.defineProperty(chrome.tabs, 'getZoom', { configurable: true, value: cb => cb(${browserZoom}) }); } catch (e2) {}
    }
    try { Object.defineProperty(window.screen, 'width',  { configurable: true, get: () => ${screenW} }); } catch (e) {}
    try { Object.defineProperty(window.screen, 'height', { configurable: true, get: () => ${screenH} }); } catch (e) {}
    try { Object.defineProperty(window, 'screenY', { configurable: true, get: () => 0 }); } catch (e) {}
    // 防御：actions 层 post-open 的 window.close 会关掉 harness tab
    try { window.close = () => {}; } catch (e) {}
})()`;

// 每组合写入的 popup 设置（popup.js 在 DOMContentLoaded 读 popupWidth/popupHeight）。
const PREF_KEYS = ['popupWidth', 'popupHeight', 'autoResizePopup', 'rememberView', 'activeView',
    'onlyShowBMBar', 'showViewTabs', 'showToolButton', 'paletteEnabled'];

const VIEWS = [
    { id: 'tree',   panes: ['#tree'] },
    { id: 'search', panes: ['#search-history-area', '#results'] },
    { id: 'recent', panes: ['#recent-list'] },
    { id: 'stats',  panes: ['#stats-list'] },
    { id: 'dead',   panes: ['#dead-list'] },
    { id: 'dupes',  panes: ['#dupes-list'] },
];

// 展开全部文件夹（最多 12 轮，每轮点击所有未展开的 parent）。
const EXPAND_ALL = `
(async () => {
    for (let pass = 0; pass < 12; pass++) {
        let clicked = 0;
        document.querySelectorAll('#tree ul li.parent > span').forEach(s => {
            const li = s.closest('li');
            if (li && !li.classList.contains('open')) { s.click(); clicked++; }
        });
        if (!clicked) break;
        await new Promise(r => setTimeout(r, 300));
    }
    return document.querySelectorAll('#tree li').length;
})()`;

// 往前 N 个 favicon 容器注入与 tree-render.js:213-216 完全相同的 synced 角标
// + 长 nowrap tooltip。修复后 synced 角标 computed display 必须为 none。
// 树 DOM 跨 zoom 持久存在，先清空上次注入的角标（sync mirror 为空时树里
// 的 .sync-indicator 全是本探针注入的），保证每次恰好 5 个、可确定性断言。
const INJECT_SYNCED = `
(() => {
    const tooltip = '同步状态：本地修改尚未同步，点击查看详情 ' + 'x'.repeat(60);
    document.querySelectorAll('#tree .sync-indicator').forEach(el => el.remove());
    let injected = 0;
    document.querySelectorAll('#tree .favicon-container').forEach(fc => {
        if (injected >= 5) return;
        fc.insertAdjacentHTML('beforeend',
            '<span class="sync-indicator synced"><span class="sync-tooltip">' + tooltip + '</span></span>');
        injected++;
    });
    return injected;
})()`;

// 树视图准备：展开深链 + 注入 synced 角标 + 注入 dead-indicator ×，返回注入数。
const prepareTree = async page => {
    const rows = await page.evaluate(EXPAND_ALL);
    const injected = await page.evaluate(INJECT_SYNCED);
    const dead = await page.evaluate(INJECT_DEAD);
    return { rows, injected, dead };
};

// 往前 N 个 favicon 注入 .dead-indicator（与 view-dead.js refreshOverlays 完全
// 相同的标记：<span class="dead-indicator">×</span>）。行 flex 规则若用后代选择
// 器泄漏进覆盖物，× 会变黑/偏移/圆形被拉成椭圆（98e29b3 曾引入此回退，已改用
// `#tree ul li > span` 子选择器修复）。
const INJECT_DEAD = `
(() => {
    let injected = 0;
    document.querySelectorAll('#tree .favicon-container').forEach(fc => {
        if (injected >= 3) return;
        if (fc.querySelector('.dead-indicator')) return;
        const span = document.createElement('span');
        span.className = 'dead-indicator';
        span.textContent = '×';
        fc.appendChild(span);
        injected++;
    });
    return injected;
})()`;

// 程序化点击：`#container` 经 body[data-zoom] 缩放后，puppeteer 的几何点击
// （clickablePoint 命中测试）会偶发失败；探针测的是布局溢出而非鼠标交互，
// 派发真实 click 事件即可（view-manager / palette 的 click 监听照常触发）。
const clickJS = (page, selector) => page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
}, selector);

// 测量一个滚动容器：computed overflow + 是否横向溢出。
// 返回 { overflowX, xOverflow, scrollW, clientW, vOverflow } 或 { missing }。
const measurePane = (page, paneSel) => page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return { missing: true };
    const cs = getComputedStyle(el);
    if (cs.display === 'none') return { hidden: true };
    return {
        overflowX: cs.overflowX,
        xOverflow: el.scrollWidth > el.clientWidth + 1,
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        vOverflow: el.scrollHeight > el.clientHeight + 1
    };
}, paneSel);

// 单个扩展 zoom 下遍历全部视图并断言。tag 用于定位 FAIL 来源。
const sweepViews = async (page, tag, { includePalette }) => {
    for (const view of VIEWS) {
        const tabClicked = await clickJS(page, `#view-tab-${view.id}`);
        check(tabClicked, `${tag} click #view-tab-${view.id}`);
        await sleep(650); // view-manager 激活钩子异步渲染

        if (view.id === 'tree') {
            const { rows, injected, dead } = await prepareTree(page);
            check(rows >= 10, `${tag} tree rendered ≥10 rows (got ${rows})`);
            if (injected > 0) {
                const states = await page.evaluate(() =>
                    [...document.querySelectorAll('#tree .sync-indicator.synced')].map(el => {
                        const row = el.closest('li');
                        return { display: getComputedStyle(el).display,
                                 row: row ? (row.querySelector('a') ? 'a' : 'span') : '?',
                                 level: row ? row.getAttribute('level') : '?' };
                    }));
                const ok = states.length === injected && states.every(s => s.display === 'none');
                check(ok, `${tag} tree injected ${injected} .sync-indicator.synced all computed display:none (98e29b3 root cause)` +
                    (ok ? '' : ` — got ${JSON.stringify(states)}`));
            }
            if (dead > 0) {
                // dead × 必须钉住白/居中/10px 圆盒：行 flex 规则泄漏进来会
                // 让 color==fg（黑）、line-height 1.67em、padding 4px、圆形被
                // 拉成椭圆（搜索视图因无 `#results ul li span` 后代规则而不受
                // 影响——树视图专属回退）。
                const m = await page.evaluate(() => {
                    const fg = getComputedStyle(document.body).color;
                    return [...document.querySelectorAll('#tree .dead-indicator')].map(el => {
                        const cs = getComputedStyle(el);
                        return { color: cs.color, isFg: cs.color === fg,
                                 lineHeight: cs.lineHeight,
                                 padL: cs.paddingLeft, padR: cs.paddingRight,
                                 w: cs.width, h: cs.height };
                    });
                });
                // 树中所有 dead ×（含 seed 经 refreshOverlays 注入的真实标记）
                // 都必须钉住白/居中/圆形盒。
                const ok = m.length >= 1 && m.every(d =>
                    !d.isFg && parseFloat(d.lineHeight) <= 15 &&
                    d.padL === '0px' && d.padR === '0px' &&
                    parseFloat(d.w) >= 9 && parseFloat(d.h) >= 9);
                check(ok, `${tag} tree ${m.length} .dead-indicator pinned (white, centered, 10px circle)` +
                    (ok ? '' : ` — got ${JSON.stringify(m)}`));
            }
        }
        if (view.id === 'search') {
            await page.evaluate(() => document.getElementById('search-input').focus());
            await page.type('#search-input', 'example.com', { delay: 5 });
            await sleep(500); // 触发模糊搜索，让 #results 有行
        }

        for (const paneSel of view.panes) {
            const m = await measurePane(page, paneSel);
            if (m.missing) { check(false, `${tag} ${view.id} ${paneSel} missing`); continue; }
            if (m.hidden) { check(false, `${tag} ${view.id} ${paneSel} hidden (no layout)`); continue; }
            check(m.overflowX === 'hidden',
                `${tag} ${view.id} ${paneSel} overflow-x:hidden (computed ${m.overflowX})`);
            if (view.id !== 'tree') {
                check(!m.xOverflow,
                    `${tag} ${view.id} ${paneSel} no hidden overflow (scrollW=${m.scrollW} clientW=${m.clientW})`);
            }
            if (m.vOverflow) console.log(`      · ${view.id} ${paneSel} vertical scroll active (${m.scrollH}/${m.clientH}px) — expected`);
        }
    }

    if (includePalette) {
        // 命令面板：长命令描述 / URL 在 max-width:480px 内不得横向溢出。
        const btnVisible = await page.evaluate(() => {
            const b = document.getElementById('tool-btn');
            if (!b) return 'missing';
            return getComputedStyle(b).display;
        });
        const opened = await clickJS(page, '#tool-btn');
        await sleep(500);
        const m = await measurePane(page, '#palette-results');
        if (btnVisible !== 'none') check(opened, `${tag} palette opened via #tool-btn (btn display ${btnVisible})`);
        if (m.missing) check(false, `${tag} palette #palette-results missing`);
        else if (m.hidden) check(false, `${tag} palette #palette-results hidden`);
        else {
            check(m.overflowX === 'hidden', `${tag} palette #palette-results overflow-x:hidden (computed ${m.overflowX})`);
            check(!m.xOverflow, `${tag} palette #palette-results no hidden overflow (scrollW=${m.scrollW} clientW=${m.clientW})`);
        }
        await clickJS(page, '#palette-close'); // CDP 键盘不达 capture-phase，不能 Esc
        await sleep(200);
    }
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    const pageErrors = [];
    const watch = (page, tag) => {
        page.on('pageerror', e => pageErrors.push(`${tag} pageerror: ${e.message}`));
        page.on('console', m => { if (m.type() === 'error') pageErrors.push(`${tag} console: ${m.text()}`); });
    };

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const worker = await swTarget.worker();
    const extId = new URL(swTarget.url()).hostname;

    // ── Seed ──────────────────────────────────────────────────────────────
    const seedPage = await browser.newPage();
    watch(seedPage, 'seed');
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
    await sleep(600);
    await seedPage.evaluate(SEED);
    await sleep(600);
    await seedPage.close();

    const setPrefs = prefs => worker.evaluate(({ keys, values }) =>
        chrome.storage.local.set(Object.fromEntries(keys.map((k, i) => [k, values[i]]))),
        { keys: PREF_KEYS, values: prefs });

    const basePrefs = ({ width, height, autoResize }) => [
        width, height, autoResize ? '1' : 'false', '', '', '', '1', '1', '1'
    ];

    const openMeasurePage = async (tag, { width, height, browserZoom, screen, autoResize }) => {
        const page = await browser.newPage();
        watch(page, tag);
        await page.evaluateOnNewDocument(makeInitScript(browserZoom, screen.w, screen.h));
        await page.setViewport({ width, height: 800 }); // viewport 宽 = body 宽（#container 陷阱）
        await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'networkidle0' });
        await sleep(1200);
        return page;
    };

    // 每页开头校验 stub 生效：getZoom 回读 + screen 遮蔽 + body overflow hidden。
    const verifyStubs = async (page, tag, { browserZoom, screen }) => {
        const stub = await page.evaluate(z => new Promise(r =>
            chrome.tabs.getZoom(x => r({ zoom: x, sh: screen.height, w: screen.width, sy: screen.screenY }))), browserZoom);
        check(Math.abs(stub.zoom - browserZoom) < 1e-9,
            `${tag} stub chrome.tabs.getZoom → ${browserZoom} (readback ${stub.zoom})`);
        check(stub.sh === screen.h && stub.w === screen.w,
            `${tag} stub screen ${screen.w}×${screen.h} (readback ${stub.w}×${stub.sh})`);
        const bodyOverflow = await page.evaluate(() => {
            const cs = getComputedStyle(document.body);
            return { x: cs.overflowX, y: cs.overflowY };
        });
        check(bodyOverflow.x === 'hidden' && bodyOverflow.y === 'hidden',
            `${tag} body overflow hidden (computed ${bodyOverflow.x}/${bodyOverflow.y})`);
    };

    const extZooms = (z) => [90, 100, 110, 120, 130, 140, 150];
    const SMOKE = process.env.VBM_SB_SMOKE === '1';

    // ── Phase A 横向（内部 zoom × 宽）──────────────────────────────────────
    SECTION('Phase A — 内部 zoom × popup 宽（浏览器 zoom=1.0, 屏 1920×1080）');
    const aWidths = SMOKE ? [320] : [320, 640];
    for (const width of aWidths) {
        const tag = `A:w${width}`;
        await setPrefs(basePrefs({ width, height: 600, autoResize: true }));
        const page = await openMeasurePage(tag, { width, height: 600, browserZoom: 1.0, screen: { w: 1920, h: 1080 }, autoResize: true });
        await verifyStubs(page, tag, { browserZoom: 1.0, screen: { w: 1920, h: 1080 } });
        for (const z of extZooms()) {
            await page.evaluate(z => { document.body.dataset.zoom = z; }, z);
            await sleep(150);
            console.log(`\n--- ${tag} extZoom ${z}% ---`);
            await sweepViews(page, `${tag} z${z}`, { includePalette: SMOKE ? true : (width === 320 && z === 100) });
        }
        await page.close();
    }

    // ── Phase B 纵向（浏览器 zoom × 屏幕）──────────────────────────────────
    // 初始 popupHeight 设小（250），resetHeight 才能按内容长大并撞上 maxH 夹子；
    // 哨兵在 sweepViews（树已展开、body 已被 resetHeight 撑到 maxH）之后检查，
    // 证明 getZoom stub 真正驱动了高度数学（stub 未生效时 body 会超 maxH）。
    SECTION('Phase B — 浏览器 zoom × 屏幕（内部 zoom=100, 宽 320）');
    const bScreens = SMOKE ? [{ w: 1920, h: 1080 }] : [
        { w: 1366, h: 768 }, { w: 1920, h: 1080 }, { w: 3840, h: 2160 }, { w: 1024, h: 600 }];
    for (const browserZoom of SMOKE ? [1.0] : [1.0, 1.5]) {
        for (const screen of bScreens) {
            const tag = `B:bz${browserZoom}:${screen.w}x${screen.h}`;
            await setPrefs(basePrefs({ width: 320, height: 250, autoResize: true }));
            const page = await openMeasurePage(tag, { width: 320, height: 250, browserZoom, screen, autoResize: true });
            await verifyStubs(page, tag, { browserZoom, screen });
            await sweepViews(page, tag, { includePalette: false });
            const bodyH = await page.evaluate(() => document.body.offsetHeight);
            const maxH = Math.min(screen.h - 50, (600 / browserZoom) - 1);
            check(bodyH <= maxH + 2, `${tag} body height ≤ maxH ${maxH} after tree expansion (got ${bodyH}) — getZoom stub drives the clamp`);
            check(bodyH >= 200, `${tag} body height ≥ minH 200 (got ${bodyH})`);
            await page.close();
        }
    }

    // ── Phase C 固定小高度（autoResizePopup=false 钉住高度）─────────────────
    SECTION('Phase C — 固定小高度（autoResizePopup=false, 内部 zoom 100/150）');
    for (const height of SMOKE ? [300] : [300, 450]) {
        for (const width of SMOKE ? [320] : [320, 640]) {
            const tag = `C:h${height}:w${width}`;
            await setPrefs(basePrefs({ width, height, autoResize: false }));
            const page = await openMeasurePage(tag, { width, height, browserZoom: 1.0, screen: { w: 1920, h: 1080 }, autoResize: false });
            await verifyStubs(page, tag, { browserZoom: 1.0, screen: { w: 1920, h: 1080 } });
            const fixedH = await page.evaluate(() => document.body.offsetHeight);
            check(Math.abs(fixedH - height) <= 3, `${tag} body height pinned to ${height} (got ${fixedH})`);
            for (const z of SMOKE ? [100] : [100, 150]) {
                await page.evaluate(z => { document.body.dataset.zoom = z; }, z);
                await sleep(150);
                console.log(`\n--- ${tag} extZoom ${z}% ---`);
                await sweepViews(page, `${tag} z${z}`, { includePalette: false });
            }
            await page.close();
        }
    }

    console.log(`\n═══ 结果：${FAILURES.length ? 'FAIL (' + FAILURES.length + ')' : 'ALL PASS'} — ${checks} 断言 ═══`);
    if (FAILURES.length) console.log('失败项：\n' + FAILURES.map(f => '  - ' + f).join('\n'));
    if (pageErrors.length) console.log('页面错误：\n' + pageErrors.map(e => '  - ' + e).join('\n'));
    await browser.close();
    process.exit(FAILURES.length || pageErrors.length ? 1 : 0);
})().catch(e => {
    console.error('SCROLLBARS FAIL:', e.stack || e.message);
    process.exit(2);
});
