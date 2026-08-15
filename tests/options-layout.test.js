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
        expect(count(optionsHtml, '<section class="options-group">')).toBe(15);
        expect(optionsHtml).toContain('<main class="options-grid">');
        for (const id of ['general', 'views-options', 'icons-options', 'context-menu-options', 'tools-options',
                'stats-options', 'palette-cmd-options', 'sync-options', 'accessibility',
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
                'custom-icon-pick',
                'custom-separator-color', 'custom-separator-title', 'custom-separator-url',
                'custom-separator-string', 'userstyle',
                // the retired relay-template input is gone; the proxy server row
                // (input + test-save + clear + hint) and the strip-visibility
                // checkbox own the dead-scan proxy surface now
                'dead-proxy-server-input', 'dead-proxy-server-save',
                'dead-proxy-server-value', 'dead-proxy-server-clear',
                'dead-proxy-strip-visible', 'dead-scan-concurrency', 'dead-scan-timeout',
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

    it('splits the v4 feature switches across their own groups (views/icon/menu/tools/stats)', () => {
        const bodyOf = id => {
            const s = optionsHtml.split('<section class="options-group">').find(x => x.includes(`<h2 id="${id}">`));
            return s.slice(0, s.indexOf('</section>'));
        };
        // Views now carries ONLY display items
        const views = bodyOf('views-options');
        for (const id of ['show-view-tabs', 'remember-view', 'show-tab-badges', 'show-item-path',
                'show-recent-bookmarks', 'show-stats-view', 'show-dead-view', 'show-dupes-view', 'recent-count'])
            expect(views).toContain(`id="${id}"`);
        for (const id of ['palette-enabled', 'quick-add-enabled', 'quick-add-context-menu',
                'show-tool-button', 'classic-experience', 'favicon-contrast', 'favicon-enrich'])
            expect(views).not.toContain(`id="${id}"`);
        // each non-Views switch lives in its own group
        const icons = bodyOf('icons-options');
        for (const id of ['favicon-contrast', 'favicon-enrich', 'favicon-enrich-ddg', 'favicon-cache-clear'])
            expect(icons).toContain(`id="${id}"`);
        const menu = bodyOf('context-menu-options');
        for (const id of ['quick-add-context-menu', 'collapse-tab-group-menu', 'collapse-sort-menu'])
            expect(menu).toContain(`id="${id}"`);
        const tools = bodyOf('tools-options');
        for (const id of ['palette-enabled', 'quick-add-enabled', 'show-tool-button', 'classic-experience', 'classic-experience-hint'])
            expect(tools).toContain(`id="${id}"`);
        const stats = bodyOf('stats-options');
        for (const id of ['stats-enabled', 'stats-clear', 'search-history-enabled'])
            expect(stats).toContain(`id="${id}"`);
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

describe('options page header responsive wrap (narrow widths)', () => {
    // The header's three element groups — the title block (icon+name+small),
    // the centered #header-since subtitle and the right #header-links pills —
    // must wrap onto their own lines instead of being flex-crushed into
    // truncation/overlap when the viewport gets narrow (flex-shrink would
    // otherwise compress the nowrap pills against the title).

    it('the title row wraps the pills below instead of crushing them', () => {
        const h1 = ruleBody(optionsCss, 'h1{');
        expect(h1).toContain('flex-wrap: wrap');
        expect(h1).toContain('display: flex');
    });

    it('the header-link pills wrap among themselves at ultra-narrow widths, still right-pinned', () => {
        const links = ruleBody(optionsCss, '#header-links{');
        expect(links).toContain('flex-wrap: wrap');
        expect(links).toContain('margin-inline-start: auto');
    });

    it('each pill keeps its own label nowrap — only the pill group wraps', () => {
        const btn = ruleBody(optionsCss, '#header-links a.header-btn{');
        expect(btn).toContain('white-space: nowrap');
    });

    it('the since subtitle is a centered block on its own line, never sharing the title row', () => {
        const since = ruleBody(optionsCss, '#header-since{');
        expect(since).toContain('text-align: center');
        expect(since).toContain('margin: .35em 0 0');
    });
});
