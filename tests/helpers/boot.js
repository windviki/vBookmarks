import { vi } from 'vitest';

// Boot an ES module that auto-runs init() at import (the
// options-palette-commands pattern) against page-global stubs. Two traps are
// handled here (see the audit report §7.2.1):
//  - vi.resetModules() wipes the special `location` global (document/chrome/
//    store survive) — re-apply it so the module's init sees the hash.
//  - importing the same specifier twice in one test double-registers the
//    module's init() listeners on the shared DOM stubs (both fire on one
//    trigger) — import exactly once per test through this helper.
//
// The caller sets up document/chrome/history/confirm/alert doubles in
// beforeEach; bootWithStubs() then resets the module registry, applies the
// hash to `locationImpl` (and re-applies it as a global), runs `setupGlobals`
// (e.g. store = makeStoreDouble(seed); globalThis.store = store), imports the
// module once, and flushes init()'s microtask chain. `modulePath` is resolved
// relative to THIS file (tests/helpers/boot.js), so a src module is
// '../../src/…'.
export const bootWithStubs = async ({ modulePath, locationImpl = null, hash = '', setupGlobals = null }) => {
    vi.resetModules();
    if (locationImpl) {
        locationImpl.hash = hash;
        globalThis.location = locationImpl; // resetModules() wiped it
    }
    if (setupGlobals)
        setupGlobals();
    await import(modulePath);
    for (let i = 0; i < 8; i++)
        await new Promise(r => setTimeout(r, 0));
};
