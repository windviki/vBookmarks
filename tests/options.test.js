import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';

// options.js is a classic script riding on page globals (store/getSetting/
// setSetting from store.js, chrome.*, document). The sandbox evaluates the
// REAL store.js first (so store.syncKeys and the back-compat helpers are the
// production wiring) and then the REAL options.js against a stub DOM —
// nothing is copied from the sources under test.
const storeSource = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const sortUtilsSource = fs.readFileSync(new URL('../src/sort-utils.js', import.meta.url), 'utf8');
const optionsSource = fs.readFileSync(new URL('../src/options.js', import.meta.url), 'utf8');
const optionsHtml = fs.readFileSync(new URL('../pages/options.html', import.meta.url), 'utf8');

const createSandbox = ({
    chromeLocalData = {},
    chromeSyncData = {},
    windowExtras = {}
} = {}) => {
    // chrome.storage areas, backed by plain objects (same shape as store.test.js)
    const localData = chromeLocalData;
    const syncData = chromeSyncData;
    const makeArea = data => ({
        get: async keys => {
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
        set: async obj => Object.assign(data, obj),
        remove: async keys => {
            for (const k of [].concat(keys)) delete data[k];
        },
        clear: async () => {
            for (const k in data) delete data[k];
        }
    });

    const onChangedListeners = [];
    const chrome = {
        // no locale messages loaded: getMessage echoes the key so label and
        // alert assertions target the i18n contract
        i18n: { getMessage: key => key },
        storage: {
            local: makeArea(localData),
            sync: makeArea(syncData),
            onChanged: { addListener: fn => onChangedListeners.push(fn) }
        },
        runtime: {
            sendMessage: () => {},
            getManifest: () => ({ version: '4.0.1' })
        }
    };

    const lsData = new Map();
    const localStorage = {
        getItem: k => (lsData.has(k) ? lsData.get(k) : null),
        setItem: (k, v) => lsData.set(k, String(v)),
        removeItem: k => lsData.delete(k),
        clear: () => lsData.clear()
    };

    // Element stubs are auto-created per id so initOptions' long label list
    // needs no enumeration; listeners are recorded and fired manually.
    const elements = {};
    const created = [];
    const makeEl = (id = '', tagName = '') => ({
        id,
        tagName,
        value: '',
        checked: false,
        innerText: '',
        innerHTML: '',
        textContent: '',
        files: [],
        clicked: 0,
        style: {},
        _attributes: {},
        // the custom-icon <img> preview lives inside the preview div; the
        // stub lets options.js's custom-icon block run (registering the
        // pick/file listeners) instead of being skipped by the null guard
        firstElementChild: { onload: null, src: '' },
        setAttribute(name, val) { this._attributes[name] = val; },
        _listeners: {},
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        },
        click() {
            this.clicked += 1;
        },
        async fire(type) {
            for (const fn of this._listeners[type] || []) await fn();
        }
    });
    const document = {
        title: '',
        body: { dataset: {} },
        activeElement: null,
        _listeners: {},
        getElementById: id => elements[id] || (elements[id] = makeEl(id)),
        createElement: tag => {
            const el = makeEl('', tag);
            if (tag === 'canvas') el.getContext = () => ({}); // 2d ctx only used inside the onload path
            created.push(el);
            return el;
        },
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        }
    };

    const window = { document, chrome, addEventListener: () => {}, ...windowExtras };

    // 1. real store.js → window.store / window.getSetting / ...
    new Function('window', 'chrome', 'localStorage', 'document', storeSource)(
        window, chrome, localStorage, document
    );

    // 1b. real sort-utils.js → window.VBMSort (options.html loads it as a
    // classic script before options.js, same recipe as dialogs.test.js)
    new Function('window', sortUtilsSource)(window);

    // 2. real options.js with the remaining page globals stubbed
    const location = { reload: vi.fn() };
    const alerts = [];
    const confirms = [];
    let confirmResult = true;
    const objectURLs = [];
    const URLStub = {
        createObjectURL: vi.fn(blob => {
            objectURLs.push(blob);
            return `blob:mock-${objectURLs.length}`;
        }),
        revokeObjectURL: vi.fn()
    };
    new Function(
        'window', 'document', 'chrome', 'localStorage', 'location',
        'store', 'getSetting', 'setSetting', 'removeSetting',
        'alert', 'confirm', 'URL',
        optionsSource
    )(
        window, document, chrome, localStorage, location,
        window.store, window.getSetting, window.setSetting, window.removeSetting,
        msg => alerts.push(msg), msg => { confirms.push(msg); return confirmResult; }, URLStub
    );

    // fire DOMContentLoaded and let initOptions' awaited storage reads settle
    const start = async () => {
        await window.store.ready;
        for (const fn of document._listeners.DOMContentLoaded || []) fn();
        for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0));
    };

    return {
        window, chrome, document, elements, created, localData, syncData,
        location, alerts, confirms, URLStub, objectURLs, start,
        onChangedListeners,
        setConfirm: v => { confirmResult = v; }
    };
};

const pickFile = async (sb, contents) => {
    const input = sb.elements['import-settings-file'];
    input.files = [{ text: async () => contents }];
    await input.fire('change');
};

