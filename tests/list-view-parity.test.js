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
            '#recent-list,\n#dupes-list,\n#dead-list,\n#stats-list {');
        expect(body).toContain('overflow: auto');
        expect(body).toContain('background-color: var(--vbm-bg)');
    });

    it('every list view rows get the tree hover background', () => {
        const body = ruleBody(
            neatCss,
            '#recent-list ul li a:hover,\n#dupes-list ul li a:hover,\n#dead-list ul li a:hover,\n#stats-list ul li a:hover');
        expect(body).toContain('background-color: var(--vbm-bg-hover)');
        // …and the tree/search panes carry the same rule
        const treeBody = ruleBody(neatCss, '#results ul li a:hover,\n#tree ul li a:hover,\n#tree ul li > span:hover');
        expect(treeBody).toContain('background-color: var(--vbm-bg-hover)');
    });

    it('every list view rows get the tree selected colors on active/focus', () => {
        expect(neatCss).toContain('#stats-list ul li a:active,');
        expect(neatCss).toContain('#stats-list ul li a.active,');
        // the focus-ring rule (the selected-colors group also ends with
        // `#stats-list ul li a:focus {`, so anchor on the full ring selector)
        const body = ruleBody(
            neatCss,
            '#recent-list ul li a:focus,\n#dupes-list ul li a:focus,\n#dead-list ul li a:focus,\n#stats-list ul li a:focus {');
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
});

describe('v4.1 visual consistency: 双行行图标→文本间隙', () => {
    // 超宽/面板模式下 .row-sub 显示为第二行，图标与双行文本块的间隙从树视图
    // 单行的 4px 加宽到 8px。用 :has(.row-sub) 精确命中真正的双行行，所有
    // 双行视图（最近/搜索/死链/去重/统计）共享同一规则；单行行保持 4px。
    it('宽容器下双行行把图标间隙加宽到 8px', () => {
        expect(neatCss).toContain(
            '.vbm-row:has(.row-sub) .tree-item-link .favicon-container {\n' +
            '        margin-inline-end: 8px;');
    });

    it('panel 模式有等价的双行行间隙规则', () => {
        expect(neatCss).toContain(
            'body.panel-mode .vbm-row:has(.row-sub) .tree-item-link .favicon-container {\n' +
            '    margin-inline-end: 8px;');
    });
});
