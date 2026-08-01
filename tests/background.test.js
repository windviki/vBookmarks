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
        installed: null
    };
    calls = {
        bookmarksCreate: [],
        contextMenusCreate: [],
        contextMenusRemove: [],
        tabsCreate: [],
        windowsCreate: [],
        actionOpenPopup: 0,
        sidePanelOpen: 0,
        setPanelBehavior: [],
        sessionRemove: []
    };
    localData = {};
    sessionData = {};
    syncData = {};

    const dualGet = data => (keys, cb) => {
        let out;
        if (keys === null || keys === undefined)
            out = { ...data };
        else if (typeof keys === 'string')
            out = { [keys]: data[keys] };
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
            onInstalled: { addListener(fn) { listeners.installed = fn; } },
            onMessage: noopListener,
            getURL: p => `chrome-extension://test/${p}`
        },
        i18n: { getMessage: key => key },
        bookmarks: {
            getTree(cb) { cb([]); },
            get(id, cb) { cb([]); },
            search(q, cb) { cb([]); },
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
            update() {},
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
            setDefaultSuggestion: () => {},
            onInputChanged: noopListener,
            onInputEntered: noopListener
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
            onChanged: noopListener
        }
    };
};

beforeAll(async () => {
    chromeDouble = buildChrome();
    globalThis.chrome = chromeDouble;
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
    chromeDouble.sidePanel._openRejects = false;
    chromeDouble.action.openPopup = () => {
        calls.actionOpenPopup++;
        return Promise.resolve();
    };
});

afterAll(() => {
    delete globalThis.chrome;
});

describe('service worker startup wiring', () => {
    it('registers the command, context-menu and install listeners', () => {
        expect(typeof listeners.commands).toBe('function');
        expect(typeof listeners.contextMenuClicked).toBe('function');
        expect(typeof listeners.installed).toBe('function');
    });

    it('creates the quick-add page context menu at startup (idempotent remove first)', () => {
        expect(startupCalls.menusRemove).toContain('vbm-quick-add');
        const created = startupCalls.menusCreate.find(m => m.id === 'vbm-quick-add');
        expect(created).toBeTruthy();
        expect(created.contexts).toEqual(['page']);
        expect(created.title).toBe('contextMenuAddBookmark');
    });

    it('re-creates the menu on install (same idempotent remove-first path)', () => {
        listeners.installed();
        expect(calls.contextMenusRemove).toContain('vbm-quick-add');
        expect(calls.contextMenusCreate.some(m => m.id === 'vbm-quick-add')).toBe(true);
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
        await listeners.commands('open-side-panel');
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
