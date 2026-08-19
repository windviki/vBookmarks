/**
 * Tab-group + tab-batch service-worker runner (P3.4 hardening + tab-groups view).
 *
 * The folder/bookmark "open as a tab group" pipeline used to live in the
 * popup page: it created tabs (first one `active: true`) and grouped them
 * only after every `chrome.tabs.create` callback fired. Activating that
 * first tab closes the popup, which drops the pending callbacks — so on a
 * real browser the tabs opened but the group never formed (vitest stubs
 * fire callbacks synchronously and never caught it). The whole open+group
 * operation now runs here, in the service worker that outlives any page:
 *
 * - `vbm-tab-group-open-new` { urls, title, color } — open the urls and
 *   wrap the new tabs in one named/colored group.
 * - `vbm-tab-group-open-into` { urls, groupId } — open the urls in the
 *   window that owns `groupId` and add the new tabs to that existing group
 *   (a tab can only join a group in its own window).
 *
 * The tab-groups view adds batch tab management messages. They run here for
 * the same reason: close/discard/group operations may close the popup's own
 * tab mid-flight, and a service worker outlives it.
 *
 * - `vbm-tabs-new-group` { moveIds, copyTabs, title, color, windowId } —
 *   create copies for `copyTabs` (already-grouped tabs the user chose to
 *   copy), then group `moveIds` + the copies into one new named/colored
 *   group.
 * - `vbm-tabs-open-into` { moveIds, copyTabs, groupId } — same, but the
 *   tabs are added to an existing group (moving `moveIds` into the group's
 *   window first when they live elsewhere).
 * - `vbm-tabs-close` { tabIds } — close the selected tabs.
 * - `vbm-tabs-discard` { tabIds } — discard (sleep) the selected tabs.
 *
 * Degradation: on Chrome too old for `chrome.tabs.group`/`chrome.tabGroups`
 * both open-* messages fall back to a plain batch-open; the tab-batch
 * messages still close/discard, and grouping ones no-op (copies are still
 * created so the user's tabs are never lost).
 *
 * The module only touches the chrome global inside functions, so tests
 * inject a double on globalThis before createTabGroupOpener() (same recipe
 * as dead-scan-sw.js / visit-stats-sw.js / sync-engine.js).
 */

export const TAB_GROUP_MSG = {
    openNew: 'vbm-tab-group-open-new',
    openInto: 'vbm-tab-group-open-into',
    tabsNewGroup: 'vbm-tabs-new-group',
    tabsOpenInto: 'vbm-tabs-open-into',
    tabsClose: 'vbm-tabs-close',
    tabsDiscard: 'vbm-tabs-discard',
    tabsMoveNewWindow: 'vbm-tabs-move-new-window'
};

