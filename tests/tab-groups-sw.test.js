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
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const makeChrome = ({ noTabGroups = false } = {}) => {
    const calls = { created: [], grouped: [], updated: [], got: [], moved: [], removed: [], discarded: [], gotTabs: [] };
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
                // a fresh call's callback never sees a stale lastError left
                // over from a nested (synchronous) caller
                c.runtime.lastError = null;
                if (cb)
                    cb(tab);
                return tab;
            },
            get(id, cb) {
                calls.gotTabs.push(id);
                if (c._getTabError) {
                    c.runtime.lastError = { message: c._getTabError };
                    cb();
                    c.runtime.lastError = null;
                    return;
                }
                c.runtime.lastError = null;
                cb({ id, windowId: c._tabWindow || 1 });
            },
            move(id, props, cb) {
                calls.moved.push([id, props]);
                const err = typeof c._moveError === 'function' ? c._moveError(id) : c._moveError;
                if (err) {
                    c.runtime.lastError = { message: err };
                    cb();
                    c.runtime.lastError = null;
                    return;
                }
                c.runtime.lastError = null;
                cb({ id, windowId: props.windowId });
            },
            query(queryInfo, cb) {
                (calls.queried = calls.queried || []).push(queryInfo);
                // The fresh window's initial blank tab (never one of the
                // moved ids, so the cleanup pass removes it).
                c.runtime.lastError = null;
                cb([{ id: 'blank-1', windowId: queryInfo.windowId }]);
            },
            remove(ids, cb) {
                calls.removed.push(ids);
                c.runtime.lastError = null;
                if (cb)
                    cb();
            },
            discard(id, cb) {
                calls.discarded.push(id);
                c.runtime.lastError = null;
                if (cb)
                    cb({ id, discarded: true });
            }
        },
        tabGroups: undefined
    };
    c.windows = {
        createCalls: [],
        removeCalls: [],
        staleWindows: new Set(),
        getCalls: [],
        create(props, cb) {
            this.createCalls.push(props);
            c.runtime.lastError = null;
            if (cb)
                cb({ id: 42 });
        },
        remove(id, cb) {
            this.removeCalls.push(id);
            c.runtime.lastError = null;
            if (cb)
                cb();
        },
        get(id, cb) {
            this.getCalls.push(id);
            if (this.staleWindows.has(id)) {
                c.runtime.lastError = { message: 'No window with id' };
                if (cb)
                    cb(null);
                c.runtime.lastError = null;
                return;
            }
            c.runtime.lastError = null;
            if (cb)
                cb({ id });
        }
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
            update(id, props, cb) {
                calls.updated.push([id, props]);
                if (cb)
                    cb();
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

    it('a windowId is validated once and passed to every create (restore into the home window)', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        createTabGroupOpener().openNewGroup(['http://a/', 'http://b/'], 'Dev', 'blue', 7);
        expect(chrome.windows.getCalls).toEqual([7]);
        expect(calls.created.every(p => p.windowId === 7)).toBe(true);
    });

    it('a stale windowId degrades to Chrome\'s default window instead of skipping every create', () => {
        const { chrome, calls } = makeChrome();
        chrome.windows.staleWindows.add(99);
        globalThis.chrome = chrome;
        createTabGroupOpener().openNewGroup(['http://a/', 'http://b/'], 'Dev', 'blue', 99);
        expect(calls.created).toHaveLength(2);
        expect(calls.created.every(p => !('windowId' in p))).toBe(true);
        expect(calls.grouped).toHaveLength(1);
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

describe('tab-groups SW batch tab management (tab-groups view)', () => {
    it('groupExistingIntoNew creates copies and groups moveIds + copies into a new group', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        createTabGroupOpener().groupExistingIntoNew(
            [4, 5],
            [{ url: 'http://a/', title: 'A' }, { url: 'http://b/' }],
            'Dev', 'blue', 1
        );
        await flush();
        expect(calls.created).toHaveLength(2);
        // copies are background tabs in the requested window
        expect(calls.created[0]).toEqual({ url: 'http://a/', active: false, windowId: 1 });
        expect(calls.created[1]).toEqual({ url: 'http://b/', active: false, windowId: 1 });
        // moveIds come first, then the copy ids
        expect(calls.grouped).toEqual([{ tabIds: [4, 5, '100', '101'] }]);
        expect(calls.updated).toEqual([['group-1', { title: 'Dev', color: 'blue' }]]);
    });

    it('groupExistingIntoNew still creates copies when the tab-group APIs are missing', async () => {
        const { chrome, calls } = makeChrome({ noTabGroups: true });
        globalThis.chrome = chrome;
        createTabGroupOpener().groupExistingIntoNew([4], [{ url: 'http://a/' }], 'Dev', 'blue', 1);
        await flush();
        expect(calls.created).toHaveLength(1);
        expect(calls.grouped).toHaveLength(0);
        expect(calls.updated).toHaveLength(0);
    });

    it('groupExistingIntoExisting moves moveIds into the group window and joins them', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        // existing tab 4 lives in window 9, group g1 lives in window 7
        chrome._tabWindow = 9;
        createTabGroupOpener().groupExistingIntoExisting([4], [{ url: 'http://a/' }], 'g1');
        await flush();
        expect(calls.got).toEqual(['g1']);
        expect(calls.gotTabs).toEqual([4]);
        expect(calls.moved).toEqual([[4, { windowId: 7, index: -1 }]]);
        expect(calls.created[0].windowId).toBe(7);
        expect(calls.grouped).toEqual([{ tabIds: [4, '100'], groupId: 'g1' }]);
        expect(calls.updated).toHaveLength(0);
    });

    it('closeTabs and discardTabs call the tab APIs', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        const opener = createTabGroupOpener();
        opener.closeTabs([4, 5]);
        expect(calls.removed).toEqual([[4, 5]]);
        opener.closeTabs([]);
        expect(calls.removed).toHaveLength(1);
        opener.discardTabs([7]);
        expect(calls.discarded).toEqual([7]);
    });

    it('start wires the tab-batch messages to their handlers', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        const opener = createTabGroupOpener();
        opener.start();
        const [listener] = chrome.runtime.onMessage.fns;
        listener({ type: TAB_GROUP_MSG.tabsClose, tabIds: [4] });
        expect(calls.removed).toEqual([[4]]);
        listener({ type: TAB_GROUP_MSG.tabsDiscard, tabIds: [5] });
        expect(calls.discarded).toEqual([5]);
        listener({ type: TAB_GROUP_MSG.tabsNewGroup, moveIds: [4], copyTabs: [{ url: 'http://a/' }], title: 'T', color: 'red', windowId: 1 });
        await flush();
        expect(calls.updated).toEqual([['group-1', { title: 'T', color: 'red' }]]);
        listener({ type: TAB_GROUP_MSG.tabsOpenInto, moveIds: [4], copyTabs: [], groupId: 'g1' });
        await flush();
        expect(calls.got).toEqual(['g1']);
    });

    it('groupExistingIntoExisting plain-opens the copies when the group vanished', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        chrome.runtime.lastError = { message: 'No group with id g1.' };
        createTabGroupOpener().groupExistingIntoExisting([4], [{ url: 'http://a/' }, { url: 'http://b/' }], 'g1');
        await flush();
        // Degrade contract of openIntoGroup: the copies are still opened
        // (first active), the existing moveIds are simply left alone.
        expect(calls.created).toHaveLength(2);
        expect(calls.created[0].active).toBe(true);
        expect(calls.created[0].windowId).toBeUndefined();
        expect(calls.moved).toHaveLength(0);
        expect(calls.grouped).toHaveLength(0);
    });

    it('createCopies retries in the current window when the target window closed mid-run', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        // Window-targeted creates fail with a window error; the retry
        // without a windowId must succeed so no copy is silently lost.
        chrome._failCreate = props => props.windowId ? 'No window with id: 99.' : null;
        createTabGroupOpener().groupExistingIntoNew([4], [{ url: 'http://a/' }], 'T', 'red', 99);
        await flush();
        expect(calls.created).toHaveLength(2);
        expect(calls.created[1].windowId).toBeUndefined();
        // the failed first create consumed id 100, the retry landed as 101
        expect(calls.grouped).toEqual([{ tabIds: [4, '101'] }]);
    });

    it('moveTabsToNewWindow retries per tab when the batch move fails', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        // The array call fails (one stale id fails the whole batch); the
        // per-tab retries succeed.
        chrome._moveError = id => Array.isArray(id) ? 'No tab with id: 5.' : null;
        let finished = false;
        createTabGroupOpener().moveTabsToNewWindow([4, 5], () => { finished = true; });
        await flush();
        expect(chrome.windows.createCalls).toHaveLength(1);
        expect(calls.moved[0]).toEqual([[4, 5], { windowId: 42, index: -1 }]);
        expect(calls.moved.slice(1)).toEqual([[4, { windowId: 42, index: -1 }], [5, { windowId: 42, index: -1 }]]);
        // the fresh window's blank tab is cleaned up, the window stays
        expect(calls.removed).toEqual(['blank-1']);
        expect(chrome.windows.removeCalls).toHaveLength(0);
        expect(finished).toBe(true);
    });

    // 窗口头拖曳并入 (2026-08-26): move every tab into the target window,
    // then wrap the NON-PINNED survivors in one titled group.
    it('mergeTabsAsGroup moves the tabs and groups the non-pinned subset with the title', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        let finished = false;
        createTabGroupOpener().mergeTabsAsGroup([4, 5, 6], [4, 5], '窗口 2', 7,
            () => { finished = true; });
        await flush();
        // every tab moved into the target window (the double's tabs live in
        // window 1, the target is 7)
        expect(calls.moved).toEqual([
            [4, { windowId: 7, index: -1 }],
            [5, { windowId: 7, index: -1 }],
            [6, { windowId: 7, index: -1 }]
        ]);
        // only the groupIds subset reaches tabs.group, as a NEW group in the
        // target window
        expect(calls.grouped).toEqual([{ tabIds: [4, 5], createProperties: { windowId: 7 } }]);
        expect(calls.updated).toEqual([['group-1', { title: '窗口 2', color: 'grey' }]]);
        expect(finished).toBe(true);
    });

    it('mergeTabsAsGroup still moves the tabs when the group APIs are missing', async () => {
        const { chrome, calls } = makeChrome({ noTabGroups: true });
        globalThis.chrome = chrome;
        createTabGroupOpener().mergeTabsAsGroup([4, 5], [4, 5], 'W', 7);
        await flush();
        expect(calls.moved).toHaveLength(2);
        expect(calls.grouped).toHaveLength(0);
        expect(calls.updated).toHaveLength(0);
    });

    it('mergeTabsAsGroup is a no-op without tab ids or a target window', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        createTabGroupOpener().mergeTabsAsGroup([], [4], 'W', 7);
        createTabGroupOpener().mergeTabsAsGroup([4], [4], 'W', null);
        await flush();
        expect(calls.moved).toHaveLength(0);
    });

    it('moveTabsToNewWindow closes the fresh window when nothing could move', async () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        chrome._moveError = () => 'No tab with id.';
        let finished = false;
        createTabGroupOpener().moveTabsToNewWindow([4, 5], () => { finished = true; });
        await flush();
        // No blank-tab cleanup on the failure path (the window is gone) —
        // just the window removal so it never flashes empty.
        expect(chrome.windows.removeCalls).toEqual([42]);
        expect(calls.removed).toHaveLength(0);
        expect(finished).toBe(true);
    });

    it('closeTabs and discardTabs pass a lastError-swallowing callback', () => {
        const { chrome, calls } = makeChrome();
        globalThis.chrome = chrome;
        const seen = [];
        const origRemove = chrome.tabs.remove.bind(chrome.tabs);
        const origDiscard = chrome.tabs.discard.bind(chrome.tabs);
        chrome.tabs.remove = (ids, cb) => { seen.push(cb); origRemove(ids, cb); };
        chrome.tabs.discard = (id, cb) => { seen.push(cb); origDiscard(id, cb); };
        const opener = createTabGroupOpener();
        opener.closeTabs([4, 5]);
        opener.discardTabs([7]);
        // a stale snapshot id must never surface as an unhandled rejection
        expect(seen).toHaveLength(2);
        for (const cb of seen)
            expect(typeof cb).toBe('function');
        expect(calls.removed).toEqual([[4, 5]]);
        expect(calls.discarded).toEqual([7]);
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
