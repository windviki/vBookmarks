import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// view-tabgroups.js touches page globals only inside initViewTabGroups and
// its handlers, so the real module imports cleanly once chrome/document are
// stubbed. The double below follows the view-dupes recipe: DOM elements are
// record-only, chrome.tabs/tabGroups callbacks fire synchronously, and every
// assertion goes through the doubles' records plus the list innerHTML.

let initViewTabGroups;
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

beforeAll(async () => {
    ({ initViewTabGroups } = await import('../src/view-tabgroups.js'));
});

afterAll(() => {
    delete globalThis.chrome;
    delete globalThis.document;
});

const makeClassList = initial => {
    const set = new Set(initial || []);
    return {
        add: (...cs) => cs.forEach(c => set.add(c)),
        remove: (...cs) => cs.forEach(c => set.delete(c)),
        contains: c => set.has(c),
        toString: () => [...set].join(' ')
    };
};

const makeEl = id => {
    const el = {
        id,
        tagName: 'DIV',
        _innerHTML: '',
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) {
            this._innerHTML = v;
            if (v === '')
                this.children = [];
        },
        textContent: '',
        value: '',
        checked: false,
        hidden: false,
        disabled: false,
        focused: false,
        scrollLeft: 0,
        style: {},
        className: '',
        dataset: {},
        attributes: {},
        classList: makeClassList(),
        children: [],
        parentNode: null,
        listeners: {},
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return name in this.attributes ? this.attributes[name] : null; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        trigger(type, event = {}) { for (const fn of (this.listeners[type] || [])) fn(event); return event; },
        focus() { this.focused = true; },
        select() {},
        appendChild(child) { this.children.push(child); child.parentNode = this; },
        querySelector(sel) {
            if (sel === 'a, span') {
                const a = this.children.find(c => c.tagName === 'A');
                if (a)
                    return a;
                const span = this.children.find(c => c.tagName === 'SPAN');
                return span || null;
            }
            return this.children.find(c => c.tagName === sel.toUpperCase()) || null;
        },
        querySelectorAll(sel) {
            // The focus-park helpers only need a list; no live DOM rows.
            return [];
        }
    };
    return el;
};

const flush = () => new Promise(resolve => realSetTimeout(resolve, 0));

const makeTab = (id, index, props = {}) => ({
    id,
    index,
    windowId: props.windowId || 1,
    title: props.title || `Tab ${id}`,
    url: props.url || `https://t${id}.example/`,
    active: !!props.active,
    groupId: props.groupId || -1,
    ...props
});

const makeGroup = (id, title, color, props = {}) => ({ id, title, color, windowId: 1, ...props });

