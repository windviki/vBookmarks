/**
 * Options-page management UI for palette custom commands
 * (docs/palette-commands-design.md §6, v4 task-4 #6): the "Command palette"
 * group of pages/options.html — the command list with a usage meter, the
 * add/edit form with its per-action parameter rows, and the URL-hash
 * handover the palette uses:
 *   pages/options.html#palette-cmd={"slash":"work","name":"…"} → new, prefilled
 *   pages/options.html#palette-cmd={"edit":"cc_…"}             → edit that entry
 *
 * ES module loaded after /src/store.js (a classic script), so window.store
 * is available at evaluation time; reads/writes go through the sync mirror
 * (paletteCustomCommands ∈ SYNC_KEYS — store.js debounces the sync write).
 * All validation lives in src/palette-commands.js; this file is DOM + i18n.
 */

import {
    MAX_CUSTOM_COMMANDS, ACTION_TYPES, WHERES_URL, WHERES_GROUP, PRESET_VIEWS,
    validateCommand, loadCustomCommands, saveCustomCommands, summarizeAction, slashNamesOf
} from './palette-commands.js';

const $ = id => document.getElementById(id);
const _m = chrome.i18n.getMessage;

// The dupes view's strategy/scope value lists (its selects own the labels —
// the same i18n keys, resolved here for the preset form).
const DUPES_STRATEGIES = [
    ['keep-oldest', 'dupesStrategyOldest'],
    ['keep-newest', 'dupesStrategyNewest'],
    ['keep-bookmark-bar', 'dupesStrategyBookmarkBar'],
    ['keep-shortest-title', 'dupesStrategyShortestTitle'],
    ['keep-shallowest', 'dupesStrategyShallowest'],
    ['keep-most-visited', 'dupesStrategyMostVisited']
];
const DUPES_SCOPES = [['all', 'dupesScopeAll'], ['bar', 'dupesScopeBar']];
const WHERE_KEYS = {
    current: 'paletteWhereCurrent', tab: 'paletteWhereTab',
    window: 'paletteWhereWindow', background: 'paletteWhereBackground'
};
const ACTION_KEYS = {
    'open-url': 'paletteActionOpenUrl',
    'open-url-group': 'paletteActionOpenUrlGroup',
    'view-preset': 'paletteActionViewPreset',
    'url-template': 'paletteActionUrlTemplate'
};
const VIEW_KEYS = { dupes: 'viewDupes', dead: 'viewDead' };

let editingId = null;   // null = the form is adding a new command
let list = [];          // the working copy of the stored array

const fillSelect = (sel, pairs) => {
    sel.innerHTML = '';
    for (const [value, label] of pairs) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        sel.appendChild(opt);
    }
};

// The folder dropdown: every folder of the bookmark tree, indented by
// depth (the synthetic root excluded). Built once per form open so a
// deleted folder never lingers in an open form.
const fillFolders = () =>
    new Promise(resolve => {
        chrome.bookmarks.getTree(tree => {
            const pairs = [];
            const walk = (nodes, depth) => {
                for (const node of nodes || []) {
                    if (!node.children)
                        continue;
                    if (node.id !== '0')
                        pairs.push([node.id, `${'— '.repeat(Math.max(0, depth - 1))}${node.title || ''}`]);
                    walk(node.children, depth + 1);
                }
            };
            walk(tree, 0);
            fillSelect($('pc-folder'), pairs.length ? pairs : [['', _m('paletteCustomErrFolder')]]);
            resolve();
        });
    });

// Show only the parameter rows of the active action type; the view-preset
// sub-rows further split by the chosen view (dupes: strategy+scope, dead:
// the scan checkbox).
const syncParamRows = () => {
    const type = $('pc-action').value;
    const view = $('pc-view').value;
    for (const li of document.querySelectorAll('#palette-cmd-form .pc-for')) {
        let on = (li.dataset.types || '').split(' ').indexOf(type) !== -1;
        if (on && li.classList.contains('pc-for-dupes'))
            on = view === 'dupes';
        if (on && li.classList.contains('pc-for-dead'))
            on = view === 'dead';
        li.hidden = !on;
    }
};

