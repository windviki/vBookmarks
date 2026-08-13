/**
 * Startup bookkeeping shared by the popup's transient banners (donation card,
 * future "announce this version" banners): the version gate and the
 * open-count. Extracted from src/donation.js so the logic is testable and a
 * second consumer doesn't re-implement it.
 *
 * applyVersionGate: records `currentVersion` and derives the flags for THIS
 * open — newOrUpgrade (a fresh install, or a version jump the same-or-newer-
 * minor check treats as an upgrade) and upgradedToV4 (a 3.x → 4.x crossing
 * that pins the v4 notice onto the card). Patch bumps (4.0 → 4.0.1) stay
 * silent (sameOrNewerMinor), a major/minor bump re-arms.
 *
 * bumpOpenCount: the running popup-open counter (donationFactor advances
 * against it toward the next ask).
 */
import { parseVersion, sameOrNewerMinor, crossedInto } from './version.js';

export const V4_THRESHOLD = parseVersion('4.0');

export const applyVersionGate = (store, currentVersion) => {
    let newOrUpgrade = true;
    let upgradedToV4 = false;
    if (!store.get('currentVersion')) {
        store.set('currentVersion', currentVersion);
    } else {
        const recordVer = parseVersion(store.get('currentVersion'));
        store.set('currentVersion', currentVersion);
        const currentVer = parseVersion(currentVersion);
        if (recordVer && currentVer) {
            if (sameOrNewerMinor(recordVer, currentVer)) {
                newOrUpgrade = false;
            } else if (crossedInto(recordVer, currentVer, V4_THRESHOLD)) {
                upgradedToV4 = true;
            }
        }
    }
    return { newOrUpgrade, upgradedToV4 };
};

export const bumpOpenCount = (store) => {
    if (!store.get('openCount')) {
        store.set('openCount', 1);
    } else {
        store.set('openCount', parseInt(store.get('openCount'), 10) + 1);
    }
};
