import { describe, it, expect } from 'vitest';
import { TAB_GROUP_COLORS, pickGroupColor, cleanGroupTitle } from '../src/tab-group-utils.js';

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
});
