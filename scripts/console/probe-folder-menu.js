// vBookmarks folder context-menu probe — issue #48
//
// 目标: 复现"右键文件夹不再弹出菜单"的问题, 收集逐层证据 —— 右键事件是否
// 触发、行识别是否正确、菜单是否显示、是否被立即关闭、有无 JS 报错、有无
// 自定义样式干扰。粘贴到 popup 的 DevTools 控制台即可, 日志统一打 [VBM] 前缀。
// 本脚本与 scripts/console/probe-resize.js 同套路: 自包含 IIFE + 防重复安装 +
// 结构化 rec() 日志 + window.__vbm* 导出函数。
//
// ─────────────────────────────────────────────────────────────────────
// 操作步骤 / OPERATION STEPS
// ─────────────────────────────────────────────────────────────────────
// 1. 打开 popup (点击工具栏图标)。
// 2. 在 popup 内空白处右键 → "检查 / Inspect" 打开 DevTools (建议把 DevTools
//    拖成独立窗口或停靠到 popup 之外, 避免遮挡右键菜单)。
// 3. 切到 Console 标签, 把本文件整个代码块粘贴进去, 回车。
//    应看到一行: [VBM] folder-menu probe installed
//    随后紧跟一行 [VBM] ENV (浏览器/OS/Chrome 版本/扩展版本/是否侧边栏/DPR/
//    窗口尺寸) —— 这一行请在反馈时一并贴出, 用来定位是哪个环境。
// 4. 依次执行下面的右键场景, 每次右键后稍等约 1 秒再做下一个:
//      a) 树视图里一个普通文件夹 (含子书签)   ← 最关键
//      b) 根文件夹 (书签栏 / 其他书签)
//      c) 搜索一下后, 右键"搜索结果"里的文件夹
//      d) 右键文件夹的"标题文字", 而非行的空白处
//      e) 空文件夹
//      f) 如果平时用侧边栏模式, 在那里也试一次
// 5. 观察控制台 [VBM] 日志 —— 每次右键应依次出现:
//      MOUSE2-DOWN → MOUSE2-UP → CTXMENU → MENU-SNAP ×3 (0ms/16ms/200ms)
//    - 若只有 MOUSE2-DOWN/UP 而没有 CTXMENU: 说明 contextmenu 事件根本没进
//      到页面 (系统/其它扩展/手势层面), 与 vBookmarks 无关。
//    - 若 CTXMENU 里 verdict 是 NO-LI: 右键目标不落在任何列表行内, 菜单被
//      有意跳过 (需看右键到了哪个元素)。
//    - 若 MENU-SNAP 显示 folder-context-menu 的 visible=true / opacity=1 却
//      看不到菜单: 是渲染/层级问题 (z-index/裁剪/背景), 不是触发问题。
//    - 若 MENU-SNAP 显示先 opacity=1 随后 0 (0ms 可见 → 200ms 隐藏): 菜单被
//      打开后立即被某个 CLICK / FOCUSIN / SCROLL 关闭 —— 看对应那行日志。
//    - MOUSE2-UP 里的 macHoldRisk=true (且 elapsedMs≥500): Mac 上按住右键超过
//      500ms 再松开, 扩展的"长按关菜单"机制会把刚打开的菜单关掉 —— 换个
//      快速点击右键的姿势即可验证。
// 6. 若菜单确实没出现, 执行: __vbmEnvInfo()  和  __vbmMenuReport()
//    把两个函数的输出 + 全部 [VBM] 日志 一起贴回 issue #48。
// 7. 附一张右键瞬间的整屏截图 (尤其是有没有一闪而过的菜单)。
//
// 说明: 探测脚本只在控制台里记录与诊断, 不改动任何设置/数据, 重开 popup 即失效。
//
// EN (short): 1) open the popup, 2) Inspect it (detach DevTools so it doesn't
// cover the popup), 3) paste the whole block into the Console and press Enter
// — you should see "[VBM] folder-menu probe installed", 4) right-click a folder
// (regular, root, a search-result folder, the folder's title text, an empty
// folder, and in side-panel mode), 5) watch the [VBM] lines — a healthy
// right-click logs MOUSE2-DOWN → MOUSE2-UP → CTXMENU → MENU-SNAP ×3, 6) if no
// menu appears run __vbmMenuReport() and paste its output plus every [VBM] line
// back into issue #48, 7) add a screenshot of the right-click moment.
(() => {
    if (window.__vbmMenuProbeInstalled)
        return console.log('[VBM] folder-menu probe already installed');
    window.__vbmMenuProbeInstalled = true;

    const t0 = performance.now();
    const rec = (tag, data) => {
        console.log(`[VBM] ${((performance.now() - t0) / 1000).toFixed(2)}s ${tag} ${JSON.stringify(data)}`);
    };

    // ── 浏览器/系统元信息 ──────────────────────────────────────────────
    // 探测口径与 src/neat.js 完全一致: 扩展的菜单/rtl 逻辑正是用这些值分支的。
    // os —— context-menu.js 的 macCloseContextMenu (长按右键 500ms 后松开会关菜单)
    //        只对 'mac' 生效; rtl —— 菜单定位用 pageX 反方向计算。
    const os = (navigator.platform.toLowerCase().match(/mac|win|linux/i) || ['other'])[0];
    const chromeVersion = (() => {
        const matches = navigator.userAgent.match(/chrome\/([\d]+)\.([\d]+)\.([\d]+)\.([\d]+)/i);
        if (!matches)
            return null;
        const keys = ['major', 'minor', 'build', 'patch'];
        const v = {};
        keys.forEach((k, i) => { v[k] = parseInt(matches[i + 1], 10); });
        return v;
    })();
    const rtl = getComputedStyle(document.body).direction === 'rtl';

    // All seven right-click menus; null-tolerant for pages that lack some.
    const MENU_IDS = [
        'bookmark-context-menu', 'folder-context-menu', 'separator-context-menu',
        'search-history-context-menu', 'hist-row-context-menu',
        'dupes-group-context-menu', 'palette-cmd-context-menu'
    ];

    // Menu-state snapshot: inline style, computed style, geometry, item count.
    const snapMenus = () => {
        const out = {};
        for (const id of MENU_IDS) {
            const el = document.getElementById(id);
            if (!el) { out[id] = 'ABSENT'; continue; }
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            out[id] = {
                style: {
                    left: el.style.left, top: el.style.top,
                    opacity: el.style.opacity, transform: el.style.transform
                },
                computed: {
                    display: cs.display, visibility: cs.visibility,
                    position: cs.position, zIndex: cs.zIndex,
                    opacity: cs.opacity, pointerEvents: cs.pointerEvents
                },
                visible: cs.display !== 'none' && cs.visibility !== 'hidden' &&
                    +cs.opacity > 0 && r.width > 0 && r.height > 0,
                rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                items: el.querySelectorAll('.menu-item').length,
                offsetParent: el.offsetParent ? (el.offsetParent.id || el.offsetParent.tagName) : null
            };
        }
        return out;
    };

    const activeRow = () => {
        const a = document.querySelector('.active');
        return a ? { tag: a.tagName, id: a.id, cls: a.className } : null;
    };

    // Which menu the right-click SHOULD resolve to, mirroring context-menu.js:
    // walk up to the nearest a/span, then require an enclosing <li>.
    const classify = e => {
        let el = e.target;
        if (el.tagName === 'HR') el = el.parentNode;
        if (el.tagName !== 'A' && el.tagName !== 'SPAN' && el.closest) {
            const nearest = el.closest('a, span');
            if (nearest) el = nearest;
        }
        const li = el.closest ? el.closest('li') : null;
        const spec = {
            target: { tag: e.target.tagName, id: e.target.id || '', cls: e.target.className },
            resolved: {
                tag: el.tagName,
                id: el.id || '',
                cls: typeof el.className === 'string' ? el.className : ''
            },
            inLi: !!li,
            li: li ? {
                id: li.id || '',
                cls: li.className,
                nodeId: (li.dataset && li.dataset.nodeId) || '',
                parentId: li.dataset ? (li.dataset.parentid || '') : ''
            } : null
        };
        if (!li) { spec.verdict = 'NO-LI — 无菜单 (事件上溯未落在任何列表行内)'; return spec; }
        if (el.tagName === 'A' && el.classList.contains('link-folder'))
            spec.verdict = 'FOLDER (搜索结果/命令面板 A.link-folder)';
        else if (el.tagName === 'SPAN' && li.id && li.id.indexOf('neat-tree-item-') === 0)
            spec.verdict = 'FOLDER (树视图 SPAN 行)' + (spec.li.parentId === '0' ? ' — 根文件夹' : '');
        else if (el.tagName === 'SPAN')
            spec.verdict = 'SPAN (非树行, context-menu.js 仍走 folder 分支)';
        else
            spec.verdict = 'bookmark/other';
        return spec;
    };

    // ---- right-click sequence capture (per gesture) ----
    let seq = { t: 0, id: '', hasDown: false, hasMenu: false };
    window.addEventListener('mousedown', e => {
        if (e.button !== 2) return;
        seq = { t: performance.now(), id: (performance.now() % 1e6).toFixed(0), hasDown: true, hasMenu: false };
        rec('MOUSE2-DOWN', { seq: seq.id, ...classify(e) });
    }, true);
    window.addEventListener('mouseup', e => {
        if (e.button !== 2 || !seq.hasDown) return;
        const elapsed = performance.now() - seq.t;
        // Mac 长按右键: context-menu.js 在 contextmenu 后 500ms 置 macCloseContextMenu,
        // 若用户在 500ms 后才松开右键, mouseup 会把刚打开的菜单立即关掉 —— 表现为
        // "右键没反应"。elapsed 用于判断是否命中这条路径。
        rec('MOUSE2-UP', {
            seq: seq.id,
            elapsedMs: Math.round(elapsed),
            macHoldRisk: os === 'mac' && elapsed >= 500
        });
    }, true);
    // Capture-phase: record BEFORE the extension's body handler runs.
    window.addEventListener('contextmenu', e => {
        seq.hasMenu = true;
        rec('CTXMENU', { seq: seq.id, ...classify(e) });
        // Snapshot the menu state AFTER the handler has had its turn: 0ms
        // (end of this event dispatch), ~1 frame, and 200ms later — a menu
        // that opens then gets dismissed shows up as visible→hidden across
        // these three.
        [0, 16, 200].forEach(ms => setTimeout(() => {
            rec('MENU-SNAP', { seq: seq.id, ms, active: activeRow(), menus: snapMenus() });
        }, ms));
    }, true);
    // Bubble-phase: runs AFTER the extension's body handler, so a CTXMENU
    // here (plus the 0ms snapshot) proves the handler executed without
    // stopping propagation.
    window.addEventListener('contextmenu', () => rec('CTXMENU-BUBBLE', { seq: seq.id }));

    // clearMenu triggers — a menu that opens then instantly vanishes is
    // usually one of these firing right after the right-click.
    window.addEventListener('click', e =>
        rec('CLICK', { seq: seq.id, tag: e.target.tagName, cls: e.target.className }), true);
    window.addEventListener('scroll', () => rec('SCROLL', { seq: seq.id }), true);
    window.addEventListener('focusin', e =>
        rec('FOCUSIN', { seq: seq.id, tag: e.target.tagName, id: e.target.id || '' }), true);

    // ---- JS error capture ----
    window.addEventListener('error', e =>
        rec('JS-ERROR', { message: e.message, file: e.filename, line: e.lineno, col: e.colno }));
    window.addEventListener('unhandledrejection', e =>
        rec('JS-REJECTION', { reason: String((e.reason && e.reason.message) || e.reason) }));

    // ── 环境/元信息导出 ────────────────────────────────────────────────
    // 收集扩展版本 + 扩展自身口径的 os/chromeVersion/rtl + UA 结构化 hints
    // (userAgentData, 高熵项 best-effort, 失败不阻断) + 窗口/触屏信息。
    window.__vbmEnvInfo = async () => {
        const info = {
            manifestVersion: chrome.runtime.getManifest().version,
            os, rtl, chromeVersion,
            panelMode: document.body.classList.contains('panel-mode'),
            url: location.href,
            ua: navigator.userAgent,
            platform: navigator.platform,
            maxTouchPoints: navigator.maxTouchPoints,
            dpr: window.devicePixelRatio,
            size: { w: window.innerWidth, h: window.innerHeight }
        };
        try {
            if (navigator.userAgentData) {
                info.uaData = {
                    brands: navigator.userAgentData.brands,
                    mobile: navigator.userAgentData.mobile,
                    platform: navigator.userAgentData.platform
                };
                // 高熵项 (平台版本/架构/设备型号) 可能受限或被浏览器门控, 绝不阻断。
                const he = await navigator.userAgentData
                    .getHighEntropyValues(['platformVersion', 'architecture', 'model', 'uaFullVersion'])
                    .catch(() => ({}));
                info.uaHighEntropy = he || {};
            }
        } catch (err) {
            info.uaData = 'unavailable: ' + err.message;
        }
        console.log('[VBM] ENV-INFO ' + JSON.stringify(info, null, 2));
        return info;
    };

    // ---- 完整报告: 环境 + 自定义样式 + 菜单/行现状 ----
    window.__vbmMenuReport = async () => {
        const env = await window.__vbmEnvInfo();
        const userStyleEls = Array.from(document.querySelectorAll('body > style')).map(s => ({
            len: s.textContent.length,
            head: s.textContent.slice(0, 80)
        }));
        const report = {
            env,
            userStyleEls, // 自定义样式 (选项页 Custom styles) — 空数组 = 没设置
            counts: {
                treeFolders: document.querySelectorAll('#tree .tree-item-span').length,
                resultFolders: document.querySelectorAll('#results .link-folder').length,
                menusInstalled: MENU_IDS.filter(id => document.getElementById(id)).length
            },
            menus: snapMenus(),
            active: activeRow()
        };
        console.log('[VBM] MENU-REPORT ' + JSON.stringify(report, null, 2));
        return report;
    };

    // 安装即打一份基础环境记录, 即使报告者不跑 __vbmMenuReport 也能定位到
    // 浏览器/系统/版本上下文。
    rec('ENV', {
        manifestVersion: chrome.runtime.getManifest().version,
        os, rtl, chromeVersion,
        panelMode: document.body.classList.contains('panel-mode'),
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        dpr: window.devicePixelRatio,
        size: { w: window.innerWidth, h: window.innerHeight }
    });

    console.log('[VBM] folder-menu probe installed — right-click a folder and watch the [VBM] lines; on failure run __vbmEnvInfo() / __vbmMenuReport() and paste everything back');
})();
