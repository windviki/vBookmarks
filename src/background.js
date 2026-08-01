import { rankBookmarks, xmlEncode, matcher } from './search-core.js';
import { createSyncEngine } from './sync-engine.js';
import { createVisitStatsCollector } from './visit-stats-sw.js';
import { initPanelBehavior } from './panel-behavior.js';

// --- Sync status engine (P3.6) ---------------------------------------------
// Computes bookmark sync status in the service worker and publishes it via
// chrome.storage.session; pages mirror it through src/sync-manager.js.
// Top-level start() so every SW cold start re-hooks the listeners (MV3).
createSyncEngine().start();

// --- Visit-stats SW collector (v4 task-2 slice E) --------------------------
// Counts bookmark opens that never touch the popup (address bar, omnibox,
// external links) into the same visitStats dataset the page side writes.
createVisitStatsCollector().start();

// --- Dead-scan proxy sweep (dead-proxy.js) ----------------------------------
// The popup tears down its marker-PAC on every scan exit (settle/cancel/
// pagehide), but a popup crash mid-scan would leave it installed. The PAC
// only proxies marker-tagged probe URLs (everything else resolves DIRECT),
// so residue is benign — still, sweep it whenever no live scan marker
// exists. chrome.proxy only exists once the optional `proxy` permission was
// granted, hence the namespace guard; settings.clear removes only what THIS
// extension set.
if (chrome.proxy && chrome.proxy.settings && chrome.storage && chrome.storage.session) {
    chrome.storage.session.get('vbmProxySession', data => {
        if (data && data.vbmProxySession)
            return; // a scan is live right now — its PAC is legitimate
        chrome.proxy.settings.clear({ scope: 'regular' }, () => void chrome.runtime.lastError);
    });
}

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
// Behavior application (option vs live panel state) lives in
// src/panel-behavior.js — extracted round-6 so the cold-start fix is
// unit-testable without booting the whole worker.
initPanelBehavior();

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
    if (command === 'quick-add-bookmark') {
        // Global quick-add (final polish): bookmark the active tab straight
        // into the configured quick-add folder — the keyboard sibling of the
        // page context menu below. Silent on purpose: no popup is up to show
        // a toast in, and the star outcome is visible in the bookmarks tree.
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url)
                return;
            const data = await chrome.storage.local.get({ quickAddFolderId: '1' });
            await chrome.bookmarks.create({
                title: tab.title || tab.url,
                url: tab.url,
                parentId: data.quickAddFolderId || '1'
            });
        } catch (error) {
            console.warn('vBookmarks: quick-add command failed:', error);
        }
        return;
    }
    if (command !== 'open-side-panel') {
        return;
    }
    // 提前标记侧边栏打开状态，确保在页面加载完成前
    // storage.onChanged 已触发 applyPanelBehavior(true)；心跳同时写入，
    // 使 SW 重启落在“面板尚未加载完”窗口内时标记仍被判为存活（#19）。
    await chrome.storage.session.set({ sidePanelIsOpen: true, sidePanelHeartbeat: Date.now() });
    try {
        const currentWindow = await chrome.windows.getCurrent();
        await chrome.sidePanel.open({ windowId: currentWindow.id });
    } catch (error) {
        // 打开失败时清除标记
        await chrome.storage.session.remove(['sidePanelIsOpen', 'sidePanelHeartbeat']);
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