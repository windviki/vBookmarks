/**
 * vBookmarks Constants
 *
 * Centralized constants for the application
 */

export const APP_CONFIG = {
  NAME: 'vBookmarks',
  VERSION: '2.0.0',
  DEBUG: process.env.NODE_ENV === 'development'
};

export const STORAGE_KEYS = {
  POPUP_WIDTH: 'popupWidth',
  POPUP_HEIGHT: 'popupHeight',
  AUTO_RESIZE: 'autoResizePopup',
  SHOW_SYNC_STATUS: 'showSyncStatus',
  THEME: 'theme',
  LAST_SEARCH: 'lastSearch',
  EXPANDED_FOLDERS: 'expandedFolders'
};

export const CSS_CLASSES = {
  CONTAINER: 'container',
  TREE: 'tree',
  SEARCH: 'search',
  SEARCH_INPUT: 'search-input',
  RESULTS: 'results',
  BOOKMARK: 'bookmark',
  FOLDER: 'folder',
  OPEN: 'open',
  COLLAPSED: 'collapsed',
  SELECTED: 'selected',
  HIDDEN: 'hidden',
  VISIBLE: 'visible',
  LOADING: 'loading',
  ERROR: 'error',
  SUCCESS: 'success'
};

export const DOM_IDS = {
  CONTAINER: 'container',
  TREE: 'tree',
  SEARCH: 'search',
  SEARCH_INPUT: 'search-input',
  RESULTS: 'results',
  DONATION: 'donation',
  DROP_OVERLAY: 'drop-overlay',
  BOOKMARK_CLONE: 'bookmark-clone'
};

export const EVENTS = {
  // App events
  APP_READY: 'app:ready',
  APP_ERROR: 'app:error',

  // Bookmark events
  BOOKMARKS_LOADED: 'bookmarks:loaded',
  BOOKMARK_CREATED: 'bookmark:created',
  BOOKMARK_UPDATED: 'bookmark:updated',
  BOOKMARK_DELETED: 'bookmark:deleted',
  BOOKMARK_CLICKED: 'bookmark:clicked',
  BOOKMARK_CONTEXT_MENU: 'bookmark:contextmenu',

  // Folder events
  FOLDER_CREATED: 'folder:created',
  FOLDER_UPDATED: 'folder:updated',
  FOLDER_DELETED: 'folder:deleted',
  FOLDER_CLICKED: 'folder:clicked',
  FOLDER_CONTEXT_MENU: 'folder:contextmenu',
  FOLDER_TOGGLED: 'folder:toggled',

  // Search events
  SEARCH_STARTED: 'search:started',
  SEARCH_COMPLETED: 'search:completed',
  SEARCH_CLEARED: 'search:cleared',
  SEARCH_ERROR: 'search:error',

  // UI events
  TREE_RENDERED: 'ui:tree:rendered',
  SEARCH_RESULTS_RENDERED: 'ui:search:rendered',
  VIEW_CHANGED: 'ui:view:changed',
  ESCAPE_PRESSED: 'ui:escape:pressed'
};

export const KEYBOARD_SHORTCUTS = {
  SEARCH: { key: 'f', ctrl: true, meta: true },
  NEW_BOOKMARK: { key: 'n', ctrl: true, meta: true },
  NEW_FOLDER: { key: 'n', ctrl: true, meta: true, shift: true },
  ESCAPE: { key: 'Escape' }
};

export const PERFORMANCE_CONFIG = {
  DEBOUNCE_DELAY: 300,
  THROTTLE_DELAY: 100,
  CACHE_TTL: 60000, // 1 minute
  MAX_CACHE_SIZE: 1000,
  BATCH_SIZE: 50
};

export const API_CONFIG = {
  BOOKMARKS: {
    GET_TREE: 'bookmarks.getTree',
    GET_CHILDREN: 'bookmarks.getChildren',
    CREATE: 'bookmarks.create',
    UPDATE: 'bookmarks.update',
    MOVE: 'bookmarks.move',
    REMOVE: 'bookmarks.remove',
    REMOVE_TREE: 'bookmarks.removeTree',
    SEARCH: 'bookmarks.search'
  },
  TABS: {
    CREATE: 'tabs.create',
    UPDATE: 'tabs.update'
  },
  STORAGE: {
    LOCAL: 'storage.local',
    SYNC: 'storage.sync'
  }
};

export const ERROR_TYPES = {
  NETWORK: 'network_error',
  STORAGE: 'storage_error',
  PERMISSION: 'permission_error',
  VALIDATION: 'validation_error',
  NOT_FOUND: 'not_found_error',
  UNKNOWN: 'unknown_error'
};

export const THEME = {
  LIGHT: 'light',
  DARK: 'dark',
  AUTO: 'auto'
};