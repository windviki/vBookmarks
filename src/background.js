import { rankBookmarks, xmlEncode, matcher } from './search-core.js';
import { createSyncEngine } from './sync-engine.js';
import { createVisitStatsCollector } from './visit-stats-sw.js';

// --- Sync status engine (P3.6) ---------------------------------------------
// Computes bookmark sync status in the service worker and publishes it via
// chrome.storage.session; pages mirror it through src/sync-manager.js.
// Top-level start() so every SW cold start re-hooks the listeners (MV3).
createSyncEngine().start();

// --- Visit-stats SW collector (v4 task-2 slice E) --------------------------
// Counts bookmark opens that never touch the popup (address bar, omnibox,
// external links) into the same visitStats dataset the page side writes.
createVisitStatsCollector().start();

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
const applyPanelBehavior = open => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: open }).catch(() => {});
};

// Apply the persisted setting at service worker startup
chrome.storage.local.get('openInSidePanel', data => {
    applyPanelBehavior(!!data.openInSidePanel);
});

// React to setting changes immediately (options page writes chrome.storage.local)
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && 'openInSidePanel' in changes) {
        const newValue = !!changes.openInSidePanel.newValue;
        if (newValue) {
            // 用户开启了边栏选项：始终使用面板切换模式
            applyPanelBehavior(true);
        } else {
            // 用户关闭了边栏选项：检查当前面板是否打开
            // 若面板打开中，保持 toggle 模式以便下次点击关闭面板
            chrome.storage.session.get('sidePanelIsOpen', session => {
                applyPanelBehavior(!!session.sidePanelIsOpen);
            });
        }
    }
    // 侧边栏打开/关闭状态变化（由 popup.js 在 IS_PANEL 模式下写入）
    // 仅在用户未开启边栏选项时动态切换 action 行为
    if (areaName === 'session' && 'sidePanelIsOpen' in changes) {
        chrome.storage.local.get('openInSidePanel', data => {
            if (!data.openInSidePanel) {
                applyPanelBehavior(!!changes.sidePanelIsOpen.newValue);
            }
        });
    }
});

// Keyboard shortcut to open the panel on demand (works regardless of the setting)
chrome.commands.onCommand.addListener(async command => {
    if (command === 'open-command-palette') {
        // The command palette lives in the popup page: flag the pending open,
        // then raise the popup (chrome.action.openPopup, Chrome 127+) or fall
        // back to a small popup window carrying ?palette=1.
        try {
            await chrome.storage.session.set({ pendingPaletteOpen: true });
            if (chrome.action.openPopup) {
                await chrome.action.openPopup();
            } else {
                await chrome.windows.create({
                    url: chrome.runtime.getURL('pages/popup.html?palette=1'),
                    type: 'popup',
                    width: 400,
                    height: 600
                });
            }
        } catch (error) {
            console.warn('vBookmarks: failed to open the command palette:', error);
        }
        return;
    }
    if (command !== 'open-side-panel') {
        return;
    }
    // 提前标记侧边栏打开状态，确保在页面加载完成前
    // storage.onChanged 已触发 applyPanelBehavior(true)
    await chrome.storage.session.set({ sidePanelIsOpen: true });
    try {
        const currentWindow = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: currentWindow.id });
    } catch (error) {
        // 打开失败时清除标记
        await chrome.storage.session.remove('sidePanelIsOpen');
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