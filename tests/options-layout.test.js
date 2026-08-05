import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Round-6 item 5 + v4 task-3 #17: the options page is ONE merged page
// (advanced-options absorbed; its old URL redirects). Groups are card
// sections flowed through a CSS multicol (uneven heights pack without
// holes), the page is capped + centered — wide enough that 4K screens get
// five columns instead of two plus a balancing void — and CodeMirror fits
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

describe('options page group structure (round-6 item 5, v4 task-3 #17 merge)', () => {
    it('flows the merged card sections through .options-grid', () => {
        // general / views / palette custom commands (v4 task-4 #6) / sync /
        // accessibility / custom icon / separators / sorting (issue #33) /
        // custom styles / dead scan / backup+reset — advanced-options merged in.
        expect(count(optionsHtml, '<section class="options-group">')).toBe(11);
        expect(optionsHtml).toContain('<main class="options-grid">');
        for (const id of ['general', 'views-options', 'palette-cmd-options', 'sync-options', 'accessibility',
                'custom-icon', 'separator-options', 'sort-options', 'custom-styles', 'dead-scan-options', 'backup-options'])
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

    it('splits the separator settings out of custom styles into their own group', () => {
        const sections = optionsHtml.split('<section class="options-group">').slice(1);
        const sep = sections.find(s => s.includes('<h2 id="separator-options">'));
        const styles = sections.find(s => s.includes('<h2 id="custom-styles">'));
        expect(sep).toBeTruthy();
        expect(styles).toBeTruthy();
        for (const id of ['custom-separator-color', 'custom-separator-title',
                'custom-separator-url', 'custom-separator-string'])
            expect(sep).toContain(`id="${id}"`);
        expect(styles).not.toContain('custom-separator');
        expect(styles).toContain('id="userstyle"'); // userstyle stays behind
    });

    it('absorbed the advanced controls (icon, separators, userstyle, dead scan, reset)', () => {
        for (const id of ['custom-icon-preview', 'custom-icon-file', 'default-icon-button',
                'custom-separator-color', 'custom-separator-title', 'custom-separator-url',
                'custom-separator-string', 'userstyle',
                'dead-proxy-template', 'dead-scan-concurrency', 'dead-scan-timeout',
                'reset-button'])
            expect(optionsHtml).toContain(`id="${id}"`);
        // CodeMirror ships with the merged page now
        expect(optionsHtml).toContain('/vendor/codemirror.js');
        expect(optionsHtml).toContain('/vendor/codemirror.css');
        // the merged page no longer links away to an advanced page
        expect(optionsHtml).not.toContain('advanced-options.html');
    });

    it('advanced-options.html is a redirect stub to the merged page', () => {
        expect(advancedHtml).toContain('/src/advanced-options.js');
        expect(advancedHtml).not.toContain('<fieldset>');
    });

    it('carries the v4 task-3 feature switches in the Views group', () => {
        const views = optionsHtml.split('<section class="options-group">')[2];
        const body = views.slice(0, views.indexOf('</section>'));
        for (const id of ['remember-view', 'show-tab-badges', 'palette-enabled',
                'quick-add-enabled', 'quick-add-context-menu', 'show-tool-button',
                'classic-experience', 'classic-experience-hint'])
            expect(body).toContain(`id="${id}"`);
    });

    it('carries the Sorting group (issue #33) after Separators', () => {
        const sortIdx = optionsHtml.indexOf('id="sort-options"');
        const sepIdx = optionsHtml.indexOf('id="separator-options"');
        expect(sepIdx).toBeGreaterThan(-1);
        expect(sortIdx).toBeGreaterThan(sepIdx);
        for (const id of ['sort-options-title', 'sort-options-date',
            'sort-options-folders-first', 'sort-options-recursive',
            'option-sort-recursive-hint'])
            expect(optionsHtml).toContain(`id="${id}"`);
    });
});

describe('options page responsive layout rules (v4 task-3 #17)', () => {
    it('caps and centers the page — wide enough for 4K densities', () => {
        const body = ruleBody(optionsCss, '.options-page{');
        expect(body).toContain('max-width: 1760px');
        expect(body).toContain('margin: 0 auto');
    });

    it('flows groups through a multicol, cards unbreakable', () => {
        const grid = ruleBody(optionsCss, '.options-grid{');
        expect(grid).toMatch(/columns:\s*340px/);
        const card = ruleBody(optionsCss, '.options-group,');
        expect(card).toContain('break-inside: avoid');
    });

    it('CodeMirror fits its column instead of forcing 40em', () => {
        const cm = ruleBody(optionsCss, '.CodeMirror{');
        expect(cm).toContain('width: min(40em, 100%)');
    });
});
