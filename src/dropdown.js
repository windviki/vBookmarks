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
 *     Home / End          jump to the first / last pickable option
 *     PageUp / PageDown   swallowed (preventDefault) — never leak to the rows
 *     → (RTL: ←) / Enter / Space   pick the focused option, close, focus back
 *                         on the trigger
 *     ← (RTL: →) / Esc    close, keep the current pick, focus back on trigger
 *     Tab                 pick + close, then move out with the browser; a
 *                         greyed current option closes WITHOUT picking (the
 *                         ←/Esc cancel semantics) — the list never stays open
 *                         while focus walks away
 *   Click: trigger toggles; an option row picks it.
 *
 * An open listbox closes itself when it loses focus or the pointer lands
 * anywhere outside a dropdown (document focusout / mousedown) — one
 * mechanism covering palette/dialog opens, view switches and plain outside
 * clicks (the listbox must never float over a layer above it or outlive the
 * view that owns it, D3/D4). initDropdowns returns { closeOpen() } as a
 * spare imperative handle.
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
    // stale — the window Esc handler guards with isConnected, and the next
    // close() simply runs on the detached element.
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
        const cur = currentOf(dd);
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

    // Home/End jump to the first/last PICKABLE option (greyed skipped) — the
    // APG listbox contract, and it keeps the keys from leaking to the rows
    // behind the open list (D2).
    const navEdge = (dd, fromEnd) => {
        const { list } = find(dd);
        const items = options(list);
        for (let i = 0, l = items.length; i < l; i++) {
            const it = items[fromEnd ? l - 1 - i : i];
            if (!it.classList.contains('greyed')) {
                it.focus();
                return;
            }
        }
    };

    // The focused option (pick's resolution order), so Tab can tell a greyed
    // current option apart from a pickable one.
    const currentOf = dd => {
        const { list } = find(dd);
        return list.querySelector('li:focus') || list.querySelector('[aria-selected="true"]')
            || options(list)[0] || null;
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
            case 'Home':
                e.preventDefault(); e.stopPropagation(); navEdge(dd, false); break;
            case 'End':
                e.preventDefault(); e.stopPropagation(); navEdge(dd, true); break;
            case 'PageUp':
            case 'PageDown':
                // Swallowed: the open list must not let these reach the rows
                // behind it (focus would jump while the listbox stays open).
                e.preventDefault(); e.stopPropagation(); break;
            case confirmKey:
            case 'Enter':
            case ' ': // Enter/Space confirm the pick + close, Esc cancels
                e.preventDefault(); e.stopPropagation(); pick(dd); break;
            case cancelKey:
            case 'Escape':
                e.preventDefault(); e.stopPropagation(); close(dd, true); break;
            case 'Tab':
                // A greyed current option is unpickable: close WITHOUT
                // picking (the ←/Esc cancel semantics, D10) — otherwise the
                // list stayed open while the Tab ring moved focus away.
                if (currentOf(dd)?.classList.contains('greyed'))
                    close(dd, true);
                else
                    pick(dd);
                break; // either way the browser/Tab ring moves focus out
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
    //
    // A re-render can swap the toolbar's innerHTML while the list is open:
    // openDd then points at a DETACHED node (D4). Eating Esc for it would
    // steal the key from every real layer below — drop the stale pointer and
    // let the key pass instead.
    if (typeof window !== 'undefined' && window.addEventListener) {
        window.addEventListener('keydown', e => {
            if (e.key !== 'Escape' || !openDd)
                return;
            if (!openDd.isConnected) {
                openDd = null;
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            close(openDd, true);
        }, true);
    }

    // "失焦即关" (D3): focus or pointer landing anywhere outside a dropdown
    // closes the open one. This single mechanism covers every path that used
    // to leave a listbox floating over another layer — palette opens (Ctrl+K
    // moves focus to the palette input), dialog opens, view switches
    // (focusDefault moves focus, K8) and plain outside clicks. Focus moving
    // WITHIN the same dropdown (trigger ⇄ options) keeps it open, as does a
    // click inside any dropdown.
    if (typeof document !== 'undefined' && document.addEventListener) {
        document.addEventListener('focusout', e => {
            if (!openDd)
                return;
            if (e.relatedTarget && openDd.contains(e.relatedTarget))
                return;
            close(openDd, false);
        });
        document.addEventListener('mousedown', e => {
            if (!openDd)
                return;
            if (e.target && e.target.closest && e.target.closest('.vbm-dropdown'))
                return;
            close(openDd, false);
        });
    }

    return {
        // Spare imperative handle (view deactivation, external layers) —
        // the focusout/mousedown net above covers every current path.
        closeOpen: () => {
            if (openDd)
                close(openDd, false);
        }
    };
}
