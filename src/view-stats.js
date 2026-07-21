/**
 * Visit statistics view (v4 task 2, slice D).
 *
 * Displays bookmark visit counts from visit-stats.js data.
 * Sortable by count (default) or recency, with a clear-data button.
 *
 * initViewStats(ctx)
 * ctx.store, ctx.visitStats, ctx.actions, ctx.dialogs, ctx.viewManager
 */

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

        if (!entries.length) {
            container.innerHTML = `<div class="empty-state"><i>${_m('statsEmpty') || 'No visit data yet. Open bookmarks to collect statistics.'}</i></div>`;
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

        // Sort toggle
        html += '<div class="stats-toolbar">';
        html += `<button class="stats-sort${sortBy==='count'?' active':''}" data-sort="count">${_m('statsSortByCount') || 'By count'}</button>`;
        html += `<button class="stats-sort${sortBy==='recent'?' active':''}" data-sort="recent">${_m('statsSortByRecent') || 'By recent'}</button>`;
        html += ` <button id="stats-clear" class="danger">${_m('statsClearData') || 'Clear data'}</button>`;
        html += '</div>';

        html += '<ul class="stats-list">';
        for (const [id, data] of entries) {
            const count = data.c || 0;
            const time = data.t ? new Date(data.t).toLocaleString() : '';
            // Title will be resolved asynchronously
            html += `<li class="stats-row" data-id="${id}">`;
            html += `<span class="stats-count">${(_m('statsVisitCount') || '$count$ visits').replace('$count$', String(count))}</span>`;
            html += `<span class="stats-title" id="stats-title-${id}">...</span>`;
            html += time ? `<span class="stats-time">${time}</span>` : '';
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
        container.querySelectorAll('.stats-sort').forEach(btn => {
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
                // Open in current tab
                chrome.bookmarks.get(id, nodes => {
                    if (nodes && nodes.length && nodes[0].url) {
                        actions.openBookmark(nodes[0].url);
                    }
                });
            });
        });
    };

    return {
        activate() { refresh(); },
        deactivate() {},
        refresh
    };
}
