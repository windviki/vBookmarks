import { describe, it, expect, beforeAll } from 'vitest';
import { initDropdowns } from '../src/dropdown.js';

// The shared dropdown keyboard protocol (dropdown.js) — the exact contract
// the dupes toolbar selects follow. A native <select> hands its open-state
// keys to the browser, so this custom control defines its own:
//
//   trigger ↓/Enter/Space  open (focus moves to the current option)
//   trigger ↑              NOT intercepted — the toolbar rung walks it up
//   list ↑/↓               navigate (greyed options skipped)
//   list → (RTL ←)/Enter   pick + close, focus back on the trigger
//   list ← (RTL →)/Esc     close, keep the pick, focus back on trigger
//   list Tab               pick + close, browser moves focus out
//
// The element stubs model the real DOM tree (parentNode + children + closest),
// so the delegated listeners behave exactly as in the popup.

let doc;

const makeEl = (tag, classes = []) => {
    const set = new Set(classes);
    const node = {
        tagName: tag.toUpperCase(),
        children: [], parentNode: null, dataset: {}, hidden: false, focused: false,
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
    doc = { activeElement: null };
    globalThis.document = doc;

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
    initDropdowns(container, { onSelect: (d, v) => picks.push([d, v]), rtl: !!opts.rtl });

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

    return { container, dd, trigger, list, opt1, opt2, opt3, picks, key, click, isOpen: () => !list.hidden };
};

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
});
