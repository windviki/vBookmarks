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
        const msg = messages[key] && messages[key].message;
        if (msg === undefined)
            return key; // unknown key → echo (a missing locale does the same)
        if (!subs || !subs.length)
            return msg;
        return msg.replace(/\$(\d+)/g, (m, n) => subs[Number(n) - 1] ?? m);
    };
};

export const makeI18nEcho = () => key => key;
