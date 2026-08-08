import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initDropdowns } from '../src/dropdown.js';

// The shared dropdown keyboard protocol (dropdown.js) — the exact contract
// the dupes toolbar selects follow. A native <select> hands its open-state
// keys to the browser, so this custom control defines its own:
//
//   trigger ↓/Enter/Space  open (focus moves to the current option)
//   trigger ↑              NOT intercepted — the toolbar rung walks it up
//   list ↑/↓               navigate (greyed options skipped)
//   list Home/End          jump to the first/last pickable option
//   list PageUp/PageDown   swallowed — never leak to the rows behind
//   list → (RTL ←)/Enter   pick + close, focus back on the trigger
//   list ← (RTL →)/Esc     close, keep the pick, focus back on trigger
//   list Tab               pick + close, browser moves focus out; a greyed
//                          current option closes WITHOUT picking (D10)
//   focus/pointer leaving  closes the open list (document focusout/mousedown)
//
// The element stubs model the real DOM tree (parentNode + children + closest),
// so the delegated listeners behave exactly as in the popup.

let doc;

const makeEl = (tag, classes = []) => {
    const set = new Set(classes);
    const node = {
        tagName: tag.toUpperCase(),
        children: [], parentNode: null, dataset: {}, hidden: false, focused: false,
        isConnected: true, // the stubs model elements sitting in the page
        _attrs: {}, _listeners: {}, _qs: {},
        classList: {
            add: c => set.add(c),
            remove: c => set.delete(c),
            contains: c => set.has(c)
        },
        get className() { return [...set].join(' '); },
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
        querySelector(sel) { return this._qs[sel] || null; },
        querySelectorAll(sel) {
            if (sel === 'li[data-value]')
                return this.children.filter(c => c.classList && c.classList.contains('li') && 'value' in c.dataset);
            if (sel.startsWith('li'))
                return this.children.filter(c => c.classList && c.classList.contains('li'));
            return [];
        },
        setAttribute(k, v) { this._attrs[k] = String(v); },
        getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
        contains(node2) { for (let n = node2; n; n = n.parentNode) if (n === this) return true; return false; },
        focus() { this.focused = true; doc.activeElement = this; }
    };
    return node;
};

// closest supporting '.class' and '.ancestor tag' along the parentNode chain
// (dropdown.js asks for '.vbm-dropdown-list li').
const wireClosest = node => {
    node.closest = sel => {
        const parts = sel.trim().split(/\s+/);
        for (let n = node; n; n = n.parentNode) {
            let ok = true;
            for (let i = parts.length - 1, cur = n; i >= 0 && cur; i--, cur = cur.parentNode) {
                const p = parts[i];
                if (p.startsWith('.')) {
                    if (!(cur.classList && cur.classList.contains(p.slice(1)))) { ok = false; break; }
                } else if (cur.tagName.toLowerCase() !== p.toLowerCase()) { ok = false; break; }
            }
            if (ok)
                return n;
        }
        return null;
    };
    return node;
};

