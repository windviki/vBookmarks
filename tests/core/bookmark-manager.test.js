/**
 * vBookmarks Bookmark Manager Tests
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BookmarkManager } from '../../src/core/bookmark-manager.js';
import { createMockBookmark, createMockFolder, flushPromises, mockChromeAPI, resetAllMocks } from '../setup.js';

describe('BookmarkManager', () => {
  let bookmarkManager;

  beforeEach(() => {
    resetAllMocks();
    bookmarkManager = new BookmarkManager();
  });

  describe('Initialization', () => {
    test('should initialize successfully', async () => {
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve([]));

      await bookmarkManager.init();

      expect(bookmarkManager.initialized).toBe(true);
      expect(chrome.bookmarks.getTree).toHaveBeenCalled();
    });

    test('should handle initialization error', async () => {
      chrome.runtime.lastError = { message: 'Test error' };
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve(null));

      await expect(bookmarkManager.init()).rejects.toThrow();
    });
  });

  describe('loadBookmarks', () => {
    test('should load bookmarks from Chrome API', async () => {
      const mockBookmarks = [createMockBookmark()];
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve(mockBookmarks));

      const result = await bookmarkManager.loadBookmarks();

      expect(result).toEqual(mockBookmarks);
      expect(bookmarkManager.bookmarks).toEqual(mockBookmarks);
    });

    test('should handle Chrome API error', async () => {
      chrome.runtime.lastError = { message: 'API Error' };
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve([]));

      await expect(bookmarkManager.loadBookmarks()).rejects.toThrow();
    });
  });

  describe('createBookmark', () => {
    test('should create a new bookmark', async () => {
      const mockBookmark = createMockBookmark();
      mockChromeAPI('bookmarks', 'create', Promise.resolve(mockBookmark));

      const result = await bookmarkManager.createBookmark('1', 'Test Bookmark', 'https://test.com');

      expect(result).toEqual(mockBookmark);
      expect(chrome.bookmarks.create).toHaveBeenCalledWith({
        parentId: '1',
        title: 'Test Bookmark',
        url: 'https://test.com'
      });
    });

    test('should handle create bookmark error', async () => {
      chrome.runtime.lastError = { message: 'Create failed' };
      mockChromeAPI('bookmarks', 'create', Promise.resolve(null));

      await expect(bookmarkManager.createBookmark('1', 'Test', 'https://test.com')).rejects.toThrow();
    });
  });

  describe('createFolder', () => {
    test('should create a new folder', async () => {
      const mockFolder = createMockFolder();
      mockChromeAPI('bookmarks', 'create', Promise.resolve(mockFolder));

      const result = await bookmarkManager.createFolder('1', 'Test Folder');

      expect(result).toEqual(mockFolder);
      expect(chrome.bookmarks.create).toHaveBeenCalledWith({
        parentId: '1',
        title: 'Test Folder'
      });
    });
  });

  describe('updateBookmark', () => {
    test('should update bookmark', async () => {
      const mockBookmark = createMockBookmark({ title: 'Updated Title' });
      mockChromeAPI('bookmarks', 'update', Promise.resolve(mockBookmark));

      const result = await bookmarkManager.updateBookmark('1', { title: 'Updated Title' });

      expect(result).toEqual(mockBookmark);
      expect(chrome.bookmarks.update).toHaveBeenCalledWith('1', { title: 'Updated Title' });
    });
  });

  describe('moveBookmark', () => {
    test('should move bookmark', async () => {
      const mockBookmark = createMockBookmark();
      mockChromeAPI('bookmarks', 'move', Promise.resolve(mockBookmark));

      const result = await bookmarkManager.moveBookmark('1', '2', 0);

      expect(result).toEqual(mockBookmark);
      expect(chrome.bookmarks.move).toHaveBeenCalledWith('1', { parentId: '2', index: 0 });
    });

    test('should move bookmark without index', async () => {
      const mockBookmark = createMockBookmark();
      mockChromeAPI('bookmarks', 'move', Promise.resolve(mockBookmark));

      await bookmarkManager.moveBookmark('1', '2');

      expect(chrome.bookmarks.move).toHaveBeenCalledWith('1', { parentId: '2' });
    });
  });

  describe('deleteBookmark', () => {
    test('should delete bookmark', async () => {
      const mockBookmark = createMockBookmark();
      mockChromeAPI('bookmarks', 'remove', Promise.resolve(mockBookmark));

      const result = await bookmarkManager.deleteBookmark('1');

      expect(result).toEqual(mockBookmark);
      expect(chrome.bookmarks.remove).toHaveBeenCalledWith('1');
    });
  });

  describe('deleteFolder', () => {
    test('should delete folder tree', async () => {
      const mockFolder = createMockFolder();
      mockChromeAPI('bookmarks', 'removeTree', Promise.resolve(mockFolder));

      const result = await bookmarkManager.deleteFolder('1');

      expect(result).toEqual(mockFolder);
      expect(chrome.bookmarks.removeTree).toHaveBeenCalledWith('1');
    });
  });

  describe('searchBookmarks', () => {
    test('should search bookmarks', async () => {
      const mockResults = [createMockBookmark()];
      mockChromeAPI('bookmarks', 'search', Promise.resolve(mockResults));

      const result = await bookmarkManager.searchBookmarks('test');

      expect(result).toEqual(mockResults);
      expect(chrome.bookmarks.search).toHaveBeenCalledWith('test');
    });
  });

  describe('getBookmarkById', () => {
    test('should find bookmark by ID', () => {
      const mockBookmark = createMockBookmark({ id: '123' });
      bookmarkManager.bookmarks = [mockBookmark];

      const result = bookmarkManager.getBookmarkById('123');

      expect(result).toEqual(mockBookmark);
    });

    test('should return null if bookmark not found', () => {
      bookmarkManager.bookmarks = [createMockBookmark({ id: '123' })];

      const result = bookmarkManager.getBookmarkById('456');

      expect(result).toBeNull();
    });

    test('should search recursively in children', () => {
      const childBookmark = createMockBookmark({ id: 'child' });
      const parentFolder = createMockFolder({
        id: 'parent',
        children: [childBookmark]
      });

      bookmarkManager.bookmarks = [parentFolder];

      const result = bookmarkManager.getBookmarkById('child');

      expect(result).toEqual(childBookmark);
    });
  });

  describe('getBookmarkPath', () => {
    test('should return bookmark path', () => {
      const childBookmark = createMockBookmark({ id: 'child' });
      const parentFolder = createMockFolder({
        id: 'parent',
        children: [childBookmark]
      });

      bookmarkManager.bookmarks = [parentFolder];

      const path = bookmarkManager.getBookmarkPath('child');

      expect(path).toEqual([parentFolder, childBookmark]);
    });

    test('should return null if bookmark not found', () => {
      bookmarkManager.bookmarks = [createMockBookmark()];

      const path = bookmarkManager.getBookmarkPath('nonexistent');

      expect(path).toBeNull();
    });
  });

  describe('Event Listeners', () => {
    test('should add event listener', () => {
      const callback = vi.fn();
      bookmarkManager.addEventListener('test', callback);

      expect(bookmarkManager.listeners.get('test')).toContain(callback);
    });

    test('should remove event listener', () => {
      const callback = vi.fn();
      bookmarkManager.addEventListener('test', callback);
      bookmarkManager.removeEventListener('test', callback);

      expect(bookmarkManager.listeners.get('test')).not.toContain(callback);
    });

    test('should notify listeners on event', async () => {
      const callback = vi.fn();
      bookmarkManager.addEventListener('bookmarksLoaded', callback);

      const mockBookmarks = [createMockBookmark()];
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve(mockBookmarks));

      await bookmarkManager.loadBookmarks();

      expect(callback).toHaveBeenCalledWith(mockBookmarks);
    });

    test('should handle listener errors gracefully', async () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      const successCallback = vi.fn();

      bookmarkManager.addEventListener('bookmarksLoaded', errorCallback);
      bookmarkManager.addEventListener('bookmarksLoaded', successCallback);

      const mockBookmarks = [createMockBookmark()];
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve(mockBookmarks));

      await bookmarkManager.loadBookmarks();

      expect(successCallback).toHaveBeenCalledWith(mockBookmarks);
    });
  });

  describe('Chrome Event Listeners', () => {
    test('should setup Chrome event listeners on init', async () => {
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve([]));

      await bookmarkManager.init();

      expect(chrome.bookmarks.onCreated.addListener).toHaveBeenCalled();
      expect(chrome.bookmarks.onRemoved.addListener).toHaveBeenCalled();
      expect(chrome.bookmarks.onChanged.addListener).toHaveBeenCalled();
      expect(chrome.bookmarks.onMoved.addListener).toHaveBeenCalled();
      expect(chrome.bookmarks.onChildrenReordered.addListener).toHaveBeenCalled();
    });

    test('should reload bookmarks on Chrome events', async () => {
      const loadSpy = vi.spyOn(bookmarkManager, 'loadBookmarks').mockResolvedValue([]);
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve([]));

      await bookmarkManager.init();

      // Simulate Chrome events
      const createdCallback = chrome.bookmarks.onCreated.addListener.mock.calls[0][0];
      const removedCallback = chrome.bookmarks.onRemoved.addListener.mock.calls[0][0];

      createdCallback('1', createMockBookmark());
      removedCallback('1', { parentId: '0' });

      expect(loadSpy).toHaveBeenCalledTimes(2); // Initial load + 2 events
    });
  });

  describe('Error Handling', () => {
    test('should handle Chrome API runtime errors', async () => {
      chrome.runtime.lastError = { message: 'Runtime error' };
      mockChromeAPI('bookmarks', 'getTree', Promise.resolve([]));

      await expect(bookmarkManager.init()).rejects.toThrow('Runtime error');
    });

    test('should handle invalid bookmark ID', () => {
      bookmarkManager.bookmarks = [createMockBookmark()];

      const result = bookmarkManager.getBookmarkById('invalid');

      expect(result).toBeNull();
    });

    test('should handle malformed bookmark data', () => {
      const malformedBookmark = { id: '1' }; // Missing required fields
      bookmarkManager.bookmarks = [malformedBookmark];

      const result = bookmarkManager.getBookmarkById('1');

      expect(result).toEqual(malformedBookmark); // Should still return what it finds
    });
  });
});