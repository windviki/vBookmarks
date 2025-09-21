/**
 * vBookmarks Configuration Manager
 *
 * Centralized configuration management with validation
 */

import { STORAGE_KEYS, THEME } from '../constants/index.js';
import { logger } from '../utils/logger.js';
import { storage } from '../utils/storage.js';
import { eventSystem } from './event-system.js';

export class ConfigManager {
  constructor() {
    this.config = new Map();
    this.schema = new Map();
    this.observers = new Map();
    this.initialized = false;
  }

  /**
   * Initialize configuration manager
   */
  async init() {
    if (this.initialized) {
      logger.warn('ConfigManager already initialized');
      return;
    }

    logger.info('Initializing ConfigManager...');

    // Define configuration schema
    this.defineSchema();

    // Load configuration from storage
    await this.loadConfig();

    // Set defaults for missing values
    this.setDefaults();

    this.initialized = true;
    logger.info('ConfigManager initialized successfully');

    // Notify that config is ready
    await eventSystem.emit('config:ready', this.getAll());
  }

  /**
   * Define configuration schema with validation
   */
  defineSchema() {
    this.schema.set('theme', {
      type: 'string',
      enum: Object.values(THEME),
      default: THEME.AUTO,
      validator: (value) => Object.values(THEME).includes(value)
    });

    this.schema.set('popupWidth', {
      type: 'number',
      min: 200,
      max: 800,
      default: 400,
      validator: (value) => value >= 200 && value <= 800
    });

    this.schema.set('popupHeight', {
      type: 'number',
      min: 300,
      max: 1000,
      default: 600,
      validator: (value) => value >= 300 && value <= 1000
    });

    this.schema.set('autoResize', {
      type: 'boolean',
      default: true,
      validator: (value) => typeof value === 'boolean'
    });

    this.schema.set('showSyncStatus', {
      type: 'boolean',
      default: true,
      validator: (value) => typeof value === 'boolean'
    });

    this.schema.set('showDonationBanner', {
      type: 'boolean',
      default: true,
      validator: (value) => typeof value === 'boolean'
    });

    this.schema.set('enableAnimations', {
      type: 'boolean',
      default: true,
      validator: (value) => typeof value === 'boolean'
    });

    this.schema.set('searchDebounceDelay', {
      type: 'number',
      min: 100,
      max: 1000,
      default: 300,
      validator: (value) => value >= 100 && value <= 1000
    });

    this.schema.set('maxSearchResults', {
      type: 'number',
      min: 10,
      max: 200,
      default: 50,
      validator: (value) => value >= 10 && value <= 200
    });

    this.schema.set('enableKeyboardShortcuts', {
      type: 'boolean',
      default: true,
      validator: (value) => typeof value === 'boolean'
    });

    this.schema.set('enableDragAndDrop', {
      type: 'boolean',
      default: true,
      validator: (value) => typeof value === 'boolean'
    });

    this.schema.set('debugMode', {
      type: 'boolean',
      default: false,
      validator: (value) => typeof value === 'boolean'
    });
  }

  /**
   * Load configuration from storage
   */
  async loadConfig() {
    try {
      for (const [key, schema] of this.schema.entries()) {
        const storageKey = this.getStorageKey(key);
        const value = await storage.get(storageKey);

        if (value !== null && schema.validator(value)) {
          this.config.set(key, value);
          logger.debug(`Loaded config: ${key} = ${value}`);
        }
      }
    } catch (error) {
      logger.error('Failed to load configuration', error);
    }
  }

  /**
   * Set default values for missing configuration
   */
  setDefaults() {
    for (const [key, schema] of this.schema.entries()) {
      if (!this.config.has(key)) {
        this.config.set(key, schema.default);
        logger.debug(`Set default config: ${key} = ${schema.default}`);
      }
    }
  }

  /**
   * Get configuration value
   */
  get(key) {
    if (!this.initialized) {
      logger.warn('ConfigManager not initialized, returning default');
      const schema = this.schema.get(key);
      return schema?.default;
    }

    return this.config.get(key);
  }

