/**
 * Popup search (P1 module extracted from neat.js).
 *
 * Owns the search input + results pane: the searchMode flag, the flat
 * fuzzy-search index (rebuilt lazily on bookmark changes and refreshed from
 * every tree regeneration via updateIndex), query execution through
 * window.VBMFuzzy, the <mark>-highlighted result rendering, the saved-query
 * restore on startup, and every searchInput listener. neat.js only sees the
 * API returned at the bottom.
 *
 * v4 task-2: the old #tree/#results display swap is retired — search mode
 * is mapped onto the view layer (docs/v4task-2.md §4): typing in the header
 * box activates the search view (the source view is remembered for the quit
 * path), `views.pathOf` feeds the §3.6 parent-path row labels and the
 * unified 标题+URL+路径 tooltips (the async per-row parent-folder tooltip
 * fetch is retired — the path map covers it in one tree walk).
 *
 * Slice B (docs/v4task-2.md §4.3 + docs/v4task-2-list.md §3.2):
 * - `searchHistory` — MRU of {q, ts, n}, limit 10, trim-deduped (the pure
 *   pushSearchHistory below is vitest-covered). Recorded on Enter in
 *   searchAfterEnter mode, on result open (reset), on view leave / popup
 *   close, and on the two-level Esc clear; gated by `searchHistoryEnabled`.
 * - Two-level Esc (§2.3/§3.2): first Esc records + clears the box but keeps
 *   the results and stays in the search view; the second falls through to
 *   the view layer (back to the tree).
 * - The view is split into an upper `#search-history-area` (history rows or
 *   the hint) and the lower results list (kept between searches). The area
 *   caps at 40% of the view height; v4 task-4 #4 trims tail rows at render
 *   so it never grows a scrollbar (the stored MRU still keeps 10).
 *
 * Re-entry contract (2026-07-25 spec, replacing the slice-B `searchLastQuery`
 * refill): entering the search view never refills the box — the input stays
 * empty, the upper area renders the recorded history (the live query only
 * joins it at a record timing), and the lower results list simply survives,
 * so the last search's rows stay visible between view switches.
 *
 * initSearch(ctx) is called once by neat.js after DOM parse.
 * ctx.store                    — chrome.storage mirror (searchQuery, focusID, settings)
 * ctx.separatorManager         — filters separators out of the flat index
 * ctx.switchBookmarkMenu(disable) — hides/restores context-menu entries
 * ctx.generateBookmarkHTML(title, url, extras, id, positions, meta) — bookmark row HTML
 * ctx.highlightTitlePositions(title, positions) — escaped, <mark>-wrapped title
 * ctx.rememberState            — restore the persisted query on startup when true
 * ctx.views                    — view-manager API (activate/attach/pathOf/isActive)
 * ctx.revealInTree(id)         — treeView.revealInTree via a lazy closure
 *                                (tree-view inits after search; called only
 *                                on the R keypress, docs/v4task-2-list.md §2.3)
 *
 * window.VBMFuzzy is loaded by fuzzy.js (classic script) before neat.js.
 * document/window/chrome remain page globals, as in the rest of the popup.
 * No neatools helpers here: plain getElementById/classList/loops only.
 */
import { FOLDER_ICON, VIEW_ICONS, TRASH_ICON } from './icons.js';
import { relTimeLabel } from './tree-render.js';

// Same escape recipe as tree-render.js's module-private copy (modules stay
// self-contained): escape >, then <, then ".
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

// §4.3: the search-history MRU as a pure function — trim, drop empties,
// dedupe by exact query, newest first, capped at `limit`. Entries are
// {q, ts, n} (query, timestamp, last result count); malformed entries are
// tolerated (skipped) since the store value is user data.
export const pushSearchHistory = (list, entry, limit = 10) => {
    const q = ((entry && entry.q) || '').trim();
    if (!q)
        return list || [];
    const next = [{ q, ts: (entry && entry.ts) || 0, n: (entry && entry.n) | 0 }];
    for (const item of list || []) {
        if (item && typeof item.q === 'string' && item.q !== q)
            next.push({ q: item.q, ts: item.ts || 0, n: item.n | 0 });
    }
    return next.slice(0, limit);
};

