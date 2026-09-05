import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Storage-usage bar census (2026-08 audit; simplified in the storage-audit
// fix round, docs/review-4.0.8/storage-usage-report.md §15): the options-page bar splits
// chrome.storage.local into icon / other / free. "other" is a catch-all, so
// totals are always exact. This suite is the tripwire that forces a segment
// decision whenever a new storage key appears:
//
//   1. every store.knownKeys member (real store.js) must be tabled below;
//   2. every key literal written via setSetting('…')/store.set('…') anywhere
//      in src/ (scanned from the real sources) must be tabled below;
//   3. the dynamic vbm* data families are asserted through representative
//      instances.
//
// store.syncKeys members are OUT OF SCOPE for both scans: they live in
// chrome.storage.sync (own quota), which the local bar deliberately does not
// measure — store.knownKeys lists some of them (e.g. theme) for the
// pre-fill/migration, and src/ writes them through the same setSetting/
// store.set API (the store routes by key), so both scans skip syncKeys
// members instead of asserting a local segment for them.
//
// Adding a local key? Tabling it as 'other' is the cheap, correct default
// for small state. A LARGE dataset (unbounded cache/journal, the way the
// favicon cache grows) must be called out in the decision below — adding
// one is a deliberate, reviewed act (the bar itself stays icon/other/free
// unless the dataset gains its own budget controller). All predicates come
// from the REAL src/storage-usage.js — nothing is copied.

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

// The segment decision table for concrete (non-prefix) LOCAL keys — sync
// keys are not tabled (out of scope, see above). Every local key expects
// 'other' (the catch-all) except the favicon-cache index, whose data family
// is the vbmFavicon: prefix.
const EXPECTED = {
    // --- icon cache index (data keys are the vbmFavicon: prefix family) ---
    vbmFaviconIdx: 'icon',
    // --- the former scan/mark dataset → other since the bar simplification ---
    deadLastScan: 'other',
    vbmDeadScan: 'other',
    deadMarks: 'other',
    deadMarkTimes: 'other',
    visitStats: 'other',
    // --- small state → other (settings, caches bounded by design) ---
    vbmAnnounce: 'other',
    vbmAnnounceSeen: 'other',
    vbmGithubMirrors: 'other',
    __migrated_v1: 'other',
    deadProxyServer: 'other',
    donationDisabled: 'other',
    hideDeadProxyStrip: 'other',
    statsHistoryBannerDismissed: 'other',
    statsHistoryImportedAt: 'other',
    vbmBtnAlt: 'other',
    // Every local store.knownKeys member is small state → other. Listed
    // explicitly so a KNOWN_KEYS addition without a decision fails the
    // census below.
    opens: 'other', popupHeight: 'other', popupWidth: 'other', zoom: 'other',
    searchQuery: 'other', scrollTop: 'other', scrollAnchor: 'other', focusID: 'other', focusSpot: 'other',
    autoResizePopup: 'other', activeView: 'other', viewState: 'other',
    searchHistory: 'other', searchHistoryEnabled: 'other', searchHistoryCount: 'other', separators: 'other',
    separatorTitle: 'other', separatorURL: 'other', separatorUrl: 'other',
    separatorString: 'other', separatorcolor: 'other', userstyle: 'other', userstyles: 'other',
    customIcon: 'other', currentVersion: 'other',
    openCount: 'other', donationKey: 'other', donationCountDown: 'other',
    donationFactor: 'other', openInSidePanel: 'other', quickAddFolderId: 'other',
    deadScanConcurrency: 'other', deadScanTimeout: 'other',
    // 4.1.0 tab-groups view: closed-group records (bounded by
    // tabGroupsClosedLimit) + per-device UI collapse state — both small,
    // both local-only (not sync-routed), both "other". tabGroupFolderMeta is
    // written via the TAB_GROUP_FOLDER_META_KEY constant (invisible to the
    // literal scan) — tabled here via its KNOWN_KEYS membership.
    tabGroupsClosed: 'other', tabGroupsViewState: 'other', tabGroupFolderMeta: 'other',
    // velvet staging feature: the workbench dataset (bounded by the 500-item
    // cap) + the folder-picker quick-pick rosters — bookmark-id keyed, local.
    staging: 'other', folderPickPins: 'other', folderPickRecents: 'other',
    stagingShortcuts: 'other', stagingGuideDismissed: 'other',
    // 4.1.0 实验室: the virtual-scroll experiment switch (local, default off)
    virtualScrollLab: 'other'
};

describe('storage-usage categorization (real src/storage-usage.js)', () => {
    it('classifies the icon and other families', () => {
        expect(categorize('vbmFaviconIdx')).toBe('icon');
        expect(categorize('vbmFavicon:example.com')).toBe('icon');
        // the former scan/mark segment now rides the "other" catch-all
        for (const k of ['deadLastScan', 'vbmDeadScan', 'deadMarks', 'deadMarkTimes', 'visitStats'])
            expect(categorize(k), k).toBe('other');
        // settings/state keys — sync-routed or not — also read as "other"
        for (const k of ['uiLanguage', 'vbmGithubMirrors', 'vbmAnnounce', 'vbmAnnounceSeen',
            'deadProxyServer', 'dupesStrategy', 'statsSort', 'theme'])
            expect(categorize(k), k).toBe('other');
    });

    it('every local store.knownKeys member has a segment decision that matches categorize()', () => {
        const syncKeys = new Set(store.syncKeys); // sync area — out of the local bar's scope
        expect(store.knownKeys.length).toBeGreaterThan(50); // sanity: real list
        for (const key of store.knownKeys) {
            if (syncKeys.has(key)) continue;
            expect(EXPECTED, `knownKeys member "${key}" is not tabled — decide its segment`).toHaveProperty(key);
            expect(categorize(key), key).toBe(EXPECTED[key]);
        }
    });

    it('every local storage-key literal written in src/ has a segment decision', () => {
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
