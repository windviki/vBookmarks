/**
 * vBookmarks Logger
 *
 * Centralized logging system with different log levels
 */

import { APP_CONFIG } from '../constants/index.js';

export class Logger {
  constructor() {
    this.enabled = APP_CONFIG.DEBUG;
    this.logs = [];
    this.maxLogs = 1000;
  }

  /**
   * Enable or disable logging
   */
  setEnabled(enabled) {
    this.enabled = enabled;
  }

  /**
   * Log info message
   */
  info(message, data = null) {
    this.log('INFO', message, data, '📋');
  }

  /**
   * Log success message
   */
  success(message, data = null) {
    this.log('SUCCESS', message, data, '✅');
  }

  /**
   * Log warning message
   */
  warn(message, data = null) {
    this.log('WARN', message, data, '⚠️');
  }

  /**
   * Log error message
   */
  error(message, error = null) {
    this.log('ERROR', message, error, '❌');
    if (error && error.stack) {
      this.log('ERROR', error.stack, null, '💥');
    }
  }

  /**
   * Log debug message
   */
  debug(message, data = null) {
    this.log('DEBUG', message, data, '🔍');
  }

  /**
   * Log performance message
   */
  performance(label, duration, data = null) {
    this.log('PERF', `${label}: ${duration}ms`, data, '⚡');
  }

  /**
   * Log with custom level and icon
   */
  log(level, message, data, icon = '') {
    if (!this.enabled && level !== 'ERROR') return;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
      icon
    };

    // Store log
    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Format and display
    const formattedMessage = this.formatMessage(logEntry);

    switch (level) {
      case 'ERROR':
        console.error(formattedMessage);
        break;
      case 'WARN':
        console.warn(formattedMessage);
        break;
      case 'DEBUG':
        if (this.enabled) {
          console.debug(formattedMessage);
        }
        break;
      default:
        console.log(formattedMessage);
    }
  }

  /**
   * Format log message
   */
  formatMessage(logEntry) {
    const { timestamp, level, message, data, icon } = logEntry;
    let formatted = `${icon} [${level}] ${timestamp}: ${message}`;

    if (data) {
      if (typeof data === 'object') {
        formatted += `\n  ${JSON.stringify(data, null, 2)}`;
      } else {
        formatted += ` | ${data}`;
      }
    }

    return formatted;
  }

  /**
   * Get all logs
   */
  getLogs() {
    return [...this.logs];
  }

  /**
   * Get logs filtered by level
   */
  getLogsByLevel(level) {
    return this.logs.filter(log => log.level === level);
  }

  /**
   * Clear all logs
   */
  clearLogs() {
    this.logs = [];
  }

  /**
   * Export logs as JSON
   */
  exportLogs() {
    return JSON.stringify(this.logs, null, 2);
  }

  /**
   * Create performance timer
   */
  time(label) {
    return {
      start: performance.now(),
      label,
      end: () => {
        const duration = performance.now() - this.start;
        this.performance(label, duration);
        return duration;
      }
    };
  }
}

// Create and export singleton instance
export const logger = new Logger();

// Export class for testing
export { Logger };