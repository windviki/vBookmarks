/**
 * Palette custom commands (docs/palette-commands-design.md, v4 task-4 #6).
 *
 * The command palette's dispatch and parameter channel already existed —
 * this module is the data-driven 14th+ command: a user-defined entry of
 * `paletteCustomCommands` (chrome.storage.sync via store.getSyncSetting)
 * becomes a palette row whose execution opens a URL, opens a bookmark
 * folder as a URL group, jumps to a view with a preset, or fills a %s URL
 * template with the slash rest words.
 *
 * Everything here is chrome-free pure logic plus a thin store/executor
 * layer, so the unit tests drive it with plain doubles:
 *   PALETTE_RESERVED      — every built-in slash name + alias (v4 task-4
 *                           #5's cleanup list); custom commands may not
 *                           collide with these or with each other.
 *   validateCommand()     — create/edit gate: shape, slash format,
 *                           collisions, per-action payload rules.
 *   loadCustomCommands()  — parse + defensive filter of the stored array.
 *   saveCustomCommands()  — persist (100-entry cap, sync quota).
 *   matchCustom()/sortCustoms() — slash-word prefix match + useCount order.
 *   executeCustom()       — the runtime dispatch (bump useCount, run the
 *                           action through the injected deps).
 *   summarizeAction()     — one-line action summary for management lists.
 *
 * Action whitelist (design §4 — no arbitrary code, ever):
 *   open-url       { url, where }            https? only
 *   open-url-group { folderId, where }       bookmark folder = the group
 *   view-preset    { view, strategy?, scope?, scan? }   dupes/dead only
 *   url-template   { template, where }       exactly one %s, https? only
 */

import { htmlspecialchars } from './escape.js';

// v4 task-4 #5: every built-in slash name and alias (src/palette.js's
// command table). palette.test.js pins the table and this list in sync.
export const PALETTE_RESERVED = [
    'add', 'star', 'new', 'folder', 'mkdir', 'session', 'save',
    'tree', 'home', 'search', 'find', 'recent', 'latest', 'stats', 'visits',
    'dead', 'broken', 'dupes', 'dedup', 'theme',
    'dark', 'light', 'ink', 'paper', 'tabs', 'version', 'lang', 'options', 'settings', 'secret'
];

export const CUSTOM_COMMANDS_KEY = 'paletteCustomCommands';
export const MAX_CUSTOM_COMMANDS = 100;
export const SLASH_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const URL_RE = /^https?:\/\//i;
export const ACTION_TYPES = ['open-url', 'open-url-group', 'view-preset', 'url-template'];
// open-url-group has no 'current' (a group never replaces the popup's tab).
export const WHERES_URL = ['current', 'tab', 'window', 'background'];
export const WHERES_GROUP = ['tab', 'window', 'background'];
export const PRESET_VIEWS = ['dupes', 'dead'];

export const slashNamesOf = cmd => [cmd.slash].concat(cmd.aliases || []);

