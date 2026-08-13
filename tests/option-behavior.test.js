import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { makeStoreDouble, makeEl } from './helpers/dom.js';
import { makeI18n } from './helpers/i18n.js';

// 选项开关 → 动作行为 联动契约（option-behavior）。
// 每个开关一对用例：开 / 关 两态，断言动作行为真的改变——不是只验证选项页把
// 复选框写进 storage，而是验证"开关翻转 → 对应动作行为翻转"。驱动真实模块。
// 各开关的完整行为深测仍在其模块套件（actions/search/view-manager/tree-view…
// ），本套件是跨开关的行为差分契约。

// ---- Actions family ---------------------------------------------------------

let initActions;
beforeAll(async () => {
    ({ initActions } = await import('../src/actions.js'));
});

const actionsHarness = (storeData, opts = {}) => {
    const store = makeStoreDouble(storeData);
    const calls = { confirm: [], remove: [], tabCreate: [], tabUpdate: [], toast: [], windowClose: 0 };
    const timeouts = [];
    const chrome = {
        i18n: { getMessage: makeI18n() },
        bookmarks: {
            getChildren: (id, cb) => cb(opts.children || []),
            remove: (id, cb) => { calls.remove.push(id); if (cb) cb(); },
            removeTree: (id, cb) => { calls.remove.push(id); if (cb) cb(); }
        },
        tabs: {
            query: (q, cb) => cb(opts.tabs || [{ id: 1, url: 'https://x/', title: 'X' }]),
            create: (props, cb) => { calls.tabCreate.push(props); if (cb) cb({ id: 9, ...props }); },
            update: (id, props) => calls.tabUpdate.push([id, props])
        },
        windows: { WINDOW_ID_CURRENT: -1, create: () => {} },
        runtime: { lastError: null, sendMessage: () => {} }
    };
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => { timeouts.push([fn, ms]); return 0; };
    globalThis.chrome = chrome;
    globalThis.window = { close() { calls.windowClose++; } };
    // the actions layer reads the tree-row span for folder-name copy in the
    // delete confirm; provide a stub row with a named span
    const treeItem = makeEl('', 'LI');
    const span = makeEl('', 'SPAN');
    span.textContent = opts.treeItemText || '';
    treeItem.appendChild(span);
    globalThis.document = { getElementById: () => treeItem };
    const actions = initActions({
        store,
        dialogs: {
            ConfirmDialog: { open: o => calls.confirm.push(o) },
            EditDialog: { open() {} },
            NewFolderDialog: { open() {} }
        },
        search: { isActive: () => false },
        separatorManager: {
            separatorURL: 'http://separatethis.com/', separatorTitle: '|',
            add: () => {}, remove: () => {}
        },
        generateBookmarkHTML: (t, u, e, id) => `<a data-bm="${id}">${t}</a>`,
        generateFolderHTML: (t, e, id) => `<span data-folder="${id}">${t}</span>`,
        generateSeparatorHTML: () => '<hr>',
        generateHTML: () => '<ul></ul>',
        httpsPattern: /^https?:\/\//i,
        undo: { capture: () => {}, showToast: m => calls.toast.push(m) }
    });
    return {
        actions, store, calls, timeouts,
        restore() {
            globalThis.setTimeout = realSetTimeout;
            delete globalThis.chrome;
            delete globalThis.window;
            delete globalThis.document;
        }
    };
};

describe('开关→动作: 弹窗保持 (bookmarkClickStayOpen)', () => {
    it('off → 打开书签后 200ms 关闭弹窗; on → 保持打开', () => {
        const h = actionsHarness({});
        h.actions.openBookmark('https://x/');
        expect(h.timeouts.some(([fn]) => fn === globalThis.window.close)).toBe(true);
        h.restore();

        const on = actionsHarness({ bookmarkClickStayOpen: '1' });
        on.actions.openBookmark('https://x/');
        expect(on.timeouts.filter(([fn]) => fn === on.window.close)).toHaveLength(0);
        on.restore();
    });
});

describe('开关→动作: 批量打开确认 (dontConfirmOpenFolder)', () => {
    const URLS = Array.from({ length: 11 }, (_, i) => `https://${i}.example/`);

    it('off → >10 链接先出确认框; on → 直接打开不确认', () => {
        const off = actionsHarness({});
        off.actions.openBookmarks(URLS, true);
        expect(off.calls.confirm).toHaveLength(1);
        expect(off.calls.tabCreate).toHaveLength(0); // tabs only open after fn1
        off.restore();

        const on = actionsHarness({ dontConfirmOpenFolder: '1' });
        on.actions.openBookmarks(URLS, true);
        expect(on.calls.confirm).toHaveLength(0);
        expect(on.calls.tabCreate).toHaveLength(11);
        on.restore();
    });
});

describe('开关→动作: 删除非空文件夹确认 (confirmDeleteFolder)', () => {
    // 文件夹含 1 个书签 + 1 个子文件夹
    const CHILDREN = [
        { id: 'b1', title: 'B', url: 'https://b.example/' },
        { id: 'f1', title: 'Sub' }
    ];

    it('on → 非空文件夹删除先确认; off → 直接删 + toast', () => {
        const on = actionsHarness({ confirmDeleteFolder: '1' }, { children: CHILDREN });
        on.actions.deleteBookmarks('5', 1, 1); // 1 bookmark + 1 subfolder
        expect(on.calls.confirm).toHaveLength(1);
        expect(on.calls.remove).toHaveLength(0);
        on.restore();

        const off = actionsHarness({ confirmDeleteFolder: '' }, { children: CHILDREN });
        off.actions.deleteBookmarks('5', 1, 1);
        expect(off.calls.confirm).toHaveLength(0);
        expect(off.calls.remove).toContain('5');
        expect(off.calls.toast).toHaveLength(1);
        off.restore();
    });
});

// ---- Visit-stats family ------------------------------------------------------

let initVisitStats;
beforeAll(async () => {
    ({ initVisitStats } = await import('../src/visit-stats.js'));
});

describe('开关→动作: 访问统计 (statsEnabled)', () => {
    it('off → record 零写入; on → record 记账', () => {
        const off = initVisitStats({ store: makeStoreDouble({ statsEnabled: '' }), debounceMs: 0 });
        off.record('1', 100);
        off.flush();
        expect(off.all()).toEqual({});
        expect(off.enabled()).toBe(false);

        const on = initVisitStats({ store: makeStoreDouble(), debounceMs: 0 });
        on.record('1', 100);
        on.flush();
        expect(on.get('1')).toEqual({ c: 1, t: 100 });
        expect(on.enabled()).toBe(true);
    });
});