const validBackup = (overrides = {}) => JSON.stringify({
    app: 'vBookmarks',
    version: '4.0',
    exportedAt: '2026-07-28T12:00:00.000Z',
    local: { theme: 'dark' },
    sync: { showSyncStatus: 'false' },
    ...overrides
});

describe('options.js settings backup', () => {
    describe('page markup', () => {
        it('options.html carries the backup group after Accessibility, and the old footer is gone (header links + version moved up)', () => {
            for (const id of ['backup-options', 'export-settings', 'import-settings', 'import-settings-file', 'backup-hint'])
                expect(optionsHtml).toContain(`id="${id}"`);
            expect(optionsHtml).toMatch(/<input type="file" id="import-settings-file"[^>]*hidden/);
            expect(optionsHtml.indexOf('id="accessibility"')).toBeLessThan(optionsHtml.indexOf('id="backup-options"'));
            // 4.0.8: the bottom footer was replaced by header meta — donate /
            // GitHub / homepage buttons + the version (linking to the changelog)
            // live top-right next to the title; the since-subtitle docks IN the
            // title row, between the title block and the pills (before donate).
            expect(optionsHtml).not.toContain('id="footer"');
            expect(optionsHtml).not.toContain('Thanks');
            for (const id of ['header-donate', 'header-github', 'header-homepage',
                'options-version', 'header-donate-label', 'header-github-label',
                'header-homepage-label', 'options-version-text', 'header-since'])
                expect(optionsHtml).toContain(`id="${id}"`);
            expect(optionsHtml.indexOf('id="header-links"')).toBeGreaterThan(optionsHtml.indexOf('id="ext-name"'));
            expect(optionsHtml.indexOf('id="header-since"')).toBeGreaterThan(optionsHtml.indexOf('id="ext-name"'));
            expect(optionsHtml.indexOf('id="header-since"')).toBeLessThan(optionsHtml.indexOf('id="header-links"'));
            expect(optionsHtml.indexOf('id="header-links"')).toBeLessThan(optionsHtml.indexOf('</h1>'));
            // Static hrefs: donate → donation page, version → changelog.
            expect(optionsHtml).toContain('id="header-donate" href="https://github.com/windviki/vBookmarks/blob/master/donation/donation.md"');
            expect(optionsHtml).toContain('id="options-version" href="https://github.com/windviki/vBookmarks#v408"');
            // The storage-usage bar lives in the Icons group, next to the
            // clear-icon-cache button (before the group's closing </ul>).
            expect(optionsHtml.indexOf('id="favicon-cache-clear"')).toBeLessThan(optionsHtml.indexOf('id="storage-usage"'));
            expect(optionsHtml.indexOf('id="storage-usage"')).toBeLessThan(optionsHtml.indexOf('</ul>', optionsHtml.indexOf('id="icons-options"')));
            // 4.0.9 storage-usage block: summary line above the bar, every
            // segment keyboard-focusable (tabindex="0" so the tooltip value is
            // reachable without a pointer), and destructive actions marked
            // with .danger (same secondary shape, danger border + text).
            expect(optionsHtml).toContain('id="storage-usage-summary"');
            for (const cls of ['usage-icon', 'usage-bookmarks', 'usage-other', 'usage-free'])
                expect(optionsHtml).toContain(`class="usage-seg ${cls}" data-usage="${cls.replace('usage-', '')}" tabindex="0"`);
            for (const id of ['favicon-cache-clear', 'stats-clear', 'import-settings', 'reset-button'])
                expect(optionsHtml).toMatch(new RegExp(`id="${id}"[^>]*class="danger"`));
            // the export button stays a plain secondary action.
            expect(optionsHtml).toMatch(/id="export-settings"[^>]*type="button"(?![^>]*class)/);
        });
    });

    describe('init wiring', () => {
        it('binds both buttons + the file input and assigns the group labels', async () => {
            const sb = createSandbox();
            await sb.start();

            expect(sb.elements['export-settings']._listeners.click).toHaveLength(1);
            expect(sb.elements['import-settings']._listeners.click).toHaveLength(1);
            expect(sb.elements['import-settings-file']._listeners.change).toHaveLength(1);
            expect(sb.elements['backup-options'].innerText).toBe('optionsGroupBackup');
            expect(sb.elements['export-settings'].innerText).toBe('settingsExport');
            expect(sb.elements['import-settings'].innerText).toBe('settingsImport');
            expect(sb.elements['backup-hint'].innerText).toBe('settingsBackupHint');
            // issue #49: the quick-add page context-menu toggle gets its label + hint
            expect(sb.elements['option-quick-add-context-menu'].innerText).toBe('optionQuickAddContextMenu');
            expect(sb.elements['option-quick-add-context-menu-hint'].innerText).toBe('optionQuickAddContextMenuHint');
        });

        it('the import button forwards to the hidden file input', async () => {
            const sb = createSandbox();
            await sb.start();
            await sb.elements['import-settings'].fire('click');
            expect(sb.elements['import-settings-file'].clicked).toBe(1);
        });
    });

    describe('export', () => {
        it('downloads one JSON file with app/version stamp, full local area and only the sync keys', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'dark', zoom: 110 },
                chromeSyncData: {
                    showSyncStatus: 'false',
                    highlightUnsynced: 'true',
                    autoRefreshSync: 'true',
                    syncRefreshInterval: 60,
                    unrelatedKey: 'must-not-leak'
                }
            });
            await sb.start();
            await sb.elements['export-settings'].fire('click');

            expect(sb.URLStub.createObjectURL).toHaveBeenCalledTimes(1);
            const blob = sb.objectURLs[0];
            const backup = JSON.parse(await blob.text());
            expect(backup.app).toBe('vBookmarks');
            expect(backup.version).toBe('4.0.1');
            expect(typeof backup.exportedAt).toBe('string');
            expect(backup.local).toEqual({ __migrated_v1: '1', theme: 'dark', zoom: 110 });
            // sync payload is restricted to store.syncKeys
            expect(backup.sync).toEqual({
                showSyncStatus: 'false',
                highlightUnsynced: 'true',
                autoRefreshSync: 'true',
                syncRefreshInterval: 60
            });

            const anchor = sb.created.find(el => el.tagName === 'a');
            expect(anchor.download).toMatch(/^vbookmarks-settings-\d{4}-\d{2}-\d{2}\.json$/);
            expect(anchor.href).toBe('blob:mock-1');
            expect(anchor.clicked).toBe(1);
            expect(sb.URLStub.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
        });

        it('ships the favicon cache keys by default, and strips them when the backup switch is off', async () => {
            const favKey = 'vbmFavicon:github.com';
            const favIdx = JSON.stringify({ v: 3, down: {}, hosts: { 'github.com': { t: 1, s: 2 } } });
            const seeded = {
                __migrated_v1: '1', theme: 'dark',
                [favKey]: 'data:image/png;base64,AAAA',
                vbmFaviconIdx: favIdx
            };
            // Default (switch on): the cache rides along for full-fidelity backup.
            let sb = createSandbox({ chromeLocalData: { ...seeded } });
            await sb.start();
            await sb.elements['export-settings'].fire('click');
            expect(JSON.parse(await sb.objectURLs[0].text()).local)
                .toEqual({ __migrated_v1: '1', theme: 'dark', [favKey]: seeded[favKey], vbmFaviconIdx: favIdx });
            // Switch off: favicon keys stripped from the export to keep it small.
            sb = createSandbox({ chromeLocalData: { ...seeded } });
            await sb.start();
            sb.elements['favicon-backup'].checked = false;
            await sb.elements['export-settings'].fire('click');
            expect(JSON.parse(await sb.objectURLs[0].text()).local)
                .toEqual({ __migrated_v1: '1', theme: 'dark' });
        });
    });

    describe('import validation', () => {
        it('rejects unparseable JSON without touching storage', async () => {
            const sb = createSandbox({ chromeLocalData: { __migrated_v1: '1', theme: 'light' } });
            await sb.start();
            await pickFile(sb, '{not json');
            expect(sb.alerts).toEqual(['settingsImportInvalid']);
            expect(sb.confirms).toHaveLength(0);
            expect(sb.localData).toEqual({ __migrated_v1: '1', theme: 'light' });
            expect(sb.location.reload).not.toHaveBeenCalled();
        });

        it.each([
            ['wrong app marker', validBackup({ app: 'other' })],
            ['missing local object', JSON.stringify({ app: 'vBookmarks' })],
            ['local not a plain object', validBackup({ local: ['theme'] })],
            ['sync not a plain object', validBackup({ sync: 'nope' })]
        ])('rejects %s', async (name, contents) => {
            const sb = createSandbox({ chromeLocalData: { __migrated_v1: '1' } });
            await sb.start();
            await pickFile(sb, contents);
            expect(sb.alerts).toEqual(['settingsImportInvalid']);
            expect(sb.localData).toEqual({ __migrated_v1: '1' });
            expect(sb.location.reload).not.toHaveBeenCalled();
        });

        it('does nothing when the picker is cancelled', async () => {
            const sb = createSandbox();
            await sb.start();
            const input = sb.elements['import-settings-file'];
            input.files = [];
            await input.fire('change');
            expect(sb.alerts).toHaveLength(0);
            expect(sb.confirms).toHaveLength(0);
        });
    });

    describe('import write semantics', () => {
        it('a cancelled confirmation leaves both storage areas untouched', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light' },
                chromeSyncData: { showSyncStatus: 'true' }
            });
            await sb.start();
            sb.setConfirm(false);
            await pickFile(sb, validBackup());
            expect(sb.confirms).toEqual(['settingsImportConfirm']);
            expect(sb.localData.theme).toBe('light');
            expect(sb.syncData.showSyncStatus).toBe('true');
            expect(sb.alerts).toHaveLength(0);
            expect(sb.location.reload).not.toHaveBeenCalled();
        });

        it('merges the backup over current settings, keeps unmentioned keys, then reloads', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light', keepMe: 'x' },
                chromeSyncData: { showSyncStatus: 'true', highlightUnsynced: 'true' }
            });
            await sb.start();
            await pickFile(sb, validBackup({ local: { theme: 'dark', newKey: '1' } }));

            expect(sb.confirms).toEqual(['settingsImportConfirm']);
            // overwritten + added + preserved — no wipe
            expect(sb.localData).toEqual({ __migrated_v1: '1', theme: 'dark', keepMe: 'x', newKey: '1' });
            // sync area: backup key overwritten, unmentioned key kept
            expect(sb.syncData.showSyncStatus).toBe('false');
            expect(sb.syncData.highlightUnsynced).toBe('true');
            expect(sb.alerts).toEqual(['settingsImportDone']);
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
            // the file input is reset so the same file can be picked again
            expect(sb.elements['import-settings-file'].value).toBe('');
        });

        it('accepts a backup without a sync section', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1' },
                chromeSyncData: { showSyncStatus: 'true' }
            });
            await sb.start();
            await pickFile(sb, JSON.stringify({ app: 'vBookmarks', local: { theme: 'ink' } }));
            expect(sb.localData.theme).toBe('ink');
            expect(sb.syncData.showSyncStatus).toBe('true');
            expect(sb.alerts).toEqual(['settingsImportDone']);
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
        });

        it('skips favicon cache keys on import while the switch is off', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light' },
                chromeSyncData: {}
            });
            await sb.start();
            sb.elements['favicon-backup'].checked = false;
            const favIdx = JSON.stringify({ v: 3, down: {}, hosts: { 'github.com': { t: 1, s: 2 } } });
            await pickFile(sb, validBackup({ local: {
                theme: 'dark',
                'vbmFavicon:github.com': 'data:image/png;base64,AAAA',
                vbmFaviconIdx: favIdx
            } }));
            expect(sb.localData.theme).toBe('dark');
            expect(sb.localData['vbmFavicon:github.com']).toBeUndefined();
            expect(sb.localData.vbmFaviconIdx).toBeUndefined();
            expect(sb.alerts).toEqual(['settingsImportDone']);
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
        });

        it('restores favicon cache keys on import by default (switch on)', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light' },
                chromeSyncData: {}
            });
            await sb.start();
            sb.elements['favicon-backup'].checked = true;
            const favIdx = JSON.stringify({ v: 3, down: {}, hosts: { 'github.com': { t: 1, s: 2 } } });
            await pickFile(sb, validBackup({ local: {
                theme: 'dark',
                'vbmFavicon:github.com': 'data:image/png;base64,AAAA',
                vbmFaviconIdx: favIdx
            } }));
            expect(sb.localData.theme).toBe('dark');
            expect(sb.localData['vbmFavicon:github.com']).toBe('data:image/png;base64,AAAA');
            expect(sb.localData.vbmFaviconIdx).toBe(favIdx);
            expect(sb.alerts).toEqual(['settingsImportDone']);
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
        });

        it('a quota overflow restoring the favicon cache never fails the settings import', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light' },
                chromeSyncData: {}
            });
            await sb.start();
            sb.elements['favicon-backup'].checked = true;
            const orig = sb.chrome.storage.local.set;
            sb.chrome.storage.local.set = async obj => {
                if (obj && 'vbmFaviconIdx' in obj) throw new Error('QUOTA_BYTES exceeded');
                return orig(obj);
            };
            await pickFile(sb, validBackup({ local: {
                theme: 'dark',
                'vbmFavicon:github.com': 'data:image/png;base64,AAAA',
                vbmFaviconIdx: '{}'
            } }));
            expect(sb.localData.theme).toBe('dark');
            expect(sb.localData['vbmFavicon:github.com']).toBeUndefined();
            expect(sb.alerts).toEqual(['settingsImportDone']);
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
        });

        it('a failed local settings write alerts and never reloads into half-applied state', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light' },
                chromeSyncData: { showSyncStatus: 'true' }
            });
            await sb.start();
            sb.chrome.storage.local.set = async () => { throw new Error('QUOTA_BYTES exceeded'); };
            await pickFile(sb, validBackup({ local: { theme: 'dark' } }));
            expect(sb.alerts).toEqual(['settingsImportError']);
            expect(sb.localData.theme).toBe('light'); // untouched
            expect(sb.syncData.showSyncStatus).toBe('true'); // sync write never attempted
            expect(sb.location.reload).not.toHaveBeenCalled();
        });

        it('a failed sync settings write alerts and skips the favicon restore', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light' },
                chromeSyncData: {}
            });
            await sb.start();
            sb.elements['favicon-backup'].checked = true;
            sb.chrome.storage.sync.set = async () => { throw new Error('QUOTA_BYTES exceeded'); };
            await pickFile(sb, validBackup({
                local: { theme: 'dark', 'vbmFavicon:github.com': 'data:image/png;base64,AAAA' },
                sync: { showSyncStatus: 'false' }
            }));
            expect(sb.alerts).toEqual(['settingsImportError']);
            expect(sb.localData['vbmFavicon:github.com']).toBeUndefined(); // restore skipped
            expect(sb.location.reload).not.toHaveBeenCalled();
        });

        it('sanitizes imported favicon entries: keeps data:image payloads, drops the rest', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light' },
                chromeSyncData: {}
            });
            await sb.start();
            sb.elements['favicon-backup'].checked = true;
            const favIdx = JSON.stringify({ v: 3, down: {}, hosts: {} });
            await pickFile(sb, validBackup({ local: {
                theme: 'dark',
                'vbmFavicon:good.com': 'data:image/png;base64,AAAA',
                'vbmFavicon:upper.com': 'DATA:IMAGE/PNG;BASE64,BBBB',
                'vbmFavicon:evil.com': 'https://evil.example/x.png',
                'vbmFavicon:huge.com': `data:image/png;base64,${'A'.repeat(97 * 1024)}`,
                'vbmFavicon:notstr.com': 42,
                vbmFaviconIdx: favIdx
            } }));
            expect(sb.localData['vbmFavicon:good.com']).toBe('data:image/png;base64,AAAA');
            expect(sb.localData['vbmFavicon:upper.com']).toBe('DATA:IMAGE/PNG;BASE64,BBBB');
            expect(sb.localData['vbmFavicon:evil.com']).toBeUndefined();
            expect(sb.localData['vbmFavicon:huge.com']).toBeUndefined();
            expect(sb.localData['vbmFavicon:notstr.com']).toBeUndefined();
            expect(sb.localData.vbmFaviconIdx).toBe(favIdx); // index rides along, self-heals
            expect(sb.alerts).toEqual(['settingsImportDone']);
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
        });
    });
});

