import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// popup.js is a classic script (no exports) evaluated in a sandbox with
// stubbed window/store/getSetting/setSetting — the same recipe as
// tests/store.test.js. The IIFE reads window.document/window.chrome off the
// passed window; setInterval/clearInterval arrive as parameters so the panel
// heartbeat can be inspected without real timers. Assertions target the
// recorded storage/session/sidePanel calls — nothing is copied from the
// source under test.
const popupSource = fs.readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8');

const flushMicrotasks = async (rounds = 10) => {
    for (let i = 0; i < rounds; i++)
        await Promise.resolve();
};

const createSandbox = ({
    search = '',
    panelClass = false,
    storeData = {},
    localData = {},
    settings = {}
} = {}) => {
    const classes = new Set();
    const body = {
        dataset: {},
        style: {},
        classList: {
            add: c => classes.add(c),
            remove: c => classes.delete(c),
            contains: c => classes.has(c)
        }
    };
    if (panelClass)
        body.classList.add('panel-mode');

    const docListeners = {};
    const document = {
        body,
        addEventListener(type, fn) {
            (docListeners[type] = docListeners[type] || []).push(fn);
        }
    };

    const sessionData = {};
    const sessionSetCalls = [];
    const panelBehaviorCalls = [];
    const chrome = {
        i18n: { getMessage: key => key },
        storage: {
            session: {
                set: async obj => {
                    sessionSetCalls.push(obj);
                    Object.assign(sessionData, obj);
                }
            },
            local: {
                // Dual style: popup.js's pagehide handler passes a callback.
                get: (key, cb) => {
                    const out = typeof key === 'string' ? { [key]: localData[key] } : { ...localData };
                    if (cb) {
                        cb(out);
                        return undefined;
                    }
                    return Promise.resolve(out);
                }
            }
        },
        sidePanel: {
            setPanelBehavior: async behavior => {
                panelBehaviorCalls.push(behavior);
            }
        }
    };

    const winListeners = {};
    const window = {
        document,
        chrome,
        location: { search },
        addEventListener(type, fn) {
            (winListeners[type] = winListeners[type] || []).push(fn);
        }
    };

    const store = {
        get: (key, def) => (key in storeData ? storeData[key] : def),
        ready: Promise.resolve()
    };
    const settingsData = { ...settings };
    const getSetting = async (key, def) => (key in settingsData ? settingsData[key] : def);
    const setSettingCalls = [];
    const setSetting = async (key, value) => {
        setSettingCalls.push([key, value]);
        settingsData[key] = value;
    };

    const intervals = [];
    const clearedIntervals = [];
    const setIntervalStub = (fn, ms) => {
        intervals.push({ fn, ms });
        return intervals.length;
    };
    const clearIntervalStub = id => clearedIntervals.push(id);

    new Function(
        'window', 'store', 'getSetting', 'setSetting', 'setInterval', 'clearInterval',
        popupSource
    )(window, store, getSetting, setSetting, setIntervalStub, clearIntervalStub);

    const fireWin = (type, ev = {}) => {
        for (const fn of winListeners[type] || [])
            fn(ev);
    };
    const fireDoc = type => {
        for (const fn of docListeners[type] || [])
            fn();
    };

    return {
        window, document, body, chrome, store,
        sessionData, sessionSetCalls, panelBehaviorCalls, setSettingCalls,
        intervals, clearedIntervals, settingsData,
        fireWin, fireDoc
    };
};

describe('theme bootstrap', () => {
    it('applies the stored theme before first paint, then refines after store.ready', async () => {
        const sb = createSandbox({ storeData: { theme: 'dark' } });
        expect(sb.body.dataset.theme).toBe('dark'); // synchronous, pre-paint
        await flushMicrotasks();
        expect(sb.body.dataset.theme).toBe('dark');
    });

    it('falls back to the auto theme', () => {
        const sb = createSandbox({});
        expect(sb.body.dataset.theme).toBe('auto');
    });
});

describe('panel mode (sidepanel.html / ?panel=1)', () => {
    it('detects panel mode from the query and marks the panel open with a heartbeat', () => {
        const sb = createSandbox({ search: '?panel=1' });
        expect(sb.body.classList.contains('panel-mode')).toBe(true);
        expect(sb.sessionData.sidePanelIsOpen).toBe(true);
        expect(typeof sb.sessionData.sidePanelHeartbeat).toBe('number');
        expect(sb.intervals).toHaveLength(1);
        expect(sb.intervals[0].ms).toBe(20000); // PANEL_HEARTBEAT_MS
    });

    it('detects panel mode from the body class as well', () => {
        const sb = createSandbox({ panelClass: true });
        expect(sb.sessionData.sidePanelIsOpen).toBe(true);
    });

    it('pagehide stops the heartbeat, flags the panel closed and resets the action behavior when the option is off', async () => {
        const sb = createSandbox({ search: '?panel=1', localData: { openInSidePanel: false } });
        sb.fireWin('pagehide');
        await flushMicrotasks();
        expect(sb.clearedIntervals).toEqual([1]);
        expect(sb.sessionData.sidePanelIsOpen).toBe(false);
        expect(sb.panelBehaviorCalls).toEqual([{ openPanelOnActionClick: false }]);
    });

    it('pagehide keeps the toggle behavior when the side-panel option is on', async () => {
        const sb = createSandbox({ search: '?panel=1', localData: { openInSidePanel: true } });
        sb.fireWin('pagehide');
        await flushMicrotasks();
        expect(sb.sessionData.sidePanelIsOpen).toBe(false);
        expect(sb.panelBehaviorCalls).toEqual([]); // background stays in toggle mode
    });

    it('pageshow from the bfcache (persisted) re-marks the panel open', () => {
        const sb = createSandbox({ search: '?panel=1' });
        const callsBefore = sb.sessionSetCalls.length;
        sb.fireWin('pageshow', { persisted: false });
        expect(sb.sessionSetCalls.length).toBe(callsBefore); // ordinary nav: no-op
        sb.fireWin('pageshow', { persisted: true });
        expect(sb.sessionSetCalls.length).toBe(callsBefore + 1);
        expect(sb.sessionSetCalls.at(-1).sidePanelIsOpen).toBe(true);
    });
});

describe('plain popup mode', () => {
    it('writes no panel markers and restores the saved size on DOMContentLoaded', async () => {
        const sb = createSandbox({ settings: { popupHeight: '420', popupWidth: '350' } });
        expect(sb.sessionSetCalls).toEqual([]);
        expect(sb.intervals).toEqual([]);
        sb.fireDoc('DOMContentLoaded');
        await flushMicrotasks();
        expect(sb.body.style.height).toBe('420px');
        expect(sb.body.style.width).toBe('350px');
    });

    it('clamps a stored height above 600 and persists the clamped value', async () => {
        const sb = createSandbox({ settings: { popupHeight: '800' } });
        sb.fireDoc('DOMContentLoaded');
        await flushMicrotasks();
        expect(sb.body.style.height).toBe('600px');
        expect(sb.setSettingCalls).toEqual([['popupHeight', 600]]);
    });
});
