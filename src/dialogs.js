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
import { pickGroupColor } from './tab-group-utils.js';
import { htmlspecialchars } from './escape.js';

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
                closeBtn.innerHTML = `${htmlspecialchars(_m('paletteClose'))} <kbd>Esc</kbd>`;
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
            try {
                if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
                    await navigator.clipboard.writeText(text);
                } else if (typeof document !== 'undefined' && document.body) {
                    const ta = document.createElement('textarea');
                    ta.value = text;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    ta.remove();
                }
                if (btn) {
                    btn.textContent = _m('versionDialogCopied');
                    setTimeout(() => {
                        if (btn && body.classList.contains('needVersion'))
                            btn.textContent = _m('versionDialogCopy');
                    }, 1500);
                }
            } catch (e) { /* keep the current label */ }
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
        body.classList.contains('needGroupPick') || body.classList.contains('needVersion');

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
        if (body.classList.contains('needAlert'))
            AlertDialog.close();
    };
    $('cover').addEventListener('click', closeDialogs);

    return { AlertDialog, ConfirmDialog, EditDialog, NewFolderDialog, SortDialog, GroupDialog, GroupPickDialog, VersionDialog, anyOpen, activeEl, closeDialogs };
}
