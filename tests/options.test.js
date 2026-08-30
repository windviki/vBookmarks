import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';

// options.js is a classic script riding on page globals (store/getSetting/
// setSetting from store.js, chrome.*, document). The sandbox evaluates the
// REAL store.js first (so store.syncKeys and the back-compat helpers are the
// production wiring) and then the REAL options.js against a stub DOM —
// nothing is copied from the sources under test.
const storeSource = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const sortUtilsSource = fs.readFileSync(new URL('../src/sort-utils.js', import.meta.url), 'utf8');
const storageUsageSource = fs.readFileSync(new URL('../src/storage-usage.js', import.meta.url), 'utf8');
const optionsSource = fs.readFileSync(new URL('../src/options.js', import.meta.url), 'utf8');
const optionsHtml = fs.readFileSync(new URL('../pages/options.html', import.meta.url), 'utf8');

const createSandbox = ({
    chromeLocalData = {},
    chromeSyncData = {},
    chromeLocalExtras = {},
    windowExtras = {}
} = {}) => {
    // chrome.storage areas, backed by plain objects (same shape as store.test.js)
    const localData = chromeLocalData;
    const syncData = chromeSyncData;
    const makeArea = (data, extras = {}) => ({
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
        },
        ...extras
    });

    const onChangedListeners = [];
    const chrome = {
        // no locale messages loaded: getMessage echoes the key so label and
        // alert assertions target the i18n contract
        i18n: { getMessage: key => key },
        storage: {
            local: makeArea(localData, chromeLocalExtras),
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
        disabled: false,
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

    // 1c. real storage-usage.js → window.VBMUsage (options.html loads it
    // right after sort-utils.js; the storage-usage bar reads its predicates)
    new Function('window', storageUsageSource)(window);

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
            expect(optionsHtml).toContain('id="header-github" href="https://github.com/windviki/vBookmarks"');
            expect(optionsHtml).toContain('id="options-version" href="https://github.com/windviki/vBookmarks/blob/master/docs/README.md#v408"');
            // audit O11: the subtitle is a span, not a <p> nested inside <h1>
            expect(optionsHtml).toContain('<span id="header-since"></span>');
            expect(optionsHtml).not.toContain('<p id="header-since"></p>');
            // The storage-usage bar lives in the Icons group, next to the
            // clear-icon-cache button (before the group's closing </ul>).
            expect(optionsHtml.indexOf('id="favicon-cache-clear"')).toBeLessThan(optionsHtml.indexOf('id="storage-usage"'));
            expect(optionsHtml.indexOf('id="storage-usage"')).toBeLessThan(optionsHtml.indexOf('</ul>', optionsHtml.indexOf('id="icons-options"')));
            // 4.0.8 storage-usage block: summary line above the bar, every
            // segment keyboard-focusable (tabindex="0" so the tooltip value is
            // reachable without a pointer), and destructive actions marked
            // with .danger (same secondary shape, danger border + text).
            // 2026-08 storage-audit fix round: the bar is three segments —
            // icon cache / other / free (the scan/mark segment is gone).
            expect(optionsHtml).toContain('id="storage-usage-summary"');
            for (const cls of ['usage-icon', 'usage-other', 'usage-free'])
                expect(optionsHtml).toContain(`class="usage-seg ${cls}" data-usage="${cls.replace('usage-', '')}" tabindex="0"`);
            for (const id of ['favicon-cache-clear', 'stats-clear', 'import-settings', 'reset-button'])
                expect(optionsHtml).toMatch(new RegExp(`id="${id}"[^>]*class="danger"`));
            // audit T5: the three icon switches + backup switch exist as real
            // checkboxes, so deleting them from options.html cannot pass the
            // dynamically-created DOM stub unnoticed.
            for (const id of ['favicon-contrast', 'favicon-enrich', 'favicon-enrich-ddg', 'favicon-backup'])
                expect(optionsHtml).toMatch(new RegExp(`<input type="checkbox" id="${id}"`));
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

        it('icons-group switches default on and persist in the 1/empty model (audit T5)', async () => {
            const sb = createSandbox(); // fresh storage
            await sb.start();
            // defaults: contrast / enrich / aggregate fallback / backup all on
            for (const id of ['favicon-contrast', 'favicon-enrich', 'favicon-enrich-ddg', 'favicon-backup'])
                expect(sb.elements[id].checked, id).toBe(true);
            expect(sb.elements['favicon-enrich-ddg'].disabled).toBe(false);

            // the favicon switches are sync-routed keys (2026-08 storage
            // audit): setSetting lands them in chrome.storage.sync
            sb.elements['favicon-enrich'].checked = false;
            await sb.elements['favicon-enrich'].fire('change');
            expect(sb.syncData.faviconEnrich).toBe('');
            expect(sb.elements['favicon-enrich-ddg'].disabled).toBe(true);

            sb.elements['favicon-enrich'].checked = true;
            await sb.elements['favicon-enrich'].fire('change');
            expect(sb.syncData.faviconEnrich).toBe('1');
            expect(sb.elements['favicon-enrich-ddg'].disabled).toBe(false);

            sb.elements['favicon-backup'].checked = false;
            await sb.elements['favicon-backup'].fire('change');
            expect(sb.syncData.faviconBackupInclude).toBe('');

            // restore stored states across reload
            const sb2 = createSandbox({
                chromeSyncData: {
                    faviconContrast: '', faviconEnrich: '', faviconEnrichAgg: '',
                    faviconBackupInclude: ''
                }
            });
            await sb2.start();
            expect(sb2.elements['favicon-contrast'].checked).toBe(false);
            expect(sb2.elements['favicon-enrich'].checked).toBe(false);
            expect(sb2.elements['favicon-enrich-ddg'].checked).toBe(false);
            expect(sb2.elements['favicon-enrich-ddg'].disabled).toBe(true);
            expect(sb2.elements['favicon-backup'].checked).toBe(false);
        });
    });

    describe('export', () => {
        it('downloads one JSON file with app/version stamp, full local area and only the sync keys', async () => {
            const sb = createSandbox({
                // theme lives in the sync area since the 2026-08 storage
                // audit; the local section only carries genuinely local keys
                chromeLocalData: { __migrated_v1: '1', zoom: 110 },
                chromeSyncData: {
                    showSyncStatus: 'false',
                    highlightUnsynced: 'true',
                    autoRefreshSync: 'true',
                    syncRefreshInterval: 60,
                    theme: 'dark',
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
            expect(backup.local).toEqual({ __migrated_v1: '1', zoom: 110 });
            // sync payload is restricted to store.syncKeys
            expect(backup.sync).toEqual({
                showSyncStatus: 'false',
                highlightUnsynced: 'true',
                autoRefreshSync: 'true',
                syncRefreshInterval: 60,
                theme: 'dark'
            });

            const anchor = sb.created.find(el => el.tagName === 'a');
            expect(anchor.download).toMatch(/^vbookmarks-settings-\d{4}-\d{2}-\d{2}-with-icons\.json$/);
            expect(anchor.href).toBe('blob:mock-1');
            expect(anchor.clicked).toBe(1);
            expect(sb.URLStub.revokeObjectURL).toHaveBeenCalledWith('blob:mock-1');
        });

        it('ships the favicon cache keys by default, and strips them when the backup switch is off', async () => {
            const favKey = 'vbmFavicon:github.com';
            const favIdx = JSON.stringify({ v: 3, down: {}, hosts: { 'github.com': { t: 1, s: 2 } } });
            const seeded = {
                __migrated_v1: '1', zoom: 110,
                [favKey]: 'data:image/png;base64,AAAA',
                vbmFaviconIdx: favIdx
            };
            // Default (switch on): the cache rides along for full-fidelity backup.
            let sb = createSandbox({ chromeLocalData: { ...seeded } });
            await sb.start();
            await sb.elements['export-settings'].fire('click');
            expect(JSON.parse(await sb.objectURLs[0].text()).local)
                .toEqual({ __migrated_v1: '1', zoom: 110, [favKey]: seeded[favKey], vbmFaviconIdx: favIdx });
            // Switch off: favicon keys stripped from the export to keep it small,
            // and the filename says -no-icons (audit O7).
            sb = createSandbox({ chromeLocalData: { ...seeded } });
            await sb.start();
            sb.elements['favicon-backup'].checked = false;
            await sb.elements['export-settings'].fire('click');
            expect(JSON.parse(await sb.objectURLs[0].text()).local)
                .toEqual({ __migrated_v1: '1', zoom: 110 });
            expect(sb.created.find(el => el.tagName === 'a').download)
                .toMatch(/-no-icons\.json$/);
        });

        it('never ships the live vbmDeadScan journal, regardless of cache switch (audit D7)', async () => {
            const sb = createSandbox({
                chromeLocalData: {
                    theme: 'dark',
                    vbmDeadScan: JSON.stringify({ state: 'scanning', done: 200, total: 5000 }),
                    'vbmFavicon:github.com': 'data:image/png;base64,AAAA'
                }
            });
            await sb.start();
            await sb.elements['export-settings'].fire('click');
            const backup = JSON.parse(await sb.objectURLs[0].text());
            // theme migrated to the sync area at startup (2026-08 storage
            // audit), so it ships in the sync section, never under local
            expect(backup.local.theme).toBeUndefined();
            expect(backup.sync.theme).toBe('dark');
            expect(backup.local.vbmDeadScan).toBeUndefined();
            expect(backup.local['vbmFavicon:github.com']).toBe('data:image/png;base64,AAAA');
        });
    });

    describe('import validation', () => {
        it('rejects unparseable JSON without touching storage', async () => {
            const sb = createSandbox({ chromeLocalData: { __migrated_v1: '1', theme: 'light' } });
            await sb.start();
            await pickFile(sb, '{not json');
            expect(sb.alerts).toEqual(['settingsImportInvalid']);
            expect(sb.confirms).toHaveLength(0);
            // theme migrated to the sync area at startup; neither area moved
            expect(sb.localData).toEqual({ __migrated_v1: '1' });
            expect(sb.syncData).toEqual({ theme: 'light' });
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
            // theme migrated to the sync area at startup — and stays 'light'
            expect(sb.localData.theme).toBeUndefined();
            expect(sb.syncData.theme).toBe('light');
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
            // overwritten + added + preserved — no wipe (theme migrated to
            // the sync area at startup, so only genuinely local keys remain)
            expect(sb.localData).toEqual({ __migrated_v1: '1', keepMe: 'x', newKey: '1' });
            // sync area: backup keys overwritten — theme routed from the
            // backup's local section into its sync-area home (2026-08
            // storage audit) — unmentioned key kept
            expect(sb.syncData.theme).toBe('dark');
            expect(sb.syncData.showSyncStatus).toBe('false');
            expect(sb.syncData.highlightUnsynced).toBe('true');
            expect(sb.alerts).toEqual(['settingsImportDone']);
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
            // the file input is reset so the same file can be picked again
            expect(sb.elements['import-settings-file'].value).toBe('');
        });

        it('ignores a vbmDeadScan journal inside a legacy backup (audit D7)', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1', theme: 'light' },
                chromeSyncData: {}
            });
            await sb.start();
            await pickFile(sb, validBackup({ local: {
                theme: 'dark',
                vbmDeadScan: JSON.stringify({ state: 'scanning', done: 200, total: 5000 })
            } }));
            expect(sb.syncData.theme).toBe('dark'); // sync-routed on import
            expect(sb.localData.vbmDeadScan).toBeUndefined();
            expect(sb.alerts).toEqual(['settingsImportDone']);
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
        });

        it('2026-08 review: a key in BOTH backup sections keeps the sync-section value', async () => {
            // Legacy backups can carry a sync-routed key in both sections;
            // the local copy is usually the older residue, so the sync
            // section must win on conflict.
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1' },
                chromeSyncData: {}
            });
            await sb.start();
            await pickFile(sb, validBackup({
                local: { theme: 'dark' },
                sync: { theme: 'ink' }
            }));
            expect(sb.syncData.theme).toBe('ink');
            expect(sb.localData.theme).toBeUndefined();
            expect(sb.alerts).toEqual(['settingsImportDone']);
        });

        it('accepts a backup without a sync section', async () => {
            const sb = createSandbox({
                chromeLocalData: { __migrated_v1: '1' },
                chromeSyncData: { showSyncStatus: 'true' }
            });
            await sb.start();
            await pickFile(sb, JSON.stringify({ app: 'vBookmarks', local: { theme: 'ink' } }));
            expect(sb.syncData.theme).toBe('ink'); // sync-routed on import
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
            expect(sb.syncData.theme).toBe('dark'); // sync-routed on import
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
            expect(sb.syncData.theme).toBe('dark'); // sync-routed on import
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
            expect(sb.syncData.theme).toBe('dark'); // sync-routed on import
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
            // theme migrated to the sync area at startup — and stays 'light';
            // the sync write is never attempted after the local one fails
            expect(sb.syncData.theme).toBe('light');
            expect(sb.syncData.showSyncStatus).toBe('true');
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
// chrome.storage.local into icon cache / other / free (2026-08 storage-audit
// fix round: the scan/mark segment was dropped — the favicon cache is the
// only dataset with a dynamic byte budget) so the user can decide when to
// clear the icon cache. 4.0.8 refactor: each segment carries an accessible
// size label + tooltip data, the legend shows color swatches, and the bar
// re-measures live on storage.onChanged.
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
                zoom: '110',                                               // other
                'vbmFavicon:github.com': 'data:image/png;base64,AAAA',      // icon
                vbmFaviconIdx: favIdx,                                     // icon
                deadLastScan: JSON.stringify({ done: 1 }),                 // other (scan/mark segment gone)
                visitStats: '{}'                                           // other
            }
        });
        await sb.start();
        // legend: one swatched item per category, colors mirroring the segments
        const legend = legendText(sb);
        for (const key of ['storageUsageIcon', 'storageUsageOther', 'storageUsageFree'])
            expect(legend).toContain(key);
        for (const sw of ['usage-icon', 'usage-other', 'usage-free'])
            expect(legend).toContain(`legend-swatch ${sw}`);
        // every segment got a percentage width + an accessible label (10MB quota)
        for (const id of ['usage-icon', 'usage-other', 'usage-free']) {
            expect(sb.elements[id].style.width).toMatch(/^\d+(?:\.\d+)?%$/);
            expect(sb.elements[id]._attributes['aria-label']).toMatch(/(B|KB|MB)$/);
            expect(sb.elements[id]._attributes['title']).toBe(sb.elements[id]._attributes['aria-label']);
        }
        // the bar's aria-label summarizes all three categories
        const barLabel = sb.elements['storage-usage-bar']._attributes['aria-label'];
        for (const key of ['storageUsageIcon', 'storageUsageOther', 'storageUsageFree'])
            expect(barLabel).toContain(key);
        // 4.0.8: a summary line answers "used / quota" without hovering, and
        // every legend item also carries its share — never encode data by
        // color alone (chart guidance).
        expect(sb.elements['storage-usage-summary'].textContent).toBe('storageUsageSummary');
        for (const key of ['storageUsageIcon', 'storageUsageOther', 'storageUsageFree'])
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
        // audit O5: clearing is confirmed like the other destructive actions
        expect(sb.confirms).toEqual(['optionFaviconCacheClearConfirm']);
        expect(sb.alerts).toEqual(['optionFaviconCacheCleared']);
        expect(sb.localData['vbmFavicon:github.com']).toBeUndefined();
        expect(sb.localData.vbmFaviconIdx).toBeUndefined();
        expect(iconBytes(sb)).toBe(0);
    });

    it('a cancelled clear-cache confirm removes nothing (audit O5)', async () => {
        const sb = createSandbox({
            chromeLocalData: { 'vbmFavicon:github.com': 'data:image/png;base64,AAAA' }
        });
        await sb.start();
        sb.setConfirm(false);
        await sb.elements['favicon-cache-clear'].fire('click');
        expect(sb.localData['vbmFavicon:github.com']).toBe('data:image/png;base64,AAAA');
        expect(sb.alerts).toHaveLength(0);
    });

    it('an empty cache answers with feedback instead of a silent return (audit O5)', async () => {
        const sb = createSandbox({ chromeLocalData: { theme: 'dark' } });
        await sb.start();
        await sb.elements['favicon-cache-clear'].fire('click');
        expect(sb.confirms).toHaveLength(0);
        expect(sb.alerts).toEqual(['optionFaviconCacheEmpty']);
        // nothing removed — theme (migrated to the sync area at startup)
        // and the rest of storage stay untouched
        expect(sb.syncData.theme).toBe('dark');
        expect(sb.localData.vbmFaviconIdx).toBeUndefined();
    });

    it('re-measures live when the background writes icon-cache keys', async () => {
        const sb = createSandbox({ chromeLocalData: { theme: 'dark' } });
        await sb.start();
        expect(sb.elements['usage-icon']._attributes['aria-label']).toBe('storageUsageIcon 0 B');
        // the background stores an enriched favicon while the page is open;
        // onChanged is debounced (audit O3), so wait past the 300ms window
        await sb.chrome.storage.local.set({ 'vbmFavicon:github.com': 'data:image/png;base64,AAAA' });
        for (const fn of sb.onChangedListeners)
            fn({ 'vbmFavicon:github.com': { newValue: 'data:image/png;base64,AAAA' } }, 'local');
        await new Promise(r => setTimeout(r, 350));
        expect(sb.elements['usage-icon']._attributes['aria-label']).toMatch(/storageUsageIcon \d+ B/);
        // any local change schedules a re-measure now (only the vbmDeadScan
        // journal is excluded) — the icon figure itself is unaffected
        for (const fn of sb.onChangedListeners) fn({ zoom: { newValue: 110 } }, 'local');
        await new Promise(r => setTimeout(r, 350));
        expect(sb.elements['usage-icon']._attributes['aria-label']).toMatch(/storageUsageIcon \d+ B/);
    });

    it('debounces a burst of icon writes into one full re-measure (audit O3)', async () => {
        const sb = createSandbox({ chromeLocalData: { theme: 'dark' } });
        await sb.start();
        let fullReads = 0;
        const originalGet = sb.chrome.storage.local.get;
        sb.chrome.storage.local.get = async (...args) => {
            fullReads++;
            return originalGet(...args);
        };
        for (let i = 0; i < 5; i++) {
            await sb.chrome.storage.local.set({
                [`vbmFavicon:h${i}.example`]: 'data:image/png;base64,AAAA'
            });
            for (const fn of sb.onChangedListeners)
                fn({ [`vbmFavicon:h${i}.example`]: { newValue: 'data:image/png;base64,AAAA' } }, 'local');
        }
        // still inside the debounce window: no full-area read yet
        expect(fullReads).toBe(0);
        await new Promise(r => setTimeout(r, 350));
        expect(fullReads).toBe(1); // the whole burst collapsed into one scan
        expect(sb.elements['usage-icon']._attributes['aria-label']).toMatch(/storageUsageIcon \d+ B/);
        // the dead-scan live journal is the one excluded key: no re-measure
        for (const fn of sb.onChangedListeners) fn({ vbmDeadScan: { newValue: '{}' } }, 'local');
        await new Promise(r => setTimeout(r, 350));
        expect(fullReads).toBe(1);
        // any other local change (not just icon keys) schedules one
        for (const fn of sb.onChangedListeners) fn({ zoom: { newValue: 110 } }, 'local');
        await new Promise(r => setTimeout(r, 350));
        expect(fullReads).toBe(2);
    });

    it('counts deadMarks/deadMarkTimes as other — the scan/mark segment is gone (audit O4 revisited)', async () => {
        const sb = createSandbox({
            chromeLocalData: {
                deadMarks: '["12","13"]',
                deadMarkTimes: '{"12":1700000000000}'
            }
        });
        await sb.start();
        // the v1 migration flag the real store.js writes rides "other" too
        const expectedBytes = JSON.stringify('["12","13"]').length
            + JSON.stringify('{"12":1700000000000}').length
            + JSON.stringify('1').length; // __migrated_v1
        expect(sb.elements['usage-other']._attributes['aria-label'])
            .toBe(`storageUsageOther ${expectedBytes} B`);
    });

    it('prefers chrome.storage.local.getBytesInUse for real billed bytes (audit O9)', async () => {
        const getBytesInUse = vi.fn(async keys => (keys[0] || '').startsWith('vbmFavicon') ? 100 : 200);
        const sb = createSandbox({
            chromeLocalData: {
                'vbmFavicon:github.com': 'data:image/png;base64,AAAA',
                deadMarks: '["12"]' // rides "other" since the bar simplification
            },
            chromeLocalExtras: { getBytesInUse }
        });
        await sb.start();
        expect(getBytesInUse).toHaveBeenCalledTimes(2); // icon bucket + other bucket
        expect(sb.elements['usage-icon']._attributes['aria-label']).toBe('storageUsageIcon 100 B');
        expect(sb.elements['usage-other']._attributes['aria-label']).toBe('storageUsageOther 200 B');
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
        expect(sb.elements['options-version'].href).toBe('https://github.com/windviki/vBookmarks/blob/master/docs/README.md#v401');
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
        it('confirms first, then wipes local + sync storage, alerts and reloads', async () => {
            const sb = createSandbox({
                chromeLocalData: { theme: 'dark', deadScanConcurrency: '7' },
                chromeSyncData: { showSyncStatus: 'true' }
            });
            await sb.start();
            await sb.elements['reset-button'].fire('click');
            for (let i = 0; i < 10; i++)
                await new Promise(r => setTimeout(r, 0));
            // the shared destructive-action contract: confirm before wipe
            expect(sb.confirms).toEqual(['resetSettingsConfirm']);
            expect(sb.localData).toEqual({});
            expect(sb.syncData).toEqual({});
            expect(sb.alerts).toContain('resetSettingsDone');
            expect(sb.location.reload).toHaveBeenCalledTimes(1);
        });

        it('a cancelled reset confirm wipes nothing', async () => {
            const sb = createSandbox({
                chromeLocalData: { theme: 'dark' },
                chromeSyncData: { showSyncStatus: 'true' }
            });
            await sb.start();
            sb.setConfirm(false);
            await sb.elements['reset-button'].fire('click');
            for (let i = 0; i < 10; i++)
                await new Promise(r => setTimeout(r, 0));
            expect(sb.confirms).toEqual(['resetSettingsConfirm']);
            // theme migrated to the sync area at startup; everything survives
            expect(sb.syncData.theme).toBe('dark');
            expect(sb.syncData.showSyncStatus).toBe('true');
            expect(sb.alerts).toHaveLength(0);
            expect(sb.location.reload).not.toHaveBeenCalled();
        });
    });

    describe('zoom input', () => {
        it('debounces a rapid input burst into one trailing write', async () => {
            const sb = createSandbox();
            await sb.start();
            const zoom = sb.elements['zoom-input'];
            zoom.value = '110';
            await zoom.fire('input');
            zoom.value = '120';
            await zoom.fire('input');
            // still inside the 200ms window: nothing written yet
            expect('zoom' in sb.localData).toBe(false);
            await new Promise(r => setTimeout(r, 250));
            expect(sb.localData.zoom).toBe(120); // the last value wins
        });

        it('skips the write entirely for an unparseable value (NaN guard)', async () => {
            const sb = createSandbox();
            await sb.start();
            const zoom = sb.elements['zoom-input'];
            zoom.value = '';
            await zoom.fire('input');
            await new Promise(r => setTimeout(r, 250));
            expect('zoom' in sb.localData).toBe(false);
        });

        it('removes the setting when the zoom returns to 100', async () => {
            const sb = createSandbox({ chromeLocalData: { zoom: 120 } });
            await sb.start();
            const zoom = sb.elements['zoom-input'];
            zoom.value = '100';
            await zoom.fire('input');
            await new Promise(r => setTimeout(r, 250));
            expect('zoom' in sb.localData).toBe(false);
        });
    });

    describe('syncRefreshInterval gate', () => {
        it('rejects values below the 30s floor, accepts 30 (aligned with the input min and the SW clamp)', async () => {
            const sb = createSandbox();
            await sb.start();
            const input = sb.elements['sync-refresh-interval'];
            input.value = '20';
            await input.fire('input');
            await new Promise(r => setTimeout(r, 600)); // past the 500ms debounce
            expect('syncRefreshInterval' in sb.syncData).toBe(false);
            input.value = '30';
            await input.fire('input');
            await new Promise(r => setTimeout(r, 600));
            expect(sb.syncData.syncRefreshInterval).toBe(30);
        });
    });
});