// Storage-usage bar (v4 Task C): a percentage bar in the Icons group splits
// chrome.storage.local into icon cache / bookmark data / other / free so the
// user can decide when to clear the icon cache. 4.0.8 refactor: each segment
// carries an accessible size label + tooltip data, the legend shows color
// swatches, and the bar re-measures live on storage.onChanged.
describe('storage usage bar', () => {
    const iconBytes = sb => {
        const m = (sb.elements['usage-icon']._attributes['aria-label'] || '').match(/storageUsageIcon (\d+(?:\.\d+)?) (B|KB|MB)/);
        return m ? Number(m[1]) : -1;
    };
    const legendText = sb => sb.elements['storage-usage-legend'].innerHTML;

    it('categorizes stored bytes and renders a swatch legend + per-segment widths', async () => {
        const favIdx = JSON.stringify({ v: 3, down: {}, hosts: { 'github.com': { t: 1, s: 2 } } });
        const sb = createSandbox({
            chromeLocalData: {
                __migrated_v1: '1',                                        // other
                theme: 'dark',                                             // other
                'vbmFavicon:github.com': 'data:image/png;base64,AAAA',      // icon
                vbmFaviconIdx: favIdx,                                     // icon
                deadLastScan: JSON.stringify({ done: 1 }),                 // bookmark data
                visitStats: '{}'                                           // bookmark data
            }
        });
        await sb.start();
        // legend: one swatched item per category, colors mirroring the segments
        const legend = legendText(sb);
        for (const key of ['storageUsageIcon', 'storageUsageBookmarks', 'storageUsageOther', 'storageUsageFree'])
            expect(legend).toContain(key);
        for (const sw of ['usage-icon', 'usage-bookmarks', 'usage-other', 'usage-free'])
            expect(legend).toContain(`legend-swatch ${sw}`);
        // every segment got a percentage width + an accessible label (10MB quota)
        for (const id of ['usage-icon', 'usage-bookmarks', 'usage-other', 'usage-free']) {
            expect(sb.elements[id].style.width).toMatch(/^\d+(?:\.\d+)?%$/);
            expect(sb.elements[id]._attributes['aria-label']).toMatch(/(B|KB|MB)$/);
            expect(sb.elements[id]._attributes['title']).toBe(sb.elements[id]._attributes['aria-label']);
        }
        // the bar's aria-label summarizes all four categories
        const barLabel = sb.elements['storage-usage-bar']._attributes['aria-label'];
        for (const key of ['storageUsageIcon', 'storageUsageBookmarks', 'storageUsageOther', 'storageUsageFree'])
            expect(barLabel).toContain(key);
        // 4.0.9: a summary line answers "used / quota" without hovering, and
        // every legend item also carries its share — never encode data by
        // color alone (chart guidance).
        expect(sb.elements['storage-usage-summary'].textContent).toBe('storageUsageSummary');
        for (const key of ['storageUsageIcon', 'storageUsageBookmarks', 'storageUsageOther', 'storageUsageFree'])
            expect(legend).toMatch(new RegExp(`${key} \\d+(\\.\\d+)? (B|KB|MB) \\(\\d+(\\.\\d+)?%\\)`));
    });

    it('shows a size tooltip while a segment is hovered and hides on leave', async () => {
        const sb = createSandbox({
            chromeLocalData: { 'vbmFavicon:github.com': 'data:image/png;base64,AAAA' }
        });
        await sb.start();
        const seg = sb.elements['usage-icon'];
        await seg.fire('mouseenter');
        expect(sb.elements['usage-tooltip'].innerText).toMatch(/storageUsageIcon \d+ B \(\d+(?:\.\d+)?%\)/);
        expect(sb.elements['usage-tooltip'].hidden).toBe(false);
        await seg.fire('mouseleave');
        expect(sb.elements['usage-tooltip'].hidden).toBe(true);
    });

    it('drops the icons segment after clearing the icon cache', async () => {
        const sb = createSandbox({
            chromeLocalData: {
                'vbmFavicon:github.com': 'data:image/png;base64,AAAA',
                vbmFaviconIdx: JSON.stringify({ v: 3, down: {}, hosts: {} }),
                theme: 'dark'
            }
        });
        await sb.start();
        expect(iconBytes(sb)).toBeGreaterThan(0);
        await sb.elements['favicon-cache-clear'].fire('click');
        for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
        expect(sb.alerts).toEqual(['optionFaviconCacheCleared']);
        expect(sb.localData['vbmFavicon:github.com']).toBeUndefined();
        expect(sb.localData.vbmFaviconIdx).toBeUndefined();
        expect(iconBytes(sb)).toBe(0);
    });

    it('re-measures live when the background writes icon-cache keys', async () => {
        const sb = createSandbox({ chromeLocalData: { theme: 'dark' } });
        await sb.start();
        expect(sb.elements['usage-icon']._attributes['aria-label']).toBe('storageUsageIcon 0 B');
        // the background stores an enriched favicon while the page is open
        await sb.chrome.storage.local.set({ 'vbmFavicon:github.com': 'data:image/png;base64,AAAA' });
        for (const fn of sb.onChangedListeners)
            fn({ 'vbmFavicon:github.com': { newValue: 'data:image/png;base64,AAAA' } }, 'local');
        for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
        expect(sb.elements['usage-icon']._attributes['aria-label']).toMatch(/storageUsageIcon \d+ B/);
        // unrelated local changes (theme via sync never fires local) are ignored
        for (const fn of sb.onChangedListeners) fn({ zoom: { newValue: 110 } }, 'local');
        for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
        expect(sb.elements['usage-icon']._attributes['aria-label']).toMatch(/storageUsageIcon \d+ B/);
    });
});