// --- Validation ---------------------------------------------------------------
// validateCommand(draft, existing, selfId) → { ok:true, command } — the
// normalized entry (name falls back to the slash, aliases deduped) — or
// { ok:false, error } where error is an i18n key for the form to show.
export const validateCommand = (draft, existing = [], selfId = null) => {
    const slash = ((draft && draft.slash) || '').trim().toLowerCase();
    if (!SLASH_RE.test(slash))
        return { ok: false, error: 'paletteCustomErrSlash' };
    const aliases = [];
    for (const raw of [].concat((draft && draft.aliases) || [])) {
        const a = `${raw}`.trim().toLowerCase();
        if (!a)
            continue;
        if (!SLASH_RE.test(a))
            return { ok: false, error: 'paletteCustomErrAlias' };
        if (a === slash || aliases.indexOf(a) !== -1)
            continue; // duplicates of the slash/each other just drop out
        aliases.push(a);
    }
    // Collisions are case-insensitive across reserved words and every other
    // custom command's slash + aliases (design §5.1).
    const taken = new Set(PALETTE_RESERVED);
    for (const other of existing) {
        if (selfId && other.id === selfId)
            continue;
        for (const s of slashNamesOf(other))
            taken.add(`${s}`.toLowerCase());
    }
    for (const s of [slash].concat(aliases))
        if (taken.has(s))
            return { ok: false, error: 'paletteCustomErrTaken' };

    const action = (draft && draft.action) || {};
    const where = (wheres, dflt) =>
        wheres.indexOf(action.where) !== -1 ? action.where : dflt;
    let norm;
    switch (action.type) {
        case 'open-url': {
            const url = (action.url || '').trim();
            if (!URL_RE.test(url))
                return { ok: false, error: 'paletteCustomErrUrl' };
            norm = { type: 'open-url', url, where: where(WHERES_URL, 'tab') };
            break;
        }
        case 'open-url-group': {
            const folderId = `${action.folderId || ''}`.trim();
            if (!folderId)
                return { ok: false, error: 'paletteCustomErrFolder' };
            // design §10.1: groups default to background opening (a 10+-tab
            // foreground burst hijacks focus)
            norm = { type: 'open-url-group', folderId, where: where(WHERES_GROUP, 'background') };
            break;
        }
        case 'view-preset': {
            if (PRESET_VIEWS.indexOf(action.view) === -1)
                return { ok: false, error: 'paletteCustomErrView' };
            norm = { type: 'view-preset', view: action.view };
            // strategy/scope/scan pass through as optional strings/bools —
            // the target view clamps unknown values on apply (its selects
            // own the value lists).
            if (action.strategy)
                norm.strategy = `${action.strategy}`;
            if (action.scope)
                norm.scope = `${action.scope}`;
            if (action.scan)
                norm.scan = true;
            break;
        }
        case 'url-template': {
            const template = (action.template || '').trim();
            if (!URL_RE.test(template))
                return { ok: false, error: 'paletteCustomErrUrl' };
            const marks = template.split('%s').length - 1;
            if (marks !== 1)
                return { ok: false, error: 'paletteCustomErrTemplate' };
            norm = { type: 'url-template', template, where: where(WHERES_URL, 'tab') };
            break;
        }
        default:
            return { ok: false, error: 'paletteCustomErrAction' };
    }

    return {
        ok: true,
        command: {
            id: (draft && draft.id) || `cc_${Date.now().toString(36)}`,
            name: ((draft && draft.name) || '').trim() || slash,
            slash,
            aliases,
            action: norm,
            createdAt: (draft && draft.createdAt) || Date.now(),
            useCount: (draft && draft.useCount) || 0,
            lastUsedAt: (draft && draft.lastUsedAt) || 0
        }
    };
};

// --- Storage --------------------------------------------------------------------
// Stored as a JSON string in the sync mirror (paletteCustomCommands ∈
// SYNC_KEYS — store.js debounces the chrome.storage.sync write).
export const loadCustomCommands = store => {
    let list = [];
    try {
        list = JSON.parse(store.getSyncSetting(CUSTOM_COMMANDS_KEY, '[]') || '[]');
    } catch (e) {
        list = [];
    }
    // Defensive: a hand-edited/sync-merged blob degrades to the entries
    // that still look like commands. Aliases ride the same blob and reach
    // palette row HTML (row.slash), so each one is validated too — an
    // invalid alias is dropped, not the command.
    return [].concat(list || []).filter(c =>
        c && typeof c === 'object' && SLASH_RE.test(c.slash || '') &&
        c.action && ACTION_TYPES.indexOf(c.action.type) !== -1)
        .map(c => Object.assign({}, c, {
            aliases: [].concat(c.aliases || []).filter(a => SLASH_RE.test(String(a)))
        }));
};

export const saveCustomCommands = (store, list) =>
    store.setSyncSetting(CUSTOM_COMMANDS_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM_COMMANDS)));

// --- Matching + ordering (design §5.2/§7) ----------------------------------------
// Slash mode: the first word prefix-matches slash/aliases, same rule as the
// built-ins. Plain mode: the palette fuzzy-scores the display name itself.
export const matchCustom = (cmd, slashWord) =>
    slashNamesOf(cmd).some(s => s.indexOf(slashWord) === 0);

// Built-ins keep their table order (muscle memory); customs sort among
// themselves by useCount (capped at 50) then recency, then slash.
export const sortCustoms = list =>
    list.slice().sort((a, b) =>
        Math.min(b.useCount || 0, 50) - Math.min(a.useCount || 0, 50) ||
        (b.lastUsedAt || 0) - (a.lastUsedAt || 0) ||
        (a.slash < b.slash ? -1 : a.slash > b.slash ? 1 : 0));

