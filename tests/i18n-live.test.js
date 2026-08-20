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

    it('exposes supportedLangs and currentLang without a cached override', () => {
        const { window } = evaluate({});
        expect(window.VBMI18N.supportedLangs).toContain('zh_CN');
        expect(window.VBMI18N.supportedLangs).toContain('en');
        expect(window.VBMI18N.currentLang()).toBe('en');
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
});
