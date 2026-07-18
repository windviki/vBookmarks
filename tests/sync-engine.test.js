import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSyncEngine, computeStatus, SYNC_STORAGE_KEY, REFRESH_ALARM } from '../src/sync-engine.js';

// src/sync-engine.js reads the chrome global at call time, so tests inject
// a recording double on globalThis before calling createSyncEngine(). All
// chrome.bookmarks callbacks in the double fire synchronously; the flush
// debounce is driven by vitest fake timers. Tooltip expectations are the
// page contract — byte-identical to what the old SyncManager rendered.

const flushMicrotasks = async (rounds = 10) => {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve();
    }
};

const BOOKMARK_EVENTS = [
    'onCreated', 'onChanged', 'onRemoved', 'onMoved',
    'onChildrenReordered', 'onImportBegan', 'onImportEnded'
];

const makeChromeDouble = () => {
    const listeners = { bookmarks: {}, alarm: [], storage: [], message: [] };
    const calls = {
        getTree: 0,
        bookmarkGet: [],
        alarmCreate: [],
        alarmClear: [],
        sessionSet: []
    };
    const chrome = {
        runtime: { lastError: undefined },
        bookmarks: {
            tree: [],
            nodes: {},
            getTree(cb) {
                calls.getTree++;
                cb(this.tree);
            },
            get(id, cb) {
                calls.bookmarkGet.push(id);
                const node = this.nodes[id];
                cb(node ? [node] : undefined);
            }
        },
        alarms: {
            create(name, info) {
                calls.alarmCreate.push({ name, info });
            },
            clear(name) {
                calls.alarmClear.push(name);
                return Promise.resolve(true);
            }
        },
        storage: {
            syncValues: {},
            sessionBlob: undefined
        }
    };
    for (const eventName of BOOKMARK_EVENTS) {
        chrome.bookmarks[eventName] = {
            addListener(fn) {
                (listeners.bookmarks[eventName] = listeners.bookmarks[eventName] || []).push(fn);
            }
        };
    }
    chrome.alarms.onAlarm = { addListener(fn) { listeners.alarm.push(fn); } };
    chrome.storage.sync = {
        get(defaults, cb) {
            cb({ ...defaults, ...chrome.storage.syncValues });
        }
    };
    chrome.storage.session = {
        set(obj) {
            calls.sessionSet.push(obj);
            chrome.storage.sessionBlob = obj[SYNC_STORAGE_KEY];
            return Promise.resolve();
        }
    };
    chrome.storage.onChanged = { addListener(fn) { listeners.storage.push(fn); } };
    chrome.runtime.onMessage = { addListener(fn) { listeners.message.push(fn); } };
    return { chrome, listeners, calls };
};

