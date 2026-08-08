import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

/**
 * Popup auto-resize logic — pure-function verification.
 *
 * The actual resetHeight is a closure inside neat.js that reads live
 * DOM measurements (offsetHeight / offsetTop) and chrome.tabs.getZoom.
 * That makes it hard to unit-test directly, so we extract the decision
 * kernel into this verify-only suite.
 *
 * The logic (v4.1 fix):
 *   clampedContent = clamp(contentH, minH, maxH)
 *
 *   if userResized                     → STAY  (issue #51: a manual edge drag
 *                                               suspends auto-height for the
 *                                               rest of the session)
 *   if clampedContent > currentH       → GROW  (content outgrew the popup)
 *   elif allowShrink
 *        && clampedContent <= currentH
 *        && contentH <= maxH           → SHRINK (full tree fits, real waste)
 *        && clampedContent < currentH*0.7
 *   else                               → STAY
 *
 * Call-sites:
 *   - initial load / zoom:  allowShrink=true
 *   - click / keyup events: allowShrink=false  (folder toggle → never shrink)
 *   - after a manual resize drag: userResized=true (short-circuits everything)
 */

// The decision kernel extracted from neat.js for verification.
function heightDecision({ contentH, currentH, minH, maxH, allowShrink, userResized }) {
    if (userResized)
        return { action: 'stay' };

    const clamped = Math.max(minH, Math.min(contentH, maxH));

    if (clamped > currentH)
        return { action: 'grow', target: clamped };
    if (allowShrink && clamped <= currentH && contentH <= maxH && clamped < currentH * 0.7)
        return { action: 'shrink', target: clamped };
    return { action: 'stay' };
}

// A small helper to run a table of scenarios.
function run(label, scenarios) {
    for (const s of scenarios) {
        const { desc, ...input } = s;
        const expected = s.expect;
        it(`${label} — ${desc}`, () => {
            const result = heightDecision(input);
            expect(result.action).toBe(expected);
            if (expected === 'grow' || expected === 'shrink')
                expect(result.target).toBeGreaterThan(0);
        });
    }
}

describe('auto-resize: interaction events (allowShrink=false)', () => {
    run('folder toggle', [
        // User expands a folder → content grew beyond popup
        { desc: 'expand: content outgrows popup',
          contentH: 500, currentH: 400, minH: 200, maxH: 600, allowShrink: false, expect: 'grow' },

        // User collapses a folder → content still shorter, but must NOT shrink
        { desc: 'collapse: content shrinks under popup',
          contentH: 200, currentH: 500, minH: 200, maxH: 600, allowShrink: false, expect: 'stay' },

        // Content matches popup (no change)
        { desc: 'toggle: content equals popup',
          contentH: 400, currentH: 400, minH: 200, maxH: 600, allowShrink: false, expect: 'stay' },

        // Content just slightly below popup — definitely stay
        { desc: 'toggle: content slightly shorter (90%)',
          contentH: 360, currentH: 400, minH: 200, maxH: 600, allowShrink: false, expect: 'stay' },

        // Even if content is way below popup, interaction never shrinks
        { desc: 'collapse: content way under popup (40%)',
          contentH: 200, currentH: 500, minH: 200, maxH: 600, allowShrink: false, expect: 'stay' },

        // Content at minimum — still no shrink from interaction
        { desc: 'collapse: content at bare minimum',
          contentH: 50, currentH: 500, minH: 200, maxH: 600, allowShrink: false, expect: 'stay' },

        // Content clamped to maxH, equal to current — stay
        { desc: 'toggle: content clamped to max, equals popup',
          contentH: 700, currentH: 600, minH: 200, maxH: 600, allowShrink: false, expect: 'stay' },

        // Content clamped to maxH, above current — grow
        { desc: 'expand: content clamped to max, larger than popup',
          contentH: 700, currentH: 450, minH: 200, maxH: 600, allowShrink: false, expect: 'grow' },
    ]);
});

describe('auto-resize: initial load / zoom (allowShrink=true)', () => {
    run('fresh session', [
        // Typical: tall saved popup, short tree → shrink
        { desc: 'saved 500px, content 200px, maxH 600px — waste',
          contentH: 200, currentH: 500, minH: 200, maxH: 600, allowShrink: true, expect: 'shrink' },

        // Content fits but not much waste → stay
        { desc: 'saved 500px, content 380px — not enough waste (76%)',
          contentH: 380, currentH: 500, minH: 200, maxH: 600, allowShrink: true, expect: 'stay' },

        // Content exceeds maxH (scroll needed), popup is below maxH → grow to maxH
        // This is correct: the popup should fill the available space before forcing a scrollbar
        { desc: 'content 650px exceeds maxH 600px, popup 500px — grow to maxH',
          contentH: 650, currentH: 500, minH: 200, maxH: 600, allowShrink: true, expect: 'grow' },

        // Content grew beyond popup → grow
        { desc: 'content outgrew popup',
          contentH: 500, currentH: 400, minH: 200, maxH: 600, allowShrink: true, expect: 'grow' },

        // Content at min, popup at min — stay
        { desc: 'content at min, popup at min',
          contentH: 200, currentH: 200, minH: 200, maxH: 600, allowShrink: true, expect: 'stay' },

        // Content is clamped to minH, popup is huge → shrink to minH
        { desc: 'tiny content, large popup — shrink to min',
          contentH: 50, currentH: 500, minH: 200, maxH: 600, allowShrink: true, expect: 'shrink' },

        // 70% threshold edge case: just at threshold
        { desc: 'content at 69% of popup — shrink',
          contentH: 345, currentH: 500, minH: 200, maxH: 600, allowShrink: true, expect: 'shrink' },

        // 70% threshold edge case: just above threshold
        { desc: 'content at 71% of popup — stay',
          contentH: 355, currentH: 500, minH: 200, maxH: 600, allowShrink: true, expect: 'stay' },
    ]);
});

