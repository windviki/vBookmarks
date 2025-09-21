/**
 * vBookmarks Application
 *
 * Main application entry point that coordinates all modules.
 */

import { DOMUtils } from './utils/dom-utils.js';

class VBookmarksApp {
    constructor() {
        this.bookmarkManager = null;
        this.uiManager = null;
        this.searchManager = null;
        this.initialized = false;
    }

    /**
     * Initialize the application
     */
    async init() {
        if (this.initialized) {
            console.warn('vBookmarks already initialized');
            return;
        }

        try {
            console.log('🚀 Initializing vBookmarks...');

            // Wait for DOMUtils to be available
            await this.waitForDOMUtils();

            // Initialize managers
            await this.initializeManagers();

            // Setup event handling
            this.setupEventHandling();

            // Load initial data
            await this.loadInitialData();

            // Setup UI
            this.setupUI();

            // Setup keyboard shortcuts
            this.setupKeyboardShortcuts();

            this.initialized = true;
            console.log('✅ vBookmarks initialized successfully');

            // Notify that app is ready
            this.notifyAppReady();

        } catch (error) {
            console.error('❌ Failed to initialize vBookmarks:', error);
            this.showError('Failed to initialize application');
        }
    }

    /**
     * Wait for DOMUtils to be available
     */
    async waitForDOMUtils() {
        const maxAttempts = 50; // 5 seconds max wait
        let attempts = 0;

        while (attempts < maxAttempts) {
            if (window.DOMUtils || DOMUtils) {
                console.log('🛠️ DOMUtils is available');
                return;
            }

            attempts++;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.warn('⚠️ DOMUtils not available after timeout, continuing without it');
    }

    /**
     * Initialize all managers
     */
    async initializeManagers() {
        // Initialize Bookmark Manager
        if (window.BookmarkManager) {
            this.bookmarkManager = new BookmarkManager();
            await this.bookmarkManager.init();
            console.log('📚 Bookmark manager initialized');
        } else {
            throw new Error('BookmarkManager not found');
        }

        // Initialize UI Manager
        if (window.UIManager) {
            this.uiManager = new UIManager();
            this.uiManager.init();
            console.log('🎨 UI manager initialized');
        } else {
            throw new Error('UIManager not found');
        }

        // Initialize Search Manager (if available)
        if (window.SearchManager) {
            this.searchManager = new SearchManager();
            await this.searchManager.init();
            console.log('🔍 Search manager initialized');
        }
    }

    /**
     * Setup event handling between managers
     */
    setupEventHandling() {
        // Bookmark Manager events
        this.bookmarkManager.addEventListener('bookmarksLoaded', (bookmarks) => {
            this.uiManager.renderBookmarkTree(bookmarks);
        });

        this.bookmarkManager.addEventListener('bookmarkCreated', (bookmark) => {
            this.showNotification('Bookmark created successfully', 'success');
            this.refreshCurrentView();
        });

        this.bookmarkManager.addEventListener('folderCreated', (folder) => {
            this.showNotification('Folder created successfully', 'success');
            this.refreshCurrentView();
        });

        this.bookmarkManager.addEventListener('bookmarkUpdated', (bookmark) => {
            this.showNotification('Bookmark updated', 'info');
            this.refreshCurrentView();
        });

        this.bookmarkManager.addEventListener('bookmarkDeleted', (bookmark) => {
            this.showNotification('Bookmark deleted', 'info');
            this.refreshCurrentView();
        });

        // UI Manager events
        this.uiManager.addEventListener('bookmarkClicked', (bookmark) => {
            this.handleBookmarkClick(bookmark);
        });

        this.uiManager.addEventListener('folderClicked', (folder) => {
            this.handleFolderClick(folder);
        });

        this.uiManager.addEventListener('bookmarkContextMenu', (data) => {
            this.handleBookmarkContextMenu(data);
        });

        this.uiManager.addEventListener('folderContextMenu', (data) => {
            this.handleFolderContextMenu(data);
        });

        // Search events (if search manager exists)
        if (this.searchManager) {
            this.setupSearchEvents();
        }
    }

    /**
     * Setup search events
     */
    setupSearchEvents() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            // Use DOMUtils if available, otherwise fallback to native methods
            const domUtils = window.DOMUtils || DOMUtils;
            if (domUtils) {
                domUtils.addEventListener(searchInput, 'input', domUtils.debounce((e) => {
                    const query = e.target.value.trim();
                    this.handleSearch(query);
                }, 300));

                domUtils.addEventListener(searchInput, 'keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.handleSearch(e.target.value.trim());
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.clearSearch();
                    }
                });
            } else {
                // Fallback to native event listeners
                searchInput.addEventListener('input', (e) => {
                    const query = e.target.value.trim();
                    this.handleSearch(query);
                });

                searchInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.handleSearch(e.target.value.trim());
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        this.clearSearch();
                    }
                });
            }
        }
    }

    /**
     * Load initial data
     */
    async loadInitialData() {
        try {
            // Load settings from localStorage
            this.loadSettings();

            // Bookmarks are loaded by bookmark manager
            console.log('📊 Initial data loaded');
        } catch (error) {
            console.error('Failed to load initial data:', error);
            throw error;
        }
    }

    /**
     * Setup UI components
     */
    setupUI() {
        // Setup donation banner
        this.setupDonationBanner();

        // Setup sync status (if available)
        this.setupSyncStatus();

        // Setup auto-resize
        this.setupAutoResize();

        console.log('🎨 UI setup completed');
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        const domUtils = window.DOMUtils || DOMUtils;
        const addEventListener = domUtils ? domUtils.addEventListener.bind(domUtils) : document.addEventListener.bind(document);

        addEventListener(document, 'keydown', (e) => {
            // Ctrl/Cmd + F: Focus search
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                this.focusSearch();
            }

            // Ctrl/Cmd + N: New bookmark
            if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
                e.preventDefault();
                this.createNewBookmark();
            }

            // Ctrl/Cmd + Shift + N: New folder
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
                e.preventDefault();
                this.createNewFolder();
            }

            // Escape: Clear search or close dialogs
            if (e.key === 'Escape') {
                this.handleEscapeKey();
            }
        });
    }

    /**
     * Handle bookmark click
     */
    handleBookmarkClick(bookmark) {
        if (bookmark.url) {
            chrome.tabs.create({ url: bookmark.url });
        }
    }

    /**
     * Handle folder click
     */
    handleFolderClick(folder) {
        // Folder toggle is handled by UI manager
        console.log('Folder clicked:', folder.title);
    }

    /**
     * Handle bookmark context menu
     */
    handleBookmarkContextMenu(data) {
        // This would integrate with existing context menu logic
        console.log('Bookmark context menu:', data);
    }

    /**
     * Handle folder context menu
     */
    handleFolderContextMenu(data) {
        // This would integrate with existing context menu logic
        console.log('Folder context menu:', data);
    }

    /**
     * Handle search
     */
    async handleSearch(query) {
        if (!query) {
            this.clearSearch();
            return;
        }

        try {
            const results = await this.bookmarkManager.searchBookmarks(query);
            this.uiManager.renderSearchResults(results);
            console.log(`🔍 Search results: ${results.length} items`);
        } catch (error) {
            console.error('Search failed:', error);
            this.showNotification('Search failed', 'error');
        }
    }

    /**
     * Clear search
     */
    clearSearch() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
        }
        this.uiManager.showTreeView();
    }

    /**
     * Focus search input
     */
    focusSearch() {
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.focus();
            searchInput.select();
        }
    }

    /**
     * Refresh current view
     */
    async refreshCurrentView() {
        try {
            const bookmarks = await this.bookmarkManager.loadBookmarks();
            if (this.uiManager.currentView === 'tree') {
                this.uiManager.renderBookmarkTree(bookmarks);
            } else {
                // Re-run search if in results view
                const searchInput = document.getElementById('search-input');
                if (searchInput && searchInput.value.trim()) {
                    await this.handleSearch(searchInput.value.trim());
                }
            }
        } catch (error) {
            console.error('Failed to refresh view:', error);
        }
    }

    /**
     * Load settings from localStorage
     */
    loadSettings() {
        // Load existing settings
        this.settings = {
            autoResizePopup: localStorage.autoResizePopup !== 'false',
            showSyncStatus: localStorage.showSyncStatus === 'true',
            // Add other settings as needed
        };
    }

    /**
     * Setup donation banner
     */
    setupDonationBanner() {
        // This would integrate with existing donation banner logic
        console.log('💰 Donation banner setup');
    }

    /**
     * Setup sync status
     */
    setupSyncStatus() {
        // This would integrate with existing sync status logic
        if (window.syncManager) {
            console.log('🔄 Sync status setup');
        }
    }

    /**
     * Setup auto-resize
     */
    setupAutoResize() {
        // This would integrate with existing auto-resize logic
        console.log('📏 Auto-resize setup');
    }

    /**
     * Handle escape key
     */
    handleEscapeKey() {
        const searchInput = document.getElementById('search-input');
        if (searchInput && document.activeElement === searchInput) {
            this.clearSearch();
        }
        // Close any open dialogs
    }

    /**
     * Create new bookmark
     */
    createNewBookmark() {
        // This would integrate with existing bookmark creation logic
        console.log('📖 Create new bookmark');
    }

    /**
     * Create new folder
     */
    createNewFolder() {
        // This would integrate with existing folder creation logic
        console.log('📁 Create new folder');
    }

    /**
     * Show notification
     */
    showNotification(message, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${message}`);
        // This could show a toast notification
    }

    /**
     * Show error message
     */
    showError(message) {
        console.error('❌', message);
        this.showNotification(message, 'error');
    }

    /**
     * Notify that app is ready
     */
    notifyAppReady() {
        // Dispatch custom event for other scripts
        window.dispatchEvent(new CustomEvent('vbookmarks-ready', {
            detail: { app: this }
        }));

        console.log('🎉 vBookmarks is ready!');
    }

    /**
     * Get application state
     */
    getAppState() {
        return {
            initialized: this.initialized,
            currentView: this.uiManager?.currentView,
            settings: this.settings,
            bookmarkCount: this.bookmarkManager?.bookmarks?.length || 0
        };
    }

    /**
     * Destroy application and cleanup
     */
    destroy() {
        // Cleanup event listeners
        // Remove managers
        // Clear caches
        this.initialized = false;
        console.log('🧹 vBookmarks destroyed');
    }
}

// Auto-initialization is now handled by legacy-bridge.js

// Export for use in other modules
export { VBookmarksApp };