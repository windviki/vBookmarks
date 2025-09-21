/**
 * vBookmarks Storage Utility
 *
 * Centralized storage management with caching
 */

import { STORAGE_KEYS, PERFORMANCE_CONFIG } from '../constants/index.js';
import { logger } from './logger.js';

export class StorageManager {
  constructor() {
    this.cache = new Map();
    this.cacheExpiry = new Map();
    this.isAvailable = this.checkStorageAvailability();
  }

  /**
   * Check if localStorage is available
   */
  checkStorageAvailability() {
    try {
      const testKey = '__storage_test__';
      localStorage.setItem(testKey, 'test');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      logger.error('localStorage not available', e);
      return false;
    }
  }

  /**
   * Get item from storage with caching
   */
  async get(key, defaultValue = null) {
    if (!this.isAvailable) {
      logger.warn('Storage not available, returning default value');
      return defaultValue;
    }

    // Check cache first
    if (this.isCacheValid(key)) {
      logger.debug(`Cache hit for key: ${key}`);
      return this.cache.get(key);
    }

    try {
      const value = localStorage.getItem(key);
      let parsedValue = defaultValue;

      if (value !== null) {
        try {
          parsedValue = JSON.parse(value);
        } catch (e) {
          // If JSON parsing fails, return raw value
          parsedValue = value;
        }
      }

      // Cache the result
      this.setCache(key, parsedValue);
      logger.debug(`Retrieved from storage: ${key}`);

      return parsedValue;
    } catch (error) {
      logger.error(`Failed to get item from storage: ${key}`, error);
      return defaultValue;
    }
  }

  /**
   * Set item in storage with caching
   */
  async set(key, value) {
    if (!this.isAvailable) {
      logger.warn('Storage not available, skipping set operation');
      return false;
    }

    try {
      const serializedValue = JSON.stringify(value);
      localStorage.setItem(key, serializedValue);

      // Update cache
      this.setCache(key, value);
      logger.debug(`Stored item: ${key}`);

      return true;
    } catch (error) {
      logger.error(`Failed to set item in storage: ${key}`, error);
      return false;
    }
  }

  /**
   * Remove item from storage and cache
   */
  async remove(key) {
    if (!this.isAvailable) {
      return true;
    }

    try {
      localStorage.removeItem(key);
      this.cache.delete(key);
      this.cacheExpiry.delete(key);
      logger.debug(`Removed item: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Failed to remove item from storage: ${key}`, error);
      return false;
    }
  }

  /**
   * Clear all items from storage and cache
   */
  async clear() {
    if (!this.isAvailable) {
      return true;
    }

    try {
      localStorage.clear();
      this.cache.clear();
      this.cacheExpiry.clear();
      logger.info('Storage cleared');
      return true;
    } catch (error) {
      logger.error('Failed to clear storage', error);
      return false;
    }
  }

  /**
   * Get all keys in storage
   */
  async keys() {
    if (!this.isAvailable) {
      return [];
    }

    try {
      const keys = Object.keys(localStorage);
      logger.debug(`Retrieved ${keys.length} keys from storage`);
      return keys;
    } catch (error) {
      logger.error('Failed to get storage keys', error);
      return [];
    }
  }

  /**
   * Check if key exists in storage
   */
  async has(key) {
    if (!this.isAvailable) {
      return false;
    }

    try {
      return localStorage.getItem(key) !== null;
    } catch (error) {
      logger.error(`Failed to check if key exists: ${key}`, error);
      return false;
    }
  }

  /**
   * Set cache with expiry
   */
  setCache(key, value) {
    this.cache.set(key, value);
    this.cacheExpiry.set(key, Date.now() + PERFORMANCE_CONFIG.CACHE_TTL);

    // Clean up old cache entries if cache is full
    if (this.cache.size > PERFORMANCE_CONFIG.MAX_CACHE_SIZE) {
      this.cleanupCache();
    }
  }

  /**
   * Check if cache is valid
   */
  isCacheValid(key) {
    const expiry = this.cacheExpiry.get(key);
    return expiry && Date.now() < expiry;
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    const expiredKeys = [];

    for (const [key, expiry] of this.cacheExpiry.entries()) {
      if (now >= expiry) {
        expiredKeys.push(key);
      }
    }

    expiredKeys.forEach(key => {
      this.cache.delete(key);
      this.cacheExpiry.delete(key);
    });

    if (expiredKeys.length > 0) {
      logger.debug(`Cleaned up ${expiredKeys.length} expired cache entries`);
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: PERFORMANCE_CONFIG.MAX_CACHE_SIZE,
      hitRate: this.calculateHitRate()
    };
  }

  /**
   * Calculate cache hit rate (placeholder for actual tracking)
   */
  calculateHitRate() {
    // This would need actual hit/miss tracking
    return 0;
  }

  /**
   * Convenience methods for common storage operations
   */
  async getPopupSize() {
    const width = await this.get(STORAGE_KEYS.POPUP_WIDTH, 400);
    const height = await this.get(STORAGE_KEYS.POPUP_HEIGHT, 600);
    return { width, height };
  }

  async setPopupSize(width, height) {
    await this.set(STORAGE_KEYS.POPUP_WIDTH, width);
    await this.set(STORAGE_KEYS.POPUP_HEIGHT, height);
  }

  async getAutoResize() {
    return await this.get(STORAGE_KEYS.AUTO_RESIZE, true);
  }

  async setAutoResize(enabled) {
    return await this.set(STORAGE_KEYS.AUTO_RESIZE, enabled);
  }

  async getTheme() {
    return await this.get(STORAGE_KEYS.THEME, 'auto');
  }

  async setTheme(theme) {
    return await this.set(STORAGE_KEYS.THEME, theme);
  }
}

// Create and export singleton instance
export const storage = new StorageManager();

// Export class for testing
export { StorageManager };