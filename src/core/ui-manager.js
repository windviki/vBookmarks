/**
 * vBookmarks UI Manager
 *
 * Handles UI rendering, updates, and DOM manipulation.
 */

class UIManager {
    constructor() {
        this.treeElement = document.getElementById('tree');
        this.resultsElement = document.getElementById('results');
        this.searchElement = document.getElementById('search');
        this.containerElement = document.getElementById('container');
        this.currentView = 'tree'; // 'tree' or 'results'
        this.listeners = new Map();
        this.domCache = new Map();
    }

    /**
     * Initialize the UI manager
     */
    init() {
        this.setupEventListeners();
        this.setupKeyboardNavigation();
    }

    /**
     * Render the bookmark tree
     */
    renderBookmarkTree(bookmarks, container = this.treeElement) {
        container.innerHTML = '';

        if (!bookmarks || !bookmarks.length) {
            container.innerHTML = '<div class="no-bookmarks">No bookmarks found</div>';
            return;
        }

        const ul = document.createElement('ul');
        bookmarks.forEach(bookmark => {
            const li = this.createBookmarkElement(bookmark);
            ul.appendChild(li);
        });

        container.appendChild(ul);
        this.notifyListeners('treeRendered', { container, bookmarks });
    }

    /**
     * Create a single bookmark element
     */
    createBookmarkElement(bookmark, level = 0) {
        const li = document.createElement('li');
        li.id = `neat-tree-item-${bookmark.id}`;
        li.className = bookmark.url ? 'bookmark' : 'folder';

        if (bookmark.children) {
            li.classList.add('has-children');
        }

        const element = bookmark.url
            ? this.createBookmarkLink(bookmark)
            : this.createFolderSpan(bookmark);

        li.appendChild(element);

        if (bookmark.children && bookmark.children.length > 0) {
            const childUl = document.createElement('ul');
            childUl.className = 'children';
            childUl.style.display = 'none';

            bookmark.children.forEach(child => {
                const childLi = this.createBookmarkElement(child, level + 1);
                childUl.appendChild(childLi);
            });

            li.appendChild(childUl);
        }

        return li;
    }

