import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initTreeRender, buildPathMap } from '../src/tree-render.js';
import { FOLDER_ICON, DOCUMENT_CODE_ICON, CHEVRON_ICON } from '../src/icons.js';

// tree-render.js touches page globals (chrome.i18n/runtime/bookmarks,
// window.syncManager/innerWidth, document) only inside initTreeRender and the
// returned functions, so the real module imports cleanly in node once the
// globals are stubbed. store/separatorManager are injected doubles; opens and
// rememberState arrive as getters so tests can flip them per case. Expected
// HTML is written out by hand below — nothing is derived from the module;
// the two SVG icons are asserted via the shared src/icons.js contract.

const MESSAGES = {
    noTitle: '(No title)',
    folderEmpty: '(Empty)',
    syncSuffixLocal: '(Local)',
    syncSuffixSynced: '(Synced)'
};

let getChildrenCalls;
let appendedTo;       // [id, child] pairs recorded on getElementById stubs
let lastCreatedDiv;   // captures innerHTML assigned in the lazy-load path

beforeAll(() => {
    globalThis.chrome = {
        i18n: { getMessage: key => MESSAGES[key] || `MSG:${key}` },
        runtime: { getURL: path => `chrome-extension://test${path}` },
        bookmarks: {
            getChildren: (id, cb) => {
                getChildrenCalls.push(id);
                cb([]);
            }
        }
    };
    globalThis.window = { innerWidth: 400, syncManager: null };
    globalThis.document = {
        createElement: () => {
            const div = {
                innerHTML: '',
                removed: false,
                querySelector: () => div._ul,
                remove() { this.removed = true; },
                _ul: { tag: 'UL' }
            };
            lastCreatedDiv = div;
            return div;
        },
        getElementById: id => ({
            appendChild(child) { appendedTo.push([id, child]); }
        })
    };
});

