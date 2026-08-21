import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// background.js is the MV3 service worker entry: no exports, it registers
// every listener at import time. The test stubs the chrome global once,
// imports the real module, then drives the captured listeners by hand. The
// storage double speaks BOTH styles the worker uses — callback (sync-engine,
// visit-stats, panel-behavior) and promise (the quick-add command branch).
// The imported module also boots the sync engine, the visit-stats collector
// and the panel behavior wiring, so the double covers those surfaces too.

const flushMicrotasks = async (rounds = 10) => {
    for (let i = 0; i < rounds; i++)
        await Promise.resolve();
};

let chromeDouble;
let listeners;
let calls;
let localData, sessionData, syncData;
let startupCalls;

const buildChrome = () => {
    listeners = {
        commands: null,
        contextMenuClicked: null,
        installed: [],
        startup: [],
        storageChanged: null
    };
    calls = {
        bookmarksCreate: [],
        contextMenusCreate: [],
        contextMenusRemove: [],
        tabsCreate: [],
        tabsUpdate: [],
        windowsCreate: [],
        actionOpenPopup: 0,
        actionSetIcon: [],
        sidePanelOpen: 0,
        setPanelBehavior: [],
        sessionRemove: [],
        omniboxDefault: []
    };
    localData = {};
    sessionData = {};
    syncData = {};

    const dualGet = data => (keys, cb) => {
        let out;
        if (keys === null || keys === undefined)
            out = { ...data };
        else if (typeof keys === 'string')
            // Real chrome.storage omits missing keys entirely (a present
            // key with an undefined value is NOT returned) — the SW's
            // sync→local fallback probes with hasOwnProperty.
            out = keys in data ? { [keys]: data[keys] } : {};
        else if (Array.isArray(keys)) {
            out = {};
            for (const k of keys)
                if (k in data)
                    out[k] = data[k];
        } else {
            out = {};
            for (const k of Object.keys(keys))
                out[k] = k in data ? data[k] : keys[k];
        }
        if (cb) {
            cb(out);
            return undefined;
        }
        return Promise.resolve(out);
    };
    const dualSet = data => (obj, cb) => {
        Object.assign(data, obj);
        if (cb) {
            cb();
            return undefined;
        }
        return Promise.resolve();
    };
    const dualRemove = (data, record) => (keys, cb) => {
        for (const k of [].concat(keys))
            delete data[k];
        if (record)
            record.push([].concat(keys));
        if (cb) {
            cb();
            return undefined;
        }
        return Promise.resolve();
    };

    const noopListener = { addListener: () => {} };
    return {
        runtime: {
            lastError: undefined,
            // Multiple modules register on onInstalled (quick-add menu,
            // restoreCustomIcon #52); keep an array so each test can drive all.
            onInstalled: {
                addListener(fn) {
                    (listeners.installed = listeners.installed || []).push(fn);
                }
            },
            onStartup: {
                addListener(fn) {
                    (listeners.startup = listeners.startup || []).push(fn);
                }
            },
            onMessage: noopListener,
            getURL: p => `chrome-extension://test/${p}`
        },
        i18n: { getMessage: key => key },
        bookmarks: {
            _searchResult: [],
            getTree(cb) { cb([]); },
            get(id, cb) { cb([]); },
            search(q, cb) { cb(this._searchResult); },
            create(node, cb) {
                calls.bookmarksCreate.push(node);
                if (cb) {
                    cb({ id: '900', ...node });
                    return undefined;
                }
                return Promise.resolve({ id: '900', ...node });
            },
            onCreated: noopListener,
            onRemoved: noopListener,
            onChanged: noopListener,
            onMoved: noopListener,
            onChildrenReordered: noopListener,
            onImportBegan: noopListener,
            onImportEnded: noopListener
        },
        tabs: {
            // Dual style: the omnibox branch passes a callback, the quick-add
            // command awaits the promise.
            _queryResult: [],
            query(info, cb) {
                if (cb) {
                    cb(this._queryResult);
                    return undefined;
                }
                return Promise.resolve(this._queryResult);
            },
            create(props) { calls.tabsCreate.push(props); },
            update(id, props) { calls.tabsUpdate.push([id, props]); },
            onUpdated: noopListener
        },
        windows: {
            getCurrent: () => Promise.resolve({ id: 7 }),
            create: props => {
                calls.windowsCreate.push(props);
                return Promise.resolve({ id: 8 });
            }
        },
        action: {
            setIcon: icon => { calls.actionSetIcon.push(icon); },
            openPopup: () => {
                calls.actionOpenPopup++;
                return Promise.resolve();
            }
        },
        sidePanel: {
            _openRejects: false,
            setPanelBehavior(behavior) {
                calls.setPanelBehavior.push(behavior);
                return Promise.resolve();
            },
            open() {
                calls.sidePanelOpen++;
                return this._openRejects
                    ? Promise.reject(new Error('no window'))
                    : Promise.resolve();
            }
        },
        commands: {
            onCommand: { addListener(fn) { listeners.commands = fn; } }
        },
        contextMenus: {
            remove(id, cb) {
                calls.contextMenusRemove.push(id);
                if (cb)
                    cb();
            },
            create(props) { calls.contextMenusCreate.push(props); },
            onClicked: { addListener(fn) { listeners.contextMenuClicked = fn; } }
        },
        omnibox: {
            setDefaultSuggestion: s => { calls.omniboxDefault.push(s.description); },
            onInputChanged: { addListener(fn) { listeners.omniboxChanged = fn; } },
            onInputEntered: { addListener(fn) { listeners.omniboxEntered = fn; } }
        },
        alarms: {
            clear: () => {},
            create: () => {},
            onAlarm: noopListener
        },
        storage: {
            local: { get: dualGet(localData), set: dualSet(localData), remove: dualRemove(localData) },
            sync: { get: dualGet(syncData), set: dualSet(syncData), remove: dualRemove(syncData) },
            session: {
                get: dualGet(sessionData),
                set: dualSet(sessionData),
                remove: dualRemove(sessionData, calls.sessionRemove)
            },
            onChanged: { addListener(fn) { listeners.storageChanged = fn; } }
        }
    };
};

