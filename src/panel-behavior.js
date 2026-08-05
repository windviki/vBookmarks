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
//
// v4 task-3 #19: the bare marker cannot prove a LIVE panel. storage.session
// can outlive the panel page when the browser crashes or the panel renderer
// is killed without pagehide — the stale `sidePanelIsOpen: true` then made
// every worker start re-derive toggle mode with the option OFF, so clicking
// the action kept opening/closing the side panel forever (the "历史版本数据
// 残留" report). The panel page now heartbeats `sidePanelHeartbeat`
// (Date.now) every PANEL_HEARTBEAT_MS; a marker counts as live only with a
// heartbeat fresher than PANEL_STALE_MS. Stale markers are removed on read.
//
// Final-polish fix ("关掉选项后点击仍是面板开闭"): even the heartbeat can
// outlive the panel — pagehide is not guaranteed on a normal action-toggle
// close, and for up to PANEL_STALE_MS afterwards the fresh heartbeat made
// readPanelLive answer "live", so turning the option OFF still derived
// toggle mode and the next action click RE-OPENED the panel (which refreshed
// the heartbeat — the user never got the popup back). Chrome 116+ gives an
// authoritative liveness check, chrome.runtime.getContexts(SIDE_PANEL): a
// dead panel never appears there, whatever storage.session says. It is now
// the primary probe; the marker+heartbeat path remains the fallback for the
// manifest's minimum (Chrome 114/115, no runtime.getContexts).

export const PANEL_HEARTBEAT_MS = 20000;
export const PANEL_STALE_MS = 90000; // > 4 heartbeats; slack for timer throttling

