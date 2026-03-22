/**
 * vBookmarks Storage Utilities
 * Unified storage management using chrome.storage
 */

class StorageManager {
    constructor() {
        this.local = chrome.storage.local;
        this.sync = chrome.storage.sync;
    }

    /**
     * Get a setting value with fallback
     * @param {string} key - Setting key
     * @param {*} defaultValue - Default value if not found
     * @param {boolean} useSync - Whether to use sync storage (default: false for local)
     * @returns {Promise<*>} The setting value
     */
    async getSetting(key, defaultValue, useSync = false) {
        try {
            const storage = useSync ? this.sync : this.local;
            const result = await storage.get({ [key]: defaultValue });
            return result[key];
        } catch (error) {
            console.warn(`Failed to get setting ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Set a setting value
     * @param {string} key - Setting key
     * @param {*} value - Value to set
     * @param {boolean} useSync - Whether to use sync storage (default: false for local)
     * @returns {Promise<void>}
     */
    async setSetting(key, value, useSync = false) {
        try {
            const storage = useSync ? this.sync : this.local;
            await storage.set({ [key]: value });
        } catch (error) {
            console.warn(`Failed to set setting ${key}:`, error);
        }
    }

    /**
     * Get all settings
     * @param {boolean} useSync - Whether to use sync storage
     * @returns {Promise<Object>} All settings
     */
    async getAllSettings(useSync = false) {
        try {
            const storage = useSync ? this.sync : this.local;
            return await storage.get(null);
        } catch (error) {
            console.warn('Failed to get all settings:', error);
            return {};
        }
    }

    /**
     * Remove a setting
     * @param {string} key - Setting key
     * @param {boolean} useSync - Whether to use sync storage
     * @returns {Promise<void>}
     */
    async removeSetting(key, useSync = false) {
        try {
            const storage = useSync ? this.sync : this.local;
            await storage.remove(key);
        } catch (error) {
            console.warn(`Failed to remove setting ${key}:`, error);
        }
    }
}

// Global instance
const storageManager = new StorageManager();

// Convenience functions
async function getSetting(key, defaultValue, useSync = false) {
    return storageManager.getSetting(key, defaultValue, useSync);
}

async function setSetting(key, value, useSync = false) {
    return storageManager.setSetting(key, value, useSync);
}

/**
 * vBookmarks Storage Utilities
 * Unified storage management using chrome.storage
 */

class StorageManager {
    constructor() {
        this.local = chrome.storage.local;
        this.sync = chrome.storage.sync;
    }

    /**
     * Get a setting value with fallback
     * @param {string} key - Setting key
     * @param {*} defaultValue - Default value if not found
     * @param {boolean} useSync - Whether to use sync storage (default: false for local)
     * @returns {Promise<*>} The setting value
     */
    async getSetting(key, defaultValue, useSync = false) {
        try {
            const storage = useSync ? this.sync : this.local;
            const result = await storage.get({ [key]: defaultValue });
            return result[key];
        } catch (error) {
            console.warn(`Failed to get setting ${key}:`, error);
            return defaultValue;
        }
    }

    /**
     * Set a setting value
     * @param {string} key - Setting key
     * @param {*} value - Value to set
     * @param {boolean} useSync - Whether to use sync storage (default: false for local)
     * @returns {Promise<void>}
     */
    async setSetting(key, value, useSync = false) {
        try {
            const storage = useSync ? this.sync : this.local;
            await storage.set({ [key]: value });
        } catch (error) {
            console.warn(`Failed to set setting ${key}:`, error);
        }
    }

    /**
     * Get all settings
     * @param {boolean} useSync - Whether to use sync storage
     * @returns {Promise<Object>} All settings
     */
    async getAllSettings(useSync = false) {
        try {
            const storage = useSync ? this.sync : this.local;
            return await storage.get(null);
        } catch (error) {
            console.warn('Failed to get all settings:', error);
            return {};
        }
    }

    /**
     * Remove a setting
     * @param {string} key - Setting key
     * @param {*} value - Value to set
     * @param {boolean} useSync - Whether to use sync storage
     * @returns {Promise<void>}
     */
    async removeSetting(key, useSync = false) {
        try {
            const storage = useSync ? this.sync : this.local;
            await storage.remove(key);
        } catch (error) {
            console.warn(`Failed to remove setting ${key}:`, error);
        }
    }
}

// Global instance
window.storageManager = new StorageManager();

// Convenience functions
window.getSetting = async function(key, defaultValue, useSync = false) {
    return window.storageManager.getSetting(key, defaultValue, useSync);
};

window.setSetting = async function(key, value, useSync = false) {
    return window.storageManager.setSetting(key, value, useSync);
};