beforeAll(async () => {
    chromeDouble = buildChrome();
    globalThis.chrome = chromeDouble;
    // background.js's restoreCustomIcon (#52) rebuilds the action icon via
    // OffscreenCanvas, which node lacks — stub it with a recording canvas so
    // the top-level call on import doesn't throw.
    globalThis.OffscreenCanvas = class {
        constructor(w, h) {
            this.width = w;
            this.height = h;
            const data = new Uint8ClampedArray(w * h * 4);
            data.fill(255); // opaque white, like a blank getImageData
            this._imageData = { width: w, height: h, data };
        }
        getContext() {
            return {
                getImageData: (x, y, w, h) => this._imageData
            };
        }
    };
    await import('../src/background.js');
    // Startup side effects (context-menu creation) would be wiped by the
    // per-test call reset — snapshot them before any beforeEach runs.
    startupCalls = {
        menusRemove: [...calls.contextMenusRemove],
        menusCreate: [...calls.contextMenusCreate]
    };
});

beforeEach(() => {
    // Clear storage data in place: the dual-style closures captured these
    // exact objects at buildChrome() time.
    for (const k of Object.keys(localData)) delete localData[k];
    for (const k of Object.keys(sessionData)) delete sessionData[k];
    for (const k of Object.keys(syncData)) delete syncData[k];
    for (const key of Object.keys(calls))
        if (Array.isArray(calls[key]))
            calls[key].length = 0;
        else
            calls[key] = 0;
    chromeDouble.tabs._queryResult = [];
    chromeDouble.bookmarks._searchResult = [];
    // restored like action.openPopup below: one test swaps query for a
    // rejecting stub
    chromeDouble.tabs.query = function (info, cb) {
        if (cb) {
            cb(this._queryResult);
            return undefined;
        }
        return Promise.resolve(this._queryResult);
    };
    chromeDouble.sidePanel._openRejects = false;
    chromeDouble.action.openPopup = () => {
        calls.actionOpenPopup++;
        return Promise.resolve();
    };
});

