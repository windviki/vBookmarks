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
    const dbl = {
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
                    return Promise.resolve();
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
    // Final polish: chrome.runtime.getContexts (Chrome 116+) is the primary
    // panel-liveness probe. opts.panelContexts: undefined = API absent (the
    // heartbeat fallback runs), an array = live SIDE_PANEL contexts, the
    // string 'reject' = the promise rejects.
    if (opts.panelContexts !== undefined || opts.withConnect) {
        dbl.runtime = dbl.runtime || {};
        if (opts.panelContexts !== undefined) {
            dbl.runtime.getContexts = () => opts.panelContexts === 'reject'
                ? Promise.reject(new Error('no contexts'))
                : Promise.resolve(opts.panelContexts);
        }
    }
    // 4.0.2: the panel page holds a runtime port; its disconnect is the
    // event-driven "panel died" signal that restores popup mode (the reliable
    // replacement for the non-existent sidePanel.onClosed).
    if (opts.withConnect) {
        const connectListeners = [];
        dbl.connectListeners = connectListeners;
        dbl.runtime.onConnect = { addListener(fn) { connectListeners.push(fn); } };
        dbl.firePanelDisconnect = () => {
            const listeners = dbl._panelDisconnect || [];
            listeners.forEach(fn => fn());
        };
        dbl.runtime.__connect = () => {
            const port = { name: 'vbm-panel', _disc: [] };
            port.onDisconnect = { addListener(fn) { port._disc.push(fn); } };
            (dbl._panelDisconnect = dbl._panelDisconnect || []).push(() => port._disc.forEach(fn => fn()));
            connectListeners.forEach(fn => fn(port));
        };
        dbl.connectPanel = () => dbl.runtime.__connect();
    }
    // Popup-restore signals: Chrome 142+ sidePanel.onClosed and the gated
    // chrome.alarms liveness poll. opts.withClosedEvent opts into onClosed;
    // opts.withAlarms opts into the alarms API.
    if (opts.withClosedEvent) {
        const closeListeners = [];
        dbl.sidePanel.onClosed = { addListener(fn) { closeListeners.push(fn); } };
        dbl.firePanelClosed = () => closeListeners.forEach(fn => fn());
    }
    if (opts.withAlarms) {
        dbl.alarms = {
            creates: [],
            clears: [],
            alarmListeners: [],
            create(name, spec) { this.creates.push([name, spec]); return Promise.resolve(); },
            clear(name) { this.clears.push(name); return Promise.resolve(true); }
        };
        // arrow binding keeps `this` on dbl.alarms, not the onAlarm object
        dbl.alarms.onAlarm = { addListener: fn => dbl.alarms.alarmListeners.push(fn) };
        dbl.fireAlarm = () => dbl.alarms.alarmListeners.forEach(fn => fn({ name: 'vbm-panel-liveness' }));
    }
    return dbl;
};

// getContexts answers asynchronously — flush the microtask queue.
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// v4 task-3 #19: a live panel = marker + fresh heartbeat (popup.js writes it
// every PANEL_HEARTBEAT_MS; PANEL_STALE_MS is the SW-side grace window).
const livePanel = () => ({ sidePanelIsOpen: true, sidePanelHeartbeat: Date.now() });

