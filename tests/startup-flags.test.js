import { describe, it, expect } from 'vitest';
import { applyVersionGate, bumpOpenCount, V4_THRESHOLD, ANNOUNCED_THRESHOLD } from '../src/startup-flags.js';
import { makeStoreDouble } from './helpers/dom.js';

// Startup version gate + open-count (extracted from the donation card so a
// future "announce this version" banner reuses them). The version helpers are
// the REAL src/version.js through startup-flags.js's import.

describe('applyVersionGate', () => {
    it('a fresh install records the version and counts as an upgrade', () => {
        const store = makeStoreDouble();
        const flags = applyVersionGate(store, '4.0.1');
        expect(store.get('currentVersion')).toBe('4.0.1');
        expect(flags).toEqual({ newOrUpgrade: true, upgradedToV4: false, upgradedToAnnounced: false });
    });

    it('the same version (same or newer minor) is NOT an upgrade — silent', () => {
        const store = makeStoreDouble({ currentVersion: '4.0.1' });
        const flags = applyVersionGate(store, '4.0.1');
        expect(flags.newOrUpgrade).toBe(false);
        expect(flags.upgradedToV4).toBe(false);
        expect(flags.upgradedToAnnounced).toBe(false);
    });

    it('a patch bump (4.0 → 4.0.1) stays silent (sameOrNewerMinor)', () => {
        const store = makeStoreDouble({ currentVersion: '4.0.0' });
        const flags = applyVersionGate(store, '4.0.1');
        expect(flags.newOrUpgrade).toBe(false);
        expect(flags.upgradedToV4).toBe(false);
        expect(flags.upgradedToAnnounced).toBe(false);
    });

    it('a 3.x → 4.x crossing pins the v4 flag', () => {
        const store = makeStoreDouble({ currentVersion: '3.5.0' });
        const flags = applyVersionGate(store, '4.0.1');
        expect(flags.upgradedToV4).toBe(true);
        expect(flags.newOrUpgrade).toBe(true); // crossed → still "new" for the card
        expect(flags.upgradedToAnnounced).toBe(false); // below the 4.1.0 threshold
    });

    it('a major bump re-arms the upgrade flag', () => {
        const store = makeStoreDouble({ currentVersion: '4.9.9' });
        const flags = applyVersionGate(store, '5.0.0');
        expect(flags.newOrUpgrade).toBe(true);
        expect(flags.upgradedToV4).toBe(false); // already on 4.x — not the v4 crossing
        expect(flags.upgradedToAnnounced).toBe(false); // 4.9.9 is already past 4.1.0
    });

    it('a downgrade reads as same-or-newer (no re-ask)', () => {
        const store = makeStoreDouble({ currentVersion: '4.1.0' });
        const flags = applyVersionGate(store, '4.0.1');
        expect(flags.newOrUpgrade).toBe(false);
    });

    it('tolerates a corrupted recorded version (falls back to an upgrade)', () => {
        const store = makeStoreDouble({ currentVersion: 'not a version' });
        const flags = applyVersionGate(store, '4.0.1');
        // parseVersion('not a version') → null → the recorded flag is skipped,
        // newOrUpgrade stays its true default
        expect(flags.newOrUpgrade).toBe(true);
        expect(store.get('currentVersion')).toBe('4.0.1');
    });

    it('a 4.0.x → 4.1.1 crossing arms the what\'s-new announce flag', () => {
        const store = makeStoreDouble({ currentVersion: '4.0.8' });
        const flags = applyVersionGate(store, '4.1.1');
        // a minor bump — sameOrNewerMinor(4.0.8, 4.1.1) is false, so the
        // upgrade flag re-arms too; not the v4 crossing, but it DID cross
        // the 4.1.1 announce threshold
        expect(flags.newOrUpgrade).toBe(true);
        expect(flags.upgradedToV4).toBe(false);
        expect(flags.upgradedToAnnounced).toBe(true);
        expect(store.get('currentVersion')).toBe('4.1.1'); // recorded → fires once
    });

    it('a 3.x → 4.1.1 crossing arms both the v4 flag and the announce flag', () => {
        const store = makeStoreDouble({ currentVersion: '3.3.0' });
        const flags = applyVersionGate(store, '4.1.1');
        expect(flags.upgradedToV4).toBe(true);
        expect(flags.upgradedToAnnounced).toBe(true);
    });

    it('once recorded as 4.1.1, later opens never re-arm the announce flag', () => {
        const store = makeStoreDouble({ currentVersion: '4.1.1' });
        const flags = applyVersionGate(store, '4.1.1');
        expect(flags.upgradedToAnnounced).toBe(false);
        expect(flags.newOrUpgrade).toBe(false);
    });
});

describe('bumpOpenCount', () => {
    it('starts at 1 on the first open', () => {
        const store = makeStoreDouble();
        bumpOpenCount(store);
        expect(store.get('openCount')).toBe(1);
    });

    it('accumulates on later opens', () => {
        const store = makeStoreDouble({ openCount: '5' });
        bumpOpenCount(store);
        bumpOpenCount(store);
        expect(store.get('openCount')).toBe(7);
    });
});

describe('V4_THRESHOLD', () => {
    it('is the 4.0 crossing threshold', () => {
        expect(V4_THRESHOLD).toEqual({ major: 4, minor: 0, patch: 0 });
    });
});

describe('ANNOUNCED_THRESHOLD', () => {
    it('is the 4.1.1 announce threshold (re-armed for the 4.1.1 release)', () => {
        expect(ANNOUNCED_THRESHOLD).toEqual({ major: 4, minor: 1, patch: 1 });
    });
});