const setup = (opts = {}) => {
    const container = makeEl('DIV');
    container.classList.add('dupes-list');
    // document stub: the 失焦即关 net (D3) registers focusout/mousedown here
    doc = {
        activeElement: null,
        _listeners: {},
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    };
    globalThis.document = doc;

    // window stub: the Esc-layering handler registers on window capture (it
    // must run before the popup's document-capture Escape chain).
    const windowEvents = {};
    globalThis.window = {
        _listeners: windowEvents,
        addEventListener(type, fn) {
            (windowEvents[type] = windowEvents[type] || []).push(fn);
        }
    };

    // a dropdown: trigger + a listbox of three options (one greyed)
    const dd = wireClosest(makeEl('DIV', ['vbm-dropdown', 'dupes-strategy']));
    const trigger = wireClosest(makeEl('BUTTON', ['vbm-dropdown-trigger']));
    const list = wireClosest(makeEl('UL', ['vbm-dropdown-list']));
    list.hidden = true;
    const opt1 = wireClosest(makeEl('LI', ['li'])); opt1.dataset.value = 'keep-oldest'; opt1.setAttribute('aria-selected', 'true');
    const opt2 = wireClosest(makeEl('LI', ['li'])); opt2.dataset.value = 'keep-newest';
    const opt3 = wireClosest(makeEl('LI', ['li', 'greyed'])); opt3.dataset.value = 'keep-most-visited';
    for (const o of [opt1, opt2, opt3]) {
        list.appendChild(o);
        o.classList.add('li');
    }
    dd.appendChild(trigger);
    dd.appendChild(list);
    container.appendChild(dd);

    dd._qs['.vbm-dropdown-trigger'] = trigger;
    dd._qs['.vbm-dropdown-list'] = list;
    list._qs['li:focus'] = null; // updated by focus tracking below
    list._qs['[aria-selected="true"]'] = opt1;

    // focus tracking for 'li:focus'
    for (const o of [opt1, opt2, opt3]) {
        const orig = o.focus.bind(o);
        o.focus = () => { list._qs['li:focus'] = o; orig(); };
    }

    const picks = [];
    const ddApi = initDropdowns(container, { onSelect: (d, v) => picks.push([d, v]), rtl: !!opts.rtl });

    const fire = (el, type, ev) => {
        for (const fn of (el._listeners[type] || []))
            fn.call(el, ev);
    };
    const key = (target, k, mods = {}) => {
        const ev = { key: k, target, ctrlKey: !!mods.ctrl, defaultPrevented: false, propagationStopped: false,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
        fire(container, 'keydown', ev); // delegated capture lives on container
        return ev;
    };
    const click = target => fire(container, 'click', { target });
    const fireWindow = (type, ev) => {
        for (const fn of (windowEvents[type] || []))
            fn.call(null, ev);
    };
    const fireDoc = (type, ev) => {
        for (const fn of (doc._listeners[type] || []))
            fn.call(doc, ev);
    };

    return { container, dd, trigger, list, opt1, opt2, opt3, picks, key, click,
        fireWindow, fireDoc, ddApi, isOpen: () => !list.hidden };
};

afterEach(() => {
    delete globalThis.window;
});

describe('dropdown keyboard protocol', () => {
    it('trigger ↓ opens the list and focuses the current option', () => {
        const ctx = setup({});
        ctx.trigger.focus();
        const ev = ctx.key(ctx.trigger, 'ArrowDown');
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.isOpen()).toBe(true);
        expect(doc.activeElement).toBe(ctx.opt1); // current pick focused
        expect(ctx.trigger.getAttribute('aria-expanded')).toBe('true');
    });

    it('trigger ↑ is NOT intercepted — the toolbar rung walks it up', () => {
        const ctx = setup({});
        ctx.trigger.focus();
        const ev = ctx.key(ctx.trigger, 'ArrowUp');
        expect(ev.defaultPrevented).toBe(false);
        expect(ev.propagationStopped).toBe(false); // bubbles to the rung
        expect(ctx.isOpen()).toBe(false);
    });

    it('list ↑/↓ navigate options, skipping the greyed one', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        ctx.key(ctx.opt1, 'ArrowDown');
        expect(doc.activeElement).toBe(ctx.opt2); // opt3 is greyed → skipped
        ctx.key(ctx.opt2, 'ArrowUp');
        expect(doc.activeElement).toBe(ctx.opt1);
    });

    it('list → picks, closes, focuses the trigger and reports onSelect', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        ctx.key(ctx.opt1, 'ArrowDown');    // to opt2
        const ev = ctx.key(ctx.opt2, 'ArrowRight');
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.isOpen()).toBe(false);
        expect(ctx.trigger.getAttribute('aria-expanded')).toBe('false');
        expect(doc.activeElement).toBe(ctx.trigger);
        expect(ctx.picks).toEqual([[ctx.dd, 'keep-newest']]);
    });

    it('Enter picks like →', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1 (current)
        ctx.key(ctx.opt1, 'Enter');
        expect(ctx.picks).toEqual([[ctx.dd, 'keep-oldest']]);
        expect(ctx.isOpen()).toBe(false);
        expect(doc.activeElement).toBe(ctx.trigger);
    });

    it('Space confirms the pick and closes (universal confirm key)', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        ctx.key(ctx.opt1, 'ArrowDown');    // to opt2
        const ev = ctx.key(ctx.opt2, ' ');
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.picks).toEqual([[ctx.dd, 'keep-newest']]);
        expect(ctx.isOpen()).toBe(false);
        expect(doc.activeElement).toBe(ctx.trigger);
    });

    it('list ← closes, keeps the current pick and refocuses the trigger', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        ctx.key(ctx.opt1, 'ArrowDown');    // to opt2
        const ev = ctx.key(ctx.opt2, 'ArrowLeft');
        expect(ev.defaultPrevented).toBe(true);
        expect(ctx.isOpen()).toBe(false);
        expect(ctx.picks).toEqual([]); // nothing picked — current stays
        expect(ctx.trigger.getAttribute('aria-expanded')).toBe('false');
        expect(doc.activeElement).toBe(ctx.trigger);
    });

    it('Esc closes like ←', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown');
        ctx.key(ctx.opt1, 'Escape');
        expect(ctx.isOpen()).toBe(false);
        expect(ctx.picks).toEqual([]);
        expect(doc.activeElement).toBe(ctx.trigger);
    });

    it('a greyed option cannot be picked (keep-most-visited needs stats on)', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        ctx.opt1.focus = () => {}; // force focus to the greyed opt3
        ctx.opt3.focus();
        ctx.key(ctx.opt3, 'Enter');
        expect(ctx.picks).toEqual([]); // refused, list stays open
        expect(ctx.isOpen()).toBe(true);
    });

    it('Tab picks and closes, letting the browser move focus out', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        const ev = ctx.key(ctx.opt1, 'Tab');
        expect(ctx.picks).toEqual([[ctx.dd, 'keep-oldest']]);
        expect(ctx.isOpen()).toBe(false);
        expect(ev.defaultPrevented).toBe(false); // browser takes over
    });

    it('RTL mirrors confirm/cancel (→ closes, ← picks)', () => {
        const ctx = setup({ rtl: true });
        ctx.key(ctx.trigger, 'ArrowDown'); // open
        ctx.key(ctx.opt1, 'ArrowDown');    // to opt2
        ctx.key(ctx.opt2, 'ArrowLeft');    // confirm in RTL
        expect(ctx.picks).toEqual([[ctx.dd, 'keep-newest']]);
        expect(ctx.isOpen()).toBe(false);
    });

    it('click on the trigger toggles; click on an option picks it', () => {
        const ctx = setup({});
        ctx.click(ctx.trigger);
        expect(ctx.isOpen()).toBe(true);
        ctx.opt2.focus();
        ctx.click(ctx.opt2);
        expect(ctx.picks).toEqual([[ctx.dd, 'keep-newest']]);
        expect(ctx.isOpen()).toBe(false);
    });

    it('clicking the toolbar outside an open dropdown closes it', () => {
        const ctx = setup({});
        const scheme = wireClosest(makeEl('LABEL', ['dupes-scheme']));
        ctx.container.appendChild(scheme);
        ctx.click(ctx.trigger); // open
        expect(ctx.isOpen()).toBe(true);
        ctx.click(scheme);      // another control — the open dropdown closes
        expect(ctx.isOpen()).toBe(false);
        expect(ctx.trigger.getAttribute('aria-expanded')).toBe('false');
        expect(ctx.picks).toEqual([]); // nothing picked — just dismissed
    });

    it('opening a second dropdown closes the first (one open per toolbar)', () => {
        const ctx = setup({});
        const dd2 = wireClosest(makeEl('DIV', ['vbm-dropdown', 'dupes-scope']));
        const trigger2 = wireClosest(makeEl('BUTTON', ['vbm-dropdown-trigger']));
        const list2 = wireClosest(makeEl('UL', ['vbm-dropdown-list']));
        list2.hidden = true;
        const o2 = wireClosest(makeEl('LI', ['li']));
        o2.dataset.value = 'all';
        o2.setAttribute('aria-selected', 'true');
        list2.appendChild(o2);
        o2.classList.add('li');
        dd2.appendChild(trigger2);
        dd2.appendChild(list2);
        ctx.container.appendChild(dd2);
        dd2._qs['.vbm-dropdown-trigger'] = trigger2;
        dd2._qs['.vbm-dropdown-list'] = list2;
        list2._qs['li:focus'] = null;
        list2._qs['[aria-selected="true"]'] = o2;
        const origFocus = o2.focus.bind(o2);
        o2.focus = () => { list2._qs['li:focus'] = o2; origFocus(); };

        ctx.click(ctx.trigger); // open strategy
        expect(ctx.isOpen()).toBe(true);
        ctx.click(trigger2);    // open scope — strategy closes
        expect(ctx.isOpen()).toBe(false);
        expect(list2.hidden).toBe(false);
        expect(ctx.dd.classList.contains('open')).toBe(false);
        expect(dd2.classList.contains('open')).toBe(true);
    });

    it('list Home/End jump to the first/last pickable option, skipping greyed (D2)', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        const end = ctx.key(ctx.opt1, 'End');
        expect(end.defaultPrevented).toBe(true);
        expect(end.propagationStopped).toBe(true); // never leaks to the rows
        expect(doc.activeElement).toBe(ctx.opt2); // opt3 is greyed → last pickable is opt2
        const home = ctx.key(ctx.opt2, 'Home');
        expect(home.defaultPrevented).toBe(true);
        expect(doc.activeElement).toBe(ctx.opt1);
    });

    it('list PageUp/PageDown are swallowed without moving focus (D2)', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        const pd = ctx.key(ctx.opt1, 'PageDown');
        expect(pd.defaultPrevented).toBe(true);
        expect(pd.propagationStopped).toBe(true);
        expect(doc.activeElement).toBe(ctx.opt1); // focus did not leave the list
        const pu = ctx.key(ctx.opt1, 'PageUp');
        expect(pu.defaultPrevented).toBe(true);
        expect(pu.propagationStopped).toBe(true);
        expect(ctx.isOpen()).toBe(true); // still open
    });

    it('Tab on a greyed current option closes WITHOUT picking (D10)', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open, focus opt1
        ctx.opt1.focus = () => {}; // force focus to the greyed opt3
        ctx.opt3.focus();
        const ev = ctx.key(ctx.opt3, 'Tab');
        expect(ctx.picks).toEqual([]); // nothing picked — cancel semantics
        expect(ctx.isOpen()).toBe(false); // but the list closes behind the Tab
        expect(ev.defaultPrevented).toBe(false); // the browser/Tab ring moves on
        expect(doc.activeElement).toBe(ctx.trigger); // trigger refocused first (pick-path parity)
    });

    it('focus leaving the dropdown closes it (D3: palette/dialog/view-switch, K8)', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open
        expect(ctx.isOpen()).toBe(true);
        // a view switch's focusDefault / the palette's input grab: focus lands
        // on something outside the open dropdown
        const outside = wireClosest(makeEl('INPUT'));
        ctx.fireDoc('focusout', { relatedTarget: outside });
        expect(ctx.isOpen()).toBe(false);
        expect(ctx.picks).toEqual([]); // dismissed, not picked
    });

    it('focus moving WITHIN the open dropdown keeps it open', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open
        ctx.fireDoc('focusout', { relatedTarget: ctx.opt2 }); // option ⇄ option/trigger
        expect(ctx.isOpen()).toBe(true);
        ctx.fireDoc('focusout', { relatedTarget: ctx.trigger });
        expect(ctx.isOpen()).toBe(true);
    });

    it('mousedown outside any dropdown closes the open one; inside keeps it (D3)', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown'); // open
        // inside (an option): the mousedown must not pre-empt the click pick
        ctx.fireDoc('mousedown', { target: ctx.opt2 });
        expect(ctx.isOpen()).toBe(true);
        // outside (the header, a tab, the search box — anything)
        const outside = wireClosest(makeEl('DIV'));
        ctx.fireDoc('mousedown', { target: outside });
        expect(ctx.isOpen()).toBe(false);
    });

    it('closeOpen() dismisses the open list imperatively (spare handle)', () => {
        const ctx = setup({});
        ctx.key(ctx.trigger, 'ArrowDown');
        expect(ctx.isOpen()).toBe(true);
        ctx.ddApi.closeOpen();
        expect(ctx.isOpen()).toBe(false);
        expect(ctx.trigger.getAttribute('aria-expanded')).toBe('false');
        ctx.ddApi.closeOpen(); // nothing open: a no-op, no throw
    });
});

