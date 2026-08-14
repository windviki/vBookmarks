/**
 * Shared HTML escaping — the single source of truth (previously duplicated
 * across tree-render / dialogs / palette / search / view-recent / view-stats /
 * view-dupes / view-dead / palette-commands).
 *
 * Escapes the four characters that carry meaning in HTML text/attribute
 * contexts: &, <, >, ". `&` must go FIRST in the chain so the replacements
 * below do not re-escape their own output (`&lt;` → `&amp;lt;`).
 *
 * Every caller feeds RAW text (bookmark titles/URLs, user input, _m()
 * messages) exactly once — the historical double-feed (generateHTML
 * pre-escaped titles and the row builders escaped them again) was removed
 * in 43442a6 ("转义下沉"), so the old "keep `&` unescaped for idempotency"
 * exemption is gone and the function is complete rather than idempotent.
 * Callers that assemble HTML out of escaped fragments (e.g. tree-render's
 * highlightTitlePositions wrapping <mark> tags) escape each raw piece, never
 * the assembled string.
 *
 * `${s}` coerces null/undefined to a string so a missing title never throws.
 */
export const htmlspecialchars = s =>
    `${s}`.replace(/&/g, '&amp;').replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