    /**
     * Create bookmark link element
     */
    createBookmarkLink(bookmark) {
        const a = document.createElement('a');
        a.className = 'tree-item-link';
        a.href = bookmark.url;
        a.id = `neat-tree-item-${bookmark.id}`;

        // Create favicon container
        const faviconContainer = this.createFaviconContainer(bookmark);
        a.appendChild(faviconContainer);

        // Create title element
        const titleSpan = document.createElement('i');
        titleSpan.textContent = bookmark.title || '(no title)';
        titleSpan.className = 'bookmark-title';
        a.appendChild(titleSpan);

        // Add event listeners
        a.addEventListener('click', (e) => {
            e.preventDefault();
            this.notifyListeners('bookmarkClicked', bookmark);
        });

        a.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.notifyListeners('bookmarkContextMenu', { bookmark, event: e });
        });

        return a;
    }

    /**
     * Create folder span element
     */
    createFolderSpan(folder) {
        const span = document.createElement('span');
        span.className = 'tree-item-span';
        span.id = `neat-tree-item-${folder.id}`;

        // Create twisty for folder
        const twisty = document.createElement('span');
        twisty.className = 'twisty';
        span.appendChild(twisty);

        // Create favicon container
        const faviconContainer = this.createFaviconContainer(folder);
        span.appendChild(faviconContainer);

        // Create title element
        const titleSpan = document.createElement('i');
        titleSpan.textContent = folder.title || '(no title)';
        titleSpan.className = 'folder-title';
        span.appendChild(titleSpan);

        // Add event listeners
        span.addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleFolder(folder);
            this.notifyListeners('folderClicked', folder);
        });

        span.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.notifyListeners('folderContextMenu', { folder, event: e });
        });

        return span;
    }

    /**
     * Create favicon container with proper structure
     */
    createFaviconContainer(bookmark) {
        const container = document.createElement('span');
        container.className = 'favicon-container';

        const img = document.createElement('img');
        img.src = this.getFaviconUrl(bookmark);
        img.alt = '';
        img.width = 16;
        img.height = 16;
        img.className = 'favicon';

        container.appendChild(img);
        return container;
    }

    /**
     * Get favicon URL for bookmark
     */
    getFaviconUrl(bookmark) {
        if (bookmark.url) {
            // Use Google Favicon service instead of chrome://favicon
            try {
                if (bookmark.url.startsWith('chrome://')) {
                    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0iI0Y0RjRGNCIvPgo8cGF0aCBkPSJNOCAxMkM5LjEwNDU3IDEyIDEwIDExLjEwNDU3IDEwIDEwQzEwIDguODk1NDMgOS4xMDQ1NyA4IDggOEM2Ljg5NTQzIDggNiA4Ljg5NTQzIDYgMTBDNiAxMS4xMDQ1NyA2Ljg5NTQzIDEyIDggMTJaIiBmaWxsPSIjOTk5Ii8+Cjwvc3ZnPgo=';
                }
                const domain = new URL(bookmark.url).hostname;
                return `https://www.google.com/s2/favicons?domain=${domain}&sz=16`;
            } catch (error) {
                return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiByeD0iMiIgZmlsbD0iI0Y0RjRGNCIvPgo8cGF0aCBkPSJNOCAxMkM5LjEwNDU3IDEyIDEwIDExLjEwNDU3IDEwIDEwQzEwIDguODk1NDMgOS4xMDQ1NyA4IDggOEM2Ljg5NTQzIDggNiA4Ljg5NTQzIDYgMTBDNiAxMS4xMDQ1NyA2Ljg5NTQzIDEyIDggMTJaIiBmaWxsPSIjOTk5Ii8+Cjwvc3ZnPgo=';
            }
        }
        return 'folder.png';
    }

    /**
     * Toggle folder open/closed state
     */
    toggleFolder(folder) {
        const folderElement = document.getElementById(`neat-tree-item-${folder.id}`);
        if (!folderElement) return;

        const childrenUl = folderElement.querySelector('.children');
        if (!childrenUl) return;

        const isOpen = folderElement.classList.contains('open');

        if (isOpen) {
            folderElement.classList.remove('open');
            childrenUl.style.display = 'none';
        } else {
            folderElement.classList.add('open');
            childrenUl.style.display = 'block';
        }

        this.notifyListeners('folderToggled', { folder, isOpen: !isOpen });
    }

    /**
     * Render search results
     */
    renderSearchResults(results, container = this.resultsElement) {
        container.innerHTML = '';
        container.style.display = 'block';
        this.treeElement.style.display = 'none';
        this.currentView = 'results';

        if (!results || results.length === 0) {
            container.innerHTML = '<div class="no-results">No bookmarks found</div>';
            return;
        }

        const ul = document.createElement('ul');
        results.forEach(bookmark => {
            const li = this.createSearchResultElement(bookmark);
            ul.appendChild(li);
        });

        container.appendChild(ul);
        this.notifyListeners('searchResultsRendered', { container, results });
    }

    /**
     * Create search result element
     */
    createSearchResultElement(bookmark) {
        const li = document.createElement('li');
        li.id = `results-item-${bookmark.id}`;

        const a = document.createElement('a');
        a.className = 'tree-item-link';
        a.href = bookmark.url;

        // Create favicon container
        const faviconContainer = this.createFaviconContainer(bookmark);
        a.appendChild(faviconContainer);

        // Create title with parent folder info
        const titleSpan = document.createElement('i');
        const path = this.getBookmarkPathText(bookmark);
        titleSpan.textContent = bookmark.title || '(no title)';
        titleSpan.title = path;
        a.appendChild(titleSpan);

        // Add event listeners
        a.addEventListener('click', (e) => {
            e.preventDefault();
            this.notifyListeners('bookmarkClicked', bookmark);
        });

        a.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.notifyListeners('bookmarkContextMenu', { bookmark, event: e });
        });

        li.appendChild(a);
        return li;
    }

    /**
     * Get bookmark path text for display
     */
    getBookmarkPathText(bookmark) {
        // This would need to be implemented with access to the bookmark manager
        // For now, return just the title
        return bookmark.title || '(no title)';
    }

    /**
     * Show tree view, hide results
     */
    showTreeView() {
        this.resultsElement.style.display = 'none';
        this.treeElement.style.display = 'block';
        this.currentView = 'tree';
        this.notifyListeners('viewChanged', { view: 'tree' });
    }

    /**
     * Show search results, hide tree
     */
    showSearchResults() {
        this.treeElement.style.display = 'none';
        this.resultsElement.style.display = 'block';
        this.currentView = 'results';
        this.notifyListeners('viewChanged', { view: 'results' });
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Add any global UI event listeners here
    }

    /**
     * Setup keyboard navigation
     */
    setupKeyboardNavigation() {
        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });
    }

    /**
     * Handle keyboard navigation
     */
    handleKeyDown(event) {
        // Handle arrow keys, Enter, Escape, etc.
        switch (event.key) {
            case 'Escape':
                if (this.currentView === 'results') {
                    this.showTreeView();
                    this.notifyListeners('escapePressed', {});
                }
                break;
            case 'ArrowDown':
            case 'ArrowUp':
            case 'ArrowLeft':
            case 'ArrowRight':
                // Handle navigation
                break;
        }
    }

    /**
     * DOM caching for performance
     */
    cacheElement(key, element) {
        this.domCache.set(key, element);
    }

    getCachedElement(key) {
        return this.domCache.get(key);
    }

    clearCache() {
        this.domCache.clear();
    }

    /**
     * Event listener management
     */
    addEventListener(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(callback);
    }

    removeEventListener(event, callback) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(callback);
        }
    }

    notifyListeners(event, data) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in UI manager event listener:`, error);
                }
            });
        }
    }
}

// Export for use in other modules
export { UIManager };

// Also attach to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.UIManager = UIManager;
}