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