export const initPanelBehavior = () => {
    const applyPanelBehavior = open => {
        chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: open }).catch(() => {});
    };

    // Option off → toggle only while a panel is live; option on → always.
    const applyFromState = (optionOn, panelOpen) => {
        applyPanelBehavior(optionOn || panelOpen);
    };

    // --- Popup-restore signal (final-polish gap) ----------------------------
    // Closing the panel via the action toggle does NOT reliably fire pagehide,
    // so the SW never sees the sidePanelIsOpen → false transition and
    // `openPanelOnActionClick: true` stays in force — the next icon click
    // RE-OPENS the panel and the popup can never come back. Two authoritative
    // signals restore it:
    //   - Chrome 142+: sidePanel.onClosed fires the instant the panel dies.
    //   - Chrome 114–141: a GATED chrome.alarms poll re-runs readPanelLive
    //     (the getContexts liveness probe) while the action is in the
    //     ambiguous state (option off + panel possibly live); a dead panel
    //     drops to popup mode and the poll cancels itself. The alarm only
    //     exists in exactly the window where the bug can occur.
    const livenessAlarm = 'vbm-panel-liveness';
    // The alarms API returns promises; some test doubles / older Chrome
    // surfaces may not, so a bare `.catch` would throw on a non-promise.
    const ignore = p => { if (p && p.catch) p.catch(() => {}); };
    const startPoll = () => {
        if (!chrome.alarms || !chrome.alarms.create)
            return;
        ignore(chrome.alarms.create(livenessAlarm, { periodInMinutes: 0.5 }));
    };
    const stopPoll = () => {
        if (!chrome.alarms || !chrome.alarms.clear)
            return;
        ignore(chrome.alarms.clear(livenessAlarm));
    };
    // The async liveness probe may land AFTER the user flipped the option back
    // on (or the panel closed). Every recovery path re-reads the option inside
    // its callback so a stale "popup mode" decision can never clobber a newer
    // "option on" state — and only then applies the change.
    const recoverIfDead = () => {
        chrome.storage.local.get('openInSidePanel', data => {
            if (data.openInSidePanel) {
                stopPoll(); // the option governs — no ambiguity to watch
                return;
            }
            readPanelLive(live => {
                // Re-read inside the callback: an option flip that landed while
                // getContexts was in flight must win over this stale answer.
                chrome.storage.local.get('openInSidePanel', data2 => {
                    if (data2.openInSidePanel) {
                        stopPoll();
                        return;
                    }
                    if (!live) {
                        applyPanelBehavior(false);
                        stopPoll();
                    }
                });
            });
        });
    };
    if (chrome.alarms && chrome.alarms.onAlarm) {
        chrome.alarms.onAlarm.addListener(alarm => {
            if (alarm && alarm.name !== livenessAlarm)
                return;
            recoverIfDead();
        });
    }
    if (chrome.sidePanel && chrome.sidePanel.onClosed) {
        chrome.sidePanel.onClosed.addListener(() => {
            // The panel really died. Clear the stale session marker FIRST so a
            // concurrently in-flight getContexts that still answers "live"
            // (the destroy had not completed when the probe was issued) cannot
            // re-derive toggle mode from it.
            ignore(chrome.storage.session.remove(['sidePanelIsOpen', 'sidePanelHeartbeat']));
            recoverIfDead();
        });
    }

    // #19: marker + fresh heartbeat = live panel. A marker without one is
    // residue from a dead panel — drop it so it stops being re-derived.
    // Final polish: chrome.runtime.getContexts (Chrome 116+) is the
    // authoritative probe — it only ever lists LIVE panel pages, so a closed
    // panel stops deriving toggle mode the moment it actually dies instead
    // of up to PANEL_STALE_MS later.
    const readPanelLive = cb => {
        if (chrome.runtime && typeof chrome.runtime.getContexts === 'function') {
            chrome.runtime.getContexts({ contextTypes: ['SIDE_PANEL'] })
                .then(contexts => cb((contexts || []).length > 0))
                .catch(() => cb(false));
            return;
        }
        chrome.storage.session.get(['sidePanelIsOpen', 'sidePanelHeartbeat'], session => {
            const live = !!session.sidePanelIsOpen
                && typeof session.sidePanelHeartbeat === 'number'
                && Date.now() - session.sidePanelHeartbeat < PANEL_STALE_MS;
            if (session.sidePanelIsOpen && !live)
                chrome.storage.session.remove(['sidePanelIsOpen', 'sidePanelHeartbeat']);
            cb(live);
        });
    };

    // Re-derive the behavior at every service worker startup.
    chrome.storage.local.get('openInSidePanel', data => {
        if (data.openInSidePanel) {
            applyPanelBehavior(true);
            stopPoll(); // the option governs — nothing ambiguous to watch
        } else {
            readPanelLive(live => {
                applyFromState(false, live);
                // Ambiguous state (panel possibly live): watch for its death so
                // a toggle-close that skips pagehide still restores the popup.
                if (live) startPoll();
                else stopPoll();
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
                stopPoll(); // the option governs — no liveness to watch
            } else {
                // 用户关闭了边栏选项：检查当前面板是否存活（心跳判定）
                // 若面板打开中，保持 toggle 模式以便下次点击关闭面板，并
                // 开启存活轮询——面板被 action-toggle 关掉时 pagehide 不
                // 保证触发，轮询负责在那之后把 action 恢复成 popup 模式。
                readPanelLive(live => {
                    // Re-read inside the callback: an option flip back ON while
                    // getContexts was in flight must win (F3 guard).
                    chrome.storage.local.get('openInSidePanel', data2 => {
                        if (data2.openInSidePanel) {
                            stopPoll();
                            return;
                        }
                        applyFromState(false, live);
                        if (live) startPoll();
                        else stopPoll();
                    });
                });
            }
        }
        // 侧边栏打开/关闭状态变化（由 popup.js 在 IS_PANEL 模式下写入）
        // 仅在用户未开启边栏选项时动态切换 action 行为。标记写/删即面板
        // 页面的生/死通告，此处无需再看心跳。
        if (areaName === 'session' && 'sidePanelIsOpen' in changes) {
            chrome.storage.local.get('openInSidePanel', data => {
                if (!data.openInSidePanel) {
                    applyFromState(false, !!changes.sidePanelIsOpen.newValue);
                    // Panel open (and possibly killed without pagehide) →
                    // watch its death; panel closed → nothing left to watch.
                    if (changes.sidePanelIsOpen.newValue) startPoll();
                    else stopPoll();
                }
            });
        }
    });
};
