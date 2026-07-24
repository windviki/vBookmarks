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

// v4 task-2: one 16px line icon per view tab (docs/v4task-2.md §3.2). Same
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
        '<path d="M10.7 5.3V3.7a1.33 1.33 0 0 0-1.34-1.33H4a1.33 1.33 0 0 0-1.33 1.33v5.34A1.33 1.33 0 0 0 4 10.37h1.3"/>')
};