const openForm = (prefill = {}) => {
    editingId = prefill.id || null;
    $('pc-name').value = prefill.name || '';
    $('pc-slash').value = prefill.slash || '';
    $('pc-aliases').value = (prefill.aliases || []).join(', ');
    fillSelect($('pc-action'), ACTION_TYPES.map(t => [t, _m(ACTION_KEYS[t])]));
    fillSelect($('pc-view'), PRESET_VIEWS.map(v => [v, _m(VIEW_KEYS[v])]));
    fillSelect($('pc-strategy'), DUPES_STRATEGIES.map(([v, k]) => [v, _m(k)]));
    fillSelect($('pc-scope'), DUPES_SCOPES.map(([v, k]) => [v, _m(k)]));
    const a = prefill.action || { type: 'open-url' };
    $('pc-action').value = ACTION_TYPES.indexOf(a.type) !== -1 ? a.type : 'open-url';
    fillSelect($('pc-where'),
        (a.type === 'open-url-group' ? WHERES_GROUP : WHERES_URL).map(w => [w, _m(WHERE_KEYS[w])]));
    $('pc-url').value = a.url || '';
    $('pc-template').value = a.template || '';
    $('pc-where').value = a.where || (a.type === 'open-url-group' ? 'background' : 'tab');
    $('pc-view').value = PRESET_VIEWS.indexOf(a.view) !== -1 ? a.view : 'dupes';
    $('pc-strategy').value = a.strategy || 'keep-newest';
    $('pc-scope').value = a.scope || 'all';
    $('pc-scan').checked = !!a.scan;
    $('pc-error').textContent = '';
    fillFolders().then(() => {
        if (a.folderId)
            $('pc-folder').value = a.folderId;
    });
    syncParamRows();
    $('palette-cmd-form').hidden = false;
    $('pc-name').focus();
};

const closeForm = () => {
    $('palette-cmd-form').hidden = true;
    editingId = null;
};

const readDraft = () => {
    const type = $('pc-action').value;
    const action = { type };
    if (type === 'open-url') {
        action.url = $('pc-url').value;
        action.where = $('pc-where').value;
    } else if (type === 'url-template') {
        action.template = $('pc-template').value;
        action.where = $('pc-where').value;
    } else if (type === 'open-url-group') {
        action.folderId = $('pc-folder').value;
        action.where = $('pc-where').value;
    } else if (type === 'view-preset') {
        action.view = $('pc-view').value;
        if (action.view === 'dupes') {
            action.strategy = $('pc-strategy').value;
            action.scope = $('pc-scope').value;
        } else if (action.view === 'dead') {
            action.scan = $('pc-scan').checked;
        }
    }
    const prior = editingId ? list.find(c => c.id === editingId) : null;
    return {
        id: editingId || undefined,
        createdAt: prior ? prior.createdAt : undefined,
        useCount: prior ? prior.useCount : 0,
        lastUsedAt: prior ? prior.lastUsedAt : 0,
        name: $('pc-name').value,
        slash: $('pc-slash').value,
        aliases: $('pc-aliases').value.split(','),
        action
    };
};

const renderList = () => {
    $('palette-cmd-usage').textContent = _m('paletteCustomUsage', [`${list.length}`, `${MAX_CUSTOM_COMMANDS}`]);
    const $listEl = $('palette-cmd-list');
    $listEl.innerHTML = '';
    if (!list.length) {
        const li = document.createElement('li');
        const small = document.createElement('small');
        small.textContent = _m('paletteCustomEmpty');
        li.appendChild(small);
        $listEl.appendChild(li);
        return;
    }
    for (const cmd of list) {
        const li = document.createElement('li');
        const head = document.createElement('div');
        head.className = 'pc-cmd-head'; // flex row: text left, actions right
        const slash = document.createElement('code');
        slash.textContent = slashNamesOf(cmd).map(s => `/${s}`).join(' ');
        head.appendChild(slash);
        head.appendChild(document.createTextNode(` ${cmd.name} `));
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.textContent = _m('edit');
        editBtn.addEventListener('click', () => openForm(cmd));
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.textContent = _m('delete');
        delBtn.addEventListener('click', () => {
            if (!confirm(_m('paletteCustomDeleteConfirm', cmd.name)))
                return;
            list = list.filter(c => c.id !== cmd.id);
            saveCustomCommands(store, list);
            renderList();
        });
        head.appendChild(editBtn);
        head.appendChild(delBtn);
        li.appendChild(head);
        const summary = document.createElement('small');
        const uses = cmd.useCount ? ` · ×${cmd.useCount}` : '';
        summary.textContent = summarizeAction(cmd, _m) + uses;
        li.appendChild(summary);
        $listEl.appendChild(li);
    }
};

