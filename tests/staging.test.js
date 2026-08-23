/**
 * Staging-area pure-model suite (docs/plan-velvet/velvet-feat-staging-glm.md
 * §0.3/0.4/3.4/3.5). Drives the real src/staging.js — no DOM, no chrome.*.
 */
import { describe, it, expect } from 'vitest';
import {
    STAGING_LIMIT, createState, parse, serialize, count, getByUrl,
    snapshotItems, add, removeByUrls, clearAll, relink, updateSnapshot,
    setFav, setUnfavById, findGroup, findGroupBySource, createGroup,
    renameGroup, dissolveGroup, deleteGroup, restoreGroup, reorderGroups,
    pruneEmptyGroups, assignGroup,
    setGroupCollapsed, unfavBucketItems, newCount, markSeen, groupItems,
    looseItems, setRecentCollapsed, setUnfavCollapsed,
    parseShortcuts, upsertShortcut, removeShortcut
} from '../src/staging.js';

const mk = (id, url, title, ts) => ({ id, url, title, ts });

describe('staging state shape and parse', () => {
    it('createState returns the v1 schema', () => {
        const s = createState();
        expect(s.v).toBe(1);
        expect(s.items).toEqual([]);
        expect(s.groups).toEqual([]);
        expect(s.recentCollapsed).toBe(false);
        expect(s.unfavCollapsed).toBe(false);
        expect(s.lastSeenTs).toBe(0);
    });

    it('parse round-trips serialize output', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A', 100)], {}, 100);
        const g = createGroup(s, 'G', { sourceFolderId: '7' }, 200);
        assignGroup(s, ['https://a'], g.id);
        s.recentCollapsed = true;
        s.lastSeenTs = 300;
        const back = parse(serialize(s));
        expect(back.items).toEqual([{ id: '1', url: 'https://a', title: 'A', ts: 100, group: g.id }]);
        expect(back.groups[0].sourceFolderId).toBe('7');
        expect(back.recentCollapsed).toBe(true);
        expect(back.lastSeenTs).toBe(300);
    });

    it('parse degrades corrupted shapes to an empty workbench', () => {
        expect(parse(null).items).toEqual([]);
        expect(parse('').items).toEqual([]);
        expect(parse('not json').items).toEqual([]);
        expect(parse('42').items).toEqual([]);
        expect(parse('{"items":"x"}').items).toEqual([]);
    });

    it('parse drops items pointing at unknown groups and malformed rows', () => {
        const raw = JSON.stringify({
            v: 1,
            items: [
                { id: '1', url: 'https://a', title: 'a', ts: 1, group: 'ghost' },
                { id: null, url: 'https://b', title: 'b', ts: 2, group: null },
                null,
                { title: 'no url' }
            ],
            groups: [{ id: 'g1', name: 'G', collapsed: 1, createdAt: 5 }]
        });
        const s = parse(raw);
        expect(s.items.length).toBe(2);
        expect(s.items[0].group).toBeNull(); // ghost group ref sanitized
        expect(s.items[1].url).toBe('https://b');
        expect(s.groups[0].collapsed).toBe(true);
    });
});

