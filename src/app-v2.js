/**
 * vBookmarks Modern Application
 *
 * Main application entry point with modern architecture
 */

import { APP_CONFIG, DOM_IDS, EVENTS, KEYBOARD_SHORTCUTS } from './constants/index.js';
import { logger } from './utils/logger.js';
import { storage } from './utils/storage.js';
import { eventSystem } from './core/event-system.js';
import { errorHandler } from './core/error-handler.js';
import { configManager } from './core/config-manager.js';
import { BookmarkManager } from './core/bookmark-manager.js';
import { UIManager } from './core/ui-manager.js';
import { SearchManager } from './core/search-manager.js';

export class VBookmarksApp {
  constructor() {
    this.initialized = false;
    this.destroyed = false;
    this.managers = new Map();
    this.timers = new Map();
    this.performanceMetrics = new Map();
  }

  /**
   * Initialize the application
   */
  async init() {
    if (this.initialized) {
      logger.warn('vBookmarks already initialized');
      return;
    }

    const initTimer = logger.time('App Initialization');

    try {
      logger.info('🚀 Initializing vBookmarks v2...');

      // Initialize core systems first
      await this.initCoreSystems();

      // Initialize managers
      await this.initManagers();

      // Setup event handling
      this.setupEventHandling();

      // Load initial data
      await this.loadInitialData();

      // Setup UI
      this.setupUI();

      // Setup keyboard shortcuts
      this.setupKeyboardShortcuts();

      // Setup performance monitoring
      this.setupPerformanceMonitoring();

      this.initialized = true;

      initTimer.end();
      logger.info('✅ vBookmarks v2 initialized successfully');

      // Notify that app is ready
      await this.notifyAppReady();

    } catch (error) {
      initTimer.end();
      await errorHandler.handleError(error, {
        source: 'app_init',
        message: 'Failed to initialize vBookmarks v2'
      });
      throw error;
    }
  }

  /**
   * Initialize core systems
   */
  async initCoreSystems() {
    logger.info('Initializing core systems...');

    // Initialize configuration manager
    await configManager.init();

    // Configure logger based on settings
    logger.setEnabled(configManager.get('debugMode'));

    logger.info('Core systems initialized');
  }

  /**
   * Initialize all managers
   */
  async initManagers() {
    logger.info('Initializing managers...');

    try {
      // Initialize Bookmark Manager
      const bookmarkManager = new BookmarkManager();
      await bookmarkManager.init();
      this.managers.set('bookmarkManager', bookmarkManager);
      logger.info('📚 Bookmark manager initialized');

      // Initialize UI Manager
      const uiManager = new UIManager();
      uiManager.init();
      this.managers.set('uiManager', uiManager);
      logger.info('🎨 UI manager initialized');

      // Initialize Search Manager
      const searchManager = new SearchManager();
      await searchManager.init();
      this.managers.set('searchManager', searchManager);
      logger.info('🔍 Search manager initialized');

      // Expose managers globally for compatibility
      window.vBookmarks = {
        bookmarkManager,
        uiManager,
        searchManager,
        configManager,
        storage,
        eventSystem,
        logger
      };

    } catch (error) {
      await errorHandler.handleError(error, {
        source: 'manager_init',
        message: 'Failed to initialize managers'
      });
      throw error;
    }
  }

  /**
   * Setup event handling between managers
   */
  setupEventHandling() {
    logger.info('Setting up event handling...');

    const bookmarkManager = this.managers.get('bookmarkManager');
    const uiManager = this.managers.get('uiManager');
    const searchManager = this.managers.get('searchManager');

    // Bookmark events to UI
    if (bookmarkManager && uiManager) {
      bookmarkManager.addEventListener(EVENTS.BOOKMARKS_LOADED, (bookmarks) => {
        this.trackPerformance('treeRender', () => {
          uiManager.renderBookmarkTree(bookmarks);
        });
      });

      bookmarkManager.addEventListener(EVENTS.BOOKMARK_CREATED, (bookmark) => {
        this.showNotification('Bookmark created successfully', 'success');
        this.refreshCurrentView();
      });

      bookmarkManager.addEventListener(EVENTS.FOLDER_CREATED, (folder) => {
        this.showNotification('Folder created successfully', 'success');
        this.refreshCurrentView();
      });

      bookmarkManager.addEventListener(EVENTS.BOOKMARK_UPDATED, (bookmark) => {
        this.showNotification('Bookmark updated', 'info');
        this.refreshCurrentView();
      });

      bookmarkManager.addEventListener(EVENTS.BOOKMARK_DELETED, (bookmark) => {
        this.showNotification('Bookmark deleted', 'info');
        this.refreshCurrentView();
      });
    }

    // UI events to handlers
    if (uiManager) {
      uiManager.addEventListener(EVENTS.BOOKMARK_CLICKED, (bookmark) => {
        this.handleBookmarkClick(bookmark);
      });

      uiManager.addEventListener(EVENTS.FOLDER_CLICKED, (folder) => {
        this.handleFolderClick(folder);
      });

      uiManager.addEventListener(EVENTS.BOOKMARK_CONTEXT_MENU, (data) => {
        this.handleBookmarkContextMenu(data);
      });

      uiManager.addEventListener(EVENTS.FOLDER_CONTEXT_MENU, (data) => {
        this.handleFolderContextMenu(data);
      });

      uiManager.addEventListener(EVENTS.SEARCH_CLEARED, () => {
        this.clearSearch();
      });
    }

    // Search events
    if (searchManager && uiManager) {
      searchManager.addEventListener(EVENTS.SEARCH_COMPLETED, (data) => {
        this.trackPerformance('searchRender', () => {
          uiManager.renderSearchResults(data.results);
        });
      });

      searchManager.addEventListener(EVENTS.SEARCH_CLEARED, () => {
        uiManager.showTreeView();
      });
    }

    // Configuration changes
    configManager.observe('debugMode', (enabled) => {
      logger.setEnabled(enabled);
      logger.info(`Debug mode ${enabled ? 'enabled' : 'disabled'}`);
    });

    // Global error handling
    eventSystem.on(EVENTS.APP_ERROR, (error) => {
      logger.error('Application error:', error);
    });

    logger.info('Event handling setup completed');
  }

