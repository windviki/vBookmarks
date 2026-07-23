/**
 * List keyboard navigation (v4 task 2) — shared by search/recent/stats/dead/dupes
 * list views. Provides arrow-key focus walking, view-specific key dispatch,
 * zone boundary crossing (↑ from first row → TabStrip, §2.1), F2/Delete common
 * keys, and → context menu / ← close semantics (§2.3).
 *
 * Usage:
 *   import { initListKeyboard } from './list-keyboard.js';
 *   const nav = initListKeyboard(containerElement, {
 *       onEnter(id, el) { ... },
 *       onDelete(id) { ... },
 *       onReveal(id) { ... },   // R key: reveal in tree
 *       onExtraKey(key, id) { ... },   // view-specific keys (M, K, etc.)
 *   });
 */

export function initListKeyboard(container, opts = {}) {
    if (!container) return {};

    const getRows = () => container.querySelectorAll('li:not(.empty-state)');
    const getFocusables = () => {
        const rows = getRows();
        const items = [];
        for (const li of rows) {
            const a = li.querySelector('a, span[tabindex], [role="button"]');
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
        // Check if active is inside a focused li
        if (active) {
            const li = active.closest('li');
            if (li) {
                const a = li.querySelector('a, span[tabindex], [role="button"]');
                for (let i = 0; i < items.length; i++) {
                    if (items[i] === a) return i;
                }
            }
        }
        return -1;
    };

    const getFocusedRowId = () => {
        const active = container.querySelector('.focus') || document.activeElement;
        if (!active) return '';
        const li = active.closest('li');
        return li ? (li.dataset.nodeId || (li.id || '').replace(/^(neat-recent|neat-tree|results)-item-/, '')) : '';
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

        const key = e.key;
        const id = getFocusedRowId();

        switch (key) {
            case 'ArrowDown':
                e.preventDefault();
                moveFocus(1);
                break;
            case 'ArrowUp': {
                e.preventDefault();
                const items = getFocusables();
                const idx = getCurrentIndex();
                if (idx <= 0) {
                    // Zone boundary crossing: ↑ from first row → TabStrip (§2.1)
                    const tabBar = document.getElementById('view-tabs');
                    if (tabBar && tabBar.style.display !== 'none') {
                        const activeTab = tabBar.querySelector('[aria-selected="true"]') || tabBar.querySelector('[role="tab"]');
                        if (activeTab) {
                            setFocus(null); // clear list focus
                            activeTab.focus();
                            return;
                        }
                    }
                    // Fallback: focus search input
                    const searchInput = document.getElementById('search-input');
                    if (searchInput) searchInput.focus();
                    return;
                }
                moveFocus(-1);
                break;
            }
            case 'Home':
                e.preventDefault();
                { const items = getFocusables(); if (items.length) setFocus(items[0]); }
                break;
            case 'End':
                e.preventDefault();
                { const items = getFocusables(); if (items.length) setFocus(items[items.length - 1]); }
                break;
            case 'PageDown':
                e.preventDefault();
                { const items = getFocusables(); if (items.length) setFocus(items[Math.min(getCurrentIndex() + 10, items.length - 1)]); }
                break;
            case 'PageUp':
                e.preventDefault();
                { const items = getFocusables(); if (items.length) setFocus(items[Math.max(getCurrentIndex() - 10, 0)]); }
                break;
            case 'Enter':
            case ' ':
                e.preventDefault();
                {
                    const active = container.querySelector('.focus') || document.activeElement;
                    if (active && container.contains(active)) {
                        if (opts.onEnter) {
                            const li = active.closest('li');
                            const rowId = li ? (li.dataset.nodeId || (li.id || '').replace(/^(neat-recent|neat-tree|results)-item-/, '')) : '';
                            opts.onEnter(rowId, active);
                        } else {
                            active.click();
                        }
                    }
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                // → opens context menu on focused row (§2.3)
                {
                    const active = container.querySelector('.focus') || document.activeElement;
                    if (active && container.contains(active)) {
                        const el = active.closest('li') ? active.closest('li').querySelector('a, span') : active;
                        if (el) {
                            const rect = el.getBoundingClientRect();
                            el.dispatchEvent(new MouseEvent('contextmenu', {
                                bubbles: true, cancelable: true, view: window,
                                clientX: rect.right, clientY: rect.bottom
                            }));
                        }
                    }
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                // ← closes context menu if open, otherwise no-op in flat lists
                {
                    const active = document.body.querySelector('.active');
                    if (active) {
                        active.classList.remove('active');
                        active.focus();
                    }
                    // Dispatch Escape to close context menu
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                }
                break;
            case 'F2':
                // F2 rename (non-Mac, §2.3)
                e.preventDefault();
                if (id && opts.onF2) opts.onF2(id);
                break;
            case 'Delete':
                e.preventDefault();
                if (id && opts.onDelete) opts.onDelete(id);
                break;
            case 'r':
            case 'R':
                // Reveal in tree (§2.3 view-specific)
                e.preventDefault();
                if (id && opts.onReveal) opts.onReveal(id);
                break;
            default:
                // View-specific keys (§2.3): M, K, etc.
                if (key.length === 1 && opts.onExtraKey) {
                    const consumed = opts.onExtraKey(key, id);
                    if (consumed) e.preventDefault();
                }
                break;
        }
    });

    // Click to set focus
    container.addEventListener('click', e => {
        const a = e.target.closest('a, span, li');
        if (a && container.contains(a)) {
            const focusTarget = a.tagName === 'LI' ? a.querySelector('a, span') : a;
            if (focusTarget) setFocus(focusTarget);
        }
    });

    return { moveFocus, setFocus, getFocusables, getFocusedRowId };
}
