// vBookmarks IME-Enter probe v2 — 顶部搜索栏 #search-input 中文输入法回车
// 误开首条结果诊断。把整块代码粘贴到 popup 的 DevTools Console 运行。
//
// 现象: 顶部搜索栏用中文输入法输入, 按 Enter 上屏候选时, 扩展把这次
// IME 的 Enter 当成“打开第一条搜索结果”, 并且打开的那个 URL 可能 DNS 错误。
//
// 相比 v1, 本版增强:
//   * 记录每次事件时 #results 的 top 10 结果（标题/URL/书签 id/是否文件夹）,
//     用于建立“输入文本 → 首条结果 → 被打开的 URL”的对应关系
//   * 观察 #results 的 DOM 变更（RESULTS-MUTATION）和 input 渲染后的快照
//     （SEARCH-AFTER-INPUT）
//   * 包装 chrome.tabs.update / chrome.tabs.create, 记录扩展实际让浏览器
//     打开的 URL（TABS-UPDATE-CALL / TABS-CREATE-CALL）—— DNS 错误的直接证据
//   * 日志持久化到 chrome.storage.session（不写 local, 不碰用户设置）,
//     popup 关闭后重开, 再粘贴一次本脚本即可把上次日志读回来
//
// 操作步骤:
//   1. 打开 popup, 右键 → 检查, 打开 DevTools, 切 Console。
//   2. 粘贴本文件整块代码, 回车。看到 [VBM] ime-enter probe installed。
//      （若提示载入上次日志, 先运行 __vbmImeProbeReport() 看旧日志,
//        再运行 __vbmImeProbeClear() 清空后重新开始。）
//   3. 点回顶部搜索栏, 用中文输入法输入一个能出候选的拼音, 按 Enter 上屏。
//   4. popup 关闭后（若被关闭）重新打开 popup, 再次粘贴本脚本, 回车;
//      然后运行 __vbmImeProbeReport(), 把控制台里所有 [VBM] 日志发回。
//   5. 也可运行 __vbmImeProbeStop() 恢复被包装的原生函数。
//
// 注意: 只记录诊断信息; 存储用 chrome.storage.session, 浏览器重启即失效。
(() => {
    if (window.__vbmImeEnterProbeInstalled)
        return console.log('[VBM] ime-enter probe already installed');

    const t0 = performance.now();
    const STORE_KEY = 'vbm_ime_probe_log_v2';
    const MAX_EVENTS = 300;

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

    const input = document.getElementById('search-input');
    const results = document.getElementById('results');
    if (!input) {
        console.warn('[VBM] #search-input not found — is this the popup page?');
        return;
    }

    const elId = el => {
        if (!el)
            return null;
        if (el.id)
            return `#${el.id}`;
        const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
        return `${el.tagName}${cls ? '.' + cls : ''}`;
    };

    // 结果区快照: 总数 + 前 n 条 {id, 标题, URL, 是否文件夹, class}
    const resultsSnap = (n = 10) => {
        if (!results)
            return null;
        const lis = Array.from(results.querySelectorAll('ul > li'));
        const top = lis.slice(0, n).map(li => {
            const a = li.querySelector('a');
            const textEl = a ? (a.querySelector('i') || a) : li.querySelector('i');
            return {
                id: (li.dataset && li.dataset.nodeId) || li.id || null,
                text: (textEl && textEl.textContent || '').trim().slice(0, 60),
                href: a ? a.getAttribute('href') : null,
                isFolder: a ? a.classList.contains('link-folder') : false,
                cls: a ? a.className : null
            };
        });
        return { count: lis.length, top };
    };

    const firstResultSnap = () => {
        const snap = resultsSnap(1);
        return snap ? snap.top[0] || null : null;
    };

    let searchAfterEnter = 'unknown';
    try {
        searchAfterEnter = window.store && typeof window.store.get === 'function'
            ? !!window.store.get('searchAfterEnter')
            : 'store-missing';
    } catch (err) {
        searchAfterEnter = 'store-error:' + err.message;
    }

    const keyInfo = e => ({
        phase: e.eventPhase === 1 ? 'capture' : (e.eventPhase === 2 ? 'target' : 'bubble'),
        target: elId(e.target),
        active: elId(document.activeElement),
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        isComposing: e.isComposing,
        repeat: e.repeat,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
        inputValue: input.value,
        selStart: input.selectionStart,
        selEnd: input.selectionEnd,
        first: firstResultSnap(),
        defaultPrevented: e.defaultPrevented,
        isTrusted: e.isTrusted
    });

    // ── 1. 搜索栏键盘/输入法事件（capture, 先于扩展自身监听器）──────────
    const keyEvents = ['keydown', 'keyup', 'keypress'];
    for (const type of keyEvents) {
        input.addEventListener(type, e => {
            // 重点只把 keydown 的 Enter 标记为 SEARCH-ENTER-KEY, 避免 keyup
            // 的 Enter 污染 report 里的 imeEnterCount 统计。
            const isEnterDown = e.key === 'Enter' && type === 'keydown';
            rec(isEnterDown ? 'SEARCH-ENTER-KEY' : 'SEARCH-KEY', {
                type,
                ...keyInfo(e),
                // keydown Enter 时把前 10 条结果一并抓下来, 建立“输入 → 首条结果”关系
                ...(isEnterDown ? { top: resultsSnap(10) } : {})
            });
        }, true);
    }

    // bubble 阶段再记录一次 Enter: 扩展自己的 keydown 监听器注册在 input 上
    // (bubble 阶段, 早于本脚本), 所以这里看到的 activeElement 能直接证明
    // search.js 的 Enter 分支是否执行了(item.focus() 会把焦点移到第一条结果)。
    input.addEventListener('keydown', e => {
        if (e.key !== 'Enter')
            return;
        rec('SEARCH-ENTER-KEY-BUBBLE', {
            type: 'keydown',
            phase: e.eventPhase === 1 ? 'capture' : (e.eventPhase === 2 ? 'target' : 'bubble'),
            active: elId(document.activeElement),
            target: elId(e.target),
            defaultPrevented: e.defaultPrevented,
            isComposing: e.isComposing,
            inputValue: input.value,
            first: firstResultSnap()
        });
    });

    for (const type of ['compositionstart', 'compositionupdate', 'compositionend', 'input']) {
        input.addEventListener(type, e => {
            rec('SEARCH-COMP', {
                type,
                isComposing: e.isComposing,
                data: e.data,
                inputType: e.inputType,
                inputValue: input.value,
                first: firstResultSnap(),
                isTrusted: e.isTrusted
            });
        }, true);
    }

    // input 的 bubble 阶段 + setTimeout(0): 等 search.js 的 input 监听器
    // (注册更早, 同 phase 先执行) 渲染完结果后再抓快照。注意 setTimeout 0
    // 抓的是本轮渲染后的 DOM, 正是“上屏后结果变成了什么”。
    input.addEventListener('input', () => {
        setTimeout(() => {
            rec('SEARCH-AFTER-INPUT', {
                inputValue: input.value,
                active: elId(document.activeElement),
                top: resultsSnap(10)
            });
        }, 0);
    });

    // ── 2. 结果区 DOM 变更观察: 每次重渲染记录新首条 + 前 10 ─────────────
    if (results) {
        const mo = new MutationObserver(() => {
            rec('RESULTS-MUTATION', {
                active: elId(document.activeElement),
                inputValue: input.value,
                first: firstResultSnap(),
                top: resultsSnap(10)
            });
        });
        mo.observe(results, { childList: true, subtree: true });
        window.__vbmImeProbeMutationObserver = mo;
    }

    // ── 3. 结果区 click: 真实点击与合成 click 都会走到这里 ─────────────────
    document.addEventListener('click', e => {
        const a = e.target && e.target.closest ? e.target.closest('#results a') : null;
        if (!a)
            return;
        rec('RESULTS-CLICK', {
            phase: e.eventPhase === 1 ? 'capture' : (e.eventPhase === 2 ? 'target' : 'bubble'),
            target: elId(e.target),
            anchorHref: a.getAttribute('href'),
            anchorCls: a.className,
            text: ((a.querySelector('i') || a).textContent || '').trim().slice(0, 60),
            rowId: a.parentNode ? (a.parentNode.dataset ? a.parentNode.dataset.nodeId : a.parentNode.id) : null,
            isFolder: a.classList.contains('link-folder'),
            isConnected: a.isConnected,
            isTrusted: e.isTrusted,
            defaultPrevented: e.defaultPrevented,
            button: e.button,
            ctrl: e.ctrlKey,
            meta: e.metaKey,
            shift: e.shiftKey
        });
    }, true);

    // ── 4. dispatchEvent 级钩子: 抓到“元素已脱离 DOM”的合成 click ────────
    // search.js 的 Enter 分支: item.focus(); setTimeout(() => item.dispatchEvent(
    // new MouseEvent('click', ...)), 30)。如果 30ms 内 IME 上屏导致结果重渲染,
    // 该 item 已 isConnected=false, click 不会冒泡到 document, 只能在这里看。
    const origDispatch = EventTarget.prototype.dispatchEvent;
    const patchedDispatch = function(e) {
        try {
            if (e && e.type === 'click') {
                const t = this;
                const isAnchor = t && t.nodeType === 1 && t.tagName === 'A'
                    && typeof t.classList === 'object' && t.classList
                    && (t.classList.contains('tree-item-link') || t.classList.contains('link-folder'));
                if (isAnchor || (t && t.nodeType === 1 && t.isConnected === false)) {
                    rec('SYNTH-CLICK-DISPATCH', {
                        tag: t.tagName,
                        id: t.id || null,
                        cls: typeof t.className === 'string' ? t.className : null,
                        href: t.getAttribute ? t.getAttribute('href') : null,
                        text: (t.textContent || '').trim().slice(0, 60),
                        rowId: t.parentNode && t.parentNode.dataset ? t.parentNode.dataset.nodeId : null,
                        isConnected: t.isConnected,
                        inResults: !!(t.closest && t.closest('#results')),
                        isTrusted: e.isTrusted,
                        defaultPrevented: e.defaultPrevented
                    });
                }
            }
        } catch (_) { /* 诊断钩子绝不影响原逻辑 */ }
        return origDispatch.call(this, e);
    };
    EventTarget.prototype.dispatchEvent = patchedDispatch;

    // ── 5. 包装 chrome.tabs.update/create: 记录扩展实际要浏览器打开的 URL ──
    // 普通左键打开走 chrome.tabs.update(tabId, {url}), Ctrl/Cmd/中键/设置成
    // 新标签页时走 chrome.tabs.create({url})。包一层只记录 url/active, 原调用
    // 原样透传, 不改变扩展行为。
    const origTabsUpdate = chrome.tabs.update;
    const origTabsCreate = chrome.tabs.create;
    let tabsUpdatePatched = false;
    let tabsCreatePatched = false;
    try {
        chrome.tabs.update = function(tabId, props, cb) {
            try {
                rec('TABS-UPDATE-CALL', {
                    tabId,
                    url: props && props.url,
                    active: props && props.active,
                    inputValue: input.value
                });
            } catch (_) { /* 记录失败不影响调用 */ }
            return origTabsUpdate.call(chrome.tabs, tabId, props, cb);
        };
        tabsUpdatePatched = true;
    } catch (_) { /* 只读属性则跳过 */ }
    try {
        chrome.tabs.create = function(props, cb) {
            try {
                rec('TABS-CREATE-CALL', {
                    url: props && props.url,
                    active: props && props.active,
                    inputValue: input.value
                });
            } catch (_) { /* 记录失败不影响调用 */ }
            return origTabsCreate.call(chrome.tabs, props, cb);
        };
        tabsCreatePatched = true;
    } catch (_) { /* 只读属性则跳过 */ }

    // ── 6. 环境快照 ────────────────────────────────────────────────────────
    const ua = navigator.userAgent;
    const browser = (ua.match(/Edg\/([\d.]+)/) || [])[1]
        ? 'Microsoft Edge'
        : (ua.match(/Chrome\/([\d.]+)/) || [])[1] ? 'Google Chrome' : navigator.userAgent;
    const chromeVersion = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || '?';
    rec('ENV', {
        browser,
        chromeVersion,
        os: (ua.match(/Windows NT [\d.]+/) || [])[0]
            || (ua.match(/Mac OS X [\d_]+/) || [])[0] || ua,
        searchAfterEnter,
        hasResults: !!results,
        inputValue: input.value,
        first: firstResultSnap(),
        top: resultsSnap(10),
        rtl: document.body.classList.contains('rtl'),
        tabsUpdatePatched,
        tabsCreatePatched,
        storageArea: storage === chrome.storage.session ? 'session' : 'local'
    });

    // ── 7. 汇总/清理 API ─────────────────────────────────────────────────────
    window.__vbmImeProbeReport = () => {
        console.log('[VBM] --- IME-Enter probe report ---');
        console.log(`[VBM] total events: ${evLog.length}`);
        for (const e of evLog) {
            const flag = (e.tag === 'SEARCH-ENTER-KEY' && e.isComposing)
                ? ' <<<< IME Enter while composing'
                : (e.tag === 'SYNTH-CLICK-DISPATCH' ? ' <<<< synthetic click' : '');
            console.log(`[VBM] ${(e.t / 1000).toFixed(3)}s ${e.tag}${flag} ${JSON.stringify(e)}`);
        }
        return {
            total: evLog.length,
            imeEnterCount: evLog.filter(e => e.tag === 'SEARCH-ENTER-KEY' && e.isComposing).length,
            syntheticClicks: evLog.filter(e => e.tag === 'SYNTH-CLICK-DISPATCH').length,
            tabUpdates: evLog.filter(e => e.tag === 'TABS-UPDATE-CALL'),
            tabCreates: evLog.filter(e => e.tag === 'TABS-CREATE-CALL'),
            events: evLog
        };
    };

    window.__vbmImeProbeClear = () => {
        evLog = [];
        if (storage) {
            try { storage.remove(STORE_KEY); } catch (_) {}
        }
        console.log('[VBM] ime-enter probe log cleared');
    };

    window.__vbmImeProbeStop = () => {
        EventTarget.prototype.dispatchEvent = origDispatch;
        if (tabsUpdatePatched) chrome.tabs.update = origTabsUpdate;
        if (tabsCreatePatched) chrome.tabs.create = origTabsCreate;
        if (window.__vbmImeProbeMutationObserver) {
            window.__vbmImeProbeMutationObserver.disconnect();
            delete window.__vbmImeProbeMutationObserver;
        }
        console.log('[VBM] ime-enter probe stopped (dispatchEvent / chrome.tabs.* / MutationObserver restored)');
    };

    // ── 8. 载入上次持久化日志（如有）────────────────────────────────────────
    if (storage && storage.get) {
        try {
            storage.get(STORE_KEY, data => {
                const prev = data && data[STORE_KEY];
                if (Array.isArray(prev) && prev.length) {
                    evLog = prev.concat(evLog).slice(-MAX_EVENTS);
                    console.log(`[VBM] 已载入上次持久化的 ${prev.length} 条日志（当前共 ${evLog.length} 条）。`);
                    console.log('[VBM] 运行 __vbmImeProbeReport() 可查看完整序列; 重新做实验前建议先 __vbmImeProbeClear()。');
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

    window.__vbmImeEnterProbeInstalled = true;
    console.log('[VBM] ime-enter probe installed');
    console.log('[VBM] 现在: 1) 点回搜索栏, 2) 用中文输入法输入拼音, 3) 按 Enter 上屏。');
    console.log('[VBM] 若 popup 被关闭: 重开 popup → 再粘贴本脚本 → 运行 __vbmImeProbeReport()。');
    console.log('[VBM] 完成后可运行 __vbmImeProbeStop() 移除所有钩子。');
})();
