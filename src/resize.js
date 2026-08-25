/**
 * Popup resize + zoom layer (extracted from neat.js).
 *
 * Owns the three size-related behaviors that share one session flag:
 *  - auto-height (resetHeight): grow on tree interaction, shrink only on the
 *    initial load; stands down after a manual edge drag (issue #51);
 *  - the width/height edge-drag resizers: pointer events + capture (a popup
 *    widens LEFTWARD from its toolbar anchor, so the drag must survive the
 *    pointer leaving the window) with screen-edge clamps frozen at
 *    pointerdown. The width drag is PACED against the native window: the
 *    popup follows the document's laid-out width asynchronously (grow is
 *    instant, narrow lags — user-measured up to 235px), so root and body
 *    both take chaseBodyWidth's bounded-lead value instead of the raw
 *    pointer target — the shrink keeps its preferred-size pressure while
 *    the visible right-edge strip stays bounded by the LEAD constant, and
 *    an end-of-drag watchdog guarantees the document converges to the
 *    stored target even if the viewport stalls (chaseBodyWidth in
 *    resize-core.js);
 *  - the extension zoom (Ctrl/Cmd+wheel, Ctrl/Cmd +/-/0).
 * The pure decisions (grow/stay/shrink, drag clamps, zoom steps) live in
 * resize-core.js; this module is only the DOM/chrome wiring around them.
 *
 * initResize(ctx) is called once by neat.js where the auto-height code used
 * to live — store/body/tree/views/menus/search all exist by then; treeView
 * and dnd init further below and reach this module through ctx getters that
 * only run at event time (TDZ-safe, same pattern as the menus ctx).
 *
 * ctx.store      — settings store (autoResizePopup/zoom/popupWidth/
 *                  popupHeight, flush() at drag end)
 * ctx.body       — document.body (height/width writes, dataset.zoom)
 * ctx.tree       — the #tree element (content measurement, click/keyup grow)
 * ctx.views      — the #views element (chrome-above-the-list measurement)
 * ctx.isPanel    — panel mode: no auto-height
 * ctx.rtl        — right-to-left layout (drag delta mirroring)
 * ctx.search     — the search module API (isActive gates the initial call)
 * ctx.clearMenu  — menus.clearMenu (an open context menu closes on drag)
 * ctx.treeView   — lazy getter → treeView (adaptBookmarkTooltips at drag end;
 *                  may be absent in minimal test setups)
 * ctx.isDragging — lazy getter → dnd.isDragging() (the zoom guard; may be
 *                  absent in minimal test setups)
 *
 * Returns { resetHeight, zoom } — neat.js only needs the init-time wiring;
 * the handles exist so the vitest suite can drive both directly.
 * window/document/screen/chrome.tabs.getZoom remain page globals.
 */
import {
    decideHeight, decideWidthMax, clampDragWidth, nextZoomLevel,
    dragWidthDelta, popupMaxHeight, clampDragHeight, chaseBodyWidth
} from './resize-core.js';
import { isAutoResizeEnabled } from './settings.js';