describe('staging add: URL uniqueness and the 500 cap', () => {
    it('adds dual-state entries and dedupes by URL', () => {
        const s = createState();
        const r1 = add(s, [mk('1', 'https://a', 'A'), mk(null, 'https://b', 'B')], {}, 10);
        expect(r1.added.length).toBe(2);
        expect(r1.dupes).toEqual([]);
        expect(count(s)).toBe(2);
        // resend the same URL (even with a different id — same page) → no second row
        const r2 = add(s, [mk('9', 'https://a', 'A2')], {}, 20);
        expect(r2.added.length).toBe(0);
        expect(r2.dupes).toEqual(['https://a']);
        expect(getByUrl(s, 'https://a').title).toBe('A'); // snapshot not overwritten
        expect(getByUrl(s, 'https://a').ts).toBe(10);     // nor the join time
        expect(count(s)).toBe(2);
    });

    it('never mutates an existing item group on resend (§1.1)', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 10);
        const g = createGroup(s, 'G', {}, 20);
        assignGroup(s, ['https://a'], g.id);
        // resend with defaultGroup → the EXISTING row keeps its group
        const r = add(s, [mk('1', 'https://a', 'A')], { defaultGroup: 'other' }, 30);
        expect(r.added.length).toBe(0);
        expect(getByUrl(s, 'https://a').group).toBe(g.id);
    });

    it('defaultGroup pre-assigns only the new rows', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 10);
        const r = add(s, [mk(null, 'https://b', 'B'), mk('1', 'https://a', 'A')], { defaultGroup: 'gX' }, 20);
        expect(r.added.length).toBe(1);
        expect(getByUrl(s, 'https://b').group).toBe('gX');
        expect(getByUrl(s, 'https://a').group).toBeNull();
    });

    it('rejects the whole batch at the cap — no partial application', () => {
        const s = createState();
        const many = [];
        for (let i = 0; i < STAGING_LIMIT - 2; i++)
            many.push(mk(null, `https://x${i}`, `x${i}`));
        expect(add(s, many, {}, 1).full).toBe(false);
        expect(count(s)).toBe(STAGING_LIMIT - 2);
        // a batch of 3 does not fit → fully rejected, list untouched
        const r = add(s, [mk(null, 'https://y1', 'y'), mk(null, 'https://y2', 'y'), mk(null, 'https://y3', 'y')], {}, 2);
        expect(r.full).toBe(true);
        expect(r.added).toEqual([]);
        expect(count(s)).toBe(STAGING_LIMIT - 2);
        // exactly filling to the cap still works
        const ok = add(s, [mk(null, 'https://z1', 'z'), mk(null, 'https://z2', 'z')], {}, 3);
        expect(ok.full).toBe(false);
        expect(count(s)).toBe(STAGING_LIMIT);
    });

    it('dupes do not consume cap headroom', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 1);
        const many = [mk('1', 'https://a', 'A')]; // dupe
        for (let i = 0; i < STAGING_LIMIT - 1; i++)
            many.push(mk(null, `https://x${i}`, `x`));
        const r = add(s, many, {}, 2);
        expect(r.full).toBe(false);
        expect(count(s)).toBe(STAGING_LIMIT);
    });
});

describe('staging remove / clear (the explicit exits)', () => {
    it('removeByUrls returns restorable snapshots and prunes emptied groups', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A', 5), mk(null, 'https://b', 'B', 6)], {}, 5);
        const g = createGroup(s, 'G', {}, 7);
        assignGroup(s, ['https://a'], g.id);
        const removed = removeByUrls(s, ['https://a', 'https://nope']);
        expect(removed.length).toBe(1);
        expect(removed[0]).toEqual({ id: '1', url: 'https://a', title: 'A', ts: 5, group: g.id });
        expect(s.groups.length).toBe(0); // group emptied → auto-dissolved
        // undo path: re-adding the snapshot restores the ts/group bookkeeping
        add(s, removed, { defaultGroup: removed[0].group }, 99);
        expect(getByUrl(s, 'https://a').ts).toBe(5);
        expect(getByUrl(s, 'https://a').group).toBe(g.id); // group object gone; id kept verbatim
    });

    it('clearAll wipes items and groups', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 1);
        createGroup(s, 'G', {}, 2);
        const removed = clearAll(s);
        expect(removed.length).toBe(1);
        expect(s.items).toEqual([]);
        expect(s.groups).toEqual([]);
    });

    it('snapshotItems deep-copies (later mutation cannot corrupt undo data)', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 1);
        const snap = snapshotItems(s, ['https://a']);
        getByUrl(s, 'https://a').title = 'changed';
        expect(snap[0].title).toBe('A');
    });
});

