/**
 * Tool button (⋮) in the popup header: opens the command palette for feature
 * discovery — dead-link scan, duplicate cleanup, session save, and all slash
 * commands. v4 task-3 #20: hidden when showToolButton is off, or when the
 * palette itself is disabled (the button's only job is opening it). Extracted
 * from neat.js so the visibility rule is directly testable.
 *
 * deps: store, toolBtn (or null — the header row may omit it), palette, _m.
 */
export const createToolButton = ({ store, toolBtn, palette, _m }) => {
    if (!toolBtn)
        return;
    if (!store.get('showToolButton', '1') || !store.get('paletteEnabled', '1'))
        toolBtn.classList.add('hidden');
    toolBtn.title = _m('toolButtonTitle');
    toolBtn.addEventListener('click', () => palette.open());
};
