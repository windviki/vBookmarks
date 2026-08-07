/**
 * Shared custom dropdown (select replacement) — P3.
 *
 * A native <select> hands its open-state keyboard to the browser, so it could
 * not follow the popup's arrow contract (↑ leaves the rung, ↓ opens, → picks,
 * ← cancels). The dupes toolbar's strategy/scope selects are replaced by this
 * component: a trigger <button> showing the current value plus a hidden
 * <ul role="listbox"> of options. The keyboard protocol is the same for every
 * dropdown, so any future select (dead proxy, stats, …) reuses it verbatim:
 *
 *   Trigger (closed):
 *     ↓ / Enter / Space   open the list, focus moves to the current option
 *     ↑                   NOT intercepted — the toolbar-rung arrow law walks
 *                         it to the toolbar/strip/box above
 *   List (open):
 *     ↑ / ↓               navigate options (greyed options are skipped)
 *     → (RTL: ←) / Enter / Space   pick the focused option, close, focus back
 *                         on the trigger
 *     ← (RTL: →) / Esc    close, keep the current pick, focus back on trigger
 *     Tab                 pick + close, then move out with the browser
 *   Click: trigger toggles; an option row picks it.
 *
 * initDropdowns(container, { onSelect, rtl }) binds one delegated listener
 * (capture, so the ↓-open wins over the toolbar rung) and works with any
 * `.vbm-dropdown` markup inside `container`. The markup contract:
 *
 *     <div class="vbm-dropdown my-dropdown">
 *         <button type="button" class="vbm-dropdown-trigger" aria-haspopup="listbox"
 *                 aria-expanded="false">…value…</button>
 *         <ul class="vbm-dropdown-list" role="listbox" hidden>
 *             <li role="option" tabindex="-1" data-value="x" aria-selected="true">X</li>
 *         </ul>
 *     </div>
 *
 * Greyed (unpickable) options carry class `greyed`. onSelect receives the
 * dropdown element and the chosen data-value; the caller persists + re-renders.
 */
export function initDropdowns(container, { onSelect, rtl } = {}) {
    const isRtl = !!rtl;

    const find = dd => ({
        trigger: dd.querySelector('.vbm-dropdown-trigger'),
        list: dd.querySelector('.vbm-dropdown-list')
    });

    const options = list => [...(list ? list.querySelectorAll('li[data-value]') : [])];

    // The single open dropdown in this container, if any. Kept here (not by
    // re-querying) so an outside click or a second trigger knows what to
    // close; the toolbar re-renders on every change, so the pointer may go
    // stale — that is harmless (the detached element just closes itself).
    let openDd = null;

    const open = dd => {
        // One open dropdown per toolbar: opening one closes any other.
        if (openDd && openDd !== dd)
            close(openDd, false);
        openDd = dd;
        const { trigger, list } = find(dd);
        if (!list)
            return;
        trigger.setAttribute('aria-expanded', 'true');
        list.hidden = false;
        dd.classList.add('open');
        const cur = list.querySelector('[aria-selected="true"]') || options(list)[0];
        (cur || list).focus();
    };

    const close = (dd, keepFocus) => {
        if (openDd === dd)
            openDd = null;
        const { trigger, list } = find(dd);
        if (!list)
            return;
        list.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        dd.classList.remove('open');
        if (keepFocus)
            trigger.focus();
    };

    const pick = dd => {
        const { trigger, list } = find(dd);
        const cur = list.querySelector('li:focus') || list.querySelector('[aria-selected="true"]')
            || options(list)[0];
        if (!cur || cur.classList.contains('greyed'))
            return; // a greyed option is unpickable — keep the list open
        const value = cur.dataset.value;
        if (onSelect)
            onSelect(dd, value);
        close(dd, true);
    };

    const nav = (dd, delta) => {
        const { list } = find(dd);
        const items = options(list);
        if (!items.length)
            return;
        const cur = list.querySelector('li:focus') || list.querySelector('[aria-selected="true"]');
        let idx = items.indexOf(cur);
        if (idx < 0)
            idx = delta > 0 ? -1 : 0;
        let next = idx;
        do {
            next = (next + delta + items.length) % items.length;
        } while (items[next].classList.contains('greyed') && next !== idx);
        items[next].focus();
    };

    container.addEventListener('click', e => {
        const dd = e.target.closest('.vbm-dropdown');
        if (!dd) {
            // Clicking the toolbar outside an open dropdown closes it — a
            // pick closes its own; this covers changing your mind and hitting
            // another control (scheme checkbox, apply-all, …) instead.
            if (openDd)
                close(openDd, false);
            return;
        }
        if (e.target.closest('.vbm-dropdown-trigger')) {
            const isOpen = dd.classList.contains('open');
            close(dd, isOpen);
            if (!isOpen)
                open(dd);
        } else if (e.target.closest('.vbm-dropdown-list li')) {
            pick(dd);
        }
    });

    // Capture: the trigger's ↓ must win over the toolbar-rung arrow handler,
    // and the open list's ↑↓ must not re-enter the rung.
    container.addEventListener('keydown', e => {
        const dd = e.target.closest('.vbm-dropdown');
        if (!dd)
            return;
        const { trigger, list } = find(dd);
        const inTrigger = e.target === trigger;
        const inList = list.contains(e.target);
        if (inTrigger && !dd.classList.contains('open')) {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                open(dd);
            }
            // ArrowUp deliberately falls through to the toolbar rung.
            return;
        }
        if (!inList)
            return;
        const confirmKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
        const cancelKey = isRtl ? 'ArrowRight' : 'ArrowLeft';
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault(); e.stopPropagation(); nav(dd, 1); break;
            case 'ArrowUp':
                e.preventDefault(); e.stopPropagation(); nav(dd, -1); break;
            case confirmKey:
            case 'Enter':
            case ' ': // Enter/Space confirm the pick + close, Esc cancels
                e.preventDefault(); e.stopPropagation(); pick(dd); break;
            case cancelKey:
            case 'Escape':
                e.preventDefault(); e.stopPropagation(); close(dd, true); break;
            case 'Tab':
                pick(dd); break; // pick + close, browser moves focus out
        }
    }, true);

    // Esc layering: with a dropdown open, Escape must close it before the
    // popup's own layer chain runs — otherwise Esc on an open listbox would
    // jump back to the tree or close the popup (keyboard.js's Escape chain is
    // a document-capture handler that calls stopImmediatePropagation, so it
    // swallows everything at or below document). Window capture always runs
    // before ANY document listener regardless of registration order, so this
    // sits one ring earlier and wins the first look at Esc. The container's
    // own Escape case stays for list-focused keys (and the jsdom-less tests).
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || !openDd)
                return;
            e.preventDefault();
            e.stopImmediatePropagation();
            close(openDd, true);
        }, true);
    }
}