describe('staging relink / prune against tree events (§0.4/0.5)', () => {
    it('relinks a dead anchor to another same-URL node', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 1);
        const r = relink(s, new Map([['https://a', '2']]));
        expect(getByUrl(s, 'https://a').id).toBe('2');
        expect(r.linked).toBe(1);
        expect(r.dropped).toBe(0);
    });

    it('falls back to id=null (item STAYS) when the URL is gone from the tree', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A'), mk('2', 'https://b', 'B')], {}, 1);
        const r = relink(s, new Map([['https://b', '2']])); // a's url vanished
        expect(getByUrl(s, 'https://a').id).toBeNull();
        expect(count(s)).toBe(2); // never silently removed
        expect(r.dropped).toBe(1);
        expect(getByUrl(s, 'https://b').id).toBe('2');
    });

    it('auto-promotes an unbookmarked item when its URL appears in the tree', () => {
        const s = createState();
        add(s, [mk(null, 'https://hist', 'H')], {}, 1);
        const r = relink(s, new Map([['https://hist', '42']]));
        expect(getByUrl(s, 'https://hist').id).toBe('42');
        expect(r.linked).toBe(1);
    });

    it('extraIds protects moved-but-alive anchors from being treated as dead', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 1);
        // url index built from a DIFFERENT same-url node, but id 1 is alive
        const r = relink(s, new Map([['https://a', '2']]), new Set(['1']));
        expect(getByUrl(s, 'https://a').id).toBe('1');
        expect(r.changed).toBe(0);
    });

    it('updateSnapshot syncs title/url edits from onChanged', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'Old')], {}, 1);
        expect(updateSnapshot(s, '1', { title: 'New' })).toBe(true);
        expect(getByUrl(s, 'https://a').title).toBe('New');
        expect(updateSnapshot(s, '1', { title: 'New' })).toBe(false); // no-op detected
        updateSnapshot(s, '1', { url: 'https://a2' });
        expect(getByUrl(s, 'https://a2')).not.toBeNull();
        expect(getByUrl(s, 'https://a')).toBeNull();
    });
});

describe('staging favorite-state transitions (id IS the state)', () => {
    it('setFav anchors the created bookmark id', () => {
        const s = createState();
        add(s, [mk(null, 'https://a', 'A')], {}, 1);
        expect(setFav(s, 'https://a', '9')).toBe(true);
        expect(getByUrl(s, 'https://a').id).toBe('9');
        expect(setFav(s, 'https://missing', '9')).toBe(false);
    });

    it('setUnfavById demotes to the unbookmarked state and the item stays', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 1);
        expect(setUnfavById(s, '1')).toBe(true);
        expect(getByUrl(s, 'https://a').id).toBeNull();
        expect(getByUrl(s, 'https://a').title).toBe('A'); // snapshot intact for re-fav
        expect(setUnfavById(s, 'nope')).toBe(false);
    });
});

