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
        if (viewManager && viewManager.refreshAllBadges) {
            viewManager.refreshAllBadges();
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

        // Header: last scan info + controls
        if (cache && cache.ts) {
            const d = new Date(cache.ts);
            const dateStr = d.toLocaleString();
            html += `<div class="dead-header">`;
            html += `<span>${(_m('deadLastScanAt') || 'Last scan: $time$').replace('$time$', dateStr)}</span>`;
            html += ` · <span>${cache.scannedCount} bookmarks</span>`;
            html += ` <button id="dead-rescan">${_m('deadRescan') || 'Rescan'}</button>`;
            html += '</div>';
        }

        // Scanning progress
        if (deadScan && !deadResults) {
            html += `<div class="dead-progress">${_m('deadChecking', [`${deadProgress}`, `${deadItems.length}`])}</div>`;
            html += `<button id="dead-abort">Cancel scan</button>`;
            container.innerHTML = html;
            bindEvents();
            return;
        }

        // No results yet
        if (!deadResults) {
            html += `<div class="empty-state"><i>${_m('deadStartHint') || 'Scan bookmarks for dead links.'}</i></div>`;
            html += `<button id="dead-rescan">${_m('deadRescan') || 'Start scan'}</button>`;
            container.innerHTML = html;
            bindEvents();
            return;
        }

        // Batch actions
        const deadMarks = getDeadMarks();
        html += '<div class="dead-actions">';
        html += `<select id="dead-filter"><option value="all"${scanFilter==='all'?' selected':''}>${_m('deadFilterAll')||'All'}</option>`;
        html += `<option value="dead"${scanFilter==='dead'?' selected':''}>${_m('deadFilterDead')||'Dead only'}</option>`;
        html += `<option value="blocked"${scanFilter==='blocked'?' selected':''}>${_m('deadFilterBlocked')||'Blocked only'}</option></select>`;
        html += ` <button id="dead-mark-all">${_m('deadMarkAll') || 'Mark all'}</button>`;
        html += ` <button id="dead-unmark-all">${_m('deadUnmarkAll') || 'Clear marks'}</button>`;
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

        // Results list
        html += '<ul class="dead-list">';
        for (const item of filtered) {
            const result = deadResults.get(item.id);
            const badge = statusLabel(result);
            const marked = deadMarks.has(item.id);
            html += `<li class="dead-row${marked ? ' marked' : ''}" data-id="${item.id}">`;
            html += `<span class="dead-status">${badge}</span>`;
            html += `<span class="dead-title">${item.title || item.url}</span>`;
            html += `<span class="dead-url">${item.url}</span>`;
            html += `<button class="dead-mark-btn" data-id="${item.id}">${marked ? (_m('deadUnmark')||'Unmark') : (_m('deadMark')||'Mark')}</button>`;
            html += `<button class="dead-delete-btn" data-id="${item.id}">✕</button>`;
            html += '</li>';
        }
        html += '</ul>';

        container.innerHTML = html;
        bindEvents();
    };

    const bindEvents = () => {
        // Rescan button
        const rescanBtn = container.querySelector('#dead-rescan');
        if (rescanBtn) rescanBtn.addEventListener('click', startScan);

        // Abort button
        const abortBtn = container.querySelector('#dead-abort');
        if (abortBtn) abortBtn.addEventListener('click', abortScan);

        // Filter select
        const filterSel = container.querySelector('#dead-filter');
        if (filterSel) {
            filterSel.addEventListener('change', () => {
                scanFilter = filterSel.value;
                renderResults();
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
            btn.addEventListener('click', () => toggleMark(btn.dataset.id));
        });

        // Individual delete
        container.querySelectorAll('.dead-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                dialogs.ConfirmDialog.open({
                    dialog: _m('deadConfirmDelete', [btn.closest('.dead-row').querySelector('.dead-title').textContent]),
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
                    });
                    return;
                }
            }
            renderResults();
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
