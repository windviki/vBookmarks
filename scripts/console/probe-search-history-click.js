// vBookmarks 搜索历史“点击失效/无悬浮按钮”探针 —— 粘贴到 popup 的 DevTools
// Console 运行, 在真实环境采集数据供离线分析。
//
// 症状: 搜索视图上方“最近的搜索”列表行点击无反应(不重搜)、行尾 × 悬浮不
// 出现、清除全部无效; 但右键菜单的清除全部生效。
//
// 操作步骤:
//   1. 打开 popup → 在 popup 内右键 → 检查, 打开 DevTools 的 Console。
//   2. 粘贴本文件整块代码并回车, 看到 [VBM] hist-click probe installed。
//   3. 切到搜索视图, 确保上方有历史行。
//   4. 依次做这些动作(每类 2-3 次):
//        a. 鼠标悬停一行约 1 秒(看 × 是否浮现);
//        b. 左键点击一行的文字部分;
//        c. 左键点击一行的行尾空白/× 位置;
//        d. 点击右上角“清除”文字按钮;
//        e. 用 ↑↓ 把焦点移到历史行按 Enter。
//   5. 运行 __vbmHistReport() 并把控制台全部 [VBM] 输出一起反馈。
//   6. popup 关闭重开后重新粘贴一次即可(上次日志自动载回)。
//   7. __vbmHistStop() 卸载。
//
// 只记录诊断信息(坐标/元素链/命中测试栈/DOM 变更计数), 不改任何业务状态;
// 日志存 chrome.storage.session, 浏览器重启即失效。
(() => {
    if (window.__vbmHistClickProbeInstalled)
        return console.log('[VBM] hist-click probe already installed');
    window.__vbmHistClickProbeInstalled = true;

    const KEY = 'vbm_hist_click_probe_v1';
    const MAX = 300;
    let evLog = [];
    let clicks = 0;

    const describe = el => {
        if (!el) return 'null';
        if (el === document || el === window) return String(el.nodeName || 'window');
        const cls = (el.className && typeof el.className === 'string') ? el.className.split(' ').slice(0, 2).join('.') : '';
        const id = el.id ? `#${el.id}` : '';
        return `${el.nodeName.toLowerCase()}${id}${cls ? '.' + cls : ''}`;
    };
    const chain = (el, n = 6) => {
        const out = [];
        for (let i = 0; el && i < n; i++, el = el.parentElement)
            out.push(describe(el));
        return out.join(' < ');
    };
    const log = (type, data) => {
        const rec = Object.assign({ t: Math.round(performance.now()), type }, data);
        evLog.push(rec);
        if (evLog.length > MAX)
            evLog.shift();
        console.log('[VBM]', type, JSON.stringify(data));
    };

    // --- restore previous session log ------------------------------------
    try {
        const store = chrome.storage.session || chrome.storage.local;
        store.get(KEY, v => {
            if (v && v[KEY] && Array.isArray(v[KEY].evLog) && v[KEY].evLog.length) {
                evLog = v[KEY].evLog;
                console.log(`[VBM] restored ${evLog.length} events from the previous popup open`);
            }
        });
        const flush = () => {
            try {
                store.set({ [KEY]: { evLog, clicks, ts: Date.now() } }, () => {});
            } catch (e) { /* best effort */ }
        };
        setInterval(flush, 2000);
        window.addEventListener('pagehide', flush);
    } catch (e) { /* storage unavailable — in-memory only */ }

    const area = () => document.getElementById('search-history-area');
    const inArea = el => !!(el && el.closest && el.closest('#search-history-area'));

    // --- DOM churn counter (render storms / innerHTML swaps) --------------
    const obs = new MutationObserver(muts => {
        const a = area();
        if (!a) return;
        let mine = 0;
        for (const m of muts)
            if (a.contains(m.target))
                mine++;
        if (mine)
            log('AREA-MUTATION', {
                mine,
                rows: a.querySelectorAll('a[data-q]').length,
                sample: muts.slice(0, 2).map(m => ({ target: describe(m.target), added: m.addedNodes.length, removed: m.removedNodes.length }))
            });
    });
    const startObs = () => {
        const a = area();
        if (a) obs.observe(a, { childList: true, subtree: true });
        else setTimeout(startObs, 500);
    };
    startObs();

    // --- resize storm counter ---------------------------------------------
    let resizeCount = 0;
    let resizeWindow = 0;
    window.addEventListener('resize', () => {
        const now = performance.now();
        resizeCount++;
        if (now - resizeWindow > 3000) {
            if (resizeCount > 1)
                log('RESIZE-STORM', { count: resizeCount, overMs: Math.round(now - resizeWindow) });
            resizeCount = 0;
            resizeWindow = now;
        } else if (resizeCount === 1)
            resizeWindow = resizeWindow || now;
    });

    // --- pointer / click capture ------------------------------------------
    const stack = (x, y) => {
        try {
            return (document.elementsFromPoint(x, y) || []).slice(0, 5).map(describe);
        } catch (e) {
            return ['<unavailable>'];
        }
    };
    const onPointer = e => {
        const a = area();
        if (!a) return;
        const r = a.getBoundingClientRect();
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside && !inArea(e.target)) return;
        const target = e.target;
        log('POINTER-' + e.type.toUpperCase(), {
            x: Math.round(e.clientX), y: Math.round(e.clientY),
            insideArea: inside,
            target: describe(target),
            chain: chain(target, 5),
            hitStack: stack(e.clientX, e.clientY),
            hitAreaRow: !!(target.closest && target.closest('#search-history-area a[data-q]')),
            // does the click coordinate land on the row the target belongs to?
            elementAtPoint: describe(document.elementFromPoint(e.clientX, e.clientY))
        });
        if (e.type === 'click' && (inside || inArea(target))) {
            clicks++;
            const before = document.getElementById('search-input').value;
            const rowsBefore = document.querySelectorAll('#search-history-area a[data-q]').length;
            setTimeout(() => {
                const after = document.getElementById('search-input').value;
                const rowsAfter = document.querySelectorAll('#search-history-area a[data-q]').length;
                log('CLICK-EFFECT', {
                    before, after,
                    rowsBefore, rowsAfter,
                    worked: after !== before || rowsAfter !== rowsBefore,
                    activeElement: describe(document.activeElement)
                });
            }, 400);
        }
    };
    for (const t of ['pointerdown', 'mousedown', 'click'])
        document.addEventListener(t, onPointer, true);

    // --- hover tracking ----------------------------------------------------
    let hoverTimer = null;
    document.addEventListener('pointerover', e => {
        const a = area();
        if (!a || !inArea(e.target)) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
            const li = e.target.closest && e.target.closest('li.search-history-row');
            if (!li) return;
            const btn = li.querySelector('.search-history-remove');
            if (!btn) return;
            log('HOVER-STATE', {
                rowHover: li.matches(':hover'),
                anyRowHover: !!document.querySelector('li.search-history-row:hover'),
                removeVisibility: getComputedStyle(btn).visibility,
                removeDisplay: getComputedStyle(btn).display,
                removeRect: (() => { const r = btn.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
                hoverStack: stack(r0(btn).x, r0(btn).y)
            });
            function r0(el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }
        }, 700);
    }, true);

    // --- environment snapshot ---------------------------------------------
    log('ENV', {
        ua: navigator.userAgent.slice(0, 120),
        dpr: devicePixelRatio,
        viewport: `${innerWidth}x${innerHeight}`,
        bodyClass: document.body.className,
        dataZoom: document.body.dataset.zoom || '',
        panel: document.body.classList.contains('panel-mode'),
        areaRect: (() => { const a = area(); if (!a) return null; const r = a.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), h: Math.round(r.height), overflow: getComputedStyle(a).overflow, maxHeight: getComputedStyle(a).maxHeight }; })(),
        resultsOverflow: (() => { const el = document.getElementById('results'); return el ? getComputedStyle(el).overflow : null; })(),
        histRows: document.querySelectorAll('#search-history-area a[data-q]').length
    });

    // --- report ------------------------------------------------------------
    window.__vbmHistReport = () => {
        const summary = {
            events: evLog.length,
            clicks,
            clicksWithEffect: evLog.filter(e => e.type === 'CLICK-EFFECT' && e.worked).length,
            clicksWithoutEffect: evLog.filter(e => e.type === 'CLICK-EFFECT' && !e.worked).length,
            areaMutations: evLog.filter(e => e.type === 'AREA-MUTATION').length,
            resizeStorms: evLog.filter(e => e.type === 'RESIZE-STORM').length,
            hoverBlocked: evLog.filter(e => e.type === 'HOVER-STATE' && e.removeVisibility !== 'visible').length
        };
        console.log('[VBM] ===== hist-click report =====');
        console.log(JSON.stringify(summary, null, 2));
        console.log('[VBM] full log follows — copy everything from [VBM] hist-click probe installed down to here');
        for (const e of evLog.slice(-80))
            console.log('[VBM]', e.type, JSON.stringify(e));
        return summary;
    };
    window.__vbmHistStop = () => {
        obs.disconnect();
        for (const t of ['pointerdown', 'mousedown', 'click'])
            document.removeEventListener(t, onPointer, true);
        window.__vbmHistClickProbeInstalled = false;
        console.log('[VBM] hist-click probe removed');
    };
    console.log('[VBM] hist-click probe installed — reproduce the dead clicks, then run __vbmHistReport()');
})();