describe('view hide/disable controls (4.0.8)', () => {
    it('options.html adds status+button rows for feature view show options', () => {
        for (const id of ['show-recent-bookmarks', 'show-stats-view', 'show-dead-view', 'show-dupes-view'])
            expect(optionsHtml).toContain(`id="${id}"`);
        for (const id of ['recent-view-state', 'recent-view-toggle',
            'stats-view-state', 'stats-view-toggle',
            'dead-view-state', 'dead-view-toggle',
            'dupes-view-state', 'dupes-view-toggle'])
            expect(optionsHtml).toContain(`id="${id}"`);
        expect(optionsHtml).toContain('view-option-row');
        // tree/search are structural and always preserved — no per-view show option for them
        expect(optionsHtml).not.toContain('id="show-tree-view"');
        expect(optionsHtml).not.toContain('id="show-search-view"');
    });

    it('defaults feature views to enabled with their show checkboxes enabled', async () => {
        const sb = createSandbox();
        await sb.start();
        for (const id of ['show-recent-bookmarks', 'show-stats-view', 'show-dead-view', 'show-dupes-view']) {
            expect(sb.elements[id].checked).toBe(true);
            expect(sb.elements[id].disabled).toBe(false);
        }
        for (const id of ['recent-view-state', 'stats-view-state', 'dead-view-state', 'dupes-view-state'])
            expect(sb.elements[id].textContent).toBe('viewStateEnabled');
        for (const id of ['recent-view-toggle', 'stats-view-toggle', 'dead-view-toggle', 'dupes-view-toggle'])
            expect(sb.elements[id].textContent).toBe('viewDisable');
    });

    it('disabling a view writes its disable key and greys out its show option', async () => {
        const sb = createSandbox();
        await sb.start();
        // the disable*View keys are sync-routed (2026-08 storage audit)
        await sb.elements['stats-view-toggle'].fire('click');
        expect(sb.syncData.disableStatsView).toBe('1');
        expect(sb.elements['show-stats-view'].disabled).toBe(true);
        expect(sb.elements['stats-view-state'].textContent).toBe('viewStateDisabled');
        expect(sb.elements['stats-view-toggle'].textContent).toBe('viewEnable');

        await sb.elements['stats-view-toggle'].fire('click');
        expect(sb.syncData.disableStatsView).toBe('');
        expect(sb.elements['show-stats-view'].disabled).toBe(false);
        expect(sb.elements['stats-view-state'].textContent).toBe('viewStateEnabled');
        expect(sb.elements['stats-view-toggle'].textContent).toBe('viewDisable');
    });

    it('keeps the feature-view show checkbox disabled only while that view is disabled', async () => {
        const sb = createSandbox({
            chromeLocalData: {
                showRecentBookmarks: '',
                showStatsView: '1',
                showDeadView: '1',
                showDupesView: '1',
                disableStatsView: '1'
            }
        });
        await sb.start();
        // disabled view: show option greyed out
        expect(sb.elements['show-stats-view'].disabled).toBe(true);
        // hidden-but-enabled view: checkbox available for re-enable
        expect(sb.elements['show-recent-bookmarks'].disabled).toBe(false);
        // other visible feature views: available
        expect(sb.elements['show-dead-view'].disabled).toBe(false);
    });
});

