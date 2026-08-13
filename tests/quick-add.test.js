import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createQuickAdd } from '../src/quick-add.js';

// The quick-add star flow (issue #30): the real module driven with a chrome
// double and DOM element stubs. The star button is `#quick-add-btn` (solid
// `.starred` = already bookmarked), the toast is `#quick-add-toast`.

let store, chrome, quickAddBtn, quickAddToast, body, doc, quickAdd;
let tabs, searchResults, created, removed, folderNodes, lastErrorValue;
let fireKeydown;

const flush = async () => {
    for (let i = 0; i < 6; i++)
        await Promise.resolve();
};

beforeEach(() => {
    store = {
        data: { quickAddFolderId: '42' },
        get: (k, dflt) => (k in store.data ? store.data[k] : dflt)
    };
    tabs = [];
    searchResults = [];
    created = [];
    removed = [];
    folderNodes = null;
    lastErrorValue = undefined;

    const makeClassList = () => {
        const set = new Set();
        return {
            add: c => set.add(c),
            remove: c => set.delete(c),
            contains: c => set.has(c),
            _set: set
        };
    };

    quickAddBtn = { title: '', classList: makeClassList() };
    quickAddToast = { textContent: '', classList: makeClassList() };

    body = { classList: makeClassList() };
    doc = {
        _listeners: {},
        addEventListener(type, fn, capture) {
            if (type === 'keydown')
                fireKeydown = { fn, capture };
            else
                (this._listeners[type] = this._listeners[type] || []).push(fn);
        }
    };

    chrome = {
        windows: { WINDOW_ID_CURRENT: 'CURR' },
        tabs: {
            query: (info, cb) => cb(tabs)
        },
        bookmarks: {
            search: (q, cb) => cb(searchResults),
            create: (node, cb) => { created.push(node); if (cb) cb(); },
            remove: (id, cb) => { removed.push(id); if (cb) cb(); },
            get: (id, cb) => cb(folderNodes)
        },
        runtime: { lastError: undefined }
    };

    quickAdd = createQuickAdd({
        store, document: doc, body, chrome,
        quickAddBtn, quickAddToast,
        _m: (key, subs) => key + (subs ? `[${subs.join(',')}]` : '')
    });
    quickAdd.bindQuickAddKey(); // neat.js calls this explicitly too
});

afterEach(() => {
    vi.useRealTimers();
});

describe('quickAddCurrentTab — bookmark a not-yet-saved tab', () => {
    it('creates the bookmark in quickAddFolderId with the tab title and url', async () => {
        tabs = [{ id: 5, title: 'Page T', url: 'https://x.test/' }];
        folderNodes = [{ id: '42', title: 'Work' }];
        quickAdd.quickAddCurrentTab();
        await flush();
        expect(created).toEqual([
            { title: 'Page T', url: 'https://x.test/', parentId: '42' }
        ]);
        // solid star + "remove" title, toast shows the target folder name
        expect(quickAddBtn.classList.contains('starred')).toBe(true);
        expect(quickAddBtn.title).toBe('quickRemoveBookmark');
        expect(quickAddToast.textContent).toBe('quickAddedTo[Work]');
        expect(quickAddToast.classList.contains('show')).toBe(true);
    });

    it('falls back to the URL as the title when the tab title is empty', async () => {
        tabs = [{ id: 5, title: '', url: 'https://y.test/' }];
        folderNodes = [];
        quickAdd.quickAddCurrentTab();
        await flush();
        expect(created[0].title).toBe('https://y.test/');
        // empty folder name → toast without a substitution argument
        expect(quickAddToast.textContent).toBe('quickAddedTo');
    });

    it('does nothing when there is no active tab or no url', async () => {
        tabs = [];
        quickAdd.quickAddCurrentTab();
        await flush();
        tabs = [{ id: 5, title: 'chrome', url: '' }];
        quickAdd.quickAddCurrentTab();
        await flush();
        expect(created).toEqual([]);
        expect(removed).toEqual([]);
    });
});

