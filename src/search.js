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
 * initSearch(ctx) is called once by neat.js after DOM parse.
 * ctx.store                    — chrome.storage mirror (searchQuery, focusID, settings)
 * ctx.separatorManager         — filters separators out of the flat index
 * ctx.switchBookmarkMenu(disable) — hides/restores context-menu entries
 * ctx.generateBookmarkHTML(title, url, extras, id, positions) — bookmark row HTML
 * ctx.highlightTitlePositions(title, positions) — escaped, <mark>-wrapped title
 * ctx.rememberState            — restore the persisted query on startup when true
 *
 * window.VBMFuzzy is loaded by fuzzy.js (classic script) before neat.js.
 * document/window/chrome remain page globals, as in the rest of the popup.
 * No neatools helpers here: plain getElementById/classList/loops only.
 */
import { FOLDER_ICON } from './icons.js';
import { initListKeyboard } from './list-keyboard.js';

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

    const searchAfterEnter = !!store.get('searchAfterEnter');
    const $results = $('results');
    let searchMode = false;
    const searchInput = $('search-input');
    const searchClearBtn = $('search-clear');
    let prevValue = '';

    // v4 task 2: view system integration
    const activateView = ctx.activateView || (() => {});
    const getActiveView = ctx.getActiveView || (() => 'tree');
    let sourceViewId = 'tree';

    // The custom clear button (native webkit cancel glyph removed in CSS):
    // visible only while the field has text, toggled from every path that
    // mutates searchInput.value.
    const updateClearBtn = () => {
        searchClearBtn.parentNode.classList.toggle('has-query', searchInput.value.length > 0);
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

    let quitSearchMode = (ignoreFocus) => {
        if (searchMode) {
            prevValue = '';
            if (searchInput.value) {
                searchInput.value = '';
            }
            updateClearBtn();
            store.set('searchQuery', '');
            searchMode = false;
            switchBookmarkMenu(false);
            $tree.style.display = 'block';
            $results.style.display = 'none';
            // v4 task 2: return to source view
            activateView(sourceViewId);

            if (ignoreFocus === null || !ignoreFocus) {
                // fix focus
                let item = $tree.querySelector('.focus');
                // not found focus, focus on the root node
                if (!item) {
                    item = $tree.querySelector('li:first-child>span');
                }
                if (item) {
                    item.focus();
                }
            }
        }
    };

    // Drop the query + mode without touching the tree/results display or
    // focus. Called by tree-view.js's bookmarkHandler after a search result
    // has been opened, where the popup is about to navigate away anyway (the
    // original code inlined these five statements in bookmarkHandler).
    const resetSearchState = () => {
        if (searchMode) {
            prevValue = '';
            searchInput.value = '';
            updateClearBtn();
            store.set('searchQuery', '');
            searchMode = false;
            switchBookmarkMenu(false);
        }
    };

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
        if (value === prevValue)
            return;
        prevValue = value;
        searchMode = true;
        switchBookmarkMenu(true);
        // v4 task 2: activate search view, remember source
        sourceViewId = getActiveView();
        activateView('search');

        const renderResults = results => {
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
                    html += `<li data-parentid="${result.parentId}" id="results-item-${id}" role="listitem">
                            ${generateBookmarkHTML(result.title, result.url, '', result.id, result.positions)}</li>`;
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
                    html += `<li id="results-item-${id}" role="listitem" data-parentid="${result.parentId}">
                            <a href="" class="link-folder tree-item-link">
                            <div class="favicon-container">
                            ${FOLDER_ICON}
                            ${syncIndicator}
                            </div>
                            <i>${folderTitle}</i>
                            </a></li>`;
                }
            }
            html += '</ul>';
            $tree.style.display = 'none';
            $results.innerHTML = html;
            $results.style.display = 'block';

            let lis = $results.querySelectorAll('li');
            const showPath = store.get('showItemPath', '1') !== 'false';
            for (let i = 0, l = lis.length; i < l; i++) {
                const li = lis[i];
                const parentId = li.dataset.parentid;
                if (!parentId) // empty-state row
                    continue;
                if (showPath && li.querySelector('a')) {
                    // Add path label placeholder — resolved asynchronously
                    const a = li.querySelector('a');
                    const tmp = a.innerHTML;
                    a.innerHTML = tmp + '<span class="row-path">...</span>';
                }
                chrome.bookmarks.get(parentId, node => {
                    if (!node || !node.length)
                        return;
                    const a = li.querySelector('a');
                    if (a && node[0]) {
                        a.title = `${_m('parentFolder', node[0].title || 'root')}\n${a.title}`;
                        // v4 task 2: update path label
                        const path = li.querySelector('.row-path');
                        if (path) {
                            path.textContent = node[0].title || '';
                        }
                    }
                });
            }

            lis = null;
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

    searchInput.addEventListener('input', e => {
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
        quitSearchMode(true);
        searchInput.focus();
    });

    searchInput.addEventListener('keydown', e => {
        const focusID = store.get('focusID');
        if (e.key === 'ArrowDown' && searchInput.value.length === searchInput.selectionEnd) { // down
            e.preventDefault();
            if (searchMode) {
                // may be the no-results empty state, which has no focusable row
                const firstResult = $results.querySelector('ul>li:first-child a');
                if (firstResult)
                    firstResult.focus();
            } else {
                $tree.querySelector('ul>li:first-child').querySelector('span, a').focus();
            }
        } else if (e.key === 'Enter' && searchInput.value.length) { // enter
            if (searchAfterEnter) {
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
        } else if (e.key === 'Tab' && !searchMode) { // tab
            if (typeof focusID !== 'undefined' && focusID !== null) {
                const focusEl = $(`neat-tree-item-${focusID}`);
                if (focusEl) {
                    e.preventDefault();
                    focusEl.firstElementChild.focus();
                }
            } else {
                const bound = $tree.scrollTop;
                const items = $tree.querySelectorAll('a, span');
                let firstItem = null;
                for (let i = 0, l = items.length; i < l; i++) {
                    const item = items[i];
                    if (!!item.parentElement.offsetHeight && ((item.offsetTop + item.offsetHeight) > bound)) {
                        firstItem = item;
                        break;
                    }
                }
                if (firstItem)
                    firstItem.focus();
            }
        } else if (e.key === 'Escape') { // esc
            if (searchInput.value) {
                // Pressing esc shouldn't close the popup when search field has value
                e.preventDefault();
                quitSearchMode(true);
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

    // ---- v4 task 2: Search history MRU (§4.3) -------------------------------
    // Pure-logic MRU helpers; exported for vitest.
    const MAX_HISTORY = 10;
    let searchHistorySessionFlag = false; // prevent re-auto-fill after manual clear

    const loadHistory = () => {
        try {
            const raw = store.get('searchHistory');
            return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
        } catch (e) { return []; }
    };

    const saveHistory = (arr) => {
        store.set('searchHistory', JSON.stringify(arr));
    };

    const addToHistory = (query, resultCount) => {
        if (!query || !query.trim()) return;
        if (store.get('searchHistoryEnabled', '1') === 'false') return;
        const q = query.trim();
        let hist = loadHistory();
        // Dedup by query text: remove existing, unshift new entry
        hist = hist.filter(h => (typeof h === 'string' ? h : h.q) !== q);
        hist.unshift({ q, c: resultCount || 0, t: Date.now() });
        if (hist.length > MAX_HISTORY) hist = hist.slice(0, MAX_HISTORY);
        saveHistory(hist);
    };

    const clearHistory = () => {
        store.set('searchHistory', '[]');
    };

    // Record current non-empty query into history with result count
    const recordSearchHistory = () => {
        if (searchInput.value && searchInput.value.trim()) {
            // Count current results (approximate: number of rendered result rows)
            const resultRows = $results.querySelectorAll('li:not(.empty-state)');
            addToHistory(searchInput.value, resultRows.length);
        }
    };

    // Restore last query on first search-view activation
    const restoreLastQuery = () => {
        if (searchHistorySessionFlag) return;
        if (store.get('dontRememberState')) return;
        const lastQuery = store.get('searchLastQuery');
        if (lastQuery && !searchInput.value) {
            searchInput.value = lastQuery;
            updateClearBtn();
            search();
        }
    };

    // Persist current query as last query (called on view leave / page close)
    const persistLastQuery = () => {
        if (searchInput.value && searchInput.value.trim()) {
            store.set('searchLastQuery', searchInput.value.trim());
        }
    };

    // Mark history recording on result open (called by bookmarkHandler)
    const onResultOpen = () => {
        recordSearchHistory();
        persistLastQuery();
    };

    // Override quitSearchMode to also record history
    const origQuit = quitSearchMode;
    quitSearchMode = (ignoreFocus) => {
        if (searchMode && searchInput.value && searchInput.value.trim()) {
            persistLastQuery();
        }
        origQuit(ignoreFocus);
    };

    // Wire search input Enter to record history (for searchAfterEnter mode)
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter' && searchInput.value.trim()) {
            recordSearchHistory();
        }
    });

    // Manual clear resets the session flag so auto-restore stops
    searchClearBtn.addEventListener('click', () => {
        searchHistorySessionFlag = true;
    });

    // v4 task 2: render search history block in empty search view
    const $historyArea = $('search-history-area');
    const $resultsArea = $('search-results-area');

    const renderHistoryBlock = () => {
        if (!$historyArea) return;
        if (store.get('searchHistoryEnabled', '1') === 'false') {
            $historyArea.innerHTML = '';
            return;
        }
        const hist = loadHistory();
        if (!hist.length) {
            $historyArea.innerHTML = '';
            return;
        }
        let html = `<div class="search-history">`;
        html += `<div class="search-history-title">${_m('searchHistoryTitle') || 'Recent searches'}</div>`;
        html += `<ul>`;
        for (const entry of hist) {
            const q = typeof entry === 'string' ? entry : entry.q;
            const c = typeof entry === 'object' ? (entry.c || 0) : 0;
            const t = typeof entry === 'object' && entry.t ? new Date(entry.t).toLocaleString() : '';
            html += `<li class="search-history-item">`;
            html += `<span class="search-history-query" role="button" tabindex="0" data-query="${q}">`;
            html += `<span class="sh-query-text">${q}</span>`;
            if (c > 0) html += `<span class="sh-query-count">${c} results</span>`;
            if (t) html += `<span class="sh-query-time">${t}</span>`;
            html += `</span>`;
            html += `<button class="search-history-remove" data-query="${q}" aria-label="${_m('searchHistoryRemove') || 'Remove'}">×</button>`;
            html += '</li>';
        }
        html += `<li><button class="search-history-clear">${_m('searchHistoryClear') || 'Clear all'}</button></li>`;
        html += `</ul></div>`;
        $historyArea.innerHTML = html;

        // Click to re-search
        $historyArea.querySelectorAll('.search-history-query').forEach(el => {
            el.addEventListener('click', () => {
                searchInput.value = el.dataset.query;
                updateClearBtn();
                search();
            });
        });
        // Remove single item
        $historyArea.querySelectorAll('.search-history-remove').forEach(el => {
            el.addEventListener('click', e => {
                e.stopPropagation();
                let hist = loadHistory();
                hist = hist.filter(h => (typeof h === 'string' ? h : h.q) !== el.dataset.query);
                saveHistory(hist);
                renderHistoryBlock();
            });
        });
        // Clear all
        const clearBtn = $historyArea.querySelector('.search-history-clear');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                clearHistory();
                $historyArea.innerHTML = '';
            });
        }
    };

    // Restore last query on search view activation (first time only)
    // (called when search view is activated with empty input)

    // v4 task 2: keyboard navigation for search results
    // On Enter, dispatch a click on the focused <a> to reuse the existing
    // bookmarkHandler (tree-view.js) which handles opening + search.reset.
    initListKeyboard($results, {});

    return {
        input: searchInput,
        results: $results,
        isActive: () => searchMode,
        quit: quitSearchMode,
        reset: resetSearchState,
        updateIndex: buildSearchIndex,
        // v4 task 2: search history API
        addToHistory,
        clearHistory,
        loadHistory,
        recordSearchHistory,
        restoreLastQuery,
        onResultOpen,
        renderHistoryBlock,
        get historyEnabled() { return store.get('searchHistoryEnabled', '1') !== 'false'; }
    };
}
