/**
 * vBookmarks Application Integration Tests
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { VBookmarksApp } from '../../src/app-v2.js';
import { createMockBookmark, createMockFolder, flushPromises, setupDOM, resetAllMocks } from '../setup.js';

describe('VBookmarksApp Integration', () => {
  let app;
  let domMock;

  beforeEach(() => {
    resetAllMocks();
    domMock = setupDOM();
    document.readyState = 'complete';
  });

  afterEach(async () => {
    if (app && app.initialized) {
      await app.destroy();
    }
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      // Mock successful Chrome API responses
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();

      expect(app.initialized).toBe(true);
      expect(app.managers.has('bookmarkManager')).toBe(true);
      expect(app.managers.has('uiManager')).toBe(true);
      expect(app.managers.has('searchManager')).toBe(true);
    });

    test('should handle initialization errors gracefully', async () => {
      // Mock Chrome API failure
      chrome.bookmarks.getTree.mockRejectedValue(new Error('Chrome API Error'));

      app = new VBookmarksApp();

      await expect(app.init()).rejects.toThrow('Chrome API Error');
      expect(app.initialized).toBe(false);
    });

    test('should expose global vBookmarks object', async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();

      expect(window.vBookmarks).toBeDefined();
      expect(window.vBookmarks.bookmarkManager).toBeDefined();
      expect(window.vBookmarks.uiManager).toBeDefined();
      expect(window.vBookmarks.searchManager).toBeDefined();
      expect(window.vBookmarks.configManager).toBeDefined();
    });
  });

  describe('Manager Integration', () => {
    beforeEach(async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();
    });

    test('should setup event handling between managers', async () => {
      const bookmarkManager = app.managers.get('bookmarkManager');
      const uiManager = app.managers.get('uiManager');

      // Verify event listeners are set up
      expect(bookmarkManager.listeners.has('bookmarksLoaded')).toBe(true);
      expect(bookmarkManager.listeners.has('bookmarkCreated')).toBe(true);
      expect(bookmarkManager.listeners.has('bookmarkUpdated')).toBe(true);
      expect(bookmarkManager.listeners.has('bookmarkDeleted')).toBe(true);
    });

    test('should handle bookmark events and update UI', async () => {
      const bookmarkManager = app.managers.get('bookmarkManager');
      const uiManager = app.managers.get('uiManager');

      // Mock UI manager methods
      const renderSpy = vi.spyOn(uiManager, 'renderBookmarkTree');
      const refreshSpy = vi.spyOn(uiManager, 'refreshCurrentView');

      // Simulate bookmarks loaded
      const mockBookmarks = [createMockBookmark()];
      await bookmarkManager.notifyListeners('bookmarksLoaded', mockBookmarks);

      expect(renderSpy).toHaveBeenCalledWith(mockBookmarks);

      // Simulate bookmark created
      const mockBookmark = createMockBookmark();
      await bookmarkManager.notifyListeners('bookmarkCreated', mockBookmark);

      expect(refreshSpy).toHaveBeenCalled();
    });

    test('should handle search integration', async () => {
      const searchManager = app.managers.get('searchManager');
      const uiManager = app.managers.get('uiManager');

      // Mock search manager methods
      const searchSpy = vi.spyOn(searchManager, 'search').mockResolvedValue([]);
      const renderResultsSpy = vi.spyOn(uiManager, 'renderSearchResults');

      // Perform search through app
      await app.handleSearch('test query');

      expect(searchSpy).toHaveBeenCalledWith('test query');
    });
  });

  describe('UI Integration', () => {
    beforeEach(async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();
    });

    test('should setup popup size from storage', async () => {
      // Mock stored popup size
      chrome.storage.local.get.mockImplementation((key) => {
        if (key === 'popupWidth') return Promise.resolve(500);
        if (key === 'popupHeight') return Promise.resolve(700);
        return Promise.resolve({});
      });

      await app.setupPopupSize();

      expect(document.body.style.width).toBe('500px');
      expect(document.body.style.height).toBe('700px');
    });

    test('should setup theme', () => {
      // Mock config manager to return theme
      vi.spyOn(app.managers.get('configManager'), 'get').mockReturnValue('dark');

      app.setupTheme();

      expect(document.documentElement.setAttribute).toHaveBeenCalledWith('data-theme', 'dark');
    });

    test('should focus search input', () => {
      const mockSearchInput = { focus: vi.fn(), select: vi.fn() };
      document.getElementById.mockReturnValue(mockSearchInput);

      app.focusSearch();

      expect(mockSearchInput.focus).toHaveBeenCalled();
      expect(mockSearchInput.select).toHaveBeenCalled();
    });
  });

  describe('Keyboard Shortcuts', () => {
    beforeEach(async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();
    });

    test('should handle Ctrl+F for search focus', () => {
      const focusSpy = vi.spyOn(app, 'focusSearch');
      const mockEvent = {
        key: 'f',
        ctrlKey: true,
        metaKey: false,
        preventDefault: vi.fn()
      };

      app.handleKeyDown(mockEvent);

      expect(focusSpy).toHaveBeenCalled();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    test('should handle Ctrl+N for new bookmark', () => {
      const newBookmarkSpy = vi.spyOn(app, 'createNewBookmark');
      const mockEvent = {
        key: 'n',
        ctrlKey: true,
        metaKey: false,
        preventDefault: vi.fn()
      };

      app.handleKeyDown(mockEvent);

      expect(newBookmarkSpy).toHaveBeenCalled();
      expect(mockEvent.preventDefault).toHaveBeenCalled();
    });

    test('should handle Escape key', () => {
      const clearSearchSpy = vi.spyOn(app, 'clearSearch');
      const mockEvent = {
        key: 'Escape',
        preventDefault: vi.fn()
      };

      app.handleKeyDown(mockEvent);

      expect(clearSearchSpy).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    test('should handle manager initialization errors', async () => {
      // Mock BookmarkManager to throw error
      const { BookmarkManager } = await import('../../src/core/bookmark-manager.js');
      vi.spyOn(BookmarkManager.prototype, 'init').mockRejectedValue(new Error('Manager init error'));

      app = new VBookmarksApp();

      await expect(app.init()).rejects.toThrow('Manager init error');
      expect(app.initialized).toBe(false);
    });

    test('should handle bookmark operations errors', async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();

      // Mock bookmark manager to throw error
      const bookmarkManager = app.managers.get('bookmarkManager');
      vi.spyOn(bookmarkManager, 'createBookmark').mockRejectedValue(new Error('Create error'));

      await expect(app.createNewBookmark()).resolves.not.toThrow(); // Should handle gracefully
    });

    test('should handle search errors', async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();

      // Mock search manager to throw error
      const searchManager = app.managers.get('searchManager');
      vi.spyOn(searchManager, 'search').mockRejectedValue(new Error('Search error'));

      await expect(app.handleSearch('test')).resolves.not.toThrow(); // Should handle gracefully
    });
  });

  describe('Performance', () => {
    test('should track performance metrics', async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();

      expect(app.performanceMetrics.size).toBeGreaterThan(0);
    });

    test('should measure initialization time', async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      const startTime = performance.now();
      app = new VBookmarksApp();
      await app.init();
      const endTime = performance.now();

      expect(endTime - startTime).toBeGreaterThan(0);
      expect(app.initialized).toBe(true);
    });
  });

  describe('Cleanup', () => {
    test('should destroy application and cleanup resources', async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();

      // Mock destroy methods
      const bookmarkManager = app.managers.get('bookmarkManager');
      const destroySpy = vi.spyOn(bookmarkManager, 'destroy').mockResolvedValue();

      await app.destroy();

      expect(destroySpy).toHaveBeenCalled();
      expect(app.destroyed).toBe(true);
      expect(app.initialized).toBe(false);
    });

    test('should handle destroy errors gracefully', async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();

      // Mock destroy to throw error
      const bookmarkManager = app.managers.get('bookmarkManager');
      vi.spyOn(bookmarkManager, 'destroy').mockRejectedValue(new Error('Destroy error'));

      await expect(app.destroy()).resolves.not.toThrow(); // Should handle gracefully
      expect(app.destroyed).toBe(true);
    });
  });

  describe('Configuration', () => {
    test('should respect configuration settings', async () => {
      chrome.bookmarks.getTree.mockResolvedValue([]);
      chrome.storage.local.get.mockResolvedValue({});

      app = new VBookmarksApp();
      await app.init();

      // Test debug mode configuration
      const configManager = app.managers.get('configManager');
      vi.spyOn(configManager, 'get').mockReturnValue(true);

      app.setupKeyboardShortcuts(); // Should be enabled

      vi.spyOn(configManager, 'get').mockReturnValue(false);

      // Keyboard shortcuts should not be set up when disabled
      document.addEventListener.mockClear();
      app.setupKeyboardShortcuts();

      expect(document.addEventListener).not.toHaveBeenCalled();
    });
  });
});