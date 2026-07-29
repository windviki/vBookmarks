// --- Side panel behavior (Phase 2b, extracted round-6 item 4) --------------
// popup.html doubles as the side panel page (manifest.side_panel). The panel
// is an opt-in enhancement (setting `openInSidePanel`, off by default): when
// enabled, clicking the action opens the panel instead of the popup.
//
// Toggle semantics while the option is OFF: the panel can be opened through
// other entries (Chrome's native action menu, the open-side-panel command).
// While such a panel is open, the action must stay in toggle mode so the
// next icon click CLOSES the panel instead of raising the popup over it —
// popup.js tracks the panel's lifetime in storage.session `sidePanelIsOpen`.
//
// Round-6 fix: the service worker cold-start used to look at the option
// only, resetting the action to popup mode whenever the option was off —
// even with a panel open (the "option sometimes does nothing" report).
// Chrome forgets setPanelBehavior across worker restarts, so startup must
// re-derive the behavior from option OR live panel state.

export const initPanelBehavior = () => {
    const applyPanelBehavior = open => {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: open }).catch(() => {});
    };

    // Option off → toggle only while a panel is live; option on → always.
    const applyFromState = (optionOn, panelOpen) => {
        applyPanelBehavior(optionOn || panelOpen);
    };

    // Re-derive the behavior at every service worker startup.
    chrome.storage.local.get('openInSidePanel', data => {
        if (data.openInSidePanel) {
            applyPanelBehavior(true);
        } else {
            chrome.storage.session.get('sidePanelIsOpen', session => {
                applyFromState(false, !!session.sidePanelIsOpen);
            });
        }
    });

    // React to setting/panel-state changes immediately (options page writes
    // chrome.storage.local; popup.js in panel mode writes storage.session).
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
                    applyFromState(false, !!session.sidePanelIsOpen);
                });
            }
        }
        // 侧边栏打开/关闭状态变化（由 popup.js 在 IS_PANEL 模式下写入）
        // 仅在用户未开启边栏选项时动态切换 action 行为
        if (areaName === 'session' && 'sidePanelIsOpen' in changes) {
            chrome.storage.local.get('openInSidePanel', data => {
                if (!data.openInSidePanel) {
                    applyFromState(false, !!changes.sidePanelIsOpen.newValue);
                }
            });
        }
    });
};
