/**
 * View manager (v4 task-2, slice A) — the tab/view layer of the popup.
 *
 * The popup's content area becomes a browser-style tab container: a
 * `#view-tabs` strip (role=tablist) above a `#views` stack with one
 * `<section id="view-<id>">` per view. Exactly one view is active at a time;
 * switching deactivates the old view (deactivate hook + scroll save), hides
 * its section, shows and activates the new one (activate hook + scroll/focus
 * restore), and persists `activeView`.
 *
 * ViewDef (docs/v4task-2.md §3.1):
 *   id          — 'tree' | 'search' | 'recent' | 'stats' | 'dead' | 'dupes'
 *   titleKey    — i18n key for the tab label / aria-label
 *   icon        — inline SVG (src/icons.js VIEW_ICONS)
 *   container   — the view's root section element
 *   listEl      — optional scrollable list container (keyboard registration,
 *                 scroll persistence, default focus target)
 *   hidden      — optional; hidden views keep their registration but render
 *                 no tab and refuse activation (showRecentBookmarks off)
 *   typeAhead   — optional, default true; list views without type-ahead
 *                 (dead/dupes) set false so letter keys stay view-local
 *   persistScroll — optional; scrollTop saved into the `viewState` JSON key
 *   badge()     — optional tab badge count (0/undefined hides the dot)
 *   activate({ keepFocus, preset }) — optional enter hook (render/refresh);
 *                   preset is the palette custom-command view-preset channel
 *                   (v4 task-4 #6), views that don't know it ignore it
 *   deactivate()            — optional leave hook
 *   onEscape()    — optional view-local Escape consumer; return true when
 *                   the key was consumed (dead scan abort, …)
 *   onKey(e)      — optional view-local letter-key consumer (M/R/K,
 *                   docs/v4task-2-list.md §2.3); keyboard.js consults it in
 *                   the treeKeyDown default branch, before the type-ahead
 *                   gate. Return true when the key was consumed.
 *   focus()       — optional default focus target (search focuses the input)
 *
 * The two structural views (tree/search) are registered here at init because
 * their sections are static markup in popup.html/sidepanel.html; their
 * behavior hooks arrive later via attach() from search.js. Feature views
 * (recent/stats/dead/dupes) register() dynamically from their own modules.
 *
 * Also owns the cross-view shared state: the id → parent-path map (rebuilt
 * from every tree regeneration through buildPathMap, read by list rows via
 * pathOf), the Escape chain view levels (onEscapeActive/escapeToTree), the
 * Ctrl/Cmd+1…6 direct view jump, the tab strip keyboard model (roving
 * tabindex, ←/→ with RTL flip, Home/End, ↑ to the search box, ↓ into the
 * zone below — the active view's in-list toolbar rung when it has one, else
 * its rows, keyboard-model §2.1/§2.5) and the aria-live view announcements.
 *
 * initViewManager(ctx) is called once by neat.js right after the context
 * menus init (search.js needs it at init): ctx.store, ctx.isPanel,
 * ctx.rtl, ctx.clearMenu (view switches dismiss open menus). document/
 * chrome remain page globals.
 */

import { VIEW_ICONS } from './icons.js';
import { buildPathMap as computePathMap } from './tree-render.js';