// Custom icon row (task: hidden file input + styled pick button): the engine
// won't style ::file-selector-button, so options.html hides the native input
// and the pick button is the clickable stand-in that forwards to it.
describe('custom icon row pick button', () => {
    it('the pick button forwards the click to the hidden file input', async () => {
        const sb = createSandbox();
        await sb.start();
        const file = sb.elements['custom-icon-file'];
        file.clicked = 0;
        await sb.elements['custom-icon-pick'].fire('click');
        expect(file.clicked).toBe(1);
    });

    it('the file input is hidden in the markup (native styling can be skipped)', async () => {
        // options-layout.test.js asserts the id + button presence; here the
        // markup contract: the input carries `hidden` so no file-selector
        // styling is ever attempted.
        expect(optionsHtml).toMatch(/<input type="file" id="custom-icon-file" hidden>/);
    });
});

// Options page header meta (v4 Task D + 4.0.8 redesign): the footer "thanks"
// block is gone; the top-right row is donate/GitHub/homepage pill buttons and
// the full version linking to the changelog, with a since-subtitle below.
describe('options page header meta', () => {
    it('fills the header buttons, the version button and the since subtitle', async () => {
        const sb = createSandbox({ chromeLocalData: {} });
        await sb.start();
        // Text lands in the label spans so the inline SVG icons stay leading.
        expect(sb.elements['header-donate-label'].innerText).toBe('optionsDonate');
        expect(sb.elements['header-github-label'].innerText).toBe('optionsGithubLink');
        expect(sb.elements['header-homepage-label'].innerText).toBe('optionsHomepageLink');
        // Version button points at the current version's changelog section
        // (assembled from the manifest version: 4.0.1 → #v401).
        expect(sb.elements['options-version'].href).toBe('https://github.com/windviki/vBookmarks#v401');
        expect(sb.elements['options-version-text'].innerText).toBe('v4.0.1');
        expect(sb.elements['options-version'].title).toBe('optionsVersion');
        // Subtitle: forked-from + days since 1.0 (2011-11-15), i18n key only
        // in the sandbox — substitution args are ignored by the echo stub.
        expect(sb.elements['header-since'].innerText).toBe('optionsSince');
    });
});

