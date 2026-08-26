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
        // general / views / per-view groups (tree/search/tab-groups/recent/
        // stats/dead/dupes) / icons / context menu / tools / palette /
        // sync / accessibility / custom icon / separators / sorting /
        // custom styles / backup+reset / labs — advanced-options merged in.
        // 4.1.0: the tab-groups group is live; only dupes stays a placeholder.
        // 4.1.0: the Labs group (experimental features, default-off switches).
        expect(count(optionsHtml, '<section class="options-group">')).toBe(20);
        expect(count(optionsHtml, '<section class="options-group" hidden>')).toBe(1);
        expect(optionsHtml).toContain('<main class="options-grid">');
        for (const id of ['general', 'views-options', 'tree-options', 'search-options', 'tabgroups-options',
                'recent-options', 'stats-options', 'dead-scan-options', 'dupes-options',
                'icons-options', 'context-menu-options', 'tools-options',
                'palette-cmd-options', 'sync-options', 'accessibility',
                'custom-icon', 'separator-options', 'sort-options', 'custom-styles', 'backup-options',
                'labs-options'])
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

    it('keeps the per-view show switches together in Views, options in per-view groups', () => {
        const bodyOf = id => {
            const s = optionsHtml.split('<section class="options-group">').find(x => x.includes(`<h2 id="${id}">`));
            return s.slice(0, s.indexOf('</section>'));
        };
        // Views carries the display items AND every per-view show switch.
        const views = bodyOf('views-options');
        for (const id of ['show-view-tabs', 'remember-view', 'show-tab-badges', 'show-item-path',
                'show-tab-groups-view', 'show-recent-bookmarks', 'show-stats-view', 'show-dead-view', 'show-dupes-view'])
            expect(views).toContain(`id="${id}"`);
        for (const id of ['recent-count', 'only-show-bmbar', 'search-after-enter'])
            expect(views).not.toContain(`id="${id}"`);
        // Tree: the bookmarks-bar scope setting moved out of General
        const tree = bodyOf('tree-options');
        expect(tree).toContain('id="only-show-bmbar"');
        // Search: searchAfterEnter moved out of General
        const search = bodyOf('search-options');
        expect(search).toContain('id="search-after-enter"');
        // General no longer carries the per-view settings
        const general = bodyOf('general');
        expect(general).not.toContain('id="only-show-bmbar"');
        expect(general).not.toContain('id="search-after-enter"');
        // …but positively owns theme, the 4.0.8 language dropdown and the
        // announce privacy switch (a moved control fails here now)
        for (const id of ['theme-select', 'language-select', 'option-language-hint', 'announce-enabled'])
            expect(general).toContain(`id="${id}"`);
        // Tab groups group (4.1.0) owns the color-style + closed-depth options
        const tabgroups = bodyOf('tabgroups-options');
        for (const id of ['tabgroups-color-style', 'tabgroups-closed-limit'])
            expect(tabgroups).toContain(`id="${id}"`);
        expect(tabgroups).not.toContain('id="show-tab-groups-view"');
        // Recent group owns only the recent-count behavior option
        const recent = bodyOf('recent-options');
        expect(recent).toContain('id="recent-count"');
        expect(recent).not.toContain('id="show-recent-bookmarks"');
        expect(recent).not.toContain('id="tabgroups-closed-limit"');
        // Stats group owns the data controls, not the show switch
        const stats = bodyOf('stats-options');
        for (const id of ['stats-enabled', 'stats-clear'])
            expect(stats).toContain(`id="${id}"`);
        expect(stats).not.toContain('id="show-stats-view"');
        // 2026-08-26 report: 记录搜索历史 belongs to the SEARCH group
        expect(stats).not.toContain('id="search-history-enabled"');
        const searchGroup = bodyOf('search-options');
        expect(searchGroup).toContain('id="search-history-enabled"');
        // Dead group owns the scan/proxy controls, not the show switch
        const dead = bodyOf('dead-scan-options');
        for (const id of ['dead-proxy-server-input', 'dead-proxy-strip-visible',
                'dead-scan-concurrency', 'dead-scan-timeout'])
            expect(dead).toContain(`id="${id}"`);
        expect(dead).not.toContain('id="show-dead-view"');
        // Dupes has no behavior options yet — the group stays a hidden placeholder
        const dupes = optionsHtml.split('<section class="options-group" hidden>').find(x => x.includes('<h2 id="dupes-options">'));
        expect(dupes).toBeTruthy();
        expect(dupes).not.toContain('id="show-dupes-view"');
        // Each non-Views switch lives in its own group
        const icons = bodyOf('icons-options');
        for (const id of ['favicon-contrast', 'favicon-enrich', 'favicon-enrich-ddg', 'favicon-cache-clear'])
            expect(icons).toContain(`id="${id}"`);
        const menu = bodyOf('context-menu-options');
        for (const id of ['quick-add-context-menu', 'collapse-tab-group-menu', 'collapse-sort-menu'])
            expect(menu).toContain(`id="${id}"`);
        const tools = bodyOf('tools-options');
        for (const id of ['palette-enabled', 'quick-add-enabled', 'show-tool-button', 'classic-experience', 'classic-experience-hint'])
            expect(tools).toContain(`id="${id}"`);
    });

    it('orders per-view groups before icons and the rest', () => {
        const order = ['general', 'views-options', 'tree-options', 'search-options', 'tabgroups-options',
            'recent-options', 'stats-options', 'dead-scan-options', 'dupes-options',
            'icons-options', 'context-menu-options', 'tools-options', 'palette-cmd-options',
            'sync-options', 'accessibility', 'custom-icon', 'separator-options', 'sort-options',
            'custom-styles', 'backup-options'];
        let prev = -1;
        for (const id of order) {
            const idx = optionsHtml.indexOf(`<h2 id="${id}">`);
            expect(idx, `${id} is present`).toBeGreaterThan(prev);
            prev = idx;
        }
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
    // the #header-since subtitle docked in front of the pills and the right
    // #header-links pills — must wrap onto their own lines instead of being
    // flex-crushed into truncation/overlap when the viewport gets narrow
    // (flex-shrink would otherwise compress the nowrap pills against the
    // title). Wide screens keep them on one row.

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

    it('the since subtitle docks in the title row, grown to center before the pills', () => {
        const since = ruleBody(optionsCss, '#header-since{');
        expect(since).toContain('text-align: center');
        // flex:1 grows it to fill the free space between the title block and
        // #header-links, so its text centers just before the donate pill; on
        // narrow cards the row wraps and the subtitle drops to its own line.
        expect(since).toContain('flex: 1 1 auto');
    });
});
