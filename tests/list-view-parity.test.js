import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Item 7b — list-view parity contract: the search results, recent, dupes,
// dead and stats lists share the tree's row chrome (hover background, the
// selected fg/bg on active/focus, the focus ring), the dupes group head is a
// first-class focusable row with the same states, and every toolbar control
// of the list views exposes a visible keyboard focus. jsdom has no layout,
// so the contract is pinned as CSS text assertions.

const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');

const ruleBody = (css, selector) => {
    const i = css.indexOf(selector);
    expect(i, `rule for ${selector} exists`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
};

describe('list-view hover/selected parity (item 7b)', () => {
    it('every list view container shares the pane chrome', () => {
        const body = ruleBody(
            neatCss,
            '#staging-list,\n#tabgroups-list,\n#dupes-list,\n#dead-list,\n#stats-list {');
        expect(body).toContain('overflow: auto');
        expect(body).toContain('background-color: var(--vbm-bg)');
    });

    it('every list view rows get the tree hover background', () => {
        const body = ruleBody(
            neatCss,
            '#staging-list ul li a:hover,\n#tabgroups-list ul li a:hover,\n#dupes-list ul li a:hover,\n#dead-list ul li a:hover,\n#stats-list ul li a:hover');
        expect(body).toContain('background-color: var(--vbm-bg-hover)');
        // …and the tree/search panes carry the same rule
        const treeBody = ruleBody(neatCss, '#results ul li a:hover,\n#tree ul li a:hover,\n#tree ul li > span:hover');
        expect(treeBody).toContain('background-color: var(--vbm-bg-hover)');
    });

    it('every list view rows get the tree selected colors on active/focus', () => {
        expect(neatCss).toContain('#tabgroups-list ul li a:active,');
        expect(neatCss).toContain('#tabgroups-list ul li a.active,');
        expect(neatCss).toContain('#stats-list ul li a:active,');
        expect(neatCss).toContain('#stats-list ul li a.active,');
        // the focus-ring rule (the selected-colors group also ends with
        // `#stats-list ul li a:focus {`, so anchor on the full ring selector)
        const body = ruleBody(
            neatCss,
            '#staging-list ul li a:focus,\n#tabgroups-list ul li a:focus,\n#dupes-list ul li a:focus,\n#dead-list ul li a:focus,\n#stats-list ul li a:focus {');
        expect(body).toContain('outline: 2px solid var(--vbm-focus-ring)');
    });

    it('the stats list rows get the same 16px rhythm and pointer-events guard', () => {
        expect(neatCss).toContain('#stats-list ul li a::before');
        expect(neatCss).toContain('#stats-list ul li a *');
    });

    it('the dupes group head is a first-class row: hover + selected focus + ring', () => {
        const hover = ruleBody(neatCss, '.dupes-group .group-head:hover');
        expect(hover).toContain('background-color: var(--vbm-bg-hover)');
        const focus = ruleBody(neatCss, '.dupes-group .group-head:focus');
        expect(focus).toContain('color: var(--vbm-fg-selected)');
        expect(focus).toContain('background-color: var(--vbm-bg-selected)');
        expect(focus).toContain('outline: 2px solid var(--vbm-focus-ring)');
    });

    it('search-history rows focus like tree rows (selected colors + ring)', () => {
        const body = ruleBody(neatCss, '.search-history-row a:focus');
        expect(body).toContain('color: var(--vbm-fg-selected)');
        expect(body).toContain('background-color: var(--vbm-bg-selected)');
        expect(body).toContain('outline: 2px solid var(--vbm-focus-ring)');
    });

    it('every list-view toolbar control exposes a visible keyboard focus', () => {
        const body = ruleBody(
            neatCss,
            '.row-btn:focus-visible,\n.dupes-toolbar button:focus-visible,');
        expect(body).toContain('outline: 2px solid var(--vbm-focus-ring)');
        for (const sel of [
            '.dead-proxy-strip button:focus-visible',
            '.dead-toolbar button:focus-visible',
            '.stats-toolbar button:focus-visible',
            '#search-history-clear:focus-visible'
        ])
            expect(neatCss, `${sel} is part of the focus-ring rule`).toContain(sel);
    });

    it('row-button reveal follows hover + keyboard focus, never mouse focus (4.1.0)', () => {
        // A mouse click on a row button used to pin the whole strip open via
        // :focus-within — the unclicked siblings stayed visible until focus
        // moved elsewhere. The reveal now keys on :focus-visible only, which
        // mouse clicks never trigger (Chrome's heuristic).
        expect(neatCss).toContain('.vbm-row:hover .row-btn,');
        expect(neatCss).toContain('.vbm-row:has(:focus-visible) .row-btn {');
        expect(neatCss).not.toContain('.vbm-row:focus-within .row-btn');
    });
});

describe('v4.1 visual consistency: 左侧留白 + 删除类操作红色语义', () => {
    // 去重视图的组头/成员行用 8px padding-inline-start 提供左缘留白
    // （该设计系统的通用内联槽），避免 chevron / keeper-radio 贴容器左缘。
    it('dupes 组头与成员行共享左侧 8px 留白', () => {
        expect(ruleBody(neatCss, '.dupes-group .group-head {'))
            .toContain('padding-inline-start: 8px');
        expect(ruleBody(neatCss, '#dupes-list ul li.dupes-member {'))
            .toContain('padding-inline-start: 8px');
    });

    // 选择模式复选框同样离开左缘：死链侧在选中态行上加同值内边距，去重侧
    // 复用组头内边距——两个视图的复选框左缘对齐。
    it('死链/去重选择模式复选框不贴左缘', () => {
        expect(ruleBody(neatCss, '#dead-list ul.selecting li.vbm-row {'))
            .toContain('padding-inline-start: 8px');
    });

    // 信息删除类操作统一 danger 语义（主题由 danger/danger-fg token 差异化）：
    // 主删除动作用红色填充，次要删除用红色文字。
    it('去重全部应用/应用所选为红色填充主按钮', () => {
        for (const sel of ['.dupes-toolbar .dupes-apply-all {',
            '.dupes-toolbar .dupes-apply-selected {']) {
            const body = ruleBody(neatCss, sel);
            expect(body).toContain('background: var(--vbm-danger)');
            expect(body).toContain('color: var(--vbm-danger-fg)');
        }
    });

    it('搜索清除全部/死链代理移除为红色文字', () => {
        expect(ruleBody(neatCss, '#search-history-clear {'))
            .toContain('color: var(--vbm-danger)');
        expect(ruleBody(neatCss, '.dead-proxy-strip button.dead-proxy-remove {'))
            .toContain('color: var(--vbm-danger)');
    });

    it('搜索历史行内删除按钮同样染红（与清除全部同一待遇）', () => {
        expect(ruleBody(neatCss, '#search-history-area .row-btn.search-history-remove {'))
            .toContain('color: var(--vbm-danger)');
        expect(ruleBody(neatCss, '#search-history-area .row-btn.search-history-remove:hover {'))
            .toContain('color-mix(in srgb, var(--vbm-danger) 12%, transparent)');
    });

    it('右键菜单所有删除/清除语义项都读作 danger 红', () => {
        for (const id of ['#bookmark-delete', '#folder-delete', '#remove-separator',
            '#search-history-menu-remove', '#search-history-menu-clear',
            '#dupes-group-clean', '#palette-cmd-delete'])
            expect(neatCss).toContain(`menu[type=context] ${id}`);
        expect(ruleBody(neatCss, 'menu[type=context] #bookmark-delete,'))
            .toContain('color: var(--vbm-danger)');
    });

    it('红色文字删除按钮统一 danger 淡色 hover', () => {
        for (const sel of ['.dead-toolbar .dead-delete-all:hover,',
            '.dead-toolbar .dead-delete-selected:hover {',
            '.stats-toolbar .stats-clear:hover {'])
            expect(ruleBody(neatCss, sel))
                .toContain('color-mix(in srgb, var(--vbm-danger) 12%, transparent)');
    });
});

describe('v4.1 visual consistency: 死链视图焦点环 + 选择模式同轴', () => {
    it('开始扫描药丸的键盘环是 :focus-visible,鼠标点击不显环 (B6)', () => {
        expect(neatCss).toContain('#dead-list ul li.dead-start:focus-visible {');
        expect(neatCss).not.toContain('#dead-list ul li.dead-start:focus {');
    });

    it('死链选择模式抑制锚点 16px 引导槽,与去重选择态同轴 (B7)', () => {
        expect(ruleBody(neatCss, '#dead-list ul.selecting li.vbm-row > a::before {'))
            .toContain('content: none');
    });
});

describe('v4.1 visual consistency: 双行行图标→文本间隙', () => {
    // 超宽/面板模式下 .row-sub 显示为第二行，图标与双行文本块的间隙从树视图
    // 单行的 4px 加宽到 8px。用 :has(.row-sub) 精确命中真正的双行行，所有
    // 双行视图（最近/搜索/死链/去重/统计）共享同一规则；单行行保持 4px。
    it('宽容器下双行行把图标间隙加宽到 8px', () => {
        expect(neatCss).toContain(
            '.vbm-row:has(.row-sub) .tree-item-link .favicon-container {\n' +
            '        width: 22px;\n' +
            '        margin-inline-end: 8px;');
    });

    it('panel 模式有等价的双行行间隙规则', () => {
        expect(neatCss).toContain(
            'body.panel-mode .vbm-row:has(.row-sub) .tree-item-link .favicon-container {\n' +
            '    width: 22px;\n' +
            '    margin-inline-end: 8px;');
    });

    // 双行行 icon 16→18px、槽 20→22px（保持 2px 边距比例），适配两行行高。
    it('双行行图标放大到 18px 适配两行高度', () => {
        expect(neatCss).toContain(
            '    .vbm-row:has(.row-sub) .tree-item-link .favicon-container img,\n' +
            '    .vbm-row:has(.row-sub) .tree-item-link .favicon-container svg {\n' +
            '        width: 18px;\n' +
            '        height: 18px;');
        expect(neatCss).toContain(
            'body.panel-mode .vbm-row:has(.row-sub) .tree-item-link .favicon-container img,\n' +
            'body.panel-mode .vbm-row:has(.row-sub) .tree-item-link .favicon-container svg {\n' +
            '    width: 18px;\n' +
            '    height: 18px;');
    });

    // 搜索行同样是 li.vbm-row > a.tree-item-link 结构，但基础图标槽规则
    // `#results ul li a .favicon-container`（1,1,3）恒胜上面的裸类双行规则
    // （0,3,0）——搜索视图需要同规格的 ID 级提权版本，否则双行行仍吃
    // 16px/4px 的单行规格。
    it('搜索视图（#results）双行行有 ID 级提权规则', () => {
        expect(neatCss).toContain(
            '#results ul li.vbm-row:has(.row-sub) a.tree-item-link .favicon-container {\n' +
            '        width: 22px;\n' +
            '        margin-inline-end: 8px;');
        expect(neatCss).toContain(
            '#results ul li.vbm-row:has(.row-sub) a.tree-item-link .favicon-container img,\n' +
            '    #results ul li.vbm-row:has(.row-sub) a.tree-item-link .favicon-container svg {\n' +
            '        width: 18px;\n' +
            '        height: 18px;');
        expect(neatCss).toContain(
            'body.panel-mode #results ul li.vbm-row:has(.row-sub) a.tree-item-link .favicon-container {\n' +
            '    width: 22px;\n' +
            '    margin-inline-end: 8px;');
        expect(neatCss).toContain(
            'body.panel-mode #results ul li.vbm-row:has(.row-sub) a.tree-item-link .favicon-container img,\n' +
            'body.panel-mode #results ul li.vbm-row:has(.row-sub) a.tree-item-link .favicon-container svg {\n' +
            '    width: 18px;\n' +
            '    height: 18px;');
    });
});

describe('v4.1 visual consistency: 死链开始扫描药丸 CTA + favicon 反色', () => {
    it('开始扫描按钮是 accent 填充药丸（非整行大块文字）', () => {
        const body = ruleBody(neatCss, '#dead-list ul li.dead-start {');
        expect(body).toContain('width: fit-content');
        expect(body).toContain('background: var(--vbm-accent)');
        expect(body).toContain('color: var(--vbm-accent-fg)');
        expect(body).toContain('border-radius: 999px');
    });

    it('favicon 反色类由 CSS 提供保色相的明度翻转滤镜', () => {
        const body = ruleBody(neatCss, '.favicon-contrast-invert {');
        expect(body).toContain('filter: invert(1) hue-rotate(180deg)');
    });
});

describe('velvet staging: 行尾按钮停靠对齐(死链/stats 配方)', () => {
    it('staging 行是 flex 行且锚点占满剩余宽度——行尾星标/移出在单双行形态下都贴右', () => {
        const li = ruleBody(neatCss, '#staging-list ul li.vbm-row {');
        expect(li).toContain('display: flex');
        expect(li).toContain('align-items: center');
        const a = ruleBody(neatCss, '#staging-list ul li.vbm-row > a.tree-item-link {');
        expect(a).toContain('flex: 1 1 auto');
        expect(a).toContain('min-width: 0');
        expect(a).toContain('margin-inline-end: 4px');
    });

    it('选择模式的复选框配方与死链/去重共享(左缘 8px 槽 + 复选框抑制引导槽)', () => {
        const box = ruleBody(neatCss, '#staging-list ul.selecting li.vbm-row::before,');
        expect(box).toContain('width: 14px');
        expect(box).toContain('margin-inline-end: 6px');
        const pad = ruleBody(neatCss, '#staging-list ul.selecting li.vbm-row,');
        expect(pad).toContain('padding-inline-start: 8px');
        expect(pad).toContain('padding-inline-end: 4px');
    });

    it('状态图标的切换只动 color(dur-1 渐变,无位移)', () => {
        const body = ruleBody(neatCss, '.vbm-row .staging-star,');
        expect(body).toContain('transition: color .12s ease-out');
    });
});
