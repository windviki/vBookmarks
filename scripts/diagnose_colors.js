/**
 * 诊断最近添加 vs 树视图文本颜色 — 在浏览器 console 中运行
 * 测量每行实际使用的 computed color 值
 *
 * 用法: 打开 popup, 在 devtools console 中粘贴运行
 */
(function() {
    // 最近添加区域的书签行
    const recentItems = document.querySelectorAll('#recent-list li a.tree-item-link');
    // 树视图区域的书签行
    const treeBookmarks = document.querySelectorAll('#tree > ul li a.tree-item-link');
    // 树视图文件夹行
    const treeFolders = document.querySelectorAll('#tree > ul li span.tree-item-span');

    const measureSection = (label, items) => {
        const samples = [];
        items.forEach((el, i) => {
            if (i >= 5) return; // 前5个即可
            const cs = getComputedStyle(el);
            const iEl = el.querySelector('i');
            const iCs = iEl ? getComputedStyle(iEl) : null;
            const title = iEl?.textContent?.trim()?.substring(0, 30) || '(?)';
            const inheritedColor = cs.color;
            // 转换 rgb(r,g,b) 到 hex 以便比较
            const rgb = inheritedColor.match(/[\d.]+/g);
            let hex = '?';
            if (rgb && rgb.length >= 3) {
                hex = '#' + [rgb[0], rgb[1], rgb[2]].map(x => {
                    const h = parseInt(x).toString(16);
                    return h.length === 1 ? '0' + h : h;
                }).join('');
            }

            samples.push({
                title,
                computedColor: hex,
                colorRaw: inheritedColor,
                iColor: iCs?.color,
                opacity: cs.opacity,
                fontWeight: cs.fontWeight,
                element: el.tagName,
                href: el.getAttribute('href')?.substring(0, 40) || '(none)',
            });
        });
        console.log(`\n--- ${label} (${items.length} rows total, showing first ${samples.length}) ---`);
        console.table(samples);
        return samples;
    };

    const recent = measureSection('RECENTLY ADDED bookmarks', recentItems);
    const tree = measureSection('TREE bookmarks', treeBookmarks);
    const folders = measureSection('TREE folders', treeFolders);

    // Compare
    console.log('\n=== COLOR COMPARISON ===');
    if (recent.length && tree.length) {
        const rColor = recent[0].computedColor;
        const tColor = tree[0].computedColor;
        const rOpacity = recent[0].opacity;
        const tOpacity = tree[0].opacity;
        console.log(`Recent first item:     ${rColor} (opacity: ${rOpacity})`);
        console.log(`Tree first bookmark:   ${tColor} (opacity: ${tOpacity})`);
        if (rColor === tColor && rOpacity === tOpacity) {
            console.log('✓ Colors MATCH exactly');
        } else {
            console.log('✗ Colors DIFFER');
        }
        console.log(`\nDesign token --vbm-fg: ${getComputedStyle(document.body).getPropertyValue('--vbm-fg').trim()}`);
        console.log(`Design token --vbm-muted: ${getComputedStyle(document.body).getPropertyValue('--vbm-muted').trim()}`);
    }

    // Check inheritance chain for first recent item
    if (recentItems.length) {
        console.log('\n=== INHERITANCE CHAIN (first recent item) ===');
        let el = recentItems[0];
        const chain = [];
        while (el) {
            const cs = getComputedStyle(el);
            chain.push({
                tag: el.tagName,
                id: el.id || '-',
                classes: el.className?.substring(0, 60) || '-',
                color: cs.color,
                opacity: cs.opacity,
            });
            el = el.parentElement;
            if (chain.length > 10) break;
        }
        console.table(chain);
    }

    // Check inheritance chain for first tree bookmark
    if (treeBookmarks.length) {
        console.log('\n=== INHERITANCE CHAIN (first tree bookmark) ===');
        let el = treeBookmarks[0];
        const chain = [];
        while (el) {
            const cs = getComputedStyle(el);
            chain.push({
                tag: el.tagName,
                id: el.id || '-',
                classes: el.className?.substring(0, 60) || '-',
                color: cs.color,
                opacity: cs.opacity,
            });
            el = el.parentElement;
            if (chain.length > 10) break;
        }
        console.table(chain);
    }

    // Check highlightUnsynced setting
    console.log('\n=== HIGHLIGHT UNSYNCED CHECK ===');
    const body = document.body;
    const hlEnabled = body.classList.contains('highlight-unsynced');
    const theme = body.dataset.theme || 'light';
    console.log(`highlightUnsynced: ${hlEnabled ? 'ON' : 'OFF'}`);
    console.log(`Theme: ${theme}`);

    if (hlEnabled) {
        const unsynced = document.querySelectorAll('#tree li.unsynced-subtree > a.tree-item-link, #tree li.unsynced-subtree > span.tree-item-span');
        const synced = document.querySelectorAll('#tree li:not(.unsynced-subtree) > a.tree-item-link');
        if (unsynced.length && synced.length) {
            const uCs = getComputedStyle(unsynced[0]);
            const sCs = getComputedStyle(synced[0]);
            console.log(`Unsynced item: color=${uCs.color}, opacity=${uCs.opacity}`);
            console.log(`Synced item:   color=${sCs.color}, opacity=${sCs.opacity}`);
            if (uCs.color !== sCs.color || uCs.opacity !== sCs.opacity) {
                console.log('✓ Visual distinction between synced/unsynced items is active');
            } else {
                console.log('✗ No visual distinction — check CSS rules');
            }
        } else {
            console.log('(no unsynced items in current tree)');
        }
    }

    return { recent, tree, folders };
})();