const fireStorage = (d, changes, areaName) => {
    // A real setSetting writes chrome.storage.local BEFORE the onChanged event
    // fires — mirror that so callbacks re-reading the option see the new value.
    if (areaName === 'local' && 'openInSidePanel' in changes)
        d.localData.openInSidePanel = changes.openInSidePanel.newValue;
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

describe('initPanelBehavior — runtime.getContexts liveness (Chrome 116+)', () => {
    beforeEach(() => { delete globalThis.chrome; });

    // The reported bug: option turned OFF right after the panel was closed —
    // pagehide never fired, so the marker + fresh heartbeat still claim
    // "live" and the old code re-derived toggle mode (the action kept
    // opening the panel). getContexts lists only LIVE panels: popup mode.
    it('a dead panel with a fresh-heartbeat marker derives popup mode at startup', async () => {
        const d = makeChromeDouble({ sessionData: livePanel(), panelContexts: [] });
        globalThis.chrome = d;
        initPanelBehavior();
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([false]);
        expect(d.calls.sessionGets).toBe(0); // the session is never consulted
    });

    it('option OFF with a dead panel (stale marker) drops to popup mode, not toggle', async () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: true },
            sessionData: livePanel(), // residue — the panel is actually gone
            panelContexts: []
        });
        globalThis.chrome = d;
        initPanelBehavior(); // option on → toggle
        fireStorage(d, { openInSidePanel: { newValue: false } }, 'local');
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true, false]);
    });

    it('a live panel context keeps toggle mode when the option turns off', async () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: true },
            panelContexts: [{ contextType: 'SIDE_PANEL', documentId: 'x' }]
        });
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { openInSidePanel: { newValue: false } }, 'local');
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true, true]);
    });

    it('a rejecting getContexts falls back to "not live" (popup mode)', async () => {
        const d = makeChromeDouble({ sessionData: livePanel(), panelContexts: 'reject' });
        globalThis.chrome = d;
        initPanelBehavior();
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([false]);
    });
});

describe('initPanelBehavior — popup restore after a toggle-close (final-polish gap)', () => {
    beforeEach(() => { delete globalThis.chrome; });

    // The reported bug: option off while the panel is open keeps toggle mode;
    // the action-toggle close skips pagehide, so nothing told the SW the panel
    // died — setPanelBehavior(true) stayed and every click re-opened the panel.

    it('Chrome 142+ sidePanel.onClosed restores popup mode when the option is off', async () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: true }, // option was on, then turned off below
            sessionData: livePanel(),
            panelContexts: [{ contextType: 'SIDE_PANEL', documentId: 'x' }],
            withClosedEvent: true
        });
        globalThis.chrome = d;
        initPanelBehavior(); // startup: option on → toggle
        fireStorage(d, { openInSidePanel: { newValue: false } }, 'local'); // option off, panel live
        await flush(); // getContexts answers live → toggle kept
        expect(d.calls.setPanelBehavior).toEqual([true, true]); // toggle kept (panel open)
        // the action-toggle closes the panel → getContexts now lists nothing,
        // then onClosed fires
        d.runtime.getContexts = () => Promise.resolve([]);
        d.firePanelClosed();
        await flush(); // the recovery re-reads the option + probes liveness
        expect(d.calls.setPanelBehavior).toEqual([true, true, false]); // popup restored
        expect(d.calls.sessionRemoves).toEqual(['sidePanelIsOpen', 'sidePanelHeartbeat']);
    });

    it('sidePanel.onClosed does nothing while the option is on (user governs)', () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: true },
            sessionData: livePanel(),
            withClosedEvent: true
        });
        globalThis.chrome = d;
        initPanelBehavior();
        d.firePanelClosed();
        expect(d.calls.setPanelBehavior).toEqual([true]); // unchanged
    });

    it('alarms poll restores popup mode once the panel dies (Chrome 114–141 fallback)', async () => {
        // Option off, panel live at the off-transition → poll armed. The panel
        // dies without pagehide; the next poll tick sees no live panel and
        // drops to popup mode, cancelling the poll.
        const d = makeChromeDouble({
            localData: { openInSidePanel: true },
            sessionData: livePanel(),
            panelContexts: [{ contextType: 'SIDE_PANEL', documentId: 'x' }],
            withAlarms: true
        });
        globalThis.chrome = d;
        initPanelBehavior(); // startup: option on → toggle
        fireStorage(d, { openInSidePanel: { newValue: false } }, 'local');
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true, true]); // toggle kept, live
        expect(d.alarms.creates.length).toBe(1); // poll armed in the ambiguous state
        // panel dies: now getContexts answers empty on the next poll tick
        d.runtime.getContexts = () => Promise.resolve([]);
        d.fireAlarm();
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true, true, false]); // popup restored
        expect(d.alarms.clears).toContain('vbm-panel-liveness'); // poll self-cancelled
    });

    it('alarms poll stays armed while the panel stays live, then stops when option is on', async () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: true },
            sessionData: livePanel(),
            panelContexts: [{ contextType: 'SIDE_PANEL', documentId: 'x' }],
            withAlarms: true
        });
        globalThis.chrome = d;
        initPanelBehavior();
        fireStorage(d, { openInSidePanel: { newValue: false } }, 'local');
        await flush();
        d.fireAlarm();
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true, true]); // still live → still toggle
        // re-enabling the option cancels the ambiguity watch
        fireStorage(d, { openInSidePanel: { newValue: true } }, 'local');
        expect(d.alarms.clears).toContain('vbm-panel-liveness');
    });

    it('no poll is armed when the option is off and no panel is live', async () => {
        const d = makeChromeDouble({ panelContexts: [], withAlarms: true });
        globalThis.chrome = d;
        initPanelBehavior();
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([false]);
        expect(d.alarms.creates).toEqual([]); // nothing ambiguous to watch
    });
});

