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
        const treeBody = ruleBody(neatCss, '#results ul li a:hover,\n#tree ul li a:hover,\n#tree ul li span:hover');
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
            '.dupes-toolbar select:focus-visible',
            '.dead-toolbar button:focus-visible',
            '.stats-toolbar button:focus-visible',
            '#search-history-clear:focus-visible'
        ])
            expect(neatCss, `${sel} is part of the focus-ring rule`).toContain(sel);
    });
});
