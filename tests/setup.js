/**
 * vBookmarks Test Setup
 *
 * Test environment configuration and utilities
 */

import { vi, beforeEach, afterEach, describe, test, expect } from 'vitest';

// Mock Chrome APIs
global.chrome = {
  runtime: {
    lastError: null,
    getManifest: vi.fn(() => ({
      name: 'vBookmarks',
      version: '2.0.0',
      manifest_version: 3
    })),
    getURL: vi.fn((path) => `chrome-extension://test/${path}`)
  },
  bookmarks: {
    getTree: vi.fn(),
    getChildren: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    remove: vi.fn(),
    removeTree: vi.fn(),
    search: vi.fn(),
    onCreated: {
      addListener: vi.fn()
    },
    onRemoved: {
      addListener: vi.fn()
    },
    onChanged: {
      addListener: vi.fn()
    },
    onMoved: {
      addListener: vi.fn()
    },
    onChildrenReordered: {
      addListener: vi.fn()
    }
  },
  tabs: {
    create: vi.fn(),
    update: vi.fn()
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn()
    }
  },
  i18n: {
    getMessage: vi.fn((message) => message)
  }
};

// Mock localStorage
global.localStorage = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn()
};

// Mock DOM
global.document = {
  createElement: vi.fn(),
  getElementById: vi.fn(),
  querySelector: vi.fn(),
  querySelectorAll: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  readyState: 'complete',
  documentElement: {
    setAttribute: vi.fn(),
    getAttribute: vi.fn()
  },
  body: {
    style: {}
  }
};

global.window = {
  document: global.document,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  performance: {
    now: vi.fn(() => Date.now()),
    getEntriesByType: vi.fn(() => [])
  },
  CustomEvent: vi.fn((type, detail) => ({ type, detail })),
  location: { href: 'http://localhost' }
};

// Mock performance API
global.performance = {
  now: vi.fn(() => Date.now()),
  getEntriesByType: vi.fn(() => []),
  mark: vi.fn(),
  measure: vi.fn(),
  clearMarks: vi.fn(),
  clearMeasures: vi.fn()
};

// Test utilities
export const createMockBookmark = (overrides = {}) => ({
  id: '1',
  parentId: '0',
  title: 'Test Bookmark',
  url: 'https://example.com',
  dateAdded: Date.now(),
  ...overrides
});

export const createMockFolder = (overrides = {}) => ({
  id: '1',
  parentId: '0',
  title: 'Test Folder',
  children: [],
  dateAdded: Date.now(),
  ...overrides
});

export const createMockEvent = (type, data = {}) => ({
  type,
  data,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn()
});

export const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

export const mockChromeAPI = (api, method, returnValue) => {
  chrome[api][method].mockReturnValue(returnValue);
};

export const resetAllMocks = () => {
  Object.keys(chrome).forEach(api => {
    if (typeof chrome[api] === 'object') {
      Object.keys(chrome[api]).forEach(method => {
        if (typeof chrome[api][method] === 'function') {
          chrome[api][method].mockClear();
        }
      });
    }
  });

  Object.keys(localStorage).forEach(method => {
    if (typeof localStorage[method] === 'function') {
      localStorage[method].mockClear();
    }
  });

  Object.keys(document).forEach(method => {
    if (typeof document[method] === 'function') {
      document[method].mockClear();
    }
  });
};

// Test helper functions
export const createTestEnvironment = () => {
  return {
    chrome,
    localStorage,
    document,
    window: global.window,
    performance: global.performance
  };
};

export const setupDOM = () => {
  const mockElement = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    querySelector: vi.fn(),
    querySelectorAll: vi.fn(),
    getAttribute: vi.fn(),
    setAttribute: vi.fn(),
    hasAttribute: vi.fn(),
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      toggle: vi.fn(),
      contains: vi.fn()
    },
    style: {},
    innerHTML: '',
    textContent: '',
    value: '',
    focus: vi.fn(),
    blur: vi.fn(),
    click: vi.fn(),
    dispatchEvent: vi.fn()
  };

  document.getElementById.mockReturnValue(mockElement);
  document.querySelector.mockReturnValue(mockElement);
  document.querySelectorAll.mockReturnValue([mockElement]);
  document.createElement.mockReturnValue(mockElement);

  return mockElement;
};

// Global test setup
beforeEach(() => {
  resetAllMocks();
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// Export vitest globals
export { vi, beforeEach, afterEach, describe, test, expect };