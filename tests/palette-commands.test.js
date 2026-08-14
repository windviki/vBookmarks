import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// palette-commands.js is chrome-free pure logic except executeCustom's
// open-url-group branch (chrome.bookmarks.getChildren + runtime.lastError),
// so the whole suite runs on plain doubles: a sync-mirror store, recording
// actions/views/dialogs and a per-test chrome stub.
import {
    PALETTE_RESERVED, CUSTOM_COMMANDS_KEY, MAX_CUSTOM_COMMANDS, SLASH_RE, URL_RE,
    ACTION_TYPES, WHERES_URL, WHERES_GROUP, PRESET_VIEWS,
    slashNamesOf, validateCommand, loadCustomCommands, saveCustomCommands,
    matchCustom, sortCustoms, executeCustom, summarizeAction
} from '../src/palette-commands.js';

const _m = (key, subs) => subs === undefined ? key : `${key}[${subs}]`;

const makeStore = (seed = {}) => {
    const data = { ...seed };
    return {
        data,
        getSyncSetting: (k, d) => (k in data ? data[k] : d),
        setSyncSetting: (k, v) => {
            data[k] = String(v);
        }
    };
};

const makeDeps = (over = {}) => ({
    store: makeStore(),
    actions: {
        openBookmarkCalls: [],
        openBookmarkNewTabCalls: [],
        openBookmarkNewWindowCalls: [],
        openBookmarksCalls: [],
        openBookmarksNewWindowCalls: [],
        openBookmark(url) { this.openBookmarkCalls.push(url); },
        openBookmarkNewTab(url, selected) { this.openBookmarkNewTabCalls.push([url, selected]); },
        openBookmarkNewWindow(url) { this.openBookmarkNewWindowCalls.push(url); },
        openBookmarks(urls, selected) { this.openBookmarksCalls.push([urls, selected]); },
        openBookmarksNewWindow(urls) { this.openBookmarksNewWindowCalls.push(urls); }
    },
    views: {
        activateCalls: [],
        activate(id, opts) { this.activateCalls.push([id, opts]); }
    },
    dialogs: {
        ConfirmDialog: {
            openCalls: [],
            open(cfg) { this.openCalls.push(cfg); }
        }
    },
    _m,
    onChangedCalls: [],
    onChanged() { this.onChangedCalls.push(1); },
    ...over
});

const openUrlCmd = (over = {}) => ({
    id: 'cc_1', name: 'Site', slash: 'site', aliases: [],
    action: { type: 'open-url', url: 'https://example.com/', where: 'tab' },
    useCount: 0, lastUsedAt: 0, ...over
});

beforeEach(() => {
    globalThis.chrome = {
        bookmarks: {
            getChildrenCalls: [],
            childrenTable: {},
            getChildren(id, cb) {
                this.getChildrenCalls.push(id);
                const kids = this.childrenTable[id];
                if (!kids) {
                    globalThis.chrome.runtime.lastError = { message: "Can't find folder" };
                    cb(undefined);
                } else {
                    globalThis.chrome.runtime.lastError = null;
                    cb(kids);
                }
            }
        },
        runtime: { lastError: null }
    };
});

afterEach(() => {
    delete globalThis.chrome;
});

describe('constants', () => {
    it('PALETTE_RESERVED holds 27 unique words, all slash-conformant', () => {
        expect(PALETTE_RESERVED).toHaveLength(27);
        expect(new Set(PALETTE_RESERVED).size).toBe(27);
        for (const w of PALETTE_RESERVED)
            expect(SLASH_RE.test(w), w).toBe(true);
    });

    it('the action types, wheres and preset views match the design whitelist', () => {
        expect(ACTION_TYPES).toEqual(['open-url', 'open-url-group', 'view-preset', 'url-template']);
        expect(WHERES_URL).toEqual(['current', 'tab', 'window', 'background']);
        expect(WHERES_GROUP).toEqual(['tab', 'window', 'background']); // a group never replaces the tab
        expect(PRESET_VIEWS).toEqual(['dupes', 'dead']);
        expect(MAX_CUSTOM_COMMANDS).toBe(100);
    });

    it('SLASH_RE: lowercase alnum start, dashes inside, 1-24 chars', () => {
        for (const ok of ['a', 'g', 'work', 'my-cmd', 'x'.repeat(24), 'a1'])
            expect(SLASH_RE.test(ok), ok).toBe(true);
        for (const bad of ['', 'A', '-ab', 'a b', 'ab!', 'a'.repeat(25), '/a', '_a', '中文'])
            expect(SLASH_RE.test(bad), JSON.stringify(bad)).toBe(false);
    });

    it('URL_RE: http(s) only', () => {
        expect(URL_RE.test('https://a.com/')).toBe(true);
        expect(URL_RE.test('http://a.com/')).toBe(true);
        expect(URL_RE.test('ftp://a.com/')).toBe(false);
        expect(URL_RE.test('javascript:alert(1)')).toBe(false);
        expect(URL_RE.test('a.com')).toBe(false);
    });
});