describe('staging groups', () => {
    it('createGroup sorts by createdAt ascending (render order §3.4)', () => {
        const s = createState();
        const b = createGroup(s, 'B', {}, 200);
        const a = createGroup(s, 'A', {}, 100);
        expect(s.groups.map(g => g.name)).toEqual(['A', 'B']);
        expect(a.createdAt).toBe(100);
        expect(b.createdAt).toBe(200);
    });

    it('findGroupBySource matches folder and tab-group sources', () => {
        const s = createState();
        const f = createGroup(s, 'F', { sourceFolderId: '7' }, 1);
        const t = createGroup(s, 'T', { sourceTabGroup: 'Work' }, 2);
        expect(findGroupBySource(s, { sourceFolderId: '7' }).id).toBe(f.id);
        expect(findGroupBySource(s, { sourceTabGroup: 'Work' }).id).toBe(t.id);
        expect(findGroupBySource(s, { sourceFolderId: '8' })).toBeNull();
    });

    it('assignGroup moves items between groups exactly once (no copies)', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A'), mk(null, 'https://b', 'B')], {}, 1);
        const g1 = createGroup(s, 'G1', {}, 2);
        const g2 = createGroup(s, 'G2', {}, 3);
        assignGroup(s, ['https://a', 'https://b'], g1.id);
        expect(groupItems(s, g1.id).length).toBe(2);
        assignGroup(s, ['https://a'], g2.id);
        expect(groupItems(s, g1.id).length).toBe(1);
        expect(groupItems(s, g2.id).length).toBe(1);
    });

    it('dissolveGroup frees members and forgets the source', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A'), mk(null, 'https://b', 'B')], {}, 1);
        const g = createGroup(s, 'F', { sourceFolderId: '7' }, 2);
        assignGroup(s, ['https://a', 'https://b'], g.id);
        expect(dissolveGroup(s, g.id)).toBe(true);
        expect(s.groups.length).toBe(0);
        expect(getByUrl(s, 'https://a').group).toBeNull();
        // resend of folder 7 now creates a NEW group (source forgotten)
        expect(findGroupBySource(s, { sourceFolderId: '7' })).toBeNull();
    });

    it('renameGroup / setGroupCollapsed / pruneEmptyGroups', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A')], {}, 1);
        const g = createGroup(s, 'G', {}, 2);
        expect(renameGroup(s, g.id, 'Renamed')).toBe(true);
        expect(findGroup(s, g.id).name).toBe('Renamed');
        expect(setGroupCollapsed(s, g.id, true)).toBe(true);
        expect(findGroup(s, g.id).collapsed).toBe(true);
        removeByUrls(s, ['https://a']);
        expect(s.groups.length).toBe(0); // pruned via remove
        pruneEmptyGroups(s); // idempotent
        expect(renameGroup(s, 'ghost', 'x')).toBe(false);
    });

    it('manual (user-built) groups survive parse + an emptied member set', () => {
        const s = createState();
        const g = createGroup(s, 'Mine', { manual: true }, 2);
        add(s, [mk('1', 'https://a', 'A')], {}, 1);
        assignGroup(s, ['https://a'], g.id);
        const back = parse(serialize(s));
        expect(back.groups[0].manual).toBe(true);
        removeByUrls(back, ['https://a']);
        expect(back.groups.length).toBe(1); // NOT pruned — it is a workspace
        // but clearAll still clears everything, manual included
        clearAll(back);
        expect(back.groups.length).toBe(0);
        // non-manual groups keep the old auto-dissolve law
        const s2 = createState();
        const auto = createGroup(s2, 'Auto', {}, 1);
        add(s2, [mk('1', 'https://a', 'A')], {}, 1);
        assignGroup(s2, ['https://a'], auto.id);
        removeByUrls(s2, ['https://a']);
        expect(s2.groups.length).toBe(0);
    });

    it('deleteGroup removes the group AND its members; restoreGroup undoes both', () => {
        const s = createState();
        add(s, [mk('1', 'https://a', 'A'), mk('2', 'https://b', 'B'), mk('3', 'https://c', 'C')], {}, 1);
        const g = createGroup(s, 'G', {}, 2);
        assignGroup(s, ['https://a', 'https://b'], g.id);
        const receipt = deleteGroup(s, g.id);
        expect(receipt.removed.map(it => it.url).sort()).toEqual(['https://a', 'https://b']);
        expect(s.items.map(it => it.url)).toEqual(['https://c']); // outsider stays
        expect(s.groups.length).toBe(0);
        expect(deleteGroup(s, g.id)).toBeNull(); // gone is gone
        expect(restoreGroup(s, receipt)).toBe(true);
        expect(findGroup(s, g.id).name).toBe('G');
        expect(groupItems(s, g.id).map(it => it.url).sort()).toEqual(['https://a', 'https://b']);
        expect(s.items.length).toBe(3);
    });

    it('reorderGroups moves a group before its target and rebases createdAt', () => {
        const s = createState();
        const a = createGroup(s, 'A', {}, 100);
        const b = createGroup(s, 'B', {}, 200);
        const c = createGroup(s, 'C', {}, 300);
        expect(reorderGroups(s, c.id, a.id)).toBe(true); // C before A
        expect(s.groups.map(g => g.name)).toEqual(['C', 'A', 'B']);
        const stamps = s.groups.map(g => g.createdAt);
        expect(stamps[0] < stamps[1]).toBe(true);
        expect(stamps[1] < stamps[2]).toBe(true);
        // a later createGroup lands at the END of the visual order
        const d = createGroup(s, 'D', {}, 9999);
        expect(s.groups.map(g => g.name)).toEqual(['C', 'A', 'B', 'D']);
        // no-ops: onto itself, onto an unknown target
        expect(reorderGroups(s, a.id, a.id)).toBe(false);
        expect(reorderGroups(s, a.id, 'ghost')).toBe(false);
        expect(s.groups.map(g => g.name)).toEqual(['C', 'A', 'B', 'D']);
        // moving onto its own successor is order-neutral
        expect(reorderGroups(s, a.id, b.id)).toBe(false);
    });
});

