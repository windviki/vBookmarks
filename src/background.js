import { rankBookmarks, xmlEncode, matcher } from './search-core.js';
import { createSyncEngine } from './sync-engine.js';
import { createVisitStatsCollector } from './visit-stats-sw.js';
import { initPanelBehavior } from './panel-behavior.js';
import { createDeadScanRunner } from './dead-scan-sw.js';
import { createTabGroupOpener } from './tab-groups-sw.js';

// --- Sync status engine (P3.6) ---------------------------------------------
// Computes bookmark sync status in the service worker and publishes it via
// chrome.storage.session; pages mirror it through src/sync-manager.js.
// Top-level start() so every SW cold start re-hooks the listeners (MV3).
createSyncEngine().start();

// --- Visit-stats SW collector (v4 task-2 slice E) --------------------------
// Counts bookmark opens that never touch the popup (address bar, omnibox,
// external links) into the same visitStats dataset the page side writes.
createVisitStatsCollector().start();

// --- Dead-scan SW runner (v4 task-4 #16) -----------------------------------
// The scan outlives the popup here: pages send vbm-dead-scan-* messages and
// mirror the published vbmDeadScan blob; a cold start resumes a live run.
const deadScanRunner = createDeadScanRunner();

// --- Tab-group opener SW runner (P3.4 hardening) ----------------------------
// Opening bookmarks "as a tab group" must outlive the popup too: the popup
// page closes the moment its first (active) tab opens, which used to drop
// the pending create callbacks and the group never formed. The SW creates
// the tabs and groups them on vbm-tab-group-open-* messages.
createTabGroupOpener().start();

// --- Dead-scan proxy sweep (dead-proxy.js) ----------------------------------
// The popup tears down its marker-PAC on every scan exit (settle/cancel/
// pagehide), but a popup crash mid-scan would leave it installed. The PAC
// only proxies marker-tagged probe URLs (everything else resolves DIRECT),
// so residue is benign — still, sweep it when the cold-start resume check
// decides there is NO live run. The guard covers browsers/builds where
// chrome.proxy is absent; settings.clear removes only what THIS extension
// set. audit D9: the sweep waits for resumeIfNeeded's read and is skipped
// entirely when a run was resumed, so it can no longer clear the PAC that
// the resumed run is installing.
const sweepDeadProxyResidue = () => {
    if (chrome.proxy && chrome.proxy.settings && chrome.storage && chrome.storage.session) {
        chrome.storage.session.get('vbmProxySession', data => {
            if (data && data.vbmProxySession)
                return; // a scan is live right now — its PAC is legitimate
            chrome.proxy.settings.clear({ scope: 'regular' }, () => void chrome.runtime.lastError);
        });
    }
};
deadScanRunner.start().then(resumed => {
    if (!resumed)
        sweepDeadProxyResidue();
});

