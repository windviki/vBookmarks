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
 * is mapped onto the view layer (docs/plan-4.0.0/v4task-2.md §4): typing in the header
 * box activates the search view (the source view is remembered for the quit
 * path), `views.pathOf` feeds the §3.6 parent-path row labels and the
 * unified 标题+URL+路径 tooltips (the async per-row parent-folder tooltip
 * fetch is retired — the path map covers it in one tree walk).
 *
 * Slice B (docs/plan-4.0.0/v4task-2.md §4.3 + docs/plan-4.0.0/v4task-2-list.md §3.2):
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
 *                                on the R keypress, docs/plan-4.0.0/v4task-2-list.md §2.3)
 *
 * window.VBMFuzzy is exposed by fuzzy.js — an ES-module shim over
 * fuzzy-core.js, loaded with <script type="module"> before neat.js.
 * document/window/chrome remain page globals, as in the rest of the popup.
 * No neatools helpers here: plain getElementById/classList/loops only.
 */
import { FOLDER_ICON, VIEW_ICONS, TRASH_ICON, SELECT_ICON } from './icons.js';
import { stageBtnHtml as relayStageBtnHtml, flipStageBtn, toggleStageItem } from './staging-relay.js';
import { relTimeLabel } from './tree-render.js';
import { htmlspecialchars } from './escape.js';
import {
    parkRowFocus as sharedParkRowFocus,
    unparkRowFocus as sharedUnparkRowFocus
} from './list-focus.js';

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
        // Leaving search MODE also leaves selection mode — quitting with the
        // ×/empty box while selecting used to keep the bar + ul.selecting
        // chrome on the surviving results across view re-entries.
        if (selecting)
            setSelecting(false);
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
        if (selecting)
            setSelecting(false);
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
    // The history-area park rides the shared list views' implementation
    // (src/list-focus.js): renderHistoryArea's innerHTML swap replaces every
    // row, so a focused row drops to <body> and the ↓ walk dies (the Delete
    // key removes a row; the context menu's remove/clear-all re-renders).
    // Park the focused row before the swap, restore it after — history rows
    // carry no id, so the park is its index among the area's <li>s, clamped
    // on restore; with no rows left the search box takes the focus back (not
    // the area container — the `emptyFocus` fallback).
    const parkRowFocus = () => sharedParkRowFocus($historyArea);
    const unparkRowFocus = parked => sharedUnparkRowFocus($historyArea, parked, searchInput);
    // Identical-render skip (the resize listener fires a re-render per resize
    // event — a size-correction loop would rebuild the rows under the cursor
    // every frame, killing :hover (the row × never reveals) and racing clicks
    // onto detached nodes). A render that TRIMMED tail rows must always redo
    // (a larger viewport restores them), so the skip only holds while the
    // last render was untrimmed.
    let lastHistoryHtml = null;
    let lastHistoryTrimmed = false;
    const renderHistoryArea = () => {
        if (!$historyArea)
            return;
        // 4.0.1 focus law: park a focused history row across the swap
        const parkedRow = parkRowFocus();
        const list = historyEnabled() ? readHistory() : [];
        if (!list.length) {
            const hintHtml = `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('searchViewHint')}</i></li></ul>`;
            if (hintHtml !== lastHistoryHtml) {
                lastHistoryHtml = hintHtml;
                lastHistoryTrimmed = false;
                $historyArea.innerHTML = hintHtml;
            }
            unparkRowFocus(parkedRow);
            return;
        }
        let html = `<div class="search-history-head"><i>${htmlspecialchars(_m('searchHistoryTitle'))}</i>` +
            `<button type="button" id="search-history-clear" class="search-history-clear" tabindex="-1">${htmlspecialchars(_m('searchHistoryClear'))}</button></div>` +
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
        if (html === lastHistoryHtml && !lastHistoryTrimmed) {
            // unchanged list, untrimmed last render — the DOM is already
            // exactly this; keep the live nodes (hover, focus, in-flight
            // clicks all survive).
            unparkRowFocus(parkedRow);
            return;
        }
        lastHistoryHtml = html;
        $historyArea.innerHTML = html;
        // v4 task-4 #4: never let the upper area grow a scrollbar — the area
        // caps at 40% of the view height (CSS), so drop tail rows until the
        // remainder fits. The stored MRU keeps all 10 entries; this is a
        // pure view concern (jsdom/no-layout doubles report 0 ≥ 0 → no-op).
        trimHistoryToFit();
        lastHistoryTrimmed = !!$historyArea.querySelector
            && $historyArea.querySelectorAll('a[data-q]').length < list.length;
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
        // Bypass the same-query short-circuit: re-picking the CURRENT query
        // from the history must visibly re-run (results + count repaint),
        // not no-op because prevValue already holds it.
        prevValue = '';
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

    // --- Selection mode (velvet staging §3.6) --------------------------------
    // Only BOOKMARK rows select (folder rows and history rows don't); the
    // unit is the bookmark id. No "un-favorite" button here — on an
    // all-bookmark list it would be a second delete (§3.6 trade-off).
    let selecting = false;
    const selected = new Set(); // bookmark ids (strings)
    let lastResults = [];
    // re-run the live query's render (the const search below inits later —
    // the arrow body defers the reference to call time). Clearing prevValue
    // bypasses the same-query short-circuit: the selection state changed,
    // the render must happen even though the query did not.
    const runSearch = () => {
        prevValue = '';
        search({});
        // selection focus handoff (the dead/dupes law): 'first' focuses the
        // bar's first enabled control, 'entry' the select-mode button.
        if (selectionFocus === 'first') {
            selectionFocus = null;
            const btn = $results.querySelector && $results.querySelector('.search-select-toolbar button:not([disabled])');
            if (btn && btn.focus)
                btn.focus();
        } else if (selectionFocus === 'entry') {
            selectionFocus = null;
            const btn = $results.querySelector && $results.querySelector('.search-select-mode');
            if (btn && btn.focus)
                btn.focus();
        }
    };

    const setSelecting = (on, focus = null) => {
        selecting = on;
        if (!on)
            selected.clear();
        if (focus)
            selectionFocus = focus;
        // re-render the results list with/without the bar — the current
        // query's results survive, so re-rank from the live index. With an
        // EMPTY query there is nothing to re-rank, but the bar and the
        // ul.selecting chrome must still leave the surviving DOM (the
        // ×-clear path): leaving them behind stranded a phantom selection
        // bar over the results until the next query.
        if (searchInput.value.trim())
            runSearch();
        else if (!on)
            stripSelectionChrome();
    };
    // Remove the selection bar + selecting classes from the SURVIVING
    // results DOM (no re-render — an empty query has nothing to re-rank).
    const stripSelectionChrome = () => {
        const bar = $results.querySelector && $results.querySelector('.search-select-toolbar');
        if (bar && bar.remove)
            bar.remove();
        const ul = document.getElementById('results-ul');
        if (ul && ul.classList)
            ul.classList.remove('selecting');
        const rows = $results.querySelectorAll ? $results.querySelectorAll('#results-ul li.vbm-row.sel') : [];
        for (let i = 0; i < rows.length; i++)
            rows[i].classList.remove('sel');
    };
    let selectionFocus = null;

    const selectedResultRows = () => lastResults.filter(r => !r.isFolder && selected.has(String(r.id)));

    const deleteSelectedResults = () => {
        const rows = selectedResultRows();
        if (!rows.length)
            return;
        const run = () => {
            let i = 0;
            const step = () => {
                if (i >= rows.length) {
                    selected.clear();
                    if (searchInput.value.trim())
                        runSearch();
                    return;
                }
                const r = rows[i++];
                if (ctx.undo && ctx.undo.capture)
                    ctx.undo.capture(r.id);
                chrome.bookmarks.remove(r.id, () => {
                    if (chrome.runtime.lastError)
                        return;
                    step();
                });
            };
            step();
        };
        if (ctx.dialogs && ctx.dialogs.ConfirmDialog) {
            ctx.dialogs.ConfirmDialog.open({
                dialog: _m('stagingDeleteConfirm', `${rows.length}`),
                button1: `<strong>${_m('delete')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    // Capture-phase interception: while selecting, clicks on the results
    // pane toggle membership (tree-view's bookmarkHandler never fires).
    $results.addEventListener('click', e => {
        const closest0 = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        if (!selecting) {
            // the entry button rides the idle result bar — flip the mode here
            // (capture phase, before tree-view's bookmarkHandler could run)
            if (closest0('.search-select-mode') && closest0('.vbm-toolbar')) {
                e.preventDefault();
                e.stopPropagation();
                setSelecting(true, 'first');
                return;
            }
            // velvet staging relay: the row's hover 发送到暂存 toggle (the
            // stats-view law — staged rows leave the workbench). The flip
            // lands on the live button; no results repaint.
            const stageBtn = closest0('.staging-add-btn');
            if (stageBtn) {
                e.preventDefault();
                e.stopPropagation();
                const li = stageBtn.closest('li');
                const r = li && lastResults.find(x => String(x.id) === String(li.dataset.nodeId));
                const nowStaged = r ? toggleStageItem(ctx.stagingApi, r) : null;
                if (nowStaged !== null)
                    flipStageBtn(stageBtn, nowStaged, _m);
                return;
            }
            // the row's hover delete: the real bookmark remove (undo toast),
            // same as the tree's keyboard Delete on this row.
            const rowDel = closest0('.search-row-del');
            if (rowDel) {
                e.preventDefault();
                e.stopPropagation();
                const li = rowDel.closest('li');
                const id = li && li.dataset.nodeId;
                if (id && ctx.actions && ctx.actions.deleteBookmark)
                    ctx.actions.deleteBookmark(id);
                return;
            }
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const closest = closest0;
        const toolbarBtn = cls => {
            const btn = closest(cls);
            return btn && closest('.vbm-toolbar') ? btn : null;
        };
        if (toolbarBtn('.search-select-all')) {
            for (const r of lastResults)
                if (!r.isFolder)
                    selected.add(String(r.id));
            runSearch();
            return;
        }
        if (toolbarBtn('.search-select-invert')) {
            for (const r of lastResults) {
                if (r.isFolder)
                    continue;
                const id = String(r.id);
                if (selected.has(id))
                    selected.delete(id);
                else
                    selected.add(id);
            }
            runSearch();
            return;
        }
        if (toolbarBtn('.search-select-clear')) {
            selected.clear();
            runSearch();
            return;
        }
        if (toolbarBtn('.search-select-exit')) {
            setSelecting(false, 'entry');
            return;
        }
        if (toolbarBtn('.search-stage')) {
            if (ctx.stagingApi)
                ctx.stagingApi.addItems(selectedResultRows().map(r => ({ id: r.id, url: r.url, title: r.title })));
            return;
        }
        if (toolbarBtn('.search-open')) {
            if (ctx.actions)
                ctx.actions.openBookmarks(selectedResultRows().map(r => r.url), false);
            return;
        }
        if (toolbarBtn('.search-open-group')) {
            if (ctx.actions)
                ctx.actions.openBookmarksInGroup(selectedResultRows().map(r => r.url));
            return;
        }
        if (toolbarBtn('.search-delete')) {
            deleteSelectedResults();
            return;
        }
        const li = closest('li');
        const id = li && li.dataset ? li.dataset.nodeId : undefined;
        if (id !== undefined) {
            const key = String(id);
            if (selected.has(key))
                selected.delete(key);
            else
                selected.add(key);
            runSearch();
        }
    }, true);
    // Space toggles the focused row, Delete acts — capture phase (§3.6).
    $results.addEventListener('keydown', e => {
        if (!selecting)
            return;
        if (e.key === ' ') {
            const li = e.target && e.target.closest ? e.target.closest('li.vbm-row') : null;
            const id = li && li.dataset ? li.dataset.nodeId : undefined;
            if (id === undefined)
                return;
            e.preventDefault();
            e.stopPropagation();
            const key = String(id);
            if (selected.has(key))
                selected.delete(key);
            else
                selected.add(key);
            runSearch();
        } else if (e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            deleteSelectedResults();
        }
    }, true);

    // Two-level Esc (docs/plan-4.0.0/v4task-2-list.md §2.3/§3.2): the first Esc records
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
        // velvet staging §3.6: consumed by views.onEscapeActive() BEFORE
        // keyboard.js's search.escape() branch — Esc leaves the selection
        // mode first, the second Esc walks the classic two-level search quit.
        onEscape: () => {
            if (selecting) {
                const ae = document.activeElement;
                const inToolbar = ae && ae.closest ? ae.closest('.vbm-toolbar') : null;
                setSelecting(false, inToolbar ? 'entry' : null);
                return true;
            }
            return false;
        },
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
    // v4 task-4 #4, storm-proofed (the 2026-08 probe log: 721 resize events
    // /3 s × a full re-render per tick — renderHistoryArea's trimmed state
    // forces a full repaint every call, trim shifts the content height, the
    // auto-resize answers, the loop self-runs at 240 Hz and kills hover and
    // clicks). The resize path now (a) is debounced 200 ms, (b) SHRINKS by
    // trimming nodes off the live list only — no re-render, no hover churn,
    // and the height settles so the loop dies — and (c) re-renders to refill
    // ONLY when the area actually GREW while rows were trimmed away.
    let historyResizeTimer = null;
    let historyAreaLastH = -1;
    if (typeof window.addEventListener === 'function')
        window.addEventListener('resize', () => {
            if (!views.isActive('search') || !$historyArea)
                return;
            clearTimeout(historyResizeTimer);
            historyResizeTimer = setTimeout(() => {
                historyResizeTimer = null;
                if (typeof $historyArea.querySelector !== 'function')
                    return;
                const ul = $historyArea.querySelector('ul');
                const hasRows = !!$historyArea.querySelector('a[data-q]');
                if (!ul || !hasRows)
                    return;
                const h = $historyArea.clientHeight;
                const grew = h > historyAreaLastH + 4;
                historyAreaLastH = h;
                if ($historyArea.scrollHeight > $historyArea.clientHeight + 1) {
                    // shrink: trim tail rows off the LIVE list — zero rebuild
                    while (ul.children.length > 1 && $historyArea.scrollHeight > $historyArea.clientHeight)
                        ul.removeChild(ul.lastElementChild);
                } else if (grew && lastHistoryTrimmed) {
                    // grew with rows missing: one full refill (it trims to
                    // fit again inside renderHistoryArea)
                    renderHistoryArea();
                }
            }, 200);
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
            lastResults = results;
            let html = '<ul role="list" id="results-ul">';
            if (!results.length) {
                // Phase 2b: no-results empty state (no a/span inside, so
                // keyboard navigation skips it and clicks do nothing)
                html += `<li class="empty-state" role="listitem"><i>${_m('searchNoResults')}</i></li>`;
            }
            for (let i = 0, l = results.length; i < l; i++) {
                const result = results[i];
                const id = result.id;
                if (!result.isFolder) {
                    const sel = selecting && selected.has(String(id));
                    // velvet staging relay: the row's trailing hover pair
                    // [发送到暂存][删除] — the shared recipe (src/staging-relay.js,
                    // click toggles: staged rows leave the workbench) plus the
                    // real bookmark delete (undo-captured, same as the tree's
                    // keyboard Delete). Selection mode keeps the DOM flat; the
                    // plane stands down with the staging master switch.
                    let tail = '';
                    if (!selecting) {
                        const relayOn = !ctx.stagingApi || !ctx.stagingApi.isEnabled || ctx.stagingApi.isEnabled();
                        const delLabel = htmlspecialchars(_m('rowActionDelete'));
                        tail = (relayOn ? relayStageBtnHtml(ctx.stagingApi, { id, url: result.url }, _m) : '') +
                            `<button type="button" class="row-btn search-row-del" aria-label="${delLabel}" title="${delLabel}">${TRASH_ICON}</button>`;
                    }
                    // §3.6: rows carry their parent-folder path label + the
                    // unified 标题/URL/路径 tooltip (via the meta argument).
                    html += `<li class="vbm-row${sel ? ' sel' : ''}" data-parentid="${result.parentId}" data-node-id="${id}" data-url="${encodeURIComponent(result.url)}" id="results-item-${id}" role="listitem">
                            ${generateBookmarkHTML(result.title, result.url, '', result.id, result.positions, { path: views.pathOf(id) })}${tail}</li>`;
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
            // velvet staging §3.6: the selection toolbar rides above the
            // results (only bookmark rows select — folder/history rows don't).
            const bookmarkRows = results.filter(r => !r.isFolder);
            if (selecting) {
                html = html.replace('<ul role="list" id="results-ul">',
                    '<ul role="list" id="results-ul" class="selecting">');
                let bar = '<div class="search-toolbar search-select-toolbar selecting-bar vbm-toolbar">';
                const barStageOn = !ctx.stagingApi || !ctx.stagingApi.isEnabled || ctx.stagingApi.isEnabled();
                bar += `<span class="select-count">${_m('selectCount', `${selected.size}`)}</span>` +
                    `<button class="search-select-all">${_m('selectAll')}</button>` +
                    `<button class="search-select-invert">${_m('selectInvert')}</button>` +
                    `<button class="search-select-clear">${_m('selectClear')}</button>` +
                    (barStageOn ? `<button class="search-stage"${selected.size ? '' : ' disabled'}>${_m('stagingAdd')}</button>` : '') +
                    `<button class="search-open"${selected.size ? '' : ' disabled'}>${_m('open')}</button>` +
                    `<button class="search-open-group"${selected.size ? '' : ' disabled'}>${_m('openBookmarksInGroup')}</button>` +
                    `<button class="search-delete"${selected.size ? '' : ' disabled'}>${_m('deleteSelected')}</button>` +
                    `<button class="search-select-exit">${_m('selectModeExit')}</button>`;
                bar += '</div>';
                html = bar + html;
            } else if (searchMode && bookmarkRows.length) {
                html = '<div class="search-toolbar vbm-toolbar">' +
                    `<span class="search-result-count">${_m('searchResultCount', `${results.length}`)}</span>` +
                    `<button class="search-select-mode" aria-label="${_m('selectModeEnter')}" ` +
                    `title="${_m('selectModeEnter')}">${SELECT_ICON}</button></div>` + html;
            }
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
            // Persist the wipe even outside search mode: after a view switch
            // the box can still hold the query (the re-entry contract) while
            // searchMode is off — quitSearchMode would skip the write and the
            // stale query would restore on the next popup open.
            store.set('searchQuery', '');
            // Emptying the box while selecting also exits selection mode (the
            // same law as quitSearchMode — the bar never survives the query).
            if (selecting)
                setSelecting(false);
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
        // Clear the persisted query UNCONDITIONALLY. quitSearchMode() only
        // clears it while search mode is active; the × button is global
        // chrome and can be clicked from any other view (e.g. tab groups)
        // while a query still lives in the box. Without this the old
        // searchQuery survives and the next popup open restores it.
        store.set('searchQuery', '');
        updateClearBtn();
        // Same unconditional persist as the input handler above: outside
        // search mode quitSearchMode is a no-op, and without this write the
        // abandoned query would still restore on the next popup open.
        store.set('searchQuery', '');
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
        // IME composition Enter: while a Chinese/Japanese IME is committing a
        // candidate, Chrome fires keydown with e.isComposing === true and
        // (on macOS) keyCode 229. The input value is still the composition
        // text, not the committed query — this Enter must stay with the IME,
        // never trigger the first-result open below.
        if (e.isComposing || e.keyCode === 229)
            return;
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
                        // If the results re-rendered before the timer fired
                        // (IME commit, a fast input event), `item` is no
                        // longer in the DOM. Dispatching a click on a detached
                        // anchor cannot reach the delegated bookmarkHandler,
                        // so nobody calls preventDefault() and the click's
                        // default action navigates the popup itself to the
                        // bookmark URL. Skip it.
                        if (item.isConnected === false)
                            return;
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
