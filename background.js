import { rankBookmarks, xmlEncode, matcher } from './src/search-core.js';

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

        let omniboxValue = null;
        let firstResult = null;
        const resetSuggest = () => {
            omniboxValue = null;
            firstResult = null;
            setSuggest(`<url><match>*</match></url> ${chrome.i18n.getMessage('searchBookmarks')}`);
        };
        resetSuggest();

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
                firstResult = rankedResults.shift();
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

        chrome.omnibox.onInputEntered.addListener((text, disposition) => {
            if (!text || !firstResult) {
                resetSuggest();
                return;
            }
            const url = (text === omniboxValue) ? firstResult.url : text;
            if (disposition === 'newForegroundTab' || disposition === 'newBackgroundTab') {
                chrome.tabs.create({
                    url: url,
                    active: disposition === 'newForegroundTab'
                });
                return;
            }
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