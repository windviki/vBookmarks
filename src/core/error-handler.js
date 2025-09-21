/**
 * vBookmarks Error Handler
 *
 * Centralized error handling and reporting
 */

import { ERROR_TYPES, EVENTS } from '../constants/index.js';
import { logger } from '../utils/logger.js';
import { eventSystem } from './event-system.js';

export class ErrorHandler {
  constructor() {
    this.errorCounts = new Map();
    this.errorHistory = [];
    this.maxHistory = 100;
    this.setupGlobalHandlers();
  }

  /**
   * Setup global error handlers
   */
  setupGlobalHandlers() {
    // Handle uncaught errors
    window.addEventListener('error', (event) => {
      this.handleError(event.error, {
        type: ERROR_TYPES.UNKNOWN,
        source: 'global',
        message: event.message,
        filename: event.filename,
        line: event.lineno,
        column: event.colno
      });
    });

    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      this.handleError(event.reason, {
        type: ERROR_TYPES.UNKNOWN,
        source: 'promise',
        message: event.reason?.message || 'Unhandled promise rejection'
      });
    });
  }

  /**
   * Handle error with context
   */
  async handleError(error, context = {}) {
    const errorInfo = this.formatError(error, context);

    // Track error counts
    this.trackError(errorInfo);

    // Log error
    logger.error(errorInfo.message, errorInfo);

    // Add to history
    this.addToHistory(errorInfo);

    // Emit error event
    await eventSystem.emit(EVENTS.APP_ERROR, errorInfo);

    // Show user-friendly message if needed
    if (errorInfo.showUserMessage) {
      this.showUserError(errorInfo);
    }

    return errorInfo;
  }

  /**
   * Format error information
   */
  formatError(error, context = {}) {
    const errorType = context.type || this.determineErrorType(error);
    const timestamp = Date.now();

    return {
      id: this.generateErrorId(),
      timestamp,
      type: errorType,
      source: context.source || 'application',
      message: this.getErrorMessage(error),
      stack: error?.stack,
      context,
      severity: this.getErrorSeverity(errorType),
      showUserMessage: this.shouldShowUserMessage(errorType),
      recoverable: this.isRecoverable(errorType)
    };
  }

  /**
   * Determine error type
   */
  determineErrorType(error) {
    if (!error) return ERROR_TYPES.UNKNOWN;

    if (error.name === 'NetworkError' || error.message?.includes('network')) {
      return ERROR_TYPES.NETWORK;
    }

    if (error.name === 'QuotaExceededError' || error.message?.includes('storage')) {
      return ERROR_TYPES.STORAGE;
    }

    if (error.message?.includes('permission') || error.message?.includes('access')) {
      return ERROR_TYPES.PERMISSION;
    }

    if (error.name === 'TypeError' || error.name === 'ReferenceError') {
      return ERROR_TYPES.VALIDATION;
    }

    if (error.message?.includes('not found') || error.message?.includes('404')) {
      return ERROR_TYPES.NOT_FOUND;
    }

    return ERROR_TYPES.UNKNOWN;
  }

  /**
   * Get user-friendly error message
   */
  getErrorMessage(error) {
    if (!error) return 'Unknown error occurred';

    if (typeof error === 'string') {
      return error;
    }

    return error.message || 'An unexpected error occurred';
  }

  /**
   * Get error severity
   */
  getErrorSeverity(type) {
    const severityMap = {
      [ERROR_TYPES.NETWORK]: 'medium',
      [ERROR_TYPES.STORAGE]: 'low',
      [ERROR_TYPES.PERMISSION]: 'high',
      [ERROR_TYPES.VALIDATION]: 'medium',
      [ERROR_TYPES.NOT_FOUND]: 'low',
      [ERROR_TYPES.UNKNOWN]: 'high'
    };

    return severityMap[type] || 'medium';
  }

  /**
   * Determine if error should be shown to user
   */
  shouldShowUserMessage(type) {
    const showForTypes = [
      ERROR_TYPES.NETWORK,
      ERROR_TYPES.PERMISSION,
      ERROR_TYPES.STORAGE
    ];

    return showForTypes.includes(type);
  }

  /**
   * Determine if error is recoverable
   */
  isRecoverable(type) {
    const recoverableTypes = [
      ERROR_TYPES.NETWORK,
      ERROR_TYPES.VALIDATION,
      ERROR_TYPES.NOT_FOUND
    ];

    return recoverableTypes.includes(type);
  }

  /**
   * Track error counts
   */
  trackError(errorInfo) {
    const key = `${errorInfo.type}:${errorInfo.source}`;
    const count = this.errorCounts.get(key) || 0;
    this.errorCounts.set(key, count + 1);

    // Log if error occurs frequently
    if (count >= 5) {
      logger.warn(`Error occurred frequently: ${key}`, { count: count + 1 });
    }
  }

  /**
   * Add error to history
   */
  addToHistory(errorInfo) {
    this.errorHistory.push(errorInfo);

    // Keep only recent errors
    if (this.errorHistory.length > this.maxHistory) {
      this.errorHistory.shift();
    }
  }

  /**
   * Show user-friendly error message
   */
  showUserError(errorInfo) {
    // Create toast notification or alert
    const message = this.getUserFriendlyMessage(errorInfo);

    // Dispatch custom event for UI to handle
    const event = new CustomEvent('vbookmarks-error', {
      detail: {
        message,
        severity: errorInfo.severity,
        recoverable: errorInfo.recoverable
      }
    });

    window.dispatchEvent(event);
  }

  /**
   * Get user-friendly message
   */
  getUserFriendlyMessage(errorInfo) {
    const messages = {
      [ERROR_TYPES.NETWORK]: 'Network connection error. Please check your internet connection.',
      [ERROR_TYPES.STORAGE]: 'Storage error. Some data may not be saved properly.',
      [ERROR_TYPES.PERMISSION]: 'Permission denied. Please check extension permissions.',
      [ERROR_TYPES.VALIDATION]: 'Invalid input. Please check your data and try again.',
      [ERROR_TYPES.NOT_FOUND]: 'Item not found.',
      [ERROR_TYPES.UNKNOWN]: 'An unexpected error occurred. Please try again.'
    };

    return messages[errorInfo.type] || messages[ERROR_TYPES.UNKNOWN];
  }

  /**
   * Get error statistics
   */
  getErrorStats() {
    const stats = {
      total: this.errorHistory.length,
      byType: {},
      bySource: {},
      recent: this.errorHistory.slice(-10)
    };

    // Count by type
    for (const error of this.errorHistory) {
      stats.byType[error.type] = (stats.byType[error.type] || 0) + 1;
      stats.bySource[error.source] = (stats.bySource[error.source] || 0) + 1;
    }

    return stats;
  }

  /**
   * Get error history
   */
  getErrorHistory(limit = 50) {
    return this.errorHistory.slice(-limit);
  }

  /**
   * Clear error history
   */
  clearErrorHistory() {
    this.errorHistory = [];
    this.errorCounts.clear();
    logger.info('Error history cleared');
  }

  /**
   * Generate unique error ID
   */
  generateErrorId() {
    return `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Create specific error types
   */
  static createError(type, message, context = {}) {
    const error = new Error(message);
    error.type = type;
    error.context = context;
    error.timestamp = Date.now();
    return error;
  }

  /**
   * Wrapper for async operations with error handling
   */
  static async wrapAsync(fn, context = {}) {
    try {
      return await fn();
    } catch (error) {
      await errorHandler.handleError(error, context);
      throw error; // Re-throw to allow caller to handle
    }
  }
}

// Create and export singleton instance
export const errorHandler = new ErrorHandler();

// Export class for testing
export { ErrorHandler };