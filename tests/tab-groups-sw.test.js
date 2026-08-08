import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTabGroupOpener, TAB_GROUP_MSG } from '../src/tab-groups-sw.js';
import { pickGroupColor, cleanGroupTitle, TAB_GROUP_COLORS } from '../src/tab-group-utils.js';

// tab-groups-sw.js is the SW-side tab-group opener (P3.4 hardening): the
// popup sends vbm-tab-group-open-* messages and the SW creates the tabs and
// groups them — surviving the popup closing when its first (active) tab
// opens. The chrome double below follows the callback-style convention of
// the repo's other SW doubles; tab creation/group callbacks fire
// synchronously so the countdown logic is exercised deterministically.

const realChrome = globalThis.chrome;

const makeChrome = ({ noTabGroups = false } = {}) => {
    const calls = { created: [], grouped: [], updated: [], got: [] };
    let nextId = 100;
    const c = {
        runtime: {
            lastError: null,
            onMessage: { addListener(fn) { (this.fns = this.fns || []).push(fn); } }
        },
        tabs: {
            create(props, cb) {
                const tab = { id: String(nextId++), url: props.url, windowId: props.windowId || 1, active: !!props.active };
                calls.created.push(props);
                // Failure hook: tests simulate a chrome-level create failure
                // (the callback fires with no tab and lastError set, exactly
                // as in a real browser).
                const err = c._failCreate ? c._failCreate(props) : null;
                if (err) {
                    c.runtime.lastError = { message: err };
                    if (cb)
                        cb(undefined);
                    c.runtime.lastError = null;
                    return undefined;
                }
                if (cb)
                    cb(tab);
                return tab;
            }
        },
        tabGroups: undefined
    };
    // Feature-detect surface: without the tab-group APIs the opener degrades
    // to a plain batch-open.
    if (!noTabGroups) {
        c.tabs.group = (opts, cb) => {
            calls.grouped.push(opts);
            if (c._groupError) {
                c.runtime.lastError = { message: c._groupError };
                if (cb)
                    cb();
                c.runtime.lastError = null;
                return;
            }
            // a fresh async call: its callback must not see a stale
            // lastError left over from a nested (synchronous) caller
            c.runtime.lastError = null;
            if (cb)
                cb('group-1');
        };
        c.tabGroups = {
            get(id, cb) {
                calls.got.push(id);
                if (c.runtime.lastError) {
                    cb();
                    return;
                }
                cb({ id, windowId: 7 });
            },
            update(id, props) {
                calls.updated.push([id, props]);
            }
        };
    }
    return { chrome: c, calls };
};

beforeEach(() => {
    globalThis.chrome = makeChrome().chrome;
});

afterEach(() => {
    globalThis.chrome = realChrome;
});

