import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initTreeRender, buildPathMap, relativeTimeBucket, relTimeLabel } from '../src/tree-render.js';
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
        runtime: { getURL: path => `chrome-extension://test${path}`, lastError: null },
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
    getRememberState: env.getRememberState || (() => true),
    ...(env.staging ? { staging: env.staging } : {})
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

    it('matches URLSearchParams byte-for-byte on a tricky-URL corpus (H3)', () => {
        const tr = setup();
        const corpus = [
            'http://e.com/',
            'http://x.com/a b?q="1"',
            "https://example.org/path with spaces/файл?q=a+b&x=!*'()~#%25",
            'chrome-extension://foo/bar',
            'javascript:void(0)',
            'https://例子.测试/路径?查询=值#锚',
            'http://a.com/?q=1&r=2',
            'https://b.com/café?x=ümlaut',
            "http://c.com/[brackets]?q={curly}|pipe\\back^tick`tick",
            '<https://d.com/tag>&"quote"\'apos',
            'http://e.com/%20encoded%20space',
            'https://f.com/emoji/🔖?x=🎉',
            'https://g.com/?q=percent%25and%2Bplus',
            'ftp://h.com/file name.txt'
        ];
        for (const url of corpus) {
            const ref = new URL(chrome.runtime.getURL('/_favicon/'));
            ref.searchParams.set('pageUrl', url);
            ref.searchParams.set('size', '32');
            expect(tr.getFaviconUrl(url)).toBe(ref.toString());
        }
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

    it('escapes & — first in the chain, so the entity output stays intact', () => {
        // escape.js completes the quartet (& < > "); a double-feed would
        // show as &amp;lt; here.
        expect(tr.highlightTitlePositions('a&b<c', null)).toBe('a&amp;b&lt;c');
        expect(tr.highlightTitlePositions('a&b', [1])).toBe('a<mark>&amp;</mark>b');
    });
});

