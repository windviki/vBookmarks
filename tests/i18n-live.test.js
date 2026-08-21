import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/i18n-live.js', import.meta.url), 'utf8');

const makeLocalStorage = data => {
    const map = new Map(Object.entries(data));
    return {
        getItem: k => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: k => map.delete(k),
        _map: map
    };
};

const makeChrome = () => {
    const i18n = {
        getMessage: (key, subs) => {
            if (key === 'testKey')
                return subs !== undefined ? `orig:${subs}` : 'orig:testKey';
            return `orig:${key}`;
        },
        getUILanguage: () => 'en'
    };
    return {
        i18n,
        runtime: { getURL: p => `chrome-extension://test/${p}` },
        storage: { local: { set: async () => {} } }
    };
};

const evaluate = (localData, extra = {}) => {
    const localStorage = makeLocalStorage(localData);
    const chrome = makeChrome();
    const window = { store: { set: (k, v) => { window._storeData = window._storeData || {}; window._storeData[k] = v; } }, ...extra };
    const fetchImpl = extra.fetchImpl || (async () => { throw new Error('no fetch'); });
    new Function('window', 'localStorage', 'chrome', 'fetch', source)(window, localStorage, chrome, fetchImpl);
    return { window, localStorage, chrome, fetchImpl };
};