// --- Custom action icon persistence (issue #52) -----------------------------
// chrome.action.setIcon is session-scoped: a browser restart resets the action
// icon to the manifest default. The popup page (neat.js) re-applies the icon on
// open, but until the user clicks the action button the icon shows the default.
// The SW restores it on every cold start so the custom icon survives restarts.
// The stored value is JSON.stringify(imageData.data) — a 19×19 RGBA flat array.
const restoreCustomIcon = () => {
    if (!chrome.action || !chrome.storage || !chrome.storage.local)
        return;
    chrome.storage.local.get('customIcon', data => {
        const raw = data && data.customIcon;
        if (!raw)
            return;
        try {
            const pixels = JSON.parse(raw);
            const canvas = new OffscreenCanvas(19, 19);
            const ctx = canvas.getContext('2d');
            const imageData = ctx.getImageData(0, 0, 19, 19);
            for (const key in pixels)
                imageData.data[key] = pixels[key];
            chrome.action.setIcon({ imageData });
        } catch (e) {
            // Corrupt/legacy value — ignore; the manifest icon stays.
        }
    });
};
restoreCustomIcon();
chrome.runtime.onStartup.addListener(restoreCustomIcon);
chrome.runtime.onInstalled.addListener(restoreCustomIcon);

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
        // Monotonic token: two debounced searches can overlap across a fast
        // input burst (a slow bookmarks.search for an earlier query may
        // resolve AFTER a faster later one). The stale result must not clobber
        // firstResult/omniboxValue, or Enter opens the wrong bookmark.
        let omniboxToken = 0;
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
            const token = ++omniboxToken;
            omniboxValue = value;
            try {
                const results = await new Promise((resolve) => {
                    chrome.bookmarks.search(value, resolve);
                });
                if (token !== omniboxToken) {
                    return; // a newer input already took over — drop this stale result
                }
                if (!results.length) {
                    resetSuggest();
                    return;
                }
                const rankedResults = rankBookmarks(value, results);
                firstResult = rankedResults.shift();
                // matcher owns its regex escaping (search-core) — raw query in
                const firstTitle = matcher(xmlEncode(firstResult.title), value);
                const firstSyncStatus = getSyncStatusText(firstResult);
                let firstURL = {
                    text: xmlEncode(firstResult.url)
                };
                if (!firstTitle.matched) firstURL = matcher(firstURL.text, value);
                setSuggest(`${firstTitle.text} ${firstSyncStatus} <dim>-</dim> <url>${firstURL.text}</url>`);
                let suggestions = [];
                let i = 0, l = rankedResults.length;
                for (; i < l; i++) {
                    const result = rankedResults[i];
                    const title = matcher(xmlEncode(result.title), value);
                    const syncStatus = getSyncStatusText(result);
                    const URL = result.url;
                    let url = {
                        text: xmlEncode(URL)
                    };
                    if (!title.matched) url = matcher(url.text, value);
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
            if (!text) {
                resetSuggest();
                return;
            }
            const open = url => {
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
            };
            // v4 task-4 #11: Enter on the typed text opens the top hit — but
            // only while firstResult still belongs to THIS text. The suggest
            // callback is debounced 250ms, so a fast typist can beat it;
            // without the search fallback below the raw query went into
            // tabs.update as if it were a URL and died silently.
            if (text === omniboxValue && firstResult) {
                open(firstResult.url);
                return;
            }
            // A picked suggestion row carries the bookmark URL as its text.
            if (/^https?:\/\//i.test(text)) {
                open(text);
                return;
            }
            chrome.bookmarks.search(text, results => {
                if (!results || !results.length)
                    return;
                open(rankBookmarks(text, results)[0].url);
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
// duplicated id would raise a runtime error). Issue #49: gated on the
// `quickAddContextMenu` setting (default on) — off removes the entry entirely,
// and the chrome.storage.onChanged listener below makes the toggle live so an
// options-page flip takes effect without waiting for the next SW cold start.
const QUICK_ADD_MENU_ID = 'vbm-quick-add';
if (chrome.contextMenus) {
    // Serialize the remove→create cycles. contextMenus calls are async, so
    // overlapping applyQuickAddMenu calls (SW startup × onInstalled — every
    // dev reload — or a storage flip while a startup cycle is in flight) would
    // each run their own remove callback and then both create(): the second
    // create() raised "Cannot create item with duplicate id vbm-quick-add"
    // (an unchecked runtime.lastError). Only the latest requested state
    // matters; a cycle that finishes with a newer state pending re-runs once.
    let quickAddMenuBusy = false;
    let quickAddMenuPending = null;
    const applyQuickAddMenu = on => {
        quickAddMenuPending = on;
        if (quickAddMenuBusy)
            return;
        quickAddMenuBusy = true;
        const run = () => {
            const want = quickAddMenuPending;
            chrome.contextMenus.remove(QUICK_ADD_MENU_ID, () => {
                void chrome.runtime.lastError; // the menu simply didn't exist yet
                if (want) {
                    chrome.contextMenus.create({
                        id: QUICK_ADD_MENU_ID,
                        contexts: ['page'],
                        title: chrome.i18n.getMessage('contextMenuAddBookmark')
                    }, () => {
                        void chrome.runtime.lastError; // serialized, but a residual duplicate must not surface
                    });
                }
                quickAddMenuBusy = false;
                if (quickAddMenuPending !== want) {
                    run(); // state changed mid-cycle — apply the latest
                }
            });
        };
        run();
    };
    const createQuickAddMenu = () => {
        // quickAddContextMenu lives in the sync area since the 2026-08
        // storage audit (small cross-device preference; store.js routes it).
        chrome.storage.sync.get({ quickAddContextMenu: '1' }, data => {
            applyQuickAddMenu(!!data.quickAddContextMenu && data.quickAddContextMenu !== 'false');
        });
    };
    chrome.runtime.onInstalled.addListener(createQuickAddMenu);
    chrome.storage.onChanged.addListener((changes, area) => {
        // Accept both areas: post-migration writes land in sync, but a
        // pre-migration local write (older options page mid-upgrade) must
        // still apply live.
        if ((area !== 'sync' && area !== 'local') || !('quickAddContextMenu' in changes))
            return;
        // Read the change event's newValue instead of re-reading storage:
        // a fast second flip could settle before the first event's async
        // get() ran, and its stale value then re-created (or removed) the
        // menu against the final state (#49). A key removal (newValue
        // undefined) maps to the same default-on as the startup read.
        const value = changes.quickAddContextMenu.newValue;
        applyQuickAddMenu(value === undefined || (!!value && value !== 'false'));
    });
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