describe('generateBookmarkHTML', () => {
    it('produces the exact row HTML for a plain bookmark (no extras, no sync)', () => {
        const tr = setup();
        const expected = [
            `<a href="http://e.com/" title="http://e.com/" tabindex="-1"  class="tree-item-link">`,
            `                <div class="favicon-container">`,
            `                    <img src="${FAV_E}" width="16" height="16" alt="" loading="lazy">`,
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

    it('escapes & in href, tooltip and name (escape.js covers the full quartet)', () => {
        const tr = setup();
        const html = tr.generateBookmarkHTML('R&D', 'http://e.com/?a=1&b=2', '', '1');
        expect(html).toContain('href="http://e.com/?a=1&amp;b=2"');
        expect(html).toContain('title="http://e.com/?a=1&amp;b=2"');
        expect(html).toContain('<i>R&amp;D</i>');
    });

    it('falls back to the protocol-stripped url when the title is empty', () => {
        const tr = setup();
        expect(tr.generateBookmarkHTML('', 'http://e.com/path', '', '1'))
            .toContain('<i>e.com/path</i>');
        expect(tr.generateBookmarkHTML('', 'https://e.com/', '', '1'))
            .toContain('<i>e.com/</i>');
    });

    it('escapes the protocol-stripped url fallback of an untitled bookmark', () => {
        // Regression (v4.0 leftover): the display-name fallback fed the raw
        // scheme-stripped URL into innerHTML while the tooltip escaped the
        // same expression — a < > " & URL injected markup into the row.
        const tr = setup();
        const html = tr.generateBookmarkHTML('', 'https://e.com/<b>?q="1"&r=2', '', '1');
        expect(html).toContain('<i>e.com/&lt;b&gt;?q=&quot;1&quot;&amp;r=2</i>');
        expect(html).not.toContain('<i>e.com/<b>');
        // the tooltip escapes the same expression (whole url, scheme kept)
        expect(html).toContain('title="https://e.com/&lt;b&gt;?q=&quot;1&quot;&amp;r=2"');
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
            .toContain('tabindex="-1" data-virtual="1" class="tree-item-link"');
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

    // v4 task-2 slice B (docs/plan-4.0.0/v4task-2-list.md §3.3): meta.rightText/subText
    // override the two label slots wholesale (recent view's custom meta).
    it('meta.rightText/subText override the path labels and are escaped', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            path: 'Folder A',
            rightText: '5 min< ago',
            subText: 'Folder A · 2026/7/24 "10:00"'
        });
        expect(html).toContain('<span class="row-path" dir="auto">5 min&lt; ago</span>');
        expect(html).toContain('<span class="row-sub" dir="auto">Folder A · 2026/7/24 &quot;10:00&quot;</span>');
        expect(html).not.toContain('>Folder A</span>'); // the path label is fully replaced
    });

    it('meta.rightText/subText ignore the showItemPath setting', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            path: 'Folder A', rightText: 'just now', subText: 'yesterday'
        });
        expect(html).toContain('<span class="row-path" dir="auto">just now</span>');
        expect(html).toContain('<span class="row-sub" dir="auto">yesterday</span>');
    });

    it('an empty-string override suppresses that slot', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            path: 'Folder A', rightText: '', subText: ''
        });
        expect(html).toContain('<i>T</i>'); // plain name slot
        expect(html).not.toContain('row-path');
    });

    // v4.0.7 死链视图: meta.tooltipAppend 追加 tooltip 末行(标记/检测时间),
    // meta.subRight 让第二行变"左路径 + 右时间"双子结构 —— 均为可选, 其他
    // 视图不传时保持原有纯文本 `.row-sub` 不变.
    it('meta.tooltipAppend joins the tooltip as a trailing escaped line', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            path: 'Folder A', tooltipAppend: 'Marked at 8/16/2026 "10:00"'
        });
        expect(html).toContain('title="T\nhttp://e.com/\nFolder A\nMarked at 8/16/2026 &quot;10:00&quot;"');
    });

    it('meta.subRight renders a two-child row-sub (left path, right time)', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            path: 'Folder A', subText: 'Folder A', subRight: '8/16/2026 <b>10:00</b>'
        });
        expect(html).toContain(
            '<span class="row-sub" dir="auto">' +
            '<span class="row-sub-left">Folder A</span>' +
            '<span class="row-sub-right">8/16/2026 &lt;b&gt;10:00&lt;/b&gt;</span>' +
            '</span>');
        // 右侧时间槽存在时仍保留 row-path(窄模式路径)
        expect(html).toContain('<span class="row-path" dir="auto">Folder A</span>');
    });

    it('subRight without subText yields a lone right child; without either the row-sub is untouched', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, { subRight: '8/16/2026' }))
            .toContain('<span class="row-sub" dir="auto"><span class="row-sub-right">8/16/2026</span></span>');
        // 不传 subRight → 仍是老结构的纯文本 sub（tree 等视图回归锁定）
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, { path: 'Folder A' }))
            .toContain('<span class="row-sub" dir="auto">Folder A</span>');
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, { path: 'Folder A' }))
            .not.toContain('row-sub-left');
    });

    // v4 task-2 slice C (docs/plan-4.0.0/v4task-2-list.md §3.5): meta.badge renders a
    // status pill (dead/blocked) between the main slot and the right slot.
    it('meta.badge renders the pill between row-main and row-path', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            path: 'Folder A',
            rightText: 'Folder A',
            badge: { text: '404', cls: 'dead' }
        });
        expect(html).toContain(
            '</span><span class="row-badge dead">404</span><span class="row-path" dir="auto">');
    });

    it('meta.badge alone (no label slots) still switches to the rich layout', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badge: { text: 'timeout', cls: 'blocked' }
        });
        expect(html).toContain(
            '<span class="row-main"><i>T</i></span><span class="row-badge blocked">timeout</span>');
        expect(html).not.toContain('row-path');
    });

    it('meta.badge escapes text and class', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badge: { text: '<b>', cls: 'x" onmouseover="' }
        });
        expect(html).toContain('<span class="row-badge x&quot; onmouseover=&quot;">&lt;b&gt;</span>');
    });

    // 4.0.7 死链视图 pill 外层槽：meta.badgeSlot 把 pill 包进固定宽度槽
    // .row-badge-slot，让 pill 背景维持文本长度、时间右对齐到槽左边缘。只影响
    // 显式传 badgeSlot 的调用方——其他视图不传 → 与老结构完全一致。
    it('meta.badgeSlot wraps the pill in the fixed-width slot; absent → unchanged', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const slotted = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badgeSlot: true,
            badge: { text: '404', cls: 'dead' }
        });
        expect(slotted).toContain('<span class="row-badge-slot"><span class="row-badge dead">404</span></span>');
        // 多个 badge 也整体包进同一个槽
        const multi = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badgeSlot: true,
            badge: [
                { text: '★', cls: 'starred' },
                { text: '×5', cls: 'count' }
            ]
        });
        expect(multi).toContain(
            '<span class="row-badge-slot"><span class="row-badge starred">★</span>' +
            '<span class="row-badge count">×5</span></span>');
        // 不传 badgeSlot → 无槽包裹（老结构回归锁定）
        const plain = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badge: { text: '404', cls: 'dead' }
        });
        expect(plain).toContain('<span class="row-badge dead">404</span>');
        expect(plain).not.toContain('row-badge-slot');
        // badge 为空时槽不渲染空壳
        const empty = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badgeSlot: true,
            badge: { text: '', cls: 'dead' }
        });
        expect(empty).not.toContain('row-badge-slot');
        expect(empty).not.toContain('row-badge');
    });

    // batch-deletion slice: meta.badge may be an ARRAY — the merged stats
    // rows render the enlarged ★ marker next to the count/time pill. Each
    // entry gets its own span, empty/absent entries are skipped.
    it('meta.badge as an array renders one span per entry, skipping empties', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badge: [
                { text: '★', cls: 'starred', aria: 'Bookmarked' },
                { text: '×5', cls: 'count', aria: 'Visited 5 times' },
                null,
                { text: '', cls: 'dead' } // empty text skipped
            ]
        });
        expect(html).toContain(
            '<span class="row-badge starred" aria-label="Bookmarked">★</span>' +
            '<span class="row-badge count" aria-label="Visited 5 times">×5</span>');
        expect(html).not.toContain('row-badge dead');
        expect(html).toContain('row-main');
    });

    // The stats rows feed badge:[time, count] + rightText:path; tree-render
    // emits badge spans BEFORE the row-path span, and CSS order (stats-scoped)
    // flips that to path → time → count visually. Pin the raw DOM order so the
    // CSS-order contract has something to build on.
    it('meta.badge array emits badge spans before the row-path span', () => {
        const tr = setup({ store: makeStore({ showItemPath: '1' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            path: 'Folder A',
            rightText: 'Folder A',
            badge: [
                { text: 'just now', cls: 'time' },
                { text: '×5', cls: 'count', aria: 'Visited 5 times' }
            ]
        });
        const badgeAt = html.indexOf('row-badge time');
        const pathAt = html.indexOf('row-path');
        expect(badgeAt).toBeGreaterThan(-1);
        expect(pathAt).toBeGreaterThan(badgeAt); // badges first, then row-path
    });

    it('meta.badge as an empty array renders the plain layout', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, { badge: [] });
        expect(html).toContain('<i>T</i>');
        expect(html).not.toContain('row-badge');
    });

    // v4 task-2 slice D: meta.badge.aria adds an aria-label (the stats ×N
    // count pill is not self-explanatory to screen readers).
    it('meta.badge.aria renders an escaped aria-label', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badge: { text: '×42', cls: 'count', aria: 'Visited "42" times' }
        });
        expect(html).toContain(
            '<span class="row-badge count" aria-label="Visited &quot;42&quot; times">×42</span>');
    });

    it('meta.badge without aria keeps the bare pill markup', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        const html = tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {
            badge: { text: '404', cls: 'dead' }
        });
        expect(html).toContain('<span class="row-badge dead">404</span>');
        expect(html).not.toContain('aria-label');
    });

    it('a missing/empty badge keeps the legacy markup', () => {
        const tr = setup({ store: makeStore({ showItemPath: '' }) });
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, { badge: { text: '', cls: 'dead' } }))
            .not.toContain('row-badge');
        expect(tr.generateBookmarkHTML('T', 'http://e.com/', '', '1', null, {}))
            .not.toContain('row-badge');
    });
});

