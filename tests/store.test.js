import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';

// Load the real store.js source and evaluate it in a sandbox with mocked
// window/chrome/localStorage/document — the same globals a classic script
// would see inside an extension page.
const storeSource = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');

const createSandbox = ({
    localStorageData = {},
    chromeLocalData = {},
    chromeSyncData = {}
} = {}) => {
    // chrome.storage areas, backed by plain objects (shared by reference so a
    // second sandbox can be pointed at the same "profile")
    const localData = chromeLocalData;
    const syncData = chromeSyncData;
    const localSetCalls = [];
    const syncSetCalls = [];
    const localGetCalls = [];

    const makeArea = (data, record, getRecord) => ({
        get: async keys => {
            if (getRecord) getRecord.push(keys);
            if (keys === null || keys === undefined) return { ...data };
            if (typeof keys === 'string') return { [keys]: data[keys] };
            if (Array.isArray(keys)) {
                const out = {};
                for (const k of keys) if (k in data) out[k] = data[k];
                return out;
            }
            const out = {};
            for (const k in keys) out[k] = (k in data) ? data[k] : keys[k];
            return out;
        },
        set: async obj => {
            if (record) record.push({ ...obj });
            Object.assign(data, obj);
        },
        remove: async keys => {
            for (const k of [].concat(keys)) delete data[k];
        },
        clear: async () => {
            for (const k in data) delete data[k];
        }
    });

    const chrome = {
        storage: {
            local: makeArea(localData, localSetCalls, localGetCalls),
            sync: makeArea(syncData, syncSetCalls)
        }
    };

    // Map-style localStorage mock
    const lsData = new Map(Object.entries(localStorageData));
    const localStorage = {
        getItem: k => (lsData.has(k) ? lsData.get(k) : null),
        setItem: (k, v) => lsData.set(k, String(v)),
        removeItem: k => lsData.delete(k),
        clear: () => lsData.clear()
    };

    const window = { addEventListener: () => {} };
    const document = { addEventListener: () => {} };

    new Function('window', 'chrome', 'localStorage', 'document', storeSource)(
        window, chrome, localStorage, document
    );

    return { window, chrome, localStorage, lsData, localData, syncData, localSetCalls, syncSetCalls, localGetCalls };
};

afterEach(() => {
    vi.useRealTimers();
});