describe('i18n-live', () => {
    it('patches getMessage/getUILanguage synchronously from the localStorage cache', () => {
        const dict = {
            hello: { message: 'Hello $1$', placeholders: { '1': { content: '$1' } } },
            named: { message: 'Hi $name$', placeholders: { name: { content: '$1' } } },
            missing: null
        };
        const { chrome } = evaluate({
            vbmI18nLang: 'en',
            vbmI18nDict: JSON.stringify(dict)
        });
        expect(chrome.i18n.getUILanguage()).toBe('en');
        expect(chrome.i18n.getMessage('hello', 'world')).toBe('Hello world');
        expect(chrome.i18n.getMessage('named', ['Ana'])).toBe('Hi Ana');
        expect(chrome.i18n.getMessage('missing', [])).toBe('orig:missing');
    });

    it('exposes supportedLangs, currentLang and selectedLang without a cached override', () => {
        const { window } = evaluate({});
        expect(window.VBMI18N.supportedLangs).toContain('zh_CN');
        expect(window.VBMI18N.supportedLangs).toContain('en');
        expect(window.VBMI18N.currentLang()).toBe('en');
        expect(window.VBMI18N.selectedLang()).toBe('auto');
    });

    it('selectedLang returns the cached override code', () => {
        const { window } = evaluate({ vbmI18nLang: 'zh_CN', vbmI18nDict: JSON.stringify({}) });
        expect(window.VBMI18N.currentLang()).toBe('zh_CN');
        expect(window.VBMI18N.selectedLang()).toBe('zh_CN');
    });

    it('setLang rejects invalid codes', async () => {
        const { window } = evaluate({});
        await expect(window.VBMI18N.setLang('not_a_code')).resolves.toBe(false);
    });

    it('setLang fetches the locale, caches it and writes store', async () => {
        const dict = { hello: { message: 'Hola' } };
        const fetchImpl = async url => ({ ok: true, json: async () => dict });
        const { window, localStorage, chrome } = evaluate({}, { fetchImpl });
        await expect(window.VBMI18N.setLang('es')).resolves.toBe(true);
        expect(JSON.parse(localStorage.getItem('vbmI18nDict'))).toEqual(dict);
        expect(localStorage.getItem('vbmI18nLang')).toBe('es');
        expect(localStorage.getItem('uiLanguage')).toBe('es');
        expect(window._storeData.uiLanguage).toBe('es');
        expect(chrome.i18n.getMessage).toBeDefined();
    });

    it("setLang('auto') clears the override and writes an empty store value", async () => {
        const { window, localStorage } = evaluate({
            vbmI18nLang: 'es',
            vbmI18nDict: JSON.stringify({}),
            uiLanguage: 'es'
        });
        await expect(window.VBMI18N.setLang('auto')).resolves.toBe(true);
        expect(localStorage.getItem('vbmI18nLang')).toBeNull();
        expect(localStorage.getItem('vbmI18nDict')).toBeNull();
        expect(localStorage.getItem('uiLanguage')).toBeNull();
        expect(window._storeData.uiLanguage).toBe('');
    });

    it('applies an imported storage-only uiLanguage after store.ready', async () => {
        const dict = { hello: { message: 'Hola' } };
        const fetchImpl = async url => ({ ok: true, json: async () => dict });
        const store = {
            _data: { uiLanguage: 'es' },
            get: (k, d) => (k in store._data ? store._data[k] : d),
            set(k, v) { store._data[k] = v; },
            ready: Promise.resolve()
        };
        const { window, localStorage } = evaluate({}, { store, fetchImpl });
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(localStorage.getItem('vbmI18nLang')).toBe('es');
        expect(localStorage.getItem('uiLanguage')).toBe('es');
        expect(JSON.parse(localStorage.getItem('vbmI18nDict'))).toEqual(dict);
        expect(window._storeData).toBeUndefined();
    });

    it('setLang resolves false and caches nothing when the locale fetch fails', async () => {
        const fetchImpl = async () => ({ ok: false, json: async () => ({}) });
        const { window, localStorage } = evaluate({}, { fetchImpl });
        await expect(window.VBMI18N.setLang('es')).resolves.toBe(false);
        expect(localStorage.getItem('vbmI18nDict')).toBeNull();
        expect(localStorage.getItem('vbmI18nLang')).toBeNull();
        expect(window._storeData).toBeUndefined();
    });

    it('a corrupt vbmI18nDict self-heals: no patch, cache keys dropped', () => {
        const { window, localStorage, chrome } = evaluate({
            vbmI18nLang: 'es',
            vbmI18nDict: '{not json'
        });
        // no patch applied — originals still answer
        expect(chrome.i18n.getMessage('hello')).toBe('orig:hello');
        expect(chrome.i18n.getUILanguage()).toBe('en');
        // both cache keys removed, so the override is not even REPORTED
        expect(localStorage.getItem('vbmI18nDict')).toBeNull();
        expect(localStorage.getItem('vbmI18nLang')).toBeNull();
        expect(window.VBMI18N.currentLang()).toBe('en');
        expect(window.VBMI18N.selectedLang()).toBe('auto');
    });

    it("setLang('AUTO') clears the override too — the keyword is case-insensitive", async () => {
        const { window, localStorage } = evaluate({
            vbmI18nLang: 'es',
            vbmI18nDict: JSON.stringify({}),
            uiLanguage: 'es'
        });
        await expect(window.VBMI18N.setLang('AUTO')).resolves.toBe(true);
        expect(localStorage.getItem('vbmI18nLang')).toBeNull();
        expect(localStorage.getItem('vbmI18nDict')).toBeNull();
        expect(window._storeData.uiLanguage).toBe('');
    });

    it('substitutes multi-item arrays and non-string scalars', () => {
        const dict = {
            pair: { message: '$1 and $2', placeholders: {} },
            named: { message: '$what$ is $n$', placeholders: { what: { content: '$1' }, n: { content: '$2' } } }
        };
        const { chrome } = evaluate({
            vbmI18nLang: 'en',
            vbmI18nDict: JSON.stringify(dict)
        });
        expect(chrome.i18n.getMessage('pair', ['a', 'b'])).toBe('a and b');
        expect(chrome.i18n.getMessage('named', ['cats', 42])).toBe('cats is 42');
        expect(chrome.i18n.getMessage('pair', ['only'])).toBe('only and ');
    });

    it('a local override wins over a divergent imported storage value and reconciles it', async () => {
        const store = {
            _data: { uiLanguage: 'fr' }, // imported backup says fr…
            get: (k, d) => (k in store._data ? store._data[k] : d),
            set(k, v) { store._data[k] = v; },
            ready: Promise.resolve()
        };
        const { localStorage } = evaluate(
            { vbmI18nLang: 'es', vbmI18nDict: JSON.stringify({}) }, // …but this machine picked es
            { store }
        );
        await new Promise(resolve => setTimeout(resolve, 0));
        // no fetch/reload toward fr; storage converges to the local choice
        expect(store._data.uiLanguage).toBe('es');
        expect(localStorage.getItem('vbmI18nLang')).toBe('es');
    });
});
