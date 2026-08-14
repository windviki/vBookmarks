/**
 * vBookmarks fuzzy search core — fzf-style subsequence matching (Phase 2b).
 *
 * Pure ES module (no chrome/DOM access) so the popup (via src/fuzzy.js, which
 * re-exposes it as window.VBMFuzzy) and the omnibox (via src/search-core.js's
 * rankBookmarks) share ONE ranking implementation instead of two divergent
 * sorters.
 *
 * score(query, text): returns null when query is not a subsequence of text,
 * otherwise { score, positions } where positions are char indices into text
 * (usable for <mark> highlighting). Comparison is case-insensitive (both
 * inputs are lowercased first), which also covers scripts without case (CJK).
 *
 * rank(query, items): scores [{ id, title, url, dateAdded, isFolder }] items;
 * title and url hits are scored and tiered independently; the more exact side
 * wins. Each hit carries a precision tier — 0 exact, 1 prefix, 2 word-start,
 * 3 subsequence — and results sort by tier asc, then score desc, then
 * dateAdded desc (dateAdded is only a final tie-break). URL scoring strips
 * the structural https:// and www. prefix. Each result carries `positions`
 * (title hit positions) or null when only the url matched.
 */

// Characters that start a new "word" when they precede a matched char.
const WORD_SEPARATORS = ' -_./\\:;|~@#%&*+=()[]{}<>!?,\'"`';

// A matched char at index i earns a boundary bonus when it starts the
// string, follows a separator, or sits on a camelCase transition.
const isBoundary = (text, i) => {
    if (i === 0)
        return true;
    const prev = text.charAt(i - 1);
    if (WORD_SEPARATORS.indexOf(prev) !== -1)
        return true;
    const cur = text.charAt(i);
    return /[a-z0-9]/.test(prev) && /[A-Z]/.test(cur);
};

// Subsequence match; query must already be lowercase, textLower is the
// lowercased form of text (text itself is kept for camelCase detection).
const scoreLower = (query, text, textLower) => {
    const qlen = query.length;
    if (qlen === 0)
        return { score: 0, positions: [] };
    const tlen = textLower.length;
    if (qlen > tlen)
        return null;
    // Forward pass: leftmost subsequence (early-exits on mismatch).
    const positions = new Array(qlen);
    let qi = 0;
    for (let ti = 0; ti < tlen; ti++) {
        if (textLower.charAt(ti) === query.charAt(qi)) {
            positions[qi++] = ti;
            if (qi === qlen)
                break;
        }
    }
    if (qi < qlen)
        return null;
    // Backward pass: tighten the match into consecutive runs where
    // possible (fzf's v1 algorithm).
    let limit = positions[qlen - 1];
    for (let j = qlen - 2; j >= 0; j--) {
        const qc = query.charAt(j);
        let k = limit - 1;
        while (textLower.charAt(k) !== qc)
            k--;
        positions[j] = k;
        limit = k;
    }
    // Case folding can change the string length ('İ'.toLowerCase() is 'i'
    // + U+0307): the passes above index into textLower, but callers use
    // positions on the ORIGINAL string (the <mark> highlight in
    // tree-render.js's highlightTitlePositions, tierOf's boundary checks).
    // Remap to original indices — per-char fold lengths sum to the
    // whole-string fold (the one context-sensitive mapping, Greek final
    // sigma, is length-preserving). Same-length strings (the common case)
    // skip the map entirely.
    if (tlen !== text.length) {
        const lowerToOriginal = [];
        for (let i = 0, l = text.length; i < l; i++) {
            const folded = text.charAt(i).toLowerCase();
            for (let k = 0, kl = folded.length; k < kl; k++)
                lowerToOriginal.push(i);
        }
        for (let j = 0; j < qlen; j++)
            positions[j] = lowerToOriginal[positions[j]];
    }
    // Score: base per matched char, bonuses for consecutive runs and
    // word-boundary hits, and a small penalty for matches that start
    // further to the right.
    let score = 0;
    for (let j = 0; j < qlen; j++) {
        const p = positions[j];
        score += 10;
        if (j > 0 && p === positions[j - 1] + 1)
            score += 15;
        if (isBoundary(text, p))
            score += 8;
    }
    score -= positions[0];
    return { score: score, positions: positions };
};

