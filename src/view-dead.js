/**
 * Dead links view (v4 task 2, slice C).
 *
 * Full replacement for palette.js's dead mode. Owns: last-scan cache,
 * scan lifecycle (start/abort with progress), dead-mark toggle overlay on
 * tree rows, batch mark/unmark, and status filtering.
 *
 * initViewDead(ctx)
 * ctx.store, ctx.treeRender, ctx.actions, ctx.dialogs, ctx.viewManager,
 * ctx.separatorManager, ctx.onChanged (tree rebuild after deletion)
 */

import { filterScannable, startDeadScan, collectDead, statusLabel, checkUrl } from './dead-links.js';
import { initListKeyboard } from './list-keyboard.js';

export function initViewDead(ctx = {}) {
    const $ = id => document.getElementById(id);
    const store = ctx.store;
    const treeRender = ctx.treeRender;
    const actions = ctx.actions;
    const dialogs = ctx.dialogs;
    const viewManager = ctx.viewManager;
    const separatorManager = ctx.separatorManager;
    const onChanged = ctx.onChanged || (() => {});
    const _m = chrome.i18n.getMessage;

    const treeView = ctx.treeView;
    const container = $('dead-content');
    if (!container) return { activate() {}, deactivate() {}, startScan() {} };

    let deadItems = [];       // scannable bookmarks of the current scan
    let deadResults = null;   // Map id → checkUrl result (null = no scan yet)
    let deadProgress = 0;
    let deadScan = null;      // { promise, abort }
    let scanFilter = 'all';   // 'all' | 'dead' | 'blocked'

    const isSeparator = separatorManager
        ? (title, url) => separatorManager.isSeparator(title, url)
        : null;

    // Get dead marks set from storage
    const getDeadMarks = () => {
        try {
            const raw = store.get('deadMarks');
            if (!raw) return new Set();
            const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
            return new Set(arr || []);
        } catch (e) { return new Set(); }
    };

    const setDeadMarks = (marks) => {
        store.set('deadMarks', JSON.stringify([...marks]));
        refreshBadge();
    };

    const refreshBadge = () => {
        if (viewManager && viewManager.refreshAllBadges) {
            setTimeout(() => viewManager.refreshAllBadges(), 50);
        }
    };

    const toggleMark = (id) => {
        const marks = getDeadMarks();
        if (marks.has(id)) marks.delete(id);
        else marks.add(id);
        setDeadMarks(marks);
        renderResults();
    };

    const markAll = () => {
        const marks = getDeadMarks();
        const filtered = getFiltered();
        for (const item of filtered) {
            marks.add(item.id);
        }
        setDeadMarks(marks);
        renderResults();
    };

    const unmarkAll = () => {
        store.set('deadMarks', '[]');
        if (viewManager && viewManager.refreshAllBadges) {
            viewManager.refreshAllBadges();
        }
        renderResults();
    };

    // Flatten tree
    const flattenTree = (tree) => {
        const items = [];
        const walk = (nodes) => {
            for (const node of nodes) {
                if (node.children) {
                    if (node.id !== '0') {
                        items.push({ id: node.id, title: node.title || '', url: '', isFolder: true });
                    }
                    walk(node.children);
                } else {
                    items.push({ id: node.id, title: node.title || '', url: node.url || '', isFolder: false });
                }
            }
        };
        walk(tree || []);
        return items;
    };

    // Load last scan cache
    const loadCache = () => {
        try {
            const raw = store.get('deadLastScan');
            if (!raw) return null;
            return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch (e) { return null; }
    };

    const saveCache = (results, scannedCount) => {
        const obj = {};
        for (const [id, result] of results) {
            obj[id] = result;
        }
        store.set('deadLastScan', JSON.stringify({
            ts: Date.now(),
            scannedCount,
            results: obj
        }));
    };

    // Load cache into deadResults Map
    const restoreCache = () => {
        const cache = loadCache();
        if (!cache || !cache.results) return false;
        deadResults = new Map(Object.entries(cache.results));
        return true;
    };

    const getFiltered = () => {
        if (!deadResults) return [];
        const all = collectDead(deadItems, deadResults);
        if (scanFilter === 'dead') return all.filter(item => {
            const r = deadResults.get(item.id);
            return r && r.status !== 'blocked' && !r.ok;
        });
        if (scanFilter === 'blocked') return all.filter(item => {
            const r = deadResults.get(item.id);
            return r && r.status === 'blocked';
        });
        return all;
    };

    const startScan = () => {
        deadResults = null;
        deadProgress = 0;
        scanFilter = 'all';

        chrome.bookmarks.getTree(tree => {
            const allItems = flattenTree(tree);
            deadItems = filterScannable(allItems, isSeparator);
            renderResults();

            const concurrency = parseInt(store.get('deadScanConcurrency', '4'), 10) || 4;
            const timeoutMs = (parseInt(store.get('deadScanTimeout', '8'), 10) || 8) * 1000;
            const proxyTemplate = store.get('deadProxyTemplate', '') || undefined;

            deadScan = startDeadScan(deadItems, {
                concurrency,
                timeoutMs,
                proxyTemplate,
                onProgress: done => {
                    deadProgress = done;
                    renderResults();
                }
            });

            deadScan.promise.then(results => {
                deadScan = null;
                deadResults = results;

                // Save cache
                saveCache(results, deadItems.length);

                // Auto-remove marks for ok results
                const marks = getDeadMarks();
                let changed = false;
                for (const [id, result] of results) {
                    if (result.ok && marks.has(id)) {
                        marks.delete(id);
                        changed = true;
                    }
                }
                if (changed) setDeadMarks(marks);

                renderResults();
            });
        });
    };

    const abortScan = () => {
        if (deadScan) {
            deadScan.abort();
            deadScan = null;
            // deadResults stays null (or partial from abort); show what we have
            renderResults();
        }
    };

    const renderResults = () => {
        const cache = loadCache();
        let html = '';

        // Top action row (row 0): scan controls + progress (§3.5)
        html += '<div class="dead-actions">';

        // Scanning state: determinate progress bar
        if (deadScan && !deadResults) {
            const pct = deadItems.length ? Math.round((deadProgress / deadItems.length) * 100) : 0;
            html += `<span>${_m('deadScanning') || 'Scanning'} ${deadProgress}/${deadItems.length}</span>`;
            html += `<progress class="vbm-progress" value="${deadProgress}" max="${deadItems.length}" style="flex:1;min-width:60px"></progress>`;
            html += `<span>${pct}%</span>`;
            html += ` <button id="dead-abort">${_m('cancel') || 'Cancel'}</button>`;
            container.innerHTML = html;
            bindEvents();
            return;
        }

        // Cached header: last scan info + rescan
        if (cache && cache.ts) {
            const d = new Date(cache.ts);
            const dateStr = d.toLocaleString();
            html += `<span>${(_m('deadLastScanAt') || 'Last scan: $time$').replace('$time$', dateStr)}</span>`;
            html += ` · <span>${cache.scannedCount} bookmarks</span>`;
            html += ` <button id="dead-rescan">${_m('deadRescan') || 'Rescan'}</button>`;
        }

        // No results yet: actionable empty state
        if (!deadResults) {
            if (!cache || !cache.ts) {
                html += `<span>${_m('deadStartHint') || 'Scan bookmarks for dead links.'}</span>`;
                html += ` <button id="dead-rescan">${_m('deadRescan') || 'Start scan'}</button>`;
            }
            html += '</div>';
            container.innerHTML = html;
            bindEvents();
            return;
        }

        // Filter: segmented toggle + batch actions
        html += '<span class="vbm-segmented" id="dead-filter-segmented" style="margin-left:8px">';
        html += `<button data-filter="all"${scanFilter==='all'?' class="active"':''}>${_m('deadFilterAll')||'All'}</button>`;
        html += `<button data-filter="dead"${scanFilter==='dead'?' class="active"':''}>${_m('deadFilterDead')||'Dead'}</button>`;
        html += `<button data-filter="blocked"${scanFilter==='blocked'?' class="active"':''}>${_m('deadFilterBlocked')||'Blocked'}</button>`;
        html += '</span>';
        html += '</div>';

        // Batch actions row
        const deadMarks = getDeadMarks();
        html += '<div class="dead-actions">';
        html += `<button id="dead-mark-all">${_m('deadMarkAll') || 'Mark all'}</button>`;
        html += `<button id="dead-unmark-all">${_m('deadUnmarkAll') || 'Clear marks'}</button>`;
        html += ` <span class="dead-marks-count">${deadMarks.size} ${_m('deadMarked') || 'marked'}</span>`;
        html += ` <button id="dead-rescan">${_m('deadRescan') || 'Rescan'}</button>`;
        html += '</div>';

        const filtered = getFiltered();
        if (!filtered.length) {
            html += '<div class="empty-state"><i>' + (_m('deadNone') || 'No dead links found.') + '</i></div>';
            container.innerHTML = html;
            bindEvents();
            return;
        }

        // Results list with vbm-row anatomy (§3.5)
        html += '<ul class="dead-list">';
        for (const item of filtered) {
            const result = deadResults.get(item.id);
            const statusBadge = getStatusBadge(result);
            const marked = deadMarks.has(item.id);
            html += `<li class="vbm-row dead-row${marked ? ' marked' : ''}" data-id="${item.id}" data-node-id="${item.id}" role="listitem">`;
            // Icon column with dead mark overlay
            html += `<span class="vbm-icon-col">`;
            if (item.url) {
                const favUrl = new URL(chrome.runtime.getURL('/_favicon/'));
                favUrl.searchParams.set('pageUrl', item.url);
                favUrl.searchParams.set('size', '32');
                html += `<img src="${favUrl.toString()}" width="16" height="16" alt="">`;
                if (marked) html += '<span class="dead-mark" aria-label="Marked as dead link"></span>';
            }
            html += '</span>';
            // Title
            html += `<span class="vbm-title" title="${item.title || item.url}\n${item.url || ''}">${item.title || item.url}</span>`;
            // Meta: status badge + path
            html += `<span class="vbm-meta">${statusBadge}`;
            html += `<span class="row-path" data-parentid="${item.parentId || ''}" dir="auto">...</span>`;
            // Row buttons: mark + delete (§1.5)
            html += `<button class="vbm-row-btn dead-mark-btn" data-id="${item.id}" aria-label="${marked ? (_m('rowActionUnmark') || 'Unmark') : (_m('rowActionMark') || 'Mark')}">${marked ? '⚑' : '⚐'}</button>`;
            html += `<button class="vbm-row-btn dead-delete-btn" data-id="${item.id}" aria-label="${_m('rowActionDelete') || 'Delete'}">✕</button>`;
            html += '</span>';
            html += '</li>';
        }
        html += '</ul>';

        container.innerHTML = html;
        bindEvents();

        // Resolve parent path labels
        container.querySelectorAll('.dead-row .row-path').forEach(el => {
            const pid = el.dataset.parentid;
            if (pid) {
                chrome.bookmarks.get(pid, nodes => {
                    if (nodes && nodes.length) {
                        el.textContent = nodes[0].title || '';
                    }
                });
            }
        });
    };

    // Build status badge HTML with proper token classes (§3.5)
    const getStatusBadge = (result) => {
        if (!result || result.ok) return '';
        if (result.status === 'blocked') {
            let label = _m('deadBlocked') || 'blocked';
            return `<span class="vbm-badge warning">${label}</span>`;
        }
        if (result.status === 'skipped') {
            let label = _m('deadSkipped') || 'skipped';
            return `<span class="vbm-badge muted">${label}</span>`;
        }
        // dead/error
        let label = statusLabel(result);
        return `<span class="vbm-badge danger">${label}</span>`;
    };

    const bindEvents = () => {
        // Rescan button
        const rescanBtn = container.querySelector('#dead-rescan');
        if (rescanBtn) rescanBtn.addEventListener('click', startScan);

        // Abort button
        const abortBtn = container.querySelector('#dead-abort');
        if (abortBtn) abortBtn.addEventListener('click', abortScan);

        // Segmented filter buttons (§3.5)
        const filterSeg = container.querySelector('#dead-filter-segmented');
        if (filterSeg) {
            filterSeg.querySelectorAll('button').forEach(btn => {
                btn.addEventListener('click', () => {
                    scanFilter = btn.dataset.filter;
                    renderResults();
                });
            });
        }

        // Mark all
        const markAllBtn = container.querySelector('#dead-mark-all');
        if (markAllBtn) markAllBtn.addEventListener('click', markAll);

        // Unmark all
        const unmarkAllBtn = container.querySelector('#dead-unmark-all');
        if (unmarkAllBtn) unmarkAllBtn.addEventListener('click', unmarkAll);

        // Individual mark/unmark
        container.querySelectorAll('.dead-mark-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                toggleMark(btn.dataset.id);
            });
        });

        // Individual delete
        container.querySelectorAll('.dead-delete-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const titleEl = btn.closest('.dead-row').querySelector('.vbm-title');
                const title = titleEl ? titleEl.textContent : id;
                dialogs.ConfirmDialog.open({
                    dialog: _m('deadConfirmDelete', [title]),
                    button1: `<strong>${_m('delete')}</strong>`,
                    button2: _m('nope'),
                    fn1: () => {
                        actions.deleteBookmark(id);
                        deadResults.delete(id);
                        deadItems = deadItems.filter(b => b.id !== id);
                        renderResults();
                    }
                });
            });
        });
    };

    // v4 task 2: full keyboard navigation with view-specific keys (§2.3)
    initListKeyboard(container, {
        onEnter(id) {
            chrome.bookmarks.get(id, nodes => {
                if (nodes && nodes.length && nodes[0].url) {
                    actions.openBookmark(nodes[0].url);
                }
            });
        },
        onDelete(id) {
            dialogs.ConfirmDialog.open({
                dialog: _m('deadConfirmDelete', [id]),
                button1: `<strong>${_m('delete')}</strong>`,
                button2: _m('nope'),
                fn1: () => {
                    actions.deleteBookmark(id);
                    deadResults.delete(id);
                    deadItems = deadItems.filter(b => b.id !== id);
                    renderResults();
                }
            });
        },
        onReveal(id) {
            // R key: reveal bookmark in tree (§2.3)
            if (!id || !treeView) { viewManager && viewManager.activate('tree'); return; }
            chrome.bookmarks.get(id, nodes => {
                if (!nodes || !nodes.length) { viewManager && viewManager.activate('tree'); return; }
                const parentId = nodes[0].parentId;
                viewManager && viewManager.activate('tree');
                if (treeView.revealBookmark) {
                    treeView.revealBookmark(id, parentId);
                } else if (parentId) {
                    treeView.revealFolder(parentId);
                }
            });
        },
        onExtraKey(key, id) {
            // M key: mark/unmark (§2.3)
            if (key === 'm' || key === 'M') {
                toggleMark(id);
                return true; // consumed
            }
            return false;
        }
    });

    // v4 task 2: abort active scan on popup close (§5.5d)
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', () => {
            if (deadScan) {
                deadScan.abort();
                deadScan = null;
            }
        });
    }

    return {
        badge() {
            // Tab badge = count of marked dead links
            return getDeadMarks().size;
        },
        activate() {
            // Restore cache on first activation (no scan yet)
            if (!deadResults && !deadScan) {
                const restored = restoreCache();
                if (!restored) {
                    // No cache, show start hint
                    deadItems = []; // will be populated on scan
                } else {
                    // Populate deadItems for the cached results
                    chrome.bookmarks.getTree(tree => {
                        const allItems = flattenTree(tree);
                        deadItems = filterScannable(allItems, isSeparator);
                        renderResults();
                        refreshBadge();
                    });
                    return;
                }
            }
            renderResults();
            refreshBadge();
        },
        deactivate() {
            // Don't abort on deactivate — scan continues in background
        },
        onEscape() {
            if (deadScan) {
                abortScan();
                return true; // consumed
            }
            return false;
        },
        startScan,
        abortScan
    };
}
