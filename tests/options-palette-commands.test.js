import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { makeEl, makeStoreDouble } from './helpers/dom.js';
import { bootWithStubs } from './helpers/boot.js';

// options-palette-commands.js is the options page's custom-command manager
// (v4 task-4 #6). It is an ES module loaded after store.js; at import it runs
// init() (per document.readyState) against page globals (document/chrome/
// store/location/history/confirm/alert). The real module imports cleanly in
// node once those are stubbed — same pattern as dialogs.test.js. Module-level
// `list`/`editingId` state is reset per test via bootWithStubs() (which wraps
// vi.resetModules() + the location-global trap + one import + a flush).

const MAX_CUSTOM_COMMANDS = 100;

// ---- DOM stub ---------------------------------------------------------------

let els;           // id → element stub
let pcForRows;     // the .pc-for parameter rows (dataset.types / pc-for-* classes)
let doc;           // globalThis.document

const IDS = [
    'palette-cmd-options', 'palette-cmd-hint', 'palette-cmd-add',
    'palette-cmd-usage', 'palette-cmd-list', 'palette-cmd-form',
    'pc-name', 'pc-slash', 'pc-aliases', 'pc-action', 'pc-url', 'pc-template',
    'pc-where', 'pc-folder', 'pc-view', 'pc-strategy', 'pc-scope', 'pc-scan',
    'pc-error', 'pc-save', 'pc-cancel',
    'pc-name-label', 'pc-slash-label', 'pc-aliases-label', 'pc-action-label',
    'pc-url-label', 'pc-template-label', 'pc-where-label', 'pc-folder-label',
    'pc-view-label', 'pc-strategy-label', 'pc-scope-label', 'pc-scan-label'
];

// ---- chrome / store / location doubles ---------------------------------------

let store;
let location;
let historyDouble;
let alerts;
let confirms;
let confirmResult;

// The bookmark tree fillFolders walks (synthetic root excluded).
const FOLDER_TREE = [
    { id: '0', title: '', children: [
        { id: '1', title: 'Bookmarks bar', children: [
            { id: '11', title: 'Work', children: [
                { id: '111', title: 'Work sub', children: [] }
            ]}
        ]}
    ]}
];

beforeEach(async () => {
    els = Object.fromEntries(IDS.map(id => [id, makeEl(id)]));
    const row = (types, cls = '') => {
        const r = makeEl('', 'LI');
        r.dataset.types = types;
        r.classList.add('pc-for');
        if (cls) r.classList.add(cls);
        return r;
    };
    pcForRows = [
        row('open-url url-template'),
        row('open-url-group'),
        row('view-preset'),
        row('view-preset', 'pc-for-dupes'),
        row('view-preset', 'pc-for-dead')
    ];
    // the form starts hidden in options.html (the `hidden` attribute) —
    // openForm() reveals it, closeForm() hides it again
    els['palette-cmd-form'].hidden = true;
    doc = {
        readyState: 'complete',
        _listeners: {},
        getElementById: id => els[id] || null,
        createElement: tag => makeEl('', tag),
        createTextNode: text => ({ textContent: text, nodeType: 3 }),
        querySelectorAll: sel => (sel === '#palette-cmd-form .pc-for' ? pcForRows : []),
        addEventListener(type, fn) {
            (this._listeners[type] = this._listeners[type] || []).push(fn);
        }
    };
    store = makeStoreDouble();
    location = { hash: '', pathname: '/pages/options.html', search: '' };
    historyDouble = { replaceState: vi.fn() };
    alerts = [];
    confirms = [];
    confirmResult = true;

    globalThis.document = doc;
    globalThis.chrome = {
        i18n: { getMessage: key => key },
        bookmarks: { getTree: cb => cb(FOLDER_TREE) }
    };
    globalThis.history = historyDouble;
    globalThis.confirm = msg => { confirms.push(msg); return confirmResult; };
    globalThis.alert = msg => alerts.push(msg);
    // globalThis.location is re-applied by bootWithStubs (resetModules wipes it)
});

