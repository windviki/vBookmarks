/**
 * List keyboard navigation (v4 task 2) — shared by search/recent/stats/dead/dupes
 * list views. Provides arrow-key focus walking and click dispatch, matching
 * the tree view's keyboard behaviour.
 *
 * Usage:
 *   import { initListKeyboard } from './list-keyboard.js';
 *   const nav = initListKeyboard(containerElement, {
 *       onEnter(id, el) { ... }  // called when Enter/Space pressed on a row
 *   });
 *   // nav is auto-bound; just call it once per view init.
 */

export function initListKeyboard(container, opts = {}) {
    if (!container) return {};

    const getRows = () => container.querySelectorAll('li:not(.empty-state)');
    const getFocusables = () => {
        const rows = getRows();
        const items = [];
        for (const li of rows) {
            const a = li.querySelector('a, span[tabindex]');
            if (a && li.offsetHeight) items.push(a);
        }
        return items;
    };

    const setFocus = (el) => {
        const prev = container.querySelector('.focus');
        if (prev) prev.classList.remove('focus');
        if (el) {
            el.classList.add('focus');
            el.focus();
        }
    };

    const getCurrentIndex = () => {
        const items = getFocusables();
        const active = container.querySelector('.focus') || document.activeElement;
        for (let i = 0; i < items.length; i++) {
            if (items[i] === active) return i;
        }
        return -1;
    };

    const moveFocus = (delta) => {
        const items = getFocusables();
        if (!items.length) return;
        let idx = getCurrentIndex();
        if (idx < 0) {
            idx = delta > 0 ? 0 : items.length - 1;
        } else {
            idx = (idx + delta + items.length) % items.length;
        }
        setFocus(items[idx]);
    };

    container.addEventListener('keydown', e => {
        const tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                moveFocus(1);
                break;
            case 'ArrowUp':
                e.preventDefault();
                moveFocus(-1);
                break;
            case 'Home':
                e.preventDefault();
                { const items = getFocusables(); if (items.length) setFocus(items[0]); }
                break;
            case 'End':
                e.preventDefault();
                { const items = getFocusables(); if (items.length) setFocus(items[items.length - 1]); }
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                {
                    const active = container.querySelector('.focus') || document.activeElement;
                    if (active && container.contains(active)) {
                        if (opts.onEnter) {
                            const li = active.closest('li');
                            const id = li ? (li.id || '').replace(/^(neat-recent|neat-tree|results)-item-/, '') : '';
                            opts.onEnter(id, active);
                        } else {
                            active.click();
                        }
                    }
                }
                break;
        }
    });

    // Click to set focus
    container.addEventListener('click', e => {
        const a = e.target.closest('a, span');
        if (a && container.contains(a)) {
            setFocus(a);
        }
    });

    return { moveFocus, setFocus, getFocusables };
}
