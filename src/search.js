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
 * initSearch(ctx) is called once by neat.js after DOM parse.
 * ctx.store                    — chrome.storage mirror (searchQuery, focusID, settings)
 * ctx.separatorManager         — filters separators out of the flat index
 * ctx.switchBookmarkMenu(disable) — hides/restores context-menu entries
 * ctx.generateBookmarkHTML(title, url, extras, id, positions, meta) — bookmark row HTML
 * ctx.highlightTitlePositions(title, positions) — escaped, <mark>-wrapped title
 * ctx.rememberState            — restore the persisted query on startup when true
 * ctx.views                    — view-manager API (activate/attach/pathOf)
 *
 * window.VBMFuzzy is loaded by fuzzy.js (classic script) before neat.js.
 * document/window/chrome remain page globals, as in the rest of the popup.
 * No neatools helpers here: plain getElementById/classList/loops only.
 */
import { FOLDER_ICON } from './icons.js';

// Same escape recipe as tree-render.js's module-private copy (modules stay
// self-contained): escape >, then <, then ".
const htmlspecialchars = s =>
    s.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

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
    let returnView = 'tree';

    const searchAfterEnter = !!store.get('searchAfterEnter');
    const $results = $('results');
    let searchMode = false;
    const searchInput = $('search-input');
    const searchClearBtn = $('search-clear');
    let prevValue = '';

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

    const quitSearchMode = (ignoreFocus) => {
        if (searchMode) {
            prevValue = '';
            if (searchInput.value) {
                searchInput.value = '';
            }
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

    // Empty-query content of the search view (slice A: a plain hint row;
    // slice B replaces it with the search-history area).
    const renderEmptyHint = () => {
        $results.innerHTML = `<ul role="list"><li class="empty-state" role="listitem"><i>${_m('searchViewHint')}</i></li></ul>`;
    };
    views.attach('search', {
        activate: () => {
            if (!searchInput.value)
                renderEmptyHint();
        },
        focus: () => searchInput.focus()
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
                    html += `<li class="vbm-row" data-parentid="${result.parentId}" id="results-item-${id}" role="listitem">
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
                    html += `<li id="results-item-${id}" role="listitem" data-parentid="${result.parentId}">
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

    return {
        input: searchInput,
        results: $results,
        isActive: () => searchMode,
        quit: quitSearchMode,
        reset: resetSearchState,
        updateIndex: buildSearchIndex
    };
}
