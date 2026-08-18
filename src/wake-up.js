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
    // Defer opening until the popup document actually has focus; otherwise a
    // focusout guard (palette.js closes on focus loss) can swallow the open
    // immediately after a cold popup navigation. Falls back after 5s in case
    // the embedder never reports focus (headless / tests without document).
    const openWhenFocused = () => {
        let tries = 0;
        const attempt = () => {
            const focused = typeof document === 'undefined'
                || !document.hasFocus || document.hasFocus();
            if (focused && tries === 0 && typeof document !== 'undefined') {
                // One tick after the popup document reports focus — a cold
                // navigation can still fire a focusout that swallows an
                // immediate open. The fallback below covers the rest.
                tries++;
                setTimeout(attempt, 100);
                return;
            }
            if (focused || tries >= 50) {
                palette.open();
                return;
            }
            tries++;
            setTimeout(attempt, 100);
        };
        attempt();
    };
    if (hasPaletteQuery) {
        openWhenFocused();
        // Consume a stale flag too, so the next plain popup open stays clean.
        chrome.storage.session.remove('pendingPaletteOpen');
    } else {
        chrome.storage.session.get('pendingPaletteOpen', v => {
            if (v && v.pendingPaletteOpen) {
                openWhenFocused();
                chrome.storage.session.remove('pendingPaletteOpen');
            }
        });
    }
};