describe('computeStatus', () => {
    it('maps syncing=true to synced / "Synced to cloud"', () => {
        expect(computeStatus({ id: '1', url: 'https://a.example/', syncing: true }))
            .toEqual({ indicator: 'synced', tooltip: 'Synced to cloud' });
    });

    it('maps syncing=false to local / "Local only"', () => {
        expect(computeStatus({ id: '1', url: 'https://a.example/', syncing: false }))
            .toEqual({ indicator: 'local', tooltip: 'Local only' });
    });

    it('keeps the folderType suffix format for synced special folders', () => {
        expect(computeStatus({ id: '1', folderType: 'bookmarks-bar', syncing: true }))
            .toEqual({ indicator: 'synced', tooltip: 'bookmarks-bar (Synced)' });
    });

    it('keeps the folderType suffix format for local special folders', () => {
        expect(computeStatus({ id: '2', folderType: 'other', syncing: false }))
            .toEqual({ indicator: 'local', tooltip: 'other (Local only)' });
    });

    it('reports unknown (empty strings) when syncing is undefined on old Chrome', () => {
        expect(computeStatus({ id: '1', url: 'https://a.example/' }))
            .toEqual({ indicator: '', tooltip: '' });
    });

    it('reports unknown for folders without syncing too (never fabricates synced)', () => {
        expect(computeStatus({ id: '1', title: 'folder', children: [] }))
            .toEqual({ indicator: '', tooltip: '' });
    });

    it('flags blacklisted chrome:// URLs as unsyncable when syncing is undefined', () => {
        expect(computeStatus({ id: '1', url: 'chrome://extensions/' }))
            .toEqual({ indicator: 'unsyncable', tooltip: 'Cannot be synced' });
    });

    it('flags every blacklisted URL scheme as unsyncable', () => {
        const urls = [
            'chrome://extensions/',
            'chrome-extension://abc/page.html',
            'moz-extension://abc/page.html',
            'edge://settings/',
            'about:blank',
            'data:text/html,hi',
            'file:///home/a.pdf',
            'javascript:alert(1)'
        ];
        for (const url of urls) {
            expect(computeStatus({ id: '1', url }).indicator).toBe('unsyncable');
        }
    });

    it('lets node.syncing win over a blacklisted URL', () => {
        expect(computeStatus({ id: '1', url: 'chrome://extensions/', syncing: true }).indicator)
            .toBe('synced');
        expect(computeStatus({ id: '1', url: 'chrome://extensions/', syncing: false }).indicator)
            .toBe('local');
    });

    it('maps a null node to empty status', () => {
        expect(computeStatus(null)).toEqual({ indicator: '', tooltip: '' });
    });
});

