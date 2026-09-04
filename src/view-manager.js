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
 * ViewDef (docs/plan-4.0.0/v4task-2.md §3.1):
 *   id          — 'tree' | 'search' | 'recent' | 'stats' | 'dead' | 'dupes'
 *   titleKey    — i18n key for the tab label / aria-label
 *   icon        — inline SVG (src/icons.js VIEW_ICONS)
 *   container   — the view's root section element
 *   listEl      — optional scrollable list container (keyboard registration,
 *                 scroll persistence, default focus target)
 *   hidden      — optional; hidden views keep their registration but render
 *                 no tab and refuse activation (showRecentBookmarks off)
 *   showKey     — optional setting key for feature-view visibility (the
 *                 existing showXxxView option). Tree/search never hide.
 *   disableKey  — optional setting key (feature views only): disabled views
 *                 are hidden AND their options-page show option greys out.
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
 *                   docs/plan-4.0.0/v4task-2-list.md §2.3); keyboard.js consults it in
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
 * tabindex, ←/→ with RTL flip and wrap-around, the view-scoped Home/End —
 * 4.0.1 P4: the CURRENT view's first/last row, never a view switch —, ↑ to
 * the search box, ↓ into the zone below — the active view's in-list toolbar
 * rung when it has one, else its rows, keyboard-model §2.1/§2.5) and the
 * aria-live view announcements.
 *
 * initViewManager(ctx) is called once by neat.js right after the context
 * menus init (search.js needs it at init): ctx.store, ctx.isPanel,
 * ctx.rtl, ctx.clearMenu (view switches dismiss open menus). document/
 * chrome remain page globals.
 */