export function initResize(ctx = {}) {
    const store = ctx.store;
    const body = ctx.body;
    const $tree = ctx.tree;
    const $views = ctx.views;
    const IS_PANEL = ctx.isPanel;
    const rtl = ctx.rtl;
    const search = ctx.search;
    const clearMenu = ctx.clearMenu;

    // Popup auto-height — only grow, never shrink on user interaction.
    // Shrinking on folder collapse is jarring ("popup jumps"): the user
    // toggled a folder, they didn't ask the window to resize. The popup
    // height only shrinks on the initial load (fresh viewport);
    // interaction-triggered calls only grow. When autoResizePopup is off
    // the popup keeps its saved / default height unconditionally.
    const autoResizeEnabled = () => isAutoResizeEnabled(store.get('autoResizePopup'));
    // issue #51: the user dragging the popup's bottom edge is an explicit size
    // intent. Auto-height must then step back — otherwise the next tree click
    // re-grows the popup to the content height, so the manual shrink "resets"
    // and the window can only ever get bigger. The flag is session-scoped (the
    // popup page reloads each open); a fresh open restores the saved height.
    let userResizedHeight = false;
    const resetHeight = (allowShrink) => {
        if (IS_PANEL)
            return;
        if (!autoResizeEnabled())
            return;
        if (userResizedHeight)
            return;
        // The content height is the TREE's — but when another view (search /
        // stats / dead / dupes) is active, #view-tree is display:none and
        // $tree.scrollHeight reads 0. Measuring that here would clamp contentH
        // to the 300px minH floor and (with allowShrink) shrink the popup to
        // 300px, persisting a height the resizer can then never grow past.
        // Skip the whole measurement unless the tree is actually laid out.
        if ($tree.offsetParent === null)
            return;

        const zoomLevel = store.get('zoom') ? parseInt(store.get('zoom'), 10) / 100 : 1;
        // scrollHeight captures the full scrollable content (recent section +
        // main tree), unlike firstElementChild.offsetHeight which only measures
        // the first child and misses the bulk of a long bookmark tree.
        // v4 task-2: #tree now lives inside #views > section, so the chrome
        // above the list (search bar + tab strip) is measured from #views.
        const contentH = ($tree.scrollHeight + $views.offsetTop + 16) * zoomLevel;
        const currentH = body.offsetHeight;
        chrome.tabs.getZoom(zoomFactor => {
            const minH = Math.max(300 / zoomFactor, 200);
            // body 高度上限：屏幕剩余空间、popup 物理上限。`600` 是 Chrome 对
            // action popup 视口的常量上限（popup.js 恢复时也 clamp 到 600），
            // 用它替代 window.innerHeight：innerHeight 反映的是 popup 的“当前”
            // 高度——一次错误的 shrink 到 300 会让它也是 300，把 maxH 钉死
            // 在 300（300 锁）。常量 600 不随当前高度收缩，同时兜住浏览器
            // zoom<1 时 `600/zoomFactor-1`（如 0.9 → 666）高估 Chrome 视口的
            // 双滚动条问题（commit 7fea4d1）。
            const maxH = popupMaxHeight(zoomFactor, screen.height, window.screenY);
            // The grow / stay / shrink decision is pure — see resize-core.js
            // (tests drive the real kernel). Stay put when the content is
            // shorter but the popup is a comfortable size: never shrink on
            // folder toggle events.
            const decision = decideHeight({
                contentH, currentH, minH, maxH, allowShrink, userResized: userResizedHeight
            });
            if (decision.action === 'stay')
                return;
            body.style.transitionDuration = decision.action === 'grow' ? '.3s' : '.15s';
            body.style.height = `${decision.target}px`;
            store.set('popupHeight', decision.target);
        });
    };

    if (!search.isActive())
        resetHeight(true);

    // Interaction-triggered calls never shrink — only grow.
    $tree.addEventListener('click', () => resetHeight(false));
    $tree.addEventListener('keyup', () => resetHeight(false));

    // Resizer
    const $resizerx = document.getElementById('resizer-x');
    const $resizery = document.getElementById('resizer-y');
    let resizerXDown = false;
    let resizerYDown = false;
    // The drag's viewport-zoom-adjusted height ceiling, resolved lazily on
    // the first Y move (async getZoom) and cleared at every drag end by
    // resetDragState — a stale ceiling must never leak into the next drag.
    let currentMaxHeight = 0;
    let bodyWidth = 0,
        bodyHeight = 0,
        screenX = 0,
        screenY = 0;

    // Width-chase state (see chaseBodyWidth in resize-core.js): the pointer
    // TARGET the user is dragging toward, which the document approaches at a
    // bounded LEAD ahead of the viewport the native bubble has actually
    // achieved. Non-zero from the first X move until the achieved viewport
    // reaches the target; the resize listener below re-paces the document on
    // every viewport step in between (also after pointerup — the bubble keeps
    // moving through the drag's tail frames).
    let widthChase = 0;
    let chaseWatchdog = 0;
    const applyWidthChase = () => {
        if (!widthChase)
            return;
        const w = chaseBodyWidth(widthChase, window.innerWidth);
        // Both elements carry the paced width: the popup's preferred size is
        // the CONTENT extent (the max of the root box and the overflowing
        // body — see the regression note in resize-core.js), so pacing only
        // one of them either deadlocks the shrink or detaches the content.
        document.documentElement.style.width = `${w}px`;
        body.style.width = `${w}px`;
        if (window.innerWidth <= widthChase + 0.5) {
            widthChase = 0; // caught up — rest state: body == root == stored
            if (chaseWatchdog) { clearTimeout(chaseWatchdog); chaseWatchdog = 0; }
        }
    };
    window.addEventListener('resize', applyWidthChase);

    // Drag the edge — POINTER events + capture (4.0.1 regression gate).
    // A Chrome popup grows LEFTWARD from its toolbar anchor, so a widen drag
    // pushes the pointer out of the popup window. The drag must therefore be
    // driven by pointer events (capture keeps move/up flowing even outside the
    // window); the old mousemove/mouseup on document stopped at the window
    // edge, and a lost mouseup wedged `resizerXDown` — the next mousemove
    // resized from a stale baseline (the reported "can't narrow after
    // widening" regression). pointercancel / window blur also clear the state
    // so a cancelled drag can never leave the next mousemove hijacking width.
    const resetDragState = () => {
        resizerXDown = false;
        resizerYDown = false;
        currentMaxHeight = 0; // a cancelled/ended drag's ceiling must not leak
        // Drag end while the bubble already caught up: settle the document to
        // the exact target now. If it is still mid-chase, widthChase stays
        // armed — the resize listener keeps pacing the document through the
        // tail frames — and the watchdog below guarantees convergence: if the
        // viewport ever stalls above the target (no further resize steps),
        // snap the document to the stored target so the popup can never rest
        // wider than the width the user chose.
        applyWidthChase();
        if (widthChase) {
            if (chaseWatchdog)
                clearTimeout(chaseWatchdog);
            const target = widthChase;
            const docEl = document.documentElement;
            chaseWatchdog = setTimeout(() => {
                chaseWatchdog = 0;
                if (widthChase !== target)
                    return; // a newer drag owns the state now
                widthChase = 0;
                docEl.style.width = `${target}px`;
                body.style.width = `${target}px`;
            }, 800);
        }
        // Commit the final size synchronously: popup pagehide is NOT
        // guaranteed on close, so the debounced store write could be lost if
        // the popup closes right after the drag (the "widened but next open is
        // the default width" half of the regression).
        store.flush();
        const treeView = ctx.treeView;
        if (treeView)
            treeView.adaptBookmarkTooltips();
    };
    const capturePointer = e => {
        if (e.target.setPointerCapture)
            try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    };
    const releasePointer = e => {
        if (e.target.releasePointerCapture && e.pointerId != null)
            try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    $resizerx.addEventListener('pointerdown', e => {
        capturePointer(e);
        e.preventDefault();
        e.stopPropagation();
        resizerXDown = true;
        // A new drag owns the width now: cancel any pending convergence
        // watchdog left by the previous drag's tail.
        if (chaseWatchdog) { clearTimeout(chaseWatchdog); chaseWatchdog = 0; }
        bodyWidth = body.offsetWidth;
        screenX = e.screenX;
        maxResizeWidth = onScreenMaxWidth();
    });
    $resizery.addEventListener('pointerdown', e => {
        capturePointer(e);
        e.preventDefault();
        e.stopPropagation();
        resizerYDown = true;
        bodyHeight = body.offsetHeight;
        screenY = e.screenY;
    });
    $resizerx.addEventListener('pointerup', releasePointer);
    $resizery.addEventListener('pointerup', releasePointer);

    // The popup's moving edge must never leave the screen — and must keep a
    // grabbable margin so the resize handle itself never flushes against the
    // screen edge (a handle pinned at x=0 is nearly impossible to grab back,
    // the "hard to narrow after widening" symptom). At pointerdown we freeze
    // how far the edge may still travel.
    const RESIZE_EDGE_MARGIN = 24;
    let maxResizeWidth = 640;
    const onScreenMaxWidth = () => {
        const curW = window.innerWidth || body.offsetWidth;
        const leftRoom = Math.max(0, (window.screenX || 0) - RESIZE_EDGE_MARGIN);
        const rightRoom = (window.screen && screen.availWidth)
            ? Math.max(0, screen.availWidth - ((window.screenX || 0) + curW) - RESIZE_EDGE_MARGIN)
            : 0;
        return decideWidthMax({ bodyWidth, leftRoom, rightRoom });
    };
    function pointerDragHandler(e) {
        if (!resizerXDown && !resizerYDown)
            return;
        e.preventDefault();
        const isX = resizerXDown;
        const isDragEnd = e.type === 'pointerup' || e.type === 'pointercancel';
        if (isX) {
            // record current width (rtl-aware delta — resize-core.js)
            const changedWidth = dragWidthDelta(e.screenX, screenX, rtl);
            let width = bodyWidth + changedWidth;
            // 320 < width < 640, and never wider than the screen leaves room
            // for (a wider popup pushes its resize handle off-screen).
            width = clampDragWidth(width, maxResizeWidth);
            // The popup window sizes from the document's laid-out width
            // (max of the root box and the overflowing body) and follows it
            // ASYNCHRONOUSLY — growing with no lag but narrowing through a
            // visible chase. Writing the raw target every move lets the
            // content outrun the window edge by the full lag (the "右缘弹开
            // 再填回" strip; right-aligned header buttons oscillating against
            // the visible edge). Both elements instead take the PACED width
            // (chase rule, resize-core.js): never more than LEAD px narrower
            // than the viewport the window has achieved, so the shrink keeps
            // its preferred-size pressure while the visible strip stays
            // bounded — and the pointer target is taken verbatim the moment
            // the window is within LEAD of it (grow / slow drags: unpaced).
            widthChase = width;
            applyWidthChase();
            store.set('popupWidth', width);
            clearMenu();
        } else {
            // record current height
            // issue #51: any vertical drag is an explicit size choice — from
            // here on the auto-height logic backs off (see resetHeight).
            userResizedHeight = true;
            const changedHeight = e.screenY - screenY;
            let height = bodyHeight + changedHeight;
            // 240 < height < 600
            if (currentMaxHeight <= 0) {
                chrome.tabs.getZoom(zoomFactor => {
                    // The drag may have ended (or been cancelled) while this
                    // answer was in flight — applying a clamp now would write
                    // AFTER resetDragState's final flush and leave a stale
                    // ceiling behind for the next drag.
                    if (!resizerYDown)
                        return;
                    // 同 resetHeight：上限是 popup 物理上限(常量 600)与屏幕余量，
                    // 而非 window.innerHeight（当前视口高会随一次错误的 shrink 变小，
                    // 把拖拽上限也锁死在收缩后的高度上）。
                    currentMaxHeight = popupMaxHeight(zoomFactor, screen.height, window.screenY);
                    height = clampDragHeight(height, currentMaxHeight);
                    body.style.height = `${height}px`;
                    store.set('popupHeight', height);
                    store.flush(); // commit before the popup can close
                    clearMenu();
                });
            } else {
                height = clampDragHeight(height, currentMaxHeight);
                body.style.height = `${height}px`;
                store.set('popupHeight', height);
                clearMenu();
            }
        }
        // Drag-end bookkeeping runs AFTER the final size write above:
        // resetDragState() flushes the store, and a flush taken before the
        // last store.set() would leave the final width to the 200ms debounce
        // — lost if the popup closes within that window.
        if (isDragEnd)
            resetDragState();
    }
    document.addEventListener('pointermove', pointerDragHandler);
    document.addEventListener('pointerup', pointerDragHandler);
    document.addEventListener('pointercancel', pointerDragHandler);
    // A real popup loses the drag when focus leaves (clicking a dialog, the
    // pointer crossing into another window): clear the state so a later
    // stray pointermove cannot keep resizing from a stale baseline.
    window.addEventListener('blur', resetDragState);

    // Zoom
    if (store.get('zoom')) {
        body.dataset.zoom = store.get('zoom');
    }
    const zoom = val => {
        if (ctx.isDragging && ctx.isDragging())
            return; // prevent zooming when drag-n-dropping
        const dataZoom = body.dataset.zoom;
        const currentZoom = dataZoom ? parseInt(dataZoom, 10) : 100;
        // the ±10-step / [90,150] clamp / reset decision lives in resize-core.js
        const level = nextZoomLevel(currentZoom, val);
        if (level === null) {
            delete body.dataset.zoom;
            store.remove('zoom');
        } else {
            body.dataset.zoom = `${level}`;
            store.set('zoom', level);
        }
        body.classList.add('dummy'); // force redraw
        body.classList.remove('dummy');
        resetHeight(true);
    };
    //use 'wheel' event and 'e.deltaY' instead (>= Chrome 61)
    function wheelHandler(e) {
        if (!e.metaKey && !e.ctrlKey)
            return;
        e.preventDefault();
        zoom(e.deltaY || e.wheelDelta);
    }
    // `wheel` is passive by default in Chrome — this handler calls
    // preventDefault() (Ctrl/⌘+wheel zoom), so it must opt out explicitly.
    // Without { passive: false } Chrome logs "Unable to preventDefault inside
    // passive event listener" and silently ignores the cancellation, leaving
    // the native scroll gesture running alongside the zoom.
    document.addEventListener('wheel', wheelHandler, { passive: false });
    document.addEventListener('keydown', e => {
        if (!e.metaKey && !e.ctrlKey)
            return;
        switch (e.key) {
            case '+': // =/+ (plus)
            case '=': // =/+ (plus)
                e.preventDefault();
                zoom(1);
                break;
            case '-': // - (minus)
                e.preventDefault();
                zoom(-1);
                break;
            case '0': // 0 (zero)
                e.preventDefault();
                zoom(0);
                break;
        }
    });

    return { resetHeight, zoom };
}
