/**
 * Command-palette global wake-up (v4 task-2): the background's
 * `open-command-palette` command (Ctrl/Cmd+Shift+K) opens the popup with
 * either the `?palette=1` fallback-window query or a `pendingPaletteOpen`
 * session-storage flag (the chrome.action.openPopup path). This module
 * consumes both and opens the palette, then clears the flag so the next
 * plain popup open stays clean. Extracted from neat.js for direct testing.
 *
 * deps: palette (open/close), chrome.storage.session, and the already-parsed
 * hasPaletteQuery boolean (neat.js reads window.location.search).
 */
export const initWakeUp = ({ palette, chrome, hasPaletteQuery }) => {
    if (hasPaletteQuery) {
        palette.open();
        // Consume a stale flag too, so the next plain popup open stays clean.
        chrome.storage.session.remove('pendingPaletteOpen');
    } else {
        chrome.storage.session.get('pendingPaletteOpen', v => {
            if (v && v.pendingPaletteOpen) {
                palette.open();
                chrome.storage.session.remove('pendingPaletteOpen');
            }
        });
    }
};
