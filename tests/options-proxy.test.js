import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';

// options-proxy.js is an ES module that rides the page globals store.js
// exposes (window.getSetting/setSetting/removeSetting) plus chrome.i18n /
// chrome.permissions / chrome.proxy. Each test builds a fresh sandbox, loads
// the REAL store.js (new Function, like options.test.js), re-imports
// options-proxy.js (vi.resetModules for a fresh init()), and asserts the row
// wiring + the add flow's parse → permission → controllability →
// reachability chain (all from dead-proxy.js).

const storeSource = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');

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
    remove: async keys => { for (const k of [].concat(keys)) delete data[k]; },
    clear: async () => { for (const k in data) delete data[k]; }
});

const sandbox = ({
    localData = {},
    granted = true,
    requestGranted = true,
    levelOfControl = 'controllable_by_this_extension',
    reachable = true
} = {}) => {
    const elements = {};
    const makeEl = id => {
        const classes = new Set();
        return {
            id, value: '', checked: false, innerText: '', textContent: '', disabled: false,
            _listeners: {},
            classList: {
                add: c => classes.add(c),
                toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
                contains: c => classes.has(c)
            },
            addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
            async fire(type) { for (const fn of this._listeners[type] || []) await fn(); },
            focus() {}
        };
    };
    const document = {
        body: { dataset: {} },
        getElementById: id => elements[id] || (elements[id] = makeEl(id)),
        addEventListener: () => {}
    };
    const chrome = {
        i18n: { getMessage: key => key },
        storage: {
            local: makeArea(localData),
            sync: makeArea({}),
            onChanged: { addListener: () => {} }
        },
        permissions: {
            contains(perms, cb) { cb(granted); },
            request(perms, cb) { cb(requestGranted); }
        },
        proxy: {
            settings: {
                get(details, cb) { cb({ levelOfControl }); },
                set(details, cb) { cb(); },
                clear(details, cb) { cb(); }
            }
        },
        runtime: { lastError: null }
    };
    const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
    const win = { document, chrome, addEventListener: () => {} };

    globalThis.window = win;
    globalThis.document = document;
    globalThis.chrome = chrome;
    globalThis.localStorage = localStorageStub;
    globalThis.fetch = () => (reachable ? Promise.resolve({ status: 204 }) : Promise.reject(new TypeError('x')));

    // store.js exposes window.getSetting/setSetting/removeSetting — options-
    // proxy.js calls them as bare globals, so mirror them onto globalThis.
    new Function('window', 'chrome', 'localStorage', 'document', storeSource)(win, chrome, localStorageStub, document);
    globalThis.getSetting = win.getSetting;
    globalThis.setSetting = win.setSetting;
    globalThis.removeSetting = win.removeSetting;

    return { elements, chrome, localData };
};

beforeEach(() => {
    vi.resetModules();
    for (const k of ['window', 'document', 'chrome', 'localStorage', 'fetch',
        'getSetting', 'setSetting', 'removeSetting'])
        delete globalThis[k];
});

const load = async () => {
    await import('../src/options-proxy.js');
    for (let i = 0; i < 10; i++)
        await new Promise(r => setTimeout(r, 0));
};

