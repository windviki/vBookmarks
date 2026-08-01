import { describe, it, expect, beforeEach } from 'vitest';
import { initPanelBehavior } from '../src/panel-behavior.js';

// src/panel-behavior.js reads the chrome global at call time; tests inject a
// recording double on globalThis before initPanelBehavior() (same recipe as
// tests/visit-stats-sw.test.js). All storage callbacks fire synchronously.

const makeChromeDouble = (opts = {}) => {
    const localData = { ...(opts.localData || {}) };
    const sessionData = { ...(opts.sessionData || {}) };
    const calls = { setPanelBehavior: [], sessionGets: 0, sessionRemoves: [] };
    const storageListeners = [];
    const read = (data, keys) => {
        const out = {};
        for (const k of Array.isArray(keys) ? keys : [keys])
            if (k in data)
                out[k] = data[k];
        return out;
    };
    return {
        calls, localData, sessionData, storageListeners,
        storage: {
            local: { get(keys, cb) { cb(read(localData, keys)); } },
            session: {
                get(keys, cb) { calls.sessionGets++; cb(read(sessionData, keys)); },
                set(obj) { Object.assign(sessionData, obj); },
                remove(keys) {
                    for (const k of Array.isArray(keys) ? keys : [keys]) {
                        calls.sessionRemoves.push(k);
                        delete sessionData[k];
                    }
                }
            },
            onChanged: { addListener(fn) { storageListeners.push(fn); } }
        },
        sidePanel: {
            setPanelBehavior(behavior) {
                calls.setPanelBehavior.push(behavior.openPanelOnActionClick);
                return opts.rejectSetPanelBehavior
                    ? Promise.reject(new Error('unsupported'))
                    : Promise.resolve();
            }
        }
    };
};

// v4 task-3 #19: a live panel = marker + fresh heartbeat (popup.js writes it
// every PANEL_HEARTBEAT_MS; PANEL_STALE_MS is the SW-side grace window).
const livePanel = () => ({ sidePanelIsOpen: true, sidePanelHeartbeat: Date.now() });

const fireStorage = (d, changes, areaName) => {
    for (const fn of d.storageListeners)
        fn(changes, areaName);
};

describe('initPanelBehavior — startup application', () => {
    beforeEach(() => { delete globalThis.chrome; });

    it('applies toggle mode at startup when the option is on', () => {
        const d = makeChromeDouble({ localData: { openInSidePanel: true } });
        globalThis.chrome = d;
        initPanelBehavior();
        expect(d.calls.setPanelBehavior).toEqual([true]);
        expect(d.calls.sessionGets).toBe(0); // session not consulted
    });

    it('applies popup mode at startup when the option is off and no panel is live', () => {
        const d = makeChromeDouble({});
        globalThis.chrome = d;
        initPanelBehavior();
        expect(d.calls.setPanelBehavior).toEqual([false]);
    });

    it('stays in toggle mode at startup when a panel outlived the worker (round-6 fix)', () => {
        const d = makeChromeDouble({ sessionData: livePanel() });
        globalThis.chrome = d;
        initPanelBehavior();
        expect(d.calls.setPanelBehavior).toEqual([true]);
    });

    // v4 task-3 #19: a bare marker with no heartbeat is residue from a panel
    // that died without pagehide (crash / session restore) — trusting it kept
    // the action in toggle mode with the option off forever.
    it('drops a heartbeat-less marker at startup: popup mode + stale keys removed', () => {
        const d = makeChromeDouble({ sessionData: { sidePanelIsOpen: true } });
        globalThis.chrome = d;
        initPanelBehavior();
        expect(d.calls.setPanelBehavior).toEqual([false]);
        expect(d.calls.sessionRemoves).toEqual(['sidePanelIsOpen', 'sidePanelHeartbeat']);
        expect(d.sessionData).toEqual({});
    });

    it('drops a marker whose heartbeat is older than the stale window', () => {
        const d = makeChromeDouble({
            sessionData: { sidePanelIsOpen: true, sidePanelHeartbeat: Date.now() - 120000 }
        });
        globalThis.chrome = d;
        initPanelBehavior();
        expect(d.calls.setPanelBehavior).toEqual([false]);
        expect(d.calls.sessionRemoves).toEqual(['sidePanelIsOpen', 'sidePanelHeartbeat']);
    });

    it('keeps a heartbeat inside the stale window (throttled timers) alive', () => {
        const d = makeChromeDouble({
            sessionData: { sidePanelIsOpen: true, sidePanelHeartbeat: Date.now() - 60000 }
        });
        globalThis.chrome = d;
        initPanelBehavior();
        expect(d.calls.setPanelBehavior).toEqual([true]);
        expect(d.calls.sessionRemoves).toEqual([]);
    });
});

