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
 *   activate({ keepFocus }) — optional enter hook (render/refresh)
 *   deactivate()            — optional leave hook
 *   onEscape()    — optional view-local Escape consumer; return true when
 *                   the key was consumed (dead scan abort, …)
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
 * list — docs/v4task-2-list.md §2.2) and the aria-live view announcements.
 *
 * initViewManager(ctx) is called once by neat.js right after the context
 * menus init (search.js needs it at init): ctx.store, ctx.isPanel,
 * ctx.rtl. document/chrome remain page globals.
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

    const $tabs = $('view-tabs');
    const $announce = $('view-announce');
    const searchInput = $('search-input');

    const registry = []; // ViewDef array; order = tab order, tree stays [0]
    const byId = {};
    let activeId = null;
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
        for (let i = 0, l = registry.length; i < l; i++) {
            const def = registry[i];
            if (!def.tabEl)
                continue;
            const badge = def.tabEl.querySelector('.tab-badge');
            if (!badge)
                continue;
            const n = def.badge ? (def.badge() | 0) : 0;
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
    const register = def => {
        if (byId[def.id]) {
            Object.assign(byId[def.id], def);
            renderTabs();
            return byId[def.id];
        }
        registry.push(def);
        byId[def.id] = def;
        renderTabs();
        return def;
    };

    // Attach behavior hooks to an already-registered view (search.js wires
    // its render/focus hooks into the structural 'search' view this way).
    const attach = (id, hooks) => {
        if (byId[id])
            Object.assign(byId[id], hooks);
    };

    // --- Focus ---------------------------------------------------------------
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
            || def.listEl.querySelector('li a, li span');
        if (row)
            row.focus();
    };

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

    // --- Activation ------------------------------------------------------------
    const readViewState = () => {
        try {
            return JSON.parse(store.get('viewState') || '{}');
        } catch (e) {
            return {};
        }
    };

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
        const prev = byId[activeId];
        if (prev) {
            if (prev.deactivate)
                prev.deactivate();
            if (prev.persistScroll && prev.listEl) {
                const state = readViewState();
                state[prev.id] = prev.listEl.scrollTop;
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
            const state = readViewState();
            if (state[id])
                def.listEl.scrollTop = state[id];
        }
        if (def.activate)
            def.activate({ keepFocus: !!opts.keepFocus });
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
    // entry carries its type-ahead capability (tree/search only per spec).
    const lists = () => visibleViews()
        .filter(v => v.listEl)
        .map(v => ({ id: v.id, el: v.listEl, typeAhead: v.typeAhead !== false }));
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
                focusDefault(byId[activeId]);
                break;
        }
    });

    // Ctrl/Cmd+1…6 jumps straight to a view (docs/v4task-2.md §3.4). Capture
    // phase, and never while an input owns the keystroke.
    document.addEventListener('keydown', e => {
        if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey)
            return;
        if (!/^[1-9]$/.test(e.key))
            return;
        const ae = document.activeElement;
        if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName))
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
    // activeView: the popup always lands on the tree; the panel restores the
    // view it was left on (docs/v4task-2.md §3.3). keepFocus: the search
    // input's autofocus attribute owns the startup focus.
    const stored = store.get('activeView');
    const startId = (isPanel && byId[stored] && !byId[stored].hidden) ? stored : 'tree';
    activate(startId, { keepFocus: true });

    return {
        register,
        attach,
        activate,
        activeId: () => activeId,
        isActive: id => activeId === id,
        views: () => registry.slice(),
        lists,
        listOf,
        onEscapeActive,
        escapeToTree,
        focusTop,
        buildPathMap,
        pathOf,
        updateBadges,
        showItemPath: () => !!store.get('showItemPath', '1')
    };
}
