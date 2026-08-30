/**
 * Standalone custom-CSS editor page (4.1.1). The options page used to embed
 * one #userstyle textarea inline — pasting a large stylesheet deformed the
 * whole options layout — so the editor moved to its own page
 * (pages/custom-css.html), linked from the options page's custom-styles row.
 *
 * 4.1.1 shape (maintainer call): MULTIPLE named styles, each with a
 * description and an enable switch. Enabled styles apply IN TAB ORDER as
 * plain CSS cascade — a later enabled style overrides earlier ones — so
 * "conflict resolution" is the cascade itself (deterministic, explainable,
 * and composable: a base theme + a tweak patch stack cleanly).
 *
 * 4.1.1 rework (maintainer feedback): the first cut rendered the styles as a
 * selectable list above the editor — cramped layout, half-width inputs, and a
 * label-in-clickable-row checkbox whose activation raced the row re-render
 * (toggling enable via the label text could swallow the click). The rework is
 * a TAB workbench: one tab per style (enable shown as a dot on the tab, click
 * = select only), full-width name/description inputs, ◀/▶ buttons that
 * reorder the cascade, and the enable checkbox living in the editor header —
 * no interactive control is ever nested inside another one.
 *
 * Storage: `userstyles` (local, JSON array of {id,name,desc,css,enabled}) is
 * the source of truth; every change ALSO materializes the concatenation of
 * enabled styles into the legacy `userstyle` key — the popup/panel apply
 * side (src/userstyle.js) stays untouched, and a downgrade keeps the last
 * effective CSS. Legacy migration: a pre-4.1.1 single userstyle becomes one
 * enabled entry named by customCssUntitled.
 */
export const USERSTYLES_KEY = 'userstyles';
export const USERSTYLE_KEY = 'userstyle';

let styleSeq = 0;
export const newStyleId = () => `s${Date.now().toString(36)}${(styleSeq++).toString(36)}`;

// normalize one stored entry (unknown fields dropped, types coerced)
const normEntry = e => (e && typeof e === 'object')
    ? {
        id: String(e.id || newStyleId()),
        name: String(e.name || ''),
        desc: String(e.desc || ''),
        css: String(e.css || ''),
        enabled: e.enabled !== false
    }
    : null;

export const parseStyles = raw => {
    let list;
    try {
        list = JSON.parse(raw || '[]');
    } catch (err) {
        return [];
    }
    return Array.isArray(list) ? list.map(normEntry).filter(Boolean) : [];
};

// one-time legacy migration: the old single-string userstyle becomes the
// first enabled entry (only when no multi-style list exists yet)
export const migrateLegacy = (storedList, legacyCss, untitledName) => {
    if (storedList !== undefined && storedList !== null && storedList !== '')
        return null; // already migrated
    if (!legacyCss)
        return [];
    return [normEntry({ id: newStyleId(), name: untitledName || 'My style', desc: '', css: legacyCss, enabled: true })];
};

// the effective stylesheet: enabled, non-empty styles concatenated in list
// order (the cascade: later entries override earlier ones)
export const materialize = styles =>
    (styles || []).filter(s => s.enabled && String(s.css).trim())
        .map(s => String(s.css))
        .join('\n\n');

// pure reorder for the cascade: moves the style one slot along the list,
// returns null when the move would fall out of bounds (button disabled state)
export const moveStyle = (styles, id, delta) => {
    const i = (styles || []).findIndex(s => s.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= styles.length)
        return null;
    const out = styles.slice();
    [out[i], out[j]] = [out[j], out[i]];
    return out;
};

// after deleting styles[index], which style takes over the editor: the one
// that slid into its slot, else the previous tail, else nothing
export const pickNeighborId = (styles, index) =>
    (styles.length === 0)
        ? null
        : (styles[Math.min(index, styles.length - 1)] || {}).id || null;

