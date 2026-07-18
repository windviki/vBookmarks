import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// src/sync-manager.js is a classic script (an IIFE assigning
// window.syncManager) loaded by popup.html/sidepanel.html. Tests evaluate
// the real source with injected window/chrome doubles — the same approach
// fuzzy.test.js uses for fuzzy.js.

const source = fs.readFileSync(new URL('../src/sync-manager.js', import.meta.url), 'utf8');

const flushMicrotasks = async (rounds = 10) => {
    for (let i = 0; i < rounds; i++) {
        await Promise.resolve();
    }
};

class CustomEventDouble {
    constructor(type, init) {
        this.type = type;
        this.detail = init ? init.detail : undefined;
    }
}

const loadClient = ({ sessionBlob, sendMessageImpl } = {}) => {
    const dispatched = [];
    const sent = [];
    const storageListeners = [];
    const window = {
        CustomEvent: CustomEventDouble,
        dispatchEvent(event) {
            dispatched.push(event);
        }
    };
    const storage = {
        session: {
            get(key) {
                return Promise.resolve({ [key]: sessionBlob });
            }
        },
        onChanged: {
            addListener(fn) {
                storageListeners.push(fn);
            }
        }
    };
    const chrome = {
        storage,
        runtime: {
            lastError: undefined,
            sendMessage: sendMessageImpl || ((message, cb) => {
                sent.push(message);
                if (cb) cb();
            })
        }
    };
    new Function('window', 'chrome', source)(window, chrome);
    return { window, chrome, dispatched, sent, storageListeners };
};

const blobWith = entries => Object.fromEntries(
    Object.entries(entries).map(([id, [indicator, tooltip]]) => [id, { indicator, tooltip, ts: 1 }])
);