beforeEach(() => {
    getChildrenCalls = [];
    appendedTo = [];
    lastCreatedDiv = null;
    globalThis.window.innerWidth = 400;
    globalThis.window.syncManager = null;
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

const makeSeparatorManager = (isSeparator = () => false) => ({
    added: [],
    isSeparator,
    add(id) { this.added.push(id); }
});

const setup = (env = {}) => initTreeRender({
    store: env.store || makeStore(),
    separatorManager: env.separatorManager || makeSeparatorManager(),
    getOpens: env.getOpens || (() => []),
    getRememberState: env.getRememberState || (() => true)
});

const FAV_E = 'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fe.com%2F&size=32';

describe('getFaviconUrl', () => {
    it('builds the _favicon URL with encoded pageUrl and size=32', () => {
        const tr = setup();
        expect(tr.getFaviconUrl('http://e.com/')).toBe(FAV_E);
    });

    it('encodes spaces, quotes and query delimiters in pageUrl', () => {
        const tr = setup();
        expect(tr.getFaviconUrl('http://x.com/a b?q="1"')).toBe(
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fx.com%2Fa+b%3Fq%3D%221%22&size=32');
    });
});

describe('highlightTitlePositions', () => {
    let tr;
    beforeEach(() => { tr = setup(); });

    it('escapes < > " when no positions are given', () => {
        expect(tr.highlightTitlePositions('a<b>"c"', null)).toBe('a&lt;b&gt;&quot;c&quot;');
    });

    it('treats an empty positions array like no positions', () => {
        expect(tr.highlightTitlePositions('a<b', [])).toBe('a&lt;b');
    });

    it('wraps a single hit in <mark>', () => {
        expect(tr.highlightTitlePositions('abc', [1])).toBe('a<mark>b</mark>c');
    });

    it('merges consecutive hits into one <mark> run', () => {
        expect(tr.highlightTitlePositions('abc', [0, 1, 2])).toBe('<mark>abc</mark>');
    });

    it('opens and closes <mark> around separate runs', () => {
        expect(tr.highlightTitlePositions('abcde', [1, 3])).toBe('a<mark>b</mark>c<mark>d</mark>e');
    });

    it('closes <mark> when the hit run reaches the end', () => {
        expect(tr.highlightTitlePositions('ab', [0])).toBe('<mark>a</mark>b');
    });

    it('escapes special chars inside <mark> without shifting indices', () => {
        expect(tr.highlightTitlePositions('a<b', [1, 2])).toBe('a<mark>&lt;b</mark>');
    });
});

describe('generateBookmarkHTML', () => {
    it('produces the exact row HTML for a plain bookmark (no extras, no sync)', () => {
        const tr = setup();
        const expected = [
            `<a href="http://e.com/" title="http://e.com/" tabindex="0"  class="tree-item-link">`,
            `                <div class="favicon-container">`,
            `                    <img src="${FAV_E}" width="16" height="16" alt="">`,
            `                    `,
            `                </div>`,
            `                <i>T</i>`,
            `                </a>`
        ].join('\n');
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1')).toBe(expected);
    });

    it('escapes title and url in href, tooltip and name', () => {
        const tr = setup();
        const html = tr.generateBookmarkHTML('<b>"x"', 'http://e.com/?q="1"', '', '1');
        expect(html).toContain('href="http://e.com/?q=&quot;1&quot;"');
        expect(html).toContain('title="http://e.com/?q=&quot;1&quot;"');
        expect(html).toContain('<i>&lt;b&gt;&quot;x&quot;</i>');
    });

    it('falls back to the protocol-stripped url when the title is empty', () => {
        const tr = setup();
        expect(tr.generateBookmarkHTML('', 'http://e.com/path', '', '1'))
            .toContain('<i>e.com/path</i>');
        expect(tr.generateBookmarkHTML('', 'https://e.com/', '', '1'))
            .toContain('<i>e.com/</i>');
    });

    it('falls back to the noTitle message for non-http(s) urls', () => {
        const tr = setup();
        expect(tr.generateBookmarkHTML('', 'ftp://e.com/', '', '1'))
            .toContain('<i>(No title)</i>');
    });

    it('uses the inline document-code icon for javascript: urls', () => {
        const tr = setup();
        const html = tr.generateBookmarkHTML('JS', 'javascript:alert(1)', '', '1');
        expect(html).toContain(DOCUMENT_CODE_ICON);
        expect(html).not.toContain('.png');
        expect(html).toContain('title="javascript:alert(1)"');
    });

    it('truncates javascript: tooltips beyond 140 chars with an ellipsis', () => {
        const tr = setup();
        const url = `javascript:${'x'.repeat(200)}`;
        const html = tr.generateBookmarkHTML('JS', url, '', '1');
        expect(html).toContain(`title="${`javascript:${'x'.repeat(129)}`}..."`);
    });

    it('highlights title positions with <mark> when provided', () => {
        const tr = setup();
        expect(tr.generateBookmarkHTML('abc', 'http://e.com/', '', '1', [0, 2]))
            .toContain('<i><mark>a</mark>b<mark>c</mark></i>');
    });

    it('passes extras through into the anchor tag', () => {
        const tr = setup();
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', 'data-virtual="1"', '1'))
            .toContain('tabindex="0" data-virtual="1" class="tree-item-link"');
    });

    it('renders the sync indicator when enabled, manager present and id given', () => {
        globalThis.window.syncManager = {
            getSyncStatusIndicator: () => 'synced',
            getSyncTooltip: () => 'Synced tip'
        };
        const tr = setup({ store: makeStore({}, { showSyncStatus: 'true' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1');
        // custom tooltip only — no native title duplication
        expect(html).toContain('<span class="sync-indicator synced">');
        expect(html).toContain('<span class="sync-tooltip">Synced tip</span>');
    });

    it('omits the sync indicator when the setting is off', () => {
        globalThis.window.syncManager = {
            getSyncStatusIndicator: () => 'synced',
            getSyncTooltip: () => 'Synced tip'
        };
        const tr = setup({ store: makeStore({}, { showSyncStatus: 'false' }) });
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1'))
            .not.toContain('sync-indicator');
    });

    it('omits the sync indicator without a syncManager or without an id', () => {
        const tr = setup({ store: makeStore({}, { showSyncStatus: 'true' }) });
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1'))
            .not.toContain('sync-indicator');
        globalThis.window.syncManager = {
            getSyncStatusIndicator: () => 'synced',
            getSyncTooltip: () => 'tip'
        };
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', undefined))
            .not.toContain('sync-indicator');
    });

    // v4 task-2 §3.6: meta.path unifies the tooltip to 标题+URL+路径 and
    // adds the row path labels when showItemPath is on.
    it('meta.path unifies the tooltip and adds row path labels (showItemPath on)', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, { path: 'Folder A' });
        expect(html).toContain('title="T\nhttp://e.com/\nFolder A"');
        expect(html).toContain(
            '<span class="row-main"><i>T</i><span class="row-sub" dir="auto">Folder A</span></span>');
        expect(html).toContain('<span class="row-path" dir="auto">Folder A</span>');
    });

    it('meta.path escapes all three tooltip segments', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        const html = tr.generateBookmarkHTML('<b>', 'http://e.com/?q="1"', '', '1', null, { path: 'A<B' });
        expect(html).toContain('title="&lt;b&gt;\nhttp://e.com/?q=&quot;1&quot;\nA&lt;B"');
        expect(html).toContain('<span class="row-sub" dir="auto">A&lt;B</span>');
    });

    it('meta.path only sets the tooltip when showItemPath is off', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, { path: 'Folder A' });
        expect(html).toContain('title="T\nhttp://e.com/\nFolder A"');
        expect(html).toContain('<i>T</i>'); // plain name slot
        expect(html).not.toContain('row-path');
    });

    it('empty/missing meta.path keeps the legacy URL-only tooltip', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, { path: '' }))
            .toContain('title="http://e.com/"');
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {}))
            .not.toContain('row-path');
    });
});

