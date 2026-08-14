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

// Regex metacharacters in a raw query word must never reach `new RegExp`
// unescaped — the matcher owns its own escaping, so every consumer can
// pass the user query as-is.
const escapeRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Greedy leftmost subsequence scan (the same hit shape fuzzy-core scores):
// index of each query char in order, or null when the word is not a
// subsequence of the text.
const subseqHits = (text, word) => {
    const lower = text.toLowerCase();
    const w = word.toLowerCase();
    const hits = [];
    let from = 0;
    for (let i = 0; i < w.length; i++) {
        const at = lower.indexOf(w.charAt(i), from);
        if (at < 0)
            return null;
        hits.push(at);
        from = at + 1;
    }
    return hits;
};

// Omnibox <match> highlighting. Per query word: a case-insensitive
// substring pass first; when a word hits nothing as a substring, the
// greedy subsequence scan takes over — mirroring the ranking semantics
// (fuzzy-core ranks subsequences, so a row surfaced for "gub" against
// "GitHub" must not come back with zero highlight). Contiguous hit
// indexes render as one <match> run.
export const matcher = (text, value) => {
    const words = String(value || '').split(/\s+/).filter(Boolean);
    if (!words.length)
        return { text, matched: false };
    const hit = new Set();
    let matched = false;
    for (const word of words) {
        const exp = new RegExp(escapeRegExp(word), 'ig');
        let found = false;
        let m;
        while ((m = exp.exec(text)) !== null) {
            found = matched = true;
            for (let i = m.index; i < m.index + m[0].length; i++)
                hit.add(i);
        }
        if (!found) {
            const seq = subseqHits(text, word);
            if (seq) {
                matched = true;
                for (const p of seq)
                    hit.add(p);
            }
        }
    }
    if (!matched)
        return { text, matched: false };
    let out = '';
    let runStart = -1;
    for (let i = 0; i <= text.length; i++) {
        const inRun = i < text.length && hit.has(i);
        if (inRun && runStart < 0)
            runStart = i;
        else if (!inRun && runStart >= 0) {
            out += `<match>${text.slice(runStart, i)}</match>`;
            runStart = -1;
        }
        if (!inRun && i < text.length)
            out += text.charAt(i);
    }
    return { text: out, matched: true };
};
