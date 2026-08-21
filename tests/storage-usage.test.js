import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Storage-usage bar census (2026-08 audit): the options-page bar splits
// chrome.storage.local into icon / bookmarks(scan+mark) / other / free.
// "other" is a catch-all, so totals are always exact — the only way the bar
// can mislead is a LARGE dataset landing in "other". This suite is the
// tripwire that forces a segment decision whenever a new storage key
// appears:
//
//   1. every store.knownKeys member (real store.js) must be tabled below;
//   2. every key literal written via setSetting('…')/store.set('…') anywhere
//      in src/ (scanned from the real sources) must be tabled below;
//   3. the dynamic vbm* data families are asserted through representative
//      instances.
//
// Adding a key? Tabling it as 'other' is the cheap, correct default for
// small state. A LARGE dataset (unbounded cache/journal) must NOT be
// tabled 'other' — extend src/storage-usage.js (family or new segment) and
// expect 'icon'/'bookmarks' here instead. All predicates come from the REAL
// src/storage-usage.js — nothing is copied.

const usageSource = fs.readFileSync(new URL('../src/storage-usage.js', import.meta.url), 'utf8');
const storeSource = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');

const usageWindow = {};
new Function('window', usageSource)(usageWindow);
const { categorize } = usageWindow.VBMUsage;

// Minimal store.js sandbox (the knownKeys/syncKeys lists are built at
// evaluation time; the async ready chain may never resolve — irrelevant).
const makeArea = () => ({
    get: async () => ({}),
    set: async () => {},
    remove: async () => {}
});
const storeWindow = { addEventListener: () => {} };
new Function('window', 'chrome', 'localStorage', 'document', storeSource)(
    storeWindow,
    { storage: { local: makeArea(), sync: makeArea() } },
    { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    { getElementById: () => null }
);
const store = storeWindow.store;

// The segment decision table for concrete (non-prefix) keys.
const EXPECTED = {
    // --- scan/mark/visit dataset (bookmarks segment) ---
    deadLastScan: 'bookmarks',
    vbmDeadScan: 'bookmarks',
    deadMarks: 'bookmarks',
    deadMarkTimes: 'bookmarks',
    visitStats: 'bookmarks',
    // --- icon cache index (data keys are the vbmFavicon: prefix family) ---
    vbmFaviconIdx: 'icon',
    // --- small state → other (settings, caches bounded by design) ---
    vbmAnnounce: 'other',
    vbmAnnounceSeen: 'other',
    vbmGithubMirrors: 'other',
    __migrated_v1: 'other',
    deadFilter: 'other',
    deadMarkFilter: 'other',
    deadProxyServer: 'other',
    deadSort: 'other',
    donationDisabled: 'other',
    dupesIgnoreScheme: 'other',
    dupesScope: 'other',
    dupesStrategy: 'other',
    hideDeadProxyStrip: 'other',
    statsHistoryBannerDismissed: 'other',
    statsHistoryImportedAt: 'other',
    statsShowUnbookmarked: 'other',
    statsSort: 'other',
    vbmBtnAlt: 'other',
    // Every store.knownKeys member is small state → other. Listed explicitly
    // so a KNOWN_KEYS addition without a decision fails the census below.
    opens: 'other', popupHeight: 'other', popupWidth: 'other', zoom: 'other',
    searchQuery: 'other', scrollTop: 'other', focusID: 'other', focusSpot: 'other',
    leftClickNewTab: 'other', middleClickBgTab: 'other', closeUnusedFolders: 'other',
    bookmarkClickStayOpen: 'other', dontConfirmOpenFolder: 'other',
    dontRememberState: 'other', onlyShowBMBar: 'other', searchAfterEnter: 'other',
    autoResizePopup: 'other', activeView: 'other', viewState: 'other',
    showViewTabs: 'other', showItemPath: 'other', showRecentBookmarks: 'other',
    showStatsView: 'other', showDeadView: 'other', showDupesView: 'other',
    disableRecentView: 'other', disableStatsView: 'other', disableDeadView: 'other',
    disableDupesView: 'other', rememberView: 'other', showTabBadges: 'other',
    paletteEnabled: 'other', quickAddEnabled: 'other', showToolButton: 'other',
    quickAddContextMenu: 'other', confirmDeleteFolder: 'other', recentCount: 'other',
    searchHistory: 'other', searchHistoryEnabled: 'other', separators: 'other',
    separatorTitle: 'other', separatorURL: 'other', separatorUrl: 'other',
    separatorString: 'other', separatorcolor: 'other', userstyle: 'other',
    customIcon: 'other', theme: 'other', uiLanguage: 'other',
    faviconContrast: 'other', faviconEnrich: 'other', faviconEnrichAgg: 'other',
    faviconBackupInclude: 'other', sortOptions: 'other', currentVersion: 'other',
    openCount: 'other', donationKey: 'other', donationCountDown: 'other',
    donationFactor: 'other'
};

describe('storage-usage categorization (real src/storage-usage.js)', () => {
    it('classifies the icon, bookmarks and other families', () => {
        expect(categorize('vbmFaviconIdx')).toBe('icon');
        expect(categorize('vbmFavicon:example.com')).toBe('icon');
        for (const k of ['deadLastScan', 'vbmDeadScan', 'deadMarks', 'deadMarkTimes', 'visitStats'])
            expect(categorize(k), k).toBe('bookmarks');
        // settings/state keys — including the 4.0.8 additions — ride "other"
        for (const k of ['uiLanguage', 'vbmGithubMirrors', 'vbmAnnounce', 'vbmAnnounceSeen',
            'deadProxyServer', 'dupesStrategy', 'statsSort', 'theme'])
            expect(categorize(k), k).toBe('other');
    });

    it('every store.knownKeys member has a segment decision that matches categorize()', () => {
        expect(store.knownKeys.length).toBeGreaterThan(50); // sanity: real list
        for (const key of store.knownKeys) {
            expect(EXPECTED, `knownKeys member "${key}" is not tabled — decide its segment`).toHaveProperty(key);
            expect(categorize(key), key).toBe(EXPECTED[key]);
        }
    });

    it('every storage-key literal written in src/ has a segment decision', () => {
        const syncKeys = new Set(store.syncKeys); // sync area — out of the local bar's scope
        const literals = new Set();
        for (const f of fs.readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.js'))) {
            const src = fs.readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
            for (const m of src.matchAll(/\bsetSetting\('([A-Za-z0-9_]+)'/g))
                literals.add(m[1]);
            for (const m of src.matchAll(/\bstore\.set\('([A-Za-z0-9_]+)'/g))
                literals.add(m[1]);
        }
        expect(literals.size).toBeGreaterThan(30); // sanity: the scan found real keys
        for (const key of literals) {
            if (syncKeys.has(key)) continue;
            expect(EXPECTED, `storage key "${key}" written in src/ is not tabled — decide its segment`).toHaveProperty(key);
            expect(categorize(key), key).toBe(EXPECTED[key]);
        }
    });
});
