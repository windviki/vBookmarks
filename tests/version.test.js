import { describe, it, expect } from 'vitest';
import {
    parseVersion,
    compareVersions,
    versionBelow,
    versionAtLeast,
    majorOf,
    sameOrNewerMinor,
    crossedInto
} from '../src/version.js';

describe('parseVersion', () => {
    it('parses full major.minor.patch', () => {
        expect(parseVersion('4.0.1')).toEqual({ major: 4, minor: 0, patch: 1 });
        expect(parseVersion('4.1')).toEqual({ major: 4, minor: 1, patch: 0 });
        expect(parseVersion('4')).toEqual({ major: 4, minor: 0, patch: 0 });
        expect(parseVersion('3.2.11')).toEqual({ major: 3, minor: 2, patch: 11 });
    });
    it('normalizes missing segments to 0 (patch-silent parsing)', () => {
        // "4.0.1" and "4.0" both read as minor 0 — the donation gate's
        // minor-granularity comparison depends on this.
        expect(parseVersion('4.0.1').minor).toBe(0);
        expect(parseVersion('4.0').minor).toBe(0);
    });
    it('returns null for garbage and empty input', () => {
        expect(parseVersion('')).toBeNull();
        expect(parseVersion('abc')).toBeNull();
        expect(parseVersion(null)).toBeNull();
        expect(parseVersion(undefined)).toBeNull();
    });
    it('ignores trailing build segments Chrome allows', () => {
        expect(parseVersion('4.0.1.99')).toEqual({ major: 4, minor: 0, patch: 1 });
    });
});

describe('compareVersions', () => {
    it('orders by major then minor then patch', () => {
        const A = parseVersion('4.0.1');
        const B = parseVersion('4.0.1');
        expect(compareVersions(A, B)).toBe(0);
        expect(compareVersions(parseVersion('4.1'), parseVersion('4.0.1'))).toBe(1);
        expect(compareVersions(parseVersion('4.0.1'), parseVersion('4.1'))).toBe(-1);
        expect(compareVersions(parseVersion('4.0.2'), parseVersion('4.0.1'))).toBe(1);
        expect(compareVersions(parseVersion('5.0'), parseVersion('4.9.9'))).toBe(1);
    });
    it('distinguishes a patch bump from its base (future banner gating)', () => {
        // 4.0 → 4.0.1 IS a version change at full granularity — a future
        // "announce this fix" banner can key on it even though the donation
        // gate (sameOrNewerMinor) intentionally stays silent.
        expect(compareVersions(parseVersion('4.0.1'), parseVersion('4.0'))).toBe(1);
        expect(versionBelow(parseVersion('4.0'), parseVersion('4.0.1'))).toBe(true);
    });
});

describe('versionBelow / versionAtLeast', () => {
    it('mirrors the comparator', () => {
        expect(versionBelow(parseVersion('3.9'), parseVersion('4.0.1'))).toBe(true);
        expect(versionBelow(parseVersion('4.0.1'), parseVersion('4.0.1'))).toBe(false);
        expect(versionAtLeast(parseVersion('4.0.1'), parseVersion('4.0'))).toBe(true);
        expect(versionAtLeast(parseVersion('4.0'), parseVersion('4.0.1'))).toBe(false);
    });
});

describe('majorOf', () => {
    it('reads the leading integer', () => {
        expect(majorOf('4.0.1')).toBe(4);
        expect(majorOf('4.1')).toBe(4);
        expect(majorOf('3.7.0')).toBe(3);
        expect(majorOf('')).toBe(-1);
    });
});

describe('sameOrNewerMinor (donation "new version" gate)', () => {
    it('patch bumps are silent — 4.0.0 recorded, 4.0.1 current', () => {
        expect(sameOrNewerMinor(parseVersion('4.0.0'), parseVersion('4.0.1'))).toBe(true);
    });
    it('minor bumps DO count as newer — 4.0.1 recorded, 4.1 current', () => {
        expect(sameOrNewerMinor(parseVersion('4.0.1'), parseVersion('4.1'))).toBe(false);
    });
    it('major bumps count as newer', () => {
        expect(sameOrNewerMinor(parseVersion('3.9.9'), parseVersion('4.0.1'))).toBe(false);
    });
    it('downgrades read as same-or-newer (no re-ask)', () => {
        expect(sameOrNewerMinor(parseVersion('4.1'), parseVersion('4.0.1'))).toBe(true);
    });
});

describe('crossedInto (v4-notice / future banner gates)', () => {
    const V4 = parseVersion('4.0');
    it('3.x → 4.0.1 crosses into v4', () => {
        expect(crossedInto(parseVersion('3.5.0'), parseVersion('4.0.1'), V4)).toBe(true);
    });
    it('already on 4.x does not cross', () => {
        expect(crossedInto(parseVersion('4.0.0'), parseVersion('4.0.1'), V4)).toBe(false);
    });
    it('a future threshold works the same way', () => {
        // e.g. a future banner that announces "crossing into 4.1".
        expect(crossedInto(parseVersion('4.0.1'), parseVersion('4.1'), parseVersion('4.1'))).toBe(true);
        expect(crossedInto(parseVersion('4.1'), parseVersion('4.1'), parseVersion('4.1'))).toBe(false);
    });
});
