/**
 * Option-boolean judgments, unified (2026-08 extraction). The options page
 * stores booleans in two conventions — '1'/'' for the regular switches,
 * 'true'/'false' for the sync-area settings (and a few regular ones). These
 * judgments used to live inline in neat.js where they were untestable; as
 * pure functions, a switch "going dead" is caught by the tests directly.
 * Each mirrors exactly the original inline expression's semantics.
 */

// autoResizePopup: off is stored as 'false'; anything else (default, 'true',
// even '') keeps auto-height enabled.
export const isAutoResizeEnabled = (value) => value !== 'false';

// highlightUnsynced (sync area): on is stored as the string 'true'.
export const shouldHighlightUnsynced = (value) => value === 'true';

// dontRememberState: on ('1') means do NOT remember the previous state;
// off/absent means remember (the default).
export const shouldRememberState = (value) => !value;