describe('slashNamesOf', () => {
    it('is the canonical slash plus aliases', () => {
        expect(slashNamesOf({ slash: 'work', aliases: ['wo', 'w'] })).toEqual(['work', 'wo', 'w']);
        expect(slashNamesOf({ slash: 'g' })).toEqual(['g']);
    });
});

describe('validateCommand', () => {
    const draftUrl = (over = {}) => ({
        slash: 'site', name: 'Site',
        action: { type: 'open-url', url: 'https://example.com/', where: 'tab' },
        ...over
    });

    it('accepts a well-formed draft and normalizes it', () => {
        const r = validateCommand(draftUrl({ slash: ' Site ' }));
        expect(r.ok).toBe(true);
        expect(r.command.slash).toBe('site'); // trimmed + lowercased
        expect(r.command.name).toBe('Site');
        expect(r.command.id).toMatch(/^cc_/);
        expect(r.command.useCount).toBe(0);
    });

    it('rejects a malformed slash', () => {
        for (const slash of ['', 'a b', 'ab!', '-x', 'x'.repeat(25)])
            expect(validateCommand(draftUrl({ slash })).error, JSON.stringify(slash))
                .toBe('paletteCustomErrSlash');
    });

    it('lowercases the slash before validating (Site → site is fine)', () => {
        expect(validateCommand(draftUrl({ slash: 'SITE' })).ok).toBe(true);
    });

    it('rejects a malformed alias; drops duplicates of the slash/each other', () => {
        expect(validateCommand(draftUrl({ aliases: ['no way'] })).error).toBe('paletteCustomErrAlias');
        const r = validateCommand(draftUrl({ aliases: ['S', 'site', 's', '  '] }));
        expect(r.ok).toBe(true);
        expect(r.command.aliases).toEqual(['s']); // case-folded, deduped, slash-dupe dropped
    });

    it('rejects collisions with the reserved words (case-insensitive)', () => {
        expect(validateCommand(draftUrl({ slash: 'add' })).error).toBe('paletteCustomErrTaken');
        expect(validateCommand(draftUrl({ slash: 'ADD' })).error).toBe('paletteCustomErrTaken');
        expect(validateCommand(draftUrl({ slash: 'ok1', aliases: ['theme'] })).error).toBe('paletteCustomErrTaken');
        // round-5's direct theme shortcuts are reserved too
        for (const w of ['dark', 'light', 'ink', 'paper'])
            expect(validateCommand(draftUrl({ slash: w })).error, w).toBe('paletteCustomErrTaken');
    });

    it('rejects collisions with other custom commands (slash + aliases), except itself on edit', () => {
        const existing = [
            { id: 'cc_a', slash: 'work', aliases: ['wo'], action: { type: 'open-url', url: 'https://a.com/', where: 'tab' } }
        ];
        expect(validateCommand(draftUrl({ slash: 'work' }), existing).error).toBe('paletteCustomErrTaken');
        expect(validateCommand(draftUrl({ slash: 'wo' }), existing).error).toBe('paletteCustomErrTaken');
        expect(validateCommand(draftUrl({ slash: 'new1', aliases: ['WO'] }), existing).error).toBe('paletteCustomErrTaken');
        // editing cc_a keeps its own names
        const r = validateCommand(draftUrl({ id: 'cc_a', slash: 'work', aliases: ['wo'] }), existing, 'cc_a');
        expect(r.ok).toBe(true);
        expect(r.command.id).toBe('cc_a');
    });

    it('open-url: requires an http(s) url; unknown where falls back to tab', () => {
        expect(validateCommand(draftUrl({ action: { type: 'open-url', url: '' } })).error).toBe('paletteCustomErrUrl');
        expect(validateCommand(draftUrl({ action: { type: 'open-url', url: 'ftp://x/' } })).error).toBe('paletteCustomErrUrl');
        const r = validateCommand(draftUrl({ action: { type: 'open-url', url: 'https://x.com/', where: 'sideways' } }));
        expect(r.command.action.where).toBe('tab');
        const r2 = validateCommand(draftUrl({ action: { type: 'open-url', url: 'https://x.com/', where: 'current' } }));
        expect(r2.command.action.where).toBe('current');
    });

    it('open-url-group: requires a folderId; defaults to background; current is not allowed', () => {
        const grp = action => draftUrl({ action: { type: 'open-url-group', ...action } });
        expect(validateCommand(grp({ folderId: '' })).error).toBe('paletteCustomErrFolder');
        expect(validateCommand(grp({ folderId: '50' })).command.action.where).toBe('background');
        expect(validateCommand(grp({ folderId: '50', where: 'current' })).command.action.where).toBe('background');
        expect(validateCommand(grp({ folderId: '50', where: 'window' })).command.action.where).toBe('window');
    });

    it('view-preset: dupes/dead only; strategy/scope/scan pass through when present', () => {
        const vp = action => draftUrl({ action: { type: 'view-preset', ...action } });
        expect(validateCommand(vp({ view: 'tree' })).error).toBe('paletteCustomErrView');
        const bare = validateCommand(vp({ view: 'dead' }));
        expect(bare.command.action).toEqual({ type: 'view-preset', view: 'dead' });
        const full = validateCommand(vp({ view: 'dupes', strategy: 'newest', scope: 'bar', scan: 1 }));
        expect(full.command.action).toEqual({ type: 'view-preset', view: 'dupes', strategy: 'newest', scope: 'bar', scan: true });
    });

    it('url-template: http(s) with exactly one %s', () => {
        const tpl = template => draftUrl({ action: { type: 'url-template', template, where: 'tab' } });
        expect(validateCommand(tpl('')).error).toBe('paletteCustomErrUrl');
        expect(validateCommand(tpl('ftp://x/%s')).error).toBe('paletteCustomErrUrl');
        expect(validateCommand(tpl('https://x.com/search')).error).toBe('paletteCustomErrTemplate');
        expect(validateCommand(tpl('https://x.com/%s/%s')).error).toBe('paletteCustomErrTemplate');
        const r = validateCommand(tpl('https://x.com/search?q=%s'));
        expect(r.ok).toBe(true);
        expect(r.command.action.template).toBe('https://x.com/search?q=%s');
    });

    it('an unknown action type is rejected', () => {
        expect(validateCommand(draftUrl({ action: { type: 'run-js' } })).error).toBe('paletteCustomErrAction');
        expect(validateCommand(draftUrl({ action: null })).error).toBe('paletteCustomErrAction');
    });

    it('the name falls back to the slash; edit-time fields survive normalization', () => {
        const r = validateCommand(draftUrl({ name: '  ' }));
        expect(r.command.name).toBe('site');
        const keep = validateCommand(draftUrl({ id: 'cc_9', createdAt: 42, useCount: 7, lastUsedAt: 43 }));
        expect(keep.command.createdAt).toBe(42);
        expect(keep.command.useCount).toBe(7);
        expect(keep.command.lastUsedAt).toBe(43);
    });
});

