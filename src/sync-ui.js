// Sync status indicator wiring (P1 module, extracted from neat.js).
// Listens for SyncManager's `syncStatusChanged` window events and keeps the
// .sync-indicator badges on tree rows and search-result rows in sync.
// src/sync-manager.js stays a classic script exposing window.syncManager;
// this module only talks to that global plus the DOM. No neatools inside.

export function initSyncUi(ctx) {
    const store = ctx.store;

    // Update individual bookmark sync status
    const updateBookmarkSyncStatus = (bookmarkId, syncStatus) => {
        const treeItem = document.getElementById(`neat-tree-item-${bookmarkId}`);
        const resultsItem = document.getElementById(`results-item-${bookmarkId}`);

        [treeItem, resultsItem].forEach(item => {
            if (item) {
                const syncIndicator = item.querySelector('.sync-indicator');
                if (syncIndicator) {
                    syncIndicator.remove();
                }

                if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && window.syncManager) {
                    const statusClass = window.syncManager.getSyncStatusIndicator(bookmarkId);
                    const tooltip = window.syncManager.getSyncTooltip(bookmarkId);
                    if (statusClass) {
                        const newIndicator = document.createElement('span');
                        newIndicator.className = `sync-indicator ${statusClass}`;
                        newIndicator.title = tooltip;
                        newIndicator.innerHTML = `<span class="sync-tooltip">${tooltip}</span>`;

                        // Insert into the favicon container
                        const containerElement = item.querySelector('.tree-item-link') || item.querySelector('.tree-item-span');
                        const faviconContainer = containerElement ? containerElement.querySelector('.favicon-container') : null;
                        if (faviconContainer) {
                            faviconContainer.appendChild(newIndicator);
                        } else {
                            // Fallback to old logic
                            const fallbackContainer = item.querySelector('a') || item.querySelector('span');
                            const imgElement = fallbackContainer.querySelector('img');
                            if (imgElement && imgElement.nextSibling) {
                                fallbackContainer.insertBefore(newIndicator, imgElement.nextSibling);
                            } else {
                                fallbackContainer.appendChild(newIndicator);
                            }
                        }
                    }
                }
            }
        });
    };

    // Refresh all sync indicators in the UI
    const refreshSyncIndicators = () => {
        if (window.syncManager) {
            window.syncManager.refreshAllSyncStatus();
        }
        // Update existing UI elements
        const allTreeItems = document.querySelectorAll('[id^="neat-tree-item-"], [id^="results-item-"]');
        allTreeItems.forEach(item => {
            const bookmarkId = item.id.replace(/^neat-tree-item-/, '').replace(/^results-item-/, '');
            if (bookmarkId && window.syncManager) {
                const statusClass = window.syncManager.getSyncStatusIndicator(bookmarkId);
                const tooltip = window.syncManager.getSyncTooltip(bookmarkId);

                const syncIndicator = item.querySelector('.sync-indicator');
                if (syncIndicator) {
                    syncIndicator.remove();
                }

                if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && statusClass) {
                    const newIndicator = document.createElement('span');
                    newIndicator.className = `sync-indicator ${statusClass}`;
                    newIndicator.title = tooltip;
                    newIndicator.innerHTML = `<span class="sync-tooltip">${tooltip}</span>`;

                    // Insert into the favicon container
                    const containerElement = item.querySelector('.tree-item-link') || item.querySelector('.tree-item-span');
                    const faviconContainer = containerElement ? containerElement.querySelector('.favicon-container') : null;
                    if (faviconContainer) {
                        faviconContainer.appendChild(newIndicator);
                    } else {
                        // Fallback to old logic
                        const fallbackContainer = item.querySelector('a') || item.querySelector('span');
                        const imgElement = fallbackContainer.querySelector('img');
                        if (imgElement && imgElement.nextSibling) {
                            fallbackContainer.insertBefore(newIndicator, imgElement.nextSibling);
                        } else {
                            fallbackContainer.appendChild(newIndicator);
                        }
                    }
                }
            }
        });
    };

    // Listen for sync status changes
    const initializeSyncControls = () => {
        if (window.addEventListener && window.syncManager) {
            window.addEventListener('syncStatusChanged', (event) => {
                // Update UI based on sync status changes
                const { bookmarkId, status } = event.detail;
                if (bookmarkId && status) {
                    updateBookmarkSyncStatus(bookmarkId, status);
                }
            });
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSyncControls);
    } else {
        initializeSyncControls();
    }

    // Expose neat functions to window (legacy surface, kept as-is)
    window.neat = {
        refreshSyncIndicators: refreshSyncIndicators
    };

    return { updateBookmarkSyncStatus, refreshSyncIndicators };
}
