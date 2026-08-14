import { describe, it, expect, beforeEach } from 'vitest';
import {
    parkRowFocus, unparkRowFocus, rowFocusTarget,
    toolbarFocusIndex, restoreToolbarFocus, TOOLBAR_SEL, TOOLBAR_SEL_RISK
} from '../src/list-focus.js';

// list-focus.js owns the shared focus contracts of the list views: the row
// park/restore (4.0.1 focus law), the row's focus-target rule (rowFocusTarget)
// and the toolbar park/restore trio. The doubles model just the DOM shape the
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

describe('toolbarFocusIndex / restoreToolbarFocus (final polish trio)', () => {
    it('TOOLBAR_SEL_RISK extends the base selector with the risk-banner controls', () => {
        expect(TOOLBAR_SEL_RISK).toContain(TOOLBAR_SEL);
        expect(TOOLBAR_SEL_RISK).toContain('.risk-banner button');
        expect(TOOLBAR_SEL_RISK).toContain('.risk-banner a[href]');
    });

    it('reports the focused control\'s index, -1 when focus is elsewhere', () => {
        const doc = globalThis.document;
        const controls = [makeButton(doc), makeButton(doc), makeButton(doc)];
        const root = { querySelectorAll: sel => (sel === TOOLBAR_SEL ? controls : []) };
        doc.activeElement = controls[1];
        expect(toolbarFocusIndex(root)).toBe(1);
        doc.activeElement = makeButton(doc); // not in the set
        expect(toolbarFocusIndex(root)).toBe(-1);
        // doubles without querySelectorAll park nothing (the guard)
        expect(toolbarFocusIndex({})).toBe(-1);
    });

    it('restores the idx-th control after the re-render; custom selector honored', () => {
        const doc = globalThis.document;
        const controls = [makeButton(doc), makeButton(doc)];
        const riskControls = [makeButton(doc)];
        const root = {
            querySelectorAll: sel =>
                sel === TOOLBAR_SEL_RISK ? [...controls, ...riskControls]
                    : sel === TOOLBAR_SEL ? controls : []
        };
        restoreToolbarFocus(root, 1);
        expect(doc.activeElement).toBe(controls[1]);
        restoreToolbarFocus(root, 2, TOOLBAR_SEL_RISK); // the banner button
        expect(doc.activeElement).toBe(riskControls[0]);
        doc.activeElement = null;
        restoreToolbarFocus(root, -1); // nothing parked → no-op
        restoreToolbarFocus(root, 9);  // out of range → no-op
        expect(doc.activeElement).toBe(null);
        restoreToolbarFocus({}, 0);    // the no-querySelectorAll guard
        expect(doc.activeElement).toBe(null);
    });
});
