// vBookmarks search-history right-click probe — 右键搜索历史行却弹出
// 书签/文件夹菜单的诊断脚本。把整块代码粘贴到 popup 的 DevTools Console 运行。
//
// 背景: 极窄 popup + zoom>100 时, 搜索视图的搜索历史行右键偶尔弹出完整的
// 书签/文件夹菜单, 而不是"重新搜索/移除/清除全部"的历史菜单。根因是
// context-menu.js 的 body contextmenu 处理把 e.target 归一化到行元素时,
// 对 <a> 内部的 <span>/<svg> 子元素先命中了 SPAN 自身, 落进了 SPAN→文件夹
// 菜单分支。本探针记录每次右键的 target 链、命中测试元素、以及右键后实际
// 亮起的菜单, 用来在你机器上复现/验证。
//
// 操作步骤:
//   1. 打开 popup, 在 popup 内右键 → 检查/Inspect 打开 DevTools。
//   2. 切到 Console, 粘贴本文件整块代码, 回车。看到
//      [VBM] search-history-ctx probe installed 即安装成功。
//   3. 切到搜索视图 (点搜索 tab), 确保上方有搜索历史行。
//   4. 对历史行的不同位置各右键几次: 左侧时钟图标、中间查询文字、
//      右侧条数/时间、行尾部空白、以及行右侧的 × 按钮。
//   5. 观察 [VBM] 日志, 重点看 CTXMENU-PRE 的 target.closestA /
//      historyRow 和 CTXMENU-POST 的 menus。若误弹文件夹菜单, menus 里会是
//      folder-context-menu; 正常应只有 search-history-context-menu。
//   6. 反馈时运行 __vbmSearchHistoryCtxReport() 并把控制台所有 [VBM] 日志
//      一起贴出; 若 popup 关闭后重开, 再粘贴一次本脚本即可载回上次日志。
//   7. 完成后可运行 __vbmSearchHistoryCtxStop() 移除监听。
//
// 注意: 只记录诊断信息; 存储用 chrome.storage.session, 浏览器重启即失效。
(() => {
    if (window.__vbmSearchHistoryCtxProbeInstalled)
        return console.log('[VBM] search-history-ctx probe already installed');

    const t0 = performance.now();
    const STORE_KEY = 'vbm_search_history_ctx_probe_v1';
    const MAX_EVENTS = 200;
    let evLog = [];
    let persistReady = false;
    let storage = null;
    try {
        storage = chrome.storage.session || chrome.storage.local;
    } catch (_) {
        storage = chrome.storage.local;
    }

    const persist = () => {
        if (!persistReady || !storage)
            return;
        try {
            storage.set({ [STORE_KEY]: evLog.slice(-MAX_EVENTS) });
        } catch (_) { /* 持久化失败不影响诊断 */ }
    };

    const rec = (tag, data) => {
        const entry = { t: +(performance.now() - t0).toFixed(1), tag, ...data };
        evLog.push(entry);
        if (evLog.length > MAX_EVENTS)
            evLog = evLog.slice(-MAX_EVENTS);
        console.log(`[VBM] ${(entry.t / 1000).toFixed(3)}s ${tag} ${JSON.stringify(data)}`);
        persist();
    };

    const desc = el => {
        if (!el)
            return null;
        const cls = typeof el.className === 'string' ? el.className
            : (el.getAttribute && el.getAttribute('class')) || '';
        const li = el.closest ? el.closest('li') : null;
        const anchor = el.closest ? el.closest('a') : null;
        return {
            tag: el.tagName,
            id: el.id || '',
            cls: String(cls).slice(0, 90),
            q: el.dataset ? (el.dataset.q === undefined ? undefined : el.dataset.q) : undefined,
            liCls: li ? String(li.className).slice(0, 90) : '',
            inHistoryArea: !!(el.closest && el.closest('#search-history-area')),
            inResults: !!(el.closest && el.closest('#results')),
            closestA: anchor ? {
                q: anchor.dataset ? anchor.dataset.q : undefined,
                cls: String(anchor.className).slice(0, 60)
            } : null
        };
    };

    const visibleMenus = () => {
        const found = [];
        document.querySelectorAll('menu[type=context]').forEach(m => {
            if (m.style.opacity === '1') {
                const r = m.getBoundingClientRect();
                found.push({
                    id: m.id,
                    left: Math.round(r.left), top: Math.round(r.top),
                    w: Math.round(r.width), h: Math.round(r.height)
                });
            }
        });
        return found;
    };

    const snap = () => ({
        zoomData: document.body.dataset.zoom || '100',
        zoomStore: window.store && typeof window.store.get === 'function'
            ? (window.store.get('zoom') || '100') : 'store-missing',
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        viewSearchActive: (() => {
            const s = document.getElementById('view-search');
            return !!s && !s.hidden;
        })(),
        historyRows: document.querySelectorAll('#search-history-area li.search-history-row').length,
        resultsRows: document.querySelectorAll('#results li.vbm-row, #results li[data-node-id]').length,
        inputValue: (document.getElementById('search-input') || {}).value || '',
        activeEl: (() => {
            const a = document.querySelector('.active');
            return a ? (a.id || a.tagName + '.' + String(a.className).split(' ')[0]) : null;
        })()
    });

    // ── capture 阶段: 先于扩展自身的 body contextmenu 处理器 ─────────────
    const onPre = e => {
        if (e.type !== 'contextmenu')
            return;
        const efp = document.elementFromPoint(e.clientX, e.clientY);
        rec('CTXMENU-PRE', {
            phase: e.eventPhase === 1 ? 'capture' : (e.eventPhase === 2 ? 'target' : 'bubble'),
            clientX: e.clientX, clientY: e.clientY,
            pageX: e.pageX, pageY: e.pageY,
            button: e.button,
            isTrusted: e.isTrusted,
            defaultPrevented: e.defaultPrevented,
            target: desc(e.target),
            elementFromPoint: desc(efp),
            openMenuBefore: (() => {
                const menus = visibleMenus();
                return menus.length ? menus : null;
            })(),
            snap: snap()
        });
    };

    // ── bubble 阶段: 扩展的 body 处理器已执行完 (它注册在 body 上) ─────
    const onPost = e => {
        if (e.type !== 'contextmenu')
            return;
        rec('CTXMENU-POST', {
            menus: visibleMenus(),
            activeEl: (() => {
                const a = document.querySelector('.active');
                return a ? (a.id || a.tagName + '.' + String(a.className).split(' ')[0]) : null;
            })(),
            defaultPrevented: e.defaultPrevented
        });
    };

    document.addEventListener('contextmenu', onPre, true);
    document.addEventListener('contextmenu', onPost);

    // ── 环境快照 ────────────────────────────────────────────────────────
    const ua = navigator.userAgent;
    const browser = (ua.match(/Edg\/([\d.]+)/) || [])[1]
        ? 'Microsoft Edge'
        : (ua.match(/Chrome\/([\d.]+)/) || [])[1] ? 'Google Chrome' : ua;
    const chromeVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || '?';
    rec('ENV', {
        browser,
        chromeVersion,
        os: (ua.match(/Windows NT [\d.]+/) || [])[0]
            || (ua.match(/Mac OS X [\d_]+/) || [])[0] || ua,
        rtl: getComputedStyle(document.body).direction === 'rtl',
        snap: snap()
    });

    // ── 汇总 / 清理 / 停止 API ───────────────────────────────────────────
    window.__vbmSearchHistoryCtxReport = () => {
        console.log('[VBM] --- search-history-ctx probe report ---');
        console.log(`[VBM] total events: ${evLog.length}`);
        for (const e of evLog) {
            const bad = e.tag === 'CTXMENU-POST' && Array.isArray(e.menus)
                && e.menus.some(m => m.id === 'folder-context-menu' || m.id === 'bookmark-context-menu');
            console.log(`[VBM] ${(e.t / 1000).toFixed(3)}s ${e.tag}${bad ? ' <<<< 非历史菜单!' : ''} ${JSON.stringify(e)}`);
        }
        return {
            total: evLog.length,
            wrongMenus: evLog.filter(e => e.tag === 'CTXMENU-POST'
                && Array.isArray(e.menus)
                && e.menus.some(m => m.id === 'folder-context-menu' || m.id === 'bookmark-context-menu')),
            events: evLog
        };
    };

    window.__vbmSearchHistoryCtxClear = () => {
        evLog = [];
        if (storage) {
            try { storage.remove(STORE_KEY); } catch (_) {}
        }
        console.log('[VBM] search-history-ctx probe log cleared');
    };

    window.__vbmSearchHistoryCtxStop = () => {
        document.removeEventListener('contextmenu', onPre, true);
        document.removeEventListener('contextmenu', onPost);
        console.log('[VBM] search-history-ctx probe stopped');
    };

    // ── 载入上次持久化日志（如有）────────────────────────────────────────
    if (storage && storage.get) {
        try {
            storage.get(STORE_KEY, data => {
                const prev = data && data[STORE_KEY];
                if (Array.isArray(prev) && prev.length) {
                    evLog = prev.concat(evLog).slice(-MAX_EVENTS);
                    console.log(`[VBM] 已载入上次持久化的 ${prev.length} 条日志（当前共 ${evLog.length} 条）。`);
                    console.log('[VBM] 运行 __vbmSearchHistoryCtxReport() 可查看完整序列; 重新做实验前建议先 __vbmSearchHistoryCtxClear()。');
                }
                persistReady = true;
                persist();
            });
        } catch (_) {
            persistReady = true;
        }
    } else {
        persistReady = true;
    }

    window.__vbmSearchHistoryCtxProbeInstalled = true;
    console.log('[VBM] search-history-ctx probe installed');
    console.log('[VBM] 现在: 切到搜索视图, 对历史行的时钟图标/查询文字/条数/时间/空白处各右键几次。');
    console.log('[VBM] 正常: CTXMENU-POST.menus 只有 search-history-context-menu; 异常: 出现 folder-context-menu 或 bookmark-context-menu。');
    console.log('[VBM] 完成后运行 __vbmSearchHistoryCtxReport() 看汇总, 运行 __vbmSearchHistoryCtxStop() 移除监听。');
})();
