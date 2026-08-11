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
 */

export const applyUserStyle = (doc, value) => {
    if (!value || !doc || !doc.body || typeof doc.createElement !== 'function')
        return null;
    const style = doc.createElement('style');
    if (!style)
        return null;
    style.textContent = value;
    doc.body.appendChild(style);
    return style;
};