// Final polish coverage: the dead-scan tuning inputs clamp to the scanner's
// supported ranges, and the footer reset button wipes every storage area.
describe('options.js dead-scan clamps + reset', () => {
    describe('bindClampedNumber', () => {
        it('clamps stored out-of-range values into the inputs on load', async () => {
            const sb = createSandbox({
                chromeLocalData: { deadScanConcurrency: '99', deadScanTimeout: '1' }
            });
            await sb.start();
            expect(Number(sb.elements['dead-scan-concurrency'].value)).toBe(16);
            expect(Number(sb.elements['dead-scan-timeout'].value)).toBe(2);
        });

        it('falls back to the defaults for non-numeric stored values', async () => {
            const sb = createSandbox({
                chromeLocalData: { deadScanConcurrency: 'lots', deadScanTimeout: 'soon' }
            });
            await sb.start();
            expect(Number(sb.elements['dead-scan-concurrency'].value)).toBe(4);
            expect(Number(sb.elements['dead-scan-timeout'].value)).toBe(8);
        });

        it('clamps on change and persists the clamped string', async () => {
            const sb = createSandbox({});
            await sb.start();
            const concurrency = sb.elements['dead-scan-concurrency'];
            concurrency.value = '0';
            await concurrency.fire('change');
            expect(Number(concurrency.value)).toBe(1);
            expect(sb.window.store.get('deadScanConcurrency')).toBe('1');

            concurrency.value = 'abc'; // NaN → default
            await concurrency.fire('change');
            expect(Number(concurrency.value)).toBe(4);
            expect(sb.window.store.get('deadScanConcurrency')).toBe('4');

            const timeout = sb.elements['dead-scan-timeout'];
            timeout.value = '999';
            await timeout.fire('change');
            expect(Number(timeout.value)).toBe(30);
            expect(sb.window.store.get('deadScanTimeout')).toBe('30');
        });
    });

    // The dead-link proxy server row (display/clear/add) is owned by
    // src/options-proxy.js (a module) since options.js is a classic script —
    // its tests live in tests/options-proxy.test.js.

    describe('reset button', () => {
        it('wipes local + sync storage, alerts and reloads', async () => {
            const sb = createSandbox({
                chromeLocalData: { theme: 'dark', deadScanConcurrency: '7' },
                chromeSyncData: { showSyncStatus: 'true' }
            });
            await sb.start();
            await sb.elements['reset-button'].fire('click');
            for (let i = 0; i < 10; i++)
                await new Promise(r => setTimeout(r, 0));
            expect(sb.localData).toEqual({});
            expect(sb.syncData).toEqual({});
            expect(sb.alerts).toContain('vBookmarks has been reset.');
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
        });
    });
});

