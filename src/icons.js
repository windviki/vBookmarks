/**
 * vBookmarks inline SVG icons (P4 — bitmap retirement).
 *
 * The shipped extension used to render folder rows and `javascript:`
 * bookmarklets with two 16px bitmaps (assets/icons/folder.png,
 * assets/icons/document-code.png). Per docs/现代化演进总方案.md they are
 * replaced by inline line-style SVG: 16px grid, 1.5px stroke,
 * stroke="currentColor", so the glyphs follow the theme through CSS
 * `color` (see .vbm-icon-* rules in css/neat.css / css/sync-styles.css)
 * and stay crisp on high-DPI screens.
 *
 * These are HTML strings (not elements) because every consumer builds
 * markup via innerHTML template literals. Keep them aria-hidden: the
 * adjacent <i> label already names the row.
 */

export const FOLDER_ICON =
    '<svg class="vbm-icon vbm-icon-folder" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14.67 12.67a1.33 1.33 0 0 1-1.33 1.33H2.67a1.33 1.33 0 0 1-1.34-1.33V3.33a1.33 1.33 0 0 1 1.34-1.33h3.33l1.33 2h6a1.33 1.33 0 0 1 1.34 1.33z"/>' +
    '</svg>';

export const DOCUMENT_CODE_ICON =
    '<svg class="vbm-icon vbm-icon-doc-code" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9.33 1.33H4a1.33 1.33 0 0 0-1.33 1.34v10.66A1.33 1.33 0 0 0 4 14.67h8a1.33 1.33 0 0 0 1.33-1.34V5.33z"/>' +
    '<polyline points="9.33 1.33 9.33 5.33 13.33 5.33"/>' +
    '<polyline points="7 8.5 5.75 9.75 7 11"/>' +
    '<polyline points="9.5 8.5 10.75 9.75 9.5 11"/>' +
    '</svg>';

// Folder twisty glyph (chevron-right; CSS rotates it 90° on .open rows and
// mirrors it for RTL). Lives inside <b class="twisty"> in folder rows —
// smaller optical size than the tile icons, so the stroke reads lighter.
export const CHEVRON_ICON =
    '<svg class="vbm-icon vbm-icon-chevron" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="6.25 4.25 10 8 6.25 11.75"/>' +
    '</svg>';

// View tab icons (v4 task 2) — one per view, 16px grid, 1.5px stroke, currentColor.
// Order matches the view registry: tree, search, recent, stats, dead, dupes.
export const VIEW_ICONS = {
    tree: '<svg class="vbm-icon vbm-icon-view" width="16" height="16" viewBox="0 0 16 16" ' +
        'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M2 3h5l2 2h5v8H2z"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="10.5" x2="10" y2="10.5"/>' +
        '</svg>',

    search: '<svg class="vbm-icon vbm-icon-view" width="16" height="16" viewBox="0 0 16 16" ' +
        'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="7" cy="7" r="4.7"/><line x1="10.3" y1="10.3" x2="13.6" y2="13.6"/>' +
        '</svg>',

    recent: '<svg class="vbm-icon vbm-icon-view" width="16" height="16" viewBox="0 0 16 16" ' +
        'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6"/><polyline points="8 4.5 8 8 10.5 10"/>' +
        '</svg>',

    stats: '<svg class="vbm-icon vbm-icon-view" width="16" height="16" viewBox="0 0 16 16" ' +
        'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
        '<line x1="2" y1="13.5" x2="14" y2="13.5"/><rect x="3" y="8" width="2.5" height="5.5"/><rect x="6.75" y="5" width="2.5" height="8.5"/><rect x="10.5" y="2" width="2.5" height="11.5"/>' +
        '</svg>',

    dead: '<svg class="vbm-icon vbm-icon-view" width="16" height="16" viewBox="0 0 16 16" ' +
        'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="8" cy="8" r="6"/><line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>' +
        '</svg>',

    dupes: '<svg class="vbm-icon vbm-icon-view" width="16" height="16" viewBox="0 0 16 16" ' +
        'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="3" y="2.5" width="9" height="11" rx="1"/><rect x="5.5" y="1" width="9" height="11" rx="1"/>' +
        '</svg>'
};

// Small utility icons used within view content (not tab bar)
export const CLOCK_ICON =
    '<svg class="vbm-icon vbm-icon-clock" width="12" height="12" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="6"/><polyline points="8 4.5 8 8 10.5 10"/>' +
    '</svg>';
