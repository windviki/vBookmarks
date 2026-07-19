import { describe, it, expect } from 'vitest';

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
 *   if clampedContent > currentH          → GROW  (content outgrew the popup)
 *   elif allowShrink
 *        && clampedContent <= currentH
 *        && contentH <= maxH              → SHRINK (full tree fits, real waste)
 *        && clampedContent < currentH*0.7
 *   else                                  → STAY
 *
 * Call-sites:
 *   - initial load / zoom:  allowShrink=true
 *   - click / keyup events: allowShrink=false  (folder toggle → never shrink)
 */

// The decision kernel extracted from neat.js for verification.
function heightDecision({ contentH, currentH, minH, maxH, allowShrink }) {
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