describe('relativeTimeBucket (v4 task-2 slice B)', () => {
    const NOW = 1000000000000;
    const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    const bucket = ageMs => relativeTimeBucket(NOW - ageMs, NOW);

    it('buckets the boundary ages per docs/plan-4.0.0/v4task-2-list.md §3.3', () => {
        expect(bucket(0)).toEqual({ key: 'timeJustNow' });
        expect(bucket(MIN - 1)).toEqual({ key: 'timeJustNow' });
        expect(bucket(MIN)).toEqual({ key: 'timeMinutesAgo', n: 1 });
        expect(bucket(59 * MIN)).toEqual({ key: 'timeMinutesAgo', n: 59 });
        expect(bucket(HOUR)).toEqual({ key: 'timeHoursAgo', n: 1 });
        expect(bucket(23 * HOUR)).toEqual({ key: 'timeHoursAgo', n: 23 });
        expect(bucket(DAY)).toEqual({ key: 'timeYesterday' });
        expect(bucket(2 * DAY - 1)).toEqual({ key: 'timeYesterday' });
        expect(bucket(2 * DAY)).toEqual({ key: 'timeDaysAgo', n: 2 });
        expect(bucket(7 * DAY)).toEqual({ key: 'timeDaysAgo', n: 7 });
        expect(bucket(7 * DAY + 1)).toEqual({ key: null }); // caller shows the absolute date
    });

    it('clamps future timestamps to just-now', () => {
        expect(relativeTimeBucket(NOW + HOUR, NOW)).toEqual({ key: 'timeJustNow' });
    });
});