describe('store.js', () => {
    describe('legacy migration', () => {
        it('copies known localStorage keys into chrome.storage.local and sets the flag', async () => {
            const sb = createSandbox({
                localStorageData: {
                    popupHeight: '400',
                    opens: '["1"]',
                    separatorTitle: '-',
                    donationKey: '801'
                }
            });
            await sb.window.store.ready;

            expect(sb.localData.popupHeight).toBe('400');
            expect(sb.localData.opens).toBe('["1"]');
            expect(sb.localData.separatorTitle).toBe('-');
            expect(sb.localData.donationKey).toBe('801');
            expect(sb.localData.__migrated_v1).toBe('1');
            // mirror serves the migrated values
            expect(sb.window.store.get('popupHeight')).toBe('400');
            // localStorage originals are kept
            expect(sb.lsData.get('popupHeight')).toBe('400');
            expect(sb.lsData.get('donationKey')).toBe('801');
        });

        it('registers the three favicon settings keys for migration (audit T8)', async () => {
            const sb = createSandbox({
                localStorageData: {
                    faviconContrast: '1',
                    faviconEnrich: '',
                    faviconEnrichAgg: '1',
                    faviconBackupInclude: ''
                }
            });
            await sb.window.store.ready;
            // All four are sync-routed (2026-08 storage audit): the v1
            // migration hands them to chrome.storage.local and the local→sync
            // migration moves them on to the sync area, cleaning the local
            // residue after the successful write.
            expect(sb.syncData.faviconContrast).toBe('1');
            expect(sb.syncData.faviconEnrich).toBe('');
            expect(sb.syncData.faviconEnrichAgg).toBe('1');
            expect(sb.syncData.faviconBackupInclude).toBe('');
            expect('faviconContrast' in sb.localData).toBe(false);
            expect('faviconEnrich' in sb.localData).toBe(false);
            expect('faviconBackupInclude' in sb.localData).toBe(false);
            expect(sb.window.store.get('faviconBackupInclude')).toBe('');
        });

        it('registers the focusSpot popup-state key for migration', async () => {
            const sb = createSandbox({
                localStorageData: { focusSpot: '{"zone":"header","key":"tool-btn"}' }
            });
            await sb.window.store.ready;
            expect(sb.localData.focusSpot).toBe('{"zone":"header","key":"tool-btn"}');
            expect(sb.window.store.get('focusSpot')).toBe('{"zone":"header","key":"tool-btn"}');
        });

        it('is idempotent: a second init does not write again', async () => {
            const first = createSandbox({
                localStorageData: { popupHeight: '400' }
            });
            await first.window.store.ready;
            expect(first.localSetCalls.some(c => '__migrated_v1' in c)).toBe(true);

            // second init against the same chrome.storage profile
            const second = createSandbox({
                localStorageData: { popupHeight: '400' },
                chromeLocalData: first.localData
            });
            await second.window.store.ready;
            expect(second.localSetCalls).toHaveLength(0);
        });

        it('does not overwrite keys that already exist in chrome.storage', async () => {
            const sb = createSandbox({
                localStorageData: { popupHeight: '400', zoom: '110' },
                chromeLocalData: { zoom: '130' }
            });
            await sb.window.store.ready;

            expect(sb.localData.zoom).toBe('130');
            expect(sb.localData.popupHeight).toBe('400');
        });
    });

    describe('mirror', () => {
        it('prefers chrome.storage values over localStorage ones', async () => {
            const sb = createSandbox({
                localStorageData: { popupHeight: '400' },
                chromeLocalData: { popupHeight: '555', __migrated_v1: '1' }
            });
            await sb.window.store.ready;
            expect(sb.window.store.get('popupHeight')).toBe('555');
        });

        it('synchronously pre-fills from localStorage before ready resolves', () => {
            const sb = createSandbox({
                localStorageData: { scrollTop: '42' }
            });
            // no await: mirror must already hold the legacy value
            expect(sb.window.store.get('scrollTop')).toBe('42');
        });

        it('returns the default value for unknown keys', async () => {
            const sb = createSandbox();
            await sb.window.store.ready;
            expect(sb.window.store.get('nope')).toBeUndefined();
            expect(sb.window.store.get('nope', '')).toBe('');
        });
    });

    describe('init fetch enumeration (2026-08 perf audit)', () => {
        it('fetches only the enumerated boot keys — favicon cache bytes are never requested', async () => {
            const sb = createSandbox({
                chromeLocalData: {
                    __migrated_v1: '1',
                    zoom: '120',
                    visitStats: '{"1":{"c":2,"t":3}}',
                    deadMarks: '["5"]',
                    dupesLastResult: '{"ts":1,"groups":[]}',
                    'vbmFavicon:example.com': 'data:image/png;base64,AAAA',
                    vbmFaviconIdx: '{"v":1,"hosts":{}}',
                    deadLastScan: '{"ts":1}',
                    vbmDeadScan: '{"state":"done"}'
                }
            });
            await sb.window.store.ready;

            // The boot read names the catalog — never a whole-area get(null)
            const bootKeys = sb.localGetCalls[0];
            expect(Array.isArray(bootKeys)).toBe(true);
            expect(bootKeys).toEqual(expect.arrayContaining([
                'zoom', 'visitStats', 'deadMarks', 'dupesLastResult', '__migrated_v1'
            ]));
            expect(bootKeys.some(k => k.startsWith('vbmFavicon'))).toBe(false);
            expect(bootKeys).not.toContain('deadLastScan');
            expect(bootKeys).not.toContain('vbmDeadScan');

            // The mirror serves known + data keys...
            expect(sb.window.store.get('zoom')).toBe('120');
            expect(sb.window.store.get('visitStats')).toBe('{"1":{"c":2,"t":3}}');
            expect(sb.window.store.get('deadMarks')).toBe('["5"]');
            // ...but not the heavy blobs
            expect(sb.window.store.get('vbmFaviconIdx')).toBeUndefined();
            expect(sb.window.store.get('deadLastScan')).toBeUndefined();
            // and the stored blobs themselves are left untouched
            expect(sb.localData['vbmFavicon:example.com']).toBe('data:image/png;base64,AAAA');
            expect(sb.localData.deadLastScan).toBe('{"ts":1}');
        });

        it('still runs the v1 migration alongside the enumerated fetch', async () => {
            const sb = createSandbox({
                localStorageData: { popupHeight: '400' },
                chromeLocalData: { 'vbmFavicon:example.com': 'data:image/png;base64,AAAA' }
            });
            await sb.window.store.ready;

            expect(sb.localData.__migrated_v1).toBe('1');
            expect(sb.localData.popupHeight).toBe('400');
            expect(sb.window.store.get('popupHeight')).toBe('400');
            // the favicon key was neither requested nor mirrored nor touched
            expect(sb.window.store.get('vbmFavicon:example.com')).toBeUndefined();
            expect(sb.localData['vbmFavicon:example.com']).toBe('data:image/png;base64,AAAA');
        });
    });

    describe('set debounce', () => {
        it('persists only the last value of a key within the 200ms window', async () => {
            const sb = createSandbox({ chromeLocalData: { __migrated_v1: '1' } });
            await sb.window.store.ready;

            vi.useFakeTimers();
            sb.window.store.set('zoom', '110');
            sb.window.store.set('zoom', '120');
            sb.window.store.set('zoom', '130');
            expect(sb.localSetCalls).toHaveLength(0);
            // mirror is written synchronously
            expect(sb.window.store.get('zoom')).toBe('130');

            vi.advanceTimersByTime(250);
            expect(sb.localSetCalls).toHaveLength(1);
            expect(sb.localSetCalls[0]).toEqual({ zoom: '130' });
            expect(sb.localData.zoom).toBe('130');
        });

        it('debounces keys independently', async () => {
            const sb = createSandbox({ chromeLocalData: { __migrated_v1: '1' } });
            await sb.window.store.ready;

            vi.useFakeTimers();
            sb.window.store.set('scrollTop', 10);
            vi.advanceTimersByTime(150);
            sb.window.store.set('scrollTop', 20);
            sb.window.store.set('popupWidth', 480);
            vi.advanceTimersByTime(250);

            const widths = sb.localSetCalls.filter(c => 'popupWidth' in c);
            const scrolls = sb.localSetCalls.filter(c => 'scrollTop' in c);
            expect(widths).toHaveLength(1);
            expect(scrolls).toHaveLength(1);
            expect(sb.localData.scrollTop).toBe(20);
            expect(sb.localData.popupWidth).toBe(480);
        });
    });

    describe('scrollTop localStorage shadow (issue #63)', () => {
        it('writes the shadow synchronously on set — before any debounce fires', async () => {
            const sb = createSandbox({ chromeLocalData: { __migrated_v1: '1' } });
            await sb.window.store.ready;

            vi.useFakeTimers();
            sb.window.store.set('scrollTop', 314);
            // the debounced chrome.storage write has not run…
            expect(sb.localSetCalls).toHaveLength(0);
            // …but the shadow already holds the value (a popup dying right
            // here must not lose the position)
            expect(sb.lsData.get('__scrollTopLS')).toBe('314');
            vi.advanceTimersByTime(250);
            expect(sb.localData.scrollTop).toBe(314);
        });

        it('clears the shadow on remove', async () => {
            const sb = createSandbox({ chromeLocalData: { __migrated_v1: '1' } });
            await sb.window.store.ready;

            sb.window.store.set('scrollTop', 5);
            expect(sb.lsData.get('__scrollTopLS')).toBe('5');
            sb.window.store.remove('scrollTop');
            expect(sb.lsData.has('__scrollTopLS')).toBe(false);
        });

        it('lets the shadow win over chrome.storage at init and reconciles the drift', async () => {
            // fake timers FIRST: the reconciliation timer is created during
            // init() itself
            vi.useFakeTimers();
            // previous session: shadow written at close, debounced write lost
            const sb = createSandbox({
                localStorageData: { __scrollTopLS: '2500' },
                chromeLocalData: { scrollTop: 1800, __migrated_v1: '1' }
            });
            await sb.window.store.ready;

            expect(sb.window.store.get('scrollTop')).toBe(2500);
            // the stale chrome.storage copy is scheduled for reconciliation
            vi.advanceTimersByTime(250);
            expect(sb.localData.scrollTop).toBe(2500);
        });

        it('keeps the chrome.storage value when no shadow exists (first run after update)', async () => {
            // the LEGACY plain-'scrollTop' localStorage copy must never win
            const sb = createSandbox({
                localStorageData: { scrollTop: '99' },
                chromeLocalData: { scrollTop: 1800, __migrated_v1: '1' }
            });
            await sb.window.store.ready;
            expect(sb.window.store.get('scrollTop')).toBe(1800);
        });

        it('refreshes the shadow when another context writes scrollTop (adopt)', async () => {
            const sb = createSandbox({ chromeLocalData: { __migrated_v1: '1' } });
            await sb.window.store.ready;

            sb.window.store.set('scrollTop', 120);
            sb.window.store.adopt('scrollTop', 240);
            expect(sb.lsData.get('__scrollTopLS')).toBe('240');
        });
    });

    describe('remove', () => {
        it('removes from both mirror and chrome.storage.local', async () => {
            const sb = createSandbox({
                chromeLocalData: { focusID: '7', __migrated_v1: '1' }
            });
            await sb.window.store.ready;
            expect(sb.window.store.get('focusID')).toBe('7');

            sb.window.store.remove('focusID');
            expect(sb.window.store.get('focusID')).toBeUndefined();
            await Promise.resolve();
            expect('focusID' in sb.localData).toBe(false);
        });
    });

    describe('clearAll', () => {
        it('wipes mirror, chrome.storage.local, chrome.storage.sync and localStorage', async () => {
            const sb = createSandbox({
                localStorageData: { popupHeight: '400' },
                chromeLocalData: { zoom: '120', __migrated_v1: '1' },
                chromeSyncData: { showSyncStatus: 'false' }
            });
            await sb.window.store.ready;

            await sb.window.store.clearAll();
            expect(Object.keys(sb.localData)).toHaveLength(0);
            expect(Object.keys(sb.syncData)).toHaveLength(0);
            expect(sb.lsData.size).toBe(0);
            expect(sb.window.store.get('zoom')).toBeUndefined();
        });
    });

    describe('back-compat helpers', () => {
        it('getSetting/setSetting route sync keys to the sync area, local keys to local', async () => {
            const sb = createSandbox();
            await sb.window.store.ready;

            // A SYNC_KEYS member (2026-08 audit routing) lands in
            // chrome.storage.sync without the caller naming an area…
            await sb.window.setSetting('theme', 'dark');
            expect(sb.syncData.theme).toBe('dark');
            expect(sb.localData.theme).toBeUndefined();
            expect(await sb.window.getSetting('theme', 'auto')).toBe('dark');
            // …and refreshes the sync mirror + the localStorage boot copy
            expect(sb.window.store.get('theme')).toBe('dark');
            expect(sb.lsData.get('theme')).toBe('dark');
            // removeSetting drops the sync value, the mirror and the boot copy
            await sb.window.removeSetting('theme');
            expect(sb.syncData.theme).toBeUndefined();
            expect(sb.window.store.get('theme')).toBeUndefined();
            expect(sb.localStorage.getItem('theme')).toBeNull();

            // A local key stays in chrome.storage.local
            await sb.window.setSetting('zoom', '110');
            expect(sb.localData.zoom).toBe('110');
            expect(sb.syncData.zoom).toBeUndefined();
            expect(await sb.window.getSetting('zoom', 100)).toBe('110');

            // The useSync flag still forces the sync area for back-compat
            await sb.window.setSetting('showSyncStatus', 'false', true);
            expect(sb.syncData.showSyncStatus).toBe('false');
            expect(await sb.window.getSetting('showSyncStatus', 'true', true)).toBe('false');
            // defaults come back for missing keys
            expect(await sb.window.getSetting('missing', 'dflt')).toBe('dflt');
        });
    });

    describe('sync mirror', () => {
        it('exposes the sync-area key list for the options-page settings backup', async () => {
            const sb = createSandbox();
            await sb.window.store.ready;
            expect(sb.window.store.syncKeys).toEqual([
                'showSyncStatus', 'highlightUnsynced', 'autoRefreshSync', 'syncRefreshInterval',
                'paletteCustomCommands', // v4 task-4 #6: the palette's custom commands sync
                // 2026-08 storage audit: every small device-independent
                // preference lives in the sync area (transparent routing).
                'theme', 'uiLanguage',
                'leftClickNewTab', 'middleClickBgTab', 'closeUnusedFolders', 'bookmarkClickStayOpen',
                'dontConfirmOpenFolder', 'confirmDeleteFolder', 'dontRememberState',
                'onlyShowBMBar', 'searchAfterEnter', 'announceEnabled',
                'showViewTabs', 'rememberView', 'showTabBadges', 'showItemPath',
                'showRecentBookmarks', 'showStatsView', 'showDeadView', 'showDupesView', 'showTabGroupsView',
                'disableRecentView', 'disableStatsView', 'disableDeadView', 'disableDupesView',
                'disableTabGroupsView',
                'paletteEnabled', 'quickAddEnabled', 'showToolButton', 'quickAddContextMenu',
                'collapseTabGroupMenu', 'collapseSortMenu', 'collapseAddFolderMenu', 'statsEnabled', 'searchHistoryEnabled',
                'faviconContrast', 'faviconEnrich', 'faviconEnrichAgg', 'faviconBackupInclude',
                'recentCount', 'sortOptions', 'searchHistoryCount',
                'dupesStrategy', 'dupesScope', 'dupesIgnoreScheme',
                'deadSort', 'deadFilter', 'deadMarkFilter',
                'statsSort', 'statsShowUnbookmarked',
                // 4.1.0 tab-groups view prefs
                'tabGroupsSyncCollapse', 'tabGroupsColorStyle', 'tabGroupsColorBorder', 'tabGroupsClosedLimit',
                // staging master switch + tree-row hover actions
                'stagingEnabled', 'treeRowActions'
            ]);
        });

        it('getSyncSetting reads the sync area with defaults', async () => {
            const sb = createSandbox({
                chromeSyncData: { showSyncStatus: 'false' }
            });
            await sb.window.store.ready;
            expect(sb.window.store.getSyncSetting('showSyncStatus', 'true')).toBe('false');
            expect(sb.window.store.getSyncSetting('highlightUnsynced', 'true')).toBe('true');
        });

        it('migrates legacy localStorage showSyncStatus into the sync area once', async () => {
            const sb = createSandbox({
                localStorageData: { showSyncStatus: 'false' }
            });
            await sb.window.store.ready;
            expect(sb.syncData.showSyncStatus).toBe('false');
            expect(sb.window.store.getSyncSetting('showSyncStatus', 'true')).toBe('false');
        });

        it('never resurrects a removed sync key from a stale localStorage boot copy', async () => {
            // rememberView was turned off (sync ''), then the key was REMOVED
            // from the sync area (another device, or an external write). The
            // localStorage boot copy still holds the old value — it must be
            // treated as stale and dropped, not migrated back up (2026-08
            // smoke-gate regression: the copy kept resurrecting the removed
            // key, so rememberView stayed off forever).
            const sb = createSandbox({
                localStorageData: { rememberView: '' },
                chromeLocalData: { __migrated_v1: '1' }
            });
            await sb.window.store.ready;
            expect('rememberView' in sb.syncData).toBe(false);
            expect(sb.window.store.get('rememberView', '1')).toBe('1');
            expect(sb.lsData.has('rememberView')).toBe(false);
        });

        it('sync area wins over localStorage for showSyncStatus', async () => {
            const sb = createSandbox({
                localStorageData: { showSyncStatus: 'false' },
                chromeSyncData: { showSyncStatus: 'true' }
            });
            await sb.window.store.ready;
            expect(sb.syncData.showSyncStatus).toBe('true');
            expect(sb.window.store.getSyncSetting('showSyncStatus', 'true')).toBe('true');
        });

        it('setSyncSetting writes the mirror immediately and persists after 500ms', async () => {
            const sb = createSandbox();
            await sb.window.store.ready;

            vi.useFakeTimers();
            sb.window.store.setSyncSetting('showSyncStatus', 'false');
            sb.window.store.setSyncSetting('showSyncStatus', 'true');
            expect(sb.window.store.getSyncSetting('showSyncStatus')).toBe('true');
            expect(sb.syncSetCalls).toHaveLength(0);
            // boot copy refreshed, same convention as store.set on a sync key
            expect(sb.lsData.get('showSyncStatus')).toBe('true');

            vi.advanceTimersByTime(400);
            expect(sb.syncSetCalls).toHaveLength(0);
            vi.advanceTimersByTime(150);
            expect(sb.syncSetCalls).toHaveLength(1);
            expect(sb.syncSetCalls[0]).toEqual({ showSyncStatus: 'true' });
            expect(sb.syncData.showSyncStatus).toBe('true');
        });

        it('clearAll also wipes the sync mirror', async () => {
            const sb = createSandbox({
                chromeSyncData: { showSyncStatus: 'false' }
            });
            await sb.window.store.ready;
            await sb.window.store.clearAll();
            expect(sb.window.store.getSyncSetting('showSyncStatus')).toBeUndefined();
        });
    });

    describe('separatorUrl key merge (v2)', () => {
        it('renames legacy chrome.storage separatorUrl to separatorURL and drops the stale key', async () => {
            const sb = createSandbox({
                chromeLocalData: { separatorUrl: 'http://legacy.test/', __migrated_v1: '1' }
            });
            await sb.window.store.ready;

            expect(sb.window.store.get('separatorURL')).toBe('http://legacy.test/');
            expect(sb.window.store.get('separatorUrl')).toBeUndefined();
            expect(sb.localData.separatorURL).toBe('http://legacy.test/');
            expect('separatorUrl' in sb.localData).toBe(false);
        });

        it('canonical separatorURL wins when both spellings exist', async () => {
            const sb = createSandbox({
                chromeLocalData: {
                    separatorURL: 'http://canonical.test/',
                    separatorUrl: 'http://legacy.test/',
                    __migrated_v1: '1'
                }
            });
            await sb.window.store.ready;

            expect(sb.window.store.get('separatorURL')).toBe('http://canonical.test/');
            expect(sb.localData.separatorURL).toBe('http://canonical.test/');
            expect('separatorUrl' in sb.localData).toBe(false);
        });

        it('merges a localStorage-only legacy value and removes it there too', async () => {
            const sb = createSandbox({
                localStorageData: { separatorUrl: 'http://ls.test/' }
            });
            await sb.window.store.ready;

            expect(sb.window.store.get('separatorURL')).toBe('http://ls.test/');
            expect(sb.localData.separatorURL).toBe('http://ls.test/');
            expect(sb.lsData.has('separatorUrl')).toBe(false);
        });

        it('is idempotent: a second init against the merged profile writes nothing', async () => {
            const first = createSandbox({
                chromeLocalData: { separatorUrl: 'http://legacy.test/', __migrated_v1: '1' }
            });
            await first.window.store.ready;
            expect(first.localSetCalls.some(c => 'separatorURL' in c)).toBe(true);

            const second = createSandbox({ chromeLocalData: first.localData });
            await second.window.store.ready;
            expect(second.localSetCalls).toHaveLength(0);
            expect(second.window.store.get('separatorURL')).toBe('http://legacy.test/');
        });
    });

    describe('deadProxyTemplate cleanup (v4 proxy retirement)', () => {
        it('drops the retired v3 relay key from chrome.storage on startup', async () => {
            const sb = createSandbox({
                chromeLocalData: {
                    deadProxyTemplate: 'https://relay.example/?u=%s',
                    deadProxyServer: 'http://127.0.0.1:7890',
                    __migrated_v1: '1'
                }
            });
            await sb.window.store.ready;

            expect(sb.window.store.get('deadProxyTemplate')).toBeUndefined();
            expect('deadProxyTemplate' in sb.localData).toBe(false);
            // the replacement setting is untouched
            expect(sb.window.store.get('deadProxyServer')).toBe('http://127.0.0.1:7890');
        });

        it('is idempotent: a second init against the cleaned profile removes nothing more', async () => {
            const first = createSandbox({
                chromeLocalData: { deadProxyTemplate: 'https://relay.example/?u=%s', __migrated_v1: '1' }
            });
            await first.window.store.ready;
            expect('deadProxyTemplate' in first.localData).toBe(false);

            const second = createSandbox({ chromeLocalData: first.localData });
            await second.window.store.ready;
            expect('deadProxyTemplate' in second.localData).toBe(false);
            expect(second.window.store.get('deadProxyTemplate')).toBeUndefined();
        });
    });
});
