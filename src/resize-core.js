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

// Width-pace rule for the X drag (pointerDragHandler + the drag-window
// resize listener in resize.js). The native popup bubble follows the
// document's laid-out width ASYNCHRONOUSLY, and asymmetrically: it grows
// with zero lag but narrows through a visible chase (user-measured on
// Chrome 151/dpr2 with scripts/console/probe-resize.js v3: bubbleLag up to
// 235px and a 234px right-edge blank strip for ~55 frames during a fast
// compression — the "右缘弹开再填回" report). Writing the raw pointer
// target to the document on every move lets the content outrun the bubble
// by exactly that lag. The rule below paces the DOCUMENT instead: while
// the achieved viewport is still wider than the target, the document stays
// only LEAD px narrower than the viewport — far enough that the popup's
// preferred size keeps pulling the bubble down (the shrink engine), close
// enough that the visible blank strip is bounded by LEAD instead of the
// full lag. The pointer target is taken verbatim as soon as the viewport
// is within LEAD of it (grow, and slow drags, behave like the unpaced
// code).
//
// Regression note (2026-08, first attempt, user-reported "可以拉伸但无法
// 缩短"): pinning the body TO the achieved viewport (body == innerWidth)
// deadlocks the shrink on real Chrome — the popup sizes from the CONTENT
// extent (the max of the root box and the overflowing body), so content ==
// viewport means the preferred size never drops and the bubble never
// narrows. Headless Chromium instead follows the ROOT element's box (the
// harness evidence that misled the first design), which is why the Docker
// diag could not catch it. The document must stay strictly narrower than
// the viewport for the window to shrink at all.
export const CHASE_LEAD_PX = 16;
export const chaseBodyWidth = (targetW, viewportW, lead = CHASE_LEAD_PX) =>
    Math.max(targetW, viewportW - lead);

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