describe('initPanelBehavior — reacting to changes', () => {
    beforeEach(() => { delete globalThis.chrome; });

    it('switches to toggle mode when the option turns on', () => {
        const d = makeChromeDouble({});
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { openInSidePanel: { newValue: true } }, 'local');
        expect(d.calls.setPanelBehavior).toEqual([false, true]);
    });

    it('keeps toggle mode when the option turns off while a panel is open', () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: true },
            sessionData: livePanel()
        });
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { openInSidePanel: { newValue: false } }, 'local');
        // toggle kept so the next action click closes the live panel
        expect(d.calls.setPanelBehavior).toEqual([true, true]);
    });

    it('drops to popup mode when the option turns off with no panel open', () => {
        const d = makeChromeDouble({ localData: { openInSidePanel: true } });
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { openInSidePanel: { newValue: false } }, 'local');
        expect(d.calls.setPanelBehavior).toEqual([true, false]);
    });

    it('drops to popup mode when the option turns off and the marker is stale (#19)', () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: true },
            sessionData: { sidePanelIsOpen: true } // no heartbeat — dead panel residue
        });
        globalThis.chrome = d;
        initPanelBehavior(); // startup: option on → toggle, session untouched
        expect(d.calls.setPanelBehavior).toEqual([true]);
        fireStorage(d, { openInSidePanel: { newValue: false } }, 'local');
        expect(d.calls.setPanelBehavior).toEqual([true, false]);
        expect(d.calls.sessionRemoves).toEqual(['sidePanelIsOpen', 'sidePanelHeartbeat']);
    });

    it('enters toggle mode when a panel opens with the option off', () => {
        const d = makeChromeDouble({});
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { sidePanelIsOpen: { newValue: true } }, 'session');
        expect(d.calls.setPanelBehavior).toEqual([false, true]);
    });

    it('returns to popup mode when the panel closes with the option off', () => {
        const d = makeChromeDouble({ sessionData: livePanel() });
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { sidePanelIsOpen: { newValue: false } }, 'session');
        expect(d.calls.setPanelBehavior).toEqual([true, false]);
    });

    it('ignores panel-state changes while the option is on', () => {
        const d = makeChromeDouble({ localData: { openInSidePanel: true } });
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { sidePanelIsOpen: { newValue: false } }, 'session');
        expect(d.calls.setPanelBehavior).toEqual([true]); // no extra apply
    });

    it('ignores unrelated storage changes', () => {
        const d = makeChromeDouble({});
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { popupWidth: { newValue: 350 } }, 'local');
        fireStorage(d, { someOtherKey: { newValue: 1 } }, 'session');
        fireStorage(d, { openInSidePanel: { newValue: true } }, 'sync');
        expect(d.calls.setPanelBehavior).toEqual([false]);
    });

    it('swallows setPanelBehavior rejections', () => {
        const d = makeChromeDouble({ rejectSetPanelBehavior: true });
        globalThis.chrome = d;
        expect(() => initPanelBehavior()).not.toThrow();
        expect(d.calls.setPanelBehavior).toEqual([false]);
    });
});
