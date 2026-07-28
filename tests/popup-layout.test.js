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
