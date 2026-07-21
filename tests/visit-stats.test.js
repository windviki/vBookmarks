/**
 * visit-stats.test.js — tests for src/visit-stats.js
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Minimal store mock
function mockStore(initial = {}) {
    const data = { ...initial };
    return {
        get(key, def) { return key in data ? data[key] : def; },
        set(key, val) { data[key] = val; },
        remove(key) { delete data[key]; }
    };
}

// We must load the module after setting up the mock globals
// Since visit-stats is an ESM module with `window` access, test via direct import
import { initVisitStats } from '../src/visit-stats.js';

describe('initVisitStats', () => {
    let store, vs;

    beforeEach(() => {
        store = mockStore();
        vs = initVisitStats({ store });
    });

    it('returns an empty stats object initially', () => {
        expect(vs.getStats()).toEqual({});
    });

    it('recordVisit increments the count for a bookmark id', () => {
        vs.recordVisit('abc');
        vs.recordVisit('abc');
        vs.recordVisit('xyz');
        const stats = vs.getStats();
        expect(stats.abc.c).toBe(2);
        expect(stats.xyz.c).toBe(1);
    });

    it('recordVisit sets a timestamp on each visit', () => {
        vs.recordVisit('abc');
        expect(vs.getStats().abc.t).toBeGreaterThan(0);
    });

    it('does not record when statsEnabled is "false"', () => {
        store.set('statsEnabled', 'false');
        vs.recordVisit('abc');
        expect(vs.getStats()).toEqual({});
    });

    it('clearStats resets everything to empty', () => {
        vs.recordVisit('a');
        vs.recordVisit('b');
        vs.clearStats();
        expect(vs.getStats()).toEqual({});
    });

    it('prune removes ids not in the valid set', () => {
        vs.recordVisit('a');
        vs.recordVisit('b');
        vs.recordVisit('c');
        vs.prune(new Set(['a', 'c']));
        const stats = vs.getStats();
        expect(Object.keys(stats)).toEqual(['a', 'c']);
        expect(stats.b).toBeUndefined();
    });

    it('prune keeps all when all ids are valid', () => {
        vs.recordVisit('a');
        vs.recordVisit('b');
        vs.prune(new Set(['a', 'b']));
        expect(Object.keys(vs.getStats())).toHaveLength(2);
    });

    it('flush persists stats to store', () => {
        vs.recordVisit('abc');
        vs.flush();
        const raw = store.get('visitStats');
        const parsed = JSON.parse(raw);
        expect(parsed.abc.c).toBe(1);
    });

    it('recordVisit is a no-op for falsy id', () => {
        vs.recordVisit(null);
        vs.recordVisit(undefined);
        vs.recordVisit('');
        expect(vs.getStats()).toEqual({});
    });
});
