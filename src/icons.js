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

// Default bookmark glyph (document with a folded top-right corner): replaces
// the browser's stock no-favicon placeholder — a flat bitmap drawn for light
// backgrounds (gray globe on Chrome, a darker document glyph on Edge) that
// nearly vanishes on the dark/ink themes (the 4.0.1 brightness lift was only
// a partial fix, and each browser serves a different gray). Same 16px line
// grid, currentColor → follows the theme exactly like FOLDER_ICON; the
// silhouette matches DOCUMENT_CODE_ICON minus the code brackets.
// favicon-fallback.js swaps it in when an <img> matches the calibrated
// placeholder fingerprint.
export const DEFAULT_BOOKMARK_ICON =
    '<svg class="vbm-icon vbm-icon-doc" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9.33 1.33H4a1.33 1.33 0 0 0-1.33 1.34v10.66A1.33 1.33 0 0 0 4 14.67h8a1.33 1.33 0 0 0 1.33-1.34V5.33z"/>' +
    '<polyline points="9.33 1.33 9.33 5.33 13.33 5.33"/>' +
    '</svg>';

// Dupes-view per-group "apply dedup" action: a completed-check badge on the
// same 16px line grid as FOLDER_ICON (1.5px stroke, currentColor), replacing
// the old text "✓" glyph so the row action matches the tile icons' style.
export const CHECK_ICON =
    '<svg class="vbm-icon vbm-icon-check" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="8" cy="8" r="5.6"/>' +
    '<polyline points="5.4 8.2 7.1 9.9 10.7 6.1"/>' +
    '</svg>';

// Bookmark star, hollow (line) form: the quick-add header button and the
// stats view's one-click "add this history row" action share it. The filled
// form (STAR_ICON_FILLED) marks the already-bookmarked state in the stats
// view and the quick-add button's .starred state — one glyph, two states.
const STAR_PATH = 'M8 1.7l1.9 3.9 4.3.6-3.1 3 .7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z';
export const STAR_ICON =
    '<svg class="vbm-icon vbm-icon-star" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">' +
    `<path d="${STAR_PATH}"/>` +
    '</svg>';
export const STAR_ICON_FILLED =
    '<svg class="vbm-icon vbm-icon-star vbm-icon-star-filled" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" aria-hidden="true">' +
    `<path d="${STAR_PATH}"/>` +
    '</svg>';

// Dead-view row actions, same 16px line grid: the mark toggle is a flag
// (colored by the theme accent, danger once marked) and the delete button is
// a trash can (always danger — destructive). Both follow currentColor so the
// danger/accent tokens decide the actual color.
export const FLAG_ICON =
    '<svg class="vbm-icon vbm-icon-flag" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="3.5" y1="1.5" x2="3.5" y2="14.5"/>' +
    '<path d="M3.5 2.5h7.6l-1.8 2.1 1.8 2.1H3.5"/>' +
    '</svg>';
export const TRASH_ICON =
    '<svg class="vbm-icon vbm-icon-trash" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 4.5h10"/>' +
    '<path d="M6 4.5V3.2a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.3"/>' +
    '<path d="M4.4 4.5l.6 8.1a1.2 1.2 0 0 0 1.2 1.1h3.6a1.2 1.2 0 0 0 1.2-1.1l.6-8.1"/>' +
    '</svg>';

// Tab-groups view status glyph: pinned tab (push-pin).
export const PIN_ICON =
    '<svg class="vbm-icon vbm-icon-pin" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M6 7.2v4.3L4.8 13h6.4L10 11.5V7.2l3.2-3.2H2.8L6 7.2z"/>' +
    '</svg>';

// Tab-groups view row/group actions (16px line grid, same recipe).
export const EDIT_ICON =
    '<svg class="vbm-icon vbm-icon-edit" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 13.5h11"/>' +
    '<path d="M9.2 2.9a1.5 1.5 0 0 1 2.1 2.1l-5.6 5.6-2.7.6.6-2.7z"/>' +
    '</svg>';

export const SLEEP_ICON =
    '<svg class="vbm-icon vbm-icon-sleep" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M10.8 2.3a5.6 5.6 0 0 0-7 7 4.7 4.7 0 1 0 7-7z"/>' +
    '<path d="M8.2 9.6l1.4 1.8H7.8"/>' +
    '</svg>';

export const ACTIVATE_ICON =
    '<svg class="vbm-icon vbm-icon-activate" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 8h11"/>' +
    '<polyline points="9.5 4 13.5 8 9.5 12"/>' +
    '</svg>';

// Tab-groups view toolbar glyphs: fold all / unfold all (double chevrons
// stacked so "all" reads as two rows, not one).
export const COLLAPSE_ALL_ICON =
    '<svg class="vbm-icon vbm-icon-collapse-all" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="4 9 8 5 12 9"/>' +
    '<polyline points="4 13 8 9 12 13"/>' +
    '</svg>';

