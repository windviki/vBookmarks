import { describe, it, expect, beforeEach } from 'vitest';
import {
    parkRowFocus, unparkRowFocus, rowFocusTarget,
    parkToolbarFocus, restoreToolbarFocus, TOOLBAR_CONTROLS_SEL
} from '../src/list-focus.js';

// list-focus.js owns the shared focus contracts of the list views: the row
// park/restore (4.0.1 focus law), the row's focus-target rule (rowFocusTarget)
// and the toolbar park/restore. The doubles model just the DOM shape the
// module queries — li sets, a/span targets, tabindex rows, button-led rows —
// and assertions go through document.activeElement / the focused flags.

const makeDoc = () => {
    const doc = { activeElement: null, _byId: {} };
    doc.getElementById = id => doc._byId[id] || null;
    return doc;
};

// A list double handing out a fixed li set (like the real DOM after a render).
const makeList = (doc, lis = []) => ({
    tagName: 'DIV',
    focused: false,
    focus() { this.focused = true; doc.activeElement = this; },
    querySelectorAll(sel) { return sel === 'li' ? lis : []; }
});

// A row double: li + inner anchor, parented up to the list (a → li → list).
// `buttonFirst` models the dupes member shape (<button.keeper-radio> leads
// the row, the anchor follows) — the contract surface is querySelector, which
// finds the anchor regardless of the leading button.
const makeRow = (doc, list, { id = '', tabindex = null, withAnchor = true } = {}) => {
    const a = withAnchor ? {
        tagName: 'A',
        focused: false,
        focus() { this.focused = true; doc.activeElement = this; }
    } : null;
    const li = {
        tagName: 'LI',
        id,
        parentNode: list,
        focused: false,
        focus() { this.focused = true; doc.activeElement = this; },
        getAttribute: name => (name === 'tabindex' ? tabindex : null),
        querySelector: sel => (sel === 'a, span' ? a : null)
    };
    if (a)
        a.parentNode = li;
    if (id)
        doc._byId[id] = li;
    return { li, a };
};

const makeButton = doc => ({
    tagName: 'BUTTON',
    focused: false,
    focus() { this.focused = true; doc.activeElement = this; }
});

beforeEach(() => {
    globalThis.document = makeDoc();
});

describe('rowFocusTarget — the shared row contract', () => {
    it('a button-led row resolves to its anchor, never the bare li (dupes member shape)', () => {
        const doc = globalThis.document;
        const list = makeList(doc);
        const { li, a } = makeRow(doc, list); // <button.keeper-radio> + <a>
        expect(rowFocusTarget(li)).toBe(a);
    });

    it('a tabindex row container takes the focus itself (dead start row)', () => {
        const doc = globalThis.document;
        const list = makeList(doc);
        const { li } = makeRow(doc, list, { tabindex: '-1', withAnchor: false });
        expect(rowFocusTarget(li)).toBe(li);
    });

    it('a plain row with neither anchor nor tabindex resolves to null', () => {
        const doc = globalThis.document;
        const list = makeList(doc);
        const { li } = makeRow(doc, list, { withAnchor: false });
        expect(rowFocusTarget(li)).toBe(null);
    });
});

describe('parkRowFocus / unparkRowFocus', () => {
    it('parks the focused row by id and restores its same-id replacement', () => {
        const doc = globalThis.document;
        const oldList = makeList(doc);
        const oldRow = makeRow(doc, oldList, { id: 'item-1' });
        oldList.querySelectorAll = sel => (sel === 'li' ? [oldRow.li] : []);
        doc.activeElement = oldRow.a;
        const parked = parkRowFocus(oldList);
        expect(parked).toEqual({ id: 'item-1', idx: 0 });
        // the swap: a new list whose same-id row is a new element
        const newList = makeList(doc);
        const newRow = makeRow(doc, newList, { id: 'item-1' });
        unparkRowFocus(newList, parked);
        expect(doc.activeElement).toBe(newRow.a);
    });

    it('an emptied list parks on the container by default', () => {
        const doc = globalThis.document;
        const oldList = makeList(doc);
        const row = makeRow(doc, oldList, { id: 'item-1' });
        oldList.querySelectorAll = sel => (sel === 'li' ? [row.li] : []);
        doc.activeElement = row.a;
        const parked = parkRowFocus(oldList);
        delete doc._byId['item-1']; // the row is gone after the swap
        const newList = makeList(doc); // no rows at all
        unparkRowFocus(newList, parked);
        expect(doc.activeElement).toBe(newList);
    });

    it('an emptied list falls back to emptyFocus when given (search box)', () => {
        const doc = globalThis.document;
        const oldList = makeList(doc);
        const row = makeRow(doc, oldList, { id: 'item-1' });
        oldList.querySelectorAll = sel => (sel === 'li' ? [row.li] : []);
        doc.activeElement = row.a;
        const parked = parkRowFocus(oldList);
        delete doc._byId['item-1'];
        const newList = makeList(doc);
        const searchInput = { tagName: 'INPUT', focused: false, focus() { this.focused = true; doc.activeElement = this; } };
        unparkRowFocus(newList, parked, searchInput);
        expect(doc.activeElement).toBe(searchInput); // not the area container
        expect(newList.focused).toBe(false);
    });

    it('a vanished row id falls back to the index-clamped row', () => {
        const doc = globalThis.document;
        const oldList = makeList(doc);
        const rows = [makeRow(doc, oldList), makeRow(doc, oldList), makeRow(doc, oldList)];
        oldList.querySelectorAll = sel => (sel === 'li' ? rows.map(r => r.li) : []);
        doc.activeElement = rows[2].a; // the third row held focus
        const parked = parkRowFocus(oldList);
        expect(parked).toEqual({ id: '', idx: 2 });
        const newList = makeList(doc);
        const shrunk = [makeRow(doc, newList), makeRow(doc, newList)];
        newList.querySelectorAll = sel => (sel === 'li' ? shrunk.map(r => r.li) : []);
        unparkRowFocus(newList, parked);
        expect(doc.activeElement).toBe(shrunk[1].a); // min(2, 1) → the second row
    });

    it('focus outside the list parks nothing', () => {
        const doc = globalThis.document;
        const list = makeList(doc);
        doc.activeElement = { tagName: 'BUTTON' }; // no LI anywhere up the chain
        expect(parkRowFocus(list)).toBe(null);
    });
});