describe('relTimeLabel (shared bucket → label helper)', () => {
    const NOW = Date.now();
    const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    // _m double recording the substitution arguments it is called with.
    const makeM = () => {
        const calls = [];
        const m = (key, subs) => { calls.push([key, subs]); return `[${key}]`; };
        m.calls = calls;
        return m;
    };

    it('renders empty for falsy timestamps instead of a 1970 date', () => {
        const m = makeM();
        expect(relTimeLabel(0, m)).toBe('');
        expect(relTimeLabel(null, m)).toBe('');
        expect(relTimeLabel(undefined, m)).toBe('');
        expect(m.calls).toEqual([]);
    });

    it('passes the bucket n through as the _m substitution', () => {
        const m = makeM();
        expect(relTimeLabel(NOW - 3 * MIN, m)).toBe('[timeMinutesAgo]');
        expect(m.calls).toEqual([['timeMinutesAgo', '3']]);
        expect(relTimeLabel(NOW - 5 * HOUR, m)).toBe('[timeHoursAgo]');
        expect(m.calls).toEqual([['timeMinutesAgo', '3'], ['timeHoursAgo', '5']]);
        expect(relTimeLabel(NOW - 2 * DAY, m)).toBe('[timeDaysAgo]');
        expect(relTimeLabel(NOW - 30 * 1000, m)).toBe('[timeJustNow]');
        expect(relTimeLabel(NOW - DAY, m)).toBe('[timeYesterday]');
    });

    it('falls back to the absolute locale date past 7 days', () => {
        const m = makeM();
        const ts = NOW - 8 * DAY;
        expect(relTimeLabel(ts, m)).toBe(new Date(ts).toLocaleDateString());
        expect(m.calls).toEqual([]);
    });
});

