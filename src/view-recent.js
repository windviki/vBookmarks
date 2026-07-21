/**
 * Recent bookmarks view (v4 task 2, slice B).
 *
 * Extracted from tree-view.js's virtual recent section (§2.1).
 * Owns: chrome.bookmarks.getRecent(N) fetch, bookmark HTML rendering via
 * treeRender.generateBookmarkHTML, separator filtering, onCreated/onRemoved
 * + 300ms debounced refresh, "reveal in tree" jump (right-click + R key),
 * and arrow-key keyboard navigation (via list-keyboard.js).
 *
 * initViewRecent(ctx) — called once by neat.js after treeView/treeRender init.
 * ctx.store          — settings mirror (showRecentBookmarks, recentCount, deadMarks)
 * ctx.treeRender     — tree-render.js generateBookmarkHTML
 * ctx.separatorManager — isSeparator filtering
 * ctx.actions        — openBookmark etc.
 * ctx.treeView       — revealFolder for "reveal in tree"
 * ctx.viewManager    — view-manager.js (for activate)
 * ctx.search         — search.js (reset state on link-folder click)
 */
import { initListKeyboard } from './list-keyboard.js';

export function initViewRecent(ctx = {}) {
    const $ = id => document.getElementById(id);
    const store = ctx.store;
    const treeRender = ctx.treeRender;
    const separatorManager = ctx.separatorManager;
    const actions = ctx.actions;
    const treeView = ctx.treeView;
    const viewManager = ctx.viewManager;
    const search = ctx.search;
    const _m = chrome.i18n.getMessage;

    const container = $('recent-content');
    if (!container) return { activate() {}, deactivate() {}, refresh() {} };

    const recentEnabled = () => !!store.get('showRecentBookmarks', '1');
    const recentCount = () => {
        const v = parseInt(store.get('recentCount', '20'), 10);
        return v > 0 ? v : 20;
    };

    // Build dead-marks set for overlay rendering
    const getDeadMarks = () => {
        try {
            const raw = store.get('deadMarks');
            if (!raw) return new Set();
            const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return new Set(arr || []);
        } catch (e) { return new Set(); }
    };

    // Render one bookmark row with timestamp, path label, and dead mark
    const renderRow = (bookmark) => {
        const deadMarks = getDeadMarks();
        const deadOverlay = deadMarks.has(bookmark.id)
            ? '<span class="dead-mark" aria-label="Marked as dead link"></span>' : '';
        const showPath = store.get('showItemPath', '1') !== 'false';
        const dateStr = bookmark.dateAdded
            ? new Date(bookmark.dateAdded).toLocaleString()
            : '';

        // Two-line layout: title + metadata row (path | date)
        return `<li class="child vbm-row" id="neat-recent-item-${bookmark.id}" ` +
            `level="0" role="treeitem" data-node-id="${bookmark.id}" data-parentid="${bookmark.parentId}">` +
            `<div class="recent-row-wrapper">` +
            treeRender.generateBookmarkHTML(bookmark.title, bookmark.url,
                'style="-webkit-padding-start: 0px" data-virtual="1"', bookmark.id) +
            deadOverlay +
            `<div class="recent-meta">` +
            (showPath ? `<span class="row-path" data-parentid="${bookmark.parentId}" dir="auto">...</span>` : '') +
            (dateStr ? `<span class="recent-date">${dateStr}</span>` : '') +
            `</div></div></li>`;
    };

    const refresh = () => {
        if (!recentEnabled()) {
            container.innerHTML = '';
            return;
        }
        chrome.bookmarks.getRecent(recentCount(), items => {
            let html = '<ul role="list">';
            let count = 0;
            for (let i = 0; i < items.length; i++) {
                const d = items[i];
                if (!d.url || separatorManager.isSeparator(d.title, d.url))
                    continue;
                html += renderRow(d);
                count++;
            }
            if (!count) {
                html += `<li class="empty-state"><i>${_m('recentEmpty') || 'Press Ctrl+D to bookmark the current page.'}</i></li>`;
            }
            html += '</ul>';
            container.innerHTML = html;

            // Resolve parent folder names for path labels
            if (store.get('showItemPath', '1') !== 'false') {
                container.querySelectorAll('.row-path').forEach(el => {
                    const pid = el.dataset.parentid;
                    if (pid) {
                        chrome.bookmarks.get(pid, nodes => {
                            if (nodes && nodes.length) {
                                el.textContent = nodes[0].title || '';
                            }
                        });
                    }
                });
            }
        });
    };

    // Debounced refresh (300ms), skipped when not active
    let refreshTimer = null;
    const scheduleRefresh = () => {
        if (!recentEnabled()) return;
        if (viewManager && viewManager.getActiveId() !== 'recent') return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
    };

    chrome.bookmarks.onCreated.addListener(scheduleRefresh);
    chrome.bookmarks.onRemoved.addListener(scheduleRefresh);

    // Click handler: support link-folder jumps and regular bookmark opens
    container.addEventListener('click', e => {
        const a = e.target.closest('a');
        if (!a) return;
        e.preventDefault();
        const li = a.closest('li');
        if (!li) return;
        const id = li.id.replace('neat-recent-item-', '');

        if (a.classList.contains('link-folder')) {
            // Jump to tree
            search.reset();
            viewManager.activate('tree');
            treeView.revealFolder(id);
            return;
        }

        // Regular bookmark open
        const ctrlMeta = e.ctrlKey || e.metaKey || e.button === 1;
        const shift = e.shiftKey;
        // v4 task 2 slice D: record visit on bookmark open
        actions.recordVisit(id);

        if (ctrlMeta) {
            actions.openBookmarkNewTab(a.href, !shift);
        } else if (shift) {
            actions.openBookmarkNewWindow(a.href);
        } else {
            actions.openBookmark(a.href);
        }
    });

    // v4 task 2: arrow-key keyboard navigation (list-keyboard.js)
    initListKeyboard(container, {
        onEnter(id) {
            // Open bookmark on Enter
            chrome.bookmarks.get(id, nodes => {
                if (nodes && nodes.length && nodes[0].url) {
                    actions.recordVisit(id);
                    actions.openBookmark(nodes[0].url);
                }
            });
        }
    });

    // Right-click: let the existing context-menu.js handle it naturally.
    // context-menu.js already strips neat-recent-item- prefix and shows the
    // bookmark context menu (Open/Edit/Delete/etc). No custom handler needed.

    // Keyboard: Delete to remove, R to reveal in tree
    container.addEventListener('keyup', e => {
        if (e.key !== 'Delete' && e.key !== 'r' && e.key !== 'R') return;
        const li = e.target.closest('li');
        if (!li) return;
        const id = li.id.replace('neat-recent-item-', '');
        if (e.key === 'Delete') {
            e.preventDefault();
            actions.deleteBookmark(id);
        } else if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            // Reveal the parent folder, then focus the bookmark itself
            const parentId = li.dataset.parentid;
            search.reset();
            viewManager.activate('tree');
            if (parentId) {
                treeView.revealBookmark ? treeView.revealBookmark(id, parentId) : treeView.revealFolder(parentId);
            } else {
                treeView.revealFolder(id);
            }
        }
    });

    return {
        activate() { refresh(); },
        deactivate() {},
        refresh
    };
}