describe('quickAddCurrentTab — un-bookmark an already-saved tab', () => {
    it('removes the existing bookmark and clears the star (native-star semantics)', async () => {
        tabs = [{ id: 5, title: 'Page T', url: 'https://x.test/' }];
        searchResults = [{ id: '77', title: 'Page T', url: 'https://x.test/' }];
        quickAdd.quickAddCurrentTab();
        await flush();
        expect(removed).toEqual(['77']);
        expect(created).toEqual([]);
        expect(quickAddBtn.classList.contains('starred')).toBe(false);
        expect(quickAddBtn.title).toBe('quickAddBookmark');
        expect(quickAddToast.textContent).toBe('quickRemoved');
    });

    it('skips the remove when the bookmark vanished between search and remove', async () => {
        tabs = [{ id: 5, title: 'Page T', url: 'https://x.test/' }];
        searchResults = [{ id: '77', title: 'Page T', url: 'https://x.test/' }];
        lastErrorValue = 'bookmark gone';
        // runtime.lastError is read inside the remove callback — simulate by
        // making the remove double set it before the callback
        const origRemove = chrome.bookmarks.remove;
        chrome.bookmarks.remove = (id, cb) => {
            removed.push(id);
            chrome.runtime.lastError = { message: 'gone' };
            if (cb) cb();
            chrome.runtime.lastError = undefined;
        };
        quickAdd.quickAddCurrentTab();
        await flush();
        expect(removed).toEqual(['77']);
        // the star stays as-is: no state flip, no toast for the failed remove
        expect(quickAddBtn.classList.contains('starred')).toBe(false);
        expect(quickAddToast.textContent).toBe('');
        chrome.bookmarks.remove = origRemove;
    });
});

describe('refreshQuickAddState — the star mirrors the current tab', () => {
    it('marks the star solid when the page is already bookmarked', async () => {
        tabs = [{ id: 5, title: 'Page T', url: 'https://x.test/' }];
        searchResults = [{ id: '77' }];
        quickAdd.refreshQuickAddState();
        await flush();
        expect(quickAddBtn.classList.contains('starred')).toBe(true);
        expect(quickAddBtn.title).toBe('quickRemoveBookmark');
    });

    it('clears the star when the page is not bookmarked', async () => {
        tabs = [{ id: 5, title: 'Page T', url: 'https://x.test/' }];
        searchResults = [];
        quickAdd.refreshQuickAddState();
        await flush();
        expect(quickAddBtn.classList.contains('starred')).toBe(false);
        expect(quickAddBtn.title).toBe('quickAddBookmark');
    });
});

describe('quickAddEnabled — the star visibility switch (v4 task-3 #20)', () => {
    it('is hidden when the setting is off', () => {
        const star = quickAddBtn;
        const qa = createQuickAdd({
            store: { get: (k, dflt) => (k === 'quickAddEnabled' ? '' : dflt) },
            document: doc, body, chrome, quickAddBtn: star, quickAddToast, _m: () => {}
        });
        expect(star.classList.contains('hidden')).toBe(true);
    });

    it('is visible by default (quickAddEnabled defaults on)', () => {
        const star = quickAddBtn;
        const qa = createQuickAdd({
            store: { get: (k, dflt) => dflt },
            document: doc, body, chrome, quickAddBtn: star, quickAddToast, _m: () => {}
        });
        expect(star.classList.contains('hidden')).toBe(false);
    });
});

describe('showQuickAddToast — auto-hides after 1800ms', () => {
    it('removes the .show class after the timeout', () => {
        vi.useFakeTimers();
        quickAdd.showQuickAddToast('quickAddedTo', 'Work');
        expect(quickAddToast.classList.contains('show')).toBe(true);
        vi.advanceTimersByTime(1800);
        expect(quickAddToast.classList.contains('show')).toBe(false);
    });
});

describe('bindQuickAddKey — Ctrl/Cmd+D does the same', () => {
    const fire = (ev) => fireKeydown.fn.call(doc, ev);

    it('binds a capture-phase listener', () => {
        expect(fireKeydown.capture).toBe(true);
        expect(fireKeydown).toBeTruthy();
    });

    it('Ctrl+D bookmarks the current tab', async () => {
        tabs = [{ id: 5, title: 'Page T', url: 'https://x.test/' }];
        folderNodes = [{ id: '42', title: 'Work' }];
        const ev = { ctrlKey: true, metaKey: false, key: 'd', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        fire(ev);
        await flush();
        expect(created).toHaveLength(1);
        expect(ev.preventDefault).toHaveBeenCalled();
        expect(ev.stopPropagation).toHaveBeenCalled();
    });

    it('Cmd+D works too (mac)', () => {
        tabs = [{ id: 5, title: 'Page T', url: 'https://x.test/' }];
        fire({ ctrlKey: false, metaKey: true, key: 'D', preventDefault: vi.fn(), stopPropagation: vi.fn() });
        expect(created).toHaveLength(1);
    });

    it('a plain "d" (no modifier) is left alone — the tree type-ahead owns it', () => {
        const ev = { ctrlKey: false, metaKey: false, key: 'd', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        fire(ev);
        expect(created).toEqual([]);
        expect(ev.preventDefault).not.toHaveBeenCalled();
    });

    it('is suppressed while a dialog is open', () => {
        body.classList.add('needConfirm');
        const ev = { ctrlKey: true, metaKey: false, key: 'd', preventDefault: vi.fn(), stopPropagation: vi.fn() };
        fire(ev);
        expect(created).toEqual([]);
        expect(ev.preventDefault).not.toHaveBeenCalled();
    });
});