afterAll(() => {
    delete globalThis.chrome;
    delete globalThis.OffscreenCanvas;
});

describe('service worker startup wiring', () => {
    it('registers the command, context-menu and install listeners', () => {
        expect(typeof listeners.commands).toBe('function');
        expect(typeof listeners.contextMenuClicked).toBe('function');
        expect(Array.isArray(listeners.installed)).toBe(true);
        expect(listeners.installed.length).toBeGreaterThan(0);
    });

    it('creates the quick-add page context menu at startup (idempotent remove first)', () => {
        expect(startupCalls.menusRemove).toContain('vbm-quick-add');
        const created = startupCalls.menusCreate.find(m => m.id === 'vbm-quick-add');
        expect(created).toBeTruthy();
        expect(created.contexts).toEqual(['page']);
        expect(created.title).toBe('contextMenuAddBookmark');
    });

    it('re-creates the menu on install (same idempotent remove-first path)', () => {
        listeners.installed.forEach(fn => fn());
        expect(calls.contextMenusRemove).toContain('vbm-quick-add');
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(true);
    });

    it('issue #49: does NOT create the menu when quickAddContextMenu is off', () => {
        // quickAddContextMenu lives in the sync area (2026-08 storage audit)
        syncData.quickAddContextMenu = ''; // off
        calls.contextMenusCreate = [];
        listeners.installed.forEach(fn => fn());
        // remove-first still runs (idempotent), but no re-create happens
        expect(calls.contextMenusRemove).toContain('vbm-quick-add');
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(false);
    });

    it('2026-08 review: falls back to the pre-migration local value when sync lacks the key', () => {
        // An upgraded profile before the first page open: the local→sync
        // migration (page-side store.js) has not run yet, so the sync area
        // is empty — the SW must honor the pre-migration LOCAL value or an
        // off switch would be ignored for the whole first session.
        localData.quickAddContextMenu = ''; // off, not yet migrated
        calls.contextMenusCreate = [];
        listeners.installed.forEach(fn => fn());
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(false);
        // …and a sync value wins over a stale local one once migrated
        syncData.quickAddContextMenu = '1';
        localData.quickAddContextMenu = '';
        calls.contextMenusCreate = [];
        listeners.installed.forEach(fn => fn());
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(true);
    });

    it('issue #49: a storage flip off removes the live menu, back on recreates it', () => {
        calls.contextMenusCreate = [];
        // The handler reads the change event's newValue directly.
        listeners.storageChanged({ quickAddContextMenu: { newValue: '' } }, 'local');
        expect(calls.contextMenusRemove).toContain('vbm-quick-add');
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(false);
        // back on: remove-first then recreate
        calls.contextMenusCreate = [];
        listeners.storageChanged({ quickAddContextMenu: { newValue: '1' } }, 'local');
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(true);
    });

    it('issue #49: a fast on→off flip settles on the final state (no stale storage re-read)', () => {
        // Regression: the handler used to re-read storage asynchronously, so
        // a stale get() callback could re-create the menu after the final
        // off. The sync area (the key's home since the 2026-08 storage
        // audit) deliberately still says ON — newValue must win.
        syncData.quickAddContextMenu = '1';
        calls.contextMenusCreate = [];
        calls.contextMenusRemove = [];
        listeners.storageChanged({ quickAddContextMenu: { newValue: '' } }, 'local');
        expect(calls.contextMenusRemove).toContain('vbm-quick-add');
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(false);
        // …and the symmetric race: storage says OFF, the final event says ON
        syncData.quickAddContextMenu = '';
        listeners.storageChanged({ quickAddContextMenu: { newValue: '1' } }, 'local');
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(true);
    });

    it('issue #49: removing the setting falls back to the default-on menu', () => {
        calls.contextMenusCreate = [];
        listeners.storageChanged({ quickAddContextMenu: {} }, 'local'); // newValue undefined
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(true);
    });

    it('serializes overlapping remove→create cycles — no duplicate-id create (unchecked lastError)', async () => {
        // contextMenus calls are async in reality: an onInstalled cycle and a
        // storage flip can both be in flight before the first remove callback
        // fires. The old remove→create chain then ran TWO creates and the
        // second raised "Cannot create item with duplicate id vbm-quick-add"
        // (an unchecked runtime.lastError, seen on every dev reload). Defer
        // remove so the two cycles genuinely overlap.
        const origRemove = chromeDouble.contextMenus.remove;
        let gateResolve;
        const gate = new Promise(res => { gateResolve = res; });
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            gateResolve();
        };
        chromeDouble.contextMenus.remove = (id, cb) => {
            calls.contextMenusRemove.push(id);
            gate.then(() => cb && cb());
        };
        try {
            calls.contextMenusCreate = [];
            calls.contextMenusRemove = [];
            // Two overlapping cycles: the onInstalled path and a storage flip-on.
            listeners.installed.forEach(fn => fn());
            listeners.storageChanged({ quickAddContextMenu: { newValue: '1' } }, 'local');
            // Neither remove callback has fired yet — no create may happen.
            expect(calls.contextMenusCreate.filter(m => m.id === 'vbm-quick-add')).toHaveLength(0);
            release();
            await gate;
            await flushMicrotasks();
            // Both cycles settled → the serialized chain ran exactly ONE create.
            expect(calls.contextMenusCreate.filter(m => m.id === 'vbm-quick-add')).toHaveLength(1);
        } finally {
            release(); // drain the deferred callbacks even on failure
            chromeDouble.contextMenus.remove = origRemove;
            await flushMicrotasks();
        }
    });

    it('issue #49: ignores storage changes outside the local quickAddContextMenu key', () => {
        calls.contextMenusCreate = [];
        listeners.storageChanged({ unrelated: { newValue: 'x' } }, 'local');
        // no re-create was triggered for an unrelated key
        expect(calls.contextMenusCreate).toHaveLength(0);
    });
});