describe('storage', () => {
    it('loadCustomCommands parses the stored JSON array', () => {
        const store = makeStore({ [CUSTOM_COMMANDS_KEY]: JSON.stringify([openUrlCmd()]) });
        const list = loadCustomCommands(store);
        expect(list).toHaveLength(1);
        expect(list[0].slash).toBe('site');
    });

    it('loadCustomCommands degrades gracefully: broken JSON, non-arrays, junk entries', () => {
        expect(loadCustomCommands(makeStore({}))).toEqual([]); // missing key
        expect(loadCustomCommands(makeStore({ [CUSTOM_COMMANDS_KEY]: '{oops' }))).toEqual([]);
        expect(loadCustomCommands(makeStore({ [CUSTOM_COMMANDS_KEY]: '{"a":1}' }))).toEqual([]);
        const junk = JSON.stringify([
            null, 'x', { slash: 'Bad Slash', action: { type: 'open-url' } },
            { slash: 'ok', action: { type: 'nope' } },
            { slash: 'ok', action: { type: 'open-url', url: 'https://x.com/', where: 'tab' } }
        ]);
        const list = loadCustomCommands(makeStore({ [CUSTOM_COMMANDS_KEY]: junk }));
        expect(list).toHaveLength(1);
        expect(list[0].slash).toBe('ok');
    });

    it('loadCustomCommands drops invalid aliases (sync-blob injection face)', () => {
        const blob = JSON.stringify([openUrlCmd({
            aliases: ['ok-alias', '<img src=x onerror=alert(1)>', 'fine2']
        })]);
        const list = loadCustomCommands(makeStore({ [CUSTOM_COMMANDS_KEY]: blob }));
        expect(list).toHaveLength(1);
        expect(list[0].aliases).toEqual(['ok-alias', 'fine2']);
    });

    it('saveCustomCommands writes a JSON string capped at 100 entries', () => {
        const store = makeStore();
        const many = Array.from({ length: 105 }, (_, i) => openUrlCmd({ id: `cc_${i}` }));
        saveCustomCommands(store, many);
        expect(JSON.parse(store.data[CUSTOM_COMMANDS_KEY])).toHaveLength(MAX_CUSTOM_COMMANDS);
    });
});