const bumpUsage = (store, id) => {
    const list = loadCustomCommands(store);
    const cmd = list.find(c => c.id === id);
    if (!cmd)
        return;
    cmd.useCount = (cmd.useCount || 0) + 1;
    cmd.lastUsedAt = Date.now();
    saveCustomCommands(store, list);
};

// --- Execution ---------------------------------------------------------------------
// executeCustom(cmd, rest, deps): runs the action. deps:
//   store    — settings mirror (useCount bookkeeping + the broken-folder
//              delete path)
//   actions  — actions.js open* family
//   views    — view-manager (view-preset: activate(id, { preset }))
//   dialogs  — ConfirmDialog for the broken-folder prompt
//   _m       — i18n (the dialog text)
//   onChanged — optional: fired after a delete so the palette reloads
// rest is the slash rest words ('/g kimi code' → 'kimi code').
export const executeCustom = (cmd, rest, deps) => {
    const { store, actions, views, dialogs, _m } = deps;
    bumpUsage(store, cmd.id);
    const a = cmd.action;
    const openOne = (url, where) => {
        if (where === 'current')
            actions.openBookmark(url);
        else if (where === 'window')
            actions.openBookmarkNewWindow(url);
        else if (where === 'background')
            actions.openBookmarkNewTab(url, false);
        else // 'tab'
            actions.openBookmarkNewTab(url, true);
    };
    switch (a.type) {
        case 'open-url':
            openOne(a.url, a.where);
            return;
        case 'url-template': {
            // No rest words: open the template's origin (the declared MVP
            // fallback — a search engine's homepage is the sensible landing).
            let url = a.template;
            if (rest)
                url = a.template.replace('%s', encodeURIComponent(rest));
            else {
                const m = a.template.match(/^https?:\/\/[^/]+/i);
                url = m ? m[0] : a.template.replace('%s', '');
            }
            openOne(url, a.where);
            return;
        }
        case 'open-url-group':
            chrome.bookmarks.getChildren(a.folderId, children => {
                // The folder vanished after the command was created (design
                // §8): offer to delete the dead entry instead of failing
                // silently.
                if (chrome.runtime.lastError || !children) {
                    if (dialogs && dialogs.ConfirmDialog)
                        dialogs.ConfirmDialog.open({
                            dialog: _m('paletteCustomBroken', htmlspecialchars(cmd.name)),
                            button1: `<strong>${_m('delete')}</strong>`,
                            button2: _m('nope'),
                            fn1: () => {
                                saveCustomCommands(store,
                                    loadCustomCommands(store).filter(c => c.id !== cmd.id));
                                if (deps.onChanged)
                                    deps.onChanged();
                            }
                        });
                    return;
                }
                const urls = children.filter(c => c.url).map(c => c.url);
                if (!urls.length)
                    return;
                if (a.where === 'window')
                    actions.openBookmarksNewWindow(urls);
                else
                    actions.openBookmarks(urls, a.where !== 'background');
                return;
            });
            return;
        case 'view-preset': {
            const preset = {};
            if (a.strategy)
                preset.strategy = a.strategy;
            if (a.scope)
                preset.scope = a.scope;
            if (a.scan)
                preset.scan = true;
            views.activate(a.view, { preset });
            return;
        }
    }
};

// --- Management-list summary (options page + palette tooltip) --------------------
// One line describing the action; _m resolves the type label, the payload
// follows verbatim (user data is never translated, design §8).
export const summarizeAction = (cmd, _m) => {
    const a = cmd.action || {};
    switch (a.type) {
        case 'open-url':
            return `${_m('paletteActionOpenUrl')}: ${a.url}`;
        case 'open-url-group':
            return `${_m('paletteActionOpenUrlGroup')} #${a.folderId}`;
        case 'view-preset': {
            const extras = [a.strategy, a.scope, a.scan ? 'scan' : ''].filter(Boolean).join(' · ');
            return `${_m('paletteActionViewPreset')}: ${a.view}${extras ? ` (${extras})` : ''}`;
        }
        case 'url-template':
            return `${_m('paletteActionUrlTemplate')}: ${a.template}`;
        default:
            return '';
    }
};
