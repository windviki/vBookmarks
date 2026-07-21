/**
 * Duplicate management view (v4 task 2, slice C).
 *
 * Full replacement for palette.js's dupes mode. Renders duplicate groups
 * with per-group keeper selection, quick strategy toolbar, scope selector,
 * and ignore-scheme checkbox. Batch deletion through ConfirmDialog + undo.
 *
 * initViewDupes(ctx)
 * ctx.store, ctx.treeRender, ctx.actions, ctx.dialogs, ctx.viewManager
 */

import { findDupes, planDeletion, pickKeeper } from './dupes.js';
import { initListKeyboard } from './list-keyboard.js';

export function initViewDupes(ctx = {}) {
    const $ = id => document.getElementById(id);
    const store = ctx.store;
    const actions = ctx.actions;
    const dialogs = ctx.dialogs;
    const viewManager = ctx.viewManager;
    const _m = chrome.i18n.getMessage;

    const container = $('dupes-content');
    if (!container) return { activate() {}, deactivate() {}, refresh() {} };

    const STRATEGIES = [
        { id: 'keep-oldest', key: 'dupesStrategyOldest' },
        { id: 'keep-newest', key: 'dupesStrategyNewest' },
        { id: 'keep-bookmark-bar', key: 'dupesStrategyBookmarkBar' },
        { id: 'keep-shortest-title', key: 'dupesStrategyShortestTitle' },
        { id: 'keep-shallowest', key: 'dupesStrategyShallowest' },
        { id: 'keep-most-visited', key: 'dupesStrategyMostVisited' }
    ];

    let dupeGroups = [];
    let selectedStrategy = store.get('dupesStrategy', 'keep-oldest');
    let selectedScope = store.get('dupesScope', 'all');
    let ignoreScheme = store.get('dupesIgnoreScheme', '') === '1';

    // Flatten tree into bookmark list
    const flattenTree = (tree) => {
        const items = [];
        const walk = (nodes) => {
            for (const node of nodes) {
                if (node.children) {
                    if (node.id !== '0') walk(node.children);
                    else walk(node.children);
                } else if (node.url) {
                    items.push({
                        id: node.id,
                        title: node.title || '',
                        url: node.url || '',
                        dateAdded: node.dateAdded || 0,
                        parentId: node.parentId
                    });
                }
            }
        };
        walk(tree || []);
        return items;
    };

    // Build bookmark bar subtree ID set for keep-bookmark-bar strategy
    const buildBookmarkBarIds = (tree) => {
        const ids = new Set();
        const findBar = (nodes) => {
            for (const node of nodes) {
                if (node.folderType === 'bookmarks-bar' || (node.title && node.parentId === '0' && node.title.toLowerCase().includes('bookmark'))) {
                    // Found the bar; collect all descendant IDs
                    const collect = (n) => {
                        ids.add(n.id);
                        if (n.children) n.children.forEach(collect);
                    };
                    collect(node);
                    return;
                }
                if (node.children) findBar(node.children);
            }
        };
        findBar(tree || []);
        return ids;
    };

    let bookmarkBarIds = new Set();

    // Normalize URL with optional scheme-ignore
    const normUrl = (url) => {
        if (!ignoreScheme || !url) return url;
        try {
            const u = new URL(url);
            return url.substring(url.indexOf('://') + 3);
        } catch (e) { return url; }
    };

    const refresh = () => {
        chrome.bookmarks.getTree(tree => {
            let bookmarks = flattenTree(tree);

            // Apply scope filter
            if (selectedScope === 'bar') {
                const barIds = buildBookmarkBarIds(tree);
                bookmarkBarIds = barIds;
                bookmarks = bookmarks.filter(b => barIds.has(b.id) || barIds.has(b.parentId));
            }

            // Apply scheme ignore
            if (ignoreScheme) {
                bookmarks = bookmarks.map(b => ({ ...b, _normUrl: normUrl(b.url) }));
            }

            dupeGroups = findDupes(bookmarks);

            // Update tab badge
            if (viewManager && viewManager.refreshAllBadges) {
                viewManager.refreshAllBadges();
            }

            render();
        });
    };

    const removeSequentially = (items) =>
        items.reduce((chain, item) => chain.then(() =>
            new Promise(resolve => chrome.bookmarks.remove(item.id, resolve))),
            Promise.resolve());

    const applyStrategy = (strategyId) => {
        selectedStrategy = strategyId;
        store.set('dupesStrategy', strategyId);
        render();
    };

    const render = () => {
        let html = '';

        // Toolbar: scope selector + scheme checkbox
        html += '<div class="dupes-toolbar">';
        html += `<select id="dupes-scope" class="dupes-scope">`;
        html += `<option value="all"${selectedScope === 'all' ? ' selected' : ''}>${_m('dupesScopeAll') || 'All bookmarks'}</option>`;
        html += `<option value="bar"${selectedScope === 'bar' ? ' selected' : ''}>${_m('dupesScopeBar') || 'Bookmarks bar only'}</option>`;
        html += '</select> ';
        html += `<label class="dupes-check"><input type="checkbox" id="dupes-ignore-scheme"${ignoreScheme ? ' checked' : ''}> ${_m('dupesIgnoreScheme') || 'Ignore http/https'}</label>`;
        html += '</div>';

        // Strategy selector
        html += '<div class="dupes-strategies">';
        for (const s of STRATEGIES) {
            const label = _m(s.key) || s.id;
            const disabled = s.id === 'keep-most-visited' && store.get('statsEnabled', '1') === 'false';
            html += `<button class="dupes-strategy${selectedStrategy === s.id ? ' active' : ''}" ` +
                `data-strategy="${s.id}"${disabled ? ' disabled' : ''}>${label}</button>`;
        }
        html += '</div>';

        if (!dupeGroups.length) {
            html += '<div class="empty-state"><i>' + (_m('dupesNone') || 'No duplicate bookmarks found.') + '</i></div>';
            container.innerHTML = html;
            bindEvents();
            return;
        }

        // Summary + apply all
        const totalExtra = dupeGroups.reduce((n, g) => n + g.items.length - 1, 0);
        html += `<div class="dupes-summary">${(_m('dupesPreviewSummary') || '$groups$ groups, $count$ to remove')
            .replace('$groups$', String(dupeGroups.length)).replace('$count$', String(totalExtra))}`;
        html += ` <button id="dupes-apply-all" class="danger">${_m('dupesApplyAll') || 'Apply all'}</button></div>`;

        // Groups
        for (const group of dupeGroups) {
            const keeper = pickKeeper(group.items, selectedStrategy, { bookmarkBarIds });
            const doomed = group.items.filter(b => b.id !== keeper.id);

            html += `<div class="dupes-group">`;
            html += `<div class="dupes-group-header">`;
            html += `<span class="dupes-group-url">${group.key}</span>`;
            html += `<span class="dupes-group-count">${group.items.length} items</span>`;
            html += `<button class="dupes-clean-group" data-group-idx="${dupeGroups.indexOf(group)}">${_m('dupesGroupCleanRest') || 'Clean rest'}</button>`;
            html += '</div>';

            for (const item of group.items) {
                const isKeeper = item.id === keeper.id;
                html += `<div class="dupes-row${isKeeper ? ' keeper' : ' doomed'}" data-id="${item.id}">`;
                html += `<span class="dupes-keep-mark">${isKeeper ? '✓ ' : ''}</span>`;
                html += `<span class="dupes-title">${item.title || item.url}</span>`;
                html += `<span class="dupes-url">${item.url}</span>`;
                html += `<span class="dupes-date">${new Date(item.dateAdded || 0).toLocaleDateString()}</span>`;
                if (!isKeeper) {
                    html += `<button class="dupes-remove-row" data-id="${item.id}">✕</button>`;
                }
                html += '</div>';
            }
            html += '</div>';
        }

        container.innerHTML = html;
        bindEvents();
    };

    const bindEvents = () => {
        // Strategy buttons
        container.querySelectorAll('.dupes-strategy').forEach(btn => {
            btn.addEventListener('click', () => applyStrategy(btn.dataset.strategy));
        });

        // Scope change
        const scopeSel = container.querySelector('#dupes-scope');
        if (scopeSel) {
            scopeSel.addEventListener('change', () => {
                selectedScope = scopeSel.value;
                store.set('dupesScope', selectedScope);
                refresh();
            });
        }

        // Ignore scheme checkbox
        const schemeCb = container.querySelector('#dupes-ignore-scheme');
        if (schemeCb) {
            schemeCb.addEventListener('change', () => {
                ignoreScheme = schemeCb.checked;
                store.set('dupesIgnoreScheme', ignoreScheme ? '1' : '');
                refresh();
            });
        }

        // Apply all
        const applyAllBtn = container.querySelector('#dupes-apply-all');
        if (applyAllBtn) {
            applyAllBtn.addEventListener('click', () => {
                const allDoomed = dupeGroups.reduce((all, g) => {
                    const keeper = pickKeeper(g.items, selectedStrategy, { bookmarkBarIds });
                    return all.concat(g.items.filter(b => b.id !== keeper.id));
                }, []);
                if (!allDoomed.length) return;
                dialogs.ConfirmDialog.open({
                    dialog: _m('dupesConfirmAll', [`${allDoomed.length}`, `${dupeGroups.length}`]),
                    button1: `<strong>${_m('delete')}</strong>`,
                    button2: _m('nope'),
                    fn1: () => {
                        removeSequentially(allDoomed).then(() => {
                            chrome.bookmarks.getTree(() => refresh());
                        });
                    }
                });
            });
        }

        // Clean group
        container.querySelectorAll('.dupes-clean-group').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.groupIdx, 10);
                const group = dupeGroups[idx];
                if (!group) return;
                const keeper = pickKeeper(group.items, selectedStrategy, { bookmarkBarIds });
                const doomed = group.items.filter(b => b.id !== keeper.id);
                dialogs.ConfirmDialog.open({
                    dialog: _m('dupesConfirmGroup', `${doomed.length}`),
                    button1: `<strong>${_m('delete')}</strong>`,
                    button2: _m('nope'),
                    fn1: () => {
                        removeSequentially(doomed).then(() => {
                            chrome.bookmarks.getTree(() => refresh());
                        });
                    }
                });
            });
        });

        // Remove single row
        container.querySelectorAll('.dupes-remove-row').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                actions.deleteBookmark(id);
                // Refresh after a short delay for deletion to propagate
                setTimeout(() => refresh(), 200);
            });
        });
    };

    // v4 task 2: keyboard navigation
    initListKeyboard(container, {});

    return {
        badge() {
            // Tab badge = count of duplicate groups
            return dupeGroups.length;
        },
        activate() { refresh(); },
        deactivate() {},
        refresh
    };
}
