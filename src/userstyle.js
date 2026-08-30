/**
 * Custom-styles application (v4).
 *
 * The options page stores user CSS under the `userstyle` key; the popup and
 * side panel inject it as a `<style>` appended to `<body>`. Because the body
 * `<style>` sits AFTER the `<head>` stylesheet links in document order, a
 * userstyle rule with specificity equal to a built-in neat.css rule wins the
 * cascade by source order — that is the whole point of the feature.
 *
 * Pure module (doc injected) so the contract is unit-testable: the SAVE side
 * lives in options.js, the APPLY side here. The options page itself does not
 * render the user's CSS (only the popup/panel surfaces do).
 *
 * CSP note: the manifest's style-src only allows 'self' + inline — a remote
 * `@import` inside the pasted CSS (e.g. a Google Fonts URL from a shared
 * theme) is BLOCKED by design, surfacing as a console CSP violation against
 * this page. Detect it here and say so plainly, instead of leaving the user
 * wondering why their font never loads.
 */

const REMOTE_IMPORT = /@import\s+(?:url\()?\s*['"]?https?:\/\//i;

export const applyUserStyle = (doc, value) => {
    if (!value || !doc || !doc.body || typeof doc.createElement !== 'function')
        return null;
    if (REMOTE_IMPORT.test(value)) {
        try {
            console.warn('[vBookmarks] custom CSS contains a remote @import — the extension CSP (style-src \'self\') blocks remote stylesheets, so that import is ignored. Inline the CSS (or embed the font as a data: URL) instead.');
        } catch (e) { /* console unavailable in some doubles — diagnosis is best-effort */ }
    }
    const style = doc.createElement('style');
    if (!style)
        return null;
    style.textContent = value;
    doc.body.appendChild(style);
    return style;
};
