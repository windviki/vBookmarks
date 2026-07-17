import { rankBookmarks, xmlEncode, matcher } from './search-core.js';

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

// --- Side panel (Phase 2b) ----------------------------------------------
// popup.html doubles as the side panel page (manifest.side_panel). The panel
// is an opt-in enhancement (setting `openInSidePanel`, off by default):
// when enabled, clicking the action opens the panel instead of the popup.
// chrome.sidePanel needs Chrome 114+ while minimum_chrome_version is 88, so
// every use is feature-detected.
const applyPanelBehavior = open => {
    if (chrome.sidePanel) {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: open }).catch(() => {});
    }
};

// Apply the persisted setting at service worker startup
chrome.storage.local.get('openInSidePanel', data => {
    applyPanelBehavior(!!data.openInSidePanel);
});

// React to setting changes immediately (options page writes chrome.storage.local)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && 'openInSidePanel' in changes) {
        applyPanelBehavior(!!changes.openInSidePanel.newValue);
    }
});

// Keyboard shortcut to open the panel on demand (works regardless of the setting)
chrome.commands.onCommand.addListener(async command => {
    if (command !== 'open-side-panel' || !chrome.sidePanel) {
        return;
    }
    try {
        const currentWindow = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: currentWindow.id });
    } catch (error) {
        console.warn('vBookmarks: failed to open side panel:', error);
    }
});

// --- Quick add bookmark from the page context menu (Phase 3, issue #30) ---
// The menu is created on install and at every service worker startup; the
// remove() first keeps re-creation idempotent across SW restarts (creating a
// duplicated id would raise a runtime error).
const QUICK_ADD_MENU_ID = 'vbm-quick-add';
if (chrome.contextMenus) {
    const createQuickAddMenu = () => {
        chrome.contextMenus.remove(QUICK_ADD_MENU_ID, () => {
            void chrome.runtime.lastError; // the menu simply didn't exist yet
            chrome.contextMenus.create({
                id: QUICK_ADD_MENU_ID,
                contexts: ['page'],
                title: chrome.i18n.getMessage('contextMenuAddBookmark')
            });
        });
    };
    chrome.runtime.onInstalled.addListener(createQuickAddMenu);
    createQuickAddMenu();
    chrome.contextMenus.onClicked.addListener((info, tab) => {
        if (info.menuItemId !== QUICK_ADD_MENU_ID || !tab || !tab.url) {
            return;
        }
        chrome.storage.local.get({ quickAddFolderId: '1' }, data => {
            chrome.bookmarks.create({
                title: tab.title || tab.url,
                url: tab.url,
                parentId: data.quickAddFolderId || '1'
            });
        });
    });
}