// boot() imports the real module exactly once per test against the doubles via
// bootWithStubs — which also re-applies the `location` global (resetModules
// wipes it) and flushes init()'s microtask chain. Importing a second time in
// one test would double-register the init() listeners on the shared DOM stubs.
const boot = async ({ seed = [], hash = '' } = {}) => {
    await bootWithStubs({
        modulePath: '../../src/options-palette-commands.js', // relative to tests/helpers/boot.js
        locationImpl: location,
        hash,
        setupGlobals: () => {
            store = makeStoreDouble(seed.length ? { paletteCustomCommands: JSON.stringify(seed) } : {});
            globalThis.store = store;
        }
    });
};

afterEach(() => {
    delete globalThis.document;
    delete globalThis.chrome;
    delete globalThis.store;
    delete globalThis.location;
    delete globalThis.history;
    delete globalThis.confirm;
    delete globalThis.alert;
});

// ---- helpers ----------------------------------------------------------------

const fillNewCommand = ({ slash = 'work', name = 'Work', type = 'open-url',
    url = 'https://work.example/', where = 'tab' } = {}) => {
    els['pc-slash'].value = slash;
    els['pc-name'].value = name;
    els['pc-action'].value = type;
    els['pc-url'].value = url;
    els['pc-where'].value = where;
    els['palette-cmd-form'].fire('submit', { preventDefault() {} });
};

const storedCommands = () => {
    const raw = store.getSyncSetting('paletteCustomCommands', '');
    return raw ? JSON.parse(raw) : [];
};

const cmdListItems = () => els['palette-cmd-list'].children;

// ---- tests ------------------------------------------------------------------