const init = async () => {
    await store.ready; // the sync mirror is hydrated at this point
    // Labels (options.js owns the other groups' labels)
    $('palette-cmd-options').innerText = _m('optionsGroupPalette');
    $('palette-cmd-hint').innerText = _m('paletteCustomHint');
    $('palette-cmd-add').innerText = _m('paletteCustomAdd');
    $('pc-name-label').innerText = _m('name');
    $('pc-slash-label').innerText = _m('paletteCustomSlash');
    $('pc-aliases-label').innerText = _m('paletteCustomAliases');
    $('pc-action-label').innerText = _m('paletteCustomAction');
    $('pc-url-label').innerText = _m('paletteCustomUrl');
    $('pc-template-label').innerText = _m('paletteCustomTemplate');
    $('pc-where-label').innerText = _m('paletteCustomWhere');
    $('pc-folder-label').innerText = _m('paletteCustomFolder');
    $('pc-view-label').innerText = _m('paletteCustomView');
    $('pc-strategy-label').innerText = _m('paletteCustomStrategy');
    $('pc-scope-label').innerText = _m('paletteCustomScope');
    $('pc-scan-label').innerText = _m('paletteCustomScan');
    $('pc-save').innerText = _m('paletteCustomSave');
    $('pc-cancel').innerText = _m('nope');

    list = loadCustomCommands(store);
    renderList();

    $('palette-cmd-add').addEventListener('click', () => {
        if (list.length >= MAX_CUSTOM_COMMANDS) {
            alert(_m('paletteCustomErrLimit'));
            return;
        }
        openForm();
    });
    $('pc-cancel').addEventListener('click', closeForm);
    $('pc-action').addEventListener('change', () => {
        // the where-list is action-specific (groups never open "current")
        const type = $('pc-action').value;
        const keep = $('pc-where').value;
        fillSelect($('pc-where'),
            (type === 'open-url-group' ? WHERES_GROUP : WHERES_URL).map(w => [w, _m(WHERE_KEYS[w])]));
        $('pc-where').value = keep;
        if ($('pc-where').value !== keep) // value dropped out of the new list
            $('pc-where').value = type === 'open-url-group' ? 'background' : 'tab';
        syncParamRows();
    });
    $('pc-view').addEventListener('change', syncParamRows);
    $('palette-cmd-form').addEventListener('submit', e => {
        e.preventDefault();
        const result = validateCommand(readDraft(), list, editingId);
        if (!result.ok) {
            $('pc-error').textContent = _m(result.error);
            return;
        }
        if (editingId)
            list = list.map(c => (c.id === editingId ? result.command : c));
        else
            list = list.concat(result.command);
        saveCustomCommands(store, list);
        renderList();
        closeForm();
    });

    // The palette's handover hash: create-prefill or edit-by-id.
    const m = location.hash.match(/^#palette-cmd=(.+)$/);
    if (m) {
        let prefill = null;
        try {
            prefill = JSON.parse(decodeURIComponent(m[1]));
        } catch (e) { /* a hand-edited hash just falls through */ }
        if (prefill) {
            if (prefill.edit) {
                const cmd = list.find(c => c.id === prefill.edit);
                if (cmd)
                    openForm(cmd);
            } else {
                if (list.length < MAX_CUSTOM_COMMANDS)
                    openForm({ slash: prefill.slash || '', name: prefill.name || '' });
            }
        }
        history.replaceState(null, '', location.pathname + location.search);
    }
};

if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
else
    init();
