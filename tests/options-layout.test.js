import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Round-6 item 5: the options pages stop being one long full-width column.
// Groups are card sections flowed through a CSS multicol (uneven heights
// pack without holes), the page is capped + centered, and CodeMirror fits
// its column instead of forcing a fixed 40em overflow.

const optionsCss = fs.readFileSync(new URL('../css/options.css', import.meta.url), 'utf8');
const optionsHtml = fs.readFileSync(new URL('../pages/options.html', import.meta.url), 'utf8');
const advancedHtml = fs.readFileSync(new URL('../pages/advanced-options.html', import.meta.url), 'utf8');

const ruleBody = (css, selector) => {
    const i = css.indexOf(selector);
    expect(i, `rule for ${selector} exists`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
};

const count = (haystack, needle) => haystack.split(needle).length - 1;

describe('options page group structure (round-6 item 5)', () => {
    it('flows five card sections through .options-grid', () => {
        expect(count(optionsHtml, '<section class="options-group">')).toBe(5);
        expect(optionsHtml).toContain('<main class="options-grid">');
        for (const id of ['general', 'views-options', 'sync-options', 'accessibility', 'backup-options'])
            expect(optionsHtml).toContain(`<h2 id="${id}">`);
    });

    it('keeps every group heading + list inside its section', () => {
        const sections = optionsHtml.split('<section class="options-group">').slice(1);
        for (const s of sections) {
            const body = s.slice(0, s.indexOf('</section>'));
            expect(body).toContain('<h2 id="');
            expect(body).toContain('<ul class="options-list">');
        }
    });

    it('advanced options puts all four fieldsets in the same grid', () => {
        expect(advancedHtml).toContain('<main class="options-grid">');
        expect(count(advancedHtml, '<fieldset>')).toBe(4);
        expect(advancedHtml.indexOf('<main class="options-grid">'))
            .toBeLessThan(advancedHtml.indexOf('<fieldset>'));
    });
});

describe('options page responsive layout rules (round-6 item 5)', () => {
    it('caps and centers the page', () => {
        const body = ruleBody(optionsCss, '.options-page{');
        expect(body).toContain('max-width: 1280px');
        expect(body).toContain('margin: 0 auto');
    });

    it('flows groups through a multicol, cards unbreakable', () => {
        const grid = ruleBody(optionsCss, '.options-grid{');
        expect(grid).toMatch(/columns:\s*380px/);
        const card = ruleBody(optionsCss, '.options-group,');
        expect(card).toContain('break-inside: avoid');
    });

    it('CodeMirror fits its column instead of forcing 40em', () => {
        const cm = ruleBody(optionsCss, '.CodeMirror{');
        expect(cm).toContain('width: min(40em, 100%)');
    });
});