export function initViewManager(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const isPanel = !!ctx.isPanel;
    const rtl = !!ctx.rtl;
    const body = document.body;
    // context-menu.js's clearMenu (optional; neat.js injects it): switching
    // views must not leave a menu floating over the outgoing view's rows.
    const clearMenu = ctx.clearMenu || (() => {});

    const $tabs = $('view-tabs');
    const $announce = $('view-announce');
    const searchInput = $('search-input');

    const registry = []; // ViewDef array; order = tab order, tree stays [0]
    const byId = {};
    let activeId = null;
    // A stored startup view id whose view has not registered yet (feature
    // views init after the manager) — register() fires it when it lands.
    let pendingRestore = null;
    let pathMap = {};
    let firstActivation = true;

    // --- Tab strip -----------------------------------------------------------
    // showViewTabs (default on): hiding the strip is the quiet-mode escape
    // hatch — views stay reachable through palette slash commands and
    // Ctrl/Cmd+number (docs/v4task-2.md §3.2 v3).
    const tabsVisible = () => !!store.get('showViewTabs', '1');
    body.classList.toggle('no-view-tabs', !tabsVisible());

    const visibleViews = () => registry.filter(v => !v.hidden);

    const placeIndicator = () => {
        const indicator = $tabs.querySelector('.tab-indicator');
        if (!indicator)
            return;
        const def = byId[activeId];
        const tab = def && def.tabEl;
        if (!tab) {
            indicator.style.opacity = '0';
            return;
        }
        indicator.style.opacity = '1';
        indicator.style.width = `${tab.offsetWidth}px`;
        indicator.style.transform = `translateX(${tab.offsetLeft}px)`;
    };

    const updateBadges = () => {
        // v4 task-3 #18: the compulsive-mode switch — every badge hidden
        // regardless of counts when the user opts out (default on).
        const show = !!store.get('showTabBadges', '1');
        for (let i = 0, l = registry.length; i < l; i++) {
            const def = registry[i];
            if (!def.tabEl)
                continue;
            const badge = def.tabEl.querySelector('.tab-badge');
            if (!badge)
                continue;
            const n = show && def.badge ? (def.badge() | 0) : 0;
            badge.hidden = !(n > 0);
            if (n > 0)
                badge.textContent = `${n}`;
        }
    };

    const renderTabs = () => {
        $tabs.innerHTML = '';
        const views = visibleViews();
        for (let i = 0, l = views.length; i < l; i++) {
            const def = views[i];
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = `view-tab-${def.id}`;
            btn.className = 'view-tab';
            btn.setAttribute('role', 'tab');
            btn.setAttribute('aria-selected', def.id === activeId ? 'true' : 'false');
            btn.tabIndex = def.id === activeId ? 0 : -1;
            const label = _m(def.titleKey) || def.id;
            btn.title = label;
            btn.setAttribute('aria-label', label);
            // The icon is a trusted constant from icons.js; the label goes
            // through textContent (locale text).
            const iconSpan = document.createElement('span');
            iconSpan.className = 'tab-icon';
            iconSpan.innerHTML = def.icon;
            const labelSpan = document.createElement('span');
            labelSpan.className = 'tab-label';
            labelSpan.textContent = label;
            const badge = document.createElement('span');
            badge.className = 'tab-badge';
            badge.hidden = true;
            btn.appendChild(iconSpan);
            btn.appendChild(labelSpan);
            btn.appendChild(badge);
            // Mouse and keyboard (Enter/Space on the roving tab) both land
            // here; focus stays on the tab strip — ↓ enters the list.
            btn.addEventListener('click', () => activate(def.id, { focusTab: true }));
            $tabs.appendChild(btn);
            def.tabEl = btn;
        }
        const indicator = document.createElement('div');
        indicator.className = 'tab-indicator';
        $tabs.appendChild(indicator);
        updateBadges();
        placeIndicator();
    };

    // Track popup resizes so the sliding indicator stays under the active tab.
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(placeIndicator).observe($tabs);
    }

    // --- Registration --------------------------------------------------------
    // §2.1 region focus memory relies on a LIVE `.focus` marker in every list
    // view: a mouse click on a view tab moves DOM focus to the button before
    // activate() runs, so the switch-away path can only consult the marker.
    // (The tree has always maintained its own marker; this generalizes it.)
    // The focused row's a/span carries the marker — or the tabindex row
    // container itself (the dead view's start row); in-list toolbar controls
    // keep their focus unmarked.
    const bindFocusMarker = def => {
        if (!def.listEl || def.focusMarkerBound)
            return;
        def.focusMarkerBound = true;
        def.listEl.addEventListener('focusin', e => {
            const t = e.target;
            if (!t || t === def.listEl)
                return;
            const isRowFocus = /^(A|SPAN)$/.test(t.tagName)
                || (t.tagName === 'LI' && t.getAttribute && t.getAttribute('tabindex') !== null);
            if (!isRowFocus)
                return;
            const old = def.listEl.querySelector('.focus');
            if (old && old !== t)
                old.classList.remove('focus');
            t.classList.add('focus');
        });
    };

    const register = def => {
        if (byId[def.id]) {
            Object.assign(byId[def.id], def);
            bindFocusMarker(byId[def.id]);
            renderTabs();
            return byId[def.id];
        }
        registry.push(def);
        byId[def.id] = def;
        bindFocusMarker(def);
        renderTabs();
        // A stored startup view that registered late (feature views init
        // after the manager) takes over as soon as it lands.
        if (pendingRestore === def.id) {
            pendingRestore = null;
            if (!def.hidden)
                activate(def.id, { keepFocus: true });
        }
        return def;
    };

    // Attach behavior hooks to an already-registered view (search.js wires
    // its render/focus hooks into the structural 'search' view this way).
    const attach = (id, hooks) => {
        if (byId[id])
            Object.assign(byId[id], hooks);
    };

    // --- Focus ---------------------------------------------------------------
    // Row-focus landing inside a list: the remembered `.focus` row first,
    // then the first focusable row. `li[tabindex]` covers focusable row
    // containers without an inner a/span (the dead view's start row).
    const ROW_SEL = 'li a, li span, li[tabindex]';
    const focusDefault = def => {
        if (!def)
            return;
        if (def.focus) {
            def.focus();
            return;
        }
        if (!def.listEl)
            return;
        const row = def.listEl.querySelector('.focus')
            || def.listEl.querySelector(ROW_SEL);
        if (row) {
            row.focus();
            return;
        }
        // The view's activate hook may render its rows asynchronously (stats
        // probes history, dead reads the scan cache), so focusDefault can find
        // nothing yet. Focus the list container itself — the arrow keys then
        // land in the NEW view (↑ back to the strip/box, ↓ into the rows once
        // they render) instead of stranding focus in the old spot. Regression:
        // Ctrl+number switched the view but ↑/↓ stayed dead on the old focus.
        if (def.listEl && def.listEl.focus)
            def.listEl.focus();
    };

    // v4 task-3 #12: the search box's ↓ needs "the active view's first row"
    // without knowing which view that is — used to hardcode the tree and
    // lose focus into the hidden list on recent/stats/dead/dupes.
    const focusActive = () => focusDefault(byId[activeId]);

    // The ↑ crossing out of a list's first row (v4task-2-list §2.1): with the
    // strip visible the current tab takes focus (a second ↑ reaches the
    // search box); with the strip hidden the search box is the target
    // directly — today's behavior.
    const focusTop = () => {
        const def = byId[activeId];
        if (tabsVisible() && def && def.tabEl) {
            def.tabEl.focus();
            return;
        }
        if (searchInput)
            searchInput.focus();
    };

    // --- In-list toolbar rung (keyboard-model §2.5, final-polish revision) ----
    // The stats/dead/dupes toolbars sit VISUALLY between the strip and the
    // rows, so the naive layout correspondence makes them an arrow rung:
    // strip ↓ lands on the first enabled control, ↑ past the first row lands
    // here too, and the rung's own ↑/↓/←/→ live in keyboard.js. Views
    // without a toolbar (tree/search/recent) skip the rung transparently.
    // v4 task-4 #13: a view may stack MULTIPLE toolbars (the dead view's
    // proxy strip above its scan toolbar) — each is its own rung in DOM
    // order, and rungs without an enabled control are skipped.
    const toolbarRungs = def => {
        if (!def || !def.container || !def.container.querySelectorAll)
            return [];
        const rungs = [];
        const bars = def.container.querySelectorAll('.vbm-toolbar');
        for (let b = 0, bl = bars.length; b < bl; b++) {
            const controls = [];
            const all = bars[b].querySelectorAll('button, select, input');
            for (let i = 0, l = all.length; i < l; i++) {
                const c = all[i];
                if (c.disabled)
                    continue;
                // keyboard.js tabCycle's visibility contract: doubles without
                // layout APIs count as visible (tests).
                if (typeof c.getClientRects === 'function' && c.getClientRects().length === 0)
                    continue;
                controls.push(c);
            }
            if (controls.length)
                rungs.push(controls);
        }
        return rungs;
    };
    // last=false → the topmost rung (the strip's ↓ landing); last=true →
    // the lowest rung (visually nearest the rows, the ↑-from-rows landing).
    const focusToolbar = last => {
        const rungs = toolbarRungs(byId[activeId]);
        if (!rungs.length)
            return false;
        rungs[last ? rungs.length - 1 : 0][0].focus();
        return true;
    };
    // ↑ past a list's first row: the lowest toolbar rung when the active
    // view has one, else the strip/box crossing (focusTop).
    const focusListExit = () => {
        if (!focusToolbar(true))
            focusTop();
    };

    // ↓ from the header row (final polish): the naive vertical chain —
    // header → tab strip → [in-list toolbar] → view content. With the strip
    // visible the active tab takes focus (a second ↓ enters the zone below);
    // with the strip hidden the next rung below is entered directly — the
    // toolbar when the active view has one, else its rows.
    const focusDown = () => {
        const def = byId[activeId];
        if (tabsVisible() && def && def.tabEl) {
            def.tabEl.focus();
            return;
        }
        if (!focusToolbar())
            focusActive();
    };

    // --- Activation ------------------------------------------------------------
    const readViewState = () => {
        try {
            return JSON.parse(store.get('viewState') || '{}');
        } catch (e) {
            return {};
        }
    };

    // §2.1 region focus memory. The row a view is remembered on: the actually
    // focused row when focus is inside the list, else the `.focus`-marked row
    // (the tree maintains that marker itself). Stored per view as
    // viewState[id] = { scroll, focus } — pre-v4.1 entries are plain scrollTop
    // numbers and read back as scroll-only.
    const focusedRowId = listEl => {
        const ae = document.activeElement;
        if (ae && ae !== listEl) {
            let inside = false;
            for (let n = ae; n; n = n.parentNode) {
                if (n === listEl) {
                    inside = true;
                    break;
                }
            }
            if (inside) {
                const li = ae.closest ? ae.closest('li') : null;
                if (li && li.id)
                    return li.id;
            }
        }
        const marked = listEl.querySelector('.focus');
        const li = marked && marked.closest ? marked.closest('li') : null;
        return (li && li.id) || null;
    };

    // innerHTML-rendered rows are found by a plain children walk — no CSS
    // escaping, works on any row id the views mint.
    const findRowById = (listEl, rowId) => {
        const walk = node => {
            const kids = node.children || [];
            for (let i = 0, l = kids.length; i < l; i++) {
                if (kids[i].id === rowId)
                    return kids[i];
                const hit = walk(kids[i]);
                if (hit)
                    return hit;
            }
            return null;
        };
        return walk(listEl);
    };

    // Put the `.focus` marker back on the remembered row (when it still
    // exists) so focusDefault and the Tab cycle land where the view was left.
    // Views re-render asynchronously from their activate hook (recent/stats
    // probe → fetch → innerHTML swap), which wipes a synchronously restored
    // marker — so this watches for a short window and re-marks as needed.
    // A live marker always wins: once the user moves focus, nothing is done.
    const restoreFocusRow = def => {
        if (!def.listEl)
            return;
        const entry = readViewState()[def.id];
        const rowId = (entry && typeof entry === 'object') ? entry.focus : null;
        if (!rowId)
            return;
        let attempts = 0;
        const tryMark = () => {
            if (activeId !== def.id)
                return; // switched away meanwhile
            if (!def.listEl.querySelector('.focus')) {
                const li = findRowById(def.listEl, rowId);
                if (li) {
                    const inner = li.firstElementChild;
                    const target = (inner && /^(A|SPAN)$/.test(inner.tagName)) ? inner : li;
                    target.classList.add('focus');
                }
            }
            if (++attempts < 20)
                setTimeout(tryMark, 100);
        };
        tryMark();
    };

    const scrollOf = entry => typeof entry === 'number' ? entry
        : (entry && typeof entry === 'object' ? (entry.scroll | 0) : 0);

    const announce = def => {
        // The startup activation is not a user-driven switch: stay quiet.
        if (firstActivation) {
            firstActivation = false;
            return;
        }
        if (!$announce)
            return;
        const label = _m(def.titleKey) || def.id;
        $announce.textContent = _m('viewSwitchAnnounce', label) || label;
    };

    const reduceMotion = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fadeIn = el => {
        if (reduceMotion || !el || !el.classList)
            return;
        el.classList.remove('view-enter');
        void el.offsetWidth; // restart the CSS animation on every switch
        el.classList.add('view-enter');
    };

    const activate = (id, opts = {}) => {
        const def = byId[id];
        if (!def || def.hidden)
            return false;
        if (activeId === id)
            return true;
        // Round-3 consistency: an open context menu points at a row of the
        // outgoing view — never let it float over the incoming one (pointer
        // paths already clear it through the body-click binding).
        clearMenu();
        const prev = byId[activeId];
        if (prev) {
            if (prev.deactivate)
                prev.deactivate();
            if (prev.listEl) {
                const state = readViewState();
                state[prev.id] = {
                    scroll: prev.persistScroll ? prev.listEl.scrollTop : scrollOf(state[prev.id]),
                    focus: focusedRowId(prev.listEl)
                };
                store.set('viewState', JSON.stringify(state));
            }
            prev.container.hidden = true;
        } else {
            // First activation (startup): the markup's default visibility
            // shows the tree section — every other registered view's
            // section must end up hidden (panel restoring a stored view).
            for (let i = 0, l = registry.length; i < l; i++) {
                const v = registry[i];
                if (v.id !== id && v.container)
                    v.container.hidden = true;
            }
        }
        activeId = id;
        def.container.hidden = false;
        if (def.persistScroll && def.listEl) {
            const scroll = scrollOf(readViewState()[id]);
            if (scroll)
                def.listEl.scrollTop = scroll;
        }
        if (def.activate)
            // v4 task-4 #6: opts.preset is the palette custom-command
            // view-preset channel (e.g. dupes strategy/scope, dead scan) —
            // views that don't know it simply ignore the field.
            def.activate({ keepFocus: !!opts.keepFocus, preset: opts.preset });
        // §2.1: after the view's own activate hook (which may re-render the
        // rows), re-mark the remembered row so focus lands where it was left.
        restoreFocusRow(def);
        store.set('activeView', id);
        for (let i = 0, l = registry.length; i < l; i++) {
            const v = registry[i];
            if (!v.tabEl)
                continue;
            const on = v.id === id;
            v.tabEl.setAttribute('aria-selected', on ? 'true' : 'false');
            v.tabEl.tabIndex = on ? 0 : -1;
        }
        placeIndicator();
        announce(def);
        // Tab badges re-evaluate on every switch — activation hooks are the
        // moment views (re)compute their counts (dupes groups, stats rows),
        // and immediate counts (dead marks) stay fresh across views.
        updateBadges();
        if (opts.focusTab) {
            if (def.tabEl)
                def.tabEl.focus();
        } else if (!opts.keepFocus) {
            focusDefault(def);
        }
        fadeIn(def.container);
        return true;
    };

    // --- Escape levels (docs/v4task-2.md §3.4) --------------------------------
    // keyboard.js's document Escape chain calls, in order:
    //   dialogs → context menu → palette → onEscapeActive (view hook, e.g.
    //   dead scan abort) → search query clear → escapeToTree → window.close.
    const onEscapeActive = () => {
        const def = byId[activeId];
        return !!(def && def.onEscape && def.onEscape());
    };
    const escapeToTree = () => {
        const first = registry[0];
        if (first && activeId !== first.id)
            return activate(first.id);
        return false;
    };

    // --- Keyboard registration ------------------------------------------------
    // List views the keyboard layer binds its navigation handlers to; each
    // entry carries its type-ahead capability (tree/search only per spec) and
    // the view-local key consumer (M/R/K — docs/v4task-2-list.md §2.3),
    // which keyboard.js consults before the type-ahead branch.
    const lists = () => visibleViews()
        .filter(v => v.listEl)
        .map(v => ({ id: v.id, el: v.listEl, typeAhead: v.typeAhead !== false, onKey: v.onKey || null }));
    const listOf = el => {
        const all = lists();
        for (let i = 0, l = all.length; i < l; i++) {
            if (all[i].el === el)
                return all[i];
        }
        return null;
    };

    // --- Tab strip keyboard model (v4task-2-list §2.2) -------------------------
    $tabs.addEventListener('keydown', e => {
        const views = visibleViews();
        if (!views.length)
            return;
        const idx = views.findIndex(v => v.id === activeId);
        switch (e.key) {
            case 'ArrowLeft':
            case 'ArrowRight': {
                e.preventDefault();
                // RTL mirrors the arrow semantics (the strip itself flips)
                const dir = (e.key === 'ArrowRight') ? 1 : -1;
                const step = rtl ? -dir : dir;
                const next = views[(idx + step + views.length) % views.length];
                // Auto-activation: rendering is local and cheap, focus follows.
                if (next)
                    activate(next.id, { focusTab: true });
                break;
            }
            case 'Home':
                e.preventDefault();
                activate(views[0].id, { focusTab: true });
                break;
            case 'End':
                e.preventDefault();
                activate(views[views.length - 1].id, { focusTab: true });
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (searchInput)
                    searchInput.focus();
                break;
            case 'ArrowDown':
                e.preventDefault();
                // §2.5: the toolbar rung sits between the strip and the rows.
                if (!focusToolbar())
                    focusDefault(byId[activeId]);
                break;
        }
    });

    // Ctrl/Cmd+1…9 jumps straight to a view (docs/v4task-2.md §3.4), with
    // Alt+1…9 as the portable twin (v4 task-4 #10): Edge reserves Ctrl+1…8
    // for browser-tab switching so the page never sees the keystroke there
    // (Chrome lets it through inside the popup/side panel). Alt+digit is
    // unbound in Chrome/Edge/Firefox. The Ctrl+Alt combo is excluded — on
    // several layouts that is AltGr and types characters. Capture phase,
    // and never while an input owns the keystroke.
    document.addEventListener('keydown', e => {
        if (!(e.metaKey || e.ctrlKey || e.altKey) || e.shiftKey)
            return;
        if (e.altKey && (e.ctrlKey || e.metaKey))
            return;
        if (!/^[1-9]$/.test(e.key))
            return;
        // K19: a numpad digit is never a view jump — under Alt it is Windows'
        // Alt-code character input (e.key still reads '1'…'9'), and typing
        // characters must not switch views or be preventDefaulted.
        if (e.code && e.code.startsWith('Numpad'))
            return;
        // An open modal dialog or the command palette owns its input — do not
        // yank a half-edited form. Everywhere else the shortcut switches
        // views even while the search box has focus: Ctrl+2 lands in the
        // search input, and the old "input owns the keystroke" guard swallowed
        // every further Ctrl+1/3…, stranding the user in the search view.
        const paletteEl = $('command-palette');
        if (body.classList.contains('needConfirm') || body.classList.contains('needEdit') ||
            body.classList.contains('needInputName') || body.classList.contains('needSort') ||
            body.classList.contains('needAlert') || body.classList.contains('needTabGroup') ||
            body.classList.contains('needGroupPick') ||
            (paletteEl && !paletteEl.hidden))
            return;
        const views = visibleViews();
        const def = views[parseInt(e.key, 10) - 1];
        if (!def)
            return;
        e.preventDefault();
        activate(def.id);
    }, true);

    // --- Shared parent-path map (docs/v4task-2.md §3.6) -------------------------
    // Rebuilt from every tree regeneration (neat.js hooks it into tree-view's
    // generateTree); list rows read it synchronously through pathOf.
    const buildPathMap = tree => {
        pathMap = computePathMap(tree);
    };
    const pathOf = id => pathMap[id] || '';

    // --- Structural views + startup --------------------------------------------
    register({
        id: 'tree', titleKey: 'viewTree', icon: VIEW_ICONS.tree,
        container: $('view-tree'), listEl: $('tree')
    });
    register({
        id: 'search', titleKey: 'viewSearch', icon: VIEW_ICONS.search,
        container: $('view-search'), listEl: $('results')
    });
    // activeView: the panel always restores the view it was left on; the
    // popup does too when rememberView is on (v4 task-3 #6, default on) —
    // off means the classic "popup always lands on the tree". Feature views
    // register AFTER this startup runs, so a stored feature-view id is held
    // in pendingRestore and fires from register() when that view lands.
    // keepFocus: the search input's autofocus attribute owns the startup focus.
    const stored = store.get('activeView');
    const remembers = isPanel || !!store.get('rememberView', '1');
    let startId = 'tree';
    if (remembers && stored && stored !== 'tree') {
        if (byId[stored] && !byId[stored].hidden)
            startId = stored;
        else if (!byId[stored])
            pendingRestore = stored;
    }
    activate(startId, { keepFocus: true });

    return {
        register,
        attach,
        activate,
        activeId: () => activeId,
        activeDef: () => byId[activeId] || null,
        isActive: id => activeId === id,
        views: () => registry.slice(),
        lists,
        listOf,
        onEscapeActive,
        escapeToTree,
        focusTop,
        focusDown,
        focusActive,
        focusToolbar,
        focusListExit,
        buildPathMap,
        pathOf,
        updateBadges,
        showItemPath: () => !!store.get('showItemPath', '1')
    };
}
