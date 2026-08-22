/**
 * Idle-deferral helper (build-and-performance-plan.md §4.4 P1-2, 4.1.0 收尾):
 * pushes non-critical startup work (remote announce fetch, favicon-cache
 * hydrate, …) off the first-render critical path. Prefers requestIdleCallback
 * with a hard timeout so the work ALWAYS runs (a popup/panel lifetime is
 * short — no infinite deferral), and falls back to a setTimeout 0 for
 * browsers/workers without the API (and for the Node test environment).
 *
 * Performance marks: pass ?perf=1 (or panel.html?perf=1) to record
 * `vbm:<name>` marks for first-paint profiling in DevTools Performance.
 * Marks are a no-op without the param — zero production overhead.
 */

const perfEnabled = () =>
    typeof window !== 'undefined' && !!window.location
    && new URLSearchParams(window.location.search).has('perf')
    && typeof performance !== 'undefined' && typeof performance.mark === 'function';

export const mark = name => {
    if (perfEnabled())
        performance.mark(`vbm:${name}`);
};

export const deferIdle = (fn, { timeout = 2000 } = {}) => {
    if (typeof requestIdleCallback === 'function') {
        const id = requestIdleCallback(() => fn(), { timeout });
        return () => {
            if (typeof cancelIdleCallback === 'function')
                cancelIdleCallback(id);
        };
    }
    const id = setTimeout(() => fn(), 0);
    return () => clearTimeout(id);
};
