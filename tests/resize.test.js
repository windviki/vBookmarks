// Popup resize + zoom wiring — drives the REAL src/resize.js (the DOM/chrome
// plumbing around the pure kernels in resize-core.js, which have their own
// tests/autoresize.test.js). Covers the drag state machine (pointerdown →
// move → up/cancel, the window-blur reset), the issue #51 userResizedHeight
// suppression, the auto-height grow/shrink wiring and the zoom layer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initResize } from '../src/resize.js';
import { makeEl, makeStoreDouble } from './helpers/dom.js';

// One initResize wiring per call: fresh DOM/store doubles, globals installed
// on globalThis (the module keeps window/document/screen/chrome as page
// globals, like dnd.js), and handles back for direct driving.
const mount = (opts = {}) => {
    const els = {};
    const docListeners = {};
    const winListeners = {};

    const body = makeEl('body');
    body.offsetHeight = opts.bodyHeight ?? 400;
    body.offsetWidth = opts.bodyWidth ?? 400;
    body.dataset = {};

    const tree = makeEl('tree');
    tree.scrollHeight = opts.treeScrollHeight ?? 500;
    tree.offsetTop = 0;
    tree.offsetParent = opts.treeHidden ? null : {};

    const views = makeEl('views');
    views.offsetTop = opts.viewsOffsetTop ?? 60;

    const resizerX = makeEl('resizer-x');
    const resizerY = makeEl('resizer-y');
    els['resizer-x'] = resizerX;
    els['resizer-y'] = resizerY;

    const screenStub = { height: 1080, availWidth: 1920 };
    const win = {
        screenX: opts.screenX ?? 200,
        screenY: opts.screenY ?? 100,
        innerWidth: opts.innerWidth ?? 400,
        screen: screenStub,
        addEventListener: (type, fn) => { (winListeners[type] = winListeners[type] || []).push(fn); }
    };
    const doc = {
        documentElement: makeEl('html'),
        getElementById: id => els[id] || null,
        addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); }
    };

    const getZoom = vi.fn(cb => cb(opts.zoomFactor ?? 1));
    const store = { ...makeStoreDouble(opts.storeData || {}), flush: vi.fn() };
    const clearMenu = vi.fn();
    const adaptTooltips = vi.fn();
    const isDragging = vi.fn(() => false);
    const search = { isActive: vi.fn(() => opts.searchActive ?? false) };
    const treeView = { adaptBookmarkTooltips: adaptTooltips };

    globalThis.window = win;
    globalThis.document = doc;
    globalThis.screen = screenStub;
    globalThis.chrome = { tabs: { getZoom } };

    const api = initResize({
        store,
        body,
        tree,
        views,
        isPanel: opts.isPanel ?? false,
        rtl: opts.rtl ?? false,
        search,
        clearMenu,
        treeView,
        isDragging
    });

    const fireDoc = (type, ev = {}) => {
        ev.type = type;
        ev.preventDefault = ev.preventDefault || vi.fn();
        ev.stopPropagation = ev.stopPropagation || vi.fn();
        (docListeners[type] || []).forEach(fn => fn(ev));
        return ev;
    };
    const fireWin = (type, ev = {}) => {
        ev.type = type;
        ev.preventDefault = ev.preventDefault || vi.fn();
        ev.stopPropagation = ev.stopPropagation || vi.fn();
        (winListeners[type] || []).forEach(fn => fn(ev));
        return ev;
    };
    const pointerdown = (el, props) =>
        el.fire('pointerdown', { target: el, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...props });
    return { api, body, tree, resizerX, resizerY, store, getZoom, clearMenu,
        adaptTooltips, isDragging, search, win, fireDoc, fireWin, pointerdown };
};

afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.screen;
    delete globalThis.chrome;
});

