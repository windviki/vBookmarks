/**
 * view-manager.test.js — tests for src/view-manager.js (v4 task 2)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock DOM
function makeEl(id) {
    const el = { id, style: {}, querySelector: vi.fn(), querySelectorAll: vi.fn(() => []), appendChild: vi.fn(), innerHTML: '', setAttribute: vi.fn(), addEventListener: vi.fn() };
    return el;
}

describe('view-manager (unit)', () => {
    let store, viewManager, els;

    // We test the pure functions directly via a mockable wrapper
    // Since view-manager.js uses document.getElementById and chrome.i18n,
    // we need to set up the globals.

    it('can be imported without errors (module load test)', async () => {
        // This test just verifies the module exports correctly
        const mod = await import('../src/view-manager.js');
        expect(typeof mod.initViewManager).toBe('function');
    });
});

describe('viewManager registry operations', () => {
    // Full mock for document
    beforeEach(() => {
        globalThis.document = {
            getElementById: vi.fn(id => {
                const el = makeEl(id);
                el.querySelector = vi.fn(() => null);
                el.querySelectorAll = vi.fn(() => []);
                return el;
            }),
            createElement: vi.fn(tag => {
                const el = makeEl('created-' + tag);
                el.setAttribute = vi.fn();
                el.dataset = {};
                el.style = {};
                el.classList = { add: vi.fn(), remove: vi.fn(), toggle: vi.fn(), contains: vi.fn(() => false) };
                el.appendChild = vi.fn();
                el.addEventListener = vi.fn();
                el.querySelector = vi.fn(() => null);
                el.querySelectorAll = vi.fn(() => []);
                return el;
            }),
            body: { classList: { contains: vi.fn(() => false) } },
            addEventListener: vi.fn()
        };
        globalThis.chrome = {
            i18n: { getMessage: vi.fn(key => key) },
            runtime: { getURL: vi.fn(u => u) },
            storage: { local: { get: vi.fn(), set: vi.fn() } }
        };
    });

    it('initViewManager returns the expected API', async () => {
        const { initViewManager } = await import('../src/view-manager.js');
        const store = { get: vi.fn(() => ''), set: vi.fn() };
        const treeRender = { getParentPath: vi.fn(() => []) };
        const vm = initViewManager({ store, treeRender, isPanel: false });
        expect(typeof vm.register).toBe('function');
        expect(typeof vm.activate).toBe('function');
        expect(typeof vm.dispatchEsc).toBe('function');
        expect(typeof vm.getActiveId).toBe('function');
        expect(typeof vm.refreshAllBadges).toBe('function');
    });

    it('register + init + activate: view activate callback is called', async () => {
        const { initViewManager } = await import('../src/view-manager.js');
        const store = { get: vi.fn(() => ''), set: vi.fn() };
        const treeRender = { getParentPath: vi.fn(() => []) };
        const vm = initViewManager({ store, treeRender, isPanel: false });

        let activated = false;
        vm.register({
            id: 'tree',
            titleKey: 'viewTree',
            slash: 'tree',
            container: makeEl('view-tree'),
            activate() { activated = true; }
        });
        vm.init();
        // init() calls activate('tree') which was registered
        expect(activated).toBe(true);
        expect(vm.getActiveId()).toBe('tree');
    });

    it('dispatchEsc returns false when active tree view has no onEscape', async () => {
        const { initViewManager } = await import('../src/view-manager.js');
        const store = { get: vi.fn(() => ''), set: vi.fn() };
        const treeRender = { getParentPath: vi.fn(() => []) };
        const vm = initViewManager({ store, treeRender, isPanel: false });
        vm.register({ id: 'tree', titleKey: 'viewTree', slash: 'tree', container: makeEl('view-tree') });
        vm.init();
        expect(vm.dispatchEsc()).toBe(false);
    });

    it('dispatchEsc returns true when active view onEscape consumes', async () => {
        const { initViewManager } = await import('../src/view-manager.js');
        const store = { get: vi.fn(() => ''), set: vi.fn() };
        const treeRender = { getParentPath: vi.fn(() => []) };
        const vm = initViewManager({ store, treeRender, isPanel: false });
        vm.register({
            id: 'esc-view',
            titleKey: 'viewEsc',
            slash: 'esc',
            container: makeEl('view-esc'),
            onEscape() { return true; }
        });
        vm.init();
        vm.activate('esc-view');
        expect(vm.dispatchEsc()).toBe(true);
    });
});