describe('initPanelBehavior — vbm-panel port disconnect (4.0.2 one-time toggle)', () => {
    // The panel page holds a runtime port; Chrome destroying the panel (an
    // action-toggle close — no guaranteed pagehide, and the page's own async
    // reset can be dropped mid-teardown) disconnects it. With the option OFF,
    // that disconnect must immediately restore popup mode so the next icon
    // click opens the popup instead of re-toggling the panel (the reported bug:
    // "选项未开时,点图标只是开关侧边栏,再也回不到 popup").
    beforeEach(() => { delete globalThis.chrome; });

    it('a panel-port disconnect with the option off restores popup mode + clears the marker', async () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: false },
            sessionData: livePanel(),
            panelContexts: [{ contextType: 'SIDE_PANEL', documentId: 'x' }],
            withAlarms: true,
            withConnect: true
        });
        globalThis.chrome = d;
        initPanelBehavior();
        await flush();
        // panel live → toggle mode
        expect(d.calls.setPanelBehavior).toEqual([true]);
        d.connectPanel();
        // the panel dies → port disconnects
        d.firePanelDisconnect();
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true, false]); // popup restored
        expect(d.sessionData.sidePanelIsOpen).toBeUndefined(); // stale marker cleared
        expect(d.calls.sessionRemoves).toContain('sidePanelIsOpen');
        expect(d.alarms.clears).toContain('vbm-panel-liveness'); // nothing left to watch
    });

    it('a panel-port disconnect leaves toggle mode alone when the option is ON', async () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: true },
            panelContexts: [{ contextType: 'SIDE_PANEL', documentId: 'x' }],
            withConnect: true
        });
        globalThis.chrome = d;
        initPanelBehavior();
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true]); // the option governs
        d.connectPanel();
        d.firePanelDisconnect();
        await flush();
        // the option stays ON → no flip, no marker clearing
        expect(d.calls.setPanelBehavior).toEqual([true]);
        expect(d.calls.sessionRemoves).toEqual([]);
    });

    it('the port listener ignores non-panel ports', async () => {
        const d = makeChromeDouble({
            localData: { openInSidePanel: false },
            sessionData: livePanel(),
            panelContexts: [{ contextType: 'SIDE_PANEL', documentId: 'x' }],
            withConnect: true
        });
        globalThis.chrome = d;
        initPanelBehavior();
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true]);
        // a port with a different name connects and disconnects — ignored
        d.connectListeners.forEach(fn => fn({ name: 'other', onDisconnect: { addListener() {} } }));
        await flush();
        expect(d.calls.setPanelBehavior).toEqual([true]); // unchanged
    });
});
