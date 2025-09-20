# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

vBookmarks is a Chrome extension that provides an enhanced bookmark manager with advanced features. It's a fork of Neat Bookmarks with additional functionality.

## Development Commands

This is a Chrome extension project with no traditional build system. Development involves:

- **Testing**: Load the extension in Chrome using `chrome://extensions/` in developer mode
- **Building**: Package as a .crx file using Chrome's built-in extension packager
- **Linting**: No automated linting setup - maintain code style consistency manually

## Code Architecture

### Core Components

1. **Background Script (`background.js`)**:
   - Handles omnibox search functionality
   - Manages extension lifecycle and background processes
   - Processes bookmark search queries from address bar

2. **Popup Interface (`popup.html`, `popup.js`, `neat.js`)**:
   - Main bookmark tree interface
   - Search functionality within the popup
   - Context menus and bookmark management
   - Keyboard navigation support

3. **Options Page (`options.html`, `options.js`)**:
   - User preferences and settings
   - Configuration for behavior and appearance

4. **Advanced Options (`advanced-options.html`, `advanced-options.js`)**:
   - Custom CSS styling
   - Separator customization
   - Advanced configuration options

### Key Files

- `neat.js`: Main application logic (113KB) - core bookmark tree rendering and interaction
- `neatools.js`: Utility library providing helper functions
- `codemirror.js`: Code editor for custom CSS input
- `manifest.json`: Extension configuration (Manifest V3)

### Data Flow

1. Extension loads and initializes bookmark tree in `neat.js`
2. User interactions trigger bookmark API calls through `chrome.bookmarks`
3. Settings stored in `localStorage` for persistence
4. Context menus provide extended bookmark management actions

### Key Features

- **Bookmark Tree Navigation**: Hierarchical bookmark display with expand/collapse
- **Search**: Both in-popup search and omnibox integration
- **Context Menus**: Right-click actions for bookmarks and folders
- **Keyboard Navigation**: Full keyboard support with arrow keys, Enter, Space
- **Drag & Drop**: Bookmark reorganization
- **Custom Styling**: User-configurable CSS for appearance
- **Separator Support**: Custom bookmark separators with synchronization

### Internationalization

- Localization files in `_locales/` directory
- Supported languages: en, fr, it, ja, ru, zh, zh_HK, zh_TW
- Messages accessed via `chrome.i18n.getMessage()`

### Chrome API Usage

- `chrome.bookmarks`: Core bookmark management
- `chrome.tabs`: Tab manipulation for opening bookmarks
- `chrome.omnibox`: Address bar search integration
- `chrome.storage`: Settings persistence (localStorage)
- `chrome.i18n`: Internationalization support

## Development Notes

- Minimum Chrome version: 88 (Manifest V3)
- Uses ES6+ JavaScript features
- Custom utility library (`neatools.js`) instead of external frameworks
- CodeMirror for CSS editing in advanced options
- Security considerations: Content Security Policy implemented in manifest

## Testing Approach

- Manual testing through Chrome extension loading
- Test various bookmark operations (add, edit, delete, move)
- Verify keyboard navigation and search functionality
- Check context menu actions across different bookmark types
- Test omnibox search integration