describe('auto-height (resetHeight wiring)', () => {
    it('grows to the clamped content height on the initial load and persists it', () => {
        // contentH = 800 + 60 + 16 = 876; maxH = min(599, 930, 600) = 599
        const m = mount({ treeScrollHeight: 800 });
        expect(m.body.style.height).toBe('599px');
        expect(m.body.style.transitionDuration).toBe('.3s');
        expect(m.store.map.get('popupHeight')).toBe(599);
    });

    it('shrinks on the initial load (allowShrink) but never on tree interaction', () => {
        // contentH = 176, currentH 500: clamped 300 < 350 → shrink on load
        const shrunk = mount({ treeScrollHeight: 100, bodyHeight: 500 });
        expect(shrunk.body.style.height).toBe('300px');
        expect(shrunk.body.style.transitionDuration).toBe('.15s');

        // a fresh popup where search was active at boot (initial call skipped):
        // the first tree click measures but stays — interaction never shrinks
        const m = mount({ treeScrollHeight: 100, bodyHeight: 500, searchActive: true });
        expect(m.body.style.height).toBeUndefined();
        expect(m.getZoom).not.toHaveBeenCalled();
        m.tree.fire('click', {});
        expect(m.getZoom).toHaveBeenCalledTimes(1);
        expect(m.body.style.height).toBeUndefined();
        expect(m.store.map.has('popupHeight')).toBe(false);
    });

    it('grows on tree click after boot', () => {
        const m = mount({ treeScrollHeight: 800, bodyHeight: 400, searchActive: true });
        m.tree.fire('keyup', {});
        expect(m.body.style.height).toBe('599px');
    });

    it('stands down in panel mode / with autoResizePopup off / while the tree view is hidden', () => {
        const panel = mount({ treeScrollHeight: 800, isPanel: true });
        expect(panel.getZoom).not.toHaveBeenCalled();

        const off = mount({ treeScrollHeight: 800, storeData: { autoResizePopup: 'false' } });
        expect(off.getZoom).not.toHaveBeenCalled();

        const hidden = mount({ treeScrollHeight: 800, treeHidden: true });
        expect(hidden.getZoom).not.toHaveBeenCalled();
        expect(hidden.body.style.height).toBeUndefined();
    });

    it('skips the initial call when search is active at boot', () => {
        const m = mount({ treeScrollHeight: 800, searchActive: true });
        expect(m.getZoom).not.toHaveBeenCalled();
    });

    it('flows zoomFactor and screen room into the kernels (minH/maxH inputs)', () => {
        // browser zoom 1.5: maxH = min(399, 930, 600) = 399 (the 600/zf-1 cap)
        const zoomed = mount({ treeScrollHeight: 800, bodyHeight: 300, zoomFactor: 1.5 });
        expect(zoomed.body.style.height).toBe('399px');

        // window near the screen bottom: maxH = min(599, 1080-640-50, 600) = 390
        const low = mount({ treeScrollHeight: 800, bodyHeight: 300, screenY: 640 });
        expect(low.body.style.height).toBe('390px');
    });
});

describe('height drag (resizer-y)', () => {
    it('drags through the async getZoom branch first, then the sync path, and persists', () => {
        const m = mount({ bodyHeight: 400 });
        m.pointerdown(m.resizerY, { screenY: 500 });

        // first move: currentMaxHeight unknown → async branch (flush + write)
        const first = m.fireDoc('pointermove', { screenY: 550 });
        expect(first.preventDefault).toHaveBeenCalled();
        expect(m.body.style.height).toBe('450px');
        expect(m.store.map.get('popupHeight')).toBe(450);
        expect(m.store.flush).toHaveBeenCalledTimes(1);
        expect(m.clearMenu).toHaveBeenCalled();

        // second move: sync path, no extra flush
        m.fireDoc('pointermove', { screenY: 600 });
        expect(m.body.style.height).toBe('500px');
        expect(m.store.flush).toHaveBeenCalledTimes(1);

        m.fireDoc('pointerup', { screenY: 600 });
        expect(m.store.flush).toHaveBeenCalledTimes(2);
        expect(m.adaptTooltips).toHaveBeenCalledTimes(1);
    });

    it('clamps the dragged height into [maxHeight/2, maxHeight]', () => {
        const m = mount({ bodyHeight: 400 });
        m.pointerdown(m.resizerY, { screenY: 500 });
        // way past the 599 ceiling → 599
        m.fireDoc('pointermove', { screenY: 2000 });
        expect(m.body.style.height).toBe('599px');
        // way below the 299.5 floor → 299.5
        m.fireDoc('pointermove', { screenY: -2000 });
        expect(m.body.style.height).toBe('299.5px');
    });

    it('issue #51: any vertical drag suspends auto-height for the session', () => {
        const m = mount({ treeScrollHeight: 800, bodyHeight: 400, searchActive: true });
        m.pointerdown(m.resizerY, { screenY: 500 });
        m.fireDoc('pointermove', { screenY: 550 }); // height 450, flag set
        expect(m.getZoom).toHaveBeenCalledTimes(1); // the drag's own async branch

        // content that would grow to 599: suppressed
        m.tree.fire('click', {});
        expect(m.getZoom).toHaveBeenCalledTimes(1);
        expect(m.body.style.height).toBe('450px');
        expect(m.store.map.get('popupHeight')).toBe(450);
    });

    it('a drag ended while getZoom is in flight leaves no stale ceiling behind', () => {
        // searchActive skips the startup auto-height measure, so every getZoom
        // call below belongs to a drag branch.
        const m = mount({ bodyHeight: 400, searchActive: true });
        // Defer the zoom answers until the test releases them.
        const pending = [];
        m.getZoom.mockImplementation(cb => { pending.push(cb); });
        m.pointerdown(m.resizerY, { screenY: 500 });
        m.fireDoc('pointermove', { screenY: 550 }); // async branch: answer pending
        m.fireDoc('pointerup', { screenY: 560 });   // drag ends before it arrives
        expect(m.store.flush).toHaveBeenCalled();   // drag-end bookkeeping ran
        // The late answers must not write after the drag nor set the ceiling…
        const heightAtEnd = m.body.style.height;
        pending.forEach(cb => cb(1));
        expect(m.body.style.height).toBe(heightAtEnd);
        // …so the next drag RESOLVES the ceiling fresh instead of reusing a
        // stale one (a leaked currentMaxHeight would take the sync branch and
        // never call getZoom).
        m.pointerdown(m.resizerY, { screenY: 500 });
        m.fireDoc('pointermove', { screenY: 550 });
        expect(m.getZoom).toHaveBeenCalledTimes(3); // 2 dropped + 1 fresh
    });
});

