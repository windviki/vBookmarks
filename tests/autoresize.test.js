import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import {
    decideHeight, decideWidthMax, clampDragWidth,
    nextZoomLevel, ZOOM_MIN, ZOOM_MAX, ZOOM_STEP
} from '../src/resize-core.js';

/**
 * Popup auto-resize decision logic — drives the REAL kernels extracted to
 * src/resize-core.js (neat.js imports and calls them), so a change to the
 * production logic is caught here. Previously this suite re-implemented the
 * decision as a local copy ("verify-only") and tested the copy — the real
 * resetHeight could drift freely and the 25 cases stayed green.
 *
 * resetHeight call-site semantics:
 *   - initial load / zoom:  allowShrink=true
 *   - click / keyup events: allowShrink=false  (folder toggle → never shrink)
 *   - after a manual resize drag: userResized=true (short-circuits everything)
 */

// A small helper to run a table of scenarios against the real decideHeight.
function run(label, scenarios) {
    for (const s of scenarios) {
        const { desc, expect: expected, ...input } = s;
        it(`${label} — ${desc}`, () => {
            const result = decideHeight(input);
            expect(result.action).toBe(expected);
        });
    }
}

describe('auto-resize: interaction events (allowShrink=false)', () => {
    run('folder toggle', [
        // User expands a folder → content grew beyond popup
        { desc: 'expand: content outgrows popup',
          contentH: 500, currentH: 400, minH: 200, maxH: 600, allowShrink: false, userResized: false, expect: 'grow' },

        // User collapses a folder → content still shorter, but must NOT shrink
        { desc: 'collapse: content shrinks under popup',
          contentH: 200, currentH: 500, minH: 200, maxH: 600, allowShrink: false, userResized: false, expect: 'stay' },

        // Content matches popup (no change)
        { desc: 'toggle: content equals popup',
          contentH: 400, currentH: 400, minH: 200, maxH: 600, allowShrink: false, userResized: false, expect: 'stay' },

        // Content just slightly below popup — definitely stay
        { desc: 'toggle: content slightly shorter (90%)',
          contentH: 360, currentH: 400, minH: 200, maxH: 600, allowShrink: false, userResized: false, expect: 'stay' },

        // Even if content is way below popup, interaction never shrinks
        { desc: 'collapse: content way under popup (40%)',
          contentH: 200, currentH: 500, minH: 200, maxH: 600, allowShrink: false, userResized: false, expect: 'stay' },

        // Content at minimum — still no shrink from interaction
        { desc: 'collapse: content at bare minimum',
          contentH: 50, currentH: 500, minH: 200, maxH: 600, allowShrink: false, userResized: false, expect: 'stay' },

        // Content clamped to maxH, equal to current — stay
        { desc: 'toggle: content clamped to max, equals popup',
          contentH: 700, currentH: 600, minH: 200, maxH: 600, allowShrink: false, userResized: false, expect: 'stay' },

        // Content clamped to maxH, above current — grow
        { desc: 'expand: content clamped to max, larger than popup',
          contentH: 700, currentH: 450, minH: 200, maxH: 600, allowShrink: false, userResized: false, expect: 'grow' },
    ]);
});

describe('auto-resize: initial load / zoom (allowShrink=true)', () => {
    run('fresh session', [
        // Typical: tall saved popup, short tree → shrink
        { desc: 'saved 500px, content 200px, maxH 600px — waste',
          contentH: 200, currentH: 500, minH: 200, maxH: 600, allowShrink: true, userResized: false, expect: 'shrink' },

        // Content fits but not much waste → stay
        { desc: 'saved 500px, content 380px — not enough waste (76%)',
          contentH: 380, currentH: 500, minH: 200, maxH: 600, allowShrink: true, userResized: false, expect: 'stay' },

        // Content exceeds maxH (scroll needed), popup is below maxH → grow to maxH
        // This is correct: the popup should fill the available space before forcing a scrollbar
        { desc: 'content 650px exceeds maxH 600px, popup 500px — grow to maxH',
          contentH: 650, currentH: 500, minH: 200, maxH: 600, allowShrink: true, userResized: false, expect: 'grow' },

        // Content grew beyond popup → grow
        { desc: 'content outgrew popup',
          contentH: 500, currentH: 400, minH: 200, maxH: 600, allowShrink: true, userResized: false, expect: 'grow' },

        // Content at min, popup at min — stay
        { desc: 'content at min, popup at min',
          contentH: 200, currentH: 200, minH: 200, maxH: 600, allowShrink: true, userResized: false, expect: 'stay' },

        // Content is clamped to minH, popup is huge → shrink to minH
        { desc: 'tiny content, large popup — shrink to min',
          contentH: 50, currentH: 500, minH: 200, maxH: 600, allowShrink: true, userResized: false, expect: 'shrink' },

        // 70% threshold edge case: just at threshold
        { desc: 'content at 69% of popup — shrink',
          contentH: 345, currentH: 500, minH: 200, maxH: 600, allowShrink: true, userResized: false, expect: 'shrink' },

        // 70% threshold edge case: just above threshold
        { desc: 'content at 71% of popup — stay',
          contentH: 355, currentH: 500, minH: 200, maxH: 600, allowShrink: true, userResized: false, expect: 'stay' },
    ]);
});