export const score = (query, text) => {
    if (typeof query !== 'string' || typeof text !== 'string')
        return null;
    return scoreLower(query.toLowerCase(), text, text.toLowerCase());
};

// Precision tier for ranking: 0 = exact equality, 1 = prefix, 2 = every
// matched char on a word boundary, 3 = plain subsequence. The tier is the
// primary sort key so an exact title/url hit always beats a looser one,
// regardless of dateAdded. An empty query is tier 3 for everything.
const tierOf = (q, field, positions) => {
    if (!q)
        return 3;
    const f = field.toLowerCase();
    if (f === q)
        return 0;
    if (f.indexOf(q) === 0)
        return 1;
    if (positions && positions.length) {
        for (let i = 0, l = positions.length; i < l; i++)
            if (!isBoundary(field, positions[i]))
                return 3;
        return 2;
    }
    return 3;
};

// scheme:// and www. are pure structural noise — stripping them aligns the
// host start so https://github.com and https://www.github.com score
// identically. TLDs (.com) are real domain content and stay untouched.
const URL_NOISE = /^(?:https?:\/\/)?(?:www\.)?/i;
const stripUrlNoise = url => url.replace(URL_NOISE, '');

// Score the URL against the noise-stripped form when it matches there
// (host-aligned), falling back to the raw URL so queries like "www" or
// "https" themselves still hit. `text` records which form scored, for the
// tier lookup; positions are relative to it and never used for highlight
// (url-only matches render plain).
const scoreUrl = (q, url) => {
    const bare = stripUrlNoise(url);
    if (bare !== url) {
        const b = scoreLower(q, bare, bare.toLowerCase());
        if (b)
            return { score: b.score, positions: b.positions, text: bare };
    }
    const r = scoreLower(q, url, url.toLowerCase());
    return r ? { score: r.score, positions: r.positions, text: url } : null;
};

export const rank = (query, items) => {
    const results = [];
    if (!items)
        return results;
    const q = (query || '').toLowerCase();
    for (let i = 0, l = items.length; i < l; i++) {
        const item = items[i];
        const title = item.title || '';
        const url = item.url || '';
        // Title and URL are scored and tiered independently; the more exact
        // side wins the combined tier (min), ties break on the higher score
        // (title keeps its ×2 weight inside a tier). positions always come
        // from the title for <mark> highlight; url-only matches render plain.
        let titleTier = null;
        let titleScore = null;
        let positions = null;
        if (title) {
            const t = scoreLower(q, title, title.toLowerCase());
            if (t) {
                titleTier = tierOf(q, title, t.positions);
                titleScore = t.score * 2; // title hits weigh double
                positions = t.positions;
            }
        }
        let urlTier = null;
        let urlScore = null;
        if (url) {
            const u = scoreUrl(q, url);
            if (u) {
                urlTier = tierOf(q, u.text, u.positions);
                urlScore = u.score;
            }
        }
        let tier;
        let best;
        if (titleTier !== null && urlTier !== null) {
            if (urlTier < titleTier) {
                tier = urlTier;
                best = urlScore;
            } else if (titleTier < urlTier) {
                tier = titleTier;
                best = titleScore;
            } else {
                tier = titleTier;
                best = Math.max(titleScore, urlScore);
            }
        } else if (titleTier !== null) {
            tier = titleTier;
            best = titleScore;
        } else if (urlTier !== null) {
            tier = urlTier;
            best = urlScore;
        } else {
            continue;
        }
        results.push({
            id: item.id,
            parentId: item.parentId,
            title: title,
            url: url,
            dateAdded: item.dateAdded || 0,
            isFolder: !!item.isFolder,
            score: best,
            tier: tier,
            // Highlight title hits only; url-only matches render plain.
            positions: positions
        });
    }
    // Precision tier first (exact > prefix > word-start > subsequence), then
    // the raw score, dateAdded only as a last tie-break so a newer looser hit
    // can never outrank an exact match.
    results.sort((a, b) =>
        (a.tier - b.tier) ||
        (b.score - a.score) ||
        (b.dateAdded - a.dateAdded));
    return results;
};
