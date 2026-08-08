/**
 * Version parsing + comparison (pure ESM).
 *
 * Every version gate in the extension — the donation "new version" card and
 * 3.x→4.x v4 notice (src/neat.js), the dead/dupes risk banner
 * (src/risk-banner.js) — decides "did the user cross into a version we want
 * to announce" from the manifest version versus the version recorded on
 * their last run. This module is the single place that reads and compares
 * versions, and it parses the FULL major.minor.patch, so a future banner can
 * gate on any version pair (e.g. "announce when crossing into 4.1") rather
 * than being locked to a major or minor bump.
 *
 * The manifest version is a Chrome-style "1.4 dot-separated integers" string
 * ("4.0", "4.0.1", …); only the first three segments are read — a fourth, if
 * present, is ignored — and missing segments parse to 0. Nothing here touches
 * chrome APIs — plain string/number math, unit-testable in node.
 */

// "4.0.1" → { major: 4, minor: 0, patch: 1 }; "4" → { 4, 0, 0 }; garbage → null.
export const parseVersion = str => {
    const m = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(str || '').trim());
    if (!m)
        return null;
    return { major: +m[1], minor: m[2] ? +m[2] : 0, patch: m[3] ? +m[3] : 0 };
};

// Semantic compare of two parsed versions: -1 | 0 | 1.
export const compareVersions = (a, b) => {
    for (const k of ['major', 'minor', 'patch']) {
        if (a[k] < b[k])
            return -1;
        if (a[k] > b[k])
            return 1;
    }
    return 0;
};

export const versionBelow = (a, b) => compareVersions(a, b) < 0;
export const versionAtLeast = (a, b) => compareVersions(a, b) >= 0;

// The leading integer of a version ("4.0.1" → 4). The risk banner re-arms on
// a MAJOR bump only; kept here so every version reading shares one parse.
export const majorOf = version => {
    const v = parseVersion(version);
    return v ? v.major : -1;
};

// "Is the recorded version not older than the current one at the MAJOR.MINOR
// granularity?" Patch bumps (4.0 → 4.0.1) intentionally read as "same": a fix
// release is silent — it must NOT re-arm the donation "new version" card.
export const sameOrNewerMinor = (recorded, current) =>
    recorded.major > current.major ||
    (recorded.major === current.major && recorded.minor >= current.minor);

// "Did the recorded version cross from below `threshold` to at-or-above it?"
// The generic form of the 3.x→4.x v4-notice gate — a future banner declares a
// threshold version and this decides whether the crossing happened.
export const crossedInto = (recorded, current, threshold) =>
    versionBelow(recorded, threshold) && versionAtLeast(current, threshold);
