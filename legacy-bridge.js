/**
 * vBookmarks Legacy Bridge
 *
 * This file bridges ES modules with legacy scripts by exposing
 * ES module exports to the global window object.
 */

// Import ES modules
import { DOMUtils } from './src/utils/dom-utils.js';
import { BookmarkManager } from './src/core/bookmark-manager.js';
import { UIManager } from './src/core/ui-manager.js';
import { SearchManager } from './src/core/search-manager.js';
import { VBookmarksApp } from './src/app.js';
import { ModuleLoader } from './src/module-loader.js';
import { IntegrationTest } from './src/integration-test.js';
import { BookmarkMetadataManager } from './src/metadata-manager.js';
import { FloatingToolbar } from './src/floating-toolbar.js';

// Expose to global window for legacy scripts
window.DOMUtils = DOMUtils;
window.BookmarkManager = BookmarkManager;
window.UIManager = UIManager;
window.SearchManager = SearchManager;
window.VBookmarksApp = VBookmarksApp;
window.ModuleLoader = ModuleLoader;
window.IntegrationTest = IntegrationTest;
window.BookmarkMetadataManager = BookmarkMetadataManager;
window.FloatingToolbar = FloatingToolbar;

// Initialize BookmarkMetadataManager immediately for global availability
try {
    window.metadataManager = new BookmarkMetadataManager();
    console.log('✅ BookmarkMetadataManager initialized');
} catch (error) {
    console.warn('Failed to initialize BookmarkMetadataManager:', error);
}

console.log('🌉 Legacy bridge: ES modules exposed to window object');

// Auto-initialize module loader and integration test when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Initialize module loader
        window.moduleLoader = new ModuleLoader();
        window.moduleLoader.init().catch(console.error);

        // Initialize floating toolbar
        setTimeout(() => {
            if (window.FloatingToolbar) {
                window.floatingToolbar = new FloatingToolbar();
                console.log('✅ Floating toolbar initialized');
            }
        }, 1000);

        // Run integration tests after a short delay
        setTimeout(() => {
            const integrationTest = new IntegrationTest();
            integrationTest.runTests().catch(console.error);
        }, 2000);
    });
} else {
    // DOM already loaded
    window.moduleLoader = new ModuleLoader();
    window.moduleLoader.init().catch(console.error);

    // Initialize floating toolbar
    setTimeout(() => {
        if (window.FloatingToolbar) {
            window.floatingToolbar = new FloatingToolbar();
            console.log('✅ Floating toolbar initialized');
        }
    }, 1000);

    // Run integration tests after a short delay
    setTimeout(() => {
        const integrationTest = new IntegrationTest();
        integrationTest.runTests().catch(console.error);
    }, 2000);
}