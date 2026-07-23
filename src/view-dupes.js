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
import { CHEVRON_ICON } from './icons.js';

// Mid-truncate a URL for group header display (§3.6)
// "https://example.com/very/long/path/page" → "example.com/very/lo…/page"
const midTruncate = (url, maxLen = 48) => {
    if (!url || url.length <= maxLen) return url;
    // Strip protocol for display
    let display = url.replace(/^https?:\/\//, '');
    if (display.length <= maxLen) return display;
    const headLen = Math.floor(maxLen * 0.55);
    const tailLen = maxLen - headLen - 1; // -1 for the ellipsis char
    return display.slice(0, headLen) + '…' + display.slice(-tailLen);
};

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
        // Clear manual keepers — strategy change should re-evaluate all groups
        if (dupeGroups._manualKeepers) dupeGroups._manualKeepers = {};
        render();
    };

    const render = () => {
        let html = '';

        // Top toolbar (row 0): strategy selector + summary + apply all (§3.6)
        html += '<div class="dupes-toolbar">';
        html += `<select id="dupes-scope" class="dupes-scope">`;
        html += `<option value="all"${selectedScope === 'all' ? ' selected' : ''}>${_m('dupesScopeAll') || 'All bookmarks'}</option>`;
        html += `<option value="bar"${selectedScope === 'bar' ? ' selected' : ''}>${_m('dupesScopeBar') || 'Bookmarks bar only'}</option>`;
        html += '</select> ';
        html += `<label class="dupes-check"><input type="checkbox" id="dupes-ignore-scheme"${ignoreScheme ? ' checked' : ''}> ${_m('dupesIgnoreScheme') || 'Ignore http/https'}</label>`;
        html += '</div>';

        // Strategy selector as styled <select> for space efficiency (§3.6)
        html += '<div class="dupes-strategies">';
        html += '<select id="dupes-strategy" class="dupes-scope">';
        for (const s of STRATEGIES) {
            const disabled = s.id === 'keep-most-visited' && store.get('statsEnabled', '1') === 'false';
            html += `<option value="${s.id}"${selectedStrategy === s.id ? ' selected' : ''}${disabled ? ' disabled' : ''}>${_m(s.key) || s.id}</option>`;
        }
        html += '</select>';
        html += '</div>';

        if (!dupeGroups.length) {
            html += '<div class="empty-state"><i>' + (_m('dupesNone') || 'No duplicate bookmarks found.') + '</i></div>';
            container.innerHTML = html;
            bindEvents();
            return;
        }

        // Summary + apply all ($groups$/$count$ placeholders sub'd via Chrome i18n)
        const totalExtra = dupeGroups.reduce((n, g) => n + g.items.length - 1, 0);
        const summaryText = _m('dupesPreviewSummary', [String(dupeGroups.length), String(totalExtra)])
            || '$groups$ groups, $count$ to remove'.replace('$groups$', String(dupeGroups.length)).replace('$count$', String(totalExtra));
        html += `<div class="dupes-summary">${summaryText}`;
        html += ` <button id="dupes-apply-all" class="danger">${_m('dupesApplyAll') || 'Apply all'}</button></div>`;

        // Groups (§3.6)
        let groupIdx = 0;
        for (const group of dupeGroups) {
            const manualId = dupeGroups._manualKeepers && dupeGroups._manualKeepers[groupIdx];
            const keeper = manualId
                ? group.items.find(b => b.id === manualId) || pickKeeper(group.items, selectedStrategy, { bookmarkBarIds })
                : pickKeeper(group.items, selectedStrategy, { bookmarkBarIds });
            const doomed = group.items.filter(b => b.id !== keeper.id);

            // Group header: <li> so it participates in .focus model (§3.6)
            html += `<div class="dupes-group">`;
            html += `<li class="dupes-group-header vbm-row" data-group-idx="${groupIdx}" data-node-id="group-${groupIdx}" tabindex="0" role="button" aria-expanded="true" style="cursor:pointer">`;
            html += `<span class="dupes-group-chevron">${CHEVRON_ICON}</span>`;
            html += `<span class="dupes-group-url" title="${group.key}">${midTruncate(group.key)}</span>`;
            html += `<span class="vbm-count-pill">${group.items.length}</span>`;
            html += `<button class="vbm-row-btn dupes-clean-group" data-group-idx="${groupIdx}" aria-label="${_m('dupesGroupCleanRest') || 'Clear rest'}">${_m('dupesGroupCleanRest') || 'Clear rest'}</button>`;
            html += '</li>';

            for (const item of group.items) {
                const isKeeper = item.id === keeper.id;
                const rowClass = isKeeper ? 'keeper-selected' : 'danger-preview';
                html += `<li class="vbm-row ${rowClass}" data-id="${item.id}" data-group-idx="${groupIdx}" data-node-id="${item.id}" role="listitem">`;
                // Keeper radio mark (§3.6)
                html += `<span class="vbm-keeper-radio${isKeeper ? ' filled' : ' empty'}" aria-label="${isKeeper ? (_m('dupesKeeperSet') || 'Keeper') : ''}"></span>`;
                // Favicon placeholder (icon column alignment)
                html += `<span class="vbm-icon-col"><img src="${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(item.url)}&size=32" width="16" height="16" alt=""></span>`;
                // Title — member rows NEVER show URL (§3.6 信息不重复原则)
                const displayTitle = item.title || item.url;
                html += `<span class="vbm-title" title="${displayTitle}\n${item.url}">${displayTitle}</span>`;
                // Meta: parent path + dateAdded
                html += `<span class="vbm-meta">`;
                html += `<span class="row-path" data-parentid="${item.parentId}" dir="auto">...</span>`;
                html += `<span class="dupes-date">${item.dateAdded ? new Date(item.dateAdded).toLocaleDateString() : ''}</span>`;
                if (!isKeeper) {
                    html += `<button class="vbm-row-btn dupes-remove-row" data-id="${item.id}" aria-label="${_m('rowActionDelete') || 'Delete'}">✕</button>`;
                }
                html += `</span>`;
                html += '</li>';
            }
            html += '</div>';
            groupIdx++;
        }

        container.innerHTML = html;
        bindEvents();

        // Resolve parent path labels asynchronously
        container.querySelectorAll('.dupes-row .row-path, .vbm-row .row-path').forEach(el => {
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

    const bindEvents = () => {
        // Strategy selector (now a <select> element)
        const strategySel = container.querySelector('#dupes-strategy');
        if (strategySel) {
            strategySel.addEventListener('change', () => applyStrategy(strategySel.value));
        }

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
            btn.addEventListener('click', e => {
                e.stopPropagation(); // don't trigger group header toggle
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

        // Group header click: toggle expand/collapse (§3.6)
        container.querySelectorAll('.dupes-group-header').forEach(header => {
            header.addEventListener('click', e => {
                if (e.target.closest('.dupes-clean-group')) return; // don't toggle on clean button
                const groupDiv = header.closest('.dupes-group');
                if (!groupDiv) return;
                const isCollapsed = groupDiv.classList.toggle('collapsed');
                header.setAttribute('aria-expanded', String(!isCollapsed));
                const memberRows = groupDiv.querySelectorAll('.vbm-row:not(.dupes-group-header)');
                memberRows.forEach(r => { r.style.display = isCollapsed ? 'none' : ''; });
            });
        });

        // Remove single row
        container.querySelectorAll('.dupes-remove-row').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const id = btn.dataset.id;
                actions.deleteBookmark(id);
                setTimeout(() => refresh(), 200);
            });
        });

        // Keeper override: click a doomed row to make it keeper (§3.6)
        container.querySelectorAll('.vbm-row.danger-preview').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('.dupes-remove-row') || e.target.closest('.vbm-row-btn')) return;
                const groupIdx = parseInt(row.dataset.groupIdx, 10);
                if (isNaN(groupIdx)) return;
                const itemId = row.dataset.id;
                if (!dupeGroups._manualKeepers) dupeGroups._manualKeepers = {};
                dupeGroups._manualKeepers[groupIdx] = itemId;
                render();
            });
        });
    };

    // v4 task 2: full keyboard navigation with view-specific keys (§2.3)
    initListKeyboard(container, {
        onEnter(id) {
            // Check if this is a group header
            if (id && id.startsWith('group-')) {
                const li = container.querySelector(`[data-node-id="${id}"]`);
                if (li) {
                    const groupDiv = li.closest('.dupes-group');
                    if (groupDiv) {
                        const isCollapsed = groupDiv.classList.toggle('collapsed');
                        li.setAttribute('aria-expanded', String(!isCollapsed));
                        const memberRows = groupDiv.querySelectorAll('.vbm-row:not(.dupes-group-header)');
                        memberRows.forEach(r => { r.style.display = isCollapsed ? 'none' : ''; });
                    }
                }
                return;
            }
            chrome.bookmarks.get(id, nodes => {
                if (nodes && nodes.length && nodes[0].url) {
                    actions.openBookmark(nodes[0].url);
                }
            });
        },
        onDelete(id) {
            actions.deleteBookmark(id);
            setTimeout(() => refresh(), 200);
        },
        onReveal(id) {
            if (viewManager) viewManager.activate('tree');
        },
        onExtraKey(key, id) {
            // K key: set keeper (§2.3)
            if (key === 'k' || key === 'K') {
                const li = container.querySelector(`[data-node-id="${id}"]`);
                if (li) {
                    const groupIdx = parseInt(li.dataset.groupIdx, 10);
                    if (!isNaN(groupIdx)) {
                        if (!dupeGroups._manualKeepers) dupeGroups._manualKeepers = {};
                        dupeGroups._manualKeepers[groupIdx] = id;
                        render();
                        return true;
                    }
                }
            }
            return false;
        }
    });

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
