import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import { initTreeRender } from '../src/tree-render.js';

// Item 6 — tree row alignment contract.
// Three stable axes, indented by `-webkit-padding-start: 24px × level`
// (TREE_INDENT; v4 task-4 #2 — the 24px step lands a child row's icon left
// edge exactly on its parent folder's text left edge):
//   1. twisty slot  16px, arrow centered (folders); bookmark rows get a 16px
//      ::before placeholder so the rhythm never breaks
//   2. icon slot    20px favicon-container, 16px icon centered inside
//   3. text axis    title left edge at 16px × level + 40px — identical for
//      folders, bookmarks and the "(Empty)" row
// Overlay decorations (sync dot, dead ×) are position:absolute inside the
// icon slot and must never enter the flex flow.
// jsdom has no layout engine, so the contract is pinned two ways: the CSS
// text carries the slot rules, and the generated row HTML carries the slot
// structure in the right order.

const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
const syncCss = fs.readFileSync(new URL('../css/sync-styles.css', import.meta.url), 'utf8');

// Extract the `{ … }` body following a selector (rules are flat — no nesting).
const ruleBody = (css, selector) => {
    const i = css.indexOf(selector);
    expect(i, `rule for ${selector} exists`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
};

describe('alignment CSS contract (item 6)', () => {
    it('the twisty slot is 16px with the arrow centered on both axes', () => {
        const body = ruleBody(neatCss, '#tree ul li span .twisty');
        expect(body).toContain('width: 16px');
        expect(body).toContain('justify-content: center');
        expect(body).toContain('align-items: center');
    });

    it('bookmark rows get a 16px ::before placeholder instead of a twisty', () => {
        const body = ruleBody(neatCss, '#tree ul li a::before,\n#results ul li a::before');
        expect(body).toContain("content: ''");
        expect(body).toContain('width: 16px');
    });

    it('the icon slot is a 20px flex box with the icon centered (scoped)', () => {
        const body = ruleBody(
            neatCss,
            '#tree ul li a .favicon-container,\n#tree ul li span .favicon-container,\n#results ul li a .favicon-container');
        expect(body).toContain('width: 20px');
        expect(body).toContain('display: flex');
        expect(body).toContain('justify-content: center');
    });

    it('the icon slot is a 20px flex box with the icon centered (unscoped)', () => {
        const body = ruleBody(neatCss, '.tree-item-link .favicon-container {');
        expect(body).toContain('width: 20px');
        expect(body).toContain('justify-content: center');
    });

    it('the icon slot keeps a 4px gap before the title in both scopes', () => {
        const scoped = ruleBody(
            neatCss,
            '#tree ul li a .favicon-container,\n#tree ul li span .favicon-container,');
        expect(scoped).toContain('margin-inline-end: 4px');
        const unscoped = ruleBody(neatCss, '.tree-item-link .favicon-container {');
        expect(unscoped).toContain('margin-inline-end: 4px');
    });

    it('icons inside the slot are pinned to 16px in both scopes', () => {
        const scoped = ruleBody(
            neatCss,
            '#tree ul li a .favicon-container img,\n#tree ul li span .favicon-container img,');
        expect(scoped).toContain('width: 16px');
        expect(scoped).toContain('height: 16px');
        const unscoped = ruleBody(
            neatCss,
            '.tree-item-link .favicon-container img,\n.tree-item-link .favicon-container svg');
        expect(unscoped).toContain('width: 16px');
        expect(unscoped).toContain('height: 16px');
    });

    it('the sync dot is absolutely positioned in neat.css too (override guard)', () => {
        const body = ruleBody(
            neatCss,
            '#tree ul li .favicon-container .sync-indicator,\n#results ul li .favicon-container .sync-indicator');
        expect(body).toContain('position: absolute');
    });

    it('sync-styles.css keeps the dot out of the flex flow as well', () => {
        const body = ruleBody(syncCss, '.favicon-container .sync-indicator');
        expect(body).toContain('position: absolute');
    });

    it('the favicon container establishes the positioning context for overlays', () => {
        // anchored with a leading newline so the unscoped standalone rule is
        // found, not `.tree-item-link .favicon-container {`
        const body = ruleBody(neatCss, '\n.favicon-container {');
        expect(body).toContain('position: relative');
    });

    it('the dead × overlay is absolutely positioned (never widens the slot)', () => {
        const body = ruleBody(neatCss, '.favicon-container .dead-indicator');
        expect(body).toContain('position: absolute');
    });

    it('the dead × beats the generic #tree row-span rule (the ellipse regression)', () => {
        // 第五轮项2: `#tree ul li span` (display:flex + 1.67em line-height +
        // 4px end padding, specificity 1,0,3) leaked into the overlay span and
        // stretched the 10px disc into a 14×10 ellipse. The doubled selector
        // out-specifies it and every box property is pinned.
        expect(neatCss).toContain('#tree ul li span.dead-indicator');
        const body = ruleBody(neatCss, '.favicon-container .dead-indicator,\n#tree ul li span.dead-indicator');
        expect(body).toContain('display: inline-flex');
        expect(body).toContain('padding: 0');
        expect(body).toContain('line-height: 1');
        expect(body).toContain('min-width: 10px');
        // the halo ring: a bg-colored separation from the favicon bitmap
        expect(body).toContain('box-shadow: 0 0 0 1.5px var(--vbm-bg)');
    });

    it('the sync dot wears the same halo ring (unified marker language)', () => {
        const local = ruleBody(syncCss, '.sync-indicator.local');
        expect(local).toContain('box-shadow: 0 0 0 1.5px var(--vbm-bg)');
        expect(local).not.toContain('0 0 3px'); // the old accent glow is gone
        const unsyncable = ruleBody(syncCss, '.sync-indicator.unsyncable');
        expect(unsyncable).toContain('box-shadow: 0 0 0 1.5px var(--vbm-bg)');
    });

    it('the sync dot is pinned to a 6px circle, sized by sync-styles.css alone', () => {
        // view-system absorption (its sync-indicator.test.js core): the dot's
        // size/roundness contract, plus the negative guard that neat.css
        // overrides geometry (position/offset) only — never the box.
        const base = ruleBody(syncCss, '.sync-indicator {');
        expect(base).toContain('width: 6px');
        expect(base).toContain('height: 6px');
        expect(base).toContain('border-radius: 50%');
        const guard = ruleBody(
            neatCss,
            '#tree ul li .favicon-container .sync-indicator,\n#results ul li .favicon-container .sync-indicator');
        expect(guard).not.toMatch(/width|height|border-radius/);
    });

    it('separator rows drop the ::before placeholder (the line owns the row)', () => {
        const body = ruleBody(neatCss, '#tree ul li a.separator-row::before');
        expect(body).toContain('content: none');
    });

    it('list views keep the same 16px placeholder rhythm as the tree', () => {
        const body = ruleBody(
            neatCss,
            '#recent-list ul li a::before,\n#tabgroups-list ul li a::before,\n#dupes-list ul li a::before,\n#dead-list ul li a::before,\n#stats-list ul li a::before');
        expect(body).toContain("content: ''");
        expect(body).toContain('width: 16px');
    });
});

// --- Row structure ---------------------------------------------------------

const MESSAGES = { noTitle: '(No title)', folderEmpty: '(Empty)' };

beforeAll(() => {
    globalThis.chrome = {
        i18n: { getMessage: key => MESSAGES[key] || `MSG:${key}` },
        runtime: { getURL: path => `chrome-extension://test${path}` },
        bookmarks: { getChildren: (id, cb) => cb([]) }
    };
    globalThis.window = { innerWidth: 400, syncManager: null };
    globalThis.document = {
        createElement: () => ({ innerHTML: '', querySelector: () => null, remove() {} }),
        getElementById: () => null
    };
});

afterAll(() => {
    delete globalThis.chrome;
    delete globalThis.window;
    delete globalThis.document;
});

const makeStore = (data = {}, sync = { showSyncStatus: 'false' }) => ({
    get: key => data[key],
    getSyncSetting: (key, def) => (key in sync ? sync[key] : def)
});

const setup = (env = {}) => initTreeRender({
    store: env.store || makeStore(),
    separatorManager: { isSeparator: () => false, add() {} },
    getOpens: () => [],
    getRememberState: () => false
});

describe('row slot structure (item 6)', () => {
    it('folder rows render twisty → icon slot → title, in that order', () => {
        const tr = setup();
        const html = tr.generateFolderHTML('Folder', '', '7', {});
        const iTwisty = html.indexOf('<b class="twisty">');
        const iIcon = html.indexOf('class="favicon-container"');
        const iTitle = html.indexOf('<i>');
        expect(iTwisty).toBeGreaterThanOrEqual(0);
        expect(iIcon).toBeGreaterThan(iTwisty);
        expect(iTitle).toBeGreaterThan(iIcon);
    });

    it('bookmark rows carry no twisty element — the CSS ::before holds the axis', () => {
        const tr = setup();
        const html = tr.generateBookmarkHTML('Bm', 'https://e.com/', '', '1');
        expect(html).not.toContain('twisty');
        const iIcon = html.indexOf('class="favicon-container"');
        const iTitle = html.indexOf('<i>');
        expect(iIcon).toBeGreaterThanOrEqual(0);
        expect(iTitle).toBeGreaterThan(iIcon);
    });

    it('the "(Empty)" row pads 24px × level + the 40px slot width', () => {
        const tr = setup();
        expect(tr.generateHTML([])).toContain('-webkit-padding-start: 40px');
        expect(tr.generateHTML([], 3)).toContain('-webkit-padding-start: 112px');
    });

    it('the sync indicator markup stays inside the favicon container', () => {
        globalThis.window.syncManager = {
            getSyncStatusIndicator: () => 'local',
            getSyncTooltip: () => 'Local only'
        };
        const store = makeStore({}, { showSyncStatus: 'true' });
        const tr = setup({ store });
        const html = tr.generateBookmarkHTML('Bm', 'https://e.com/', '', '1');
        const iContainer = html.indexOf('class="favicon-container"');
        const iDot = html.indexOf('class="sync-indicator local"');
        const iContainerEnd = html.indexOf('</div>', iContainer);
        expect(iDot).toBeGreaterThan(iContainer);
        expect(iDot).toBeLessThan(iContainerEnd);
    });

    it('folder and bookmark rows at the same level share the same indent', () => {
        const tr = setup();
        const html = tr.generateHTML([
            { id: '1', parentId: '0', title: 'F', children: [] },
            { id: '2', parentId: '0', title: 'B', url: 'https://e.com/' }
        ], 2);
        const pads = html.match(/-webkit-padding-start: (\d+)px/g) || [];
        expect(pads.length).toBeGreaterThanOrEqual(2);
        expect(new Set(pads).size).toBe(1);
        expect(pads[0]).toBe('-webkit-padding-start: 48px');
    });
});
