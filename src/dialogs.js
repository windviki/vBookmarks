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

// Replaces neatools' String.prototype.widont with a pure function: keeps the
// last two words of a dialog message on one line.
export const widont = str => `${str}`.replace(/\s([^\s]+)$/i, '&nbsp;$1');

export function initDialogs(ctx = {}) {
    const $ = id => document.getElementById(id);
    const body = document.body;
    const _m = chrome.i18n.getMessage;
    const onSort = ctx.onSort || (() => {});

    const AlertDialog = {
        open: dialog => {
            if (!dialog)
                return;
            $('alert-dialog-text').innerHTML = dialog;
            body.classList.add('needAlert');
        },
        close: () => {
            body.classList.remove('needAlert');
        }
    };
    window.addEventListener('error', () => {
        AlertDialog.open(`<strong>${_m('errorOccured')}</strong><br>${_m('reportedToDeveloper')}`);
    }, false);

    const ConfirmDialog = {
        open: opts => {
            if (!opts)
                return;
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
            body.classList.remove('needConfirm');
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
            if (needSave === false) {
                body.classList.remove('needEdit');
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
        },
        fn: () => {
        }
    };

    const NewFolderDialog = {
        open: (optName, optCall) => {
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
            body.classList.remove('needInputName');
            if (needSave !== false) {
                NewFolderDialog.fn($('new-folder-dialog-name').value);
            }
        },
        fn: () => {
        }
    };

    // Phase 3 (issue #33): sort a folder's children by title or date added.
    const SortDialog = {
        open: folderId => {
            SortDialog.folderId = folderId;
            // reset to the defaults every time
            $('sort-by-title').checked = true;
            $('sort-folders-first').checked = true;
            $('sort-recursive').checked = false;
            $('sort-recursive-warning').hidden = true;
            body.classList.add('needSort');
            $('sort-dialog-ok-button').focus();
        },
        close: () => {
            body.classList.remove('needSort');
            SortDialog.folderId = null;
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
        SortDialog.close();
        if (!folderId)
            return;
        onSort(folderId, {
            by: $('sort-by-date').checked ? 'dateAdded' : 'title',
            foldersFirst: $('sort-folders-first').checked,
            recursive: $('sort-recursive').checked
        });
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

    // True while any dialog's body class is set (used by the Escape handler)
    const anyOpen = () => body.classList.contains('needConfirm') || body.classList.contains('needEdit') ||
        body.classList.contains('needAlert') || body.classList.contains('needInputName') ||
        body.classList.contains('needSort');

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
        if (body.classList.contains('needAlert'))
            return $('alert-dialog');
        return null;
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
        if (body.classList.contains('needAlert'))
            AlertDialog.close();
    };
    $('cover').addEventListener('click', closeDialogs);

    return { AlertDialog, ConfirmDialog, EditDialog, NewFolderDialog, SortDialog, anyOpen, activeEl, closeDialogs };
}
