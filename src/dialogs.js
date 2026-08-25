/**
 * Popup dialogs (P1 module extracted from neat.js).
 *
 * Owns the five body-class-driven dialogs — alert / confirm / edit /
 * new-folder / sort — plus their shared chrome: button and form wiring, the
 * #cover click-to-close handler, an "is any dialog open" probe, and the
 * global error alert. Visibility is driven entirely by body classes
 * (needConfirm/needEdit/needInputName/needSort/needAlert) styled in
 * css/neat.css; this module only toggles those classes and the dialog fields.
 *
 * initDialogs(ctx) is called once by neat.js after DOM parse.
 * ctx.onSort(folderId, opts) runs when the sort dialog is confirmed.
 * document/window/chrome remain page globals, as in the rest of the popup.
 */
import { pickGroupColor, TAB_GROUP_COLORS } from './tab-group-utils.js';
import { htmlspecialchars } from './escape.js';
import { PIN_ICON, CLOCK_ICON, FOLDER_ICON } from './icons.js';
import {
    readIdList, writeIdList, recordRecent, togglePin, pruneIds, chipsModel
} from './folder-pick.js';

// Replaces neatools' String.prototype.widont with a pure function: keeps the
// last two words of a dialog message on one line.
export const widont = str => `${str}`.replace(/\s([^\s]+)$/i, '&nbsp;$1');

