// chrome.i18n.getMessage doubles. The real one reads _locales/<lang>/
// messages.json and substitutes $1/$2 placeholders; the suites' old
// `key => key` echo double could not assert parameterized copy (confirm
// dialogs, toasts). makeI18n() backs the REAL en baseline so those strings
// are assertable; makeI18nEcho() keeps the key-echo behavior for suites that
// only distinguish keys.
import enMessages from '../../_locales/en/messages.json';

export const makeI18n = () => {
    const messages = enMessages;
    return (key, subs) => {
        const entry = messages[key];
        const msg = entry && entry.message;
        if (msg === undefined)
            return key; // unknown key → echo (a missing locale does the same)
        if (!subs || !subs.length)
            return msg;
        // chrome.i18n.getMessage accepts a string or an array of substitutions.
        const subList = Array.isArray(subs) ? subs : [subs];
        // en uses NAMED placeholders ($count$ etc.), each mapping to a
        // positional content ("$1") in the key's `placeholders` table.
        // Substitute by name first, then any bare $N as a defensive fallback
        // (some keys — paletteCustomDeleteConfirm — write $1 directly).
        let out = msg;
        const placeholders = entry.placeholders || {};
        for (const [name, ph] of Object.entries(placeholders)) {
            const m = ph && ph.content && ph.content.match(/^\$(\d+)$/);
            if (m && subList[Number(m[1]) - 1] !== undefined) {
                out = out.split(`$${name}$`).join(subList[Number(m[1]) - 1]);
            }
        }
        return out.replace(/\$(\d+)/g, (m, n) => subList[Number(n) - 1] ?? m);
    };
};

export const makeI18nEcho = () => key => key;
