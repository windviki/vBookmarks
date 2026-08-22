/**
 * Folder-picker quick-pick roster pure logic (velvet staging §4.1) — drives
 * the real src/folder-pick.js: LRU recents, pin toggling, lazy pruning and
 * the chips model ordering.
 */
import { describe, it, expect } from 'vitest';
import {
    FOLDER_PICK_RECENTS_CAP, readIdList, writeIdList, recordRecent,
    togglePin, pruneIds, chipsModel
} from '../src/folder-pick.js';

describe('folder-pick readIdList / writeIdList', () => {
    it('round-trips and tolerates garbage', () => {
        expect(readIdList(writeIdList(['1', '22', '333']))).toEqual(['1', '22', '333']);
        expect(readIdList(null)).toEqual([]);
        expect(readIdList('')).toEqual([]);
        expect(readIdList('oops')).toEqual([]);
        expect(readIdList('{"a":1}')).toEqual([]);
        expect(readIdList('[1,2]')).toEqual(['1', '2']); // numbers coerced to ids
        expect(readIdList('[1,"1",null,2]')).toEqual(['1', '2']); // dedupe + null-drop
    });
});

describe('folder-pick recordRecent (LRU)', () => {
    it('moves an existing id to the front instead of duplicating', () => {
        expect(recordRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
        expect(recordRecent(['a', 'b'], 'new')).toEqual(['new', 'a', 'b']);
    });

    it('caps the queue at the constant (default 6)', () => {
        let list = [];
        for (let i = 0; i < 10; i++)
            list = recordRecent(list, `f${i}`);
        expect(list.length).toBe(FOLDER_PICK_RECENTS_CAP);
        expect(list[0]).toBe('f9'); // newest first
        expect(list).not.toContain('f0'); // oldest evicted
    });

    it('ignores empty ids without touching the list order', () => {
        expect(recordRecent(['a', 'b'], '')).toEqual(['a', 'b']);
        expect(recordRecent(['a'], null)).toEqual(['a']);
    });

    it('respects a custom cap', () => {
        expect(recordRecent(['a', 'b', 'c'], 'd', 2)).toEqual(['d', 'a']);
    });
});

describe('folder-pick togglePin', () => {
    it('appends on pin (user order), filters on unpin', () => {
        expect(togglePin([], '1')).toEqual(['1']);
        expect(togglePin(['1'], '2')).toEqual(['1', '2']);
        expect(togglePin(['1', '2'], '1')).toEqual(['2']);
        expect(togglePin(['1'], '9')).toEqual(['1', '9']); // not pinned → pins
    });

    it('string/number id forms unify', () => {
        expect(togglePin(['1'], 1)).toEqual([]); // numeric 1 unpins '1'
        expect(togglePin(['1'], 2)).toEqual(['1', '2']);
    });
});

describe('folder-pick pruneIds', () => {
    it('drops dead ids and reports the change', () => {
        const r1 = pruneIds(['1', '99', '2'], new Set(['1', '2']));
        expect(r1.list).toEqual(['1', '2']);
        expect(r1.changed).toBe(true);
        const r2 = pruneIds(['1'], new Set(['1']));
        expect(r2.changed).toBe(false);
        expect(r2.list).toEqual(['1']);
    });

    it('accepts array validity sets too', () => {
        expect(pruneIds(['1', '99'], ['1']).list).toEqual(['1']);
    });
});

describe('folder-pick chipsModel', () => {
    it('pins keep user order; recents exclude pinned and keep LRU order', () => {
        const model = chipsModel(['p1', 'p2'], ['r1', 'p1', 'r2']);
        expect(model.pins).toEqual(['p1', 'p2']);
        expect(model.recents).toEqual(['r1', 'r2']); // 'p1' deduped out
    });
});
