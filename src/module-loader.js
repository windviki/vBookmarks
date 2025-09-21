/**
 * vBookmarks Module Loader
 *
 * Loads and initializes modular components while maintaining
 * backward compatibility with existing neat.js functionality.
 */

class ModuleLoader {
    constructor() {
        this.modules = new Map();
        this.loaded = false;
        this.compatibilityMode = true;
    }

    /**
     * Initialize module system
     */
    async init() {
        if (this.loaded) {
            return;
        }

        console.log('📦 Loading vBookmarks modules...');
        console.log('🔍 Pre-check: window.DOMUtils =', typeof window.DOMUtils);

        try {
            // Load core modules
            await this.loadCoreModules();

            // Load utility modules
            await this.loadUtilityModules();

            // Setup compatibility layer
            this.setupCompatibility();

            this.loaded = true;
            console.log('✅ All modules loaded successfully');

        } catch (error) {
            console.error('❌ Failed to load modules:', error);
            this.compatibilityMode = false;
        }
    }

    /**
     * Load core modules
     */
    async loadCoreModules() {
        // Load BookmarkManager
        if (window.BookmarkManager) {
            this.modules.set('bookmarkManager', new BookmarkManager());
            await this.modules.get('bookmarkManager').init();
            console.log('📚 BookmarkManager loaded');
        }

        // Load UIManager
        if (window.UIManager) {
            this.modules.set('uiManager', new UIManager());
            this.modules.get('uiManager').init();
            console.log('🎨 UIManager loaded');
        }

        // Load SearchManager if available
        if (window.SearchManager) {
            this.modules.set('searchManager', new SearchManager());
            await this.modules.get('searchManager').init();
            console.log('🔍 SearchManager loaded');
        }
    }

    /**
     * Load utility modules
     */
    async loadUtilityModules() {
        // DOMUtils are static, no initialization needed
        if (window.DOMUtils) {
            this.modules.set('domUtils', window.DOMUtils);
            console.log('🛠️ DOMUtils loaded');
        } else {
            console.warn('⚠️ DOMUtils not found on window object');
        }

        // Load other utility modules as they are created
    }

    /**
     * Setup compatibility layer for existing neat.js
     */
    setupCompatibility() {
        if (!this.compatibilityMode) {
            return;
        }

        console.log('🔧 Setting up compatibility layer...');

        const domUtils = this.modules.get('domUtils');
        console.log('🔍 domUtils from modules:', typeof domUtils);

        // Expose modules globally for existing code
        window.vBookmarks = {
            bookmarkManager: this.modules.get('bookmarkManager'),
            uiManager: this.modules.get('uiManager'),
            searchManager: this.modules.get('searchManager'),
            domUtils: domUtils,
            modules: this.modules
        };

        console.log('🔍 window.vBookmarks.domUtils:', typeof window.vBookmarks.domUtils);

        // Setup event forwarding
        this.setupEventForwarding();

        // Setup helper functions for backward compatibility
        this.setupCompatibilityHelpers();
    }

    /**
     * Setup event forwarding between modules and existing code
     */
    setupEventForwarding() {
        const bookmarkManager = this.modules.get('bookmarkManager');
        const uiManager = this.modules.get('uiManager');

        if (bookmarkManager && uiManager) {
            // Forward bookmark events to UI
            bookmarkManager.addEventListener('bookmarksLoaded', (bookmarks) => {
                uiManager.renderBookmarkTree(bookmarks);
                // Trigger existing event handlers
                this.triggerLegacyEvent('bookmarksLoaded', bookmarks);
            });

            bookmarkManager.addEventListener('bookmarkCreated', (bookmark) => {
                uiManager.refreshCurrentView();
                this.triggerLegacyEvent('bookmarkCreated', bookmark);
            });

            bookmarkManager.addEventListener('bookmarkUpdated', (bookmark) => {
                uiManager.refreshCurrentView();
                this.triggerLegacyEvent('bookmarkUpdated', bookmark);
            });

            bookmarkManager.addEventListener('bookmarkDeleted', (bookmark) => {
                uiManager.refreshCurrentView();
                this.triggerLegacyEvent('bookmarkDeleted', bookmark);
            });
        }

        // Forward UI events to legacy handlers
        if (uiManager) {
            uiManager.addEventListener('bookmarkClicked', (bookmark) => {
                this.triggerLegacyEvent('bookmarkClicked', bookmark);
            });

            uiManager.addEventListener('folderClicked', (folder) => {
                this.triggerLegacyEvent('folderClicked', folder);
            });
        }
    }

