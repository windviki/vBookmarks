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

// Shrink-pace cap for the X drag (pointerDragHandler in resize.js). The
// native window follows the document's laid-out width ASYNCHRONOUSLY and
// ASYMMETRICALLY (user-measured on Chrome 151/dpr2 with
// scripts/console/probe-resize.js v3): growth applies with zero lag at any
// speed, while narrowing chases the preferred size at a rate proportional
// to the remaining distance (one commit ≈ 24ms). Two failure modes bracket
// the design space, both user-reported:
//  - uncapped: a fast fling (up to ~9.8k px/s) lets the content outrun the
//    window by v×τ — a 234px right-edge blank strip for ~55 frames (the
//    original "右缘弹开再填回" report);
//  - lead-starved (first fix attempt): keeping the document only 16px
//    narrower than the achieved viewport caps the whole pipeline at
//    ~16px/commit ≈ 660px/s — "慢动作不跟手", AND pinning the document TO
//    the achieved viewport deadlocks the shrink entirely (the popup sizes
//    from the CONTENT extent: content == viewport means the preferred size
//    never drops).
// The cap below sits between them: GROW takes the pointer target verbatim
// (that path has no lag to hide), SHRINK approaches it at CAP px/ms — the
// window follows at the same pace one commit behind, so the visible strip
// is bounded by CAP×τ (~58px) while the full 320px traverse completes in
// ~130ms. dtMs comes from the pointer event's timeStamp (coalesced or
// zero-delta events are clamped to [1, 100]ms so the step is never zero or
// unbounded).
export const DRAG_SHRINK_PX_PER_MS = 2.4;
export const pacedDragWidth = (targetW, appliedW, dtMs, rate = DRAG_SHRINK_PX_PER_MS) => {
    if (targetW >= appliedW)
        return targetW;
    const step = rate * Math.min(100, Math.max(1, dtMs || 1));
    return Math.max(targetW, appliedW - step);
};

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
