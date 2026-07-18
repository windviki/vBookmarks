import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sessionFolderName, tabsToBookmarks, saveSession } from '../src/session.js';

// sessionFolderName/tabsToBookmarks are pure; saveSession only needs a
// chrome.bookmarks.create double (callback-style, like the real API).

describe('sessionFolderName', () => {
    it('substitutes the $date$ placeholder with the formatted stamp', () => {
        expect(sessionFolderName(new Date(2026, 6, 18, 15, 4), 'Session $date$'))
            .toBe('Session 2026-07-18 15:04');
    });

    it('formats the date as YYYY-MM-DD HH:mm with zero padding', () => {
        expect(sessionFolderName(new Date(2026, 0, 5, 9, 7), '$date$'))
            .toBe('2026-01-05 09:07');
    });

    it('keeps the last day/minute of the year padded', () => {
        expect(sessionFolderName(new Date(2026, 11, 31, 23, 59), '$date$'))
            .toBe('2026-12-31 23:59');
    });

    it('works with a translated template', () => {
        expect(sessionFolderName(new Date(2026, 6, 18, 15, 4), '会话 $date$'))
            .toBe('会话 2026-07-18 15:04');
    });

    it('appends the stamp when the template lost its placeholder', () => {
        expect(sessionFolderName(new Date(2026, 6, 18, 15, 4), 'Session'))
            .toBe('Session 2026-07-18 15:04');
    });
});

describe('tabsToBookmarks', () => {
    it('keeps http/https/ftp/file URLs with their titles', () => {
        const tabs = [
            { url: 'http://a.com/', title: 'A' },
            { url: 'https://b.com/', title: 'B' },
            { url: 'ftp://c.com/f', title: 'C' },
            { url: 'file:///home/d.pdf', title: 'D' }
        ];
        expect(tabsToBookmarks(tabs)).toEqual([
            { title: 'A', url: 'http://a.com/' },
            { title: 'B', url: 'https://b.com/' },
            { title: 'C', url: 'ftp://c.com/f' },
            { title: 'D', url: 'file:///home/d.pdf' }
        ]);
    });

    it('drops chrome-extension/about/edge/chrome-search/data/javascript schemes', () => {
        const tabs = [
            { url: 'chrome://extensions/', title: 'x' },
            { url: 'chrome-extension://abc/page.html', title: 'x' },
            { url: 'about:blank', title: 'x' },
            { url: 'edge://settings/', title: 'x' },
            { url: 'chrome-search://local-ntp/', title: 'x' },
            { url: 'data:text/html,hi', title: 'x' },
            { url: 'javascript:alert(1)', title: 'x' },
            { url: 'https://ok.com/', title: 'ok' }
        ];
        expect(tabsToBookmarks(tabs)).toEqual([{ title: 'ok', url: 'https://ok.com/' }]);
    });

    it('drops view-source: even when it wraps an http URL (anchored whitelist)', () => {
        expect(tabsToBookmarks([{ url: 'view-source:https://a.com/', title: 'src' }]))
            .toEqual([]);
    });

    it('matches schemes case-insensitively both ways', () => {
        const tabs = [
            { url: 'HTTPS://a.com/', title: 'A' },
            { url: 'CHROME://extensions/', title: 'x' }
        ];
        expect(tabsToBookmarks(tabs)).toEqual([{ title: 'A', url: 'HTTPS://a.com/' }]);
    });

    it('falls back to the URL when the title is empty or missing', () => {
        const tabs = [
            { url: 'https://a.com/', title: '' },
            { url: 'https://b.com/' }
        ];
        expect(tabsToBookmarks(tabs)).toEqual([
            { title: 'https://a.com/', url: 'https://a.com/' },
            { title: 'https://b.com/', url: 'https://b.com/' }
        ]);
    });

    it('deduplicates repeated URLs keeping the first occurrence (OneTab behavior)', () => {
        const tabs = [
            { url: 'https://a.com/', title: 'first' },
            { url: 'https://b.com/', title: 'B' },
            { url: 'https://a.com/', title: 'second' }
        ];
        expect(tabsToBookmarks(tabs)).toEqual([
            { title: 'first', url: 'https://a.com/' },
            { title: 'B', url: 'https://b.com/' }
        ]);
    });

    it('skips tabs without a URL and null entries', () => {
        const tabs = [
            { title: 'no url' },
            null,
            undefined,
            { url: 'https://a.com/', title: 'A' }
        ];
        expect(tabsToBookmarks(tabs)).toEqual([{ title: 'A', url: 'https://a.com/' }]);
    });

    it('returns an empty list for empty or missing input', () => {
        expect(tabsToBookmarks([])).toEqual([]);
        expect(tabsToBookmarks(undefined)).toEqual([]);
        expect(tabsToBookmarks(null)).toEqual([]);
    });
});

