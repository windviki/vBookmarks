/**
 * Tab-group opener service-worker runner (P3.4 hardening).
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
 * Degradation: on Chrome too old for `chrome.tabs.group`/`chrome.tabGroups`
 * both messages fall back to a plain batch-open (no error, no group); an
 * `open-into` whose group is gone (window closed between query and open)
 * degrades the same way via the lastError guard, and a window that closes
 * after the get makes the creates fail with a window lastError — retried
 * once without windowId, again a plain open.
 *
 * The module only touches the chrome global inside functions, so tests
 * inject a double on globalThis before createTabGroupOpener() (same recipe
 * as dead-scan-sw.js / visit-stats-sw.js / sync-engine.js).
 */

export const TAB_GROUP_MSG = {
    openNew: 'vbm-tab-group-open-new',
    openInto: 'vbm-tab-group-open-into'
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

    const onMessage = msg => {
        if (!msg || !msg.type)
            return;
        if (msg.type === TAB_GROUP_MSG.openNew)
            openNewGroup(msg.urls, msg.title, msg.color);
        else if (msg.type === TAB_GROUP_MSG.openInto)
            openIntoGroup(msg.urls, msg.groupId);
    };

    const start_ = () => {
        if (started)
            return;
        started = true;
        chrome.runtime.onMessage.addListener(onMessage);
    };

    // start() is what background.js calls; the rest is test surface.
    return { start: start_, onMessage, openNewGroup, openIntoGroup };
}
