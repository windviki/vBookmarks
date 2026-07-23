/**
 * Visit statistics view (v4 task 2, slice D).
 *
 * Displays bookmark visit counts from visit-stats.js data.
 * Sortable by count (default) or recency, with a clear-data button.
 *
 * initViewStats(ctx)
 * ctx.store, ctx.visitStats, ctx.actions, ctx.dialogs, ctx.viewManager
 */

import { initListKeyboard } from './list-keyboard.js';
import { formatRelativeTime } from './format-utils.js';

export function initViewStats(ctx = {}) {
    const $ = id => document.getElementById(id);
    const store = ctx.store;
    const visitStats = ctx.visitStats;
    const actions = ctx.actions;
    const dialogs = ctx.dialogs;
    const _m = chrome.i18n.getMessage;

    const container = $('stats-content');
    if (!container) return { activate() {}, deactivate() {}, refresh() {} };

    let sortBy = store.get('statsSort', 'count'); // 'count' | 'recent'

    const refresh = () => {
        const stats = visitStats ? visitStats.getStats() : {};
        const entries = Object.entries(stats);

        // Empty state with statsEnabled check (§3.4)
        if (!entries.length) {
            const statsOn = store.get('statsEnabled', '1') !== 'false';
            const msg = statsOn
                ? (_m('statsEmpty') || 'Statistics will accumulate as you browse.')
                : (_m('statsDisabled') || 'Visit statistics are disabled. Enable in options.');
            container.innerHTML = `<div class="empty-state"><i>${msg}</i></div>`;
            return;
        }

        // Sort
        sortBy = store.get('statsSort', 'count');
        if (sortBy === 'recent') {
            entries.sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
        } else {
            entries.sort((a, b) => (b[1].c || 0) - (a[1].c || 0));
        }

        let html = '';

        // Toolbar: segmented sort + clear button (§3.4)
        html += '<div class="stats-toolbar">';
        html += '<span class="vbm-segmented">';
        html += `<button class="${sortBy==='count'?'active':''}" data-sort="count">${_m('statsSortByCount') || 'By count'}</button>`;
        html += `<button class="${sortBy==='recent'?'active':''}" data-sort="recent">${_m('statsSortByRecent') || 'By recent'}</button>`;
        html += '</span>';
        html += ` <button id="stats-clear" class="danger">${_m('statsClearData') || 'Clear data'}</button>`;
        html += '</div>';

        html += '<ul class="stats-list">';
        for (const [id, data] of entries) {
            const count = data.c || 0;
            const relTime = formatRelativeTime(data.t || 0, _m);
            // v4 task 2: count pill with tabular-nums (§3.4)
            html += `<li class="vbm-row stats-row" data-id="${id}" data-node-id="${id}" role="listitem">`;
            html += `<span class="vbm-icon-col"></span>`; // icon column alignment
            html += `<span class="vbm-title" id="stats-title-${id}">...</span>`;
            html += `<span class="vbm-meta">`;
            html += `<span class="vbm-count-pill">✕${count}</span>`;
            html += relTime ? `<span>${relTime}</span>` : '';
            html += `</span>`;
            html += '</li>';
        }
        html += '</ul>';

        container.innerHTML = html;

        // Resolve titles
        for (const [id] of entries) {
            chrome.bookmarks.get(id, nodes => {
                if (!nodes || !nodes.length) return;
                const el = document.getElementById(`stats-title-${id}`);
                if (el) {
                    el.textContent = nodes[0].title || nodes[0].url || id;
                    el.title = nodes[0].url || '';
                }
            });
        }

        // Sort buttons
        container.querySelectorAll('.stats-toolbar .vbm-segmented button').forEach(btn => {
            btn.addEventListener('click', () => {
                sortBy = btn.dataset.sort;
                store.set('statsSort', sortBy);
                refresh();
            });
        });

        // Clear button
        const clearBtn = container.querySelector('#stats-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                dialogs.ConfirmDialog.open({
                    dialog: _m('statsClearData') || 'Clear all visit statistics?',
                    button1: `<strong>${_m('delete')}</strong>`,
                    button2: _m('nope'),
                    fn1: () => {
                        if (visitStats) visitStats.clearStats();
                        refresh();
                    }
                });
            });
        }

        // Click a row to open the bookmark
        container.querySelectorAll('.stats-row').forEach(row => {
            row.addEventListener('click', () => {
                const id = row.dataset.id;
                if (visitStats) visitStats.recordVisit(id);
                chrome.bookmarks.get(id, nodes => {
                    if (nodes && nodes.length && nodes[0].url) {
                        actions.openBookmark(nodes[0].url);
                    }
                });
            });
        });
    };

    // v4 task 2: full keyboard navigation (§2.3)
    initListKeyboard(container, {
        onEnter(id) {
            chrome.bookmarks.get(id, nodes => {
                if (nodes && nodes.length && nodes[0].url) {
                    if (visitStats) visitStats.recordVisit(id);
                    actions.openBookmark(nodes[0].url);
                }
            });
        },
        onReveal(id) {
            // R key: reveal in tree (§2.3)
            const viewManager = ctx.viewManager;
            if (viewManager) viewManager.activate('tree');
        }
    });

    return {
        activate() { refresh(); },
        deactivate() {},
        refresh
    };
}