describe('options page palette-command manager', () => {
    it('assigns the group labels and shows an empty state on first render', async () => {
        await boot();
        expect(els['palette-cmd-options'].textContent).toBe('optionsGroupPalette');
        expect(els['palette-cmd-hint'].textContent).toBe('paletteCustomHint');
        expect(els['palette-cmd-add'].textContent).toBe('paletteCustomAdd');
        expect(els['pc-save'].textContent).toBe('paletteCustomSave');
        expect(els['palette-cmd-usage'].textContent).toContain('paletteCustomUsage');
        // empty list → the empty-state <li>
        expect(els['palette-cmd-list'].children).toHaveLength(1);
        expect(els['palette-cmd-list'].children[0].children[0].textContent)
            .toBe('paletteCustomEmpty');
    });

    it('add button opens the (initially hidden) form', async () => {
        await boot();
        expect(els['palette-cmd-form'].hidden).toBe(true);
        els['palette-cmd-add'].fire('click');
        expect(els['palette-cmd-form'].hidden).toBe(false);
        expect(els['pc-name'].focused).toBe(true);
        // default action type prefills the where-list for open-url
        expect(els['pc-where'].value).toBe('tab');
    });

    it('a valid submit persists to the sync area and re-renders the list', async () => {
        await boot();
        els['palette-cmd-add'].fire('click');
        fillNewCommand({ slash: 'work', name: 'Work', url: 'https://work.example/', where: 'tab' });
        const stored = storedCommands();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toEqual(expect.objectContaining({
            slash: 'work', name: 'Work',
            action: { type: 'open-url', url: 'https://work.example/', where: 'tab' }
        }));
        // form closed, list rendered with slash + name + edit/delete buttons
        expect(els['palette-cmd-form'].hidden).toBe(true);
        expect(cmdListItems()).toHaveLength(1);
        const head = cmdListItems()[0].children[0];
        expect(head.children[0].textContent).toContain('/work');
        // flex head (2026-08-26 audit): class carries the layout, and the row
        // is exactly head + summary — the old trailing <br> painted a blank
        // 28px line box between command rows
        expect(head.className).toBe('pc-cmd-head');
        expect(cmdListItems()[0].children).toHaveLength(2);
        expect(cmdListItems()[0].children[1].tagName).toBe('SMALL');
        // the usage meter is populated (its exact count is not observable with
        // a key-echoing _m double — the list length above pins the count)
        expect(els['palette-cmd-usage'].textContent).toBe('paletteCustomUsage');
    });

    it('an invalid submit surfaces the validation error and saves nothing', async () => {
        await boot();
        els['palette-cmd-add'].fire('click');
        // slash must be a valid [a-z0-9-] identifier; 'work!' is not
        fillNewCommand({ slash: 'work!', name: 'Work', url: 'https://work.example/' });
        expect(els['pc-error'].textContent).toBe('paletteCustomErrSlash');
        expect(storedCommands()).toHaveLength(0);
        // form stays open for correction
        expect(els['palette-cmd-form'].hidden).toBe(false);
    });

    it('open-url-group validates a folderId and lists group where options', async () => {
        await boot();
        els['palette-cmd-add'].fire('click');
        els['pc-action'].value = 'open-url-group';
        // switch the action → the where-list drops "current" (groups can't
        // open in-place), keeping the previous value when still valid
        els['pc-action'].fire('change');
        expect(els['pc-where'].value).toBe('tab');
        fillNewCommand({ type: 'open-url-group', slash: 'grp', name: 'Grp', url: '' });
        // no folder picked → paletteCustomErrFolder
        expect(els['pc-error'].textContent).toBe('paletteCustomErrFolder');
        expect(storedCommands()).toHaveLength(0);
        // pick a folder from the tree and resubmit → saved with folderId
        els['pc-folder'].value = '11';
        els['palette-cmd-form'].fire('submit', { preventDefault() {} });
        expect(storedCommands()[0].action).toEqual(
            expect.objectContaining({ type: 'open-url-group', folderId: '11', where: 'tab' })
        );
    });

    it('view-preset splits the param rows by the chosen view (dupes vs dead)', async () => {
        await boot();
        els['palette-cmd-add'].fire('click');
        els['pc-action'].value = 'view-preset';
        els['pc-action'].fire('change');
        // pc-for view-preset rows visible; the dupes row only when view=dupes
        const dupesRow = pcForRows.find(r => r.classList.contains('pc-for-dupes'));
        const deadRow = pcForRows.find(r => r.classList.contains('pc-for-dead'));
        expect(dupesRow.hidden).toBe(false); // default view is dupes
        expect(deadRow.hidden).toBe(true);
        els['pc-view'].value = 'dead';
        els['pc-view'].fire('change');
        expect(dupesRow.hidden).toBe(true);
        expect(deadRow.hidden).toBe(false);
        // dead preset saves the scan flag
        els['pc-scan'].checked = true;
        els['pc-name'].value = 'Scan';
        els['pc-slash'].value = 'scan';
        els['palette-cmd-form'].fire('submit', { preventDefault() {} });
        expect(storedCommands()[0].action).toEqual(
            expect.objectContaining({ type: 'view-preset', view: 'dead', scan: true })
        );
    });

    it('fillFolders populates the folder dropdown from the bookmark tree', async () => {
        await boot();
        els['palette-cmd-add'].fire('click');
        // the dropdown receives one option per folder, indented by depth
        const folderOptions = els['pc-folder'].children;
        const titles = folderOptions.map(o => o.textContent);
        expect(titles).toContain('Bookmarks bar');
        expect(titles).toContain('— Work');
        expect(titles).toContain('— — Work sub');
    });

    it('edit mode prefills the form from an existing command and saves over it', async () => {
        const seed = [{
            id: 'cc_1', name: 'Old', slash: 'old', aliases: [], useCount: 3,
            createdAt: 1, lastUsedAt: 2,
            action: { type: 'open-url', url: 'https://old.example/', where: 'tab' }
        }];
        await boot({ seed }); // init renders the existing list
        expect(cmdListItems()).toHaveLength(1);

        // the list row carries Edit + Delete buttons
        const rowHead = cmdListItems()[0].children[0];
        const editBtn = rowHead.children.find(c => c.textContent === 'edit');
        const delBtn = rowHead.children.find(c => c.textContent === 'delete');
        expect(editBtn).toBeTruthy();
        expect(delBtn).toBeTruthy();

        editBtn.fire('click');
        // edit prefill: name/slash/url from the stored command, form open
        expect(els['palette-cmd-form'].hidden).toBe(false);
        expect(els['pc-name'].value).toBe('Old');
        expect(els['pc-url'].value).toBe('https://old.example/');
        // the edit keeps the id and useCount (readDraft carries them over)
        els['pc-name'].value = 'Renamed';
        els['palette-cmd-form'].fire('submit', { preventDefault() {} });
        const stored = storedCommands();
        expect(stored).toHaveLength(1); // replaced, not appended
        expect(stored[0]).toEqual(expect.objectContaining({ id: 'cc_1', name: 'Renamed', useCount: 3 }));
    });

    it('delete removes the command after a confirm, and a cancelled confirm keeps it', async () => {
        const seed = [{
            id: 'cc_9', name: 'Doomed', slash: 'doom', aliases: [], useCount: 0,
            createdAt: 1, lastUsedAt: 0,
            action: { type: 'open-url', url: 'https://doom.example/', where: 'tab' }
        }];
        await boot({ seed });

        const head = () => cmdListItems()[0].children[0];
        const delBtn = () => head().children.find(c => c.textContent === 'delete');

        confirmResult = false; // user declines
        delBtn().fire('click');
        // the _m double echoes the raw key (no $1 substitution), so only the
        // message key is observable here
        expect(confirms).toEqual(['paletteCustomDeleteConfirm']);
        expect(storedCommands()).toHaveLength(1); // untouched

        confirmResult = true;
        delBtn().fire('click');
        expect(storedCommands()).toHaveLength(0);
        expect(cmdListItems()[0].children[0].textContent).toBe('paletteCustomEmpty');
    });

    it('the palette hash hands a new command over with the slash prefilled', async () => {
        await boot({ hash: '#palette-cmd={"slash":"work","name":"Worklink"}' });
        expect(els['palette-cmd-form'].hidden).toBe(false);
        expect(els['pc-slash'].value).toBe('work');
        expect(els['pc-name'].value).toBe('Worklink');
        // the hash is consumed so a reload does not re-open the form
        expect(historyDouble.replaceState).toHaveBeenCalledWith(null, '', '/pages/options.html');
    });

    it('the palette hash opens the editor on an existing id', async () => {
        const seed = [{
            id: 'cc_5', name: 'Editable', slash: 'ed', aliases: [], useCount: 0,
            createdAt: 1, lastUsedAt: 0,
            action: { type: 'url-template', template: 'https://q.example/?q=%s', where: 'tab' }
        }];
        await boot({ seed, hash: '#palette-cmd={"edit":"cc_5"}' });
        expect(els['palette-cmd-form'].hidden).toBe(false);
        expect(els['pc-slash'].value).toBe('ed');
        expect(els['pc-template'].value).toBe('https://q.example/?q=%s');
    });

    it('a malformed handover hash falls through silently (no crash, form closed)', async () => {
        await boot({ hash: '#palette-cmd={not json' });
        expect(els['palette-cmd-form'].hidden).toBe(true);
    });

    it('refuses to open the form at the MAX_CUSTOM_COMMANDS cap', async () => {
        const seed = Array.from({ length: MAX_CUSTOM_COMMANDS }, (_, i) => ({
            id: `cc_${i}`, name: `C${i}`, slash: `c${i}`, aliases: [], useCount: 0,
            createdAt: 1, lastUsedAt: 0,
            action: { type: 'open-url', url: `https://c${i}.example/`, where: 'tab' }
        }));
        await boot({ seed });

        els['palette-cmd-add'].fire('click');
        expect(alerts).toEqual(['paletteCustomErrLimit']);
        expect(els['palette-cmd-form'].hidden).toBe(true); // never opened
    });

    it('renders the per-command summary line with the usage count', async () => {
        const seed = [{
            id: 'cc_1', name: 'Google', slash: 'g', aliases: [], useCount: 5,
            createdAt: 1, lastUsedAt: 0,
            action: { type: 'open-url', url: 'https://google.com/', where: 'tab' }
        }];
        await boot({ seed });
        // summarizeAction resolves the open-url description + the ×count
        // (the <li> is head div → summary <small>; the old trailing <br>
        // went away with the flex head — it painted a blank 28px line box
        // between command rows)
        const summary = cmdListItems()[0].children[1];
        expect(summary.textContent).toContain('paletteActionOpenUrl');
        expect(summary.textContent).toContain('×5');
    });
});
