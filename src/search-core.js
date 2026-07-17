/**
 * vBookmarks search core
 * Pure search/ranking helpers shared by background.js (omnibox) and the
 * vitest suites. No chrome.* references — safe to import anywhere.
 */

// Rank bookmarks based on query
export const rankBookmarks = (query, results) => {
    if (results.length <= 1) return results;
    const v = query.replace(/([-.*+?^${}()|[\]\/\\])/g, '\\$1');
    const vPattern = new RegExp(`^${v.replace(/\s+/g, '.*')}`, 'i');
    results.sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();
        const queryLower = query.toLowerCase();
        let aIndexTitle = aTitle.indexOf(queryLower);
        let bIndexTitle = bTitle.indexOf(queryLower);
        if (aIndexTitle >= 0 || bIndexTitle >= 0) {
            if (aIndexTitle < 0) aIndexTitle = Infinity;
            if (bIndexTitle < 0) bIndexTitle = Infinity;
            return aIndexTitle - bIndexTitle;
        }
        const aTestTitle = vPattern.test(aTitle);
        const bTestTitle = vPattern.test(bTitle);
        if (aTestTitle && !bTestTitle) return -1;
        if (!aTestTitle && bTestTitle) return 1;
        return b.dateAdded - a.dateAdded;
    });
    return results.slice(0, 6);
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