describe('buildPathMap (v4 task-2 §3.6)', () => {
    it('maps each node to its ancestor folder path, skipping the invisible root and untitled folders', () => {
        const map = buildPathMap([{
            id: '0', title: '', children: [
                {
                    id: '1', parentId: '0', title: 'Folder A', children: [
                        { id: '11', parentId: '1', title: 'GitHub', url: 'https://x.com/' },
                        {
                            id: '2', parentId: '1', title: '  ', children: [
                                { id: '21', parentId: '2', title: 'Deep', url: 'https://y.com/' }
                            ]
                        },
                        {
                            id: '3', parentId: '1', title: 'Sub B', children: [
                                { id: '31', parentId: '3', title: 'Deeper', url: 'https://z.com/' }
                            ]
                        }
                    ]
                },
                { id: '4', parentId: '0', title: 'Top', url: 'https://t.com/' }
            ]
        }]);
        expect(map['0']).toBeUndefined(); // invisible root contributes nothing
        expect(map['1']).toBe(''); // sits at the root
        expect(map['11']).toBe('Folder A');
        expect(map['21']).toBe('Folder A'); // untitled folder adds no segment
        expect(map['31']).toBe('Folder A / Sub B');
        expect(map['4']).toBe('');
    });

    it('handles empty input', () => {
        expect(buildPathMap(null)).toEqual({});
        expect(buildPathMap([])).toEqual({});
        expect(buildPathMap([{ id: '0', title: '' }])).toEqual({});
    });
});

describe('generateFolderHTML', () => {
    it('produces the exact row HTML for a plain folder', () => {
        const tr = setup();
        const expected = [
            `<span tabindex="0" style="-webkit-padding-start: 0px" class="tree-item-span">`,
            `\t\t   <b class="twisty">${CHEVRON_ICON}</b>`,
            `\t\t   <div class="favicon-container">`,
            `\t\t       ${FOLDER_ICON}`,
            `\t\t       `,
            `\t\t   </div>`,
            `\t\t   <i>F</i>`,
            `\t\t   </span>`
        ].join('\n');
        expect(tr.generateFolderHTML('F', 'style="-webkit-padding-start: 0px"', '10'))
            .toBe(expected);
    });

    it('appends the (Local) suffix for non-syncing dual-storage folders', () => {
        const tr = setup();
        const html = tr.generateFolderHTML('F', '', '10', { syncing: false, folderType: 'other' });
        expect(html).toContain('<i>F (Local)</i>');
    });

    it('appends the (Synced) suffix for syncing dual-storage roots, none for plain nodes', () => {
        const tr = setup();
        expect(tr.generateFolderHTML('F', '', '10', { syncing: true, folderType: 'other' }))
            .toContain('<i>F (Synced)</i>');
        expect(tr.generateFolderHTML('F', '', '10', { syncing: false }))
            .toContain('<i>F</i>');
    });

    it('falls back to the noTitle message for an empty title', () => {
        const tr = setup();
        expect(tr.generateFolderHTML('', '', '10')).toContain('<i>(No title)</i>');
    });

    it('renders the sync indicator when enabled and a manager is present', () => {
        globalThis.window.syncManager = {
            getSyncStatusIndicator: () => 'pending',
            getSyncTooltip: () => 'Pending tip'
        };
        const tr = setup({ store: makeStore({}, { showSyncStatus: 'true' }) });
        const html = tr.generateFolderHTML('F', '', '10');
        expect(html).toContain('<span class="sync-indicator pending">');
        expect(html).toContain('<span class="sync-tooltip">Pending tip</span>');
    });
});

