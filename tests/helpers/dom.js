// Shared DOM/storage doubles for the vitest suites (batch A — test
// infrastructure). The popup/options code touches a small, well-known slice
// of the DOM (textContent/innerText, innerHTML, classList, style.display,
// hidden, value, listeners); these stubs cover it uniformly so suites stop
// hand-rolling slightly different versions. New tests should use these;
// existing suites migrate when they are next rewritten.

export const makeClassList = () => {
    const set = new Set();
    return {
        add: (...cs) => cs.forEach(c => set.add(c)),
        remove: (...cs) => cs.forEach(c => set.delete(c)),
        contains: c => set.has(c),
        toggle: (c, on) => (on ? set.add(c) : set.delete(c)),
        _set: set
    };
};

// A DOM element stub. `hidden`/`checked`/`value`/`display` let a suite match
// the HTML/CSS defaults (a `hidden` attribute, `#donation { display:none }`),
// so the stub's initial state mirrors the real page.
export const makeEl = (id = '', tagName = 'DIV', { hidden = false, checked = false, value = '', display = null } = {}) => {
    let text = '';
    return {
        id,
        tagName: (tagName || 'DIV').toUpperCase(),
        value,
        checked,
        hidden,
        disabled: false,
        focused: false,
        title: '',
        href: '',
        dataset: {},
        style: display === null ? {} : { display },
        _innerHTML: '',
        children: [],
        parentNode: null,
        _listeners: {},
        // textContent and innerText are aliases — code writes innerText for
        // labels and textContent for dynamic text; assertions read either.
        get textContent() { return text; },
        set textContent(v) { text = v; },
        get innerText() { return text; },
        set innerText(v) { text = v; },
        get innerHTML() { return this._innerHTML; },
        set innerHTML(v) {
            this._innerHTML = v;
            if (v === '')
                this.children = [];
        },
        classList: makeClassList(),
        addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
        fire(type, ev = {}) { (this._listeners[type] || []).forEach(fn => fn(ev)); },
        appendChild(child) { this.children.push(child); child.parentNode = this; },
        focus() { this.focused = true; },
        select() {},
        // minimal selector surface: first child by tag, else null
        querySelector(sel) {
            const want = sel.toUpperCase();
            for (const c of this.children)
                if (c.tagName === want) return c;
            return this._qs ? this._qs[sel] || null : null;
        },
        querySelectorAll() { return []; }
    };
};

// A store double backing get/set/remove and the sync-area accessors over one
// plain map — matches the store.js surface the popup/options code uses.
export const makeStoreDouble = (data = {}) => {
    const map = new Map(Object.entries(data));
    return {
        map,
        get: (k, dflt) => (map.has(k) ? map.get(k) : dflt),
        set: (k, v) => map.set(k, v),
        remove: k => map.delete(k),
        ready: Promise.resolve(),
        getSyncSetting: (k, dflt) => (map.has(k) ? map.get(k) : dflt),
        setSyncSetting: (k, v) => map.set(k, v)
    };
};