export function createTabGroupOpener() {
    let started = false;

    // Feature gate for the whole tab-groups surface (Chrome 88+).
    const canGroup = () => !!(chrome.tabs.group && chrome.tabGroups);

    // Shared fallback: open the urls without any grouping.
    const plainOpen = urls => {
        chrome.tabs.create({ url: urls[0], active: true });
        for (let i = 1; i < urls.length; i++)
            chrome.tabs.create({ url: urls[i], active: false });
    };

    // Open `urls` as one new tab group titled `title` and colored `color`.
    const openNewGroup = (urls, title, color) => {
        if (!urls || !urls.length)
            return;
        if (!canGroup()) {
            plainOpen(urls);
            return;
        }
        const tabIds = [];
        let pending = urls.length;
        const onCreated = tab => {
            // A failed create (unopenable URL, etc.) must not wedge the
            // chain: skip the tab but still count it down, and group
            // whatever did open.
            if (!chrome.runtime.lastError && tab)
                tabIds.push(tab.id);
            if (--pending > 0)
                return;
            if (!tabIds.length)
                return; // every create failed — nothing to group
            chrome.tabs.group({ tabIds }, groupId => {
                if (chrome.runtime.lastError)
                    return; // grouping failed — the tabs are already open
                chrome.tabGroups.update(groupId, {
                    title: title || '',
                    color: color || 'grey'
                });
            });
        };
        chrome.tabs.create({ url: urls[0], active: true }, onCreated);
        for (let i = 1; i < urls.length; i++)
            chrome.tabs.create({ url: urls[i], active: false }, onCreated);
    };

    // Open `urls` as tabs added to the existing group `groupId`. Tabs can
    // only join a group inside the group's own window, so the target window
    // is resolved first and the new tabs are created there.
    const openIntoGroup = (urls, groupId) => {
        if (!urls || !urls.length)
            return;
        if (!canGroup()) {
            plainOpen(urls);
            return;
        }
        chrome.tabGroups.get(groupId, group => {
            if (chrome.runtime.lastError || !group) {
                // The group is gone (its window closed) — degrade to plain
                // open rather than dropping the user's tabs.
                plainOpen(urls);
                return;
            }
            const windowId = group.windowId;
            const tabIds = [];
            let pending = urls.length;
            let fellBack = false;
            const onCreated = tab => {
                if (!chrome.runtime.lastError && tab) {
                    tabIds.push(tab.id);
                } else {
                    // The window closed between the get and this create —
                    // retry once without windowId as a plain open (the
                    // header's degradation promise). Any other failure just
                    // skips the tab, same as openNewGroup.
                    const err = chrome.runtime.lastError;
                    if (!fellBack && err && /window/i.test(err.message || '')) {
                        fellBack = true;
                        plainOpen(urls);
                    }
                }
                if (--pending > 0)
                    return;
                if (!tabIds.length)
                    return; // nothing opened in the group's window
                chrome.tabs.group({ tabIds, groupId }, () => {
                    // Tabs land in the group; a lastError here (group closed
                    // between the get and this call) leaves them plain.
                    void chrome.runtime.lastError;
                });
            };
            chrome.tabs.create({ url: urls[0], active: true, windowId }, onCreated);
            for (let i = 1; i < urls.length; i++)
                chrome.tabs.create({ url: urls[i], active: false, windowId }, onCreated);
        });
    };

    // --- Batch tab management (tab-groups view) ----------------------------
    // Promise wrappers around the callback APIs keep the mixed create/move/
    // group chains readable and deterministic under the test doubles.

    const createCopy = (spec, windowId) => new Promise(resolve => {
        chrome.tabs.create({
            url: spec.url,
            active: false,
            ...(windowId ? { windowId } : {})
        }, tab => {
            if (!chrome.runtime.lastError && tab)
                resolve(tab.id);
            else
                resolve(null);
        });
    });

    const createCopies = (copyTabs, windowId) => {
        const specs = copyTabs || [];
        return specs.reduce((chain, spec) =>
            chain.then(ids => createCopy(spec, windowId).then(id => {
                if (id)
                    ids.push(id);
                return ids;
            })), Promise.resolve([]));
    };

    // Move one existing tab into a window (used before adding it to an
    // existing group in another window). Returns its id when it stays valid,
    // or null when the tab is gone.
    const moveTabToWindow = (tabId, windowId) => new Promise(resolve => {
        chrome.tabs.get(tabId, tab => {
            if (chrome.runtime.lastError || !tab) {
                resolve(null);
                return;
            }
            if (tab.windowId === windowId) {
                resolve(tabId);
                return;
            }
            if (!chrome.tabs.move) {
                resolve(tabId); // no move API — the later tabs.group decides
                return;
            }
            chrome.tabs.move(tabId, { windowId, index: -1 }, moved => {
                if (!chrome.runtime.lastError && moved)
                    resolve(moved.id);
                else
                    resolve(tabId); // group may still accept or degrade
            });
        });
    });

    const moveTabsToWindow = (tabIds, windowId) => {
        const ids = tabIds || [];
        return ids.reduce((chain, id) =>
            chain.then(out => moveTabToWindow(id, windowId).then(moved => {
                if (moved)
                    out.push(moved);
                return out;
            })), Promise.resolve([]));
    };

    // Group existing (and copied) tabs into a NEW named/colored group.
    const groupExistingIntoNew = (moveIds, copyTabs, title, color, windowId, done) => {
        const finish = () => { if (done) done(); };
        if (!canGroup()) {
            // Still honor the copy half of the user's choice.
            createCopies(copyTabs, windowId).then(finish);
            return;
        }
        // Tabs can only be grouped inside one window: first move existing
        // tabs into the target window (the current window for "new group"),
        // then group them together with any copies.
        moveTabsToWindow(moveIds, windowId).then(movedIds => {
            createCopies(copyTabs, windowId).then(copyIds => {
                const ids = [].concat(movedIds, copyIds);
                if (!ids.length) {
                    finish();
                    return;
                }
                chrome.tabs.group({ tabIds: ids }, groupId => {
                    if (chrome.runtime.lastError) {
                        finish();
                        return;
                    }
                    chrome.tabGroups.update(groupId, {
                        title: title || '',
                        color: color || 'grey'
                    }, finish);
                });
            });
        });
    };

    // Add existing (and copied) tabs to an EXISTING group. `moveIds` are
    // first moved into the group's window (if needed), then grouped.
    const groupExistingIntoExisting = (moveIds, copyTabs, groupId, done) => {
        const finish = () => { if (done) done(); };
        if (!canGroup()) {
            createCopies(copyTabs).then(finish);
            return;
        }
        chrome.tabGroups.get(groupId, group => {
            if (chrome.runtime.lastError || !group) {
                finish();
                return;
            }
            const windowId = group.windowId;
            moveTabsToWindow(moveIds, windowId).then(movedIds => {
                createCopies(copyTabs, windowId).then(copyIds => {
                    const ids = [].concat(movedIds, copyIds);
                    if (!ids.length) {
                        finish();
                        return;
                    }
                    chrome.tabs.group({ tabIds: ids, groupId }, () => {
                        void chrome.runtime.lastError;
                        finish();
                    });
                });
            });
        });
    };

    const closeTabs = tabIds => {
        const ids = tabIds || [];
        if (ids.length)
            chrome.tabs.remove(ids);
    };

    const discardTabs = tabIds => {
        const ids = tabIds || [];
        for (let i = 0; i < ids.length; i++) {
            if (chrome.tabs.discard)
                chrome.tabs.discard(ids[i]);
        }
    };

    // Move a tab group to a fresh window. Chrome has no direct "move
    // group" API, so the whole member set is moved with tabs.move and the
    // new window's initial blank tab is closed afterwards.
    const moveTabsToNewWindow = (tabIds, done) => {
        const finish = () => { if (done) done(); };
        const ids = tabIds || [];
        if (!ids.length) {
            finish();
            return;
        }
        if (!chrome.windows || !chrome.windows.create) {
            finish();
            return;
        }
        chrome.windows.create({ focused: true }, win => {
            if (chrome.runtime.lastError || !win) {
                finish();
                return;
            }
            const move = () => {
                if (!chrome.tabs.move) {
                    finish();
                    return;
                }
                chrome.tabs.move(ids, { windowId: win.id, index: -1 }, () => {
                    void chrome.runtime.lastError;
                    // Best-effort cleanup of the new window's initial tab.
                    if (chrome.tabs.query) {
                        chrome.tabs.query({ windowId: win.id }, tabs => {
                            const keep = new Set(ids.map(String));
                            for (const t of tabs || []) {
                                if (!keep.has(String(t.id)) && chrome.tabs.remove)
                                    chrome.tabs.remove(t.id);
                            }
                            finish();
                        });
                    } else {
                        finish();
                    }
                });
            };
            move();
        });
    };

    const onMessage = (msg, sender, sendResponse) => {
        if (!msg || !msg.type)
            return;
        if (msg.type === TAB_GROUP_MSG.openNew)
            openNewGroup(msg.urls, msg.title, msg.color);
        else if (msg.type === TAB_GROUP_MSG.openInto)
            openIntoGroup(msg.urls, msg.groupId);
        else if (msg.type === TAB_GROUP_MSG.tabsNewGroup) {
            groupExistingIntoNew(msg.moveIds, msg.copyTabs, msg.title, msg.color, msg.windowId,
                () => { if (sendResponse) sendResponse({ ok: true }); });
            return true; // async completion: refresh the view when grouping landed
        }
        else if (msg.type === TAB_GROUP_MSG.tabsOpenInto) {
            groupExistingIntoExisting(msg.moveIds, msg.copyTabs, msg.groupId,
                () => { if (sendResponse) sendResponse({ ok: true }); });
            return true;
        }
        else if (msg.type === TAB_GROUP_MSG.tabsClose)
            closeTabs(msg.tabIds);
        else if (msg.type === TAB_GROUP_MSG.tabsDiscard)
            discardTabs(msg.tabIds);
        else if (msg.type === TAB_GROUP_MSG.tabsMoveNewWindow) {
            moveTabsToNewWindow(msg.tabIds,
                () => { if (sendResponse) sendResponse({ ok: true }); });
            return true;
        }
    };

    const start_ = () => {
        if (started)
            return;
        started = true;
        chrome.runtime.onMessage.addListener(onMessage);
    };

    // start() is what background.js calls; the rest is test surface.
    return {
        start: start_,
        onMessage,
        openNewGroup,
        openIntoGroup,
        groupExistingIntoNew,
        groupExistingIntoExisting,
        closeTabs,
        discardTabs,
        moveTabsToNewWindow
    };
}
