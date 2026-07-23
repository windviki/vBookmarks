/**
 * v4task-2 search ESC handler logic tests.
 * Tests the decision tree that Docker/Puppeteer cannot reliably exercise
 * because Chrome blocks synthetic keyboard events on extension capture listeners.
 */
import { describe, it, expect, vi } from 'vitest';

// Simulate the keyboard.js ESC capture handler logic (extracted from keyboard.js:457-497)
const simulateEscHandler = (state) => {
    const { dialogsOpen, contextMenuOpen, paletteOpen, searchActive, searchInputValue, viewManagerDispatchResult } = state;
    const actions = [];

    if (dialogsOpen) { actions.push('closeDialogs'); return actions; }
    if (contextMenuOpen) { actions.push('dismissContextMenu'); return actions; }
    if (paletteOpen) { actions.push('closePalette'); return actions; }

    // v4 task 2: search-mode Esc takes priority
    if (searchActive && searchInputValue) {
        actions.push('clearInput');
        actions.push('recordHistory');
        actions.push('stayInSearch');
        return actions;
    }
    if (searchActive || searchInputValue) {
        if (searchActive) actions.push('quit');
        else actions.push('clearInputOnly');
        return actions;
    }
    if (viewManagerDispatchResult) {
        actions.push('viewDispatch');
        return actions;
    }
    actions.push('closePopup');
    return actions;
};

describe('keyboard.js ESC handler (§2.3, §3.2)', () => {
    it('active search + query → clear input, record history, stay in search', () => {
        const result = simulateEscHandler({
            searchActive: true, searchInputValue: 'github',
            dialogsOpen: false, contextMenuOpen: false, paletteOpen: false,
            viewManagerDispatchResult: false,
        });
        expect(result).toContain('clearInput');
        expect(result).toContain('recordHistory');
        expect(result).toContain('stayInSearch');
        expect(result).not.toContain('quit');
        expect(result).not.toContain('viewDispatch');
    });

    it('active search + empty input → quit search', () => {
        const result = simulateEscHandler({
            searchActive: true, searchInputValue: '',
            dialogsOpen: false, contextMenuOpen: false, paletteOpen: false,
            viewManagerDispatchResult: false,
        });
        expect(result).toContain('quit');
        expect(result).not.toContain('clearInput');
    });

    it('inactive search + input has value (searchAfterEnter mode) → clear input only', () => {
        const result = simulateEscHandler({
            searchActive: false, searchInputValue: 'hello',
            dialogsOpen: false, contextMenuOpen: false, paletteOpen: false,
            viewManagerDispatchResult: false,
        });
        expect(result).toContain('clearInputOnly');
        expect(result).not.toContain('quit');
    });

    it('no search + empty input → falls through to view dispatch', () => {
        const result = simulateEscHandler({
            searchActive: false, searchInputValue: '',
            dialogsOpen: false, contextMenuOpen: false, paletteOpen: false,
            viewManagerDispatchResult: true,
        });
        expect(result).toContain('viewDispatch');
    });

    it('context menu open → dismiss menu first', () => {
        const result = simulateEscHandler({
            searchActive: true, searchInputValue: 'query',
            dialogsOpen: false, contextMenuOpen: true, paletteOpen: false,
            viewManagerDispatchResult: false,
        });
        expect(result).toEqual(['dismissContextMenu']);
    });

    it('dialogs open → close dialogs first', () => {
        const result = simulateEscHandler({
            searchActive: true, searchInputValue: 'query',
            dialogsOpen: true, contextMenuOpen: false, paletteOpen: false,
            viewManagerDispatchResult: false,
        });
        expect(result).toEqual(['closeDialogs']);
    });

    it('palette open → close palette first', () => {
        const result = simulateEscHandler({
            searchActive: true, searchInputValue: 'query',
            dialogsOpen: false, contextMenuOpen: false, paletteOpen: true,
            viewManagerDispatchResult: false,
        });
        expect(result).toEqual(['closePalette']);
    });

    it('priority: dialogs > contextMenu > search > viewDispatch > closePopup', () => {
        // When all states are active, dialogs take priority
        const r1 = simulateEscHandler({
            searchActive: true, searchInputValue: 'x', dialogsOpen: true,
            contextMenuOpen: true, paletteOpen: true, viewManagerDispatchResult: true
        });
        expect(r1).toEqual(['closeDialogs']);

        // No dialogs, context menu wins
        const r2 = simulateEscHandler({
            searchActive: true, searchInputValue: 'x', dialogsOpen: false,
            contextMenuOpen: true, paletteOpen: true, viewManagerDispatchResult: true
        });
        expect(r2).toEqual(['dismissContextMenu']);

        // No dialogs/menu, palette wins over search (palette checked before search)
        const r3 = simulateEscHandler({
            searchActive: true, searchInputValue: 'x', dialogsOpen: false,
            contextMenuOpen: false, paletteOpen: true, viewManagerDispatchResult: true
        });
        expect(r3).toEqual(['closePalette']);
    });
});