const setup = (opts = {}) => {
    const byId = {};
    const ids = ['tabgroups-list', 'view-tabgroups'];
    for (const id of ids) {
        const el = makeEl(id);
        byId[id] = el;
    }
    const doc = {
        getElementById: id => byId[id] || null,
        activeElement: null,
        body: { classList: makeClassList(['rtl']) }
    };
    globalThis.document = doc;

    const chromeStub = {
        i18n: {
            getMessage: (key, subs) => {
                if (subs === undefined)
                    return key;
                const arr = [].concat(subs);
                return `${key}[${arr.join('|')}]`;
            }
        },
        tabs: {
            queryCalls: [],
            updateCalls: [],
            moveCalls: [],
            removeCalls: [],
            discardCalls: [],
            _tabs: opts.tabs || [
                makeTab(1, 0, { active: true }),
                makeTab(2, 1, { groupId: 'g1' }),
                makeTab(3, 2, { groupId: 'g1' }),
                makeTab(4, 3)
            ],
            query(queryInfo, cb) {
                this.queryCalls.push(queryInfo);
                cb(this._tabs.slice());
            },
            update(id, props, cb) {
                this.updateCalls.push([id, props]);
                if (cb)
                    cb({ id, ...props });
            },
            move(id, props, cb) {
                this.moveCalls.push([id, props]);
                if (cb)
                    cb({ id, ...props });
            },
            remove(ids, cb) {
                this.removeCalls.push(ids);
                if (cb)
                    cb();
            },
            discard(id, cb) {
                this.discardCalls.push(id);
                if (cb)
                    cb({ id, discarded: true });
            },
            onCreated: { addListener(fn) { this.fn = fn; } },
            onRemoved: { addListener(fn) { this.fn = fn; } },
            onMoved: { addListener(fn) { this.fn = fn; } },
            onUpdated: { addListener(fn) { this.fn = fn; } },
            onActivated: { addListener(fn) { this.fn = fn; } }
        },
        tabGroups: {
            queryCalls: [],
            updateCalls: [],
            _groups: opts.groups || [
                makeGroup('g1', 'Dev', 'blue')
            ],
            query(queryInfo, cb) {
                this.queryCalls.push(queryInfo);
                if (cb)
                    cb(this._groups.slice());
            },
            update(id, props, cb) {
                this.updateCalls.push([id, props]);
                if (cb)
                    cb({ id, ...props });
            },
            onCreated: { addListener(fn) { this.fn = fn; } },
            onRemoved: { addListener(fn) { this.fn = fn; } },
            onUpdated: { addListener(fn) { this.fn = fn; } },
            onMoved: { addListener(fn) { this.fn = fn; } }
        },
        runtime: {
            sendMessageCalls: [],
            sendMessage(msg) { this.sendMessageCalls.push(msg); }
        },
        bookmarks: {
            searchCalls: [],
            createCalls: [],
            getCalls: [],
            getTreeCalls: 0,
            _existing: opts.existingBookmarks || [],
            getTree(cb) {
                this.getTreeCalls++;
                cb(opts.bookmarkTree || []);
            },
            search(query, cb) {
                this.searchCalls.push(query);
                cb(this._existing.slice());
            },
            create(props, cb) {
                this.createCalls.push(props);
                const node = { id: `bm_${this.createCalls.length}`, ...props };
                if (cb)
                    cb(node);
            },
            get(id, cb) {
                this.getCalls.push(id);
                if (cb)
                    cb([{ id, title: `folder-${id}` }]);
            }
        },
        windows: { WINDOW_ID_CURRENT: 1 }
    };
    globalThis.chrome = chromeStub;

    const store = {
        _data: { ...(opts.storeData || {}) },
        get(key, dflt) {
            return key in this._data ? this._data[key] : dflt;
        },
        set(key, v) {
            this._data[key] = v;
        }
    };

    const views = {
        def: null,
        active: opts.active !== undefined ? opts.active : true,
        register(def) { this.def = def; },
        isActive(id) { return id === 'tabgroups' && this.active; },
        pathOf: opts.pathOf || (() => ''),
        showItemPath: opts.showItemPath || (() => true),
        updateBadgesCalls: 0,
        updateBadges() { this.updateBadgesCalls++; }
    };

    const treeRender = {
        generateBookmarkHTML(title, url, extras, id, positions, meta) {
            const badges = (meta && meta.badge || [])
                .filter(b => b && b.text)
                .map(b => `<span class="row-badge ${b.cls}">${b.text}</span>`).join('');
            return `<a href="${url}" ${extras} class="tree-item-link">${title}${badges}</a>`;
        }
    };

    const dialogs = {
        ConfirmDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        },
        AlertDialog: {
            openCalls: [],
            open(msg) { this.openCalls.push(msg); }
        },
        GroupDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        },
        GroupPickDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        },
        CopyMoveDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        },
        BookmarkFolderPickDialog: {
            openCalls: [],
            open(opts) { this.openCalls.push(opts); }
        }
    };
    const undo = {
        toastCalls: [],
        showToast(msg) { this.toastCalls.push(msg); }
    };

    const viewTabGroups = initViewTabGroups({
        store,
        views,
        treeRender,
        dialogs,
        undo,
        ...(opts.onChanged ? { onChanged: opts.onChanged } : {}),
        ...(opts.onRowsRendered ? { onRowsRendered: opts.onRowsRendered } : {})
    });

    const $list = byId['tabgroups-list'];
    const fire = (type, ev) => {
        for (const fn of ($list.listeners[type] || []))
            fn(ev);
        return ev;
    };
    const clickOn = target => fire('click', {
        target,
        preventDefault() { this.prevented = (this.prevented || 0) + 1; },
        stopPropagation() { this.stopped = (this.stopped || 0) + 1; }
    });

    const closestOf = result => sel => {
        if (sel === 'li')
            return result.li || null;
        if (result[sel])
            return result[sel];
        return null;
    };

    return {
        viewTabGroups, $list, byId, doc, chrome: chromeStub, store, views,
        treeRender, dialogs, undo,
        def: () => views.def, fire, clickOn, closestOf
    };
};