import { VIEW_ICONS } from './icons.js';
import { buildPathMap as computePathMap } from './tree-render.js';
import { rowFocusTarget } from './list-focus.js';

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
    // The "记住之前的状态" option (neat.js holds the live flag): gates the
    // focusSpot capture/persist/restore below, the same way it gates the
    // tree's focusID and scroll restore.
    const remember = ctx.getRememberState || (() => true);
    // issue #64: "open with the search field activated" — with the option on
    // the search input's autofocus owns the startup focus; restoreFocusSpot
    // must not steal it back to the remembered row/spot.
    const focusSearchOnOpen = !!(ctx.getFocusSearchOnOpen && ctx.getFocusSearchOnOpen());
    // The undo toast bar (neat.js injects it lazily — undo inits after the
    // view manager). Used for the hidden-tab-strip view hint below.
    const showToast = (...args) => {
        const fn = ctx.toastAction;
        if (fn)
            fn(...args);
    };
    // Any view switch dismisses a transient toast (undo/hint) — a hint that
    // belongs to the outgoing view must not linger over the incoming one.
    const dismissToast = () => {
        const fn = ctx.dismissToast;
        if (fn)
            fn();
    };

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
    // Ctrl/Cmd+number (docs/plan-4.0.0/v4task-2.md §3.2 v3).
    const tabsVisible = () => !!store.get('showViewTabs', '1');
    body.classList.toggle('no-view-tabs', !tabsVisible());

    // --- View visibility state (4.0.8: hide/disable right-click menu) ---------
    // Feature views can be hidden (the existing showXxxView option) or
    // disabled (disableXxxView). The structural tree and search tabs are
    // ALWAYS preserved — they are the base pair, so the tab bar can never
    // drop below two icons and no min-count guard is needed anywhere.
    // `hidden` = the view has no tab and no Alt+number entry, but it stays
    // activatable through the command palette. `disabled` is the only fully
    // forbidden state (no tab, no shortcut, no palette, activation refused).
    const VIEW_SHOW_KEYS = {
        tabgroups: 'showTabGroupsView',
        recent: 'showRecentBookmarks',
        stats: 'showStatsView',
        dead: 'showDeadView',
        dupes: 'showDupesView'
    };
    const VIEW_DISABLE_KEYS = {
        tabgroups: 'disableTabGroupsView',
        recent: 'disableRecentView',
        stats: 'disableStatsView',
        dead: 'disableDeadView',
        dupes: 'disableDupesView'
    };
    const WATCHED_VIEW_KEYS = Object.keys(VIEW_SHOW_KEYS).map(id => VIEW_SHOW_KEYS[id])
        .concat(Object.keys(VIEW_DISABLE_KEYS).map(id => VIEW_DISABLE_KEYS[id]));
    // Options pages write directly to chrome.storage; an open side panel must
    // follow live. Store the latest values here and feed every decision below
    // through this table so a storage.onChanged event updates the UI without
    // waiting for a store mirror overlay (which never comes mid-session).
    const liveViewSettings = {};

    const viewSetting = (key, defaultValue) => {
        if (key in liveViewSettings)
            return liveViewSettings[key];
        return store.get(key, defaultValue);
    };
    const viewSettingOn = key => !!viewSetting(key, '1');
    const viewDisabled = def => !!def.disableKey && viewSetting(def.disableKey, '') === '1';

    // Recompute def.hidden / def.disabled from the live settings. Views
    // without keys (test doubles) keep their declared `hidden` flag as the
    // static truth, so minimal setups don't need the key maps.
    const syncViewState = def => {
        if (def.id === 'tree' || def.id === 'search') {
            def.disabled = false;
            def.hidden = false;
            return;
        }
        def.disabled = viewDisabled(def);
        if (def.disabled) {
            def.hidden = true;
            return;
        }
        if (def.showKey)
            def.hidden = !viewSettingOn(def.showKey);
    };

    const refreshViewState = () => {
        for (let i = 0, l = registry.length; i < l; i++)
            syncViewState(registry[i]);
        renderTabs();
        updateBadges();
        placeIndicator();
        // The active view may have become disabled from the options page
        // while the panel sat open — never leave a disabled section active.
        // Hidden-but-not-disabled views stay activatable through the palette.
        const def = byId[activeId];
        if (def && def.disabled) {
            const first = visibleViews()[0];
            if (first && first.id !== activeId)
                activate(first.id, { keepFocus: true });
        }
    };

    const visibleViews = () => registry.filter(v => !v.hidden);
    // Available = activatable. Hidden views (showXxx off) stay available via
    // the command palette; disabled views are the only fully forbidden ones.
    const availableViews = () => registry.filter(v => !v.disabled);

    // The tab-context-menu contract (context-menu.js calls these through
    // neat.js's lazy ctx.viewMenu). Tree/search tabs are fixed; their Hide
    // item is the "hide the whole tab strip" shortcut and is only offered
    // when they are the last two tabs standing. Feature views hide/disable
    // themselves while their tab is visible.
    const canHideTab = id => {
        const def = byId[id];
        if (!def || !def.tabEl)
            return false;
        if (def.id === 'tree' || def.id === 'search')
            return visibleViews().length === 2;
        return !!def.showKey;
    };
    const canDisableView = id => {
        const def = byId[id];
        return !!def && !!def.tabEl && !!def.disableKey && !def.disabled;
    };
    const focusFirstVisibleTab = () => {
        const tabs = visibleViews();
        const first = tabs[0];
        if (first && first.tabEl)
            first.tabEl.focus();
    };
    const hideViewTab = id => {
        const def = byId[id];
        if (!def || !canHideTab(id))
            return false;
        if (def.id === 'tree' || def.id === 'search') {
            // Only tree + search remain: the tab's Hide item stands for the
            // options-page "Show view tabs" switch — hide the whole strip.
            store.set('showViewTabs', '');
            body.classList.add('no-view-tabs');
            focusDefault(def);
            return true;
        }
        if (def.showKey)
            store.set(def.showKey, '');
        refreshViewState();
        focusFirstVisibleTab();
        return true;
    };
    const disableView = id => {
        if (!canDisableView(id))
            return false;
        const def = byId[id];
        store.set(def.disableKey, '1');
        refreshViewState();
        focusFirstVisibleTab();
        return true;
    };
    const viewMenuState = id => ({
        canHide: canHideTab(id),
        canDisable: canDisableView(id)
    });

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
        // offsetLeft/offsetWidth are rounded independently by the browser, so
        // for the strip's LAST tab their sum can overshoot the strip's true
        // right edge by 1px on a fractional-DPR layout. Clamp the width: the
        // indicator is absolutely positioned inside the unclipped
        // #view-tabs → #container → body chain, so a 1px overshoot propagates
        // to the document scroll width — and Chrome sizes the popup window
        // from that (the 4.0.8 report: the popup widened 1px only while the
        // dupes tab — the strip's last — was active). `max` is NaN in unit
        // stubs without clientWidth → no clamp, unchanged behavior.
        const max = $tabs.clientWidth - tab.offsetLeft;
        const width = Number.isFinite(max)
            ? Math.min(tab.offsetWidth, Math.max(0, max))
            : tab.offsetWidth;
        indicator.style.width = `${width}px`;
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
        // Clear every tab reference first: a view that just became hidden
        // must not keep a stale `.tabEl` (the tab-context-menu can-hide
        // guard consults it).
        for (let i = 0, l = registry.length; i < l; i++)
            registry[i].tabEl = null;
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
            // A toolbar dropdown's option <li role="option" tabindex="-1">
            // (the dupes strategy/scope listboxes) is toolbar chrome, not a
            // list row — it must never displace the remembered-row marker. A
            // marker parked on a hidden listbox option dead-ends the toolbar
            // rung's ↓ (keyboard.js targets `this.querySelector('.focus')`,
            // and .focus() on a hidden element silently fails) — the reported
            // 4.0.1 regression: open the strategy dropdown, then ↓ from the
            // button area could no longer enter the rows.
            if (t.closest && t.closest('.vbm-dropdown-list'))
                return;
            const old = def.listEl.querySelector('.focus');
            if (old && old !== t)
                old.classList.remove('focus');
            t.classList.add('focus');
        });
    };

    const register = def => {
        // Views register with a static `hidden` flag; real view modules add
        // showKey/disableKey and refreshViewState() recomputes the effective
        // state from storage. Test doubles without keys keep their static
        // `hidden` flag as the single source of truth.
        syncViewState(def);
        if (byId[def.id]) {
            Object.assign(byId[def.id], def);
            syncViewState(byId[def.id]);
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
        // 5421968 regression lesson (keyboard.js's toolbar ↓ path carries the
        // same guard): a `.focus` marker parked inside a toolbar dropdown's
        // listbox (.vbm-dropdown-list lives inside the same container) is a
        // hidden option, not a row — .focus() on it silently dead-ends.
        const marked = def.listEl.querySelector('.focus');
        const row = (marked && !(marked.closest && marked.closest('.vbm-dropdown-list')))
            ? marked
            : def.listEl.querySelector(ROW_SEL);
        if (row) {
            // issues #65/#66 (residual round): focus-landing must never move
            // the scroll. This path serves the spot-restore's give-up and
            // view switches — the view's scroll was just restored, and a
            // bare focus() on an off-screen remembered row yanks the
            // viewport to it ("the exact position is not remembered"). The
            // keyboard's own arrow walk still scrolls on purpose.
            row.focus({ preventScroll: true });
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

    // 4.0.1 P4: Home/End is view-scoped — the strip's Home/End focuses the
    // CURRENT view's first/last row and never switches views. The same
    // ROW_SEL row contract as focusDefault; rows inside a toolbar dropdown's
    // listbox (.vbm-dropdown-list lives inside the same container) are
    // filtered out programmatically, so a listbox option is never the view's
    // edge row. Returns false when the view has no rows — the caller's focus
    // then simply stays where it is (on the current tab).
    const focusEdgeRow = last => {
        const def = byId[activeId];
        if (!def || !def.listEl || !def.listEl.querySelectorAll)
            return false;
        const rows = def.listEl.querySelectorAll(ROW_SEL);
        const kept = [];
        for (let i = 0, l = rows.length; i < l; i++) {
            const r = rows[i];
            if (r.closest && r.closest('.vbm-dropdown-list'))
                continue;
            kept.push(r);
        }
        if (!kept.length)
            return false;
        kept[last ? kept.length - 1 : 0].focus();
        return true;
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
    // Gated by the same remember option as the focusSpot memory (off: the
    // stored viewState rows are neither written nor restored).
    const restoreFocusRow = def => {
        if (!def.listEl || !remember() || !store.get('rememberHighlight', '1'))
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
                    // The shared row contract (list-focus.js): the anchor/span,
                    // or the tabindex row container — never the bare li of a
                    // button-led row (the dupes keeper radio).
                    (rowFocusTarget(li) || li).classList.add('focus');
                }
            }
            if (++attempts < 20)
                setTimeout(tryMark, 100);
        };
        tryMark();
    };

    // --- Unified focus-spot memory (popup reopen "where I was") ---------------
    // One classifier tags the current keyboard location into a `focusSpot`
    // { zone, view, key, ... } record, persisted live (deduped, gated by the
    // remember option) and restored once at startup by restoreFocusSpot().
    // Rows / header buttons / view tabs restore exactly; toolbar controls
    // restore by (bar, class, position-within-class) — degrading to the bar's
    // first enabled control when the exact one is gone (stateful re-renders:
    // the dead scan toolbar, the dupes selection bar). Scope is popup REOPEN
    // only: intra-session view switches keep the existing per-view `.focus`
    // row memory (restoreFocusRow above).
    const HEADER_IDS = ['search-input', 'quick-add-btn', 'tool-btn'];
    let currentSpot = null;   // last memorable spot, as its JSON identity
    let userInteracted = false;
    // Snapshot the stored spot at init: the startup focus moves (search-input
    // autofocus, the saved-query select, the tree's focusID refocus) fire
    // focusin AFTER the classifier registers and would otherwise overwrite
    // last session's spot before restoreFocusSpot() ever reads it. The restore
    // consumes this snapshot; the classifier owns the key from then on.
    let pendingSpot = null;
    try {
        pendingSpot = JSON.parse(store.get('focusSpot') || 'null');
    } catch (e) { /* corrupt record — treat as none */ }
    // The remember option gates `viewState` (per-view scroll + remembered
    // row) exactly like `focusSpot` — off means never written on view
    // switches and never restored on activate, symmetric with the tree's
    // focusID/scroll gating. The stale record from a remember-on session is
    // dropped once, here at startup (restoreFocusSpot clears focusSpot the
    // same way when the option is off).
    if (!remember())
        store.set('viewState', null);

    const isInside = (root, node) => {
        for (let n = node; n; n = n.parentNode)
            if (n === root)
                return true;
        return false;
    };

    // Classify a focused element into a spot, or null for a transient
    // location (menus / palette / dialogs / listbox options / body) whose
    // focus must never displace the remembered "where I was".
    const classifyFocus = el => {
        if (!el || el === body || el === document)
            return null;
        if (el.closest && el.closest('menu[type=context]'))
            return null; // a context menu's own row
        if (el.closest && el.closest('#command-palette'))
            return null; // the command palette owns its input
        if (el.closest && el.closest('.vbm-dropdown-list'))
            return null; // a toolbar dropdown's listbox option
        // Header buttons are global (visible from every view).
        if (el.id && HEADER_IDS.indexOf(el.id) >= 0)
            return { zone: 'header', key: el.id };
        // B1: the search view's history head is not a .vbm-toolbar rung (the
        // search view has no in-list toolbar), but its clear button carries
        // the same spot semantics — bar class + control class + index — and
        // resolves through the regular toolbar path on restore.
        if (el.id === 'search-history-clear')
            return { zone: 'toolbar', view: 'search', bar: 'search-history-head', cls: 'search-history-clear', idx: 0 };
        // A view tab (only the ACTIVE view's tab is roving-focusable, so the
        // spot's view is the tab's own view).
        if (el.classList && el.classList.contains('view-tab'))
            return { zone: 'tab', view: activeId, key: (el.id || '').replace('view-tab-', '') };
        // A toolbar control — keyed by its bar's identifying class, the
        // control's first class and its position among same-class controls.
        if (/^(BUTTON|SELECT|INPUT)$/.test(el.tagName) && el.closest) {
            const bar = el.closest('.vbm-toolbar');
            if (bar) {
                const own = (el.className || '').split(/\s+/)[0] || '';
                let idx = -1, same = 0;
                const all = bar.querySelectorAll ? bar.querySelectorAll('button, select, input') : [];
                for (let i = 0, l = all.length; i < l; i++) {
                    if ((all[i].className || '').split(/\s+/)[0] === own) {
                        if (all[i] === el) { idx = same; break; }
                        same++;
                    }
                }
                if (idx < 0)
                    return null; // not among the walkable controls — transient
                const barCls = (bar.className || '').split(/\s+/)
                    .filter(c => c && c !== 'vbm-toolbar')[0] || 'vbm-toolbar';
                return { zone: 'toolbar', view: activeId, bar: barCls, cls: own, idx };
            }
        }
        // B1: the search view's history rows live in #search-history-area —
        // inside the view container but OUTSIDE the #results listEl, and the
        // rows carry no element id. Key them by their data-q query (a
        // 'hist:' prefix keeps them apart from tree/list row ids).
        const histRow = el.closest ? el.closest('.search-history-row') : null;
        if (histRow) {
            let a = (el.tagName === 'A' && el.dataset && typeof el.dataset.q !== 'undefined')
                ? el : null;
            if (!a && histRow.querySelectorAll) {
                const anchors = histRow.querySelectorAll('a');
                for (let i = 0, l = anchors.length; i < l; i++)
                    if (anchors[i].dataset && typeof anchors[i].dataset.q !== 'undefined') {
                        a = anchors[i];
                        break;
                    }
            }
            return { zone: 'row', view: 'search', key: `hist:${(a && a.dataset && a.dataset.q) || ''}` };
        }
        // A list row inside the active view (the tree's nested li rows resolve
        // to their innermost li, whose id is the row id).
        const def = byId[activeId];
        if (def && def.listEl && isInside(def.listEl, el)) {
            const li = el.closest ? el.closest('li') : null;
            if (li && li.id)
                return { zone: 'row', view: activeId, key: li.id };
        }
        return null;
    };

    // Live capture: one document-level focusin listener persists the spot as
    // the user moves around. A transient location keeps the last memorable
    // spot (clicking empty space or opening the palette does not erase it).
    const onFocusIn = e => {
        const spot = classifyFocus(e.target);
        if (!spot)
            return;
        const id = JSON.stringify(spot);
        if (id === currentSpot)
            return; // identity unchanged — no store churn
        currentSpot = id;
        if (remember() && store.get('rememberHighlight', '1'))
            store.set('focusSpot', id);
    };
    document.addEventListener('focusin', onFocusIn, true);

    // Resolve a stored spot to its DOM element (or null when it no longer
    // exists in the active view).
    const focusSpotTarget = spot => {
        if (spot.zone === 'header')
            return document.getElementById(spot.key);
        if (spot.zone === 'tab')
            return document.getElementById(`view-tab-${spot.key}`);
        const def = byId[activeId];
        if (!def)
            return null;
        if (spot.zone === 'toolbar') {
            if (!def.container || !def.container.querySelector)
                return null;
            const bar = def.container.querySelector(`.${spot.bar}`);
            if (!bar)
                return null;
            const controls = bar.querySelectorAll ? bar.querySelectorAll('button, select, input') : [];
            const same = [];
            for (let i = 0, l = controls.length; i < l; i++)
                if ((controls[i].className || '').split(/\s+/)[0] === spot.cls)
                    same.push(controls[i]);
            const exact = same[spot.idx || 0];
            if (exact && !exact.disabled)
                return exact;
            // Degrade: the bar's first enabled control (stateful re-renders).
            for (let i = 0, l = controls.length; i < l; i++)
                if (!controls[i].disabled)
                    return controls[i];
            return null;
        }
        if (spot.zone === 'row' && def.listEl) {
            // B1: a 'hist:' key resolves inside #search-history-area — the
            // area's anchors ARE the history rows (matched by dataset.q,
            // never by interpolated selector), degrading to the first row.
            if (spot.key.indexOf('hist:') === 0) {
                const area = document.getElementById('search-history-area');
                const anchors = area && area.querySelectorAll ? area.querySelectorAll('a') : [];
                const rows = [];
                for (let i = 0, l = anchors.length; i < l; i++)
                    if (anchors[i].dataset && typeof anchors[i].dataset.q !== 'undefined')
                        rows.push(anchors[i]);
                for (let i = 0, l = rows.length; i < l; i++)
                    if (rows[i].dataset.q === spot.key.slice(5))
                        return rows[i];
                return rows[0] || null;
            }
            const li = findRowById(def.listEl, spot.key);
            if (!li)
                return null;
            // The shared row contract (list-focus.js): the anchor/span, or
            // the tabindex row container — a button-led row (the dupes
            // keeper radio) must resolve to its anchor, else .focus() on
            // the tabindex-less li is a silent no-op.
            return rowFocusTarget(li) || li;
        }
        return null;
    };

    // A hidden/removed restore target must never take focus: class-hidden
    // (option-off header buttons), inline display:none, or no layout boxes.
    const spotVisible = el => {
        if (!el)
            return false;
        if (el.classList && el.classList.contains('hidden'))
            return false;
        if (el.style && el.style.display === 'none')
            return false;
        if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0)
            return false;
        return true;
    };

    const onUserInput = () => { userInteracted = true; };

    // Popup reopen restore — the single entry for "where I was". Gated by
    // the remember option; header zones apply on any view, the other zones
    // only when the spot's view actually came up. Unlike the tree's focusID
    // startup refocus, this never steals focus from a user who already began
    // typing or clicking (keydown/mousedown bail mid-retry).
    const restoreFocusSpot = () => {
        if (!remember() || focusSearchOnOpen || !store.get('rememberHighlight', '1')) {
            store.set('focusSpot', null);
            pendingSpot = null;
            return;
        }
        const spot = pendingSpot;
        pendingSpot = null; // consumed — the live classifier owns the key now
        if (!spot)
            return;
        if (spot.zone !== 'header' && spot.view !== activeId)
            return; // the spot's view didn't come up (rememberView off) — default
        document.addEventListener('keydown', onUserInput, true);
        document.addEventListener('mousedown', onUserInput, true);
        let attempts = 0;
        const tryRestore = () => {
            if (userInteracted) {
                // The user took over — give up silently and drop the guards.
                document.removeEventListener('keydown', onUserInput, true);
                document.removeEventListener('mousedown', onUserInput, true);
                return;
            }
            const target = focusSpotTarget(spot);
            if (target && spotVisible(target) && !target.disabled) {
                // issues #65/#66: preventScroll — the spot row and the restored
                // scroll position are two separate memories ("what I focused"
                // vs "where I scrolled to"); a bare focus() scrolls the row
                // into view and silently overrides the position the user
                // actually left the view on.
                target.focus({ preventScroll: true });
                document.removeEventListener('keydown', onUserInput, true);
                document.removeEventListener('mousedown', onUserInput, true);
                return;
            }
            // The target may render asynchronously (rows, toolbar state).
            if (++attempts < 20) {
                setTimeout(tryRestore, 100);
                return;
            }
            document.removeEventListener('keydown', onUserInput, true);
            document.removeEventListener('mousedown', onUserInput, true);
            focusDefault(byId[activeId]); // give up on the exact spot
        };
        tryRestore();
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
        // Hidden views keep working through the command palette; disabled
        // views are the only activation-refused state.
        if (!def || def.disabled)
            return false;
        if (activeId === id)
            return true;
        // A toast belongs to the view it was raised on; switching away
        // dismisses it (undo/hint alike — the undo action is one-shot and
        // already lost when showToast/hideToast re-armed the bar).
        dismissToast();
        // Round-3 consistency: an open context menu points at a row of the
        // outgoing view — never let it float over the incoming one (pointer
        // paths already clear it through the body-click binding).
        clearMenu();
        const prev = byId[activeId];
        if (prev) {
            if (prev.deactivate)
                prev.deactivate();
            // viewState (scroll + remembered row) persists only under the
            // remember option — the same gate as the focusSpot capture.
            if (prev.listEl && remember()) {
                const state = readViewState();
                state[prev.id] = {
                    // 分层记忆: scroll rides the rememberScroll layer; the
                    // remembered row rides rememberHighlight
                    scroll: (prev.persistScroll && store.get('rememberScroll', '1'))
                        ? prev.listEl.scrollTop : scrollOf(state[prev.id]),
                    focus: store.get('rememberHighlight', '1') ? focusedRowId(prev.listEl) : null
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
        if (def.persistScroll && def.listEl && remember() && store.get('rememberScroll', '1')) {
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
        const isFirstActivation = firstActivation;
        announce(def);
        // 4.0.8: entering a view whose tab is not visible — either the whole
        // tab strip is off, or the view itself is hidden (palette entry) —
        // leaves no visible way back. One toast names the view and the
        // Esc / command-palette route home. Startup activation stays quiet
        // (the same firstActivation gate as announce).
        if (!isFirstActivation && id !== 'tree'
            && (!tabsVisible() || !def.tabEl)) {
            const label = _m(def.titleKey) || def.id;
            // Single argument on purpose: the toast is a pure hint, so it is
            // intentionally buttonless (undo.js's toastAction hides the
            // button on a falsy label — a blank button would silently undo).
            showToast(_m('viewHiddenTabsHint', [label, 'Esc']) || label);
        }
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

    // --- Escape levels (docs/plan-4.0.0/v4task-2.md §3.4) --------------------------------
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
    // the view-local key consumer (M/R/K — docs/plan-4.0.0/v4task-2-list.md §2.3),
    // which keyboard.js consults before the type-ahead branch.
    // Keyboard list bindings cover every registered list container, so a
    // view that is enabled/disabled live (options page while the side panel
    // is open) never misses its keydown/keyup handlers after the fact. Hidden
    // lists can't take focus (their sections are hidden), so the extra
    // bindings are inert until the view becomes available again.
    const lists = () => registry
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
        // Dedicated context-menu keys open the tab menu from the keyboard.
        // →/← stay assigned to tab switching, so the row model's generic
        // →-opens-menu rule is intentionally NOT applied on the tab strip;
        // these two keys are the remaining standard menu keys.
        if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
            e.preventDefault();
            const def = byId[activeId];
            const tab = def && def.tabEl;
            if (tab && tab.dispatchEvent) {
                const rect = tab.getBoundingClientRect
                    ? tab.getBoundingClientRect() : null;
                const clientX = rect ? Math.max(0, rect.left + rect.width / 2) : 0;
                const clientY = rect ? rect.bottom : 0;
                const event = new MouseEvent('contextmenu', {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    clientX,
                    clientY,
                    pageX: clientX,
                    pageY: clientY
                });
                tab.dispatchEvent(event);
            }
            return;
        }
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
            case 'End':
                e.preventDefault();
                // 4.0.1 P4: view-scoped — the CURRENT view's first/last
                // row, never a view switch; with no rows the focus simply
                // stays on the current tab.
                focusEdgeRow(e.key === 'End');
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

    // Ctrl/Cmd+1…9 jumps straight to a view (docs/plan-4.0.0/v4task-2.md §3.4), with
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
            body.classList.contains('needGroupPick') || body.classList.contains('needCopyMove') ||
            body.classList.contains('needFolderPick') ||
            (paletteEl && !paletteEl.hidden))
            return;
        const views = visibleViews();
        const def = views[parseInt(e.key, 10) - 1];
        if (!def)
            return;
        e.preventDefault();
        activate(def.id);
    }, true);

    // --- Shared parent-path map (docs/plan-4.0.0/v4task-2.md §3.6) -------------------------
    // Rebuilt from every tree regeneration (neat.js hooks it into tree-view's
    // generateTree); list rows read it synchronously through pathOf.
    // pathsReady (issue #64): the boot-order gap — initSearch's saved-query
    // restore ranks and renders from ITS OWN getTree callback while this map
    // only fills from tree-view's LATER one — left restored results with bare
    // titles; renders can check readiness and re-run once the map lands.
    let pathMapReady = false;
    let pathLabelMap = {};
    let dateMap = {};
    const buildPathMap = tree => {
        // H5: computePathMap returns { paths, pathLabels, ids } — the ids feed
        // visitStats.prune in neat.js's onTreeGenerated without a second walk.
        const result = computePathMap(tree);
        pathMap = result.paths;
        pathLabelMap = result.pathLabels || {};
        dateMap = result.dates || {};
        pathMapReady = true;
        return result;
    };
    // P1-1: tree-view's buildTreeSnapshot already produced the path map in
    // its single walk — swap it in directly (no second traversal).
    const setPathMap = (paths, labels, dates) => {
        pathMap = paths || {};
        pathLabelMap = labels || {};
        dateMap = dates || {};
        pathMapReady = true;
    };
    const pathOf = id => pathMap[id] || '';
    // Issue #64: the meta-LINE path form. Under the reverseItemPath option
    // (default off) row labels flip to NEAREST-parent-first with a depth cap
    // (formatPathLabel); off keeps the canonical root-first form — tooltips
    // always stay canonical either way.
    const pathLabelOf = id => store.get('reverseItemPath')
        ? (pathLabelMap[id] || '')
        : (pathMap[id] || '');
    // id → the node's dateAdded (0 when unknown) — the Added tooltip line's
    // data source for views whose own model lacks it (staging, visit-stats).
    const dateAddedOf = id => dateMap[id] || 0;
    const pathsReady = () => pathMapReady;

    // --- Live storage sync ------------------------------------------------------
    // show*/disable* view keys are written by the options page (and by the
    // tab context menu through this module). An open side panel must follow
    // live: update the local mirror copy, re-sync every ViewDef and re-render
    // the tab strip. The listener is registered after every function it calls
    // is defined, and before the structural registrations so a startup storm
    // can't race the initial render.
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
            // The watched view keys live in the sync area since the 2026-08
            // storage audit (store.js routes them); accept a pre-migration
            // local write too.
            if ((area !== 'sync' && area !== 'local') || !changes)
                return;
            let touched = false;
            for (let i = 0, l = WATCHED_VIEW_KEYS.length; i < l; i++) {
                const key = WATCHED_VIEW_KEYS[i];
                if (Object.prototype.hasOwnProperty.call(changes, key)) {
                    const value = changes[key].newValue;
                    // Keep the store mirror fresh for every other module
                    // (view-recent's enabled(), etc.) without writing the
                    // same value back to storage.
                    if (store.adopt)
                        store.adopt(key, value);
                    liveViewSettings[key] = value;
                    touched = true;
                }
            }
            if (touched)
                refreshViewState();
        });
    }

    // --- Structural views + startup --------------------------------------------
    // Issue #63: the tree keeps its scroll across view switches too. Without
    // persistScroll the container.hidden wipe (display:none resets scrollTop)
    // silently dropped the user back to the top on every switch back to the
    // tree — and the first scroll there overwrote the stored popup-reopen
    // position with a near-top value.
    register({
        id: 'tree', titleKey: 'viewTree', icon: VIEW_ICONS.tree,
        container: $('view-tree'), listEl: $('tree'), persistScroll: true
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
        focusEdgeRow,
        restoreFocusSpot,
        buildPathMap,
        setPathMap,
        pathOf,
        pathLabelOf,
        dateAddedOf,
        pathsReady,
        updateBadges,
        showItemPath: () => !!store.get('showItemPath', '1'),
        isAvailable: id => {
            const def = byId[id];
            return !!def && !def.disabled;
        },
        availableViews,
        viewMenuState,
        hideViewTab,
        disableView
    };
}