describe('generateSeparatorHTML', () => {
    it('uses CSS-driven separator-row with theme tokens (no inline color/width)', () => {
        const tr = setup();
        const html = tr.generateSeparatorHTML(16);
        // Separator is now CSS-driven: the <a> gets the separator-row class and
        // the <hr> uses absolute positioning (left:0 / right:8px) to auto-fill
        // the row. Colors come from --vbm-border, no more inline styles.
        expect(html).toContain('style="-webkit-padding-start: 16px"');
        expect(html).toContain('class="tree-item-link separator-row"');
        expect(html).toContain('<hr class="separator-line" role="separator">');
    });

    it('does not set inline border or width styles (CSS handles both)', () => {
        const tr = setup();
        const html = tr.generateSeparatorHTML(0);
        expect(html).not.toContain('border:');
        expect(html).not.toContain('width:');
    });

    it('drops the separatorcolor store key (retired — themes handle color)', () => {
        const tr = setup({ store: makeStore({ separatorcolor: '#abc' }) });
        const html = tr.generateSeparatorHTML(0);
        expect(html).not.toContain('#abc');
        expect(html).not.toContain('#aabbcc');
    });
});

describe('generateHTML', () => {
    it('renders the muted empty-folder row for empty data', () => {
        const tr = setup();
        expect(tr.generateHTML([])).toBe(
            '<ul role="tree" data-level="0"><li class="empty-folder" ' +
            'style="-webkit-padding-start: 0px"><i>(Empty)</i></li></ul>');
    });

    it('uses role=group and scaled padding at deeper levels', () => {
        const tr = setup();
        expect(tr.generateHTML([], 2)).toBe(
            '<ul role="group" data-level="2"><li class="empty-folder" ' +
            'style="-webkit-padding-start: 32px"><i>(Empty)</i></li></ul>');
    });

    it('marks local-only rows (syncing === false) with unsynced-subtree', () => {
        const tr = setup();
        const html = tr.generateHTML([
            { id: '1', parentId: '0', title: 'L', url: 'http://l/', syncing: false },
            { id: '2', parentId: '0', title: 'S', url: 'http://s/', syncing: true },
            { id: '3', parentId: '0', title: 'U', url: 'http://u/' }
        ]);
        expect(html).toContain('<li class="child unsynced-subtree " id="neat-tree-item-1"');
        expect(html).toContain('<li class="child " id="neat-tree-item-2"');
        expect(html).toContain('<li class="child " id="neat-tree-item-3"');
    });

    it('renders a bookmark li with child class, id, level and data-parentid', () => {
        const tr = setup();
        const html = tr.generateHTML([
            { id: '1', parentId: '0', title: 'A', url: 'http://e.com/' }
        ]);
        expect(html).toContain(
            '<li class="child " id="neat-tree-item-1" level="0" role="treeitem"  data-parentid="0">');
        expect(html).toContain('style="-webkit-padding-start: 0px"');
        expect(html).toContain('<i>A</i>');
        expect(html).toMatch(/^<ul role="tree" data-level="0">.*<\/ul>$/s);
    });

    it('renders a closed folder without its children', () => {
        const tr = setup();
        const html = tr.generateHTML([
            { id: '10', parentId: '0', title: 'F', children: [
                { id: '11', parentId: '10', title: 'SecretKid', url: 'http://e.com/' }
            ] }
        ]);
        expect(html).toContain('<li class="parent " id="neat-tree-item-10"');
        expect(html).toContain('aria-expanded="false"');
        expect(html).not.toContain('SecretKid');
    });

    it('recurses into an open folder with level+1 and aria-expanded=true', () => {
        const tr = setup({ getOpens: () => ['10'] });
        const html = tr.generateHTML([
            { id: '10', parentId: '0', title: 'F', children: [
                { id: '11', parentId: '10', title: 'Kid', url: 'http://e.com/' }
            ] }
        ]);
        expect(html).toContain('<li class="parent open" id="neat-tree-item-10"');
        expect(html).toContain('aria-expanded="true"');
        expect(html).toContain('<ul role="group" data-level="1">');
        expect(html).toContain('level="1" role="treeitem"');
        expect(html).toContain('style="-webkit-padding-start: 16px"');
        expect(html).toContain('<i>Kid</i>');
    });

    it('reads opens/rememberState live through the ctx getters', () => {
        let opens = [];
        let remember = true;
        const tr = setup({ getOpens: () => opens, getRememberState: () => remember });
        const data = [{ id: '10', parentId: '0', title: 'F', children: [
            { id: '11', parentId: '10', title: 'Kid', url: 'http://e.com/' }
        ] }];
        expect(tr.generateHTML(data)).toContain('aria-expanded="false"');
        opens = ['10'];
        expect(tr.generateHTML(data)).toContain('aria-expanded="true"');
        remember = false;
        expect(tr.generateHTML(data)).toContain('aria-expanded="false"');
    });

    it('lazy-loads children of an open childless folder via chrome.bookmarks', () => {
        globalThis.chrome.bookmarks.getChildren = (id, cb) => {
            getChildrenCalls.push(id);
            cb([{ id: '10c', parentId: '10', title: 'LazyKid', url: 'http://e.com/' }]);
        };
        const tr = setup({ getOpens: () => ['10'] });
        const html = tr.generateHTML([
            { id: '10', parentId: '0', title: 'F', dateGroupModified: 5 }
        ]);
        // the folder itself renders inline; children are appended async
        expect(html).toContain('<li class="parent open" id="neat-tree-item-10"');
        expect(html).not.toContain('LazyKid');
        expect(getChildrenCalls).toEqual(['10']);
        expect(lastCreatedDiv.innerHTML).toContain('LazyKid');
        expect(lastCreatedDiv.innerHTML).toContain('<ul role="group" data-level="1">');
        expect(appendedTo).toEqual([['neat-tree-item-10', lastCreatedDiv._ul]]);
        expect(lastCreatedDiv.removed).toBe(true);
    });

    it('detects separators, renders the hr row and registers the id', () => {
        const separatorManager = makeSeparatorManager(
            (title, url) => url === 'http://sep.example/');
        const tr = setup({ separatorManager });
        const html = tr.generateHTML([
            { id: '1', parentId: '0', title: '---', url: 'http://sep.example/' },
            { id: '2', parentId: '0', title: 'Real', url: 'http://e.com/' }
        ]);
        expect(html).toContain('<hr class="separator-line" role="separator">');
        expect(html).toContain('<i>Real</i>');
        expect(separatorManager.added).toEqual(['1']);
    });

    it('treats nodes with dateGroupModified but no children as folders', () => {
        const tr = setup();
        const html = tr.generateHTML([
            { id: '10', parentId: '0', title: 'F', dateGroupModified: 1 }
        ]);
        expect(html).toContain('<li class="parent "');
        expect(html).toContain('class="tree-item-span"');
    });

    it('renders id-less nodes without an id attribute', () => {
        const tr = setup();
        const html = tr.generateHTML([{ title: 'Anon', url: 'http://e.com/' }]);
        expect(html).toContain('<li class="child "  level="0"');
        expect(html).toContain('data-parentid="undefined"');
    });
});

