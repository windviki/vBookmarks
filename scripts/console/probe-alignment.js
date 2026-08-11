/**
 * 诊断书签弹出窗口对齐 — 在浏览器 console 中运行
 * 测量每行: twisty/箭头中心、图标中心、文本左边缘 距 popup 左边距
 *
 * 用法: 打开 popup, 在 devtools console 中粘贴运行
 */
(function() {
    const rows = document.querySelectorAll('#tree ul li a.tree-item-link, #tree ul li span.tree-item-span');
    const results = [];

    rows.forEach((row, index) => {
        const rect = row.getBoundingClientRect();
        const popupLeft = 0; // body margin=0, padding=0 → popup client area left = 0

        // Compute style
        const cs = getComputedStyle(row);
        const paddingLeft = parseFloat(cs.paddingLeft) || 0;

        // Determine row type
        const isFolder = row.tagName === 'SPAN';
        const isBookmark = !isFolder;
        const isSeparator = row.classList.contains('separator-row');

        const title = row.querySelector('i')?.textContent?.trim()?.substring(0, 30) || '(no title)';
        const level = row.closest('li')?.getAttribute('level') || '?';
        const inlinePad = row.style.getPropertyValue('-webkit-padding-start') || row.style.paddingLeft || '?';

        // Measure twisty/::before center
        let twistyCenter = null;
        if (isFolder) {
            const twisty = row.querySelector('.twisty');
            if (twisty) {
                const tr = twisty.getBoundingClientRect();
                twistyCenter = tr.left + tr.width / 2 - popupLeft;
            }
        } else if (isBookmark && !isSeparator) {
            // ::before pseudo-element — measure via first child offset
            const beforeStyle = getComputedStyle(row, '::before');
            const beforeWidth = parseFloat(beforeStyle.width) || 0;
            // The ::before starts at the content edge of the flex container
            const contentLeft = rect.left + paddingLeft;
            twistyCenter = contentLeft + beforeWidth / 2 - popupLeft;
        }

        // Measure icon center
        let iconCenter = null;
        const favicon = row.querySelector('.favicon-container');
        if (favicon) {
            const fr = favicon.getBoundingClientRect();
            iconCenter = fr.left + fr.width / 2 - popupLeft;
        }

        // Measure text left edge
        let textLeft = null;
        const iEl = row.querySelector('i');
        if (iEl) {
            const ir = iEl.getBoundingClientRect();
            textLeft = ir.left - popupLeft;
        }

        // Computed styles for debugging
        const gap = cs.gap || cs.columnGap || '?';
        const faviconML = favicon ? (parseFloat(getComputedStyle(favicon).marginLeft) || 0) : null;
        const faviconMR = favicon ? (parseFloat(getComputedStyle(favicon).marginRight) || 0) : null;
        const faviconW = favicon ? (parseFloat(getComputedStyle(favicon).width) || 0) : null;

        results.push({
            index,
            type: isFolder ? 'FOLDER' : (isSeparator ? 'SEP' : 'BOOKMARK'),
            level,
            title,
            inlinePad,
            computedPadLeft: paddingLeft,
            rowLeft: rect.left,
            twistyCenter: twistyCenter?.toFixed(1),
            iconCenter: iconCenter?.toFixed(1),
            textLeft: textLeft?.toFixed(1),
            gap,
            faviconW: faviconW?.toFixed(1),
            faviconML: faviconML?.toFixed(1),
            faviconMR: faviconMR?.toFixed(1),
        });
    });

    // Print table
    console.table(results.map(r => ({
        idx: r.index,
        type: r.type,
        lv: r.level,
        title: r.title,
        'inline-pad': r.inlinePad,
        'comp-padL': r.computedPadLeft,
        'row-left': r.rowLeft,
        'twisty-c': r.twistyCenter,
        'icon-c': r.iconCenter,
        'text-L': r.textLeft,
        gap: r.gap,
        'fav-W': r.faviconW,
        'fav-ML': r.faviconML,
        'fav-MR': r.faviconMR,
    })));

    // Expected values based on neat.css flexbox three-slot model (v4 task-4
    // #2: 24px/level — child icon left lands on the parent's text left):
    // │← -webkit-padding-start(24*level) →│← twisty/::before 16px →│← icon-slot 20px →│← 4px gap →│← i flex:1 →│
    // Expected at level N from popup left edge:
    //   twisty/::before center = 24*N + 8
    //   icon center            = 24*N + 16 + 10 = 24*N + 26
    //   text left              = 24*N + 16 + 20 + 4 = 24*N + 40
    console.log('\n=== ALIGNMENT ANALYSIS ===');
    console.log('Expected model: twisty-c = 24L+8, icon-c = 24L+26, text-L = 24L+40\n');

    // Group by level
    const byLevel = {};
    results.forEach(r => {
        if (!byLevel[r.level]) byLevel[r.level] = [];
        byLevel[r.level].push(r);
    });

    let allAligned = true;
    for (const [lv, rows] of Object.entries(byLevel)) {
        const lvNum = parseInt(lv);
        console.log(`--- Level ${lv} (expected: twisty-c=${24*lvNum+8}, icon-c=${24*lvNum+26}, text-L=${24*lvNum+40}) ---`);
        const folders = rows.filter(r => r.type === 'FOLDER');
        const bookmarks = rows.filter(r => r.type === 'BOOKMARK');

        if (folders.length && bookmarks.length) {
            const fIcon = parseFloat(folders[0].iconCenter);
            const bIcon = parseFloat(bookmarks[0].iconCenter);
            const iconDiff = Math.abs(fIcon - bIcon);
            const iconOk = iconDiff < 0.5;
            console.log(`  Icon centers:  Folder=${fIcon.toFixed(1)}  Bookmark=${bIcon.toFixed(1)}  Diff=${iconDiff.toFixed(1)}px ${iconOk ? '✓' : '✗ MISALIGNED'}`);

            const fText = parseFloat(folders[0].textLeft);
            const bText = parseFloat(bookmarks[0].textLeft);
            const textDiff = Math.abs(fText - bText);
            const textOk = textDiff < 0.5;
            console.log(`  Text left:     Folder=${fText.toFixed(1)}  Bookmark=${bText.toFixed(1)}  Diff=${textDiff.toFixed(1)}px ${textOk ? '✓' : '✗ MISALIGNED'}`);

            if (!iconOk || !textOk) allAligned = false;
        }

        // Check internal consistency
        if (folders.length > 1) {
            const icons = folders.map(r => parseFloat(r.iconCenter));
            const maxDiff = Math.max(...icons) - Math.min(...icons);
            if (maxDiff > 0.5) { console.log(`  ⚠ Folder icon centers vary by ${maxDiff.toFixed(1)}px`); allAligned = false; }
        }
        if (bookmarks.length > 1) {
            const icons = bookmarks.map(r => parseFloat(r.iconCenter));
            const maxDiff = Math.max(...icons) - Math.min(...icons);
            if (maxDiff > 0.5) { console.log(`  ⚠ Bookmark icon centers vary by ${maxDiff.toFixed(1)}px`); allAligned = false; }
        }
    }

    console.log(`\n=== ${allAligned ? '✓ ALL ALIGNED' : '✗ MISALIGNMENT DETECTED'} ===`);

    // v4 task-4 #2: the cross-level contract — a child row's icon LEFT edge
    // lands exactly on its parent folder's TEXT left edge (24px indent step).
    console.log('\n=== CROSS-LEVEL (parent text-left vs child icon-left) ===');
    const sorted = results.slice().sort((a, b) => a.index - b.index);
    for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i], nxt = sorted[i + 1];
        if (cur.type === 'FOLDER' && parseInt(nxt.level) === parseInt(cur.level) + 1
            && cur.textLeft != null && nxt.iconLeft != null) {
            const delta = parseFloat(nxt.iconLeft) - parseFloat(cur.textLeft);
            const ok = Math.abs(delta) < 0.5;
            if (!ok) allAligned = false;
            console.log(`  ${cur.title} (lv${cur.level}) -> ${nxt.title} (lv${nxt.level}): delta=${delta.toFixed(1)}px ${ok ? '✓' : '✗ MISALIGNED'}`);
        }
    }
    console.log(`\n=== ${allAligned ? '✓ ALL ALIGNED' : '✗ MISALIGNMENT DETECTED'} (final) ===`);
    return results;
})();