describe('buildPathMap (v4 task-2 §3.6)', () => {
    it('maps each node to its ancestor folder path, skipping the invisible root and untitled folders', () => {
        const { paths } = buildPathMap([{
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
        expect(paths['0']).toBeUndefined(); // invisible root contributes nothing
        expect(paths['1']).toBe(''); // sits at the root
        expect(paths['11']).toBe('Folder A');
        expect(paths['21']).toBe('Folder A'); // untitled folder adds no segment
        expect(paths['31']).toBe('Folder A / Sub B');
        expect(paths['4']).toBe('');
    });

    it('collects the live bookmark ids in the same walk (H5: feeds visitStats.prune)', () => {
        const { ids } = buildPathMap([{
            id: '0', title: '', children: [
                {
                    id: '1', parentId: '0', title: 'Folder A', children: [
                        { id: '11', parentId: '1', title: 'GitHub', url: 'https://x.com/' },
                        { id: '12', parentId: '1', title: 'Empty' }
                    ]
                },
                { id: '2', parentId: '0', title: 'Top', url: 'https://t.com/' }
            ]
        }]);
        expect(ids.has('11')).toBe(true);
        expect(ids.has('2')).toBe(true);
        expect(ids.has('1')).toBe(false); // folders are not bookmark ids
        expect(ids.has('12')).toBe(false); // url-less nodes are not bookmark ids
        expect(ids.size).toBe(2);
    });

    it('handles empty input', () => {
        for (const input of [null, [], [{ id: '0', title: '' }]]) {
            const { paths, ids } = buildPathMap(input);
            expect(paths).toEqual({});
            expect(ids.size).toBe(0);
        }
    });
});

describe('generateFolderHTML', () => {
    it('produces the exact row HTML for a plain folder', () => {
        const tr = setup();
        const expected = [
            `<span tabindex="-1" style="-webkit-padding-start: 0px" class="tree-item-span">`,
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
        // Separator is CSS-driven: the <a> gets the separator-row class and
        // the <hr> fills the flex row (flex: 1). Colors come from
        // --vbm-border, no more inline styles.
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

describe('tree-row quick actions (treeRowActions option)', () => {
    // the suite's store double returns undefined for unset keys (no default
    // application), so the ON cases seed the switches explicitly
    const BM = { id: '1', parentId: '0', title: 'A', url: 'http://e.com/' };

    it('renders the edit + stage + delete tail on bookmark rows when on', () => {
        const tr = setup({ store: makeStore({ treeRowActions: '1', stagingEnabled: '1', showRecentBookmarks: '1' }) });
        const html = tr.generateHTML([BM]);
        expect(html).toContain('tree-row-edit');
        expect(html).toContain('tree-row-delete');
        expect(html).toContain('staging-add-btn');
    });

    it('treeRowActions off removes the whole tail', () => {
        const tr = setup({ store: makeStore({ treeRowActions: '0', stagingEnabled: '1', showRecentBookmarks: '1' }) });
        const html = tr.generateHTML([BM]);
        expect(html).not.toContain('tree-row-edit');
        expect(html).not.toContain('tree-row-delete');
        expect(html).not.toContain('staging-add-btn');
    });

    it('stagingEnabled off keeps edit+delete but drops the stage plane', () => {
        const tr = setup({ store: makeStore({ treeRowActions: '1', stagingEnabled: '0', showRecentBookmarks: '1' }) });
        const html = tr.generateHTML([BM]);
        expect(html).toContain('tree-row-edit');
        expect(html).toContain('tree-row-delete');
        expect(html).not.toContain('staging-add-btn');
    });

    // 2026-08-26 report round: a DISABLED staging view (showRecentBookmarks
    // off) drops the stage plane exactly like the master switch.
    it('a disabled staging view drops the stage plane too', () => {
        const tr = setup({ store: makeStore({ treeRowActions: '1', stagingEnabled: '1', showRecentBookmarks: '' }) });
        const html = tr.generateHTML([BM]);
        expect(html).toContain('tree-row-edit');
        expect(html).toContain('tree-row-delete');
        expect(html).not.toContain('staging-add-btn');
    });

    // 2026-08-26 report: the view-tab right-click Disable
    // (disableRecentView) drops the stage plane the same way.
    it('a right-click DISABLED view drops the stage plane too', () => {
        const tr = setup({ store: makeStore({ treeRowActions: '1', stagingEnabled: '1', showRecentBookmarks: '1', disableRecentView: '1' }) });
        const html = tr.generateHTML([BM]);
        expect(html).not.toContain('staging-add-btn');
        expect(html).toContain('tree-row-edit'); // non-staging actions stay
    });

    it('folder rows carry edit+delete; the folder plane needs a staging api', () => {
        const tr = setup({ store: makeStore({ treeRowActions: '1', stagingEnabled: '1', showRecentBookmarks: '1' }) });
        const html = tr.generateHTML([{ id: '5', parentId: '0', title: 'F', children: [BM] }]);
        expect(html).toContain('tree-row-edit');
        expect(html).toContain('tree-row-delete');
        // no ctx.staging injected → folderStageBtnHtml yields nothing
        expect(html).not.toContain('staging-add-btn');
    });

    // 2026-08-27 real-data perf round: the tail icons are SVG-sprite <use>
    // references (icons.js ICON_SPRITE_SHEET), not per-row inline <svg> —
    // 3 inline copies per row × 5000+ rows dominated the cold-open parse.
    it('tail buttons reference the sprite sheet and carry NO inline svg', () => {
        const tr = setup({ store: makeStore({ treeRowActions: '1', stagingEnabled: '1', showRecentBookmarks: '1' }) });
        const html = tr.generateHTML([BM]);
        expect(html).toContain('<use href="#vbm-ic-edit"/>');
        expect(html).toContain('<use href="#vbm-ic-trash"/>');
        expect(html).toContain('<use href="#vbm-ic-stage"/>');
        // the tail block carries no inline svg (sprite svgs have no viewBox —
        // every inline icon did); scoped from the tail onward because the
        // row's folder/bookmark chrome may still embed other svgs
        const tail = html.slice(html.indexOf('tree-row-edit'));
        expect(tail).not.toContain('viewBox');
    });

    it('the sprite sheet symbols mirror the inline icons byte-for-byte', async () => {
        const icons = await import('../src/icons.js');
        for (const [name, inline] of [['edit', icons.EDIT_ICON], ['trash', icons.TRASH_ICON], ['stage', icons.STAGE_ICON], ['stage-done', icons.STAGE_ICON_DONE], ['stage-remove', icons.STAGE_REMOVE_ICON], ['pin', icons.PIN_ICON], ['pin-filled', icons.PIN_ICON_FILLED], ['sleep', icons.SLEEP_ICON], ['sleep-filled', icons.SLEEP_ICON_FILLED], ['star', icons.STAR_ICON], ['star-filled', icons.STAR_ICON_FILLED], ['check', icons.CHECK_ICON], ['activate', icons.ACTIVATE_ICON], ['folder-star', icons.FOLDER_STAR_ICON], ['tabs', icons.TABS_ICON], ['open', icons.OPEN_ICON], ['ungroup', icons.UNGROUP_ICON], ['flag', icons.FLAG_ICON]]) {
            const inner = inline.slice(inline.indexOf('>') + 1, inline.lastIndexOf('</svg>'));
            expect(icons.ICON_SPRITE_SHEET, name).toContain(inner);
            // presentation attributes survived the move onto the <symbol>
            for (const attr of ['fill=', 'stroke=', 'stroke-width='])
                expect(icons.ICON_SPRITE_SHEET, `${name}:${attr}`).toContain(attr);
        }
        // the referencing button svg keeps the class hooks + a use per icon
        for (const name of ['edit', 'trash', 'stage', 'stage-done', 'stage-remove', 'pin', 'pin-filled', 'sleep', 'sleep-filled', 'star', 'star-filled', 'check', 'activate', 'folder-star', 'tabs', 'open', 'ungroup', 'flag'])
            expect(icons.spriteIcon(name)).toContain(`class="vbm-icon vbm-icon-${name}"`);
    });
});

describe('per-render-pass memoization (2026-08 perf audit)', () => {
    // A nested chain with every folder open: F1 [A, F2 [B, F3 [C]]].
    const NESTED = [
        { id: '1', parentId: '0', title: 'F1', dateGroupModified: 1, children: [
            { id: '11', parentId: '1', title: 'A', url: 'http://a/' },
            { id: '12', parentId: '1', title: 'F2', dateGroupModified: 1, children: [
                { id: '121', parentId: '12', title: 'B', url: 'http://b/' },
                { id: '122', parentId: '12', title: 'F3', dateGroupModified: 1, children: [
                    { id: '1221', parentId: '122', title: 'C', url: 'http://c/' }
                ] }
            ] }
        ] }
    ];
    const OPENS = ['1', '12', '122'];
    const ROW_STORE = makeStore({ treeRowActions: '1', stagingEnabled: '1', showRecentBookmarks: '1' });

    it('converts opens to a Set once per pass, not one getOpens read per row', () => {
        let opensReads = 0;
        const tr = setup({ getOpens: () => { opensReads++; return OPENS; } });
        const html = tr.generateHTML(NESTED);
        expect(opensReads).toBe(1); // 6 rows, one read
        expect(html).toContain('id="neat-tree-item-1221"'); // the open chain rendered
    });

    it('rememberState off never reads opens (the short-circuit is preserved)', () => {
        let opensReads = 0;
        const tr = setup({
            getOpens: () => { opensReads++; return OPENS; },
            getRememberState: () => false
        });
        const html = tr.generateHTML(NESTED);
        expect(opensReads).toBe(0);
        expect(html).not.toContain('id="neat-tree-item-1221"'); // closed: no children
    });

    it('folder staged verdicts are bottom-up memoized — one verdict-side isStaged call per bookmark', () => {
        const stagedCalls = [];
        const staging = { isStaged: url => { stagedCalls.push(url); return true; } };
        const tr = setup({ store: ROW_STORE, staging, getOpens: () => OPENS });
        const html = tr.generateHTML(NESTED);
        // 3 bookmark-row planes + 3 verdict-side calls. The unmemoized shape
        // re-walked each folder's subtree per row: 3 + (3+2+1) = 9 calls.
        expect(stagedCalls).toHaveLength(6);
        // all staged → all three folder planes show the solid plane
        expect(html.match(/staging-add-btn staged/g)).toHaveLength(6); // 3 rows + 3 folders
        expect(html.match(/aria-pressed="true"/g)).toHaveLength(6);
    });

    it('a partially staged subtree marks only the fully staged folder', () => {
        const staging = { isStaged: url => url !== 'http://b/' };
        const tr = setup({ store: ROW_STORE, staging, getOpens: () => OPENS });
        const html = tr.generateHTML(NESTED);
        // staged: bookmark rows A + C and folder F3 (C only); F1/F2 contain B
        expect(html.match(/staging-add-btn staged/g)).toHaveLength(3);
        expect(html.match(/aria-pressed="false"/g)).toHaveLength(3);
    });
});

describe('generateHTML', () => {
    it('renders the muted empty-folder row for empty data, padded onto the text axis', () => {
        const tr = setup();
        expect(tr.generateHTML([])).toBe(
            '<ul role="tree" data-level="0"><li class="empty-folder" ' +
            'style="-webkit-padding-start: 40px"><i>(Empty)</i></li></ul>');
    });

    it('uses role=group and scaled padding at deeper levels', () => {
        const tr = setup();
        expect(tr.generateHTML([], 2)).toBe(
            '<ul role="group" data-level="2"><li class="empty-folder" ' +
            'style="-webkit-padding-start: 88px"><i>(Empty)</i></li></ul>');
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
        expect(html).toContain('style="-webkit-padding-start: 24px"');
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

describe('buildTreeSnapshot blocks (2026-08-28 chunked tree paint)', () => {
    it('blocks join + wrapper === the one-shot html (same code path)', () => {
        const tr = setup({});
        const data = [
            { id: 'a', parentId: '0', title: 'A', children: [
                { id: 'a1', parentId: 'a', title: 'a1', url: 'http://e.com/1' },
                { id: 'a2', parentId: 'a', title: 'a2', url: 'http://e.com/2' }
            ] },
            { id: 'b', parentId: '0', title: 'B', url: 'http://e.com/b' }
        ];
        const snap = tr.buildTreeSnapshot([{
            id: '0', title: 'root', children: data
        }]);
        expect(snap.blocks.length).toBe(2);
        expect(snap.html).toBe(`<ul role="tree" data-level="0">${snap.blocks.join('')}</ul>`);
        // folders render closed without an opens seed — block 0 is A's own
        // row (its children join once expanded), block 1 the bookmark row
        expect(snap.blocks[0]).toContain('id="neat-tree-item-a"');
        expect(snap.blocks[1]).toContain('id="neat-tree-item-b"');
    });

    it('empty display keeps the (Empty) row and blocks null', () => {
        const tr = setup({});
        const snap = tr.buildTreeSnapshot([]);
        expect(snap.blocks).toBe(null);
        expect(snap.html).toContain('empty-folder');
    });
});

describe('buildTreeSnapshot (P1-1: single-walk tree snapshot)', () => {
    it('produces html + all derived maps in one snapshot (dual storage)', () => {
        const tr = setup();
        const tree = [
            {
                id: 'bar', parentId: '0', title: 'Bookmarks Bar', folderType: 'bookmarks-bar', children: [
                    {
                        id: '10', parentId: 'bar', title: 'Folder A', children: [
                            { id: '11', parentId: '10', title: 'GitHub', url: 'https://x.com/' },
                            {
                                id: '12', parentId: '10', title: 'Nested', children: [
                                    { id: '13', parentId: '12', title: 'Deep', url: 'https://y.com/' }
                                ]
                            }
                        ]
                    },
                    { id: '14', parentId: 'bar', title: 'Top', url: 'https://t.com/' }
                ]
            },
            {
                id: 'other', parentId: '0', title: 'Other Bookmarks', folderType: 'other', children: [
                    { id: '20', parentId: 'other', title: 'Other BM', url: 'https://o.com/' }
                ]
            }
        ];
        const subTree = tr.getEffectiveSubTree(tree);
        const snap = tr.buildTreeSnapshot(tree, subTree);
        expect(snap.html).toBe(tr.generateHTML(subTree));
        expect(snap.paths).toEqual(buildPathMap(tree).paths);
        expect([...snap.ids].sort()).toEqual([...buildPathMap(tree).ids].sort());
        // nodeTrees/bookmarkIds cover the DISPLAYED subtree only
        expect(snap.nodeTrees['10']).toBe('bar');
        expect(snap.nodeTrees['12']).toBe('10');
        expect(snap.nodeTrees['11']).toBe('10');
        expect(snap.nodeTrees['14']).toBe('bar');
        expect(snap.nodeTrees['20']).toBe('other');
        expect(snap.nodeTrees['bar']).toBeUndefined();  // roots are never rows
        expect(snap.nodeTrees['other']).toBeUndefined();
        expect([...snap.bookmarkIds].sort()).toEqual(['11', '13', '14', '20']);
        // G8 (2026-08-26 acceptance audit): the urlIndex contract — every
        // bookmark url maps to its FIRST tree-order id (duplicates keep the
        // earliest), and non-url nodes never appear.
        expect(snap.urlIndex.get('https://x.com/')).toBe('11');
        expect(snap.urlIndex.get('https://y.com/')).toBe('13');
        expect(snap.urlIndex.get('https://t.com/')).toBe('14');
        expect(snap.urlIndex.get('https://o.com/')).toBe('20');
        expect(snap.urlIndex.has('https://nope.com/')).toBe(false);
    });

    it('urlIndex keeps the FIRST id for a duplicated url (relink baseline)', () => {
        const tr = setup();
        const tree = [{
            id: 'bar', parentId: '0', title: 'Bar', children: [
                { id: '30', parentId: 'bar', title: 'A', url: 'https://d.com/' },
                { id: '31', parentId: 'bar', title: 'A dupe', url: 'https://d.com/' },
                { id: '32', parentId: 'bar', title: 'B', url: 'https://e.com/' }
            ]
        }];
        const snap = tr.buildTreeSnapshot(tree, tree[0].children);
        expect(snap.urlIndex.get('https://d.com/')).toBe('30'); // first, not last
        expect(snap.urlIndex.get('https://e.com/')).toBe('32');
        expect(snap.urlIndex.size).toBe(2);
    });

    it('honors a bar-only display subtree while paths/ids still cover the full tree', () => {
        const tr = setup();
        const tree = [
            {
                id: 'bar', parentId: '0', title: 'Bookmarks Bar', folderType: 'bookmarks-bar', children: [
                    { id: '10', parentId: 'bar', title: 'Folder A', children: [
                        { id: '11', parentId: '10', title: 'GitHub', url: 'https://x.com/' }
                    ] }
                ]
            },
            {
                id: 'other', parentId: '0', title: 'Other Bookmarks', folderType: 'other', children: [
                    { id: '20', parentId: 'other', title: 'Outside', url: 'https://o.com/' }
                ]
            }
        ];
        const barSub = tree[0].children; // onlyShowBMBar: the bar subtree renders
        const snap = tr.buildTreeSnapshot(tree, barSub);
        expect(snap.html).toBe(tr.generateHTML(barSub));
        expect(snap.html).not.toContain('https://o.com/'); // bar-only render
        expect(snap.nodeTrees['10']).toBe('bar');
        expect(snap.nodeTrees['11']).toBe('10');
        expect(snap.nodeTrees['20']).toBeUndefined();      // outside the display
        expect(snap.bookmarkIds.has('11')).toBe(true);
        expect(snap.bookmarkIds.has('20')).toBe(false);
        // path map + prune ids are still FULL-tree
        expect(snap.paths['20']).toBe('Other Bookmarks');
        expect(snap.ids.has('20')).toBe(true);
    });

    it('legacy single-root shape: only tree[0] children are displayed rows', () => {
        const tr = setup();
        const tree = [{
            id: '0', title: '', children: [
                { id: '1', parentId: '0', title: 'Folder A', children: [
                    { id: '3', parentId: '1', title: 'Sub', children: [
                        { id: '31', parentId: '3', title: 'Deep', url: 'https://d.com/' }
                    ] }
                ] },
                { id: '2', parentId: '0', title: 'Top', url: 'https://t.com/' }
            ]
        }];
        const snap = tr.buildTreeSnapshot(tree);
        expect(snap.html).toBe(tr.generateHTML(tr.getEffectiveSubTree(tree)));
        expect(snap.nodeTrees['3']).toBe('1');   // nested folder recorded
        expect(snap.nodeTrees['31']).toBe('3');  // bookmark parent recorded
        expect(snap.nodeTrees['2']).toBe('0');   // top-level bookmark recorded
        expect(snap.nodeTrees['1']).toBeUndefined(); // root folder (parentId 0) skipped
        expect(snap.bookmarkIds.has('31')).toBe(true);
        expect(snap.bookmarkIds.has('2')).toBe(true);
    });

    it('tolerates empty input', () => {
        const tr = setup();
        for (const input of [null, [], [{ id: '0', title: '' }]]) {
            const snap = tr.buildTreeSnapshot(input);
            expect(snap.html).toBe(tr.generateHTML([]));
            expect(snap.paths).toEqual({});
            expect(snap.ids.size).toBe(0);
            expect(snap.nodeTrees).toEqual({});
            expect(snap.bookmarkIds.size).toBe(0);
        }
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
