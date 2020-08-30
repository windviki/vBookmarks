(window => {
    const document = window.document;
    const chrome = window.chrome;
    const _m = chrome.i18n.getMessage;
    const __m = _m;
    const localStorage = window.localStorage;

    document.addEventListener('DOMContentLoaded', () => {

        const reportError = (msg, url, line) => {
            const manifest = chrome.runtime.getManifest();
            const version = manifest.version;
            const txt = `_s=84615e81d50c4ddabff522aee3c4b734&_r=img&Msg=${escape(msg)}&URL=${escape(url)}&Line=${line}&Platform=${escape(navigator.platform)}&Version=${escape(version)}&UserAgent=${escape(navigator.userAgent)}`;
            const i = document.createElement('img');
            i.setAttribute('src', `${('https:' === document.location.protocol) ? 'https://errorstack.appspot.com'
                : 'http://www.errorstack.com'}/submit?${txt}`);
            document.body.appendChild(i);
            i.onload = () => {
                document.body.removeChild(i);
            };
        };

        window.onerror = reportError;

        chrome.extension.onRequest.addListener(request => {
            if (request.error) reportError.apply(null, request.error);
        });

        if (chrome.omnibox) {
            const setSuggest = description => {
                chrome.omnibox.setDefaultSuggestion({
                    description: description
                });
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

            chrome.omnibox.onInputChanged.addListener((value, suggest) => {
                if (!value) {
                    resetSuggest();
                    return;
                }
                omniboxValue = value;
                chrome.bookmarks.search(value, results => {
                    if (!results.length) {
                        resetSuggest();
                        return;
                    }
                    const v = value.replace(/([-.*+?^${}()|[\]\/\\])/g, '\\$1');
                    let vPattern = new RegExp(`^${v.replace(/\s+/g, '.*')}`, 'ig');
                    if (results.length > 1) {
                        results.sort((a, b) => {
                            const aTitle = a.title;
                            const bTitle = b.title;
                            let aIndexTitle = aTitle.toLowerCase().indexOf(v);
                            let bIndexTitle = bTitle.toLowerCase().indexOf(v);
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
                        results = results.slice(0, 6);
                    }
                    const resultsLen = results.length;
                    firstResult = results.shift();
                    const firstTitle = matcher(xmlEncode(firstResult.title), v);
                    let firstURL = {
                        text: xmlEncode(firstResult.url)
                    };
                    if (!firstTitle.matched) firstURL = matcher(firstURL.text, v);
                    setSuggest(`${firstTitle.text} <dim>-</dim> <url>${firstURL.text}</url>`);
                    let suggestions = [];
                    let i = 0, l = results.length;
                    for (; i < l; i++) {
                        const result = results[i];
                        const title = matcher(xmlEncode(result.title), v);
                        const URL = result.url;
                        let url = {
                            text: xmlEncode(URL)
                        };
                        if (!title.matched) url = matcher(url.text, v);
                        suggestions.push({
                            content: URL,
                            description: `${title.text} <dim>-</dim> <url>${url.text}</url>`
                        });
                    }
                    suggest(suggestions);
                    suggestions = null;
                    results = null;
                    vPattern = null;
                });
            });

            chrome.omnibox.onInputEntered.addListener(text => {
                if (!text || !firstResult) {
                    resetSuggest();
                    return;
                }
                const url = (text === omniboxValue) ? firstResult.url : text;
                chrome.tabs.getSelected(null, tab => {
                    chrome.tabs.update(tab.id, {
                        url: url,
                        selected: true
                    });
                });
            });
        }

        if (localStorage.customIcon) {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const customIcon = JSON.parse(localStorage.customIcon);
            const imageData = ctx.getImageData(0, 0, 19, 19);
            for (const key in customIcon) imageData.data[key] = customIcon[key];
            chrome.browserAction.setIcon({
                imageData: imageData
            });
        }
    });
})(window);