export function initSearch(ctx = {}) {
    const $ = id => document.getElementById(id);
    const body = document.body;
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const separatorManager = ctx.separatorManager;
    const switchBookmarkMenu = ctx.switchBookmarkMenu;
    const generateBookmarkHTML = ctx.generateBookmarkHTML;
    const highlightTitlePositions = ctx.highlightTitlePositions;
    const $tree = $('tree');

    // v4 task-2: the display swap (#tree vs #results) is retired — search
    // mode now maps onto the view layer. Typing activates the search view
    // (remembering the source view), quitting returns to it. The defensive
    // fallback keeps minimal test setups alive; neat.js always injects it.
    const views = ctx.views || {
        activate: () => {}, activeId: () => 'tree', isActive: () => false,
        attach: () => {}, pathOf: () => ''
    };
    // v4 task-3 #15: the history rows' →/← menu key mirrors the tree's rtl rule
    const rtl = !!ctx.rtl;
    // Lazy closure over treeView (init order); only the R keypress calls it.
    const revealInTree = ctx.revealInTree || (() => {});
    // 第五轮项3: after every results render, neat.js re-lays the dead-mark
    // × overlays (the innerHTML swap just wiped them). Optional — the
    // recording doubles in tests simply omit it.
    const onRowsRendered = ctx.onRowsRendered || (() => {});
    let returnView = 'tree';

    // --- Search history + last-query restore (§4.3) --------------------------
    const historyEnabled = () => !!store.get('searchHistoryEnabled', '1');
    const readHistory = () => {
        try {
            const list = JSON.parse(store.get('searchHistory') || '[]');
            return Array.isArray(list) ? list : [];
        } catch (e) {
            return [];
        }
    };
    let lastResultCount = 0;
    // Records a query into the MRU history. `n` = the result count shown to
    // the user; callers outside this module (the palette, v4 task-4 #3) pass
    // their own hit count, the in-view timings default to lastResultCount.
    const recordHistory = (q, n) => {
        q = (q || '').trim();
        if (!q || !historyEnabled())
            return;
        store.set('searchHistory', JSON.stringify(
            pushSearchHistory(readHistory(),
                { q, ts: Date.now(), n: n == null ? lastResultCount : n })));
    };
    // Bucket → label helper lives in tree-render.js (shared with the recent
    // and stats views) — imported as relTimeLabel above.

    const searchAfterEnter = !!store.get('searchAfterEnter');
    const $results = $('results');
    let searchMode = false;
    const searchInput = $('search-input');
    const searchClearBtn = $('search-clear');
    let prevValue = '';

    // The custom clear button (native webkit cancel glyph removed in CSS):
    // visible only while the field has text, toggled from every path that
    // mutates searchInput.value. The class must land on #search itself — the
    // CSS gate is `#search.has-query #search-clear`; parentNode used to be
    // #search but became #search-field when the wrapper was introduced
    // (fourth-round item 3), which left the button permanently hidden.
    const $search = $('search');
    const updateClearBtn = () => {
        ($search || searchClearBtn.parentNode).classList.toggle('has-query', searchInput.value.length > 0);
    };
    if (chrome.i18n.getMessage('searchClear')) {
        const clearLabel = _m('searchClear');
        searchClearBtn.title = clearLabel;
        searchClearBtn.setAttribute('aria-label', clearLabel);
    }

    // Phase 2b: flat index for the fuzzy search (window.VBMFuzzy), built from
    // the full bookmark tree — folders included, separators excluded via the
    // existing SeparatorManager logic. Bookmark change events only set a
    // dirty flag; the index is rebuilt lazily on the next search so tree
    // rendering is never blocked.
    let searchIndex = null;
    let searchIndexDirty = false;
    const buildSearchIndex = tree => {
        const index = [];
        const walk = nodes => {
            if (!nodes)
                return;
            for (let i = 0, l = nodes.length; i < l; i++) {
                const node = nodes[i];
                if (typeof node.parentId !== 'undefined') { // skip the invisible root
                    const isFolder = !node.url;
                    if (isFolder || !separatorManager.isSeparator(node.title, node.url)) {
                        index.push({
                            id: node.id,
                            parentId: node.parentId,
                            title: node.title || '',
                            url: node.url || '',
                            dateAdded: node.dateAdded || 0,
                            isFolder: isFolder
                        });
                    }
                }
                if (node.children)
                    walk(node.children);
            }
        };
        walk(tree);
        searchIndex = index;
        searchIndexDirty = false;
    };
    const markSearchIndexDirty = () => {
        searchIndexDirty = true;
    };
    chrome.bookmarks.onCreated.addListener(markSearchIndexDirty);
    chrome.bookmarks.onRemoved.addListener(markSearchIndexDirty);
    chrome.bookmarks.onChanged.addListener(markSearchIndexDirty);
    chrome.bookmarks.onMoved.addListener(markSearchIndexDirty);

    const quitSearchMode = (ignoreFocus) => {
        if (searchMode) {
            prevValue = '';
            searchInput.value = '';
            updateClearBtn();
            store.set('searchQuery', '');
            searchMode = false;
            switchBookmarkMenu(false);
            // Back to the view the search was started from. activate()'s
            // default focus restore replaces the old manual tree-row refocus;
            // quit(true) keeps the focus in the input (clear-button path).
            views.activate(returnView, { keepFocus: ignoreFocus === true });
        }
    };

    // Drop the query + mode without leaving the search view or touching
    // focus. Called by tree-view.js's bookmarkHandler after a search result
    // has been opened, where the popup is about to navigate away anyway (the
    // original code inlined these five statements in bookmarkHandler).
    // §4.3: opening a result is one of the history-record timings.
    const resetSearchState = () => {
        if (searchMode) {
            recordHistory(searchInput.value);
            prevValue = '';
            searchInput.value = '';
            updateClearBtn();
            store.set('searchQuery', '');
            searchMode = false;
            switchBookmarkMenu(false);
        }
    };

    // --- History area (upper half of the search view, §3.2) -------------------
    // Always rendered on view entry: the history rows + clear-all when
    // there is history, the searchViewHint guide row otherwise. The lower
    // #results list keeps the last search's output between searches.
    const $historyArea = $('search-history-area');
    // --- Row focus park/restore (4.0.1 focus law) --------------------------
    // The history-area twin of the list views' row park: renderHistoryArea's
    // innerHTML swap replaces every row, so a focused row drops to <body>
    // and the ↓ walk dies (the Delete key removes a row; the context menu's
    // remove/clear-all re-renders). Park the focused row before the swap,
    // restore it after — history rows carry no id, so the park is its index
    // among the area's <li>s, clamped on restore; with no rows left the
    // search box takes the focus back (not the area container).
    const parkRowFocus = () => {
        let li = document.activeElement;
        while (li && li.tagName !== 'LI')
            li = li.parentNode;
        // the row must belong to the history area — a results row does not count
        for (let p = li; p; p = p.parentNode) {
            if (p !== $historyArea)
                continue;
            if (typeof $historyArea.querySelectorAll !== 'function')
                return null;
            const lis = $historyArea.querySelectorAll('li');
            for (let i = 0, l = lis.length; i < l; i++)
                if (lis[i] === li)
                    return { id: li.id || '', idx: i };
            return null;
        }
        return null;
    };
    const unparkRowFocus = parked => {
        if (!parked)
            return;
        let li = parked.id ? document.getElementById(parked.id) : null;
        if (!li) {
            if (typeof $historyArea.querySelectorAll !== 'function')
                return;
            const lis = $historyArea.querySelectorAll('li');
            if (!lis.length) {
                // no rows at all — hand focus back to the search box
                if (searchInput.focus)
                    searchInput.focus();
                return;
            }
            li = lis[Math.min(parked.idx, lis.length - 1)];
        }
        if (!li)
            return;
        // A row carrying tabindex takes the focus itself; plain rows hand it
        // to their anchor/span — the same element the area's ↓ walk focuses.
        // (getAttribute is guarded: test doubles may lack it.)
        const target = (li.getAttribute && li.getAttribute('tabindex') !== null)
            ? li
            : (li.querySelector ? li.querySelector('a, span') : null);
        if (target && target.focus)
            target.focus();
    };
    const renderHistoryArea = () => {
        if (!$historyArea)
            return;
        // 4.0.1 focus law: park a focused history row across the swap
        const parkedRow = parkRowFocus();
        const list = historyEnabled() ? readHistory() : [];
        if (!list.length) {
            $historyArea.innerHTML = `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('searchViewHint')}</i></li></ul>`;
            unparkRowFocus(parkedRow);
            return;
        }
        let html = `<div class="search-history-head"><i>${htmlspecialchars(_m('searchHistoryTitle'))}</i>` +
            `<button type="button" id="search-history-clear" tabindex="-1">${htmlspecialchars(_m('searchHistoryClear'))}</button></div>` +
            '<ul role="list">';
        for (let i = 0, l = list.length; i < l; i++) {
            const entry = list[i];
            const q = entry.q || '';
            html += `<li class="vbm-row search-history-row" role="listitem">` +
                `<a href="" tabindex="-1" data-q="${htmlspecialchars(q)}" title="${htmlspecialchars(q)}">` +
                `<span class="history-clock">${VIEW_ICONS.recent}</span>` +
                `<i>${htmlspecialchars(q)}</i>` +
                `<span class="history-meta">${_m('searchHistoryResultCount', `${entry.n | 0}`)}</span>` +
                `<span class="history-time">${relTimeLabel(entry.ts, _m)}</span>` +
                `</a>` +
                `<button type="button" class="row-btn search-history-remove" tabindex="-1" data-q="${htmlspecialchars(q)}" aria-label="${_m('searchHistoryRemove')}">${TRASH_ICON}</button>` +
                `</li>`;
        }
        html += '</ul>';
        $historyArea.innerHTML = html;
        // v4 task-4 #4: never let the upper area grow a scrollbar — the area
        // caps at 40% of the view height (CSS), so drop tail rows until the
        // remainder fits. The stored MRU keeps all 10 entries; this is a
        // pure view concern (jsdom/no-layout doubles report 0 ≥ 0 → no-op).
        trimHistoryToFit();
        // …restored AFTER the trim, so a trimmed-away row can't take focus.
        unparkRowFocus(parkedRow);
    };
    const trimHistoryToFit = () => {
        if (!$historyArea)
            return;
        const ul = $historyArea.querySelector('ul');
        if (!ul || !ul.children)
            return;
        while (ul.children.length > 1
            && $historyArea.scrollHeight > $historyArea.clientHeight)
            ul.removeChild(ul.lastElementChild);
    };
    const removeHistoryEntry = q => {
        store.set('searchHistory', JSON.stringify(readHistory().filter(e => e.q !== q)));
        renderHistoryArea();
    };
    const runHistoryQuery = q => {
        searchInput.value = q;
        updateClearBtn();
        search(true); // explicit pick: runs even in searchAfterEnter mode
        searchInput.focus();
    };
    if ($historyArea) {
        $historyArea.addEventListener('click', e => {
            const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
            if (closest('#search-history-clear')) {
                e.preventDefault();
                store.set('searchHistory', '[]');
                renderHistoryArea();
                return;
            }
            const removeBtn = closest('.search-history-remove');
            if (removeBtn) {
                e.preventDefault();
                removeHistoryEntry(removeBtn.dataset.q);
                return;
            }
            const a = closest('a[data-q]');
            if (a) {
                e.preventDefault();
                runHistoryQuery(a.dataset.q);
            }
        });
        // Row keyboard equivalents (§3.2): Enter reruns, Delete removes the
        // entry (the × button is the mouse path). Link activation on Enter is
        // the keydown default action, so preventDefault avoids a double run.
        // v4 task-3 #12/#15: ↑/↓ walk the rows (↓ past the last crosses into
        // the kept results, ↑ past the first returns to the box), Home/End
        // jump the ends, and → (← in RTL) opens the row's context menu —
        // the same synthetic-contextmenu contract as keyboard.js's tree rows.
        $historyArea.addEventListener('keydown', e => {
            const a = document.activeElement;
            if (!a || !a.dataset || typeof a.dataset.q === 'undefined')
                return;
            if (e.key === 'Enter') {
                e.preventDefault();
                runHistoryQuery(a.dataset.q);
            } else if (e.key === 'Delete') {
                e.preventDefault();
                removeHistoryEntry(a.dataset.q);
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const rows = Array.from($historyArea.querySelectorAll('a[data-q]'));
                const idx = rows.indexOf(a);
                if (e.key === 'ArrowDown') {
                    const next = rows[idx + 1];
                    if (next) {
                        next.focus();
                    } else {
                        // may be the no-results empty state (no focusable row)
                        const firstResult = $results.querySelector('ul>li:first-child a');
                        if (firstResult)
                            firstResult.focus();
                    }
                } else if (idx > 0) {
                    rows[idx - 1].focus();
                } else if (views.focusListExit || views.focusTop) {
                    // keyboard-model §3 + §2.5: the universal ↑-crossing —
                    // the in-list toolbar when the active view has one (the
                    // search view has none), then the tab strip when visible,
                    // else the box.
                    if (views.focusListExit)
                        views.focusListExit();
                    else
                        views.focusTop();
                } else {
                    searchInput.focus();
                }
            } else if (e.key === 'Home' || e.key === 'End') {
                e.preventDefault();
                const rows = $historyArea.querySelectorAll('a[data-q]');
                const target = rows[e.key === 'Home' ? 0 : rows.length - 1];
                if (target)
                    target.focus();
            } else if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) {
                e.preventDefault();
                const rect = a.getBoundingClientRect();
                a.dispatchEvent(new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX: rtl ? rect.left : rect.right,
                    clientY: rect.bottom
                }));
            }
        });
    }

    // Two-level Esc (docs/v4task-2-list.md §2.3/§3.2): the first Esc records
    // the query into the history, clears the box and keeps the results in
    // place — the search view stays put for the next search. With an empty
    // box it declines, letting the view layer walk back to the tree.
    const escapeSearch = () => {
        if (!searchInput.value)
            return false;
        recordHistory(searchInput.value);
        prevValue = '';
        searchInput.value = '';
        updateClearBtn();
        store.set('searchQuery', '');
        if (searchMode) {
            searchMode = false;
            switchBookmarkMenu(false);
        }
        renderHistoryArea();
        return true;
    };

    views.attach('search', {
        // Re-entry contract: the box stays as it is (empty after the
        // two-level Esc / a fresh switch), the history area re-renders and
        // the results list simply survives — no last-query refill.
        activate: () => {
            renderHistoryArea();
            // K16 follow-up: leaving the view cleared the mode, but the box
            // keeps its query and the results DOM survives (the re-entry
            // contract) — so a live query brings the mode (and the dual-zone
            // arrow laws) straight back.
            if (!searchMode && searchInput.value.trim()) {
                searchMode = true;
                switchBookmarkMenu(true);
            }
        },
        // §4.3 record timing ③: leaving the view with a live query.
        deactivate: () => {
            recordHistory(searchInput.value);
            // K16: leaving the search view also leaves search MODE. A
            // Ctrl/Alt+digit jump (or a tab click) with a live query used to
            // keep searchMode set, so the tree's Home/End walked the hidden
            // results list and ↓ stopped climbing — those branches gate on
            // isActive(). quitSearchMode() can't run here (it re-enters
            // views.activate() mid-switch), so the flag flips inline. The
            // box keeps its query per the re-entry contract above — view
            // switches never touch it; only the mode resets.
            if (searchMode) {
                searchMode = false;
                switchBookmarkMenu(false);
            }
        },
        focus: () => searchInput.focus(),
        // §2.3: R reveals the focused result row in the tree (bookmark and
        // folder rows alike — the folder rows' old click-jump unified here).
        // Consumed before the type-ahead gate, like the other views' letter
        // keys; the search input itself never reaches this hook (it is not
        // a list row), so typing 'r' in the box is unaffected.
        //
        // §4.3 record timing: R counts as "completing" the search — the query
        // is consumed by an explicit locate-in-tree. Recorded HERE (not via the
        // view-leave deactivate hook) so the out-of-bar branch (onlyShowBMBar:
        // revealInTree shows a toast instead of leaving the view) records too.
        onKey: e => {
            if (e.key !== 'r' && e.key !== 'R')
                return false;
            const item = document.activeElement;
            const li = item && item.parentNode;
            const id = li && (li.dataset.nodeId || li.id.replace(/^results-item-/, ''));
            if (!id)
                return false;
            e.preventDefault();
            recordHistory(searchInput.value);
            revealInTree(id);
            return true;
        }
    });
    // Boot-order gap (v4 task-4 #4): when rememberView/panel mode restores the
    // search view at startup, view-manager activates it BEFORE this attach
    // lands (the structural 'search' view registers inside initViewManager),
    // so the activate hook above never fires and the history area would stay
    // empty until the next leave/re-enter. Paint once if already active.
    if (views.isActive('search'))
        renderHistoryArea();
    if (typeof window.addEventListener === 'function')
        window.addEventListener('pagehide', () => recordHistory(searchInput.value));
    // v4 task-4 #4: a popup resize (edge drag) changes how many history rows
    // fit under the 40% cap — re-render so the area re-fills instead of
    // keeping stale trimmed rows. Cheap; renders only in the search view.
    if (typeof window.addEventListener === 'function')
        window.addEventListener('resize', () => {
            if (views.isActive('search'))
                renderHistoryArea();
        });

    const search = (e) => {
        const value = searchInput.value.trim();
        store.set('searchQuery', value);
        if (value === '') {
            quitSearchMode();
            return;
        }
        if (searchAfterEnter && !e) {
            return;
        }
        if (!searchMode) {
            // Entering search mode: remember where to return on quit
            returnView = views.activeId() === 'search' ? returnView : views.activeId();
            searchMode = true;
            switchBookmarkMenu(true);
        }
        // 输入即切视图 (§4.2): typing drives the search view active. keepFocus —
        // the keystroke owns the input.
        views.activate('search', { keepFocus: true });
        if (value === prevValue)
            return;
        prevValue = value;

        const renderResults = results => {
            lastResultCount = results.length;
            let html = '<ul role="list">';
            if (!results.length) {
                // Phase 2b: no-results empty state (no a/span inside, so
                // keyboard navigation skips it and clicks do nothing)
                html += `<li class="empty-state" role="listitem"><i>${_m('searchNoResults')}</i></li>`;
            }
            for (let i = 0, l = results.length; i < l; i++) {
                const result = results[i];
                const id = result.id;
                if (!result.isFolder) {
                    // §3.6: rows carry their parent-folder path label + the
                    // unified 标题/URL/路径 tooltip (via the meta argument).
                    html += `<li class="vbm-row" data-parentid="${result.parentId}" data-node-id="${id}" id="results-item-${id}" role="listitem">
                            ${generateBookmarkHTML(result.title, result.url, '', result.id, result.positions, { path: views.pathOf(id) })}</li>`;
                } else {  // folder
                    // Add sync status indicator for folders in search results
                    let syncIndicator = '';
                    if (store.getSyncSetting('showSyncStatus', 'true') === 'true' && window.syncManager && id) {
                        const syncStatus = window.syncManager.getSyncStatusIndicator(id);
                        const syncTooltip = window.syncManager.getSyncTooltip(id);
                        if (syncStatus) {
                            syncIndicator = `<span class="sync-indicator ${syncStatus}">
                                <span class="sync-tooltip">${syncTooltip}</span>
                            </span>`;
                        }
                    }

                    const folderTitle = result.title ?
                        highlightTitlePositions(result.title, result.positions) : _m('noTitle');
                    // §3.6 tooltip unification for folder rows: 标题 + 路径
                    const folderPath = views.pathOf(id);
                    const folderTip = htmlspecialchars(result.title || _m('noTitle'))
                        + (folderPath ? `\n${htmlspecialchars(folderPath)}` : '');
                    html += `<li id="results-item-${id}" role="listitem" data-parentid="${result.parentId}" data-node-id="${id}">
                            <a href="" class="link-folder tree-item-link" title="${folderTip}">
                            <div class="favicon-container">
                            ${FOLDER_ICON}
                            ${syncIndicator}
                            </div>
                            <i>${folderTitle}</i>
                            </a></li>`;
                }
            }
            html += '</ul>';
            $results.innerHTML = html;
            onRowsRendered();
        };

        // Fuzzy-rank the flat index; rebuild it lazily when bookmarks changed
        if (searchIndex && !searchIndexDirty) {
            renderResults(window.VBMFuzzy.rank(value, searchIndex).slice(0, 100)); // 100 is enough
        } else {
            chrome.bookmarks.getTree(tree => {
                buildSearchIndex(tree);
                renderResults(window.VBMFuzzy.rank(value, searchIndex).slice(0, 100)); // 100 is enough
            });
        }
    };

    searchInput.addEventListener('input', () => {
        updateClearBtn();
        if (!searchInput.value.length) {
            // keep focus on input
            // do not restore focus to item
            quitSearchMode(true);
        } else {
            search(null);
        }
    });

    // Clear button: wipe the query, leave search mode and hand focus back to
    // the input so typing can restart immediately (quit(true) skips the
    // tree-refocus; the explicit focus() below is the intended target).
    searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        updateClearBtn();
        // Abandoning the search: clear the results pane too, so an
        // UNCONSUMED query leaves no trace (it was not recorded, so the
        // history area has no entry — the results pane must not contradict
        // that with a lingering list). Esc is the "complete + keep" path,
        // the × button is the "abandon + clear" path.
        $results.innerHTML = '';
        quitSearchMode(true);
        searchInput.focus();
    });

    searchInput.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown' && searchInput.value.length === searchInput.selectionEnd) { // down
            e.preventDefault();
            if (searchMode) {
                // may be the no-results empty state, which has no focusable row
                const firstResult = $results.querySelector('ul>li:first-child a');
                if (firstResult)
                    firstResult.focus();
            } else if (views.isActive('search')) {
                // Empty query in the search view (§3.2): the upper history
                // rows are the first landing spot, then the kept results.
                const firstHistory = $historyArea ? $historyArea.querySelector('a[data-q]') : null;
                const target = firstHistory || $results.querySelector('ul>li:first-child a');
                if (target)
                    target.focus();
            } else if (views.focusDown) {
                // Final polish: the naive vertical chain — search box → tab
                // strip → view content. ↓ from the box lands on the strip
                // (a second ↓ enters the active list); with the strip
                // hidden focusDown enters the list directly. (v4 task-3 #12
                // routed this to the active list immediately, skipping the
                // strip rung the visual layout implies.)
                views.focusDown();
            } else if (views.focusActive) {
                // v4 task-3 #12: ↓ lands on the ACTIVE view's list — this
                // used to hardcode the tree, so on recent/stats/dead/dupes
                // the keystroke focused a hidden row and looked dead.
                views.focusActive();
            } else {
                $tree.querySelector('ul>li:first-child').querySelector('span, a').focus();
            }
        } else if (e.key === 'Enter' && searchInput.value.length) { // enter
            if (searchAfterEnter) {
                // §4.3 record timing ①: Enter in searchAfterEnter mode.
                recordHistory(searchInput.value);
                search(e);
            } else {
                const item = $results.querySelector('ul>li:first-child a');
                if (item) {
                    item.focus();
                    setTimeout(() => {
                        let event = new MouseEvent("click", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                        });
                        item.dispatchEvent(event);
                    }, 30);
                }
            }
        } else if (e.key === 'Escape') { // esc
            if (searchInput.value) {
                // First Esc clears the box but keeps the results + the view
                // (two-level, §3.2); the document chain walks back on the 2nd.
                e.preventDefault();
                escapeSearch();
            }
        } else if (e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') &&
                searchInput.selectionStart === searchInput.selectionEnd &&
                searchInput.selectionEnd === searchInput.value.length) {
            // Header-row ←/→ (final polish): the caret sits at the text
            // edge, so the forward arrow leaves the box to the quick-add
            // star (skipped when hidden), then the tool button — the
            // horizontal counterpart of the ↓ zone chain. RTL mirrors.
            const qa = document.getElementById('quick-add-btn');
            const tool = document.getElementById('tool-btn');
            // (doubles without layout APIs count as visible — tests)
            const visible = el => el && (el.getClientRects ? el.getClientRects().length > 0 : true);
            const target = visible(qa) ? qa : (visible(tool) ? tool : null);
            if (target) {
                e.preventDefault();
                target.focus();
            }
        }
    });

    searchInput.addEventListener('focus', () => {
        body.classList.add('searchFocus');
    });
    searchInput.addEventListener('blur', () => {
        body.classList.remove('searchFocus');
    });

    // Saved search query
    if (ctx.rememberState && store.get('searchQuery')) {
        searchInput.value = store.get('searchQuery');
        search();
        searchInput.select();
        searchInput.scrollLeft = 0;
    }
    updateClearBtn();

    return {
        input: searchInput,
        results: $results,
        isActive: () => searchMode,
        quit: quitSearchMode,
        reset: resetSearchState,
        escape: escapeSearch,
        // v4 task-2 §4.4: the palette bridge row jumps into the search view
        // with its query — the same refill+rerun path the history rows use.
        run: runHistoryQuery,
        // v4 task-4 #3: a plain-query palette search that opens a bookmark
        // records its query here — the same "open a result" timing the
        // search view itself uses (resetSearchState).
        record: recordHistory,
        updateIndex: buildSearchIndex
    };
}
