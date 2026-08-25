/**
 * Popup auto-resize decision kernels (4.0.x), extracted from neat.js so the
 * vitest suites drive the REAL implementation instead of a copied kernel.
 * neat.js keeps the DOM / zoom measurement and the drag plumbing; the pure
 * grow / stay / shrink and width-clamp decisions live here. No chrome.* /
 * DOM references — directly unit-tested by tests/autoresize.test.js.
 */

// Height decision (resetHeight in neat.js):
//   clamped = clamp(contentH, minH, maxH)
//   userResized                      → STAY  (issue #51: a manual edge drag
//                                            suspends auto-height for the rest
//                                            of the session)
//   clamped > currentH               → GROW  (content outgrew the popup)
//   allowShrink && clamped <= currentH
//     && contentH <= maxH
//     && clamped < currentH * 0.7    → SHRINK (full tree fits, real waste)
//   else                             → STAY
export const decideHeight = ({ contentH, currentH, minH, maxH, allowShrink, userResized }) => {
    if (userResized)
        return { action: 'stay' };
    const clamped = Math.max(minH, Math.min(contentH, maxH));
    if (clamped > currentH)
        return { action: 'grow', target: clamped };
    if (allowShrink && clamped <= currentH && contentH <= maxH && clamped < currentH * 0.7)
        return { action: 'shrink', target: clamped };
    return { action: 'stay' };
};

export const RESIZE_HARD_MAX_WIDTH = 640;

// Width ceiling (onScreenMaxWidth in neat.js): the popup's moving edge may
// travel at most the screen room on its growth side, capped at the hard 640
// max — a wider popup pushes its resize handle off-screen.
export const decideWidthMax = ({ bodyWidth, leftRoom, rightRoom, hardMax = RESIZE_HARD_MAX_WIDTH }) =>
    Math.min(hardMax, bodyWidth + Math.max(leftRoom, rightRoom));

// Width clamp during the drag (pointerDragHandler in neat.js): 320 < width
// < maxResizeWidth, where maxResizeWidth was frozen at pointerdown from
// decideWidthMax.
export const clampDragWidth = (width, maxResizeWidth, hardMin = 320) =>
    Math.max(hardMin, Math.min(maxResizeWidth, width));

// Width-chase rule for the X drag (pointerDragHandler + the drag-window
// resize listener in resize.js). The native popup bubble follows the ROOT
// element's width ASYNCHRONOUSLY — writing the pointer target to root and
// body alike leaves the body detached from the still-wide visible edge for
// the frames the bubble needs to catch up: a right-edge blank strip across
// toolbar and list on fast compressions, and right-aligned header buttons
// oscillating against the visible edge (the 2026-08 resize-smoothness
// report; headless harness diag-r1-smooth.js reproduces the same geometry by
// freezing the root box one transition late — content tracks the target
// while root/viewport lag, then "fill back"). The fix splits the two roles:
// the root carries the target (drives the bubble), the body is pinned to the
// viewport the bubble has actually ACHIEVED until it catches up, so the
// visible content edge moves WITH the bubble instead of ahead of it. Only
// when the viewport reaches the target does the body snap to the exact
// target (eps covers device-pixel rounding).
export const chaseBodyWidth = (targetW, viewportW, eps = 0.5) =>
    Math.abs(viewportW - targetW) <= eps ? targetW : viewportW;

// Zoom level for a Ctrl/Cmd+wheel or Ctrl/Cmd++/-/0 delta (neat.js zoom()).
// 0 resets to the default → null. Otherwise ±10 steps clamped to [90, 150].
export const ZOOM_MIN = 90;
export const ZOOM_MAX = 150;
export const ZOOM_STEP = 10;
export const nextZoomLevel = (currentZoom, val) => {
    if (val === 0)
        return null;
    const z = (val > 0) ? currentZoom + ZOOM_STEP : currentZoom - ZOOM_STEP;
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
};

// rtl-aware horizontal drag delta (pointerDragHandler in neat.js). The popup
// grows away from its toolbar anchor; an rtl layout mirrors the sign.
export const dragWidthDelta = (screenX, startScreenX, rtl) =>
    rtl ? (screenX - startScreenX) : (startScreenX - screenX);

// The popup's max height: the physical 600px cap (Chrome's action-popup
// viewport), the screen room below the top edge, and a browser-zoom-scaled
// ceiling — shared by resetHeight and the vertical resize drag (a wrong
// shrink must not pin maxH to the shrunken height).
export const popupMaxHeight = (zoomFactor, screenHeight, windowScreenY) =>
    Math.min((600 / zoomFactor) - 1, screenHeight - windowScreenY - 50, 600);

// Clamp the dragged height to [maxHeight/2, maxHeight] (pointerDragHandler).
export const clampDragHeight = (height, maxHeight) =>
    Math.min(maxHeight, Math.max(maxHeight / 2, height));
