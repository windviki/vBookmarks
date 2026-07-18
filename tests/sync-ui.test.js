import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

// sync-ui.js touches page globals (document/window) only inside initSyncUi,
// so the real module imports cleanly in node once the globals are stubbed.
// The document stub is a minimal id registry + preset querySelectorAll list;
// window carries a recording syncManager double and a listener capture for
// the syncStatusChanged wiring. Assertions target the DOM contract (which
// indicators get removed/appended where, which syncManager calls land) —
// nothing is copied from the module body.

const makeEl = (tagName = 'DIV', id = '') => {
    const node = {
        tagName,
        id,
        className: '',
        title: '',
        innerHTML: '',
        nextSibling: null,
        removed: false,
        _qs: {},
        _appended: [],
        _inserted: [],
        querySelector(sel) {
            return sel in this._qs ? this._qs[sel] : null;
        },
        appendChild(child) {
            this._appended.push(child);
        },
        insertBefore(child, ref) {
            this._inserted.push([child, ref]);
        },
        remove() {
            this.removed = true;
        }
    };
    return node;
};

let initSyncUi;

beforeAll(async () => {
    ({ initSyncUi } = await import('../src/sync-ui.js'));
});

let items;
let allItems;
let docListeners;
let winListeners;
let syncManager;
let store;
let created;

beforeEach(() => {
    items = {};
    allItems = [];
    docListeners = {};
    winListeners = {};
    created = [];
    syncManager = {
        refreshAllSyncStatus() {
            this.refreshed = (this.refreshed || 0) + 1;
        },
        getSyncStatusIndicator(id) {
            return this._status[id];
        },
        getSyncTooltip(id) {
            return this._tooltip[id];
        },
        _status: {},
        _tooltip: {}
    };
    store = {
        _show: 'true',
        getSyncSetting(key, dflt) {
            return key === 'showSyncStatus' ? this._show : dflt;
        }
    };
    globalThis.document = {
        readyState: 'complete',
        getElementById: id => items[id] || null,
        querySelectorAll: () => allItems,
        createElement: tag => {
            const el = makeEl(tag.toUpperCase());
            created.push(el);
            return el;
        },
        addEventListener(type, fn) {
            (docListeners[type] = docListeners[type] || []).push(fn);
        }
    };
    globalThis.window = {
        syncManager,
        addEventListener(type, fn) {
            (winListeners[type] = winListeners[type] || []).push(fn);
        }
    };
});

const mkItem = id => {
    const item = makeEl('LI', id);
    items[id] = item;
    allItems.push(item);
    return item;
};