export const EXPAND_ALL_ICON =
    '<svg class="vbm-icon vbm-icon-expand-all" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="4 5 8 9 12 5"/>' +
    '<polyline points="4 9 8 13 12 9"/>' +
    '</svg>';

// Dead-view toolbar glyphs (4.0.8): redo, list-with-x, flag-with-x and
// selection-mode. Same 16px grid / 1.5px stroke / currentColor recipe.
export const REDO_ICON =
    '<svg class="vbm-icon vbm-icon-redo" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M13.8 6.2H6a3.8 3.8 0 0 0 0 7.6h2.2"/>' +
    '<polyline points="11 3.2 13.8 6.2 11 9.2"/>' +
    '</svg>';

export const LIST_X_ICON =
    '<svg class="vbm-icon vbm-icon-list-x" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M2.5 4.2h11M2.5 8h11M2.5 11.8h6"/>' +
    '<path d="M11.6 10.8l3.2 3.2M14.8 10.8l-3.2 3.2"/>' +
    '</svg>';

export const FLAG_X_ICON =
    '<svg class="vbm-icon vbm-icon-flag-x" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="3.5" y1="1.5" x2="3.5" y2="14.5"/>' +
    '<path d="M3.5 2.5h7.6l-1.8 2.1 1.8 2.1H3.5" fill="currentColor" stroke="currentColor"/>' +
    '<path d="M11.8 10.8l3 3M14.8 10.8l-3 3"/>' +
    '</svg>';

export const SELECT_ICON =
    '<svg class="vbm-icon vbm-icon-select" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="2"/>' +
    '<polyline points="5.4 8 7.1 9.7 10.6 6.2"/>' +
    '</svg>';

// Folder twisty glyph (chevron-right; CSS rotates it 90° on .open rows and
// mirrors it for RTL). Lives inside <b class="twisty"> in folder rows —
// smaller optical size than the tile icons, so the stroke reads lighter.
export const CHEVRON_ICON =
    '<svg class="vbm-icon vbm-icon-chevron" width="16" height="16" viewBox="0 0 16 16" ' +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<polyline points="6.25 4.25 10 8 6.25 11.75"/>' +
    '</svg>';

// v4 task-2: one 16px line icon per view tab (docs/plan-4.0.0/v4task-2.md §3.2). Same
// grid/stroke recipe as the tile icons above; colored by the tab's CSS
// `color` (muted normally, accent when selected). The search glyph matches
// the header search box on purpose — same search, two entry points.
const viewIcon = (cls, inner) =>
    `<svg class="vbm-icon vbm-icon-view-${cls}" width="16" height="16" viewBox="0 0 16 16" ` +
    'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    inner + '</svg>';

export const VIEW_ICONS = {
    tree: viewIcon('tree',
        '<circle cx="8" cy="3.1" r="1.6"/>' +
        '<path d="M8 4.7v2.6M8 7.3H4.4v2.4M8 7.3h3.2v2.4"/>' +
        '<circle cx="4.4" cy="11.3" r="1.6"/>' +
        '<circle cx="11.6" cy="11.3" r="1.6"/>'),
    search: viewIcon('search',
        '<circle cx="7" cy="7" r="4.7"/>' +
        '<line x1="10.3" y1="10.3" x2="13.6" y2="13.6"/>'),
    recent: viewIcon('recent',
        '<circle cx="8" cy="8" r="5.8"/>' +
        '<polyline points="8 4.8 8 8 10.4 9.6"/>'),
    stats: viewIcon('stats',
        '<path d="M2.7 13.3h10.6"/>' +
        '<line x1="4.7" y1="10" x2="4.7" y2="13.3"/>' +
        '<line x1="8" y1="5.3" x2="8" y2="13.3"/>' +
        '<line x1="11.3" y1="8" x2="11.3" y2="13.3"/>'),
    dead: viewIcon('dead',
        '<path d="M6.2 9.8a2.6 2.6 0 0 1-3.7 0l-.6-.6a2.6 2.6 0 0 1 3.7-3.7"/>' +
        '<path d="M9.8 6.2a2.6 2.6 0 0 1 3.7 0l.6.6a2.6 2.6 0 0 1-3.7 3.7"/>'),
    dupes: viewIcon('dupes',
        '<rect x="5.3" y="5.3" width="8" height="8" rx="1.3"/>' +
        '<path d="M10.7 5.3V3.7a1.33 1.33 0 0 0-1.34-1.33H4a1.33 1.33 0 0 0-1.33 1.33v5.34A1.33 1.33 0 0 0 4 10.37h1.3"/>'),
    tabgroups: viewIcon('tabgroups',
        '<rect x="2.5" y="3" width="11" height="10" rx="1.5"/>' +
        '<path d="M6 3h4a2 2 0 0 1 2 2v5.5"/>' +
        '<circle cx="8" cy="8" r="1.4"/>')
};