  /**
   * Load initial data
   */
  async loadInitialData() {
    logger.info('Loading initial data...');

    try {
      // Bookmarks are loaded by bookmark manager
      logger.info('📊 Initial data loaded');
    } catch (error) {
      await errorHandler.handleError(error, {
        source: 'data_load',
        message: 'Failed to load initial data'
      });
      throw error;
    }
  }

  /**
   * Setup UI components
   */
  setupUI() {
    logger.info('Setting up UI...');

    // Setup popup size
    this.setupPopupSize();

    // Setup theme
    this.setupTheme();

    // Setup donation banner if enabled
    if (configManager.get('showDonationBanner')) {
      this.setupDonationBanner();
    }

    // Setup auto-resize if enabled
    if (configManager.get('autoResize')) {
      this.setupAutoResize();
    }

    logger.info('🎨 UI setup completed');
  }

  /**
   * Setup keyboard shortcuts
   */
  setupKeyboardShortcuts() {
    if (!configManager.get('enableKeyboardShortcuts')) {
      return;
    }

    logger.info('Setting up keyboard shortcuts...');

    document.addEventListener('keydown', (e) => this.handleKeyDown(e));

    logger.info('⌨️ Keyboard shortcuts setup completed');
  }

  /**
   * Setup performance monitoring
   */
  setupPerformanceMonitoring() {
    if (!configManager.get('debugMode')) {
      return;
    }

    logger.info('Setting up performance monitoring...');

    // Monitor page load performance
    window.addEventListener('load', () => {
      const navigation = performance.getEntriesByType('navigation')[0];
      if (navigation) {
        logger.performance('Page Load', navigation.loadEventEnd - navigation.fetchStart);
      }
    });

    // Monitor memory usage if available
    if (performance.memory) {
      setInterval(() => {
        const memory = performance.memory;
        logger.performance('Memory Usage', Math.round(memory.usedJSHeapSize / 1024 / 1024), {
          total: Math.round(memory.totalJSHeapSize / 1024 / 1024),
          limit: Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
        });
      }, 30000); // Every 30 seconds
    }

    logger.info('📊 Performance monitoring setup completed');
  }

  /**
   * Handle keyboard shortcuts
   */
  handleKeyDown(event) {
    const shortcut = KEYBOARD_SHORTCUTS;

    // Ctrl/Cmd + F: Focus search
    if ((event.ctrlKey || event.metaKey) && event.key === shortcut.SEARCH.key) {
      event.preventDefault();
      this.focusSearch();
    }

    // Ctrl/Cmd + N: New bookmark
    if ((event.ctrlKey || event.metaKey) && event.key === shortcut.NEW_BOOKMARK.key) {
      event.preventDefault();
      this.createNewBookmark();
    }

    // Ctrl/Cmd + Shift + N: New folder
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === shortcut.NEW_FOLDER.key) {
      event.preventDefault();
      this.createNewFolder();
    }