describe('view registration', () => {
    it('registers the tabgroups view after search (metadata, typeAhead off)', () => {
        const { def, $list, byId } = setup({});
        expect(def().id).toBe('tabgroups');
        expect(def().titleKey).toBe('viewTabGroups');
        expect(def().icon).toContain('<svg');
        expect(def().container).toBe(byId['view-tabgroups']);
        expect(def().listEl).toBe($list);
        expect(def().typeAhead).toBe(false);
        expect(def().showKey).toBe('showTabGroupsView');
        expect(def().disableKey).toBe('disableTabGroupsView');
    });

    it('maps showTabGroupsView onto tab visibility', () => {
        expect(setup({}).def().hidden).toBe(false);
        expect(setup({ storeData: { showTabGroupsView: '' } }).def().hidden).toBe(true);
    });

    it('badge() tracks the current window tab count after refresh', () => {
        const { def } = setup({});
        expect(def().badge()).toBe(0);
        def().activate();
        expect(def().badge()).toBe(4);
    });
});

describe('render', () => {
    it('renders group headers and ungrouped rows in tab order', () => {
        const { def, $list } = setup({});
        def().activate();
        const html = $list.innerHTML;
        // group g1 appears before its two members; ungrouped tabs 1 and 4
        // keep their tab-strip positions (tab 1 before the group, tab 4 after)
        expect(html.indexOf('tabgroups-item-1')).toBeLessThan(html.indexOf('data-group-id="g1"'));
        expect(html.indexOf('data-group-id="g1"')).toBeLessThan(html.indexOf('tabgroups-item-2'));
        expect(html.indexOf('tabgroups-item-2')).toBeLessThan(html.indexOf('tabgroups-item-3'));
        expect(html.indexOf('tabgroups-item-3')).toBeLessThan(html.indexOf('tabgroups-item-4'));
        // group header content: title, color, count, save action
        expect(html).toContain('Dev');
        expect(html).toContain('tg-blue');
        expect(html).toContain('tabGroupsGroupCount[2]');
        expect(html).toContain('tabgroups-group-save');
        // current tab marker
        expect(html).toContain('tabgroups-current');
        expect(html).toContain('row-badge current');
    });

    it('renders an empty state when the window has no tabs', () => {
        const { def, $list } = setup({ tabs: [] });
        def().activate();
        expect($list.innerHTML).toContain('tabGroupsViewEmpty');
    });
});

describe('group color edge option', () => {
    it('keeps the group color option out of the toolbar (it lives in options)', () => {
        const { def, $list } = setup({});
        def().activate();
        const html = $list.innerHTML;
        expect(html).not.toContain('tabgroups-color-border-input');
        expect(html).not.toContain('tabGroupsColorBorder');
        expect(html).not.toContain('color-enhanced');
    });

    it('adds the colored edge to group rows only when the option is on', () => {
        const { def, $list } = setup({ storeData: { tabGroupsColorBorder: '1' } });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('class="color-enhanced"');
        expect(html).toContain('tabgroups-group tg-blue');
        expect(html).toContain('grouped tg-blue');
        // ungrouped tab 1 carries no tg-* group color class
        expect(html).not.toMatch(/tabgroups-item-1[^>]*grouped tg-/);
    });
});

describe('selection mode', () => {
    it('enters and exits through toolbar buttons and Esc', () => {
        const { def, $list, fire, clickOn, closestOf } = setup({});
        def().activate();
        const target = { closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) };
        clickOn(target);
        expect($list.innerHTML).toContain('selecting-bar');
        expect($list.innerHTML).toContain('tabgroups-new-group');
        // Esc exits
        expect(def().onEscape()).toBe(true);
        expect($list.innerHTML).not.toContain('selecting-bar');
        // outside selection mode Esc is not consumed
        expect(def().onEscape()).toBe(false);
    });

    it('row click toggles selection and toolbar count updates', () => {
        const { def, $list, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        clickOn({ closest: closestOf({ li }) });
        expect($list.innerHTML).toContain('selectCount[1]');
        clickOn({ closest: closestOf({ li }) });
        expect($list.innerHTML).toContain('selectCount[0]');
    });

    it('group head click toggles every member tab', () => {
        const { def, $list, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        clickOn({ closest: closestOf({ li }) });
        expect($list.innerHTML).toContain('selectCount[2]');
        clickOn({ closest: closestOf({ li }) });
        expect($list.innerHTML).toContain('selectCount[0]');
    });

    it('group head checkbox selects all members when partial, and clears when all selected', () => {
        const { def, $list, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        // select one member only (partial)
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '2' }, classList: makeClassList() } }) });
        expect($list.innerHTML).toContain('selectCount[1]');
        // group head click with a partial selection selects the whole group
        const groupLi = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        clickOn({ closest: closestOf({ li: groupLi }) });
        expect($list.innerHTML).toContain('selectCount[2]');
        // clicking again clears the whole group (all-selected -> none)
        clickOn({ closest: closestOf({ li: groupLi }) });
        expect($list.innerHTML).toContain('selectCount[0]');
    });
});

