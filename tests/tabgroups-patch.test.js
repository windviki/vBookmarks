import { describe, it, expect } from 'vitest';
import { isTitleOnlyChange, renderInputsFingerprint, replaceTabRowNode } from '../src/tabgroups-patch.js';

// The tab-groups rows render title/url/pin/sleep/grouping/bookmark-star;
// the digest must move exactly when one of those moves and stay put for
// everything else (favIconUrl storms included).
const snap = (over = {}) => Object.assign({
    windows: [
        { id: 1, focused: true, tabs: [
            { id: 11, index: 0, title: 'A', url: 'https://a/', pinned: false, discarded: false, active: true, groupId: -1 },
            { id: 12, index: 1, title: 'B', url: 'https://b/', pinned: true, discarded: false, active: false, groupId: 7 }
        ] },
        { id: 2, focused: false, tabs: [
            { id: 21, index: 0, title: 'C', url: 'https://c/', pinned: false, discarded: true, active: false, groupId: -1 }
        ] }
    ],
    groups: [{ id: 7, title: 'Dev', color: 'blue', collapsed: false }],
    collapsed: [],
    collapsedWindows: [],
    selecting: false,
    selected: [],
    filterText: '',
    bookmarksRev: 0,
    closedRecords: [{ id: 'ct_x', savedAt: 123, tabs: [{ url: 'https://a/' }] }],
    colorStyle: 'line',
    virtual: false,
    relay: true,
    staged: () => false
}, over);

describe('isTitleOnlyChange', () => {
    it('accepts title / favIconUrl / status in any combination', () => {
        expect(isTitleOnlyChange({ title: 'x' })).toBe(true);
        expect(isTitleOnlyChange({ title: 'x', favIconUrl: 'https://f/' })).toBe(true);
        expect(isTitleOnlyChange({ favIconUrl: 'https://f/' })).toBe(true);
        expect(isTitleOnlyChange({ status: 'loading' })).toBe(true);
        expect(isTitleOnlyChange({ status: 'complete', title: 'y' })).toBe(true);
    });

    it('accepts the empty payload (nothing changed, nothing to do)', () => {
        expect(isTitleOnlyChange({})).toBe(true);
        expect(isTitleOnlyChange(null)).toBe(true);
        expect(isTitleOnlyChange(undefined)).toBe(true);
    });

    it('rejects any field the rows actually render or that moves structure', () => {
        expect(isTitleOnlyChange({ url: 'https://other/' })).toBe(false);
        expect(isTitleOnlyChange({ title: 'x', url: 'https://other/' })).toBe(false);
        expect(isTitleOnlyChange({ pinned: true })).toBe(false);
        expect(isTitleOnlyChange({ discarded: true })).toBe(false);
        expect(isTitleOnlyChange({ audible: true })).toBe(false);
        expect(isTitleOnlyChange({ mutedInfo: { muted: true } })).toBe(false);
        expect(isTitleOnlyChange({ groupId: 9 })).toBe(false);
    });
});

describe('renderInputsFingerprint', () => {
    it('is stable for identical inputs (and key-order independent)', () => {
        expect(renderInputsFingerprint(snap())).toBe(renderInputsFingerprint(snap()));
    });

    it('moves when a rendered tab field changes', () => {
        const base = renderInputsFingerprint(snap());
        const edit = (fn) => {
            const s = snap();
            fn(s);
            return renderInputsFingerprint(s);
        };
        expect(edit(s => { s.windows[0].tabs[0].title = 'A2'; })).not.toBe(base);
        expect(edit(s => { s.windows[0].tabs[0].url = 'https://a2/'; })).not.toBe(base);
        expect(edit(s => { s.windows[0].tabs[0].pinned = true; })).not.toBe(base);
        expect(edit(s => { s.windows[0].tabs[0].discarded = true; })).not.toBe(base);
        expect(edit(s => { s.windows[0].tabs[0].active = false; })).not.toBe(base);
        expect(edit(s => { s.windows[0].tabs[0].groupId = 8; })).not.toBe(base);
        expect(edit(s => { s.windows[0].tabs[0].index = 5; })).not.toBe(base);
    });

    it('stays put for non-rendered fields (the favicon-storm contract)', () => {
        const base = renderInputsFingerprint(snap());
        const s = snap();
        s.windows[0].tabs[0].favIconUrl = 'https://f/';
        s.windows[0].tabs[0].status = 'complete';
        s.windows[0].tabs[0].incognito = true;
        expect(renderInputsFingerprint(s)).toBe(base);
    });

    it('moves for every other render input: folds, selection, filter, marks, records, style', () => {
        const base = renderInputsFingerprint(snap());
        const edit = (fn) => {
            const s = snap();
            fn(s);
            return renderInputsFingerprint(s);
        };
        expect(edit(s => { s.collapsed = ['7']; })).not.toBe(base);
        expect(edit(s => { s.collapsedWindows = ['2']; })).not.toBe(base);
        expect(edit(s => { s.selecting = true; })).not.toBe(base);
        expect(edit(s => { s.selected = ['11']; })).not.toBe(base);
        expect(edit(s => { s.filterText = 'git'; })).not.toBe(base);
        expect(edit(s => { s.bookmarksRev = 1; })).not.toBe(base);
        expect(edit(s => { s.closedRecords = []; })).not.toBe(base);
        expect(edit(s => { s.closedRecords[0].savedAt = 999; })).not.toBe(base);
        expect(edit(s => { s.colorStyle = 'edge'; })).not.toBe(base);
        expect(edit(s => { s.virtual = true; })).not.toBe(base);
        expect(edit(s => { s.relay = false; })).not.toBe(base);
        expect(edit(s => { s.groups[0].collapsed = true; })).not.toBe(base);
        expect(edit(s => { s.windows[0].focused = false; })).not.toBe(base);
        expect(edit(s => { s.staged = url => url === 'https://a/'; })).not.toBe(base);
    });

    it('tolerates missing optional pieces without throwing', () => {
        expect(typeof renderInputsFingerprint({})).toBe('string');
        expect(typeof renderInputsFingerprint(null)).toBe('string');
    });
});

