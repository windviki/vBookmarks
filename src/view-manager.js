/**
 * View Manager — the view-system entry point (v4 task 2, slice A).
 *
 * Owns: the view registry (ViewDef array, order = tab order), the tab bar
 * DOM (#view-tabs, role="tablist") and its rendering, the single-view-at-a-time
 * state machine (activate/deactivate/dispatch), the activeView/viewState
 * persistence keys, Esc layering coordination and the shared parent-path map
 * (built from tree-render's nodeTrees for list-type views).
 *
 * Every module that used display:none swaps (search.js, palette dupes/dead
 * modes) is gradually migrated to views.activate(id).
 *
 * initViewManager(ctx) is called once by neat.js after treeView/treeRender
 * init. Returns { register, activate, dispatchEsc, getActiveId, getParentPathMap,
 *   setParentPathMap, isPanel, tabBar }.
 *
 * ctx.store       — settings mirror (activeView, viewState, showViewTabs)
 * ctx.treeRender  — tree-render.js API (getParentPath)
 * ctx.isPanel     — true when running in side panel mode
 */

import { VIEW_ICONS } from './icons.js';

export function initViewManager(ctx = {}) {
    const $ = id => document.getElementById(id);
    const store = ctx.store;
    const treeRender = ctx.treeRender;
    const IS_PANEL = ctx.isPanel || false;
    const _m = chrome.i18n.getMessage;

    // --- Registry -----------------------------------------------------------
    /** @type {Array<{id:string, titleKey:string, icon:string, slash:string, container:HTMLElement, badge:?()=>number, activate:(ctx)=>void, deactivate:(ctx)=>void, onEscape:?()=>boolean, listContainer:?HTMLElement}>} */
    const registry = [];
    let activeId = null;
    let sourceViewId = null; // view to return to on search clear

    // Shared parent-path map: id → parentId chain, rebuilt on tree generation.
    // List-type views (search, recent, stats, dead, dupes) read it for row
    // path labels; tree-render's generateNodeTrees fills it.
    let parentPathMap = {};
    let prevActiveViewBeforePalette = null;

    // --- Tab bar DOM --------------------------------------------------------
    const $tabs = $('view-tabs');
    const tabBar = $tabs; // exposed for keyboard.js to bind listeners

    // Build a single tab button
    const buildTab = (def, index) => {
        const btn = document.createElement('button');
        btn.setAttribute('role', 'tab');
        btn.id = `view-tab-${def.id}`;
        btn.dataset.viewId = def.id;
        btn.setAttribute('aria-label', _m(def.titleKey));
        btn.title = _m(def.titleKey);
        const icon = VIEW_ICONS[def.id] || '';
        btn.innerHTML = `${icon}<span class="tab-label">${_m(def.titleKey)}</span>`;
        // badge
        const badge = document.createElement('span');
        badge.className = 'tab-badge';
        badge.hidden = true;
        btn.appendChild(badge);
        btn.addEventListener('click', () => activate(def.id));
        return btn;
    };

    const refreshBadge = (def) => {
        const btn = document.getElementById(`view-tab-${def.id}`);
        if (!btn) return;
        const badge = btn.querySelector('.tab-badge');
        if (!badge || !def.badge) return;
        const count = def.badge();
        if (count && count > 0) {
            badge.textContent = count > 99 ? '99+' : String(count);
            badge.hidden = false;
        } else {
            badge.hidden = true;
        }
    };

    const refreshAllBadges = () => {
        for (const def of registry) {
            if (def.badge) refreshBadge(def);
        }
    };

    // Render the full tab bar from the registry
    const renderTabs = () => {
        $tabs.innerHTML = '';
        for (let i = 0; i < registry.length; i++) {
            $tabs.appendChild(buildTab(registry[i], i));
        }
        // Tab bar visibility controlled by showViewTabs setting
        updateTabBarVisibility();
    };

    const updateTabBarVisibility = () => {
        const show = store.get('showViewTabs', '1') !== 'false';
        $tabs.style.display = show ? '' : 'none';
    };

    const updateTabSelection = (id) => {
        const buttons = $tabs.querySelectorAll('[role="tab"]');
        for (const btn of buttons) {
            const selected = btn.dataset.viewId === id;
            btn.setAttribute('aria-selected', String(selected));
            btn.classList.toggle('active', selected);
        }
    };

    // --- State machine ------------------------------------------------------
    const activate = (id) => {
        if (id === activeId) return;
        const def = registry.find(d => d.id === id);
        if (!def) return;

        // Deactivate current
        if (activeId) {
            const prev = registry.find(d => d.id === activeId);
            if (prev && prev.deactivate) {
                prev.deactivate({ store, treeRender, parentPathMap });
            }
        }

        // Switch
        activeId = id;
        for (const d of registry) {
            if (d.container) {
                d.container.style.display = d.id === id ? '' : 'none';
            }
        }
        updateTabSelection(id);

        // Persist (popup always reverts to tree; panel persists)
        if (IS_PANEL) {
            store.set('activeView', id);
        }

        // Activate
        if (def.activate) {
            def.activate({ store, treeRender, parentPathMap });
        }

        // Refresh badges after view activation (dead/dupes may have loaded new data)
        setTimeout(() => refreshAllBadges(), 100);

        // aria-live announcement
        const announcer = $('view-announcer');
        if (announcer) {
            announcer.textContent = _m(def.titleKey);
        }
    };

    const getActiveId = () => activeId;

    // Register a view definition. Called once per view during init.
    const register = (def) => {
        registry.push(def);
        // If the container is a wrapper element, stash it
        if (!def.container) {
            def.container = $(`view-${def.id}`);
        }
    };

    // Initialize: render tabs from the registry, restore active view
    const init = () => {
        renderTabs();

        // Restore active view: tree for popup, persisted for panel
        const saved = IS_PANEL ? store.get('activeView', 'tree') : 'tree';
        // Ensure the saved view is registered
        const exists = registry.some(d => d.id === saved);
        activate(exists ? saved : 'tree');

        // Refresh tab badges after init (dead/dupes may load data asynchronously)
        setTimeout(() => refreshAllBadges(), 200);
    };

    // --- Esc layering -------------------------------------------------------
    // Called by keyboard.js's Escape handler. Each view's onEscape() can
    // consume the Escape before we fall through to "back to tree" / close.
    const dispatchEsc = () => {
        const def = registry.find(d => d.id === activeId);
        if (def && def.onEscape && def.onEscape()) {
            return true; // consumed by view
        }
        // Fallback: if not tree, go back to tree
        if (activeId !== 'tree') {
            activate('tree');
            return true; // consumed
        }
        return false; // let caller close popup
    };

    // --- Public API ---------------------------------------------------------
    const getParentPathMap = () => parentPathMap;

    const setParentPathMap = (map) => {
        parentPathMap = map || {};
        refreshAllBadges();
    };

    // Build parent path string for a bookmark id: "folderA / folderB"
    // Uses parentPathMap (id→parentId, built from tree-render's nodeTrees).
    // Resolves folder titles via chrome.bookmarks.get (batched async pattern).
    // Returns a placeholder format; titles are resolved at render time by the caller.
    const getParentPathString = (bookmarkId) => {
        const path = treeRender.getParentPath(bookmarkId, parentPathMap);
        // path is [rootId, ..., parentFolderId, bookmarkId]; skip roots and bookmark itself
        if (!path || path.length <= 2) return '';
        // Skip the first root element(s), skip the last (bookmark itself)
        const folderIds = path.slice(1, -1);
        // Filter to only nodes known in parentPathMap
        const known = folderIds.filter(id => id && parentPathMap[id] !== undefined);
        if (!known.length) return '';
        return known.join(' / '); // IDs joined; callers resolve titles via chrome.bookmarks.get
    };

    return {
        register,
        activate,
        dispatchEsc,
        getActiveId,
        getParentPathMap,
        setParentPathMap,
        getParentPathString,
        refreshAllBadges,
        isPanel: IS_PANEL,
        tabBar: $tabs,
        init
    };
}
