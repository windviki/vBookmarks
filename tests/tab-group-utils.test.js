import { describe, it, expect } from 'vitest';
import { TAB_GROUP_COLORS, pickGroupColor, cleanGroupTitle,
    readTabGroupFolderMeta, saveTabGroupFolderMeta, forgetTabGroupFolderMeta,
    pruneTabGroupFolderMeta, readTabGroupFolderMetaMap } from '../src/tab-group-utils.js';

describe('tab-group-utils', () => {
    describe('pickGroupColor', () => {
        it('is deterministic — the same title always maps to the same color', () => {
            expect(pickGroupColor('My Folder')).toBe(pickGroupColor('My Folder'));
            expect(pickGroupColor('')).toBe(pickGroupColor(''));
        });

        it('always lands inside the nine-color palette', () => {
            for (const title of ['a', 'My Folder', 'Dev Docs', 'α β', '💾']) {
                expect(TAB_GROUP_COLORS).toContain(pickGroupColor(title));
            }
        });

        it('spreads distinct titles across the palette (not a constant)', () => {
            const colors = new Set(
                ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta'].map(pickGroupColor)
            );
            expect(colors.size).toBeGreaterThan(1);
        });
    });

    describe('cleanGroupTitle', () => {
        it('strips a trailing localized sync suffix', () => {
            expect(cleanGroupTitle('Dev Docs (Local)', ['(Local)'])).toBe('Dev Docs');
            expect(cleanGroupTitle('Dev Docs (Synced)', ['(Synced)'])).toBe('Dev Docs');
        });

        it('tries each suffix once, in order (multi-locale suffixes)', () => {
            expect(cleanGroupTitle('Dev Docs （本地）', ['(Local)', '（本地）'])).toBe('Dev Docs');
            // a suffix must match with its leading space — no partial match
            expect(cleanGroupTitle('Dev Docs(Local)', ['(Local)'])).toBe('Dev Docs(Local)');
        });

        it('trims and is a no-op when no suffix matches', () => {
            expect(cleanGroupTitle('  Dev Docs  ', [])).toBe('Dev Docs');
            expect(cleanGroupTitle('Dev Docs', ['(Local)'])).toBe('Dev Docs');
        });
    });

    describe('tab-group folder meta', () => {
        const makeStore = () => {
            const data = {};
            return {
                data,
                get: (key, dflt) => (key in data ? data[key] : dflt),
                set(key, v) { data[key] = v; }
            };
        };

        it('save/read/forget round-trips a folder meta entry', () => {
            const store = makeStore();
            saveTabGroupFolderMeta(store, '12', { title: 'Dev', color: 'blue', savedAt: 1, sourceGroupId: 7 });
            expect(readTabGroupFolderMeta(store, '12')).toEqual({ title: 'Dev', color: 'blue', savedAt: 1, sourceGroupId: 7 });
            expect(readTabGroupFolderMeta(store, '99')).toBe(null);
            forgetTabGroupFolderMeta(store, '12');
            expect(readTabGroupFolderMeta(store, '12')).toBe(null);
        });

        it('a corrupt stored value reads as an empty map (self-heal)', () => {
            const store = makeStore();
            store.set('tabGroupFolderMeta', '{oops');
            expect(readTabGroupFolderMeta(store, '12')).toBe(null);
            expect(readTabGroupFolderMetaMap(store)).toEqual({});
        });

        it('prune drops meta whose folder is gone and keeps live folders', () => {
            const store = makeStore();
            saveTabGroupFolderMeta(store, '12', { title: 'Dev', color: 'blue' });
            saveTabGroupFolderMeta(store, '34', { title: 'Gone', color: 'red' });
            pruneTabGroupFolderMeta(store, new Set(['12']));
            expect(readTabGroupFolderMeta(store, '12')).not.toBe(null);
            expect(readTabGroupFolderMeta(store, '34')).toBe(null);
        });

        it('prune is a no-op write when nothing is stale', () => {
            const store = makeStore();
            saveTabGroupFolderMeta(store, '12', { title: 'Dev', color: 'blue' });
            const before = store.data.tabGroupFolderMeta;
            pruneTabGroupFolderMeta(store, new Set(['12', '34']));
            expect(store.data.tabGroupFolderMeta).toBe(before); // same string — no rewrite
        });

        it('prune never writes when the map is empty', () => {
            const store = makeStore();
            pruneTabGroupFolderMeta(store, new Set());
            expect(store.data.tabGroupFolderMeta).toBeUndefined();
        });
    });
});
