/**
 * Standalone custom-CSS editor page (4.1.1). The options page used to embed
 * one #userstyle textarea inline — pasting a large stylesheet deformed the
 * whole options layout — so the editor moved to its own page
 * (pages/custom-css.html), linked from the options page's custom-styles row.
 *
 * 4.1.1 final shape (maintainer call): MULTIPLE named styles, each with a
 * description and an enable checkbox. Enabled styles apply IN LIST ORDER as
 * plain CSS cascade — a later enabled style overrides earlier ones — so
 * "conflict resolution" is the cascade itself (deterministic, explainable,
 * and composable: a base theme + a tweak patch stack cleanly).
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
    const newBtn = $('custom-css-new');
    if (newBtn)
        newBtn.textContent = _m('customCssNewStyle');
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

    // ---- list ----
    const listEl = $('custom-css-list');
    const emptyEl = $('custom-css-empty');
    function renderList() {
        if (!listEl)
            return;
        listEl.innerHTML = '';
        if (emptyEl)
            emptyEl.hidden = styles.length > 0;
        for (const st of styles) {
            const li = doc.createElement('li');
            li.className = 'custom-css-item' + (st.id === selectedId ? ' selected' : '');
            li.dataset.styleId = st.id;

            const label = doc.createElement('label');
            const cb = doc.createElement('input');
            cb.type = 'checkbox';
            cb.checked = st.enabled;
            cb.setAttribute('aria-label', _m('customCssEnabled') || 'Enable');
            cb.addEventListener('click', e => e.stopPropagation());
            cb.addEventListener('change', () => {
                st.enabled = cb.checked;
                persist();
            });
            label.appendChild(cb);

            const nameSpan = doc.createElement('span');
            nameSpan.className = 'custom-css-item-name';
            nameSpan.textContent = st.name || (_m('customCssUntitled') || 'My style');
            const descSpan = doc.createElement('span');
            descSpan.className = 'custom-css-item-desc';
            descSpan.textContent = st.desc || '';
            const textWrap = doc.createElement('span');
            textWrap.className = 'custom-css-item-text';
            textWrap.appendChild(nameSpan);
            if (st.desc)
                textWrap.appendChild(descSpan);
            label.appendChild(textWrap);
            li.appendChild(label);

            const del = doc.createElement('button');
            del.type = 'button';
            del.className = 'custom-css-del';
            del.textContent = _m('customCssDelete') || 'Delete';
            del.addEventListener('click', e => {
                e.stopPropagation();
                if (!(typeof confirm === 'function' ? confirm(_m('customCssDeleteConfirm') || 'Delete this style?') : true))
                    return;
                styles = styles.filter(x => x.id !== st.id);
                if (selectedId === st.id)
                    selectedId = styles.length ? styles[0].id : null;
                persist();
                renderList();
                renderEditor();
            });
            li.appendChild(del);

            // selecting a row loads it into the editor
            li.addEventListener('click', () => {
                selectedId = st.id;
                renderList();
                renderEditor();
            });
            listEl.appendChild(li);
        }
    }

    // ---- editor ----
    const editorEl = $('custom-css-editor');
    const nameInput = $('custom-css-name');
    const descInput = $('custom-css-desc-input');
    const cssArea = $('custom-css-css');
    const selected = () => styles.find(s => s.id === selectedId) || null;

    let cm = null;
    if (typeof window !== 'undefined' && window.CodeMirror && cssArea) {
        cm = window.CodeMirror.fromTextArea(cssArea, {
            onChange: c => {
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
        if (cm)
            cm.setValue(st.css);
        else if (cssArea)
            cssArea.value = st.css;
        editorSync = false;
    }

    if (nameInput)
        nameInput.addEventListener('input', () => {
            const st = selected();
            if (st && !editorSync) {
                st.name = nameInput.value;
                persist();
                renderList();
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
            renderList();
            renderEditor();
            if (nameInput)
                nameInput.focus();
        });

    renderList();
    renderEditor();
    return {
        get styles() { return styles; },
        get selectedId() { return selectedId; },
        persist,
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
