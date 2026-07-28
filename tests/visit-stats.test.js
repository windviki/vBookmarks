import { describe, it, expect, beforeEach } from 'vitest';
import { initVisitStats } from '../src/visit-stats.js';

// visit-stats.js is pure logic — a Map-backed store stub stands in for the
// settings mirror, and flush() makes the debounced persist synchronous.

const makeStore = (initial = {}) => {
    const map = new Map(Object.entries(initial));
    return {
        map,
        get: (k, d) => (map.has(k) ? map.get(k) : d),
        set: (k, v) => map.set(k, v),
        remove: k => map.delete(k)
    };
};

let store;
let stats;

beforeEach(() => {
    store = makeStore();
    stats = initVisitStats({ store, debounceMs: 0 });
});

describe('record', () => {
    it('creates a fresh entry with c=1 and the given timestamp', () => {
        stats.record('7', 1000);
        expect(stats.get('7')).toEqual({ c: 1, t: 1000 });
    });

    it('increments the count and moves the timestamp forward', () => {
        stats.record('7', 1000);
        stats.record('7', 2000);
        stats.record('7', 3000);
        expect(stats.get('7')).toEqual({ c: 3, t: 3000 });
    });

    it('tracks ids independently', () => {
        stats.record('7', 1000);
        stats.record('8', 1500);
        stats.record('7', 2000);
        expect(stats.countOf('7')).toBe(2);
        expect(stats.countOf('8')).toBe(1);
        expect(stats.countOf('9')).toBe(0);
        expect(stats.get('9')).toBe(null);
    });

    it('defaults the timestamp to Date.now', () => {
        stats.record('7');
        expect(stats.get('7').c).toBe(1);
        expect(typeof stats.get('7').t).toBe('number');
        expect(stats.get('7').t).toBeGreaterThan(0);
    });

    it('ignores undefined/null/empty ids', () => {
        stats.record(undefined, 1);
        stats.record(null, 1);
        stats.record('', 1);
        expect(stats.all()).toEqual({});
    });
});

describe('statsEnabled master switch', () => {
    it('is on by default', () => {
        expect(stats.enabled()).toBe(true);
    });

    it('record is a no-op while off — zero writes', () => {
        store.set('statsEnabled', '');
        stats.record('7', 1000);
        stats.flush();
        expect(stats.get('7')).toBe(null);
        expect(store.map.has('visitStats')).toBe(false);
    });

    it('stops recording the moment the switch flips off', () => {
        stats.record('7', 1000);
        store.set('statsEnabled', '');
        stats.record('7', 2000);
        expect(stats.get('7')).toEqual({ c: 1, t: 1000 });
    });

    it('prune skips its write while off', () => {
        stats.record('7', 1000);
        stats.flush();
        store.set('statsEnabled', '');
        expect(stats.prune(new Set())).toBe(false);
        // the stored dataset is untouched
        expect(JSON.parse(store.get('visitStats'))).toEqual({ '7': { c: 1, t: 1000 } });
    });

    it('clear still works while off', () => {
        stats.record('7', 1000);
        stats.flush();
        store.set('statsEnabled', '');
        stats.clear();
        expect(stats.all()).toEqual({});
        expect(store.get('visitStats')).toBe('{}');
    });
});

describe('persistence', () => {
    it('persists debounced data on flush as one JSON blob', () => {
        stats.record('7', 1000);
        stats.record('8', 2000);
        stats.flush();
        expect(JSON.parse(store.get('visitStats'))).toEqual({
            '7': { c: 1, t: 1000 },
            '8': { c: 1, t: 2000 }
        });
    });

    it('writes nothing when nothing changed', () => {
        stats.flush();
        expect(store.map.has('visitStats')).toBe(false);
    });

    it('reloads from the store on a fresh instance', () => {
        store.set('visitStats', JSON.stringify({ '7': { c: 5, t: 42 } }));
        const fresh = initVisitStats({ store, debounceMs: 0 });
        expect(fresh.countOf('7')).toBe(5);
    });

    it('survives a corrupted stored value', () => {
        store.set('visitStats', '{not json');
        const fresh = initVisitStats({ store, debounceMs: 0 });
        expect(fresh.all()).toEqual({});
        fresh.record('7', 1000);
        expect(fresh.countOf('7')).toBe(1);
    });
});

describe('prune', () => {
    it('drops entries whose bookmark is gone, keeps the rest', () => {
        stats.record('7', 1000);
        stats.record('8', 2000);
        stats.record('9', 3000);
        expect(stats.prune(new Set(['7', '9']))).toBe(true);
        expect(stats.all()).toEqual({ '7': { c: 1, t: 1000 }, '9': { c: 1, t: 3000 } });
        stats.flush();
        expect(JSON.parse(store.get('visitStats'))).toEqual({
            '7': { c: 1, t: 1000 },
            '9': { c: 1, t: 3000 }
        });
    });

    it('reports no change when every entry is still valid', () => {
        stats.record('7', 1000);
        expect(stats.prune(new Set(['7']))).toBe(false);
    });
});

describe('all snapshot', () => {
    it('returns per-entry copies — mutations cannot corrupt the mirror', () => {
        stats.record('7', 1000);
        const snap = stats.all();
        snap['7'].c = 999;
        expect(stats.countOf('7')).toBe(1);
    });
});

describe('merge (history import)', () => {
    it('adds counts and max-merges timestamps per id', () => {
        stats.record('7', 1000);
        const n = stats.merge([
            { id: '7', c: 4, t: 500 },  // older t keeps 1000
            { id: '8', c: 3, t: 2000 }, // fresh entry
            { id: '7', c: 1, t: 3000 }  // second merge of the same id adds up
        ]);
        expect(n).toBe(3);
        expect(stats.get('7')).toEqual({ c: 6, t: 3000 });
        expect(stats.get('8')).toEqual({ c: 3, t: 2000 });
        stats.flush();
        expect(JSON.parse(store.get('visitStats'))).toEqual({
            '7': { c: 6, t: 3000 },
            '8': { c: 3, t: 2000 }
        });
    });

    it('skips malformed entries and reports only real touches', () => {
        const n = stats.merge([null, {}, { id: '' }, { id: '9', c: 2, t: 5 }]);
        expect(n).toBe(1);
        expect(stats.all()).toEqual({ '9': { c: 2, t: 5 } });
    });

    it('is a no-op while the master switch is off — zero writes', () => {
        store.set('statsEnabled', '');
        expect(stats.merge([{ id: '7', c: 9, t: 9 }])).toBe(0);
        stats.flush();
        expect(stats.all()).toEqual({});
        expect(store.map.has('visitStats')).toBe(false);
    });

    it('writes nothing for an empty or non-array input', () => {
        expect(stats.merge([])).toBe(0);
        expect(stats.merge(null)).toBe(0);
        stats.flush();
        expect(store.map.has('visitStats')).toBe(false);
    });
});

describe('clear', () => {
    it('wipes data and persists the empty object immediately', () => {
        stats.record('7', 1000);
        stats.record('8', 2000);
        stats.clear();
        expect(stats.all()).toEqual({});
        expect(store.get('visitStats')).toBe('{}');
    });

    it('a pending debounced write cannot resurrect wiped data', () => {
        stats.record('7', 1000); // schedules a write
        stats.clear();           // cancels it and stores {}
        stats.flush();           // must be a no-op now
        expect(store.get('visitStats')).toBe('{}');
    });
});