  /**
   * Set configuration value
   */
  async set(key, value) {
    if (!this.initialized) {
      logger.warn('ConfigManager not initialized, cannot set value');
      return false;
    }

    const schema = this.schema.get(key);
    if (!schema) {
      logger.error(`Unknown configuration key: ${key}`);
      return false;
    }

    // Validate value
    if (!schema.validator(value)) {
      logger.error(`Invalid value for ${key}: ${value}`);
      return false;
    }

    // Check if value changed
    const oldValue = this.config.get(key);
    if (oldValue === value) {
      return true; // No change needed
    }

    // Update configuration
    this.config.set(key, value);

    // Save to storage
    try {
      const storageKey = this.getStorageKey(key);
      await storage.set(storageKey, value);
      logger.debug(`Saved config: ${key} = ${value}`);
    } catch (error) {
      logger.error(`Failed to save config: ${key}`, error);
      return false;
    }

    // Notify observers
    this.notifyObservers(key, value, oldValue);

    // Emit change event
    await eventSystem.emit('config:changed', {
      key,
      value,
      oldValue
    });

    return true;
  }

  /**
   * Get all configuration
   */
  getAll() {
    const config = {};
    for (const [key, value] of this.config.entries()) {
      config[key] = value;
    }
    return config;
  }

  /**
   * Reset configuration to defaults
   */
  async reset() {
    logger.info('Resetting configuration to defaults');

    for (const [key, schema] of this.schema.entries()) {
      await this.set(key, schema.default);
    }

    await eventSystem.emit('config:reset');
  }

  /**
   * Reset specific key to default
   */
  async resetKey(key) {
    const schema = this.schema.get(key);
    if (schema) {
      await this.set(key, schema.default);
      logger.info(`Reset config key to default: ${key}`);
    }
  }

  /**
   * Observe configuration changes
   */
  observe(key, callback) {
    if (!this.observers.has(key)) {
      this.observers.set(key, new Set());
    }
    this.observers.get(key).add(callback);

    // Return unsubscribe function
    return () => {
      const observers = this.observers.get(key);
      if (observers) {
        observers.delete(callback);
      }
    };
  }

  /**
   * Notify observers of configuration changes
   */
  notifyObservers(key, newValue, oldValue) {
    const observers = this.observers.get(key);
    if (observers) {
      for (const callback of observers) {
        try {
          callback(newValue, oldValue, key);
        } catch (error) {
          logger.error(`Error in config observer for ${key}`, error);
        }
      }
    }
  }

  /**
   * Get storage key for configuration
   */
  getStorageKey(key) {
    const keyMap = {
      theme: STORAGE_KEYS.THEME,
      popupWidth: STORAGE_KEYS.POPUP_WIDTH,
      popupHeight: STORAGE_KEYS.POPUP_HEIGHT,
      autoResize: STORAGE_KEYS.AUTO_RESIZE,
      showSyncStatus: STORAGE_KEYS.SHOW_SYNC_STATUS
    };

    return keyMap[key] || `config_${key}`;
  }

  /**
   * Validate all configuration values
   */
  validateAll() {
    const errors = [];

    for (const [key, value] of this.config.entries()) {
      const schema = this.schema.get(key);
      if (schema && !schema.validator(value)) {
        errors.push({
          key,
          value,
          error: `Invalid value for ${key}`
        });
      }
    }

    return errors;
  }

  /**
   * Export configuration
   */
  export() {
    return {
      version: '2.0.0',
      timestamp: Date.now(),
      config: this.getAll()
    };
  }

  /**
   * Import configuration
   */
  async import(data) {
    try {
      if (!data.config || typeof data.config !== 'object') {
        throw new Error('Invalid configuration data');
      }

      logger.info('Importing configuration...');

      for (const [key, value] of Object.entries(data.config)) {
        if (this.schema.has(key)) {
          await this.set(key, value);
        }
      }

      await eventSystem.emit('config:imported', data);
      logger.info('Configuration imported successfully');

      return true;
    } catch (error) {
      logger.error('Failed to import configuration', error);
      return false;
    }
  }

  /**
   * Destroy configuration manager
   */
  destroy() {
    this.config.clear();
    this.observers.clear();
    this.initialized = false;
    logger.info('ConfigManager destroyed');
  }
}

// Create and export singleton instance
export const configManager = new ConfigManager();

// Export class for testing
export { ConfigManager };