/**
 * vBookmarks Search Manager
 *
 * Handles search functionality and query processing.
 */

class SearchManager {
    constructor() {
        this.listeners = new Map();
        this.currentQuery = '';
        this.searchResults = [];
    }

    /**
     * Initialize the search manager
     */
    async init() {
        console.log('🔍 Search manager initialized');
    }

    /**
     * Perform search query
     */
    async search(query) {
        this.currentQuery = query.trim();

        if (!this.currentQuery) {
            this.searchResults = [];
            this.notifyListeners('searchCleared', {});
            return [];
        }

        try {
            // Use chrome.bookmarks.search API
            const results = await new Promise((resolve, reject) => {
                chrome.bookmarks.search(this.currentQuery, (results) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(results);
                    }
                });
            });

            this.searchResults = results;
            this.notifyListeners('searchCompleted', { query: this.currentQuery, results });
            return results;
        } catch (error) {
            console.error('Search failed:', error);
            this.notifyListeners('searchError', { query: this.currentQuery, error });
            throw error;
        }
    }

    /**
     * Clear search results
     */
    clearSearch() {
        this.currentQuery = '';
        this.searchResults = [];
        this.notifyListeners('searchCleared', {});
    }

    /**
     * Get current search state
     */
    getSearchState() {
        return {
            query: this.currentQuery,
            results: this.searchResults,
            hasResults: this.searchResults.length > 0
        };
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
                    console.error(`Error in search manager event listener:`, error);
                }
            });
        }
    }
}

// Export for use in other modules
export { SearchManager };

// Also attach to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.SearchManager = SearchManager;
}