describe('tab-groups SW opener', () => {
    it('openNewGroup creates every tab, then groups them with the given title and color', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        createTabGroupOpener().openNewGroup(['http://a/', 'http://b/'], 'Dev', 'blue');
        expect(calls.created).toHaveLength(2);
        // the first tab is active (focus), the rest background — same UX as
        // the old popup path, but now the SW survives the activation.
        expect(calls.created[0].active).toBe(true);
        expect(calls.created[1].active).toBe(false);
        expect(calls.grouped).toEqual([{ tabIds: ['100', '101'] }]);
        expect(calls.updated).toEqual([['group-1', { title: 'Dev', color: 'blue' }]]);
    });

    it('defaults the color to grey when none is passed and keeps a blank title legal', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        createTabGroupOpener().openNewGroup(['http://a/'], '', undefined);
        expect(calls.updated).toEqual([['group-1', { title: '', color: 'grey' }]]);
    });

    it('is a no-op for an empty url list', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        createTabGroupOpener().openNewGroup([], 'Dev', 'blue');
        expect(calls.created).toHaveLength(0);
        expect(calls.grouped).toHaveLength(0);
    });

    it('degrades to a plain batch-open when the tab-group APIs are missing (old Chrome)', () => {
        const { chrome, calls } = makeChrome({ noTabGroups: true });
        globalThis.chrome = chrome;
        createTabGroupOpener().openNewGroup(['http://a/', 'http://b/'], 'Dev', 'blue');
        expect(calls.created).toHaveLength(2);
        expect(calls.grouped).toHaveLength(0);
        expect(calls.updated).toHaveLength(0);
    });

    it('a single failed create skips that tab but still groups the rest', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        // e.g. a javascript: bookmarklet URL chrome refuses to open
        chrome._failCreate = props => (props.url.startsWith('javascript:') ? 'Cannot open' : null);
        createTabGroupOpener().openNewGroup(['http://a/', 'javascript:x'], 'Dev', 'blue');
        expect(calls.created).toHaveLength(2);
        // no TypeError, no stuck chain: the one live tab still forms a group
        expect(calls.grouped).toEqual([{ tabIds: ['100'] }]);
        expect(calls.updated).toEqual([['group-1', { title: 'Dev', color: 'blue' }]]);
    });

    it('when every create fails there is no group call (and no exception)', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        chrome._failCreate = () => 'Cannot open';
        createTabGroupOpener().openNewGroup(['http://a/', 'http://b/'], 'Dev', 'blue');
        expect(calls.created).toHaveLength(2);
        expect(calls.grouped).toHaveLength(0);
        expect(calls.updated).toHaveLength(0);
    });

    it('a lastError from tabs.group leaves the opened tabs plain (no update)', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        chrome._groupError = 'Grouping failed.';
        createTabGroupOpener().openNewGroup(['http://a/'], 'Dev', 'blue');
        expect(calls.grouped).toEqual([{ tabIds: ['100'] }]);
        expect(calls.updated).toHaveLength(0);
    });

    it('openIntoGroup resolves the group window and creates the tabs there, then joins them', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        createTabGroupOpener().openIntoGroup(['http://a/', 'http://b/'], 'g1');
        expect(calls.got).toEqual(['g1']);
        // every tab is created in the group's window (windowId 7)
        expect(calls.created).toHaveLength(2);
        expect(calls.created[0].windowId).toBe(7);
        expect(calls.created[1].windowId).toBe(7);
        // joined into the existing group; its title/color stay untouched
        expect(calls.grouped).toEqual([{ tabIds: ['100', '101'], groupId: 'g1' }]);
        expect(calls.updated).toHaveLength(0);
    });

    it('openIntoGroup degrades to a plain open when the group is gone (lastError)', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        chrome.runtime.lastError = { message: 'No group with id g1.' };
        createTabGroupOpener().openIntoGroup(['http://a/'], 'g1');
        expect(calls.created).toHaveLength(1);
        expect(calls.got).toEqual(['g1']);
        expect(calls.grouped).toHaveLength(0);
        expect(calls.updated).toHaveLength(0);
    });

    it('openIntoGroup degrades to a plain open when the tab-group APIs are missing', () => {
        const { chrome, calls } = makeChrome({ noTabGroups: true });
        globalThis.chrome = chrome;
        createTabGroupOpener().openIntoGroup(['http://a/'], 'g1');
        expect(calls.created).toHaveLength(1);
        expect(calls.got).toHaveLength(0);
        expect(calls.grouped).toHaveLength(0);
    });

    it('openIntoGroup skips a failed create (non-window reason) but joins the rest', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        chrome._failCreate = props => (props.url.startsWith('javascript:') ? 'Cannot open' : null);
        createTabGroupOpener().openIntoGroup(['javascript:x', 'http://b/'], 'g1');
        expect(calls.created).toHaveLength(2);
        // no windowId retry for an ordinary failure; the live tab joins the group
        expect(calls.created.every(p => p.windowId === 7)).toBe(true);
        expect(calls.grouped).toEqual([{ tabIds: ['101'], groupId: 'g1' }]);
    });

    it('openIntoGroup retries once without windowId when the window closed mid-open', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        // The group's window (id 7) is gone by the time the creates run.
        chrome._failCreate = props => (props.windowId === 7 ? 'No window with id: 7.' : null);
        createTabGroupOpener().openIntoGroup(['http://a/', 'http://b/'], 'g1');
        // 2 failed windowed attempts + 2 plain-open retries (the fallback
        // fires once, for all urls)
        expect(calls.created).toHaveLength(4);
        const windowed = calls.created.filter(p => p.windowId === 7);
        const plain = calls.created.filter(p => !('windowId' in p));
        expect(windowed).toHaveLength(2);
        expect(plain).toHaveLength(2);
        expect(plain[0].active).toBe(true);
        // nothing opened in the (dead) window, so no group call
        expect(calls.grouped).toHaveLength(0);
    });

    it('start wires the two message types to the openers', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        const opener = createTabGroupOpener();
        opener.start();
        const [listener] = chrome.runtime.onMessage.fns;
        listener({ type: TAB_GROUP_MSG.openNew, urls: ['http://a/'], title: 'T', color: 'red' });
        expect(calls.updated).toEqual([['group-1', { title: 'T', color: 'red' }]]);
        calls.updated.length = 0;
        calls.grouped.length = 0;
        calls.created.length = 0;
        listener({ type: TAB_GROUP_MSG.openInto, urls: ['http://b/'], groupId: 'g1' });
        expect(calls.got).toEqual(['g1']);
        expect(calls.created).toHaveLength(1);
        // the id counter is monotonic — the second tab of the test is '101'
        expect(calls.grouped).toEqual([{ tabIds: ['101'], groupId: 'g1' }]);
        // unrelated messages are ignored
        listener({ type: 'something-else' });
        expect(calls.created).toHaveLength(1);
    });
});

describe('tab-group-utils', () => {
    it('pickGroupColor stays inside the 9-color palette for any input (including empty)', () => {
        for (const t of ['', 'a', '书签', 'Dev Stuff', 'x'.repeat(500)])
            expect(TAB_GROUP_COLORS).toContain(pickGroupColor(t));
        // deterministic: the same title always lands on the same color
        expect(pickGroupColor('Dev Stuff')).toBe(pickGroupColor('Dev Stuff'));
        // and different titles can collide — that is fine, it is a hash
        expect(TAB_GROUP_COLORS).toHaveLength(9);
    });

    it('cleanGroupTitle strips the trailing localized sync suffix once', () => {
        const suffixes = ['(Local)', '（仅本地）', '(Synced)'];
        expect(cleanGroupTitle('My Folder (Local)', suffixes)).toBe('My Folder');
        expect(cleanGroupTitle('我的文件夹 （仅本地）', suffixes)).toBe('我的文件夹');
        expect(cleanGroupTitle('My Folder (Synced)', suffixes)).toBe('My Folder');
        // one pass each: a doubled suffix keeps the inner one (tree-render
        // never emits that, but the helper must not over-strip)
        expect(cleanGroupTitle('Foo (Local) (Local)', suffixes)).toBe('Foo (Local)');
    });

    it('cleanGroupTitle trims whitespace and is a no-op without suffixes', () => {
        expect(cleanGroupTitle('  My Folder  ', ['(Local)'])).toBe('My Folder');
        expect(cleanGroupTitle('My Folder', [])).toBe('My Folder');
        expect(cleanGroupTitle('My Folder (Local)', [])).toBe('My Folder (Local)');
    });
});