describe('tab batch actions', () => {
    it('new group sends vbm-tabs-new-group with ungrouped tabs moved', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '4' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-new-group': { classList: makeClassList() } }) });
        expect(dialogs.GroupDialog.openCalls).toHaveLength(1);
        const openOpts = dialogs.GroupDialog.openCalls[0];
        expect(openOpts.title).toBe('tabGroupUntitled');
        openOpts.onConfirm('Work', 'red');
        expect(chrome.runtime.sendMessageCalls).toHaveLength(1);
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({
            type: 'vbm-tabs-new-group',
            moveIds: [4],
            copyTabs: [],
            title: 'Work',
            color: 'red',
            windowId: 1
        });
    });

    it('new group with a grouped selected tab asks copy-or-move, then sends copy specs', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '2' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-new-group': { classList: makeClassList() } }) });
        expect(dialogs.CopyMoveDialog.openCalls).toHaveLength(1);
        expect(dialogs.GroupDialog.openCalls).toHaveLength(0);
        dialogs.CopyMoveDialog.openCalls[0].onCopy();
        expect(dialogs.GroupDialog.openCalls).toHaveLength(1);
        dialogs.GroupDialog.openCalls[0].onConfirm('CopyGroup', 'green');
        expect(chrome.runtime.sendMessageCalls).toHaveLength(1);
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({
            type: 'vbm-tabs-new-group',
            moveIds: [],
            copyTabs: [{ url: 'https://t2.example/', title: 'Tab 2' }],
            title: 'CopyGroup',
            color: 'green',
            windowId: 1
        });
    });

    it('close selected confirms then sends vbm-tabs-close', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '1' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-close-selected': { classList: makeClassList() } }) });
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(chrome.runtime.sendMessageCalls).toHaveLength(1);
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({ type: 'vbm-tabs-close', tabIds: [1] });
    });

    it('sleep selected confirms then sends vbm-tabs-discard', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '1' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-sleep-selected': { classList: makeClassList() } }) });
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(chrome.runtime.sendMessageCalls[0]).toEqual({ type: 'vbm-tabs-discard', tabIds: [1] });
    });
});