export function initCustomCss(ctx = {}) {
    const doc = ctx.document || (typeof document !== 'undefined' ? document : null);
    const store = ctx.store || (typeof window !== 'undefined' ? window.store : null);
    if (!doc || !store)
        return;
    const $ = id => doc.getElementById(id);
    const _m = (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage)
        ? chrome.i18n.getMessage.bind(chrome.i18n)
        : (key => key);

    setText('custom-css-title', 'customCssTitle');
    setText('custom-css-desc', 'customCssDesc');
    setText('custom-css-order-note', 'customCssOrderNote');
    setText('custom-css-back', 'customCssBackToOptions');
    setText('custom-css-empty', 'customCssEmpty');
    setText('custom-css-enabled-text', 'customCssEnabled');
    const newBtn = $('custom-css-new');
    if (newBtn) {
        newBtn.textContent = '+';
        newBtn.title = _m('customCssNewStyle') || 'New style';
        newBtn.setAttribute('aria-label', _m('customCssNewStyle') || 'New style');
    }
    const delBtn = $('custom-css-del');
    if (delBtn)
        delBtn.textContent = _m('customCssDelete') || 'Delete';
    const moveL = $('custom-css-move-left');
    const moveR = $('custom-css-move-right');
    if (moveL) {
        moveL.textContent = '◀';
        moveL.title = _m('customCssMoveLeft') || 'Move left (applied earlier)';
        moveL.setAttribute('aria-label', moveL.title);
    }
    if (moveR) {
        moveR.textContent = '▶';
        moveR.title = _m('customCssMoveRight') || 'Move right (applied later)';
        moveR.setAttribute('aria-label', moveR.title);
    }
    if (doc.title !== undefined)
        doc.title = _m('customCssTitle') || 'Custom CSS';
    if (doc.body && doc.body.dataset)
        doc.body.dataset.theme = store.get('theme', 'auto');

    function setText(id, key) {
        const el = $(id);
        if (el)
            el.textContent = _m(key) || key;
    }

    // ---- model ----
    let styles = parseStyles(store.get(USERSTYLES_KEY));
    const migrated = migrateLegacy(store.get(USERSTYLES_KEY), store.get(USERSTYLE_KEY), _m('customCssUntitled'));
    if (migrated)
        styles = migrated;
    // always materialize once at boot: the legacy userstyle key must mirror
    // the enabled styles even when this page is the only writer that ever ran
    persist(false);
    let selectedId = styles.length ? styles[0].id : null;

    const status = $('custom-css-status');
    let statusTimer = null;
    const flashSaved = () => {
        if (!status)
            return;
        status.textContent = _m('customCssSaved') || 'Saved';
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => { status.textContent = ''; }, 2000);
    };

    function persist(notify = true) {
        store.set(USERSTYLES_KEY, JSON.stringify(styles));
        // the legacy key always carries the EFFECTIVE css — the apply side
        // (src/userstyle.js) and downgrades keep working unchanged
        store.set(USERSTYLE_KEY, materialize(styles));
        if (notify)
            flashSaved();
    }

    const selected = () => styles.find(s => s.id === selectedId) || null;
    const selectedIndex = () => styles.findIndex(s => s.id === selectedId);
    // tab lookup that tolerates DOM doubles without querySelector (tests)
    const qTab = id => (tabsEl && typeof tabsEl.querySelector === 'function')
        ? tabsEl.querySelector(`[data-style-id="${id}"]`)
        : null;

    // ---- tabs ----
    const tabsEl = $('custom-css-tabs');
    const emptyEl = $('custom-css-empty');
    function renderTabs() {
        if (!tabsEl)
            return;
        tabsEl.innerHTML = '';
        if (emptyEl)
            emptyEl.hidden = styles.length > 0;
        for (const st of styles) {
            const tab = doc.createElement('button');
            tab.type = 'button';
            tab.className = 'custom-css-tab' + (st.id === selectedId ? ' active' : '')
                + (st.enabled ? '' : ' off');
            tab.dataset.styleId = st.id;
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', st.id === selectedId ? 'true' : 'false');

            const dot = doc.createElement('span');
            dot.className = 'custom-css-tab-dot';
            dot.title = _m('customCssEnabled') || 'Enable';
            tab.appendChild(dot);

            const nameSpan = doc.createElement('span');
            nameSpan.className = 'custom-css-tab-name';
            nameSpan.textContent = st.name || (_m('customCssUntitled') || 'My style');
            tab.appendChild(nameSpan);

            tab.addEventListener('click', () => {
                if (selectedId !== st.id)
                    select(st.id);
            });
            tabsEl.appendChild(tab);
        }
    }

    // arrow-key tab navigation (the tab strip is one tablist)
    if (tabsEl) {
        tabsEl.addEventListener('keydown', e => {
            const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1
                : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
            if (!delta || !styles.length)
                return;
            e.preventDefault();
            let i = selectedIndex();
            if (delta === -Infinity)
                i = 0;
            else if (delta === Infinity)
                i = styles.length - 1;
            else
                i = Math.min(styles.length - 1, Math.max(0, i + delta));
            select(styles[i].id);
            const btn = qTab(styles[i].id);
            if (btn && btn.focus)
                btn.focus();
        });
    }

    function select(id) {
        selectedId = id;
        renderTabs();
        renderEditor();
    }

    // ---- editor ----
    const editorEl = $('custom-css-editor');
    const nameInput = $('custom-css-name');
    const descInput = $('custom-css-desc-input');
    const cssArea = $('custom-css-css');
    const enableCb = $('custom-css-enabled');

    let cm = null;
    if (typeof window !== 'undefined' && window.CodeMirror && cssArea) {
        cm = window.CodeMirror.fromTextArea(cssArea, {
            onChange: c => {
                if (editorSync)
                    return;
                const st = selected();
                if (st) {
                    st.css = c.getValue();
                    persist();
                }
            }
        });
    }

    let editorSync = false;
    function renderEditor() {
        const st = selected();
        if (editorEl)
            editorEl.hidden = !st;
        syncHeaderButtons(st);
        if (!st)
            return;
        editorSync = true;
        if (nameInput) {
            nameInput.value = st.name;
            nameInput.placeholder = _m('customCssName') || 'Name';
        }
        if (descInput) {
            descInput.value = st.desc;
            descInput.placeholder = _m('customCssDescLabel') || 'Description';
        }
        if (enableCb)
            enableCb.checked = st.enabled;
        if (cm)
            cm.setValue(st.css);
        else if (cssArea)
            cssArea.value = st.css;
        editorSync = false;
    }

    function syncHeaderButtons(st) {
        const i = st ? styles.indexOf(st) : -1;
        if (moveL)
            moveL.disabled = i <= 0;
        if (moveR)
            moveR.disabled = i < 0 || i >= styles.length - 1;
    }

    if (enableCb)
        enableCb.addEventListener('change', () => {
            const st = selected();
            if (st) {
                st.enabled = enableCb.checked;
                persist();
                renderTabs();
            }
        });

    if (nameInput)
        nameInput.addEventListener('input', () => {
            const st = selected();
            if (st && !editorSync) {
                st.name = nameInput.value;
                persist();
                // update the active tab label in place — no re-render while typing
                const span = qTab(st.id);
                const nameEl = span && span.querySelector
                    ? span.querySelector('.custom-css-tab-name') : null;
                if (nameEl)
                    nameEl.textContent = st.name || (_m('customCssUntitled') || 'My style');
            }
        });
    if (descInput)
        descInput.addEventListener('input', () => {
            const st = selected();
            if (st && !editorSync) {
                st.desc = descInput.value;
                persist();
            }
        });
    if (cssArea && !cm)
        cssArea.addEventListener('change', () => {
            const st = selected();
            if (st && !editorSync) {
                st.css = cssArea.value;
                persist();
            }
        });

    if (moveL)
        moveL.addEventListener('click', () => {
            const next = moveStyle(styles, selectedId, -1);
            if (next) {
                styles = next;
                persist();
                renderTabs();
                syncHeaderButtons(selected());
            }
        });
    if (moveR)
        moveR.addEventListener('click', () => {
            const next = moveStyle(styles, selectedId, 1);
            if (next) {
                styles = next;
                persist();
                renderTabs();
                syncHeaderButtons(selected());
            }
        });

    if (delBtn)
        delBtn.addEventListener('click', () => {
            const i = selectedIndex();
            if (i < 0)
                return;
            if (!(typeof confirm === 'function' ? confirm(_m('customCssDeleteConfirm') || 'Delete this style?') : true))
                return;
            styles = styles.filter(x => x.id !== selectedId);
            selectedId = pickNeighborId(styles, i);
            persist();
            renderTabs();
            renderEditor();
        });

    if (newBtn)
        newBtn.addEventListener('click', () => {
            const st = normEntry({
                id: newStyleId(),
                name: `${_m('customCssNewStyle') || 'New style'} ${styles.length + 1}`,
                desc: '', css: '', enabled: true
            });
            styles.push(st);
            selectedId = st.id;
            persist();
            renderTabs();
            renderEditor();
            if (nameInput)
                nameInput.focus();
        });

    renderTabs();
    renderEditor();
    return {
        get styles() { return styles; },
        get selectedId() { return selectedId; },
        persist,
        select,
        // editor bridge: reads/writes whichever editor is live (CodeMirror
        // hides the native textarea, so probes/tools must go through this)
        editor: {
            get: () => (cm ? cm.getValue() : (cssArea ? cssArea.value : '')),
            set: v => {
                if (cm)
                    cm.setValue(v);
                else if (cssArea)
                    cssArea.value = v;
            }
        }
    };
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    const boot = () => { window.__vbmCustomCss = initCustomCss(); };
    if (document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', boot, { once: true });
    else
        boot();
}
