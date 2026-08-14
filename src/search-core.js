/**
 * vBookmarks search core
 * Pure search/ranking helpers shared by background.js (omnibox) and the
 * vitest suites. No chrome.* references — safe to import anywhere.
 *
 * Ranking reuses src/fuzzy-core.js (the same fzf-style sort the popup uses)
 * so the omnibox and the popup agree on "best match". The ranking is shared;
 * the candidate sets are not: the omnibox ranks chrome.bookmarks.search's
 * word-match results (sliced to 6 in rankBookmarks below), while the popup
 * ranks the full flattened tree index (folders included, separators
 * excluded).
 */

import { rank } from './fuzzy-core.js';

// Rank bookmarks by fzf-style subsequence score (see fuzzy-core.js), mapped
// back to the original objects so callers keep .syncing/.folderType etc.
export const rankBookmarks = (query, results) => {
    if (!results || results.length <= 1)
        return results;
    const ranked = rank(query, results);
    const byId = new Map();
    for (const r of results)
        byId.set(r.id, r);
    const ordered = [];
    for (const hit of ranked) {
        const original = byId.get(hit.id);
        if (original)
            ordered.push(original);
    }
    return ordered.slice(0, 6);
};

export const xmlEncode = text => text.replace(/&/g, '&amp;')
    .replace(/\"/g, '&quot;')
    .replace(/\'/g, '&apos;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

export const matcher = (text, value) => {
    let matched = false;
    const exp = new RegExp(value.replace(/\s+/g, '|'), 'ig');
    const matchedText = text.replace(exp, m => {
        matched = true;
        return `<match>${m}</match>`;
    });
    return {
        text: matchedText,
        matched: matched
    };
};