describe('bookmark integration', () => {
    it('hover add-bookmark button creates a bookmark in quickAddFolderId and toasts', () => {
        const { def, chrome, undo, clickOn, closestOf } = setup({ storeData: { quickAddFolderId: '2' } });
        def().activate();
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-add-bookmark' ? btn : null) };
        clickOn(btn);
        expect(chrome.bookmarks.searchCalls).toHaveLength(1);
        expect(chrome.bookmarks.createCalls).toHaveLength(1);
        expect(chrome.bookmarks.createCalls[0].parentId).toBe('2');
        expect(chrome.bookmarks.createCalls[0].url).toBe('https://t1.example/');
        expect(undo.toastCalls).toHaveLength(1);
        expect(undo.toastCalls[0]).toBe('quickAddedTo[folder-2]');
    });

    it('renders a filled always-visible star for already-bookmarked tabs', () => {
        const { def, $list } = setup({
            bookmarkTree: [{ id: '0', title: '', children: [{ id: '1', title: 'Bar', children: [
                { id: '11', title: 'T1', url: 'https://t1.example/' }
            ] }] }]
        });
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('tabgroups-star');
        expect(html).toContain('vbm-icon-star-filled');
        // unbookmarked tab 4 keeps the hover-revealed add button
        expect(html).toContain('tabgroups-add-btn');
        expect(html).toContain('vbm-icon-star');
    });

    it('flips an unbookmarked row to the filled star after quick-add', () => {
        const { def, $list, clickOn, closestOf } = setup({});
        def().activate();
        expect($list.innerHTML).not.toContain('tabgroups-star');
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-add-bookmark' ? btn : null) };
        clickOn(btn);
        const html = $list.innerHTML;
        const row1 = html.slice(html.indexOf('id="tabgroups-item-1"'), html.indexOf('id="tabgroups-group-g1"'));
        expect(row1).toContain('tabgroups-star');
        expect(row1).not.toContain('tabgroups-add-btn');
        // other unbookmarked rows keep the add button
        expect(html).toContain('tabgroups-add-btn');
    });

    it('add selected to bookmark folder opens the folder picker and creates in the picked folder', async () => {
        const { def, chrome, dialogs, undo, clickOn, closestOf } = setup({});
        def().activate();
        clickOn({ closest: closestOf({ '.tabgroups-select-mode': { classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ li: { dataset: { tabId: '1' }, classList: makeClassList() } }) });
        clickOn({ closest: closestOf({ '.tabgroups-add-bookmarks': { classList: makeClassList() } }) });
        expect(dialogs.BookmarkFolderPickDialog.openCalls).toHaveLength(1);
        dialogs.BookmarkFolderPickDialog.openCalls[0].onPick('9');
        // let the create promise chain settle
        await flush();
        expect(chrome.bookmarks.createCalls).toHaveLength(1);
        expect(chrome.bookmarks.createCalls[0].parentId).toBe('9');
        expect(undo.toastCalls[0]).toBe('tabGroupsBookmarksAdded[1|folder-9]');
    });

    it('save group to bookmarks creates a folder via saveSession and writes folder meta', async () => {
        const { def, chrome, store, undo, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-save' ? btn : null) };
        clickOn(btn);
        await flush();
        expect(chrome.bookmarks.createCalls.length).toBeGreaterThanOrEqual(2); // folder + tabs
        const meta = JSON.parse(store._data.tabGroupFolderMeta || '{}');
        expect(meta.bm_1 && meta.bm_1.color).toBe('blue');
        expect(undo.toastCalls[0]).toBe('tabGroupsGroupSavedToFolder[2|Dev]');
    });
});

describe('keyboard safety (tab rows are not bookmarks)', () => {
    it('group head li carries an id for focus memory', () => {
        const { def, $list } = setup({});
        def().activate();
        expect($list.innerHTML).toContain('id="tabgroups-group-g1"');
    });

    it('F2 on a tab row stops propagation and never reaches the bookmark rename path', () => {
        const { def, fire, closestOf } = setup({});
        def().activate();
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        const ev = {
            key: 'F2',
            target: { closest: closestOf({ li }) },
            prevented: 0,
            stoppedImmediate: 0,
            preventDefault() { this.prevented++; },
            stopImmediatePropagation() { this.stoppedImmediate++; }
        };
        fire('keydown', ev);
        expect(ev.prevented).toBe(1);
        expect(ev.stoppedImmediate).toBe(1);
    });

    it('F2 on a group head opens the rename dialog', () => {
        const { def, dialogs, fire, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const head = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-head' ? head : null) };
        fire('keydown', {
            key: 'F2',
            target: head,
            preventDefault() {},
            stopImmediatePropagation() {}
        });
        expect(dialogs.GroupDialog.openCalls).toHaveLength(1);
        expect(dialogs.GroupDialog.openCalls[0].dialog).toBe('tabGroupsRenameDialog');
    });

    it('Delete on a tab row confirms and sends a single-tab close', () => {
        const { def, chrome, dialogs, fire, closestOf } = setup({});
        def().activate();
        const li = { dataset: { tabId: '1' }, classList: makeClassList() };
        fire('keyup', {
            key: 'Delete',
            target: { closest: closestOf({ 'li.tabgroups-row': li }) },
            preventDefault() {},
            stopImmediatePropagation() {}
        });
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-close', tabIds: [1] }]);
    });
});

describe('group management (browser-synced)', () => {
    it('group head renders activate/rename/save/sleep/close actions', () => {
        const { def, $list } = setup({});
        def().activate();
        const html = $list.innerHTML;
        expect(html).toContain('tabgroups-group-activate');
        expect(html).toContain('tabgroups-group-rename');
        expect(html).toContain('tabgroups-group-save');
        expect(html).toContain('tabgroups-group-sleep');
        expect(html).toContain('tabgroups-group-close');
        expect(html).toContain('tabGroupsActivateGroup');
        expect(html).toContain('tabGroupsCloseGroup');
    });

    it('activate group focuses the first member tab', () => {
        const { def, chrome, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-activate' ? btn : null) };
        clickOn(btn);
        expect(chrome.tabs.updateCalls).toEqual([[2, { active: true }]]);
    });

    it('rename group opens the group dialog and updates the browser group', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-rename' ? btn : null) };
        clickOn(btn);
        expect(dialogs.GroupDialog.openCalls).toHaveLength(1);
        expect(dialogs.GroupDialog.openCalls[0].dialog).toBe('tabGroupsRenameDialog');
        expect(dialogs.GroupDialog.openCalls[0].title).toBe('Dev');
        expect(dialogs.GroupDialog.openCalls[0].color).toBe('blue');
        dialogs.GroupDialog.openCalls[0].onConfirm('Renamed', 'red');
        expect(chrome.tabGroups.updateCalls).toEqual([['g1', { title: 'Renamed', color: 'red' }]]);
    });

    it('close group confirms then sends vbm-tabs-close with every member id', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-close' ? btn : null) };
        clickOn(btn);
        expect(dialogs.ConfirmDialog.openCalls).toHaveLength(1);
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-close', tabIds: [2, 3] }]);
    });

    it('sleep group confirms then sends vbm-tabs-discard with every member id', () => {
        const { def, chrome, dialogs, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const btn = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-sleep' ? btn : null) };
        clickOn(btn);
        dialogs.ConfirmDialog.openCalls[0].fn1();
        expect(chrome.runtime.sendMessageCalls).toEqual([{ type: 'vbm-tabs-discard', tabIds: [2, 3] }]);
    });

    it('collapse/expand is local-only by default (sync option off)', () => {
        const { def, chrome, clickOn, closestOf } = setup({});
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const head = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-head' ? head : null) };
        clickOn(head);
        expect(chrome.tabGroups.updateCalls).toEqual([]);
    });

    it('collapse/expand syncs to the browser when the sync option is on', () => {
        const { def, chrome, clickOn, closestOf } = setup({ storeData: { tabGroupsSyncCollapse: '1' } });
        def().activate();
        const li = { dataset: { groupId: 'g1' }, classList: makeClassList() };
        const head = { classList: makeClassList(), closest: sel => sel === 'li' ? li : (sel === '.tabgroups-group-head' ? head : null) };
        clickOn(head);
        expect(chrome.tabGroups.updateCalls).toEqual([['g1', { collapsed: true }]]);
    });

    it('refresh seeds collapsed state from the browser groups', () => {
        const { def, $list } = setup({ groups: [makeGroup('g1', 'Dev', 'blue', { collapsed: true })] });
        def().activate();
        // collapsed group hides its member rows
        expect($list.innerHTML).not.toContain('tabgroups-item-2');
        expect($list.innerHTML).toContain('collapsed');
    });
});

describe('drag sorting', () => {
    it('drop on another row calls chrome.tabs.move with the target index', () => {
        const { def, chrome, $list, fire, closestOf } = setup({});
        def().activate();
        const sourceLi = { dataset: { tabId: '1' }, classList: makeClassList() };
        fire('dragstart', {
            target: { closest: closestOf({ 'li.tabgroups-row': sourceLi }) },
            dataTransfer: { setData() {} }
        });
        const targetTab = { id: 4, index: 3 };
        const targetLi = { dataset: { tabId: '4' }, classList: makeClassList() };
        fire('drop', {
            preventDefault() {},
            target: { closest: closestOf({ 'li.tabgroups-row': targetLi }) },
            dataTransfer: {}
        });
        expect(chrome.tabs.moveCalls).toHaveLength(1);
        expect(chrome.tabs.moveCalls[0]).toEqual([1, { windowId: 1, index: 3 }]);
        // no move when dropping on itself
        fire('dragstart', {
            target: { closest: closestOf({ 'li.tabgroups-row': sourceLi }) },
            dataTransfer: { setData() {} }
        });
        fire('drop', {
            preventDefault() {},
            target: { closest: closestOf({ 'li.tabgroups-row': sourceLi }) },
            dataTransfer: {}
        });
        expect(chrome.tabs.moveCalls).toHaveLength(1);
    });
});