describe('classic-experience preset (v4 task-3 #20 + issue #49)', () => {
    it('turns off every v4-only switch including the quick-add page context menu', async () => {
        const sb = createSandbox(); // fresh storage → all default ON
        await sb.start();

        // default: the quick-add context-menu switch starts checked
        expect(sb.elements['quick-add-context-menu'].checked).toBe(true);

        await sb.elements['classic-experience'].fire('click');

        // every one of these switches is a sync-routed key (2026-08 storage audit)
        for (const key of ['paletteEnabled', 'quickAddEnabled', 'quickAddContextMenu',
            'showToolButton', 'showViewTabs', 'treeRowActions', 'searchHistoryEnabled'])
            expect(sb.syncData[key]).toBe('');
        expect(sb.elements['quick-add-context-menu'].checked).toBe(false);
        expect(sb.elements['palette-enabled'].checked).toBe(false);
        expect(sb.elements['show-tool-button'].checked).toBe(false);
        // 2026-08-26 report round: the tree-row hover quick actions
        // (书签行悬浮快捷按钮) and the search-history area stand down with
        // the one-click classic preset too
        expect(sb.elements['tree-row-actions'].checked).toBe(false);
        expect(sb.elements['search-history-enabled'].checked).toBe(false);
    });

    // 2026-08-26 report: the search-history switch is an AREA toggle only —
    // turning it off must NOT wipe the stored MRU (re-enabling brings the
    // recorded queries back).
    it('the search-history switch only toggles the area — the MRU survives', async () => {
        const mru = JSON.stringify([{ q: 'x', ts: 1, n: 0 }]);
        const sb = createSandbox({ chromeLocalData: { searchHistory: mru } });
        await sb.start();
        sb.elements['search-history-enabled'].checked = false;
        await sb.elements['search-history-enabled'].fire('change');
        expect(sb.syncData.searchHistoryEnabled).toBe('');
        expect(sb.localData.searchHistory).toBe(mru); // untouched
    });

    // 2026-08-26 report: the recent-search COUNT select binds and persists
    // (options 搜索 → 最近搜索显示条数, default 5).
    it('the search-history count select binds to storage', async () => {
        const sb = createSandbox();
        await sb.start();
        expect(sb.elements['search-history-count'].value).toBe('5'); // default
        sb.elements['search-history-count'].value = '10';
        await sb.elements['search-history-count'].fire('change');
        // a synced preference like recentCount since the 2026-08-26 round
        expect(sb.syncData.searchHistoryCount).toBe('10');
    });

    it('the quick-add context-menu switch binds to storage and toggles independently', async () => {
        const sb = createSandbox();
        await sb.start();

        // user unchecks the context-menu entry → key flips to '' (off)
        sb.elements['quick-add-context-menu'].checked = false;
        await sb.elements['quick-add-context-menu'].fire('change');
        expect(sb.syncData.quickAddContextMenu).toBe('');

        // re-checks → back to '1'
        sb.elements['quick-add-context-menu'].checked = true;
        await sb.elements['quick-add-context-menu'].fire('change');
        expect(sb.syncData.quickAddContextMenu).toBe('1');
    });
});