describe('quick-add-bookmark command (final polish)', () => {
    it('bookmarks the active tab into the configured quick-add folder', async () => {
        localData.quickAddFolderId = '42';
        chromeDouble.tabs._queryResult = [{ id: 5, title: 'Page T', url: 'https://x.test/' }];
        await listeners.commands('quick-add-bookmark');
        expect(calls.bookmarksCreate).toEqual([
            { title: 'Page T', url: 'https://x.test/', parentId: '42' }
        ]);
    });

    it('falls back to the bookmark bar (parentId 1) and the url title', async () => {
        chromeDouble.tabs._queryResult = [{ id: 5, title: '', url: 'https://y.test/' }];
        await listeners.commands('quick-add-bookmark');
        expect(calls.bookmarksCreate).toEqual([
            { title: 'https://y.test/', url: 'https://y.test/', parentId: '1' }
        ]);
    });

    it('does nothing without an active tab url', async () => {
        chromeDouble.tabs._queryResult = [{ id: 5, title: 'chrome://newtab', url: '' }];
        await listeners.commands('quick-add-bookmark');
        expect(calls.bookmarksCreate).toEqual([]);
        chromeDouble.tabs._queryResult = [];
        await listeners.commands('quick-add-bookmark');
        expect(calls.bookmarksCreate).toEqual([]);
    });

    it('swallows lookup failures with a warning instead of rejecting', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        chromeDouble.tabs.query = () => Promise.reject(new Error('tabs gone'));
        await expect(listeners.commands('quick-add-bookmark')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('open-command-palette command', () => {
    it('flags the pending open and raises the popup via chrome.action', async () => {
        await listeners.commands('open-command-palette');
        expect(sessionData.pendingPaletteOpen).toBe(true);
        expect(calls.actionOpenPopup).toBe(1);
        expect(calls.windowsCreate).toEqual([]);
    });

    it('falls back to a ?palette=1 popup window when openPopup is unavailable', async () => {
        chromeDouble.action.openPopup = undefined;
        await listeners.commands('open-command-palette');
        expect(calls.windowsCreate).toEqual([{
            url: 'chrome-extension://test/pages/popup.html?palette=1',
            type: 'popup',
            width: 400,
            height: 600
        }]);
    });
});

describe('open-side-panel command', () => {
    it('marks the panel open (with heartbeat) and opens the side panel', async () => {
        await listeners.commands('open-side-panel');
        expect(sessionData.sidePanelIsOpen).toBe(true);
        expect(typeof sessionData.sidePanelHeartbeat).toBe('number');
        expect(calls.sidePanelOpen).toBe(1);
    });

    it('clears the open markers when sidePanel.open rejects (#19)', async () => {
        chromeDouble.sidePanel._openRejects = true;
        // The production catch logs console.warn on purpose; spy it away so
        // CI logs don't read this expected rejection as an error.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await listeners.commands('open-side-panel');
        warn.mockRestore();
        expect(calls.sessionRemove).toContainEqual(['sidePanelIsOpen', 'sidePanelHeartbeat']);
        expect(sessionData.sidePanelIsOpen).toBeUndefined();
    });
});

describe('quick-add page context menu (Phase 3)', () => {
    it('bookmarks the clicked page into the configured folder', () => {
        localData.quickAddFolderId = '9';
        listeners.contextMenuClicked(
            { menuItemId: 'vbm-quick-add' },
            { title: 'Ctx', url: 'https://ctx.test/' });
        expect(calls.bookmarksCreate).toEqual([
            { title: 'Ctx', url: 'https://ctx.test/', parentId: '9' }
        ]);
    });

    it('ignores other menu items and tab-less clicks', () => {
        listeners.contextMenuClicked({ menuItemId: 'something-else' }, { title: 'X', url: 'https://x/' });
        listeners.contextMenuClicked({ menuItemId: 'vbm-quick-add' }, null);
        expect(calls.bookmarksCreate).toEqual([]);
    });
});

// v4 task-4 #11: the omnibox flow. The suggest path is debounced 250ms, so
// the tests type then wait it out; the Enter path is synchronous except the
// fallback search (microtask-flushed).
describe('omnibox search (v4 task-4 #11)', () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const HITS = [
        { id: '11', title: 'Kimi', url: 'https://www.kimi.com/' },
        { id: '12', title: 'Kimi docs', url: 'https://www.kimi.com/docs' }
    ];

    it('suggests ranked hits with the top one as the default suggestion', async () => {
        chromeDouble.bookmarks._searchResult = HITS;
        let suggested = null;
        listeners.omniboxChanged('kimi', s => { suggested = s; });
        await sleep(300);
        await flushMicrotasks();
        const dflt = calls.omniboxDefault[calls.omniboxDefault.length - 1];
        expect(dflt).toContain('Kimi');
        expect(dflt).toContain('https://www.kimi.com/');
        expect(suggested).toHaveLength(1); // the runner-up
        expect(suggested[0].content).toBe('https://www.kimi.com/docs');
    });

    it('Enter on the typed query opens the top hit in the current tab', async () => {
        chromeDouble.bookmarks._searchResult = HITS;
        chromeDouble.tabs._queryResult = [{ id: '55' }];
        listeners.omniboxChanged('kimi', () => {});
        await sleep(300);
        await flushMicrotasks();
        listeners.omniboxEntered('kimi', 'currentTab');
        expect(calls.tabsUpdate).toEqual([['55', { url: 'https://www.kimi.com/' }]]);
        expect(calls.tabsCreate).toEqual([]);
    });

    it('a picked suggestion row opens its URL (new foreground tab)', () => {
        listeners.omniboxEntered('https://www.kimi.com/docs', 'newForegroundTab');
        expect(calls.tabsCreate).toEqual([{ url: 'https://www.kimi.com/docs', active: true }]);
    });

    it('a fast Enter before the debounce still resolves the query (the #11 fix)', async () => {
        chromeDouble.bookmarks._searchResult = HITS;
        chromeDouble.tabs._queryResult = [{ id: '55' }];
        listeners.omniboxEntered('kimi', 'currentTab'); // no onInputChanged at all
        await flushMicrotasks();
        expect(calls.tabsUpdate).toEqual([['55', { url: 'https://www.kimi.com/' }]]);
    });

    it('a fast Enter with no hits does nothing — the raw text is never used as a URL', async () => {
        chromeDouble.bookmarks._searchResult = [];
        chromeDouble.tabs._queryResult = [{ id: '55' }];
        listeners.omniboxEntered('zzz nothing', 'currentTab');
        await flushMicrotasks();
        expect(calls.tabsUpdate).toEqual([]);
        expect(calls.tabsCreate).toEqual([]);
    });
});

// issue #52: the custom action icon is session-scoped (a browser restart
// resets it to the manifest default). The SW must re-apply it on every cold
// start — top-level on import, and again on runtime.onStartup/onInstalled.
// restoreCustomIcon reads the persisted JSON (19×19 RGBA flat array) and
// rebuilds the ImageData via OffscreenCanvas before chrome.action.setIcon.
describe('custom icon persistence (issue #52)', () => {
    // The top-level restoreCustomIcon() ran once at import time (beforeAll),
    // when no icon was stored — a legitimate no-op. The user-facing path is the
    // onStartup/onInstalled listeners, which re-read storage each time.

    it('applies the stored custom icon on runtime.onStartup', async () => {
        localData.customIcon = JSON.stringify({ 0: 255, 1: 0, 2: 0, 3: 255 });
        listeners.startup.forEach(fn => fn());
        await flushMicrotasks();
        expect(calls.actionSetIcon.length).toBe(1);
        const call = calls.actionSetIcon[0];
        expect(call.imageData).toBeDefined();
        // A 19×19 RGBA buffer.
        expect(call.imageData.width).toBe(19);
        expect(call.imageData.height).toBe(19);
        // The mock OffscreenCanvas keeps its ImageData opaque-white by default;
        // the real one copies the stored pixels in. Assert the transfer shape
        // (flat RGBA length), not the bytes, which depend on the stub canvas.
        expect(call.imageData.data.length).toBe(19 * 19 * 4);
    });

    it('does nothing when no custom icon is stored', async () => {
        delete localData.customIcon;
        calls.actionSetIcon = [];
        listeners.startup.forEach(fn => fn());
        await flushMicrotasks();
        expect(calls.actionSetIcon).toEqual([]);
    });

    it('re-applies the icon on every cold-start hook (startup + installed)', async () => {
        localData.customIcon = '{}';
        calls.actionSetIcon = [];
        listeners.startup.forEach(fn => fn());
        await flushMicrotasks();
        expect(calls.actionSetIcon.length).toBe(1);
        listeners.installed.forEach(fn => fn());
        await flushMicrotasks();
        expect(calls.actionSetIcon.length).toBe(2);
    });

    it('ignores a corrupt/legacy stored value without throwing', async () => {
        localData.customIcon = 'not json {';
        calls.actionSetIcon = [];
        listeners.startup.forEach(fn => fn());
        await flushMicrotasks();
        expect(calls.actionSetIcon).toEqual([]);
    });
});
