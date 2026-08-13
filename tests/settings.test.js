import { describe, it, expect } from 'vitest';
import { isAutoResizeEnabled, shouldHighlightUnsynced, shouldRememberState } from '../src/settings.js';

// The option-boolean judgments that used to live inline in neat.js (untestable).
// Each proves the switch still flips its behavior — the "option went dead but
// nothing caught it" gap from the audit round.

describe('isAutoResizeEnabled (autoResizePopup)', () => {
    it('off stores "false" → disabled', () => {
        expect(isAutoResizeEnabled('false')).toBe(false);
    });
    it('on/default stays enabled', () => {
        expect(isAutoResizeEnabled('true')).toBe(true);
        expect(isAutoResizeEnabled(undefined)).toBe(true); // default on
        expect(isAutoResizeEnabled('')).toBe(true);
    });
});

describe('shouldHighlightUnsynced (highlightUnsynced, sync area)', () => {
    it('on stores the string "true" → dims local subtrees', () => {
        expect(shouldHighlightUnsynced('true')).toBe(true);
    });
    it('off/absent → no dimming', () => {
        expect(shouldHighlightUnsynced('false')).toBe(false);
        expect(shouldHighlightUnsynced(undefined)).toBe(false);
    });
});

describe('shouldRememberState (dontRememberState)', () => {
    it('off/absent → remember the previous state (default)', () => {
        expect(shouldRememberState(undefined)).toBe(true);
        expect(shouldRememberState('')).toBe(true);
    });
    it('on ("1") → do NOT remember', () => {
        expect(shouldRememberState('1')).toBe(false);
    });
});