    /**
     * Setup helper functions for backward compatibility
     */
    setupCompatibilityHelpers() {
        const bookmarkManager = this.modules.get('bookmarkManager');
        const uiManager = this.modules.get('uiManager');
        const domUtils = this.modules.get('domUtils');

        // Global helper functions that existing code might expect
        window.vBookmarksHelpers = {
            // Bookmark operations
            createBookmark: (parentId, title, url) => {
                return bookmarkManager ? bookmarkManager.createBookmark(parentId, title, url) : Promise.reject('BookmarkManager not loaded');
            },

            createFolder: (parentId, title) => {
                return bookmarkManager ? bookmarkManager.createFolder(parentId, title) : Promise.reject('BookmarkManager not loaded');
            },

            updateBookmark: (id, changes) => {
                return bookmarkManager ? bookmarkManager.updateBookmark(id, changes) : Promise.reject('BookmarkManager not loaded');
            },

            deleteBookmark: (id) => {
                return bookmarkManager ? bookmarkManager.deleteBookmark(id) : Promise.reject('BookmarkManager not loaded');
            },

            searchBookmarks: (query) => {
                return bookmarkManager ? bookmarkManager.searchBookmarks(query) : Promise.reject('BookmarkManager not loaded');
            },

            // UI operations
            renderTree: (bookmarks) => {
                if (uiManager) {
                    uiManager.renderBookmarkTree(bookmarks);
                }
            },

            showSearchResults: (results) => {
                if (uiManager) {
                    uiManager.renderSearchResults(results);
                }
            },

            clearSearch: () => {
                if (uiManager) {
                    uiManager.clearSearch();
                }
            },

            // DOM utilities
            $: (selector) => domUtils ? domUtils.find(selector) : document.querySelector(selector),
            $$: (selector) => domUtils ? domUtils.findAll(selector) : document.querySelectorAll(selector),

            // Event helpers
            on: (element, event, handler) => {
                return domUtils ? domUtils.addEventListener(element, event, handler) : null;
            },

            // Utility functions
            debounce: (func, wait) => domUtils ? domUtils.debounce(func, wait) : func,
            throttle: (func, limit) => domUtils ? domUtils.throttle(func, limit) : func
        };

        // Legacy global functions that might be expected
        window.createBookmark = window.vBookmarksHelpers.createBookmark;
        window.createFolder = window.vBookmarksHelpers.createFolder;
        window.searchBookmarks = window.vBookmarksHelpers.searchBookmarks;
    }

    /**
     * Trigger legacy event for existing code
     */
    triggerLegacyEvent(eventName, data) {
        // Dispatch custom event that existing code might listen for
        window.dispatchEvent(new CustomEvent(`vbookmarks-${eventName}`, {
            detail: data
        }));

        // Call global event handler if it exists
        const handlerName = `on${eventName.charAt(0).toUpperCase() + eventName.slice(1)}`;
        if (typeof window[handlerName] === 'function') {
            try {
                window[handlerName](data);
            } catch (error) {
                console.error(`Error in legacy event handler ${handlerName}:`, error);
            }
        }
    }

    /**
     * Get loaded module
     */
    getModule(name) {
        return this.modules.get(name);
    }

    /**
     * Check if module is loaded
     */
    hasModule(name) {
        return this.modules.has(name);
    }

    /**
     * Get all loaded modules
     */
    getAllModules() {
        return new Map(this.modules);
    }

    /**
     * Reload a specific module
     */
    async reloadModule(name) {
        const module = this.modules.get(name);
        if (module && typeof module.destroy === 'function') {
            await module.destroy();
        }

        this.modules.delete(name);

        // Reload based on module type
        switch (name) {
            case 'bookmarkManager':
                if (window.BookmarkManager) {
                    this.modules.set('bookmarkManager', new BookmarkManager());
                    await this.modules.get('bookmarkManager').init();
                }
                break;
            case 'uiManager':
                if (window.UIManager) {
                    this.modules.set('uiManager', new UIManager());
                    this.modules.get('uiManager').init();
                }
                break;
            // Add other module types as needed
        }
    }

    /**
     * Get module system status
     */
    getStatus() {
        return {
            loaded: this.loaded,
            compatibilityMode: this.compatibilityMode,
            moduleCount: this.modules.size,
            modules: Array.from(this.modules.keys())
        };
    }
}

// Module loader creation and auto-initialization are now handled by legacy-bridge.js

// Export for use in other modules
export { ModuleLoader };