/**
 * Shared HTML escaping — the single source of truth (previously duplicated
 * across tree-render / dialogs / palette / search / view-recent / view-stats /
 * view-dupes / view-dead / palette-commands).
 *
 * Escapes the three characters that carry meaning in HTML text/attribute
 * contexts: <, >, ". `&` is deliberately NOT escaped so the function stays
 * idempotent — several callers (e.g. tree-render's highlightTitlePositions)
 * feed already-escaped fragments through it, and escaping `&` there would
 * corrupt `&lt;`/`&gt;`/`&quot;` into `&amp;lt;`. Completing `&` is a separate,
 * higher-risk change that needs a full rendering regression pass.
 *
 * `${s}` coerces null/undefined to a string so a missing title never throws.
 */
export const htmlspecialchars = s =>
    `${s}`.replace(/>/g, '&gt;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
