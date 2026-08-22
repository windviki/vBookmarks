import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deferIdle, mark } from '../src/idle.js';

// idle.js reads window.location/performance at call time; tests drive both
// shapes (requestIdleCallback present / absent) and the ?perf=1 gate.

const realWindow = globalThis.window;
const realPerf = globalThis.performance;
const realRic = globalThis.requestIdleCallback;
const realCic = globalThis.cancelIdleCallback;

beforeEach(() => {
    delete globalThis.requestIdleCallback;
    delete globalThis.cancelIdleCallback;
});

afterEach(() => {
    if (realWindow === undefined)
        delete globalThis.window;
    else
        globalThis.window = realWindow;
    if (realPerf === undefined)
        delete globalThis.performance;
    else
        globalThis.performance = realPerf;
    if (realRic === undefined)
        delete globalThis.requestIdleCallback;
    else
        globalThis.requestIdleCallback = realRic;
    if (realCic === undefined)
        delete globalThis.cancelIdleCallback;
    else
        globalThis.cancelIdleCallback = realCic;
    vi.useRealTimers();
});

describe('deferIdle', () => {
    it('falls back to setTimeout 0 when requestIdleCallback is absent', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        deferIdle(fn);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(0);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('prefers requestIdleCallback with a timeout budget', () => {
        let ricFn = null;
        let cancelled = false;
        globalThis.requestIdleCallback = (fn, opts) => { ricFn = fn; return 42; };
        globalThis.cancelIdleCallback = () => { cancelled = true; };
        const fn = vi.fn();
        const cancel = deferIdle(fn, { timeout: 1234 });
        expect(ricFn).toBeTruthy();
        ricFn();
        expect(fn).toHaveBeenCalledTimes(1);
        cancel();
        expect(cancelled).toBe(true);
    });
});

describe('mark', () => {
    it('records vbm:<name> marks only with ?perf=1 in the URL', () => {
        const marks = [];
        globalThis.window = { location: { search: '?perf=1' } };
        globalThis.performance = { mark: name => marks.push(name) };
        mark('tree-generated');
        mark('store-ready');
        expect(marks).toEqual(['vbm:tree-generated', 'vbm:store-ready']);
    });

    it('is a no-op without the perf param', () => {
        const marks = [];
        globalThis.window = { location: { search: '' } };
        globalThis.performance = { mark: name => marks.push(name) };
        mark('tree-generated');
        expect(marks).toEqual([]);
    });
});