describe('width drag (resizer-x)', () => {
    const dragStart = m => m.pointerdown(m.resizerX, { screenX: 600 });

    it('writes the target to the ROOT immediately and pins body to the achieved viewport (chase)', () => {
        // mount viewport 400; drag target 500 — the bubble is still at 400,
        // so the body must keep filling the ACHIEVED viewport, not the target
        const m = mount({ bodyWidth: 400 });
        dragStart(m);
        m.fireDoc('pointermove', { screenX: 500 });
        expect(globalThis.document.documentElement.style.width).toBe('500px');
        expect(m.body.style.width).toBe('400px');
        expect(m.store.map.get('popupWidth')).toBe(500); // the TARGET persists
        expect(m.clearMenu).toHaveBeenCalled();
    });

    it('each viewport catch-up step re-pins the body, and the exact target lands at rest', () => {
        const m = mount({ bodyWidth: 400 });
        dragStart(m);
        m.fireDoc('pointermove', { screenX: 500 }); // target 500, viewport 400
        m.win.innerWidth = 460;                      // bubble halfway
        m.fireWin('resize', {});
        expect(m.body.style.width).toBe('460px');
        m.win.innerWidth = 500;                      // caught up
        m.fireWin('resize', {});
        expect(m.body.style.width).toBe('500px');
        // chase complete: a later stray resize must not resurrect it
        m.win.innerWidth = 502;
        m.fireWin('resize', {});
        expect(m.body.style.width).toBe('500px');
    });

    it('the chase survives pointerup through the bubble\'s tail frames', () => {
        const m = mount({ bodyWidth: 400 });
        dragStart(m);
        m.fireDoc('pointermove', { screenX: 500 });
        m.fireDoc('pointerup', { screenX: 500 });
        expect(m.body.style.width).toBe('400px'); // still glued mid-chase
        m.win.innerWidth = 500;
        m.fireWin('resize', {});
        expect(m.body.style.width).toBe('500px'); // settles with the bubble
        expect(m.store.flush).toHaveBeenCalled();
        expect(m.adaptTooltips).toHaveBeenCalledTimes(1);
    });

    it('drag end with the viewport already caught up settles the body now', () => {
        const m = mount({ bodyWidth: 400, innerWidth: 500 });
        dragStart(m);
        m.fireDoc('pointermove', { screenX: 500 });
        m.fireDoc('pointerup', { screenX: 500 });
        expect(m.body.style.width).toBe('500px');
    });

    it('mirrors the delta in rtl', () => {
        const m = mount({ bodyWidth: 400, rtl: true, innerWidth: 500 });
        dragStart(m);
        m.fireDoc('pointermove', { screenX: 700 });
        expect(globalThis.document.documentElement.style.width).toBe('500px');
        expect(m.body.style.width).toBe('500px');
    });

    it('clamps into [320, maxResizeWidth]', () => {
        const m = mount({ bodyWidth: 400, innerWidth: 400 });
        dragStart(m);
        // maxResizeWidth frozen at pointerdown: min(640, 400 + 1296) = 640
        m.fireDoc('pointermove', { screenX: -800 });
        expect(globalThis.document.documentElement.style.width).toBe('640px');
        m.fireDoc('pointermove', { screenX: 900 });
        expect(globalThis.document.documentElement.style.width).toBe('320px');
    });

    it('window blur resets the drag state (a stray move cannot resize)', () => {
        const m = mount({ bodyWidth: 400 });
        dragStart(m);
        m.fireDoc('pointermove', { screenX: 500 });
        m.fireWin('blur', {});
        expect(m.store.flush).toHaveBeenCalled();
        expect(m.adaptTooltips).toHaveBeenCalled();

        const stray = m.fireDoc('pointermove', { screenX: 100 });
        expect(stray.preventDefault).not.toHaveBeenCalled();
        expect(globalThis.document.documentElement.style.width).toBe('500px'); // untouched
        expect(m.store.map.get('popupWidth')).toBe(500);
    });

    it('pointercancel ends the drag like pointerup', () => {
        const m = mount({ bodyWidth: 400 });
        dragStart(m);
        m.fireDoc('pointermove', { screenX: 500 });
        m.fireDoc('pointercancel', { screenX: 500 });
        expect(m.store.flush).toHaveBeenCalled();
        const stray = m.fireDoc('pointermove', { screenX: 100 });
        expect(stray.preventDefault).not.toHaveBeenCalled();
    });
});