describe('createSyncEngine', () => {
    let double;

    beforeEach(() => {
        vi.useFakeTimers();
        double = makeChromeDouble();
        globalThis.chrome = double.chrome;
    });

    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.chrome;
    });

    describe('start()', () => {
        it('registers all seven bookmark event listeners', () => {
            createSyncEngine().start();
            for (const eventName of BOOKMARK_EVENTS) {
                expect(double.listeners.bookmarks[eventName]).toHaveLength(1);
            }
        });

        it('registers the alarm, storage and message listeners', () => {
            createSyncEngine().start();
            expect(double.listeners.alarm).toHaveLength(1);
            expect(double.listeners.storage).toHaveLength(1);
            expect(double.listeners.message).toHaveLength(1);
        });

        it('schedules the refresh alarm from the stored interval (default 60s → 1min)', () => {
            createSyncEngine().start();
            expect(double.calls.alarmCreate).toEqual([
                { name: REFRESH_ALARM, info: { periodInMinutes: 1 } }
            ]);
        });

        it('converts the interval seconds to minutes', () => {
            double.chrome.storage.syncValues = { syncRefreshInterval: 120 };
            createSyncEngine().start();
            expect(double.calls.alarmCreate[0].info.periodInMinutes).toBe(2);
        });

        it('clamps sub-30s legacy intervals to the 0.5 minute alarms floor', () => {
            double.chrome.storage.syncValues = { syncRefreshInterval: 20 };
            createSyncEngine().start();
            expect(double.calls.alarmCreate[0].info.periodInMinutes).toBe(0.5);
        });

        it('clears the alarm instead when autoRefreshSync is the string "false"', () => {
            double.chrome.storage.syncValues = { autoRefreshSync: 'false' };
            createSyncEngine().start();
            expect(double.calls.alarmCreate).toHaveLength(0);
            expect(double.calls.alarmClear).toEqual([REFRESH_ALARM]);
        });

        it('clears the alarm for the legacy boolean false too', () => {
            double.chrome.storage.syncValues = { autoRefreshSync: false };
            createSyncEngine().start();
            expect(double.calls.alarmCreate).toHaveLength(0);
            expect(double.calls.alarmClear).toEqual([REFRESH_ALARM]);
        });

        it('reschedules the alarm when the sync settings change', () => {
            createSyncEngine().start();
            double.listeners.storage[0]({ autoRefreshSync: { newValue: 'false' } }, 'sync');
            expect(double.calls.alarmClear).toEqual([REFRESH_ALARM]);
            double.listeners.storage[0]({ autoRefreshSync: { newValue: 'true' }, syncRefreshInterval: { newValue: 300 } }, 'sync');
            expect(double.calls.alarmCreate.at(-1)).toEqual({
                name: REFRESH_ALARM,
                info: { periodInMinutes: 5 }
            });
        });

        it('ignores storage changes from other areas', () => {
            createSyncEngine().start();
            const creates = double.calls.alarmCreate.length;
            double.listeners.storage[0]({ autoRefreshSync: { newValue: 'false' } }, 'local');
            expect(double.calls.alarmCreate).toHaveLength(creates);
            expect(double.calls.alarmClear).toHaveLength(0);
        });
    });

    describe('recomputeAll()', () => {
        const tree = () => [
            {
                id: '0', title: '', children: [
                    {
                        id: '1', title: 'Bookmarks bar', folderType: 'bookmarks-bar', syncing: true,
                        children: [
                            { id: '10', parentId: '1', title: 'a', url: 'https://a.example/', syncing: true },
                            { id: '11', parentId: '1', title: 'b', url: 'https://b.example/', syncing: false },
                            { id: '12', parentId: '1', title: 'c', url: 'chrome://extensions/' },
                            { id: '13', parentId: '1', title: 'd', url: 'https://d.example/' }
                        ]
                    },
                    { id: '2', title: 'Other bookmarks', folderType: 'other', syncing: false, children: [] }
                ]
            }
        ];

        it('walks the tree recursively and publishes every node to storage.session', async () => {
            double.chrome.bookmarks.tree = tree();
            const engine = createSyncEngine();
            engine.start();
            await engine.recomputeAll();
            vi.advanceTimersByTime(500);
            const blob = double.chrome.storage.sessionBlob;
            expect(Object.keys(blob).sort()).toEqual(['0', '1', '10', '11', '12', '13', '2']);
            expect(blob['1']).toEqual({
                indicator: 'synced',
                tooltip: 'bookmarks-bar (Synced)',
                ts: expect.any(Number)
            });
            expect(blob['10']).toEqual({
                indicator: 'synced',
                tooltip: 'Synced to cloud',
                ts: expect.any(Number)
            });
            expect(blob['11'].indicator).toBe('local');
            expect(blob['12']).toEqual({
                indicator: 'unsyncable',
                tooltip: 'Cannot be synced',
                ts: expect.any(Number)
            });
            expect(blob['13']).toEqual({ indicator: '', tooltip: '', ts: expect.any(Number) });
            expect(blob['2'].tooltip).toBe('other (Local only)');
        });

        it('debounces bursts into a single session write', async () => {
            double.chrome.bookmarks.tree = tree();
            const engine = createSyncEngine();
            engine.start();
            await engine.recomputeAll();
            await engine.recomputeAll();
            vi.advanceTimersByTime(499);
            expect(double.calls.sessionSet).toHaveLength(0);
            vi.advanceTimersByTime(1);
            expect(double.calls.sessionSet).toHaveLength(1);
        });

        it('skips the publish silently when storage.session is unavailable', async () => {
            delete double.chrome.storage.session;
            double.chrome.bookmarks.tree = tree();
            const engine = createSyncEngine();
            engine.start();
            await engine.recomputeAll();
            vi.advanceTimersByTime(1000);
            // No throw, no write — nothing else to assert
        });
    });

    describe('recomputeIds()', () => {
        it('updates known nodes and drops missing ones', async () => {
            double.chrome.bookmarks.tree = [
                { id: '0', title: '', children: [{ id: 'a', title: 'a', url: 'https://a.example/', syncing: true }] }
            ];
            double.chrome.bookmarks.nodes = {
                a: { id: 'a', title: 'a', url: 'https://a.example/', syncing: true },
                b: { id: 'b', title: 'b', url: 'https://b.example/', syncing: false }
            };
            const engine = createSyncEngine();
            engine.start();
            await engine.recomputeAll();
            await engine.recomputeIds(['a', 'b', 'zz']);
            vi.advanceTimersByTime(500);
            const blob = double.chrome.storage.sessionBlob;
            expect(blob['a'].indicator).toBe('synced');
            expect(blob['b']).toEqual({
                indicator: 'local',
                tooltip: 'Local only',
                ts: expect.any(Number)
            });
            expect('zz' in blob).toBe(false);
            expect(double.calls.bookmarkGet).toEqual(['a', 'b', 'zz']);
        });

        it('ignores non-array input', async () => {
            const engine = createSyncEngine();
            engine.start();
            await engine.recomputeIds('a');
            expect(double.calls.bookmarkGet).toHaveLength(0);
        });
    });

    describe('event and message routing', () => {
        beforeEach(() => {
            double.chrome.bookmarks.tree = [
                { id: '0', title: '', children: [{ id: 'a', title: 'a', url: 'https://a.example/', syncing: true }] }
            ];
        });

        it('recomputes the whole tree when the refresh alarm fires', async () => {
            const engine = createSyncEngine();
            engine.start();
            const before = double.calls.getTree;
            double.listeners.alarm[0]({ name: REFRESH_ALARM });
            await flushMicrotasks();
            expect(double.calls.getTree).toBe(before + 1);
        });

        it('ignores alarms with other names', async () => {
            const engine = createSyncEngine();
            engine.start();
            const before = double.calls.getTree;
            double.listeners.alarm[0]({ name: 'something-else' });
            await flushMicrotasks();
            expect(double.calls.getTree).toBe(before);
        });

        it('recomputes created/changed/moved nodes by id', async () => {
            double.chrome.bookmarks.nodes['9'] = { id: '9', title: 'n', url: 'https://n.example/', syncing: true };
            const engine = createSyncEngine();
            engine.start();
            double.listeners.bookmarks.onCreated[0]('9');
            await flushMicrotasks();
            vi.advanceTimersByTime(500);
            expect(double.chrome.storage.sessionBlob['9'].indicator).toBe('synced');
        });

        it('drops removed nodes from the published map', async () => {
            const engine = createSyncEngine();
            engine.start();
            await engine.recomputeAll();
            vi.advanceTimersByTime(500);
            expect('a' in double.chrome.storage.sessionBlob).toBe(true);
            double.listeners.bookmarks.onRemoved[0]('a');
            vi.advanceTimersByTime(500);
            expect('a' in double.chrome.storage.sessionBlob).toBe(false);
        });

        it('recomputes everything after an import ends', async () => {
            const engine = createSyncEngine();
            engine.start();
            const before = double.calls.getTree;
            double.listeners.bookmarks.onImportEnded[0]();
            await flushMicrotasks();
            expect(double.calls.getTree).toBe(before + 1);
        });

        it('routes the vbm-sync-refresh message to recomputeAll', async () => {
            const engine = createSyncEngine();
            engine.start();
            const before = double.calls.getTree;
            double.listeners.message[0]({ type: 'vbm-sync-refresh' });
            await flushMicrotasks();
            expect(double.calls.getTree).toBe(before + 1);
        });

        it('routes the vbm-sync-status-request message to recomputeIds', async () => {
            double.chrome.bookmarks.nodes['7'] = { id: '7', title: 's', url: 'https://s.example/', syncing: true };
            const engine = createSyncEngine();
            engine.start();
            double.listeners.message[0]({ type: 'vbm-sync-status-request', ids: ['7'] });
            await flushMicrotasks();
            expect(double.calls.bookmarkGet).toEqual(['7']);
            vi.advanceTimersByTime(500);
            expect(double.chrome.storage.sessionBlob['7'].indicator).toBe('synced');
        });

        it('ignores unknown message types', async () => {
            const engine = createSyncEngine();
            engine.start();
            const before = double.calls.getTree;
            double.listeners.message[0]({ type: 'nope' });
            double.listeners.message[0](null);
            await flushMicrotasks();
            expect(double.calls.getTree).toBe(before);
            expect(double.calls.bookmarkGet).toHaveLength(0);
        });
    });
});
