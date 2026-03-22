(() => {
    if (chrome.omnibox) {
        const setSuggest = description => {
            chrome.omnibox.setDefaultSuggestion({
                description: description
            });
        };

        // Debounce utility
        const debounce = (func, delay) => {
            let timeoutId;
            return (...args) => {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => func.apply(null, args), delay);
            };
        };

        // Rank bookmarks based on query
        const rankBookmarks = (query, results) => {
            if (results.length <= 1) return results;
            const v = query.replace(/([-.*+?^${}()|[\]\/\\])/g, '\\$1');
            const vPattern = new RegExp(`^${v.replace(/\s+/g, '.*')}`, 'ig');
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

        let omniboxValue = null;
        let firstResult = null;
        const resetSuggest = () => {
            omniboxValue = null;
            firstResult = null;
            setSuggest(`<url><match>*</match></url> ${chrome.i18n.getMessage('searchBookmarks')}`);
        };
        resetSuggest();

        const xmlEncode = text => text.replace(/&/g, '&amp;')
            .replace(/\"/g, '&quot;')
            .replace(/\'/g, '&apos;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const matcher = (text, value) => {
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

        const getSyncStatusText = (bookmark) => {
            if (bookmark.syncing !== undefined) {
                return bookmark.syncing ? '<dim>☁</dim>' : '<dim>📁</dim>';
            }
            return '';
        };

        chrome.omnibox.onInputChanged.addListener(debounce(async (value, suggest) => {
            if (!value) {
                resetSuggest();
                return;
            }
            omniboxValue = value;
            try {
                const results = await new Promise((resolve) => {
                    chrome.bookmarks.search(value, resolve);
                });
                if (!results.length) {
                    resetSuggest();
                    return;
                }
                const rankedResults = rankBookmarks(value, results);
                const firstResult = rankedResults.shift();
                const v = value.replace(/([-.*+?^${}()|[\]\/\\])/g, '\\$1');
                const firstTitle = matcher(xmlEncode(firstResult.title), v);
                const firstSyncStatus = getSyncStatusText(firstResult);
                let firstURL = {
                    text: xmlEncode(firstResult.url)
                };
                if (!firstTitle.matched) firstURL = matcher(firstURL.text, v);
                setSuggest(`${firstTitle.text} ${firstSyncStatus} <dim>-</dim> <url>${firstURL.text}</url>`);
                let suggestions = [];
                let i = 0, l = rankedResults.length;
                for (; i < l; i++) {
                    const result = rankedResults[i];
                    const title = matcher(xmlEncode(result.title), v);
                    const syncStatus = getSyncStatusText(result);
                    const URL = result.url;
                    let url = {
                        text: xmlEncode(URL)
                    };
                    if (!title.matched) url = matcher(url.text, v);
                    suggestions.push({
                        content: URL,
                        description: `${title.text} ${syncStatus} <dim>-</dim> <url>${url.text}</url>`
                    });
                }
                suggest(suggestions);
            } catch (error) {
                console.error('Omnibox search error:', error);
                resetSuggest();
            }
        }, 250));

        chrome.omnibox.onInputEntered.addListener(text => {
            if (!text || !firstResult) {
                resetSuggest();
                return;
            }
            const url = (text === omniboxValue) ? firstResult.url : text;
            chrome.tabs.query({active: true, currentWindow: true}, tabs => {
                if (tabs[0]) {
                    chrome.tabs.update(tabs[0].id, {
                        url: url
                    });
                }
            });
        });
    }
})();