describe('zoom', () => {
    it('applies the persisted zoom at init', () => {
        const m = mount({ storeData: { zoom: '120' } });
        expect(m.body.dataset.zoom).toBe('120');
    });

    it('steps ±10 and resets to default on 0', () => {
        const m = mount({});
        m.api.zoom(1);
        expect(m.body.dataset.zoom).toBe('110');
        expect(m.store.map.get('zoom')).toBe(110);
        m.api.zoom(1);
        expect(m.body.dataset.zoom).toBe('120');

        m.api.zoom(0);
        expect(m.body.dataset.zoom).toBeUndefined();
        expect(m.store.map.has('zoom')).toBe(false);
    });

    it('clamps at 90/150 and refuses while a bookmark drag is in progress', () => {
        const m = mount({});
        m.api.zoom(1); // 110
        m.isDragging.mockReturnValue(true);
        m.api.zoom(1);
        expect(m.body.dataset.zoom).toBe('110'); // unchanged
        m.isDragging.mockReturnValue(false);

        m.body.dataset.zoom = '145';
        m.api.zoom(1);
        expect(m.body.dataset.zoom).toBe('150');
        m.api.zoom(1);
        expect(m.body.dataset.zoom).toBe('150'); // clamped

        m.body.dataset.zoom = '95';
        m.api.zoom(-1);
        expect(m.body.dataset.zoom).toBe('90');
        m.api.zoom(-1);
        expect(m.body.dataset.zoom).toBe('90'); // clamped
    });

    it('Ctrl/Cmd+wheel zooms and cancels the gesture (positive deltaY = step up here)', () => {
        const m = mount({});
        const plain = m.fireDoc('wheel', { deltaY: -100 });
        expect(plain.preventDefault).not.toHaveBeenCalled(); // no ctrl/cmd → native
        expect(m.body.dataset.zoom).toBeUndefined();

        const zoomIn = m.fireDoc('wheel', { ctrlKey: true, deltaY: 100 });
        expect(zoomIn.preventDefault).toHaveBeenCalled();
        expect(m.body.dataset.zoom).toBe('110');

        const zoomOut = m.fireDoc('wheel', { metaKey: true, deltaY: -100 });
        expect(m.body.dataset.zoom).toBe('100');
    });

    it('Ctrl/Cmd +/-/0 keys drive the same zoom', () => {
        const m = mount({});
        m.fireDoc('keydown', { ctrlKey: true, key: '=' });
        expect(m.body.dataset.zoom).toBe('110');
        m.fireDoc('keydown', { metaKey: true, key: '+' });
        expect(m.body.dataset.zoom).toBe('120');
        m.fireDoc('keydown', { ctrlKey: true, key: '-' });
        expect(m.body.dataset.zoom).toBe('110');
        const reset = m.fireDoc('keydown', { ctrlKey: true, key: '0' });
        expect(reset.preventDefault).toHaveBeenCalled();
        expect(m.body.dataset.zoom).toBeUndefined();
        expect(m.store.map.has('zoom')).toBe(false);
    });

    it('re-measures the height after a zoom change', () => {
        const m = mount({ treeScrollHeight: 800, searchActive: true });
        expect(m.getZoom).not.toHaveBeenCalled();
        m.api.zoom(1);
        // the zoom step itself re-runs resetHeight → the grow fires
        expect(m.getZoom).toHaveBeenCalled();
        expect(m.body.style.height).toBe('599px');
    });
});