describe('staging render partitions (bucket / loose / counts)', () => {
    it('unfavBucket holds id=null && group=null items only', () => {
        const s = createState();
        add(s, [mk(null, 'https://h1', 'H1'), mk(null, 'https://h2', 'H2'), mk('1', 'https://k1', 'K1')], {}, 1);
        const g = createGroup(s, 'G', {}, 2);
        assignGroup(s, ['https://h2'], g.id);
        // h1: unbookmarked ungrouped → bucket; h2: unbookmarked but grouped → NOT in bucket
        expect(unfavBucketItems(s).map(i => i.url)).toEqual(['https://h1']);
        // k1: bookmarked ungrouped → loose row, not bucket
        expect(looseItems(s).map(i => i.url)).toEqual(['https://k1']);
        // unfav collapse state round-trips
        setUnfavCollapsed(s, true);
        expect(s.unfavCollapsed).toBe(true);
    });

    it('newCount counts bucket arrivals since lastSeenTs', () => {
        const s = createState();
        add(s, [mk(null, 'https://a', 'A', 10), mk(null, 'https://b', 'B', 20)], {}, 10);
        markSeen(s, 15);
        expect(newCount(s)).toBe(1); // only b (ts=20 > 15)
        // grouped arrivals leave the bucket → not "new" anymore
        const g = createGroup(s, 'G', {}, 30);
        assignGroup(s, ['https://b'], g.id);
        expect(newCount(s)).toBe(0);
    });

    it('markSeen / setRecentCollapsed', () => {
        const s = createState();
        markSeen(s, 123);
        expect(s.lastSeenTs).toBe(123);
        setRecentCollapsed(s, true);
        expect(s.recentCollapsed).toBe(true);
    });
});

describe('staging move-to shortcuts (workbench round)', () => {
    it('parseShortcuts tolerates garbage and prunes invalid entries', () => {
        const list = parseShortcuts('{"not":"an array"}');
        expect(list).toEqual([]);
        const parsed = parseShortcuts(JSON.stringify([
            { id: 's1', folderId: '10', alias: 'Tools', color: 'blue' },
            { id: 's2', folderId: '11' }, // no alias/color → defaults
            { id: 'bad-color', folderId: '12', color: 'neon' },
            { id: 'no-folder' },
            'junk'
        ]));
        expect(parsed).toHaveLength(3);
        expect(parsed[0]).toEqual({ id: 's1', folderId: '10', alias: 'Tools', color: 'blue' });
        expect(parsed[1].alias).toBe('');
        expect(parsed[1].color).toBe('blue');
        expect(parsed[2].color).toBe('blue'); // invalid color → blue
    });

    it('upsertShortcut creates and edits; removeShortcut deletes', () => {
        const list = [];
        const created = upsertShortcut(list, { folderId: '10', alias: '  Tools  ', color: 'red' });
        expect(created.alias).toBe('Tools');
        expect(list).toHaveLength(1);
        const edited = upsertShortcut(list, { id: created.id, folderId: '12', alias: 'Reading', color: 'green' });
        expect(edited.id).toBe(created.id);
        expect(list).toHaveLength(1); // edit, not duplicate
        expect(list[0]).toEqual({ id: created.id, folderId: '12', alias: 'Reading', color: 'green' });
        expect(removeShortcut(list, created.id)).toBe(true);
        expect(removeShortcut(list, created.id)).toBe(false);
        expect(list).toEqual([]);
    });
});