describe('matchCustom / sortCustoms', () => {
    it('matchCustom prefix-matches slash and aliases', () => {
        const cmd = { slash: 'work', aliases: ['wo'] };
        expect(matchCustom(cmd, '')).toBe(true);
        expect(matchCustom(cmd, 'w')).toBe(true);
        expect(matchCustom(cmd, 'wor')).toBe(true);
        expect(matchCustom(cmd, 'wo')).toBe(true);
        expect(matchCustom(cmd, 'ork')).toBe(false);
        expect(matchCustom(cmd, 'works')).toBe(false);
    });

    it('sortCustoms orders by useCount (capped at 50), then recency, then slash', () => {
        const c = (slash, useCount, lastUsedAt) => ({ slash, useCount, lastUsedAt });
        const list = [
            c('b', 0, 0),
            c('a', 60, 10),  // capped at 50 — ties with the next
            c('z', 51, 20),  // same cap, newer
            c('m', 5, 1),
            c('n', 5, 9)
        ];
        expect(sortCustoms(list).map(x => x.slash)).toEqual(['z', 'a', 'n', 'm', 'b']);
        expect(list[0].slash).toBe('b'); // the input array is not mutated
    });
});

describe('executeCustom', () => {
    it('bumps useCount/lastUsedAt and persists before running the action', () => {
        const deps = makeDeps();
        deps.store.setSyncSetting(CUSTOM_COMMANDS_KEY, JSON.stringify([openUrlCmd({ useCount: 2 })]));
        executeCustom(openUrlCmd({ useCount: 2 }), '', deps);
        const saved = JSON.parse(deps.store.getSyncSetting(CUSTOM_COMMANDS_KEY, '[]'));
        expect(saved[0].useCount).toBe(3);
        expect(saved[0].lastUsedAt).toBeGreaterThan(0);
    });

    it('open-url maps where onto the actions open* family', () => {
        const cases = [
            ['current', 'openBookmarkCalls', ['https://example.com/']],
            ['tab', 'openBookmarkNewTabCalls', [['https://example.com/', true]]],
            ['background', 'openBookmarkNewTabCalls', [['https://example.com/', false]]],
            ['window', 'openBookmarkNewWindowCalls', ['https://example.com/']]
        ];
        for (const [where, prop, expected] of cases) {
            const deps = makeDeps();
            executeCustom(openUrlCmd({ action: { type: 'open-url', url: 'https://example.com/', where } }), '', deps);
            expect(deps.actions[prop], where).toEqual(expected);
        }
    });

    it('url-template fills %s with the encoded rest words', () => {
        const deps = makeDeps();
        const cmd = openUrlCmd({
            action: { type: 'url-template', template: 'https://kimi.com/search?q=%s', where: 'tab' }
        });
        executeCustom(cmd, 'kimi code', deps);
        expect(deps.actions.openBookmarkNewTabCalls).toEqual([['https://kimi.com/search?q=kimi%20code', true]]);
    });

    it('url-template without rest words opens the template origin', () => {
        const deps = makeDeps();
        const cmd = openUrlCmd({
            action: { type: 'url-template', template: 'https://kimi.com/search?q=%s', where: 'current' }
        });
        executeCustom(cmd, '', deps);
        expect(deps.actions.openBookmarkCalls).toEqual(['https://kimi.com']);
        // a template whose origin cannot be parsed drops the %s marker instead
        const deps2 = makeDeps();
        executeCustom(openUrlCmd({
            action: { type: 'url-template', template: 'https://x.com/%s/search', where: 'current' }
        }), '', deps2);
        expect(deps2.actions.openBookmarkCalls).toEqual(['https://x.com']);
    });

    it('open-url-group opens the folder children (folders skipped) by where', () => {
        chrome.bookmarks.childrenTable = {
            '50': [{ url: 'https://a.example/' }, { url: 'https://b.example/' }, { title: 'sub', children: [] }]
        };
        const group = where => openUrlCmd({ action: { type: 'open-url-group', folderId: '50', where } });
        const urls = ['https://a.example/', 'https://b.example/'];
        let deps = makeDeps();
        executeCustom(group('tab'), '', deps);
        expect(deps.actions.openBookmarksCalls).toEqual([[urls, true]]);
        deps = makeDeps();
        executeCustom(group('background'), '', deps);
        expect(deps.actions.openBookmarksCalls).toEqual([[urls, false]]);
        deps = makeDeps();
        executeCustom(group('window'), '', deps);
        expect(deps.actions.openBookmarksNewWindowCalls).toEqual([urls]);
    });

    it('open-url-group on an empty folder opens nothing (and still bumps usage)', () => {
        chrome.bookmarks.childrenTable = { '50': [] };
        const deps = makeDeps();
        const cmd = openUrlCmd({ action: { type: 'open-url-group', folderId: '50', where: 'tab' } });
        deps.store.setSyncSetting(CUSTOM_COMMANDS_KEY, JSON.stringify([cmd]));
        executeCustom(cmd, '', deps);
        expect(deps.actions.openBookmarksCalls).toEqual([]);
        expect(JSON.parse(deps.store.getSyncSetting(CUSTOM_COMMANDS_KEY, '[]'))[0].useCount).toBe(1);
    });

    it('a gone folder prompts the delete confirm; fn1 deletes and fires onChanged', () => {
        const deps = makeDeps(); // no children seeded → lastError
        const cmd = openUrlCmd({ name: 'Work apps', action: { type: 'open-url-group', folderId: '50', where: 'tab' } });
        deps.store.setSyncSetting(CUSTOM_COMMANDS_KEY, JSON.stringify([cmd, openUrlCmd({ id: 'cc_2' })]));
        executeCustom(cmd, '', deps);
        expect(deps.actions.openBookmarksCalls).toEqual([]);
        expect(deps.dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        const cfg = deps.dialogs.ConfirmDialog.openCalls[0];
        expect(cfg.dialog).toBe('paletteCustomBroken[Work apps]');
        cfg.fn1();
        const saved = JSON.parse(deps.store.getSyncSetting(CUSTOM_COMMANDS_KEY, '[]'));
        expect(saved.map(c => c.id)).toEqual(['cc_2']);
        expect(deps.onChangedCalls).toEqual([1]);
    });

    it('view-preset activates the view with only the declared preset keys', () => {
        const deps = makeDeps();
        executeCustom(openUrlCmd({
            action: { type: 'view-preset', view: 'dupes', strategy: 'newest', scope: 'bar' }
        }), '', deps);
        expect(deps.views.activateCalls).toEqual([['dupes', { preset: { strategy: 'newest', scope: 'bar' } }]]);
        const deps2 = makeDeps();
        executeCustom(openUrlCmd({ action: { type: 'view-preset', view: 'dead', scan: true } }), '', deps2);
        expect(deps2.views.activateCalls).toEqual([['dead', { preset: { scan: true } }]]);
        const deps3 = makeDeps();
        executeCustom(openUrlCmd({ action: { type: 'view-preset', view: 'dead' } }), '', deps3);
        expect(deps3.views.activateCalls).toEqual([['dead', { preset: {} }]]);
    });
});

describe('summarizeAction', () => {
    it('renders one line per action type (user data verbatim)', () => {
        expect(summarizeAction(openUrlCmd(), _m)).toBe('paletteActionOpenUrl: https://example.com/');
        expect(summarizeAction(openUrlCmd({
            action: { type: 'open-url-group', folderId: '50', where: 'tab' }
        }), _m)).toBe('paletteActionOpenUrlGroup #50');
        expect(summarizeAction(openUrlCmd({
            action: { type: 'view-preset', view: 'dupes', strategy: 'newest', scan: true }
        }), _m)).toBe('paletteActionViewPreset: dupes (newest · scan)');
        expect(summarizeAction(openUrlCmd({
            action: { type: 'view-preset', view: 'dead' }
        }), _m)).toBe('paletteActionViewPreset: dead');
        expect(summarizeAction(openUrlCmd({
            action: { type: 'url-template', template: 'https://x.com/%s', where: 'tab' }
        }), _m)).toBe('paletteActionUrlTemplate: https://x.com/%s');
        expect(summarizeAction({ action: { type: 'nope' } }, _m)).toBe('');
    });
});
