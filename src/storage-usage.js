/**
 * Storage-usage bar categorization (2026-08 audit extraction; simplified in
 * the 2026-08 storage-audit fix round, docs/storage-usage-report.md §15).
 *
 * Classic script exposing window.VBMUsage — loaded by pages/options.html
 * before options.js (options.js is a classic script and cannot import ESM).
 *
 * The options-page bar visualizes the ICON CACHE against everything else:
 * three segments — icon cache / other / free. Per-category bookkeeping was
 * dropped by product decision: the favicon cache is the only dataset with a
 * dynamic byte budget (src/favicon-enrich.js refreshBudget), so it is the
 * only segment worth managing visually. "other" is the CATCH-ALL: every key
 * not claimed by the icon family below lands there, so the bar's totals
 * stay exact no matter what keys future features add — a small state key
 * never needs a change here.
 *
 * The rule for NEW datasets (still pinned by tests/storage-usage.test.js):
 * a LARGE dataset — a cache/journal that can grow unboundedly, the way the
 * favicon cache does — must be called out in that suite's decision table,
 * so adding one is a deliberate, reviewed act. The bar itself stays
 * icon/other/free unless a future dataset gains its own budget controller.
 *
 * Scope note: the bar measures chrome.storage.local ONLY (the ~10MB local
 * quota — the hint under the bar says so). Deliberately not covered: the
 * sync area (own 100KB quota — most user preferences live there since the
 * 2026-08 audit, see store.js SYNC_KEYS), storage.session (ephemeral), and
 * the vbmI18nDict locale cache in localStorage (a separate origin quota,
 * ≤ one locale's messages.json).
 */
(() => {
    // The favicon-enrichment cache: one data key per host + the index.
    const isIconKey = k => k === 'vbmFaviconIdx' || k.startsWith('vbmFavicon:');
    const categorize = k => (isIconKey(k) ? 'icon' : 'other');
    window.VBMUsage = { isIconKey, categorize };
})();