describe('UI language dropdown (4.0.8)', () => {
    const makeI18nStub = (behavior = {}) => ({
        selectedLang: () => 'es',
        supportedLangs: ['en', 'es', 'de', 'it'],
        setLangCalls: [],
        async setLang(code) {
            this.setLangCalls.push(code);
            return behavior.ok !== undefined ? behavior.ok : true;
        }
    });

    it('builds the auto + native-name options and selects the override', async () => {
        const VBMI18N = makeI18nStub();
        const sb = createSandbox({ windowExtras: { VBMI18N } });
        await sb.start();
        const sel = sb.elements['language-select'];
        expect(sel.innerHTML).toContain('<option value="auto">');
        expect(sel.innerHTML).toContain('<option value="es">');
        expect(sel.value).toBe('es');
    });

    it('a failed setLang reverts the dropdown to the last APPLIED value', async () => {
        const VBMI18N = makeI18nStub();
        VBMI18N.setLang = async function (code) {
            this.setLangCalls.push(code);
            return code !== 'it'; // 'it' fails, everything else applies
        };
        const sb = createSandbox({ windowExtras: { VBMI18N } });
        await sb.start();
        const sel = sb.elements['language-select'];

        // success moves the applied value forward
        sel.value = 'de';
        await sel.fire('change');
        expect(sel.value).toBe('de');

        // failure reverts to THAT applied value, not to the failed pick —
        // the pre-fix code captured the new value and reverted to itself
        sel.value = 'it';
        await sel.fire('change');
        expect(sel.value).toBe('de');
        expect(VBMI18N.setLangCalls).toEqual(['de', 'it']);
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

        expect(JSON.parse(sb.syncData.sortOptions))
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

// Custom styles: the inline textarea moved to the standalone editor page
// (4.1.1) — the save contract lives in tests/custom-css.test.js now. The
// options page only carries the outbound link.
it('custom styles row links out to the standalone editor instead of a textarea', async () => {
    const sb = createSandbox();
    await sb.start();
    expect(sb.elements['edit-custom-css'].textContent).toBe('optionEditCustomCSS');
    expect(sb.elements['edit-custom-css'].href).toContain('pages/custom-css.html');
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

        // the collapse switches are sync-routed keys (2026-08 storage audit)
        sb.elements['collapse-tab-group-menu'].checked = true;
        await sb.elements['collapse-tab-group-menu'].fire('change');
        expect(sb.syncData.collapseTabGroupMenu).toBe('1');

        sb.elements['collapse-tab-group-menu'].checked = false;
        await sb.elements['collapse-tab-group-menu'].fire('change');
        expect(sb.syncData.collapseTabGroupMenu).toBe('');

        sb.elements['collapse-sort-menu'].checked = false;
        await sb.elements['collapse-sort-menu'].fire('change');
        expect(sb.syncData.collapseSortMenu).toBe('');
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

// 4.1.1 分层记忆组: the options-page wiring the memory commit shipped
// without — master off greys out exactly the four sub-layers (记住视图
// keeps its own semantics), and the inverted dontRememberState key persists
// in the 1/empty model.
describe('memory group wiring (4.1.1)', () => {
    const SUBS = ['remember-scroll', 'remember-opens', 'remember-highlight', 'remember-search-query'];

    it('defaults: master on, sub-layers live, remember-view independent', async () => {
        const sb = createSandbox();
        await sb.start();
        expect(sb.elements['remember-prev-state'].checked).toBe(true); // inverted key absent → on
        for (const id of [...SUBS, 'remember-view'])
            expect(sb.elements[id].disabled, id).toBe(false);
        expect(sb.elements['remember-scroll'].checked).toBe(true);
    });

    it('master off disables exactly the four sub-layers — remember-view never greys out', async () => {
        const sb = createSandbox({ chromeLocalData: { dontRememberState: '1' } });
        await sb.start();
        expect(sb.elements['remember-prev-state'].checked).toBe(false);
        for (const id of SUBS)
            expect(sb.elements[id].disabled, id).toBe(true);
        expect(sb.elements['remember-view'].disabled).toBe(false);

        // flipping the master live re-enables them without touching storage of the subs
        sb.elements['remember-prev-state'].checked = true;
        await sb.elements['remember-prev-state'].fire('change');
        for (const id of SUBS)
            expect(sb.elements[id].disabled, id).toBe(false);
        expect(sb.syncData.dontRememberState).toBe(''); // inverted: checked → ''
    });

    it('the master persists through the inverted dontRememberState key (sync area)', async () => {
        const sb = createSandbox();
        await sb.start();
        sb.elements['remember-prev-state'].checked = false;
        await sb.elements['remember-prev-state'].fire('change');
        expect(sb.syncData.dontRememberState).toBe('1');
        sb.elements['remember-prev-state'].checked = true;
        await sb.elements['remember-prev-state'].fire('change');
        expect(sb.syncData.dontRememberState).toBe('');
    });

    it('sub-layer switches persist 1/empty and remember-view keeps its own key', async () => {
        const sb = createSandbox();
        await sb.start();
        for (const id of SUBS) {
            sb.elements[id].checked = false;
            await sb.elements[id].fire('change');
        }
        expect(sb.syncData.rememberScroll).toBe('');
        expect(sb.syncData.rememberOpens).toBe('');
        expect(sb.syncData.rememberHighlight).toBe('');
        expect(sb.syncData.rememberSearchQuery).toBe('');
        sb.elements['remember-view'].checked = false;
        await sb.elements['remember-view'].fire('change');
        expect(sb.syncData.rememberView).toBe('');
        // the master is untouched by sub-layer flips
        expect(sb.syncData.dontRememberState).toBeUndefined();
    });
});