describe('classic-experience preset (v4 task-3 #20 + issue #49)', () => {
    it('turns off every v4-only switch including the quick-add page context menu', async () => {
        const sb = createSandbox(); // fresh storage → all default ON
        await sb.start();

        // default: the quick-add context-menu switch starts checked
        expect(sb.elements['quick-add-context-menu'].checked).toBe(true);

        await sb.elements['classic-experience'].fire('click');

        for (const key of ['paletteEnabled', 'quickAddEnabled', 'quickAddContextMenu',
            'showToolButton', 'showViewTabs'])
            expect(sb.localData[key]).toBe('');
        expect(sb.elements['quick-add-context-menu'].checked).toBe(false);
        expect(sb.elements['palette-enabled'].checked).toBe(false);
        expect(sb.elements['show-tool-button'].checked).toBe(false);
    });

    it('the quick-add context-menu switch binds to storage and toggles independently', async () => {
        const sb = createSandbox();
        await sb.start();

        // user unchecks the context-menu entry → key flips to '' (off)
        sb.elements['quick-add-context-menu'].checked = false;
        await sb.elements['quick-add-context-menu'].fire('change');
        expect(sb.localData.quickAddContextMenu).toBe('');

        // re-checks → back to '1'
        sb.elements['quick-add-context-menu'].checked = true;
        await sb.elements['quick-add-context-menu'].fire('change');
        expect(sb.localData.quickAddContextMenu).toBe('1');
    });
});