describe('auto-resize: edge cases', () => {
    it('minH clamp works: content 100, minH 200 → clamped 200', () => {
        const r = heightDecision({ contentH: 100, currentH: 500, minH: 200, maxH: 600, allowShrink: true });
        expect(r.action).toBe('shrink');
        expect(r.target).toBe(200);
    });

    it('maxH clamp works: content 800, maxH 600, current 500 → grow to maxH', () => {
        const r = heightDecision({ contentH: 800, currentH: 500, minH: 200, maxH: 600, allowShrink: true });
        // clamped = 600 > current(500) → grow to 600 (content will scroll within)
        expect(r.action).toBe('grow');
        expect(r.target).toBe(600);
    });

    it('content far larger than maxH but popup taller → grow', () => {
        // clamped=600, current=550 → clamped(600) > current(550) → grow
        const r = heightDecision({ contentH: 900, currentH: 550, minH: 200, maxH: 600, allowShrink: true });
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
        const r = heightDecision({ contentH: 700, currentH: 300, minH: 200, maxH: 600, allowShrink: false, userResized: true });
        expect(r.action).toBe('stay');
    });

    it('a manual grow also sticks and is never shrunk back', () => {
        const r = heightDecision({ contentH: 200, currentH: 550, minH: 200, maxH: 600, allowShrink: false, userResized: true });
        expect(r.action).toBe('stay');
    });

    it('the lock is session-scoped: without it the normal rules apply again', () => {
        // Same inputs as the lock test but no flag → grow (the pre-#51 shape,
        // which a fresh popup open legitimately performs once via allowShrink).
        const r = heightDecision({ contentH: 700, currentH: 300, minH: 200, maxH: 600, allowShrink: true, userResized: false });
        expect(r.action).toBe('grow');
        expect(r.target).toBe(600);
    });
});

describe('popup WIDTH resize (4.0.1 regression gate)', () => {
    // The width clamp mirrors the height kernel but bounds the WINDOW on screen.
    // A Chrome popup grows away from its toolbar anchor, so the resize handle
    // (on the moving edge) can be pushed off-screen by a too-wide popup — the
    // "can't narrow back after widening" regression. The max width must leave
    // the moving edge on-screen: bodyWidth + the room on the growth side.
    const widthMax = ({ bodyWidth, leftRoom, rightRoom, hardMax = 640 }) =>
        Math.min(hardMax, bodyWidth + Math.max(leftRoom, rightRoom));

    it('keeps the popup on-screen: the moving edge may travel at most its screen room', () => {
        // popup 320 wide, 251px of screen to its left (icon on the right)
        // → max width 571, at which the left edge sits exactly at screen 0.
        expect(widthMax({ bodyWidth: 320, leftRoom: 251, rightRoom: 221 })).toBe(571);
        // icon centered-ish, room both sides → grows toward the larger room
        expect(widthMax({ bodyWidth: 320, leftRoom: 200, rightRoom: 300 })).toBe(620);
    });

    it('never widens beyond the hard 640 cap, and a tiny room caps hard', () => {
        expect(widthMax({ bodyWidth: 320, leftRoom: 500, rightRoom: 500 })).toBe(640);
        expect(widthMax({ bodyWidth: 500, leftRoom: 40, rightRoom: 20 })).toBe(540);
        expect(widthMax({ bodyWidth: 320, leftRoom: 0, rightRoom: 0 })).toBe(320); // no room to grow
    });

    it('narrowing back is always reachable: min width never exceeds 320', () => {
        const minW = w => Math.max(320, Math.min(w, widthMax({ bodyWidth: w, leftRoom: 251, rightRoom: 221 })));
        // after widening to the max, the user can drag all the way back to 320
        expect(minW(320)).toBe(320);
        expect(minW(571)).toBe(571); // widening to max is allowed
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
        expect(neatJs).toContain('width = Math.min(maxResizeWidth, Math.max(320, width))');
        expect(neatJs).toContain('onScreenMaxWidth');
        expect(neatJs).toContain('RESIZE_EDGE_MARGIN');
        // the margin means the handle never sits flush at screen x=0
        expect(neatJs).toMatch(/RESIZE_EDGE_MARGIN\s*=\s*24/);
    });

    it('persists synchronously on drag end (popup pagehide is not guaranteed)', () => {
        expect(neatJs).toMatch(/store\.flush\(\)/);
        expect(neatJs).toMatch(/resetDragState = \(\) => \{[\s\S]*?store\.flush\(\)/);
    });
});
