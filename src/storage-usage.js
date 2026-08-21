/**
 * Storage-usage bar categorization (2026-08 audit extraction).
 *
 * Classic script exposing window.VBMUsage — loaded by pages/options.html
 * before options.js (options.js is a classic script and cannot import ESM).
 *
 * The options-page bar splits chrome.storage.local into four segments:
 * icon cache / scan+mark data / other / free. "other" is the CATCH-ALL:
 * every key not claimed by the two explicit families below lands there, so
 * the bar's totals stay exact no matter what keys future features add —
 * a small state key (a flag, a JSON blob of settings) never needs a change
 * here.
 *
 * The rule for NEW datasets (also pinned by tests/storage-usage.test.js):
 * a LARGE dataset — a cache/journal that can grow unboundedly, the way the
 * favicon cache or the dead-scan results do — must join isBookmarkDataKey
 * (or gain its own segment + legend entry), or the bar would mislead the
 * user about what eats the quota. The census test fails until you decide.
 *
 * Scope note: the bar measures chrome.storage.local ONLY. Deliberately not
 * covered: the sync area (own 100KB quota), storage.session (ephemeral),
 * and the vbmI18nDict locale cache in localStorage (a separate origin
 * quota, ≤ one locale's messages.json).
 */
(() => {
    // The favicon-enrichment cache: one data key per host + the index.
    const isIconKey = k => k === 'vbmFaviconIdx' || k.startsWith('vbmFavicon:');
    // Bookmark-derived local data: scan cache / live journal / dead marks
    // and their timestamps / visit stats. (The bookmark tree itself lives
    // in Chrome's bookmarks store, not in storage.local — the bar label
    // says "scan/mark data" to match, audit O4.)
    const isBookmarkDataKey = k => k === 'deadLastScan' || k === 'vbmDeadScan'
        || k === 'deadMarks' || k === 'deadMarkTimes' || k === 'visitStats';
    const categorize = k =>
        (isIconKey(k) ? 'icon' : isBookmarkDataKey(k) ? 'bookmarks' : 'other');
    window.VBMUsage = { isIconKey, isBookmarkDataKey, categorize };
})();