// Esc layering: the dropdown registers on window capture so Escape closes an
// open listbox BEFORE the popup's document-capture Escape chain (keyboard.js)
// runs — otherwise Esc on an open dropdown would jump back to the tree.
describe('Esc layering (window capture)', () => {
    const esc = () => {
        const ev = { key: 'Escape', defaultPrevented: false, propagationStopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopImmediatePropagation() { this.propagationStopped = true; } };
        return ev;
    };

    it('Escape with a dropdown open closes it and swallows the key', () => {
        const ctx = setup({});
        ctx.click(ctx.trigger); // open
        expect(ctx.isOpen()).toBe(true);
        const ev = esc();
        ctx.fireWindow('keydown', ev);
        expect(ctx.isOpen()).toBe(false);
        expect(ev.defaultPrevented).toBe(true);
        expect(ev.propagationStopped).toBe(true); // keyboard.js never sees it
        expect(ctx.trigger.getAttribute('aria-expanded')).toBe('false');
        expect(doc.activeElement).toBe(ctx.trigger); // focus back on the trigger
    });

    it('Escape with no open dropdown passes through untouched', () => {
        const ctx = setup({});
        const ev = esc();
        ctx.fireWindow('keydown', ev);
        expect(ev.defaultPrevented).toBe(false);
        expect(ev.propagationStopped).toBe(false);
    });

    it('a stale openDd (detached by a re-render) never eats Esc (D4)', () => {
        const ctx = setup({});
        ctx.click(ctx.trigger); // open
        expect(ctx.isOpen()).toBe(true);
        ctx.dd.isConnected = false; // the toolbar re-rendered — the node is gone
        const ev = esc();
        ctx.fireWindow('keydown', ev);
        expect(ev.defaultPrevented).toBe(false); // the key passes to real layers
        expect(ev.propagationStopped).toBe(false);
        // the stale pointer was dropped: a second Esc passes through too
        const ev2 = esc();
        ctx.fireWindow('keydown', ev2);
        expect(ev2.defaultPrevented).toBe(false);
    });
});