describe('auto-resize: edge cases', () => {
    it('minH clamp works: content 100, minH 200 → clamped 200, shrinks to it', () => {
        const r = decideHeight({ contentH: 100, currentH: 500, minH: 200, maxH: 600, allowShrink: true, userResized: false });
        expect(r.action).toBe('shrink');
        expect(r.target).toBe(200);
    });

    it('maxH clamp works: content 800, maxH 600, current 500 → grow to maxH', () => {
        const r = decideHeight({ contentH: 800, currentH: 500, minH: 200, maxH: 600, allowShrink: true, userResized: false });
        // clamped = 600 > current(500) → grow to 600 (content will scroll within)
        expect(r.action).toBe('grow');
        expect(r.target).toBe(600);
    });

    it('content far larger than maxH but popup taller → grow', () => {
        // clamped=600, current=550 → clamped(600) > current(550) → grow
        const r = decideHeight({ contentH: 900, currentH: 550, minH: 200, maxH: 600, allowShrink: true, userResized: false });
        expect(r.action).toBe('grow');
        expect(r.target).toBe(600);
    });
});

describe('auto-resize: manual resize lock (issue #51)', () => {
    // Once the user drags the popup edge, auto-height must step back — a tree
    // click must NOT re-grow a manually shrunken popup to the content height.
    it('a manual shrink sticks even when content is much taller', () => {
        // content 700 ≫ popup 300, but the user dragged it down to 300:
        // grow would previously undo the drag (the #51 "always resets" bug).
        const r = decideHeight({ contentH: 700, currentH: 300, minH: 200, maxH: 600, allowShrink: false, userResized: true });
        expect(r.action).toBe('stay');
    });

    it('a manual grow also sticks and is never shrunk back', () => {
        const r = decideHeight({ contentH: 200, currentH: 550, minH: 200, maxH: 600, allowShrink: false, userResized: true });
        expect(r.action).toBe('stay');
    });

    it('the lock is session-scoped: without it the normal rules apply again', () => {
        // Same inputs as the lock test but no flag → grow (the pre-#51 shape,
        // which a fresh popup open legitimately performs once via allowShrink).
        const r = decideHeight({ contentH: 700, currentH: 300, minH: 200, maxH: 600, allowShrink: true, userResized: false });
        expect(r.action).toBe('grow');
        expect(r.target).toBe(600);
    });
});

describe('popup WIDTH resize (4.0.1 regression gate)', () => {
    // decideWidthMax bounds the WINDOW on screen. A Chrome popup grows away
    // from its toolbar anchor, so the resize handle (on the moving edge) can
    // be pushed off-screen by a too-wide popup — the "can't narrow back after
    // widening" regression. The max width must leave the moving edge on-screen.
    it('keeps the popup on-screen: the moving edge may travel at most its screen room', () => {
        // popup 320 wide, 251px of screen to its left (icon on the right)
        // → max width 571, at which the left edge sits exactly at screen 0.
        expect(decideWidthMax({ bodyWidth: 320, leftRoom: 251, rightRoom: 221 })).toBe(571);
        // icon centered-ish, room both sides → grows toward the larger room
        expect(decideWidthMax({ bodyWidth: 320, leftRoom: 200, rightRoom: 300 })).toBe(620);
    });

    it('never widens beyond the hard 640 cap, and a tiny room caps hard', () => {
        expect(decideWidthMax({ bodyWidth: 320, leftRoom: 500, rightRoom: 500 })).toBe(640);
        expect(decideWidthMax({ bodyWidth: 500, leftRoom: 40, rightRoom: 20 })).toBe(540);
        expect(decideWidthMax({ bodyWidth: 320, leftRoom: 0, rightRoom: 0 })).toBe(320); // no room to grow
    });

    it('a custom hardMax cap is honored (the kernel is the single clamp)', () => {
        expect(decideWidthMax({ bodyWidth: 320, leftRoom: 500, rightRoom: 500, hardMax: 480 })).toBe(480);
    });
});