describe('Sorting group (issue #33)', () => {
    it('reads sortOptions into the controls and writes changes back', async () => {
        const sb = createSandbox({
            chromeLocalData: { sortOptions: '{"by":"dateAdded","foldersFirst":false,"recursive":true}' }
        });
        await sb.start();
        expect(sb.elements['sort-options-title'].checked).toBe(false);
        expect(sb.elements['sort-options-date'].checked).toBe(true);
        expect(sb.elements['sort-options-folders-first'].checked).toBe(false);
        expect(sb.elements['sort-options-recursive'].checked).toBe(true);

        // flip back to title (radio exclusivity is manual in the stub)
        sb.elements['sort-options-title'].checked = true;
        sb.elements['sort-options-date'].checked = false;
        await sb.elements['sort-options-title'].fire('change');
        sb.elements['sort-options-folders-first'].checked = true;
        await sb.elements['sort-options-folders-first'].fire('change');

        expect(JSON.parse(sb.localData.sortOptions))
            .toEqual({ by: 'title', foldersFirst: true, recursive: true });
    });

    it('defaults to title/folders-first/non-recursive when sortOptions is unset', async () => {
        const sb = createSandbox();
        await sb.start();
        expect(sb.elements['sort-options-title'].checked).toBe(true);
        expect(sb.elements['sort-options-date'].checked).toBe(false);
        expect(sb.elements['sort-options-folders-first'].checked).toBe(true);
        expect(sb.elements['sort-options-recursive'].checked).toBe(false);
    });

    it('assigns the group labels from i18n keys', async () => {
        const sb = createSandbox();
        await sb.start();
        expect(sb.elements['sort-options'].innerText).toBe('optionsGroupSort');
        expect(sb.elements['option-sort-by-title'].innerText).toBe('sortByTitle');
        expect(sb.elements['option-sort-by-date'].innerText).toBe('sortByDateAdded');
        expect(sb.elements['option-sort-folders-first'].innerText).toBe('sortFoldersFirst');
        expect(sb.elements['option-sort-recursive'].innerText).toBe('sortRecursive');
        expect(sb.elements['option-sort-recursive-hint'].innerText).toBe('sortRecursiveWarning');
    });

    it('options.html loads sort-utils.js before options.js (shared parseSortOptions, review 05-S4)', () => {
        const sortAt = optionsHtml.indexOf('<script src="/src/sort-utils.js"></script>');
        const optionsAt = optionsHtml.indexOf('<script src="/src/options.js"></script>');
        expect(sortAt).toBeGreaterThan(-1);
        expect(optionsAt).toBeGreaterThan(-1);
        expect(sortAt).toBeLessThan(optionsAt);
    });

    it('falls back to the defaults on corrupted sortOptions JSON', async () => {
        const sb = createSandbox({ chromeLocalData: { sortOptions: '{oops' } });
        await sb.start();
        expect(sb.elements['sort-options-title'].checked).toBe(true);
        expect(sb.elements['sort-options-date'].checked).toBe(false);
        expect(sb.elements['sort-options-folders-first'].checked).toBe(true);
        expect(sb.elements['sort-options-recursive'].checked).toBe(false);
    });
});