describe('saveSession', () => {
    let createCalls;
    let createImpl;

    beforeEach(() => {
        createCalls = [];
        // Default double: resolves immediately with a unique id per call.
        createImpl = (props, cb) => {
            createCalls.push(props);
            cb({ id: `n${createCalls.length}`, ...props });
        };
        globalThis.chrome = { bookmarks: { create: (p, cb) => createImpl(p, cb) } };
    });

    afterEach(() => {
        delete globalThis.chrome;
    });

    const TABS = [
        { title: 'A', url: 'https://a.com/' },
        { title: 'B', url: 'https://b.com/' }
    ];

    it('creates the folder under rootFolderId, then the bookmarks inside it in order', async () => {
        const result = await saveSession({ rootFolderId: '1', folderName: 'Session X', tabs: TABS });
        expect(createCalls).toEqual([
            { parentId: '1', title: 'Session X' },
            { parentId: 'n1', title: 'A', url: 'https://a.com/' },
            { parentId: 'n1', title: 'B', url: 'https://b.com/' }
        ]);
        expect(result).toEqual({ folderId: 'n1', count: 2 });
    });

    it('creates strictly sequentially: no call starts before the previous one resolved', async () => {
        const pending = [];
        createImpl = (props, cb) => {
            createCalls.push(props);
            pending.push(cb); // resolve by hand below
        };
        const done = saveSession({ rootFolderId: '1', folderName: 'S', tabs: TABS });
        const tick = () => new Promise(resolve => setTimeout(resolve, 0));
        await tick();
        expect(createCalls).toHaveLength(1); // folder only
        pending.shift()({ id: 'f1' });
        await tick();
        expect(createCalls).toHaveLength(2); // first bookmark only after the folder resolved
        expect(createCalls[1]).toEqual({ parentId: 'f1', title: 'A', url: 'https://a.com/' });
        pending.shift()({ id: 'b1' });
        await tick();
        expect(createCalls).toHaveLength(3);
        expect(createCalls[2]).toEqual({ parentId: 'f1', title: 'B', url: 'https://b.com/' });
        pending.shift()({ id: 'b2' });
        await expect(done).resolves.toEqual({ folderId: 'f1', count: 2 });
    });

    it('resolves { folderId: null, count: 0 } without touching the backend on an empty list', async () => {
        await expect(saveSession({ rootFolderId: '1', folderName: 'S', tabs: [] }))
            .resolves.toEqual({ folderId: null, count: 0 });
        await expect(saveSession({ rootFolderId: '1', folderName: 'S', tabs: undefined }))
            .resolves.toEqual({ folderId: null, count: 0 });
        expect(createCalls).toEqual([]);
    });

    it('handles a single tab', async () => {
        const result = await saveSession({
            rootFolderId: '42',
            folderName: 'S',
            tabs: [{ title: 'A', url: 'https://a.com/' }]
        });
        expect(result).toEqual({ folderId: 'n1', count: 1 });
        expect(createCalls[0]).toEqual({ parentId: '42', title: 'S' });
    });
});