export function initDialogs(ctx = {}) {
    const $ = id => document.getElementById(id);
    const body = document.body;
    const _m = chrome.i18n.getMessage;
    const onSort = ctx.onSort || (() => {});
    // Issue #33: the sort dialog's options persist under one sortOptions key
    // (shared with the options page's Sorting group) so re-sorting a folder
    // keeps the last-used choices instead of resetting to defaults.
    const store = ctx.store;

    const AlertDialog = {
        open: dialog => {
            if (!dialog)
                return;
            rememberInvoker();
            $('alert-dialog-text').innerHTML = dialog;
            body.classList.add('needAlert');
        },
        close: () => {
            const wasOpen = body.classList.contains('needAlert');
            body.classList.remove('needAlert');
            restoreFocus(wasOpen);
        }
    };
    window.addEventListener('error', () => {
        AlertDialog.open(`<strong>${_m('errorOccured')}</strong><br>${_m('reportedToDeveloper')}`);
    }, false);

    const ConfirmDialog = {
        open: opts => {
            if (!opts)
                return;
            rememberInvoker();
            $('confirm-dialog-text').innerHTML = widont(opts.dialog);
            $('confirm-dialog-button-1').innerHTML = opts.button1;
            $('confirm-dialog-button-2').innerHTML = opts.button2;
            if (opts.fn1)
                ConfirmDialog.fn1 = opts.fn1;
            if (opts.fn2)
                ConfirmDialog.fn2 = opts.fn2;
            const focus = opts.focusButton || 1;
            $(`confirm-dialog-button-${focus}`).focus();
            body.classList.add('needConfirm');
        },
        close: () => {
            const wasOpen = body.classList.contains('needConfirm');
            body.classList.remove('needConfirm');
            restoreFocus(wasOpen);
        },
        fn1: () => {
        },
        fn2: () => {
        }
    };

    const EditDialog = {
        open: opts => {
            if (!opts)
                return;
            rememberInvoker();
            $('edit-dialog-text').innerHTML = widont(opts.dialog);
            if (opts.fn)
                EditDialog.fn = opts.fn;
            const type = opts.type || 'bookmark';
            const name = $('edit-dialog-name');
            name.value = opts.name;
            name.focus();
            name.select();
            name.scrollLeft = 0; // very delicate, show first few words instead of last
            const url = $('edit-dialog-url');
            if (type === 'bookmark') {
                url.style.display = '';
                url.disabled = false;
                url.value = opts.url;
            } else {
                url.style.display = 'none';
                url.disabled = true;
                url.value = '';
            }
            //if lose focus, the page will submit it if bellowing class exists.
            body.classList.add('needEdit');
        },
        close: needSave => {
            const wasOpen = body.classList.contains('needEdit');
            if (needSave === false) {
                body.classList.remove('needEdit');
                restoreFocus(wasOpen);
                return;
            }
            const urlInput = $('edit-dialog-url');
            let url = urlInput.value;
            if (!urlInput.validity.valid) {
                urlInput.value = `http://${url}`;
                if (!urlInput.validity.valid)
                    url = ''; // if still invalid, fuck it.
                url = `http://${url}`;
            }
            EditDialog.fn($('edit-dialog-name').value, url);
            body.classList.remove('needEdit');
            restoreFocus(wasOpen);
        },
        fn: () => {
        }
    };

    const NewFolderDialog = {
        open: (optName, optCall) => {
            rememberInvoker();
            $('new-folder-dialog-text').innerHTML = _m('editFolder');
            if (optCall)
                NewFolderDialog.fn = optCall;
            const name = $('new-folder-dialog-name');
            name.value = optName;
            name.focus();
            name.select();
            name.scrollLeft = 0;
            //if lose focus, the page will submit it if bellowing class exists.
            body.classList.add('needInputName');
        },
        close: needSave => {
            const wasOpen = body.classList.contains('needInputName');
            body.classList.remove('needInputName');
            if (needSave !== false) {
                NewFolderDialog.fn($('new-folder-dialog-name').value);
            }
            restoreFocus(wasOpen);
        },
        fn: () => {
        }
    };

    // Phase 3 (issue #33): sort a folder's children by title or date added.
    // Defaults match the pre-persistence behavior; readSortOptions falls back
    // to them on a missing or corrupted sortOptions key. The parsing lives in
    // sort-utils.js's VBMSort.parseSortOptions (shared with the options page).
    const readSortOptions = () => {
        if (!store || !window.VBMSort)
            return { by: 'title', foldersFirst: true, recursive: false };
        return window.VBMSort.parseSortOptions(store.get('sortOptions'));
    };
    const writeSortOptions = opts => {
        if (!store)
            return;
        store.set('sortOptions', JSON.stringify(opts));
    };
    const SortDialog = {
        open: folderId => {
            rememberInvoker();
            SortDialog.folderId = folderId;
            const opts = readSortOptions();
            $('sort-by-title').checked = opts.by !== 'dateAdded';
            $('sort-by-date').checked = opts.by === 'dateAdded';
            $('sort-folders-first').checked = opts.foldersFirst;
            $('sort-recursive').checked = opts.recursive;
            $('sort-recursive-warning').hidden = !opts.recursive;
            body.classList.add('needSort');
            $('sort-dialog-ok-button').focus();
        },
        close: () => {
            const wasOpen = body.classList.contains('needSort');
            body.classList.remove('needSort');
            SortDialog.folderId = null;
            restoreFocus(wasOpen);
        },
        folderId: null
    };
    $('sort-recursive').addEventListener('change', () => {
        $('sort-recursive-warning').hidden = !$('sort-recursive').checked;
    });
    $('sort-dialog-cancel-button').addEventListener('click', () => {
        SortDialog.close();
    });
    $('sort-dialog-ok-button').addEventListener('click', () => {
        const folderId = SortDialog.folderId;
        const opts = {
            by: $('sort-by-date').checked ? 'dateAdded' : 'title',
            foldersFirst: $('sort-folders-first').checked,
            recursive: $('sort-recursive').checked
        };
        SortDialog.close();
        if (!folderId)
            return;
        writeSortOptions(opts);
        onSort(folderId, opts);
    });

    // Tab-group creation dialog: define a new group's title + color before
    // the folder/bookmark is opened into it (Chrome's "new tab group"
    // title/color mechanism). The 9 color swatches live in the dialog HTML
    // as radio inputs; this object only reads the checked one.
    const GroupDialog = {
        open: opts => {
            if (!opts)
                return;
            rememberInvoker();
            // Reset first: an open without onConfirm must not inherit the
            // previous dialog's handler.
            GroupDialog.onConfirm = opts.onConfirm || (() => {});
            $('tab-group-dialog-text').innerHTML = widont(opts.dialog || _m('tabGroupDialogTitle'));
            const name = $('tab-group-name');
            name.value = opts.title || '';
            const color = opts.color || pickGroupColor(name.value || '');
            const radios = document.querySelectorAll('input[name="tab-group-color"]');
            let found = false;
            for (const r of radios) {
                r.checked = r.value === color;
                if (r.value === color)
                    found = true;
            }
            if (!found && radios[0])
                radios[0].checked = true;
            body.classList.add('needTabGroup');
            name.focus();
            name.select();
            name.scrollLeft = 0;
        },
        close: needSave => {
            const wasOpen = body.classList.contains('needTabGroup');
            body.classList.remove('needTabGroup');
            if (needSave !== false) {
                const name = $('tab-group-name');
                const checked = document.querySelector('input[name="tab-group-color"]:checked');
                GroupDialog.onConfirm(name.value.trim(), checked ? checked.value : 'grey');
            }
            restoreFocus(wasOpen);
        },
        onConfirm: () => {
        }
    };
    $('tab-group-dialog-button').addEventListener('click', () => {
        GroupDialog.close();
    });
    $('tab-group-dialog-cancel-button').addEventListener('click', () => {
        GroupDialog.close(false);
    });
    // Enter in the title input saves (same path as the Save button); Escape
    // is left to the global Esc layer.
    $('tab-group-name').addEventListener('keydown', e => {
        if (e.key !== 'Enter')
            return;
        e.preventDefault();
        GroupDialog.close();
    });
    // The color swatches are visually-hidden radios — give each a localized
    // accessible name; the visible dot is purely decorative.
    const COLOR_NAMES = {
        grey: _m('tabGroupColorGrey'), blue: _m('tabGroupColorBlue'), red: _m('tabGroupColorRed'),
        yellow: _m('tabGroupColorYellow'), green: _m('tabGroupColorGreen'), pink: _m('tabGroupColorPink'),
        purple: _m('tabGroupColorPurple'), cyan: _m('tabGroupColorCyan'), orange: _m('tabGroupColorOrange')
    };
    document.querySelectorAll('input[name="tab-group-color"]').forEach(r => {
        if (COLOR_NAMES[r.value])
            r.setAttribute('aria-label', COLOR_NAMES[r.value]);
    });

    // Existing-tab-group picker: list the browser's current tab groups (from
    // chrome.tabGroups.query) and open the selection into the chosen one.
    const GroupPickDialog = {
        open: opts => {
            if (!opts)
                return;
            rememberInvoker();
            // Reset first: an open without onPick must not inherit the
            // previous picker's handler.
            GroupPickDialog.onPick = opts.onPick || (() => {});
            $('tab-group-pick-text').innerHTML = widont(opts.dialog || _m('tabGroupPickDialogTitle'));
            const groups = opts.groups || [];
            // Stable order: by title, then by id — so repeated opens of the
            // same set land on the same row order.
            const sorted = [...groups].sort((a, b) =>
                (a.title || '').localeCompare(b.title || '') || String(a.id).localeCompare(String(b.id)));
            const list = $('tab-group-pick-list');
            list.innerHTML = '';
            if (!sorted.length) {
                const li = document.createElement('li');
                li.className = 'tab-group-pick-empty';
                li.textContent = _m('tabGroupNoGroups');
                list.appendChild(li);
            } else {
                for (const g of sorted) {
                    const li = document.createElement('li');
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'tab-group-pick-row';
                    // Full title as tooltip — long group titles truncate in the row.
                    btn.title = g.title || '';
                    btn.innerHTML =
                        `<span class="tab-group-dot tg-${htmlspecialchars(g.color || 'grey')}"></span>` +
                        `<span class="tab-group-pick-title">${htmlspecialchars(g.title || _m('tabGroupUntitled'))}</span>`;
                    btn.addEventListener('click', () => {
                        GroupPickDialog.onPick(g.id);
                        GroupPickDialog.close();
                    });
                    li.appendChild(btn);
                    list.appendChild(li);
                }
            }
            body.classList.add('needGroupPick');
            const firstBtn = list.querySelector('button');
            if (firstBtn)
                firstBtn.focus();
            else
                $('tab-group-pick-cancel-button').focus();
        },
        close: () => {
            const wasOpen = body.classList.contains('needGroupPick');
            body.classList.remove('needGroupPick');
            restoreFocus(wasOpen);
        },
        onPick: () => {
        }
    };
    $('tab-group-pick-cancel-button').addEventListener('click', () => {
        GroupPickDialog.close();
    });

    // Copy-or-move choice dialog for the tab-groups view: before grouping
    // tabs that already belong to a group, ask whether to copy (open new
    // tabs) or move (remove from the original group). A cancel button keeps
    // Esc neutral — unlike ConfirmDialog, whose Esc resolves fn2.
    const CopyMoveDialog = {
        open: opts => {
            if (!opts)
                return;
            const textEl = $('copy-move-dialog-text');
            const moveEl = $('copy-move-move-button');
            const copyEl = $('copy-move-copy-button');
            const cancelEl = $('copy-move-cancel-button');
            if (!textEl || !moveEl || !copyEl || !cancelEl)
                return;
            rememberInvoker();
            CopyMoveDialog.onMove = opts.onMove || (() => {});
            CopyMoveDialog.onCopy = opts.onCopy || (() => {});
            textEl.innerHTML = widont(opts.dialog || _m('tabGroupsCopyMoveDialog'));
            moveEl.innerHTML = `<strong>${htmlspecialchars(_m('tabGroupsCopyMoveMove'))}</strong>`;
            copyEl.innerHTML = htmlspecialchars(_m('tabGroupsCopyMoveCopy'));
            cancelEl.innerHTML = htmlspecialchars(_m('nope'));
            body.classList.add('needCopyMove');
            moveEl.focus();
        },
        close: action => {
            const wasOpen = body.classList.contains('needCopyMove');
            body.classList.remove('needCopyMove');
            if (action === 'move')
                CopyMoveDialog.onMove();
            else if (action === 'copy')
                CopyMoveDialog.onCopy();
            restoreFocus(wasOpen);
        },
        onMove: () => {
        },
        onCopy: () => {
        }
    };
    const copyMoveMoveBtn = $('copy-move-move-button');
    if (copyMoveMoveBtn)
        copyMoveMoveBtn.addEventListener('click', () => {
            CopyMoveDialog.close('move');
        });
    const copyMoveCopyBtn = $('copy-move-copy-button');
    if (copyMoveCopyBtn)
        copyMoveCopyBtn.addEventListener('click', () => {
            CopyMoveDialog.close('copy');
        });
    const copyMoveCancelBtn = $('copy-move-cancel-button');
    if (copyMoveCancelBtn)
        copyMoveCancelBtn.addEventListener('click', () => {
            CopyMoveDialog.close(false);
        });

    // Bookmark-folder picker (velvet staging §4.1): the tab-groups view's
    // destination picker, extended into the staging area's move/copy target
    // dialog. Structure top-down: quick-pick chips row (pins in user order,
    // then LRU recents — both pruned against the live tree at open), a
    // filter input, the flat indented folder list (each row with an inline
    // pin toggle), the dual-state note, and the action buttons.
    //
    // open({ dialog, mode?, hasUnfav?, onPick(folderId, action) }):
    //   - no `mode` key: LEGACY single-select (tab-groups) — a row click
    //     commits immediately, action = 'pick', button area stays a lone
    //     cancel (4.1.0 behavior);
    //   - mode === null: three-button form [Move here][Copy here][Cancel] —
    //     row/chip click only SELECTS, the action button commits;
    //   - mode === 'move'|'copy': locked single action + cancel.
    // Every successful pick records the target into folderPickRecents (all
    // picker uses share the roster). close({ restoreFocus = true }) — the
    // old inverted `close(false)` quirk is regularized.
    const BookmarkFolderPickDialog = {
        mode: 'pick',
        selectedFolderId: null,
        folders: [],
        onPick: () => {
        },
        open: opts => {
            if (!opts)
                return;
            rememberInvoker();
            BookmarkFolderPickDialog.onPick = opts.onPick || (() => {});
            // Folder move/copy safety (velvet staging §5.1 extension): callers
            // moving a FOLDER pass its own subtree's ids as excludeIds — the
            // picker hides those rows and chips so a move can never target
            // the folder itself or a descendant (a Chrome-rejected cycle).
            BookmarkFolderPickDialog.excludeIds = (opts.excludeIds && opts.excludeIds.length)
                ? new Set(opts.excludeIds.map(String))
                : null;
            const hasMode = Object.prototype.hasOwnProperty.call(opts, 'mode');
            BookmarkFolderPickDialog.mode = hasMode ? opts.mode : 'pick';
            BookmarkFolderPickDialog.selectedFolderId = null;
            const textEl = $('bookmark-folder-pick-text');
            const list = $('bookmark-folder-pick-list');
            const cancelEl = $('bookmark-folder-pick-cancel-button');
            const moveEl = $('bookmark-folder-pick-move-button');
            const copyEl = $('bookmark-folder-pick-copy-button');
            const chipsEl = $('bookmark-folder-pick-chips');
            const filterEl = $('bookmark-folder-pick-filter');
            const noteEl = $('bookmark-folder-pick-note');
            if (!textEl || !list || !cancelEl)
                return;
            textEl.innerHTML = widont(opts.dialog || _m('bookmarkFolderPickDialogTitle'));
            cancelEl.innerHTML = htmlspecialchars(_m('nope'));
            list.innerHTML = '';
            const isLegacy = BookmarkFolderPickDialog.mode === 'pick';
            const showMove = !isLegacy && BookmarkFolderPickDialog.mode !== 'copy';
            const showCopy = !isLegacy && BookmarkFolderPickDialog.mode !== 'move';
            if (moveEl) {
                moveEl.hidden = !showMove;
                moveEl.innerHTML = `<strong>${htmlspecialchars(_m('folderPickMoveHere'))}</strong>`;
                moveEl.disabled = true;
            }
            if (copyEl) {
                copyEl.hidden = !showCopy;
                copyEl.innerHTML = htmlspecialchars(_m('folderPickCopyHere'));
                copyEl.disabled = true;
            }
            if (noteEl) {
                noteEl.hidden = !opts.hasUnfav;
                noteEl.innerHTML = htmlspecialchars(_m('folderPickFavNote'));
            }
            if (filterEl) {
                filterEl.value = '';
                filterEl.placeholder = _m('folderPickFilter');
            }
            const render = tree => {
                const folders = [];
                const paths = new Map();
                const walk = (nodes, depth, prefix) => {
                    for (let i = 0, l = (nodes || []).length; i < l; i++) {
                        const node = nodes[i];
                        if (!node.children)
                            continue;
                        const title = node.title || _m('noTitle');
                        const path = prefix ? `${prefix} / ${title}` : title;
                        folders.push({ id: node.id, title, depth, path });
                        paths.set(node.id, path);
                        walk(node.children, depth + 1, path);
                    }
                };
                const roots = (tree && tree[0] && tree[0].children) ? tree[0].children : (tree || []);
                walk(roots, 0, '');
                BookmarkFolderPickDialog.folders = folders;
                // The roster-prune `valid` set stays COMPLETE (banned folders
                // included) — excluding them from the walk would permanently
                // prune pins/recents pointing into the moved folder's
                // subtree; only the rendered rows/chips skip them.
                const banned = BookmarkFolderPickDialog.excludeIds;
                // Lazy roster hygiene: drop pin/recent ids the tree no longer
                // has, writing back only when something actually died.
                const valid = new Set(folders.map(f => f.id));
                let pins = readIdList(store ? store.get('folderPickPins') : null);
                let recents = readIdList(store ? store.get('folderPickRecents') : null);
                if (!recents.length && store) {
                    const quick = store.get('quickAddFolderId', '1');
                    if (valid.has(quick))
                        recents = [quick];
                }
                const prunedPins = pruneIds(pins, valid);
                const prunedRecents = pruneIds(recents, valid);
                if (store && (prunedPins.changed || prunedRecents.changed)) {
                    pins = prunedPins.list;
                    recents = prunedRecents.list;
                    store.set('folderPickPins', writeIdList(pins));
                    store.set('folderPickRecents', writeIdList(recents));
                }
                BookmarkFolderPickDialog.renderChips(chipsEl, pins, prunedRecents.list, paths);
                renderRows(list, banned
                    ? folders.filter(f => !banned.has(String(f.id)))
                    : folders, pins, isLegacy);
            };
            const renderRows = (list2, folders, pins, isLegacy2) => {
                if (!folders.length) {
                    const li = document.createElement('li');
                    li.className = 'bookmark-folder-pick-empty';
                    li.textContent = _m('bookmarkFolderNoFolders');
                    list2.appendChild(li);
                    return;
                }
                const pinSet = new Set(pins.map(String));
                for (const f of folders) {
                    const li = document.createElement('li');
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'bookmark-folder-pick-row';
                    btn.style.paddingInlineStart = `${8 + f.depth * 16}px`;
                    btn.title = f.path;
                    btn.innerHTML = `${FOLDER_ICON}<span class="bookmark-folder-pick-name" dir="auto"></span>`;
                    const nameSpan = btn.querySelector ? btn.querySelector('.bookmark-folder-pick-name') : null;
                    if (nameSpan)
                        nameSpan.textContent = f.title;
                    else
                        btn.textContent = f.title;
                    if (btn.dataset)
                        btn.dataset.folderId = f.id;
                    btn.addEventListener('click', () => {
                        if (isLegacy2)
                            BookmarkFolderPickDialog.commit(f.id, 'pick');
                        else
                            BookmarkFolderPickDialog.select(f.id);
                    });
                    li.appendChild(btn);
                    const pinBtn = document.createElement('button');
                    pinBtn.type = 'button';
                    const pinned = pinSet.has(String(f.id));
                    pinBtn.className = 'row-btn folder-pick-pin-btn' + (pinned ? ' pinned' : '');
                    pinBtn.innerHTML = PIN_ICON;
                    const pinLabel = _m(pinned ? 'unpinFolder' : 'pinFolder');
                    pinBtn.title = pinLabel;
                    pinBtn.setAttribute('aria-label', pinLabel);
                    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
                    if (pinBtn.dataset)
                        pinBtn.dataset.folderId = f.id;
                    pinBtn.addEventListener('click', e => {
                        if (e && e.stopPropagation)
                            e.stopPropagation();
                        BookmarkFolderPickDialog.togglePinFor(f.id);
                    });
                    li.appendChild(pinBtn);
                    list2.appendChild(li);
                }
            };
            chrome.bookmarks.getTree(render);
            body.classList.add('needFolderPick');
            if (!isLegacy && filterEl && filterEl.focus)
                filterEl.focus();
            else
                cancelEl.focus();
        },
        // Row/chip selection in the action modes: highlight the target and
        // arm the move/copy buttons (the commit happens on those).
        select: id => {
            BookmarkFolderPickDialog.selectedFolderId = id;
            const list = $('bookmark-folder-pick-list');
            const moveEl = $('bookmark-folder-pick-move-button');
            const copyEl = $('bookmark-folder-pick-copy-button');
            if (list && list.querySelectorAll) {
                for (const btn of list.querySelectorAll('button')) {
                    const cls = btn.className || '';
                    if (cls.indexOf('bookmark-folder-pick-row') < 0)
                        continue;
                    btn.className = 'bookmark-folder-pick-row' +
                        (String(btn.dataset ? btn.dataset.folderId : '') === String(id) ? ' selected' : '');
                }
            }
            if (moveEl)
                moveEl.disabled = !id;
            if (copyEl)
                copyEl.disabled = !id;
        },
        // Every successful target pick feeds the LRU recents roster —
        // tab-groups saves, staging move/copy, group-level homing all share it.
        commit: (id, action) => {
            if (store) {
                store.set('folderPickRecents',
                    writeIdList(recordRecent(readIdList(store.get('folderPickRecents')), id)));
            }
            BookmarkFolderPickDialog.onPick(id, action);
            BookmarkFolderPickDialog.close();
        },
        commitAction: action => {
            const id = BookmarkFolderPickDialog.selectedFolderId;
            if (!id)
                return;
            BookmarkFolderPickDialog.commit(id, action);
        },
        renderChips: (chipsEl, pins, recents, paths) => {
            if (!chipsEl)
                return;
            // Cycle safety: banned chips never render (a pinned/recent target
            // inside the folder being moved stays in the roster, just hidden).
            const banned = BookmarkFolderPickDialog.excludeIds;
            const allowed = id => !banned || !banned.has(String(id));
            const model = chipsModel(pins, recents);
            let html = '';
            const chip = (id, icon) => {
                const path = paths.get(id) || '';
                return `<button type="button" class="folder-pick-chip" data-folder-id="${id}" ` +
                    `title="${htmlspecialchars(path)}">${icon}` +
                    `<span class="folder-pick-chip-name" dir="auto">${htmlspecialchars(path || id)}</span></button>`;
            };
            if (model.pins.length) {
                const shown = model.pins.filter(allowed);
                if (shown.length) {
                    html += `<span class="folder-pick-chip-label">${htmlspecialchars(_m('folderPickPinned'))}</span>`;
                    for (const id of shown)
                        html += chip(id, PIN_ICON);
                }
            }
            if (model.recents.length) {
                const shown = model.recents.filter(allowed);
                if (shown.length) {
                    html += `<span class="folder-pick-chip-label">${htmlspecialchars(_m('folderPickRecent'))}</span>`;
                    for (const id of shown)
                        html += chip(id, CLOCK_ICON);
                }
            }
            chipsEl.innerHTML = html;
            chipsEl.hidden = !html;
        },
        // Path lookup rebuilt from the last tree walk (depth-first order
        // lets an ancestor stack per depth reconstruct every full path).
        pathsOf: () => {
            const map = new Map();
            const stack = [];
            for (const f of BookmarkFolderPickDialog.folders) {
                stack[f.depth] = f.title;
                stack.length = f.depth + 1;
                map.set(f.id, stack.join(' / '));
            }
            return map;
        },
        togglePinFor: id => {
            if (!store)
                return;
            store.set('folderPickPins',
                writeIdList(togglePin(readIdList(store.get('folderPickPins')), id)));
            const nowPins = new Set(readIdList(store.get('folderPickPins')).map(String));
            const valid = new Set(BookmarkFolderPickDialog.folders.map(x => x.id));
            BookmarkFolderPickDialog.renderChips($('bookmark-folder-pick-chips'),
                [...nowPins],
                pruneIds(readIdList(store.get('folderPickRecents')), valid).list,
                BookmarkFolderPickDialog.pathsOf());
            const list = $('bookmark-folder-pick-list');
            if (!list || !list.querySelectorAll)
                return;
            for (const rowBtn of list.querySelectorAll('button')) {
                const cls = rowBtn.className || '';
                if (cls.indexOf('folder-pick-pin-btn') < 0)
                    continue;
                const on = nowPins.has(String(rowBtn.dataset ? rowBtn.dataset.folderId : ''));
                rowBtn.className = 'row-btn folder-pick-pin-btn' + (on ? ' pinned' : '');
                rowBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
                rowBtn.title = _m(on ? 'unpinFolder' : 'pinFolder');
            }
        },
        close: opts => {
            const open = body.classList.contains('needFolderPick');
            body.classList.remove('needFolderPick');
            const restore = !opts || opts.restoreFocus !== false;
            if (restore)
                restoreFocus(open);
        }
    };
    const folderPickCancelBtn = $('bookmark-folder-pick-cancel-button');
    if (folderPickCancelBtn)
        folderPickCancelBtn.addEventListener('click', () => {
            BookmarkFolderPickDialog.close();
        });
    const folderPickMoveBtn = $('bookmark-folder-pick-move-button');
    if (folderPickMoveBtn)
        folderPickMoveBtn.addEventListener('click', () => {
            BookmarkFolderPickDialog.commitAction('move');
        });
    const folderPickCopyBtn = $('bookmark-folder-pick-copy-button');
    if (folderPickCopyBtn)
        folderPickCopyBtn.addEventListener('click', () => {
            BookmarkFolderPickDialog.commitAction('copy');
        });
    // Chips row: click = same semantics as a list row (legacy commits, the
    // action modes select). Bound ONCE — open() only re-renders the HTML.
    const folderPickChips = $('bookmark-folder-pick-chips');
    if (folderPickChips)
        folderPickChips.addEventListener('click', e => {
            const t = e && e.target ? e.target : null;
            const closest = t && t.closest ? t.closest.bind(t) : () => null;
            const chipBtn = closest('.folder-pick-chip');
            const id = chipBtn && chipBtn.dataset ? chipBtn.dataset.folderId : null;
            if (!id)
                return;
            if (BookmarkFolderPickDialog.mode === 'pick')
                BookmarkFolderPickDialog.commit(id, 'pick');
            else
                BookmarkFolderPickDialog.select(id);
        });
    // Filter input: live-filters the indented list by title substring.
    const folderPickFilter = $('bookmark-folder-pick-filter');
    if (folderPickFilter)
        folderPickFilter.addEventListener('input', () => {
            const needle = (folderPickFilter.value || '').toLowerCase();
            const list = $('bookmark-folder-pick-list');
            if (!list || !list.querySelectorAll)
                return;
            for (const btn of list.querySelectorAll('button')) {
                const cls = btn.className || '';
                if (cls.indexOf('bookmark-folder-pick-row') < 0)
                    continue;
                const match = !needle || (btn.textContent || '').toLowerCase().indexOf(needle) >= 0;
                btn.style.display = match ? '' : 'none';
            }
        });
    // ↑/↓/Home/End walk the folder rows: a long folder tree is unreachable
    // when Tab is the only way through it (4.1.0 audit L3). Enter/Space pick
    // the focused row natively (they are buttons). The walk only covers the
    // folder rows themselves — the inline pin toggles are reached by Tab.
    const folderPickList = $('bookmark-folder-pick-list');
    if (folderPickList)
        folderPickList.addEventListener('keydown', e => {
            if (!/^(ArrowDown|ArrowUp|Home|End)$/.test(e.key))
                return;
            const all = folderPickList.querySelectorAll
                ? folderPickList.querySelectorAll('button') : [];
            const btns = [];
            for (const b of all)
                if ((b.className || '').indexOf('bookmark-folder-pick-row') >= 0)
                    btns.push(b);
            if (!btns.length)
                return;
            e.preventDefault();
            const active = document.activeElement;
            let idx = -1;
            for (let i = 0; i < btns.length; i++)
                if (btns[i] === active) {
                    idx = i;
                    break;
                }
            if (e.key === 'Home')
                idx = 0;
            else if (e.key === 'End')
                idx = btns.length - 1;
            else
                idx = Math.min(btns.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)));
            btns[idx].focus();
        });

    // Events for dialogs
    $('confirm-dialog-button-1').addEventListener('click', () => {
        ConfirmDialog.fn1();
        ConfirmDialog.close();
    });
    $('confirm-dialog-button-2').addEventListener('click', () => {
        ConfirmDialog.fn2();
        ConfirmDialog.close();
    });
    $('edit-dialog-cancel-button').addEventListener('click', () => {
        EditDialog.close(false);
    });
    $('new-folder-dialog-cancel-button').addEventListener('click', () => {
        NewFolderDialog.close(false);
    });
    $('edit-dialog-form').addEventListener('submit', () => {
        EditDialog.close();
        return false;
    });
    $('new-folder-dialog-form').addEventListener('submit', () => {
        NewFolderDialog.close();
        return false;
    });

    // Staging group-assign dialog (velvet staging §3.3): move the selected
    // items into an existing group (click its row) or a freshly named one
    // (type + confirm). A body-class dialog like the rest — Esc, #cover and
    // the Tab trap ride anyOpen()/activeEl()/closeDialogs().
    const StagingGroupAssignDialog = {
        onAssign: () => {
        },
        open: opts => {
            if (!opts)
                return;
            rememberInvoker();
            StagingGroupAssignDialog.onAssign = opts.onAssign || (() => {});
            const textEl = $('staging-group-assign-text');
            const list = $('staging-group-assign-list');
            const nameEl = $('staging-group-assign-name');
            const okEl = $('staging-group-assign-button');
            const cancelEl = $('staging-group-assign-cancel-button');
            if (!textEl || !list || !nameEl || !okEl || !cancelEl)
                return;
            textEl.innerHTML = widont(opts.dialog || _m('stagingGroupAssignTitle'));
            okEl.innerHTML = `<strong>${htmlspecialchars(_m('stagingGroupNew'))}</strong>`;
            cancelEl.innerHTML = htmlspecialchars(_m('nope'));
            nameEl.value = '';
            nameEl.placeholder = _m('stagingGroupNamePrompt');
            list.innerHTML = '';
            for (const g of opts.groups || []) {
                const li = document.createElement('li');
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'staging-group-assign-row';
                btn.innerHTML = `<span class="staging-group-assign-name" dir="auto">${htmlspecialchars(g.name || _m('noTitle'))}</span>` +
                    `<span class="count-pill">${g.count}</span>`;
                btn.addEventListener('click', () => {
                    StagingGroupAssignDialog.onAssign(g.id, g.name);
                    StagingGroupAssignDialog.close();
                });
                li.appendChild(btn);
                list.appendChild(li);
            }
            if (!(opts.groups || []).length) {
                const li = document.createElement('li');
                li.className = 'staging-group-assign-empty';
                li.textContent = _m('stagingGroupNoGroups');
                list.appendChild(li);
            }
            body.classList.add('needStagingGroupAssign');
            nameEl.focus();
        },
        close: () => {
            const wasOpen = body.classList.contains('needStagingGroupAssign');
            body.classList.remove('needStagingGroupAssign');
            restoreFocus(wasOpen);
        },
        // Confirm with a NEW group name (the [New group] button / Enter).
        confirm: () => {
            const nameEl = $('staging-group-assign-name');
            const name = nameEl ? nameEl.value.trim() : '';
            if (!name)
                return;
            StagingGroupAssignDialog.onAssign(null, name);
            StagingGroupAssignDialog.close();
        }
    };
    const stagingGroupAssignOk = $('staging-group-assign-button');
    if (stagingGroupAssignOk)
        stagingGroupAssignOk.addEventListener('click', () => {
            StagingGroupAssignDialog.confirm();
        });
    const stagingGroupAssignCancel = $('staging-group-assign-cancel-button');
    if (stagingGroupAssignCancel)
        stagingGroupAssignCancel.addEventListener('click', () => {
            StagingGroupAssignDialog.close();
        });
    const stagingGroupAssignName = $('staging-group-assign-name');
    if (stagingGroupAssignName)
        stagingGroupAssignName.addEventListener('keydown', e => {
            if (e.key !== 'Enter')
                return;
            e.preventDefault();
            StagingGroupAssignDialog.confirm();
        });

    // Move-to shortcut editor (velvet staging workbench round): target
    // folder (via the shared picker, legacy single-select), alias input
    // and the tab-group color palette. A body-class dialog like the rest
    // — Esc / #cover / the Tab trap ride anyOpen()/activeEl()/closeDialogs.
    const StagingShortcutDialog = {
        onSave: () => {
        },
        editingId: null,
        folderId: null,
        color: 'blue',
        open: opts => {
            if (!opts)
                return;
            rememberInvoker();
            StagingShortcutDialog.onSave = opts.onSave || (() => {});
            const sc = opts.shortcut || null;
            StagingShortcutDialog.editingId = sc ? sc.id : null;
            StagingShortcutDialog.folderId = sc ? sc.folderId : null;
            StagingShortcutDialog.color = (sc && sc.color) || 'blue';
            const textEl = $('staging-shortcut-text');
            const aliasEl = $('staging-shortcut-alias');
            const folderEl = $('staging-shortcut-folder');
            const colorsEl = $('staging-shortcut-colors');
            const saveEl = $('staging-shortcut-save');
            const cancelEl = $('staging-shortcut-cancel');
            const colorLabel = $('staging-shortcut-color-label');
            if (!textEl || !aliasEl || !folderEl || !colorsEl || !saveEl || !cancelEl)
                return;
            if (colorLabel)
                colorLabel.textContent = _m('tabGroupColorLabel');
            textEl.innerHTML = widont(_m(sc ? 'stagingShortcutEdit' : 'stagingShortcutTitle'));
            saveEl.innerHTML = `<strong>${htmlspecialchars(_m('stagingShortcutSave'))}</strong>`;
            cancelEl.innerHTML = htmlspecialchars(_m('nope'));
            aliasEl.value = sc && sc.alias ? sc.alias : '';
            aliasEl.placeholder = _m('stagingShortcutAlias');
            StagingShortcutDialog.setFolderLabel(folderEl, StagingShortcutDialog.folderId);
            colorsEl.innerHTML = TAB_GROUP_COLORS.map(c =>
                `<label class="tab-group-color tg-${c}">` +
                `<input type="radio" name="staging-shortcut-color" value="${c}" class="visually-hidden"` +
                (StagingShortcutDialog.color === c ? ' checked' : '') + `><span></span></label>`).join('');
            body.classList.add('needStagingShortcut');
            aliasEl.focus();
        },
        setFolderLabel: (folderEl, folderId) => {
            if (!folderId) {
                folderEl.textContent = _m('stagingShortcutPickFolder');
                folderEl.classList.add('empty');
                return;
            }
            chrome.bookmarks.get(folderId, nodes => {
                const node = nodes && nodes[0];
                folderEl.textContent = node && node.title ? node.title : folderId;
                folderEl.title = folderId;
                folderEl.classList.remove('empty');
            });
        },
        pickFolder: () => {
            BookmarkFolderPickDialog.open({
                dialog: _m('stagingShortcutPickFolder'),
                onPick: id => {
                    StagingShortcutDialog.folderId = id;
                    StagingShortcutDialog.setFolderLabel($('staging-shortcut-folder'), id);
                }
            });
        },
        confirm: () => {
            if (!StagingShortcutDialog.folderId)
                return;
            const aliasEl = $('staging-shortcut-alias');
            const alias = aliasEl ? aliasEl.value.trim() : '';
            StagingShortcutDialog.onSave({
                id: StagingShortcutDialog.editingId || null,
                folderId: StagingShortcutDialog.folderId,
                alias,
                color: StagingShortcutDialog.color
            });
            StagingShortcutDialog.close();
        },
        close: () => {
            const wasOpen = body.classList.contains('needStagingShortcut');
            body.classList.remove('needStagingShortcut');
            restoreFocus(wasOpen);
        }
    };
    const stagingShortcutSave = $('staging-shortcut-save');
    if (stagingShortcutSave)
        stagingShortcutSave.addEventListener('click', () => StagingShortcutDialog.confirm());
    const stagingShortcutCancel = $('staging-shortcut-cancel');
    if (stagingShortcutCancel)
        stagingShortcutCancel.addEventListener('click', () => StagingShortcutDialog.close());
    const stagingShortcutFolder = $('staging-shortcut-folder');
    if (stagingShortcutFolder)
        stagingShortcutFolder.addEventListener('click', () => StagingShortcutDialog.pickFolder());
    const stagingShortcutAlias = $('staging-shortcut-alias');
    if (stagingShortcutAlias)
        stagingShortcutAlias.addEventListener('keydown', e => {
            if (e.key !== 'Enter')
                return;
            e.preventDefault();
            StagingShortcutDialog.confirm();
        });
    const stagingShortcutColors = $('staging-shortcut-colors');
    if (stagingShortcutColors)
        stagingShortcutColors.addEventListener('change', e => {
            if (e.target && e.target.value)
                StagingShortcutDialog.color = e.target.value;
        });

    // Version dialog (/version palette command): a metadata card + copy-to-
    // clipboard action + the palette-style footer close button (Esc hint).
    // It is a body-class dialog like the rest, so keyboard.js's Escape layer
    // and dialog Tab trap pick it up through anyOpen()/activeEl().
    const VersionDialog = {
        meta: null,
        open: meta => {
            if (!meta) return;
            rememberInvoker();
            VersionDialog.meta = meta;
            const esc = htmlspecialchars;
            const _v = (key, val) => `<div class="version-meta-row"><dt>${esc(_m(key))}</dt><dd>${esc(val)}</dd></div>`;
            $('version-dialog-text').textContent = _m('versionDialogTitle', [meta.version]);
            $('version-dialog-meta').innerHTML = [
                _v('versionMetaVersion', meta.version),
                _v('versionMetaAnnounce', meta.announce || _m('versionMetaAnnounceNone')),
                _v('versionMetaBrowser', `${meta.browser}${meta.browserVersion ? ' ' + meta.browserVersion : ''}`),
                _v('versionMetaOS', meta.os || ''),
                _v('versionMetaChannel', meta.channel || ''),
                _v('versionMetaLanguage', meta.language || ''),
                _v('versionMetaUserAgent', meta.userAgent || '')
            ].join('');
            const copyBtn = $('version-dialog-copy');
            if (copyBtn) {
                copyBtn.textContent = _m('versionDialogCopy');
            }
            const closeBtn = $('version-dialog-close');
            if (closeBtn) {
                // Keep the markup's <kbd>Esc</kbd> intact — fill the label
                // span like the palette's close bar instead of rewriting
                // the whole innerHTML.
                const label = closeBtn.querySelector('.version-close-label');
                if (label)
                    label.textContent = _m('paletteClose');
                closeBtn.setAttribute('aria-label', _m('paletteClose'));
            }
            body.classList.add('needVersion');
            if (copyBtn)
                copyBtn.focus();
        },
        close: () => {
            const wasOpen = body.classList.contains('needVersion');
            body.classList.remove('needVersion');
            VersionDialog.meta = null;
            restoreFocus(wasOpen);
        },
        copy: async () => {
            const btn = $('version-dialog-copy');
            const text = JSON.stringify(VersionDialog.meta, null, 2);
            let done = false;
            if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(text);
                    done = true;
                } catch (e) { /* focus lost etc. — try the execCommand path */ }
            }
            if (!done && typeof document !== 'undefined' && document.body) {
                const ta = document.createElement('textarea');
                ta.value = text;
                document.body.appendChild(ta);
                ta.select();
                try {
                    document.execCommand('copy');
                    done = true;
                } catch (e) { /* no clipboard path available */ }
                ta.remove();
            }
            if (done && btn) {
                btn.textContent = _m('versionDialogCopied');
                setTimeout(() => {
                    if (btn && body.classList.contains('needVersion'))
                        btn.textContent = _m('versionDialogCopy');
                }, 1500);
            }
        }
    };
    const versionCopyBtn = $('version-dialog-copy');
    if (versionCopyBtn)
        versionCopyBtn.addEventListener('click', () => VersionDialog.copy());
    const versionCloseBtn = $('version-dialog-close');
    if (versionCloseBtn)
        versionCloseBtn.addEventListener('click', () => VersionDialog.close());

    // True while any dialog's body class is set (used by the Escape handler)
    const anyOpen = () => body.classList.contains('needConfirm') || body.classList.contains('needEdit') ||
        body.classList.contains('needAlert') || body.classList.contains('needInputName') ||
        body.classList.contains('needSort') || body.classList.contains('needTabGroup') ||
        body.classList.contains('needGroupPick') || body.classList.contains('needVersion') ||
        body.classList.contains('needCopyMove') || body.classList.contains('needFolderPick') ||
        body.classList.contains('needStagingShortcut');

    // The open dialog's own element — keyboard.js's modal Tab trap cycles
    // within it. Null when nothing is up; precedence mirrors closeDialogs.
    const activeEl = () => {
        if (body.classList.contains('needConfirm'))
            return $('confirm-dialog');
        if (body.classList.contains('needEdit'))
            return $('edit-dialog');
        if (body.classList.contains('needInputName'))
            return $('new-folder-dialog');
        if (body.classList.contains('needSort'))
            return $('sort-dialog');
        if (body.classList.contains('needTabGroup'))
            return $('tab-group-dialog');
        if (body.classList.contains('needGroupPick'))
            return $('tab-group-pick-dialog');
        if (body.classList.contains('needVersion'))
            return $('version-dialog');
        if (body.classList.contains('needCopyMove'))
            return $('copy-move-dialog');
        if (body.classList.contains('needFolderPick'))
            return $('bookmark-folder-pick-dialog');
        if (body.classList.contains('needStagingShortcut'))
            return $('staging-shortcut-dialog');
        if (body.classList.contains('needStagingGroupAssign'))
            return $('staging-group-assign-dialog');
        if (body.classList.contains('needAlert'))
            return $('alert-dialog');
        return null;
    };

    // K15: every dialog hands keyboard focus back to the element it was
    // opened from. Without this a close (button, submit, cover click or the
    // Esc layer's closeDialogs) drops focus to <body> once the dialog hides
    // — the list containers' keydown handlers never see the arrow keys until
    // a click or Tab. A disconnected invoker (a row a re-render swapped out)
    // falls back to the visible view's anchor: its .focus row, first row,
    // else the list container itself (dialogs has no view-manager handle —
    // this is the DOM-level twin of view-manager's focusDefault; the list
    // containers are the sections' div[tabindex] children).
    let invoker = null;
    const rememberInvoker = () => {
        // A dialog opened over another dialog keeps the ORIGINAL invoker —
        // the chained dialog's own control is nowhere to return to.
        if (anyOpen())
            return;
        const ae = document.activeElement;
        invoker = (ae && ae !== body && typeof ae.focus === 'function') ? ae : null;
    };
    const restoreFocus = wasOpen => {
        if (!wasOpen)
            return; // a close without its dialog open must never steal focus
        // A close handler may have opened a follow-up dialog (edit → alert):
        // it owns the modal layer — keep the invoker for ITS close.
        if (anyOpen())
            return;
        const t = invoker;
        invoker = null;
        if (t && t.isConnected !== false) { // doubles count as connected (tests)
            t.focus();
            return;
        }
        if (!document.querySelectorAll)
            return;
        const sections = document.querySelectorAll('#views > section');
        let list = null;
        for (let i = 0, l = sections.length; i < l; i++) {
            if (!sections[i].hidden && sections[i].querySelector) {
                list = sections[i].querySelector('div[tabindex]');
                break;
            }
        }
        if (!list || !list.querySelector)
            return;
        const anchor = list.querySelector('.focus')
            || list.querySelector('li a, li span, li[tabindex]') || list;
        if (anchor && typeof anchor.focus === 'function')
            anchor.focus();
    };

    // Escape / cover-click close-all; confirm dialogs resolve with fn2 (cancel)
    const closeDialogs = () => {
        if (body.classList.contains('needConfirm'))
            ConfirmDialog.fn2();
        ConfirmDialog.close();
        if (body.classList.contains('needEdit'))
            EditDialog.close(false);
        if (body.classList.contains('needInputName'))
            NewFolderDialog.close(false);
        if (body.classList.contains('needSort'))
            SortDialog.close();
        if (body.classList.contains('needTabGroup'))
            GroupDialog.close(false);
        if (body.classList.contains('needGroupPick'))
            GroupPickDialog.close();
        if (body.classList.contains('needVersion'))
            VersionDialog.close();
        if (body.classList.contains('needCopyMove'))
            CopyMoveDialog.close(false);
        if (body.classList.contains('needFolderPick'))
            BookmarkFolderPickDialog.close();
        if (body.classList.contains('needStagingShortcut'))
            StagingShortcutDialog.close();
        if (body.classList.contains('needStagingGroupAssign'))
            StagingGroupAssignDialog.close();
        if (body.classList.contains('needAlert'))
            AlertDialog.close();
    };
    $('cover').addEventListener('click', closeDialogs);

    return { AlertDialog, ConfirmDialog, EditDialog, NewFolderDialog, SortDialog, GroupDialog, GroupPickDialog, VersionDialog, CopyMoveDialog, BookmarkFolderPickDialog, StagingGroupAssignDialog, StagingShortcutDialog, anyOpen, activeEl, closeDialogs };
}
