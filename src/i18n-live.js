/**
 * Live UI-language override (4.0.8).
 *
 * Chrome picks the extension locale once from the browser UI language and
 * offers no runtime switch. The options page and the palette /lang command
 * write `uiLanguage` (store + localStorage) and this script patches
 * `chrome.i18n.getMessage`/`getUILanguage` on the next page load so every
 * module keeps calling chrome.i18n unchanged.
 *
 * The selected locale's messages.json is cached in localStorage under
 * `vbmI18nDict` so the patch can run SYNCHRONOUSLY before any other script
 * renders labels. The language code is cached as `vbmI18nLang`.
 *
 * Loaded as a classic script right after store.js (popup/sidepanel/options);
 * exposes `window.VBMI18N = { currentLang, supportedLangs, setLang }`.
 */
(() => {
    const LANG_KEY = 'uiLanguage';
    const LANG_CACHE = 'vbmI18nLang';
    const DICT_CACHE = 'vbmI18nDict';

    // Every directory shipped under _locales/. `_` is the on-disk separator.
    const SUPPORTED_LANGS = [
        'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'en', 'es', 'et', 'fa',
        'fi', 'fr', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt',
        'lv', 'mk', 'nl', 'no', 'pl', 'pt', 'pt_BR', 'pt_PT', 'ro', 'ru',
        'sk', 'sl', 'sv', 'th', 'tr', 'uk', 'vi', 'zh', 'zh_CN', 'zh_HK',
        'zh_TW'
    ];

    const normalize = code => {
        const s = String(code || '').trim().replace(/-/g, '_');
        const found = SUPPORTED_LANGS.find(l => l.toLowerCase() === s.toLowerCase());
        return found || s;
    };
    const cacheLang = () => localStorage.getItem(LANG_CACHE) || '';
    const cacheDict = () => {
        try {
            return JSON.parse(localStorage.getItem(DICT_CACHE) || 'null');
        } catch (e) {
            return null;
        }
    };

    // Resolve the current language: explicit override first, then Chrome's
    // UI language when it is one of the shipped locales, else en.
    const currentLang = () => {
        const cached = normalize(cacheLang());
        if (cached && SUPPORTED_LANGS.includes(cached))
            return cached;
        const ui = normalize(chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : 'en');
        return SUPPORTED_LANGS.includes(ui) ? ui : 'en';
    };

    const originalGetMessage = chrome.i18n.getMessage.bind(chrome.i18n);

    // Chrome-style substitution for the messages.json shape:
    //   message: "Hello $name$"
    //   placeholders: { name: { content: "$1" } }
    // plus direct "$1" references in messages without a placeholder table.
    const substitute = (msgObj, substitutions) => {
        const text = (msgObj && msgObj.message) || '';
        if (substitutions === undefined || substitutions === null)
            return text;
        const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
        const num = n => (subs[n - 1] !== undefined ? String(subs[n - 1]) : '');
        let out = text;
        const ph = msgObj && msgObj.placeholders;
        if (ph) {
            for (const name of Object.keys(ph)) {
                const content = (ph[name] && ph[name].content) || '';
                out = out.split(`$${name}$`).join(content.replace(/\$(\d+)/g, (m, n) => num(+n)));
            }
        }
        return out.replace(/\$(\d+)/g, (m, n) => num(+n));
    };

    const patchWith = (lang, dict) => {
        if (!dict || typeof dict !== 'object')
            return false;
        chrome.i18n.getMessage = (key, substitutions) => {
            const msgObj = dict[key];
            return msgObj ? substitute(msgObj, substitutions) : originalGetMessage(key, substitutions);
        };
        chrome.i18n.getUILanguage = () => lang;
        return true;
    };

    // Apply the cached override synchronously, before other scripts render.
    const cached = cacheDict();
    const lang = cached ? normalize(cacheLang()) : '';
    if (cached && lang && SUPPORTED_LANGS.includes(lang)) {
        patchWith(lang, cached);
    }

    const fetchDict = async lang => {
        const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
        if (!res.ok)
            throw new Error(`locale fetch failed: ${lang}`);
        const data = await res.json();
        if (!data || typeof data !== 'object')
            throw new Error(`bad locale data: ${lang}`);
        return data;
    };

    window.VBMI18N = {
        currentLang,
        supportedLangs: SUPPORTED_LANGS,
        setLang: async code => {
            const lang = normalize(code);
            if (!SUPPORTED_LANGS.includes(lang))
                return false;
            try {
                const dict = await fetchDict(lang);
                localStorage.setItem(DICT_CACHE, JSON.stringify(dict));
                localStorage.setItem(LANG_CACHE, lang);
                localStorage.setItem(LANG_KEY, lang);
                if (typeof window.store !== 'undefined' && window.store.set) {
                    window.store.set(LANG_KEY, lang);
                } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
                    chrome.storage.local.set({ [LANG_KEY]: lang });
                }
                if (typeof location !== 'undefined' && typeof location.reload === 'function')
                    location.reload();
                return true;
            } catch (e) {
                return false;
            }
        }
    };
})();
