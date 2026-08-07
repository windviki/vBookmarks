import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';

// options.js is a classic script riding on page globals (store/getSetting/
// setSetting from store.js, chrome.*, document). The sandbox evaluates the
// REAL store.js first (so store.syncKeys and the back-compat helpers are the
// production wiring) and then the REAL options.js against a stub DOM —
// nothing is copied from the sources under test.
const storeSource = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const optionsSource = fs.readFileSync(new URL('../src/options.js', import.meta.url), 'utf8');
const optionsHtml = fs.readFileSync(new URL('../pages/options.html', import.meta.url), 'utf8');

const createSandbox = ({
    chromeLocalData = {},
    chromeSyncData = {}
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

    const chrome = {
        // no locale messages loaded: getMessage echoes the key so label and
        // alert assertions target the i18n contract
        i18n: { getMessage: key => key },
        storage: {
            local: makeArea(localData),
            sync: makeArea(syncData),
            onChanged: { addListener: () => {} }
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
        files: [],
        clicked: 0,
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
            created.push(el);
            return el;
        },
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        }
    };

    const window = { document, chrome, addEventListener: () => {} };

    // 1. real store.js → window.store / window.getSetting / ...
    new Function('window', 'chrome', 'localStorage', 'document', storeSource)(
        window, chrome, localStorage, document
    );

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
        it('options.html carries the backup group after Accessibility, before the footer', () => {
            for (const id of ['backup-options', 'export-settings', 'import-settings', 'import-settings-file', 'backup-hint'])
                expect(optionsHtml).toContain(`id="${id}"`);
            expect(optionsHtml).toMatch(/<input type="file" id="import-settings-file"[^>]*hidden/);
            expect(optionsHtml.indexOf('id="accessibility"')).toBeLessThan(optionsHtml.indexOf('id="backup-options"'));
            expect(optionsHtml.indexOf('id="backup-options"')).toBeLessThan(optionsHtml.indexOf('id="footer"'));
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
});
