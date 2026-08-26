import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Fourth-round popup chrome contracts:
//  - item 1: each view tab is its own inline-size container; the label only
//    appears when the tab itself is ≥112px (icon-only below — never a
//    two-line wrap or a mid-word clip)
//  - item 3: the clear button lives INSIDE the search field (absolute on the
//    trailing edge), so no flex-slot gap remains between field and quick-add
//  - item 6: the dupes group URL uses the UI font, not monospace
// Both pages (popup + sidepanel) must carry the same search-field markup.

const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
const popupHtml = fs.readFileSync(new URL('../pages/popup.html', import.meta.url), 'utf8');
const sidepanelHtml = fs.readFileSync(new URL('../pages/sidepanel.html', import.meta.url), 'utf8');

const ruleBody = (css, selector) => {
    const i = css.indexOf(selector);
    expect(i, `rule for ${selector} exists`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
};

describe('view tab strip responsiveness (fourth-round item 1)', () => {
    it('each tab is an inline-size container that never wraps or overflows', () => {
        const body = ruleBody(neatCss, '.view-tab {');
        expect(body).toContain('container-type: inline-size');
        expect(body).toContain('flex-wrap: nowrap');
        expect(body).toContain('white-space: nowrap');
        expect(body).toContain('overflow: hidden');
    });

    it('the label is icon-only by default and joins at ≥112px tab width', () => {
        const label = ruleBody(neatCss, '.view-tab .tab-label {');
        expect(label).toContain('display: none');
        expect(label).toContain('min-width: 0');
        const query = neatCss.match(/@container \(min-width: 112px\) \{([^@]*)\}/);
        expect(query, 'per-tab 112px container query exists').toBeTruthy();
        expect(query[1]).toContain('.view-tab .tab-label');
        expect(query[1]).toContain('display: inline');
    });

    it('no unconditional panel-mode label rule survives (the query governs)', () => {
        expect(neatCss).not.toContain('body.panel-mode .view-tab .tab-label');
    });

    it('the number badge collapses below a 56px tab (ultra-narrow de-crowding)', () => {
        // 4.1.0 P1: at the 320px popup floor with many views enabled each
        // tab is ~45px — icon+badge overlap. The badge drops out below 56px
        // regardless of the showTabBadges option; the label query (112px)
        // stays the wider tier: icon+label+badge → icon+badge → icon-only.
        const query = neatCss.match(/@container \(max-width: 56px\) \{([^@]*)\}/);
        expect(query, 'per-tab 56px container query exists').toBeTruthy();
        expect(query[1]).toContain('.view-tab .tab-badge');
        expect(query[1]).toContain('display: none');
    });
});

describe('search field with overlaid clear button (fourth-round item 3)', () => {
    it('both pages wrap magnifier + input + clear in #search-field', () => {
        for (const [name, html] of [['popup', popupHtml], ['sidepanel', sidepanelHtml]]) {
            const field = html.indexOf('id="search-field"');
            expect(field, `${name} has #search-field`).toBeGreaterThanOrEqual(0);
            const input = html.indexOf('id="search-input"');
            const clear = html.indexOf('id="search-clear"');
            const quickAdd = html.indexOf('id="quick-add-btn"');
            expect(input).toBeGreaterThan(field);
            expect(clear).toBeGreaterThan(input);
            expect(quickAdd).toBeGreaterThan(clear); // clear before quick-add in DOM
        }
    });

    it('the clear button is absolutely positioned on the field trailing edge', () => {
        const field = ruleBody(neatCss, '#search-field {');
        expect(field).toContain('position: relative');
        const clear = ruleBody(neatCss, '#search-clear {');
        expect(clear).toContain('position: absolute');
        expect(clear).toContain('inset-inline-end');
        expect(clear).not.toContain('margin-inline-start'); // no flex-slot gap
        const input = ruleBody(neatCss, '#search input {');
        expect(input).toContain('padding-inline-end: 26px');
    });

    it('the has-query visibility toggle still drives the button', () => {
        expect(ruleBody(neatCss, '#search.has-query #search-clear {')).toContain('visibility: visible');
    });
});

describe('dupes group URL typography (fourth-round item 6)', () => {
    it('the dupes key inherits the UI font (no monospace)', () => {
        const body = ruleBody(neatCss, '.dupes-group .dupes-key {');
        expect(body).not.toContain('font-family');
    });
});

// 2026-08-26 audit-round geometry contracts: the 4.1.0 toolbar/banner
// additions land on the §2 20px grid and the shared recipes.
describe('2026-08-26 audit geometry contracts', () => {
    it('the tab-groups empty state joins the shared muted empty-state rule', () => {
        // the view shipped without it — its "no windows" row rendered
        // foreground-colored and left-aligned against every sibling list
        expect(neatCss).toContain('#tabgroups-list ul li.empty-state');
    });

    it('the search rung stack closes with a bottom border on the REAL last rung', () => {
        // the old `search-select-toolbar:last-of-type` never matched (the
        // selecting mode always emits both rungs) — the pair rendered
        // borderless while staging kept its closing line
        expect(neatCss.includes('.search-toolbar.search-select-toolbar:last-of-type {')).toBe(false);
        const closer = ruleBody(neatCss,
            '.staging-toolbar.staging-actions-toolbar,\n.search-toolbar.search-actions-toolbar {');
        expect(closer).toContain('border-bottom: 1px solid var(--vbm-border)');
    });

    it('every select-mode entry box is 20×20 (the §2 toolbar-grid box)', () => {
        const trio = ruleBody(neatCss, '.staging-toolbar .staging-select-mode,');
        expect(trio).toContain('width: 20px');
        expect(trio).toContain('height: 20px');
        expect(neatCss.match(/\.staging-shortcut-add,\n\.staging-toolbar \.staging-shortcut-edit-mode \{[\s\S]*?\}/)[0])
            .toContain('height: 20px');
    });

    it('the staging chip delete × uses the inline-start inset (RTL-safe)', () => {
        const del = ruleBody(neatCss, '.staging-shortcuts-toolbar.editing .staging-shortcut-del {');
        expect(del).toContain('inset-inline-start: 14px');
        expect(del).not.toContain('left: 14px');
    });

    it('the staging guide × is the 20×20 dismiss box (banner-family law)', () => {
        const close = ruleBody(neatCss, '.staging-guide-banner .staging-guide-close {');
        expect(close).toContain('width: 20px');
        expect(close).toContain('height: 20px');
        expect(close).toContain('margin-inline-start: auto');
    });

    it('icon+text toolbar entries share the 14px glyph and 2px vertical padding', () => {
        expect(ruleBody(neatCss, '#search-history-clear .vbm-icon {')).toContain('width: 14px');
        expect(ruleBody(neatCss, '.stats-toolbar .stats-clear .vbm-icon {')).toContain('width: 14px');
        expect(ruleBody(neatCss, '.staging-toolbar .staging-clear-entry .vbm-icon {')).toContain('width: 14px');
        expect(ruleBody(neatCss, '.staging-toolbar .staging-new-group .vbm-icon {')).toContain('width: 14px');
        expect(ruleBody(neatCss, '#search-history-clear {')).toContain('padding: 2px 6px');
    });

    it('the closed-history clear-all hover reads the danger tint', () => {
        const hover = ruleBody(neatCss, '.tabgroups-section-head button.tabgroups-closed-clear:hover {');
        expect(hover).toContain('color-mix(in srgb, var(--vbm-danger) 12%, transparent)');
    });
});