describe('options-proxy dead-link server row', () => {
    it('shows the saved server / "(not set)" and binds the labels + clear state', async () => {
        const sb = sandbox({ localData: { deadProxyServer: 'http://127.0.0.1:7890' } });
        await load();
        expect(sb.elements['option-dead-proxy-server'].innerText).toBe('optionDeadProxyServer');
        expect(sb.elements['dead-proxy-server-save'].innerText).toBe('deadProxyTestSave');
        expect(sb.elements['dead-proxy-server-clear'].innerText).toBe('deadProxyClear');
        expect(sb.elements['dead-proxy-server-hint'].innerText).toBe('deadProxyServerHint');
        expect(sb.elements['dead-proxy-server-value'].textContent).toBe('http://127.0.0.1:7890');
        expect(sb.elements['dead-proxy-server-clear'].disabled).toBe(false);
    });

    it('"(not set)" with the clear disabled when nothing is saved', async () => {
        const sb = sandbox({});
        await load();
        expect(sb.elements['dead-proxy-server-value'].textContent).toBe('deadProxyNone');
        expect(sb.elements['dead-proxy-server-clear'].disabled).toBe(true);
    });

    it('the clear button removes the saved server and resets the row', async () => {
        const sb = sandbox({ localData: { deadProxyServer: 'http://127.0.0.1:7890' } });
        await load();
        await sb.elements['dead-proxy-server-clear'].fire('click');
        for (let i = 0; i < 10; i++)
            await new Promise(r => setTimeout(r, 0));
        expect('deadProxyServer' in sb.localData).toBe(false);
        expect(sb.elements['dead-proxy-server-value'].textContent).toBe('deadProxyNone');
        expect(sb.elements['dead-proxy-server-clear'].disabled).toBe(true);
    });

    it('an invalid address is rejected before any permission/proxy call', async () => {
        const sb = sandbox({});
        await load();
        sb.elements['dead-proxy-server-input'].value = 'not a proxy';
        const contains = vi.spyOn(sb.chrome.permissions, 'contains');
        await sb.elements['dead-proxy-server-save'].fire('click');
        for (let i = 0; i < 10; i++)
            await new Promise(r => setTimeout(r, 0));
        expect(sb.elements['dead-proxy-server-error'].textContent).toBe('deadProxyInvalid');
        expect(contains).not.toHaveBeenCalled();
        expect('deadProxyServer' in sb.localData).toBe(false);
    });

    it('a reachable server is saved as the normalized address and clears the input', async () => {
        const sb = sandbox({});
        await load();
        sb.elements['dead-proxy-server-input'].value = '127.0.0.1:7890';
        await sb.elements['dead-proxy-server-save'].fire('click');
        for (let i = 0; i < 10; i++)
            await new Promise(r => setTimeout(r, 0));
        expect(sb.localData.deadProxyServer).toBe('http://127.0.0.1:7890');
        expect(sb.elements['dead-proxy-server-input'].value).toBe('');
        expect(sb.elements['dead-proxy-server-error'].textContent).toBe('deadProxySaved');
        expect(sb.elements['dead-proxy-server-error'].classList.contains('ok')).toBe(true);
        expect(sb.elements['dead-proxy-server-clear'].disabled).toBe(false);
    });

    it('an unreachable server is not persisted and reports the reason', async () => {
        const sb = sandbox({ reachable: false });
        await load();
        sb.elements['dead-proxy-server-input'].value = '127.0.0.1:7890';
        await sb.elements['dead-proxy-server-save'].fire('click');
        for (let i = 0; i < 10; i++)
            await new Promise(r => setTimeout(r, 0));
        expect('deadProxyServer' in sb.localData).toBe(false);
        expect(sb.elements['dead-proxy-server-error'].textContent).toBe('deadProxyUnreachable');
        expect(sb.elements['dead-proxy-server-error'].classList.contains('ok')).toBe(false);
    });

    it('a denied permission or another-extension control rejects the save', async () => {
        const denied = sandbox({ granted: false, requestGranted: false });
        await load();
        denied.elements['dead-proxy-server-input'].value = '127.0.0.1:7890';
        await denied.elements['dead-proxy-server-save'].fire('click');
        for (let i = 0; i < 10; i++)
            await new Promise(r => setTimeout(r, 0));
        expect(denied.elements['dead-proxy-server-error'].textContent).toBe('deadProxyDenied');

        vi.resetModules();
        const controlled = sandbox({ levelOfControl: 'controlled_by_other_extensions' });
        await load();
        controlled.elements['dead-proxy-server-input'].value = '127.0.0.1:7890';
        await controlled.elements['dead-proxy-server-save'].fire('click');
        for (let i = 0; i < 10; i++)
            await new Promise(r => setTimeout(r, 0));
        expect(controlled.elements['dead-proxy-server-error'].textContent).toBe('deadProxyControlled');
    });

    it('the strip-visibility checkbox reflects and toggles hideDeadProxyStrip', async () => {
        // default (no hide): checked → unchecking sets the hidden flag
        const on = sandbox({});
        await load();
        expect(on.elements['dead-proxy-strip-visible'].checked).toBe(true);
        on.elements['dead-proxy-strip-visible'].checked = false;
        await on.elements['dead-proxy-strip-visible'].fire('change');
        for (let i = 0; i < 10; i++)
            await new Promise(r => setTimeout(r, 0));
        expect(on.localData.hideDeadProxyStrip).toBe('1');

        // hidden: unchecked → checking clears the flag
        vi.resetModules();
        const off = sandbox({ localData: { hideDeadProxyStrip: '1' } });
        await load();
        expect(off.elements['dead-proxy-strip-visible'].checked).toBe(false);
        off.elements['dead-proxy-strip-visible'].checked = true;
        await off.elements['dead-proxy-strip-visible'].fire('change');
        for (let i = 0; i < 10; i++)
            await new Promise(r => setTimeout(r, 0));
        expect('hideDeadProxyStrip' in off.localData).toBe(false);
    });
});