// --- replaceTabRowNode doubles ------------------------------------------------

const makeClassList = (initial = []) => {
    const list = [...initial];
    list.add = (...cs) => { for (const c of cs) if (!list.includes(c)) list.push(c); };
    list.remove = (...cs) => { for (const c of cs) { const i = list.indexOf(c); if (i !== -1) list.splice(i, 1); } };
    list.contains = c => list.includes(c);
    return list;
};

const makeNode = (opts = {}) => {
    const node = {
        tagName: opts.tagName || 'LI',
        classList: makeClassList(opts.classes),
        children: opts.children || [],
        dataset: {},
        html: '',
        replacedWith: null,
        replaceWith(next) { this.replacedWith = next; },
        contains(node) { return node === this || this.children.includes(node); },
        focus() { this.focused = true; },
        querySelector(sel) {
            const cls = /^\.([.\w-]+)$/.exec(sel);
            if (cls)
                return this.children.find(c => c.classList.contains(cls[1])) || null;
            const tagCls = /^(\w+)\.([.\w-]+)$/.exec(sel);
            if (tagCls)
                return this.children.find(c => c.tagName === tagCls[1].toUpperCase()
                    && c.classList.contains(tagCls[2])) || null;
            if (sel === 'a, span[tabindex]' || sel === 'a, span')
                return this.children.find(c => c.tagName === 'A')
                    || this.children.find(c => c.tagName === 'SPAN') || null;
            return this.children.find(c => c.tagName === sel.toUpperCase()) || null;
        }
    };
    return node;
};

// A document double whose <template> cannot parse HTML: innerHTML hands the
// string to the fresh node verbatim (the tests assert on it).
const makeDoc = () => ({
    activeElement: null,
    createElement(tag) {
        const fresh = makeNode({ classes: ['vbm-row', 'tabgroups-row'] });
        const tpl = {
            tagName: String(tag).toUpperCase(),
            content: { firstElementChild: null }
        };
        Object.defineProperty(tpl, 'innerHTML', {
            configurable: true,
            get: () => fresh.html,
            set: v => {
                fresh.html = v;
                tpl.content.firstElementChild = fresh;
            }
        });
        return tpl;
    }
});

describe('replaceTabRowNode', () => {
    it('swaps the old row for the regenerated node and returns it', () => {
        const doc = makeDoc();
        const old = makeNode();
        const fresh = replaceTabRowNode(old, '<li id="x">NEW TITLE</li>', { document: doc });
        expect(fresh).toBeTruthy();
        expect(fresh.html).toContain('NEW TITLE');
        expect(old.replacedWith).toBe(fresh);
    });

    it('carries runtime-added row classes across the swap', () => {
        const doc = makeDoc();
        const old = makeNode({ classes: ['vbm-row', 'dragging', 'tg-last'] });
        const fresh = replaceTabRowNode(old, '<li></li>', { document: doc });
        expect(fresh.classList.contains('dragging')).toBe(true);
        expect(fresh.classList.contains('tg-last')).toBe(true); // positional class survives
        expect(fresh.classList.contains('drag-over')).toBe(false); // not on the old row → not carried
    });

    it('restores DOM focus onto the matching child of the fresh node', () => {
        const link = makeNode({ tagName: 'A', classes: ['tree-item-link'] });
        const freshLink = makeNode({ tagName: 'A', classes: ['tree-item-link'] });
        const fresh = makeNode({ children: [freshLink] });
        const tpl = { content: { firstElementChild: fresh } };
        Object.defineProperty(tpl, 'innerHTML', { configurable: true, get: () => '', set: () => {} });
        const doc = { createElement: () => tpl, activeElement: link };
        const old = makeNode({ children: [link] });
        const out = replaceTabRowNode(old, '<li>x</li>', { document: doc, activeElement: link });
        expect(out).toBe(fresh);
        expect(freshLink.focused).toBe(true);
        expect(old.replacedWith).toBe(fresh);
    });

    it('leaves focus alone when it sat outside the old row', () => {
        const doc = makeDoc();
        const outside = makeNode({ tagName: 'A', classes: ['tree-item-link'] });
        doc.activeElement = outside;
        const old = makeNode();
        const fresh = replaceTabRowNode(old, '<li>x</li>', { document: doc, activeElement: outside });
        expect(fresh).toBeTruthy();
        expect(fresh.children.some(c => c.focused)).toBe(false);
        expect(outside.focused).toBe(undefined);
    });

    it('degrades to null (full-render fallback) on minimal environments', () => {
        const old = makeNode();
        expect(replaceTabRowNode(old, '<li>x</li>', {})).toBe(null);                 // no document
        expect(replaceTabRowNode(old, '<li>x</li>', { document: {} })).toBe(null);   // no createElement
        expect(replaceTabRowNode(null, '<li>x</li>', { document: makeDoc() })).toBe(null);
        const noSwap = { classList: makeClassList() };
        expect(replaceTabRowNode(noSwap, '<li>x</li>', { document: makeDoc() })).toBe(null); // no replaceWith
        const emptyTpl = { createElement: () => ({ content: { firstElementChild: null } }) };
        expect(replaceTabRowNode(old, '', { document: emptyTpl })).toBe(null);       // nothing parsed
    });
});