    // Escape: Clear search or close dialogs
    if (event.key === shortcut.ESCAPE.key) {
      this.handleEscapeKey();
    }
  }

  /**
   * Setup popup size
   */
  async setupPopupSize() {
    try {
      const { width, height } = await storage.getPopupSize();
      document.body.style.width = `${width}px`;
      document.body.style.height = `${height}px`;
    } catch (error) {
      logger.error('Failed to setup popup size', error);
    }
  }

  /**
   * Setup theme
   */
  setupTheme() {
    const theme = configManager.get('theme');
    document.documentElement.setAttribute('data-theme', theme);
  }

  /**
   * Setup donation banner
   */
  setupDonationBanner() {
    // Implementation would go here
    logger.debug('Donation banner setup');
  }

  /**
   * Setup auto-resize
   */
  setupAutoResize() {
    // Implementation would go here
    logger.debug('Auto-resize setup');
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
    logger.debug('Folder clicked:', folder.title);
  }

  /**
   * Handle bookmark context menu
   */
  handleBookmarkContextMenu(data) {
    logger.debug('Bookmark context menu:', data);
  }

  /**
   * Handle folder context menu
   */
  handleFolderContextMenu(data) {
    logger.debug('Folder context menu:', data);
  }

  /**
   * Handle search
   */
  async handleSearch(query) {
    if (!query) {
      await this.clearSearch();
      return;
    }

    const searchManager = this.managers.get('searchManager');
    if (searchManager) {
      try {
        await searchManager.search(query);
        logger.debug(`Search results for: ${query}`);
      } catch (error) {
        await errorHandler.handleError(error, {
          source: 'search',
          message: 'Search failed'
        });
      }
    }
  }

  /**
   * Clear search
   */
  async clearSearch() {
    const searchManager = this.managers.get('searchManager');
    if (searchManager) {
      searchManager.clearSearch();
    }

    const searchInput = document.getElementById(DOM_IDS.SEARCH_INPUT);
    if (searchInput) {
      searchInput.value = '';
    }
  }

  /**
   * Focus search input
   */
  focusSearch() {
    const searchInput = document.getElementById(DOM_IDS.SEARCH_INPUT);
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  /**
   * Handle escape key
   */
  handleEscapeKey() {
    const searchInput = document.getElementById(DOM_IDS.SEARCH_INPUT);
    if (searchInput && document.activeElement === searchInput) {
      this.clearSearch();
    }
  }

  /**
   * Refresh current view
   */
  async refreshCurrentView() {
    const bookmarkManager = this.managers.get('bookmarkManager');
    const uiManager = this.managers.get('uiManager');

    if (bookmarkManager && uiManager) {
      try {
        const bookmarks = await bookmarkManager.loadBookmarks();
        uiManager.refreshCurrentView(bookmarks);
      } catch (error) {
        await errorHandler.handleError(error, {
          source: 'refresh',
          message: 'Failed to refresh view'
        });
      }
    }
  }

  /**
   * Create new bookmark
   */
  createNewBookmark() {
    logger.debug('Create new bookmark');
    // Implementation would integrate with existing bookmark creation logic
  }

  /**
   * Create new folder
   */
  createNewFolder() {
    logger.debug('Create new folder');
    // Implementation would integrate with existing folder creation logic
  }

  /**
   * Show notification
   */
  showNotification(message, type = 'info') {
    logger.info(`[${type.toUpperCase()}] ${message}`);
    // Implementation could show toast notification
  }

  /**
   * Track performance metric
   */
  trackPerformance(name, fn) {
    const timer = logger.time(name);
    try {
      const result = fn();
      timer.end();
      return result;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  /**
   * Get application state
   */
  getAppState() {
    const bookmarkManager = this.managers.get('bookmarkManager');
    const uiManager = this.managers.get('uiManager');

    return {
      initialized: this.initialized,
      version: APP_CONFIG.VERSION,
      config: configManager.getAll(),
      currentView: uiManager?.currentView,
      bookmarkCount: bookmarkManager?.bookmarks?.length || 0,
      performance: Object.fromEntries(this.performanceMetrics)
    };
  }

  /**
   * Notify that app is ready
   */
  async notifyAppReady() {
    try {
      await eventSystem.emit(EVENTS.APP_READY, this.getAppState());
      logger.info('🎉 vBookmarks v2 is ready!');
    } catch (error) {
      await errorHandler.handleError(error, {
        source: 'app_ready',
        message: 'Failed to notify app ready'
      });
    }
  }

  /**
   * Destroy application and cleanup
   */
  async destroy() {
    if (this.destroyed) {
      return;
    }

    logger.info('🧹 Destroying vBookmarks v2...');

    try {
      // Clear timers
      for (const timer of this.timers.values()) {
        clearTimeout(timer);
      }
      this.timers.clear();

      // Destroy managers
      for (const [name, manager] of this.managers.entries()) {
        if (typeof manager.destroy === 'function') {
          await manager.destroy();
        }
      }
      this.managers.clear();

      // Cleanup event system
      eventSystem.destroy();

      // Reset state
      this.initialized = false;
      this.destroyed = true;

      logger.info('✅ vBookmarks v2 destroyed successfully');
    } catch (error) {
      await errorHandler.handleError(error, {
        source: 'app_destroy',
        message: 'Failed to destroy application'
      });
    }
  }
}

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.vBookmarksApp = new VBookmarksApp();
    window.vBookmarksApp.init().catch(error => {
      console.error('Failed to initialize vBookmarks v2:', error);
    });
  });
} else {
  window.vBookmarksApp = new VBookmarksApp();
  window.vBookmarksApp.init().catch(error => {
    console.error('Failed to initialize vBookmarks v2:', error);
  });
}

// Export for testing
export { VBookmarksApp };