/**
 * vBookmarks fuzzy search (Phase 2b) — fzf-style subsequence matching for the
 * popup, replacing chrome.bookmarks.search substring matching.
 *
 * Classic script loaded by popup.html before neat.js; exposes window.VBMFuzzy.
 *
 * score(query, text): returns null when query is not a subsequence of text,
 * otherwise { score, positions } where positions are char indices into text
 * (usable for <mark> highlighting). Comparison is case-insensitive (both
 * inputs are lowercased first), which also covers scripts without case (CJK).
 *
 * rank(query, items): scores [{ id, title, url, dateAdded, isFolder }] items;
 * title hits weigh double, url hits single, the best of both wins. Results
 * are sorted by score desc, then dateAdded desc. Each result carries
 * `positions` (title hit positions) or null when only the url matched.
 */
(window => {
    // Characters that start a new "word" when they precede a matched char.
    const WORD_SEPARATORS = ' -_./\\:;|~@#%&*+=()[]{}<>!?,;\'"`';

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

    const score = (query, text) => {
        if (typeof query !== 'string' || typeof text !== 'string')
            return null;
        return scoreLower(query.toLowerCase(), text, text.toLowerCase());
    };

    const rank = (query, items) => {
        const results = [];
        if (!items)
            return results;
        const q = (query || '').toLowerCase();
        for (let i = 0, l = items.length; i < l; i++) {
            const item = items[i];
            const title = item.title || '';
            const url = item.url || '';
            let best = null;
            let positions = null;
            if (title) {
                const t = scoreLower(q, title, title.toLowerCase());
                if (t) {
                    best = t.score * 2; // title hits weigh double
                    positions = t.positions;
                }
            }
            if (url) {
                const u = scoreLower(q, url, url.toLowerCase());
                if (u && (best === null || u.score > best))
                    best = u.score;
            }
            if (best === null)
                continue;
            results.push({
                id: item.id,
                parentId: item.parentId,
                title: title,
                url: url,
                dateAdded: item.dateAdded || 0,
                isFolder: !!item.isFolder,
                score: best,
                // Highlight title hits only; url-only matches render plain.
                positions: positions
            });
        }
        results.sort((a, b) => (b.score - a.score) || (b.dateAdded - a.dateAdded));
        return results;
    };

    window.VBMFuzzy = { score: score, rank: rank };
})(window);