describe('generateNodeTrees', () => {
    it('records non-root folders and skips roots and bookmarks', () => {
        const tr = setup();
        const list = {};
        tr.generateNodeTrees([
            { id: 'R', folderType: 'bookmarks-bar', children: [
                { id: '10', parentId: 'R', title: 'F1' },
                { id: '11', parentId: 'R', title: 'B1', url: 'http://e.com/' }
            ] }
        ], list);
        expect(list).toEqual({ 10: 'R' });
    });

    it('recurses into nested children', () => {
        const tr = setup();
        const list = {};
        tr.generateNodeTrees([
            { id: 'R', folderType: 'bookmarks-bar', children: [
                { id: '10', parentId: 'R', children: [
                    { id: '20', parentId: '10' }
                ] }
            ] }
        ], list);
        expect(list).toEqual({ 10: 'R', 20: '10' });
    });

    it('tolerates null/undefined data', () => {
        const tr = setup();
        const list = {};
        tr.generateNodeTrees(null, list);
        tr.generateNodeTrees(undefined, list);
        expect(list).toEqual({});
    });
});

describe('getParentPath', () => {
    it('resolves a full ancestor chain, root first', () => {
        const tr = setup();
        expect(tr.getParentPath('5', { 5: '3', 3: '1' })).toEqual(['1', '3', '5']);
    });

    it('stops at self-loops', () => {
        const tr = setup();
        expect(tr.getParentPath('1', { 1: '1' })).toEqual(['1']);
    });

    it('truncates at nodes missing from the list', () => {
        const tr = setup();
        expect(tr.getParentPath('9', {})).toEqual(['9']);
        expect(tr.getParentPath('9', { 9: '8' })).toEqual(['8', '9']);
    });
});

