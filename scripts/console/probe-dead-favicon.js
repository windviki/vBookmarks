/**
 * 诊断死链视图 favicon 重建行为 — 在浏览器 console 中运行
 *
 * 背景: 死链视图的 render() 会用 $list.innerHTML 整段重建所有行和 favicon
 * <img>。修复前，activate() 每次进入都无条件 render()（甚至两次），于是
 * 几千个已加载好的 _favicon 图标被销毁重建 → 重新进入时整列图标先空白、
 * 再逐个异步回填 = 闪烁。修复后，未发生变化的再次进入不再 render()，DOM
 * （含已加载图标）原样保留。
 *
 * 用法:
 *   1. 打开 popup / 侧边栏，右键 → 检查（打开该页面的 devtools）。
 *   2. 切到“死链”视图。
 *   3. 在 console 粘贴运行本脚本。
 *   4. 切到别的视图再切回“死链”（若修复生效，这一步应触发零重建）。
 *   5. 约 8 秒后自动输出汇总；也可手动调用 window.__deadFaviconReport()。
 */
(function () {
    const list = document.getElementById('dead-list');
    if (!list) {
        console.warn('[probe] 未找到 #dead-list —— 请先切到“死链”视图再运行。');
        return;
    }

    const now = () => performance.now();
    const started = now();

    // --- 事件计数 -------------------------------------------------------------
    let faviconInserts = 0;   // 新插入的 _favicon <img>（每次整段重建都会大量出现）
    let enrichedInserts = 0;  // 新插入的 .favicon-enriched <img>（补全替换结果）
    let bulkInserts = 0;      // 顶层整段重建次数（一次 innerHTML 换掉整个 <ul>）
    const insertTimes = new WeakMap(); // 每个 _favicon img → 插入时刻
    const swapGaps = [];      // _favicon img 从插入到被替换的耗时 (ms)

    // 对单个 <img> 计数（顶层的直接新增节点，或从 innerHTML 新增的子树里下钻）
    const countImg = n => {
        if (/\/_favicon\//.test(n.src || '')) {
            insertTimes.set(n, now());
            faviconInserts++;
        } else if (n.classList && n.classList.contains('favicon-enriched')) {
            enrichedInserts++;
        }
    };

    // --- 观察 #dead-list 的子节点增删 ------------------------------------------
    // 关键: innerHTML 整段替换时，MutationObserver 的 addedNodes 是顶层 <ul>
    // （不是几千个 <img>），必须对新增子树下钻 querySelectorAll('img') 才能
    // 数到整段重建进来的图标——旧版 probe 漏了这一步，把重建误报成 0。
    const mo = new MutationObserver(muts => {
        for (const m of muts) {
            m.addedNodes.forEach(n => {
                if (n.nodeType !== 1)
                    return;
                if (n.tagName === 'IMG') {
                    countImg(n);
                } else if (n.tagName === 'UL') {
                    bulkInserts++;
                    if (n.querySelectorAll)
                        n.querySelectorAll('img').forEach(countImg);
                }
            });
            m.removedNodes.forEach(n => {
                if (n.nodeType !== 1)
                    return;
                if (n.tagName === 'IMG' && insertTimes.has(n)) {
                    swapGaps.push(now() - insertTimes.get(n));
                    insertTimes.delete(n);
                }
            });
        }
    });
    mo.observe(list, { childList: true, subtree: true });

    // --- 快照 -------------------------------------------------------------------
    const snapshot = () => {
        const rows = list.querySelectorAll('li.vbm-row').length;
        const fav = list.querySelectorAll('img[src*="/_favicon/"]').length;
        const enriched = list.querySelectorAll('img.favicon-enriched').length;
        const svg = list.querySelectorAll('.favicon-container svg.vbm-icon-doc').length;
        return { rows, faviconImg: fav, enrichedImg: enriched, defaultSvg: svg };
    };

    const report = () => {
        mo.disconnect();
        const snap = snapshot();
        const n = swapGaps.length;
        const avg = n ? (swapGaps.reduce((a, b) => a + b, 0) / n).toFixed(1) : '—';
        const max = n ? Math.max(...swapGaps).toFixed(1) : '—';
        console.log('\n===== 死链 favicon probe 汇总 =====');
        console.log(`观察时长: ${(now() - started).toFixed(0)} ms`);
        console.log(`结果行数: ${snap.rows}`);
        console.log(`顶层整段重建次数(bulk <ul> 替换): ${bulkInserts}`);
        console.log(`重建插入的 _favicon <img>: ${faviconInserts}`);
        console.log(`补全为 .favicon-enriched <img>: ${enrichedInserts}`);
        console.log(`_favicon 插入→被替换 耗时(ms): avg=${avg} max=${max} n=${n}`);
        console.log('最终快照:', snap);
        console.log('\n判读:');
        console.log('  1. 修复后：未变更地切走再切回 → bulkInserts 与 faviconInserts 都应保持 0');
        console.log('     （完全不再重建，图标全程原样保留，无闪烁）。');
        console.log('  2. 若 bulkInserts/faviconInserts 仍有数千 → 说明 activate 仍在整段重建，修复未生效。');
        console.log('  3. 真正发生数据变化（扫描结束/标记变化/书签增删）时，重建是预期行为。');
    };

    window.__deadFaviconReport = report;
    console.log('[probe] 观察器已安装。现在切到别的视图，再切回“死链”触发一次重建检查。');
    console.log('[probe] 当前快照:', snapshot());
    console.log('[probe] 8 秒后自动汇总，或手动调用 window.__deadFaviconReport()。');
    setTimeout(report, 8000);
})();