// Custom styles (userstyle) save contract — the options page binds the
// #userstyle textarea. Two input paths must persist to store + storage:
//  (1) CodeMirror onChange (primary, vendored editor), and
//  (2) the native textarea change event (fallback when CodeMirror is absent —
//      the fix for "custom CSS silently stops saving if CodeMirror fails to
//      load"). The APPLY side (popup/panel injection) is src/userstyle.js.
describe('custom styles userstyle save', () => {
    it('pre-fills the userstyle textarea from storage', async () => {
        const sb = createSandbox({ chromeLocalData: { userstyle: 'body { color: red; }' } });
        await sb.start();
        expect(sb.elements.userstyle.value).toBe('body { color: red; }');
    });

    it('saves via the native change fallback when CodeMirror is unavailable', async () => {
        const sb = createSandbox(); // no window.CodeMirror → fallback path
        await sb.start();
        const ta = sb.elements.userstyle;
        ta.value = 'body { color: red; }';
        await ta.fire('change');
        expect(sb.window.store.get('userstyle')).toBe('body { color: red; }');
        sb.window.store.flush(); // force the debounced persist
        expect(sb.localData.userstyle).toBe('body { color: red; }');
    });

    it('saves via CodeMirror onChange when the editor is present', async () => {
        let fromTextAreaOpts = null;
        const fakeCodeMirror = {
            fromTextArea: vi.fn((ta, opts) => { fromTextAreaOpts = opts; return {}; })
        };
        const sb = createSandbox({ windowExtras: { CodeMirror: fakeCodeMirror } });
        await sb.start();
        expect(fakeCodeMirror.fromTextArea).toHaveBeenCalledTimes(1);
        // the editor wiring hands over an onChange handler (the persistence path
        // asserted right below) — a bare truthiness check would pass for any stub
        expect(typeof fromTextAreaOpts.onChange).toBe('function');
        // simulate an editor edit → the onChange handler persists
        fromTextAreaOpts.onChange({ getValue: () => 'body { color: blue; }' });
        expect(sb.window.store.get('userstyle')).toBe('body { color: blue; }');
        sb.window.store.flush();
        expect(sb.localData.userstyle).toBe('body { color: blue; }');
    });

    it('loads CodeMirror before options.js in the options page', () => {
        const cmAt = optionsHtml.indexOf('<script src="/vendor/codemirror.js"></script>');
        const optionsAt = optionsHtml.indexOf('<script src="/src/options.js"></script>');
        expect(cmAt).toBeGreaterThan(-1);
        expect(optionsAt).toBeGreaterThan(-1);
        expect(cmAt).toBeLessThan(optionsAt);
    });
});

describe('issue #48 collapse switches (tab-group default off, sort default on)', () => {
    it('fresh storage: tab-group starts unchecked, sort starts checked', async () => {
        const sb = createSandbox(); // no stored keys → defaults apply
        await sb.start();
        // default off ('0') must NOT read as truthy and mis-tick the box
        expect(sb.elements['collapse-tab-group-menu'].checked).toBe(false);
        expect(sb.elements['collapse-sort-menu'].checked).toBe(true);
    });

    it('toggles persist as 1 or empty like the other view switches', async () => {
        const sb = createSandbox();
        await sb.start();

        sb.elements['collapse-tab-group-menu'].checked = true;
        await sb.elements['collapse-tab-group-menu'].fire('change');
        expect(sb.localData.collapseTabGroupMenu).toBe('1');

        sb.elements['collapse-tab-group-menu'].checked = false;
        await sb.elements['collapse-tab-group-menu'].fire('change');
        expect(sb.localData.collapseTabGroupMenu).toBe('');

        sb.elements['collapse-sort-menu'].checked = false;
        await sb.elements['collapse-sort-menu'].fire('change');
        expect(sb.localData.collapseSortMenu).toBe('');
    });

    it('restores a stored on/off state across every value convention', async () => {
        for (const [stored, expected] of [
            ['1', true], ['true', true], [true, true],
            ['0', false], ['false', false], ['', false], [false, false]
        ]) {
            const sb = createSandbox({ chromeLocalData: { collapseTabGroupMenu: stored } });
            await sb.start();
            expect(sb.elements['collapse-tab-group-menu'].checked, `stored ${JSON.stringify(stored)}`).toBe(expected);
        }
    });
});