// Toolbar park/restore (B2): keyed by control class + same-class index — the
// focusSpot identity — so a re-render that inserts/removes a differently
// classed button never drifts (a bare positional index would).
const makeControl = (tagName, className) => ({
    tagName,
    className: className || '',
    parentNode: null,
    focused: false,
    focus() { this.focused = true; }
});

const makeToolbarList = controls => ({
    tagName: 'DIV',
    _controls: controls,
    querySelectorAll(sel) {
        return sel === TOOLBAR_CONTROLS_SEL ? this._controls.slice() : [];
    },
    focus() { this.focused = true; }
});

const setFocus = el => { globalThis.document.activeElement = el; };

describe('parkToolbarFocus / restoreToolbarFocus (B2)', () => {
    it('captures and restores the focused control among same-class siblings', () => {
        const list = makeToolbarList([
            makeControl('BUTTON', 'filter-btn'),
            makeControl('BUTTON', 'scan-btn'),
            makeControl('BUTTON', 'filter-btn')   // the focused one: cls idx 1
        ]);
        setFocus(list._controls[2]);
        const parked = parkToolbarFocus(list);
        expect(parked).toEqual({ cls: 'filter-btn', idx: 1 });
        restoreToolbarFocus(list, parked);
        expect(list._controls[2].focused).toBe(true);
    });

    it('an inserted differently-classed button does not drift the restore', () => {
        // a bare positional index would now point one slot past the target
        const before = makeToolbarList([
            makeControl('BUTTON', 'filter-btn'),
            makeControl('BUTTON', 'filter-btn')
        ]);
        setFocus(before._controls[1]);
        const parked = parkToolbarFocus(before);
        expect(parked.idx).toBe(1);
        const after = makeToolbarList([
            makeControl('BUTTON', 'brand-new-btn'), // inserted ahead
            makeControl('BUTTON', 'filter-btn'),
            makeControl('BUTTON', 'filter-btn')
        ]);
        restoreToolbarFocus(after, parked);
        expect(after._controls[2].focused).toBe(true); // still the second filter-btn
        expect(after._controls[0].focused).toBe(false);
    });

    it('a removed same-class predecessor degrades to the first same-class control', () => {
        const before = makeToolbarList([
            makeControl('BUTTON', 'filter-btn'),
            makeControl('BUTTON', 'filter-btn')
        ]);
        setFocus(before._controls[1]);
        const parked = parkToolbarFocus(before);
        const after = makeToolbarList([makeControl('BUTTON', 'filter-btn')]); // one removed
        restoreToolbarFocus(after, parked);
        expect(after._controls[0].focused).toBe(true);
    });

    it('a text input parks and restores its caret, not just focus', () => {
        const before = makeToolbarList([makeControl('INPUT', 'tabgroups-filter-input')]);
        const input = before._controls[0];
        input.type = 'text';
        input.selectionStart = 1;
        input.selectionEnd = 2;
        input.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };
        setFocus(input);
        const parked = parkToolbarFocus(before);
        expect(parked).toEqual({ cls: 'tabgroups-filter-input', idx: 0, sel: [1, 2] });
        const after = makeToolbarList([makeControl('INPUT', 'tabgroups-filter-input')]);
        const target = after._controls[0];
        target.type = 'text';
        target.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b; };
        restoreToolbarFocus(after, parked);
        expect(target.focused).toBe(true);
        expect(target.selectionStart).toBe(1);
        expect(target.selectionEnd).toBe(2);
    });

    it('a button parks no caret (the parked shape stays minimal)', () => {
        const list = makeToolbarList([makeControl('BUTTON', 'filter-btn')]);
        setFocus(list._controls[0]);
        expect(parkToolbarFocus(list)).toEqual({ cls: 'filter-btn', idx: 0 });
    });

    it('the risk banner\'s controls ride the same park/restore', () => {
        const bannerLink = makeControl('A', 'risk-banner-help');
        const list = makeToolbarList([bannerLink]);
        setFocus(bannerLink);
        const parked = parkToolbarFocus(list);
        expect(parked).toEqual({ cls: 'risk-banner-help', idx: 0 });
        bannerLink.focused = false;
        restoreToolbarFocus(list, parked);
        expect(bannerLink.focused).toBe(true);
    });

    it('focus outside the toolbar parks null and restores nothing', () => {
        const list = makeToolbarList([makeControl('BUTTON', 'filter-btn')]);
        const row = { tagName: 'A', parentNode: null };
        setFocus(row);
        expect(parkToolbarFocus(list)).toBeNull();
        expect(() => restoreToolbarFocus(list, null)).not.toThrow();
        expect(list._controls[0].focused).toBe(false);
    });

    it('a control without a class still parks and restores (empty-class cohort)', () => {
        const list = makeToolbarList([makeControl('SELECT', ''), makeControl('BUTTON', 'x')]);
        setFocus(list._controls[0]);
        const parked = parkToolbarFocus(list);
        expect(parked).toEqual({ cls: '', idx: 0 });
        restoreToolbarFocus(list, parked);
        expect(list._controls[0].focused).toBe(true);
    });
});