describe('sync-manager page client', () => {
    it('exposes the window.syncManager surface synchronously', () => {
        const { window } = loadClient();
        expect(typeof window.syncManager.getSyncStatusIndicator).toBe('function');
        expect(typeof window.syncManager.getSyncTooltip).toBe('function');
        expect(typeof window.syncManager.refreshAllSyncStatus).toBe('function');
    });

    it('mirrors the storage.session blob on init and serves hits synchronously', async () => {
        const { window } = loadClient({
            sessionBlob: blobWith({ a: ['synced', 'Synced to cloud'] })
        });
        await flushMicrotasks();
        expect(window.syncManager.getSyncStatusIndicator('a')).toBe('synced');
        expect(window.syncManager.getSyncTooltip('a')).toBe('Synced to cloud');
    });

    it('does not message the SW when the mirror entry exists', async () => {
        const { window, sent } = loadClient({
            sessionBlob: blobWith({ a: ['synced', 'Synced to cloud'] })
        });
        await flushMicrotasks();
        window.syncManager.getSyncStatusIndicator('a');
        window.syncManager.getSyncTooltip('a');
        expect(sent).toHaveLength(0);
    });

    it('returns empty strings for known-unknown entries without messaging', async () => {
        const { window, sent } = loadClient({
            sessionBlob: blobWith({ a: ['', ''] })
        });
        await flushMicrotasks();
        expect(window.syncManager.getSyncStatusIndicator('a')).toBe('');
        expect(window.syncManager.getSyncTooltip('a')).toBe('');
        expect(sent).toHaveLength(0);
    });

    it('returns "" on a mirror miss and asks the SW for that id', async () => {
        const { window, sent } = loadClient({ sessionBlob: {} });
        await flushMicrotasks();
        expect(window.syncManager.getSyncStatusIndicator('nope')).toBe('');
        expect(window.syncManager.getSyncTooltip('nope')).toBe('');
        expect(sent).toEqual([
            { type: 'vbm-sync-status-request', ids: ['nope'] },
            { type: 'vbm-sync-status-request', ids: ['nope'] }
        ]);
    });

    it('refreshAllSyncStatus nudges the SW fire-and-forget and returns true', () => {
        const { window, sent } = loadClient();
        expect(window.syncManager.refreshAllSyncStatus()).toBe(true);
        expect(sent).toEqual([{ type: 'vbm-sync-refresh' }]);
    });

    it('updates the mirror when the session blob changes', async () => {
        const env = loadClient({ sessionBlob: blobWith({ a: ['local', 'Local only'] }) });
        await flushMicrotasks();
        expect(env.window.syncManager.getSyncStatusIndicator('a')).toBe('local');
        env.storageListeners[0]({
            vbmSyncStatus: {
                oldValue: blobWith({ a: ['local', 'Local only'] }),
                newValue: blobWith({ a: ['synced', 'Synced to cloud'] })
            }
        }, 'session');
        expect(env.window.syncManager.getSyncStatusIndicator('a')).toBe('synced');
        expect(env.window.syncManager.getSyncTooltip('a')).toBe('Synced to cloud');
    });

    it('dispatches syncStatusChanged per changed id with the {bookmarkId, status} detail', async () => {
        const env = loadClient({ sessionBlob: blobWith({ a: ['local', 'Local only'] }) });
        await flushMicrotasks();
        env.dispatched.length = 0;
        env.storageListeners[0]({
            vbmSyncStatus: {
                oldValue: blobWith({ a: ['local', 'Local only'] }),
                newValue: blobWith({
                    a: ['synced', 'Synced to cloud'],
                    b: ['unsyncable', 'Cannot be synced']
                })
            }
        }, 'session');
        expect(env.dispatched).toHaveLength(2);
        expect(env.dispatched[0].type).toBe('syncStatusChanged');
        const byId = Object.fromEntries(env.dispatched.map(e => [e.detail.bookmarkId, e.detail.status]));
        expect(byId).toEqual({ a: 'synced', b: 'unsyncable' });
    });

    it('does not re-dispatch ids whose entry is unchanged', async () => {
        const env = loadClient({ sessionBlob: blobWith({ a: ['synced', 'Synced to cloud'] }) });
        await flushMicrotasks();
        env.dispatched.length = 0;
        env.storageListeners[0]({
            vbmSyncStatus: {
                oldValue: blobWith({ a: ['synced', 'Synced to cloud'] }),
                newValue: blobWith({
                    a: ['synced', 'Synced to cloud'],
                    b: ['local', 'Local only']
                })
            }
        }, 'session');
        expect(env.dispatched).toHaveLength(1);
        expect(env.dispatched[0].detail).toEqual({ bookmarkId: 'b', status: 'local' });
    });

    it('dispatches an empty status for ids removed from the blob', async () => {
        const env = loadClient({ sessionBlob: blobWith({ a: ['synced', 'Synced to cloud'] }) });
        await flushMicrotasks();
        env.dispatched.length = 0;
        env.storageListeners[0]({
            vbmSyncStatus: {
                oldValue: blobWith({ a: ['synced', 'Synced to cloud'] }),
                newValue: {}
            }
        }, 'session');
        expect(env.dispatched).toHaveLength(1);
        expect(env.dispatched[0].detail).toEqual({ bookmarkId: 'a', status: '' });
        expect(env.window.syncManager.getSyncStatusIndicator('a')).toBe('');
    });

    it('ignores storage changes from other areas', async () => {
        const env = loadClient({ sessionBlob: blobWith({ a: ['synced', 'Synced to cloud'] }) });
        await flushMicrotasks();
        env.dispatched.length = 0;
        env.storageListeners[0]({
            vbmSyncStatus: { oldValue: {}, newValue: blobWith({ b: ['local', 'Local only'] }) }
        }, 'sync');
        expect(env.dispatched).toHaveLength(0);
        expect(env.window.syncManager.getSyncStatusIndicator('b')).toBe('');
    });

    it('swallows sendMessage failures instead of breaking rendering', () => {
        const { window } = loadClient({
            sendMessageImpl() {
                throw new Error('no SW');
            }
        });
        expect(() => window.syncManager.getSyncStatusIndicator('a')).not.toThrow();
        expect(() => window.syncManager.refreshAllSyncStatus()).not.toThrow();
    });
});