describe('initSyncUi', () => {
    it('returns the indicator API and keeps the legacy window.neat surface', () => {
        const syncUi = initSyncUi({ store });
        expect(typeof syncUi.updateBookmarkSyncStatus).toBe('function');
        expect(typeof syncUi.refreshSyncIndicators).toBe('function');
        expect(globalThis.window.neat.refreshSyncIndicators).toBe(syncUi.refreshSyncIndicators);
    });

    it('subscribes to syncStatusChanged immediately when DOM is ready and syncManager exists', () => {
        initSyncUi({ store });
        expect(winListeners.syncStatusChanged).toHaveLength(1);
        expect(docListeners.DOMContentLoaded).toBeUndefined();
    });

    it('defers the subscription to DOMContentLoaded while the document is still loading', () => {
        globalThis.document.readyState = 'loading';
        initSyncUi({ store });
        expect(winListeners.syncStatusChanged).toBeUndefined();
        expect(docListeners.DOMContentLoaded).toHaveLength(1);
        docListeners.DOMContentLoaded[0]();
        expect(winListeners.syncStatusChanged).toHaveLength(1);
    });

    it('subscribes to nothing without a syncManager global', () => {
        globalThis.window.syncManager = null;
        initSyncUi({ store });
        expect(winListeners.syncStatusChanged).toBeUndefined();
    });

    it('replaces the indicator of the matching tree row on syncStatusChanged', () => {
        const item = mkItem('neat-tree-item-42');
        const old = makeEl('SPAN');
        const favicon = makeEl('DIV');
        const link = makeEl('A');
        link._qs['.favicon-container'] = favicon;
        item._qs['.sync-indicator'] = old;
        item._qs['.tree-item-link'] = link;
        syncManager._status['42'] = 'synced';
        syncManager._tooltip['42'] = 'Synced just now';
        initSyncUi({ store });
        winListeners.syncStatusChanged[0]({ detail: { bookmarkId: '42', status: 'synced' } });
        expect(old.removed).toBe(true);
        expect(favicon._appended).toHaveLength(1);
        const indicator = favicon._appended[0];
        expect(indicator.className).toBe('sync-indicator synced');
        expect(indicator.title).toBe(''); // custom tooltip only — no native title copy
        expect(indicator.innerHTML).toContain('sync-tooltip');
        expect(indicator.innerHTML).toContain('Synced just now');
    });

    it('updates both the tree row and the results row for the same bookmark id', () => {
        const treeItem = mkItem('neat-tree-item-7');
        const resultsItem = mkItem('results-item-7');
        for (const item of [treeItem, resultsItem]) {
            const link = makeEl('A');
            link._qs['.favicon-container'] = makeEl('DIV');
            item._qs['.tree-item-link'] = link;
        }
        syncManager._status['7'] = 'unsynced';
        syncManager._tooltip['7'] = 'Not synced';
        const syncUi = initSyncUi({ store });
        syncUi.updateBookmarkSyncStatus('7', 'unsynced');
        expect(treeItem._qs['.tree-item-link']._qs['.favicon-container']._appended).toHaveLength(1);
        expect(resultsItem._qs['.tree-item-link']._qs['.favicon-container']._appended).toHaveLength(1);
    });

    it('ignores events without an id, but empty status still clears a stale dot', () => {
        const item = mkItem('neat-tree-item-9');
        initSyncUi({ store });
        // no bookmarkId: nothing happens
        winListeners.syncStatusChanged[0]({ detail: { bookmarkId: '', status: 'synced' } });
        expect(created).toHaveLength(0);
        // empty status with a valid id: handler runs and removes the stale
        // indicator (manager reports nothing for id 9, so no new dot appears)
        const old = makeEl('SPAN');
        item._qs['.sync-indicator'] = old;
        winListeners.syncStatusChanged[0]({ detail: { bookmarkId: '9', status: '' } });
        expect(old.removed).toBe(true);
        expect(created).toHaveLength(0);
    });

    it('removes the old indicator but adds none when showSyncStatus is off', () => {
        store._show = 'false';
        const item = mkItem('neat-tree-item-5');
        const old = makeEl('SPAN');
        item._qs['.sync-indicator'] = old;
        syncManager._status['5'] = 'synced';
        syncManager._tooltip['5'] = 'tip';
        const syncUi = initSyncUi({ store });
        syncUi.updateBookmarkSyncStatus('5', 'synced');
        expect(old.removed).toBe(true);
        expect(created).toHaveLength(0);
    });

    it('adds no indicator when the manager reports an empty status class', () => {
        const item = mkItem('neat-tree-item-6');
        const link = makeEl('A');
        link._qs['.favicon-container'] = makeEl('DIV');
        item._qs['.tree-item-link'] = link;
        const syncUi = initSyncUi({ store });
        syncUi.updateBookmarkSyncStatus('6', 'whatever');
        expect(link._qs['.favicon-container']._appended).toHaveLength(0);
    });

    it('falls back to inserting after the favicon img when no favicon container exists', () => {
        const item = mkItem('neat-tree-item-11');
        const anchor = makeEl('A');
        const img = makeEl('IMG');
        img.nextSibling = makeEl('I');
        anchor._qs['img'] = img;
        item._qs['a'] = anchor;
        syncManager._status['11'] = 'synced';
        syncManager._tooltip['11'] = 'tip';
        const syncUi = initSyncUi({ store });
        syncUi.updateBookmarkSyncStatus('11', 'synced');
        expect(anchor._inserted).toHaveLength(1);
        expect(anchor._inserted[0][1]).toBe(img.nextSibling);
        expect(anchor._appended).toHaveLength(0);
    });

    it('falls back to appending when there is no img to insert after', () => {
        const item = mkItem('neat-tree-item-12');
        const anchor = makeEl('A');
        anchor._qs['img'] = null;
        item._qs['a'] = anchor;
        syncManager._status['12'] = 'synced';
        syncManager._tooltip['12'] = 'tip';
        const syncUi = initSyncUi({ store });
        syncUi.updateBookmarkSyncStatus('12', 'synced');
        expect(anchor._inserted).toHaveLength(0);
        expect(anchor._appended).toHaveLength(1);
    });

    it('refreshSyncIndicators asks the manager to refresh, then rebuilds every row badge', () => {
        const a = mkItem('neat-tree-item-1');
        const b = mkItem('results-item-2');
        for (const [item, id] of [[a, '1'], [b, '2']]) {
            const link = makeEl('A');
            link._qs['.favicon-container'] = makeEl('DIV');
            item._qs['.tree-item-link'] = link;
            syncManager._status[id] = 'synced';
            syncManager._tooltip[id] = `tip-${id}`;
        }
        const syncUi = initSyncUi({ store });
        syncUi.refreshSyncIndicators();
        expect(syncManager.refreshed).toBe(1);
        expect(a._qs['.tree-item-link']._qs['.favicon-container']._appended[0].innerHTML).toContain('tip-1');
        expect(b._qs['.tree-item-link']._qs['.favicon-container']._appended[0].innerHTML).toContain('tip-2');
    });

    it('refreshSyncIndicators strips both id prefixes before querying the manager', () => {
        mkItem('neat-tree-item-100');
        mkItem('results-item-200');
        const seen = [];
        syncManager.getSyncStatusIndicator = id => {
            seen.push(id);
            return '';
        };
        const syncUi = initSyncUi({ store });
        syncUi.refreshSyncIndicators();
        expect(seen).toEqual(['100', '200']);
    });

    it('refreshSyncIndicators skips the manager round-trip when it is absent', () => {
        mkItem('neat-tree-item-3');
        globalThis.window.syncManager = null;
        const syncUi = initSyncUi({ store });
        expect(() => syncUi.refreshSyncIndicators()).not.toThrow();
        expect(created).toHaveLength(0);
    });
});