describe('popup ZOOM (neat.js zoom())', () => {
    it('steps by 10 in both directions from the stored level', () => {
        expect(nextZoomLevel(100, 1)).toBe(110);
        expect(nextZoomLevel(110, -1)).toBe(100);
        expect(nextZoomLevel(90, 1)).toBe(100);
    });

    it('clamps to the [90, 150] window at both edges', () => {
        expect(nextZoomLevel(145, 1)).toBe(ZOOM_MAX); // 155 → 150
        expect(nextZoomLevel(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
        expect(nextZoomLevel(95, -1)).toBe(ZOOM_MIN); // 85 → 90
        expect(nextZoomLevel(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    });

    it('a 0 delta resets to the default (null → the caller clears the zoom)', () => {
        expect(nextZoomLevel(130, 0)).toBeNull();
        expect(nextZoomLevel(100, 0)).toBeNull();
    });

    it('the kernel is the single clamp: step/edges derive from the constants', () => {
        expect(ZOOM_STEP).toBe(10);
        expect(ZOOM_MIN).toBe(90);
        expect(ZOOM_MAX).toBe(150);
    });
});

describe('popup WIDTH drag clamp (pointerDragHandler)', () => {
    // During the drag the width is clamped to [320, maxResizeWidth] where
    // maxResizeWidth was frozen at pointerdown from decideWidthMax.
    it('clamps to the frozen max from above', () => {
        expect(clampDragWidth(700, 571)).toBe(571);
        expect(clampDragWidth(572, 571)).toBe(571);
    });

    it('clamps to the 320 hard minimum from below', () => {
        expect(clampDragWidth(100, 640)).toBe(320);
        expect(clampDragWidth(319, 640)).toBe(320);
    });

    it('lets in-range widths pass through untouched', () => {
        expect(clampDragWidth(400, 640)).toBe(400);
        expect(clampDragWidth(320, 640)).toBe(320);
        expect(clampDragWidth(640, 640)).toBe(640);
    });

    it('narrowing back is always reachable: the min never exceeds 320', () => {
        // after widening to the max, the user can drag all the way back to 320
        expect(clampDragWidth(571, 571)).toBe(571); // widening to max is allowed
        expect(clampDragWidth(320, 571)).toBe(320); // ...and back down to the floor
    });
});

// Source-contract gate: the resizer must use pointer capture + the on-screen
// clamp — a regression that drops either re-breaks the reported width bug.
const neatJs = fs.readFileSync(new URL('../src/neat.js', import.meta.url), 'utf8');

describe('resizer source contract (4.0.1 width regression gate)', () => {
    it('drives the drag with POINTER events + capture, not mouse (pointer leaves the popup window)', () => {
        // The drag must be pointer-driven: a Chrome popup grows away from its
        // anchor, pushing the pointer out of the window mid-drag; document
        // mousemove/mouseup stop at the window edge and a lost mouseup wedges
        // resizerXDown (the "can't narrow after widening" bug).
        expect(neatJs).toMatch(/setPointerCapture\(e\.pointerId\)/);
        expect(neatJs).toMatch(/addEventListener\('pointermove', pointerDragHandler\)/);
        expect(neatJs).toMatch(/addEventListener\('pointerup', pointerDragHandler\)/);
        expect(neatJs).toMatch(/addEventListener\('pointercancel', pointerDragHandler\)/);
        // both resizers capture the pointer on their own pointerdown
        const pds = (neatJs.match(/addEventListener\('pointerdown', e => \{/g) || []).length;
        expect(pds).toBe(2);
        // a cancelled drag or a focus loss clears the state (no stale hijack)
        expect(neatJs).toMatch(/addEventListener\('blur', resetDragState\)/);
    });

    it('clamps width to the on-screen bound leaving a grabbable margin, not a bare 640', () => {
        // the decision kernels live in resize-core.js; neat.js must call them
        expect(neatJs).toContain('decideWidthMax({ bodyWidth, leftRoom, rightRoom })');
        expect(neatJs).toContain('clampDragWidth(width, maxResizeWidth)');
        expect(neatJs).toContain('onScreenMaxWidth');
        expect(neatJs).toContain('RESIZE_EDGE_MARGIN');
        // the margin means the handle never sits flush at screen x=0
        expect(neatJs).toMatch(/RESIZE_EDGE_MARGIN\s*=\s*24/);
    });

    it('zoom delegates the level math to the shared kernel (resize-core)', () => {
        expect(neatJs).toContain('nextZoomLevel(currentZoom, val)');
        // the drag guard (a drag in progress refuses to zoom) stays in neat.js
        expect(neatJs).toMatch(/if \(dnd\.isDragging\(\)\)/);
    });

    it('persists synchronously on drag end (popup pagehide is not guaranteed)', () => {
        expect(neatJs).toMatch(/store\.flush\(\)/);
        expect(neatJs).toMatch(/resetDragState = \(\) => \{[\s\S]*?store\.flush\(\)/);
    });

    it('sizes the ROOT element, not just body — the popup window follows <html> width', () => {
        // Verified on a real Edge 151 popup: the OS window is sized from the
        // root element; <html> width:auto tracks the viewport, so after a
        // widen the root sticks at the widest width and the window can never
        // narrow (body shrank, innerWidth stayed pinned). The drag must write
        // documentElement's width alongside body's or narrowing is dead.
        expect(neatJs).toMatch(/document\.documentElement\.style\.width = `\$\{width\}px`/);
    });

    it('flushes AFTER the final width write on drag end, not before', () => {
        // resetDragState() contains store.flush(); if it ran before the final
        // store.set('popupWidth'), the definitive width would fall back to the
        // 200ms debounce and be lost on a fast popup close.
        const finalWrite = neatJs.indexOf("store.set('popupWidth', width)");
        const dragEndFlush = neatJs.indexOf('if (isDragEnd)');
        expect(finalWrite).toBeGreaterThan(-1);
        expect(dragEndFlush).toBeGreaterThan(finalWrite);
        expect(neatJs.slice(dragEndFlush, dragEndFlush + 80)).toMatch(/resetDragState\(\)/);
    });
});