describe('findFolderByType', () => {
    it('finds a nested folder by folderType', () => {
        const tr = setup();
        const mobile = { id: '3', folderType: 'mobile' };
        const tree = [
            { id: '1', folderType: 'bookmarks-bar', children: [
                { id: '2', children: [mobile] }
            ] }
        ];
        expect(tr.findFolderByType(tree, 'mobile')).toBe(mobile);
    });

    it('returns null when absent or input is not an array', () => {
        const tr = setup();
        expect(tr.findFolderByType([{ id: '1', folderType: 'other' }], 'mobile')).toBe(null);
        expect(tr.findFolderByType(null, 'mobile')).toBe(null);
        expect(tr.findFolderByType('nope', 'mobile')).toBe(null);
    });
});

describe('getEffectiveSubTree', () => {
    it('returns tree[0].children for the legacy single-root layout', () => {
        const tr = setup();
        const kids = [{ id: '1' }, { id: '2' }];
        expect(tr.getEffectiveSubTree([{ id: 'root', children: kids }])).toBe(kids);
    });

    it('combines children of all roots in dual-storage Chrome', () => {
        const tr = setup();
        const tree = [
            { id: '0', folderType: 'bookmarks-bar', children: [{ id: '10' }] },
            { id: '1', folderType: 'other', children: [{ id: '20' }, { id: '21' }] }
        ];
        expect(tr.getEffectiveSubTree(tree).map(n => n.id)).toEqual(['10', '20', '21']);
    });

    it('returns [] for empty or invalid input', () => {
        const tr = setup();
        expect(tr.getEffectiveSubTree([])).toEqual([]);
        expect(tr.getEffectiveSubTree(null)).toEqual([]);
        expect(tr.getEffectiveSubTree('nope')).toEqual([]);
    });
});

describe('isRootFolder', () => {
    let tr;
    beforeEach(() => { tr = setup(); });

    it('treats numeric parentId 0 as root', () => {
        expect(tr.isRootFolder({ id: '1', parentId: 0 })).toBe(true);
    });

    it('treats string parentId "0" as root', () => {
        expect(tr.isRootFolder({ id: '1', parentId: '0' })).toBe(true);
    });

    it('treats any node with a folderType as root', () => {
        expect(tr.isRootFolder({ id: '1', parentId: '5', folderType: 'other' })).toBe(true);
    });

    it('treats ordinary nodes as non-root', () => {
        expect(tr.isRootFolder({ id: '1', parentId: '5' })).toBe(false);
        expect(tr.isRootFolder({ id: '1', parentId: '0', url: 'http://e.com/' })).toBe(true);
    });
});
