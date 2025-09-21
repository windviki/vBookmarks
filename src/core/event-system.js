/**
 * vBookmarks Event System
 *
 * Centralized event management with wildcard support
 */

import { EVENTS } from '../constants/index.js';
import { logger } from '../utils/logger.js';

export class EventSystem {
  constructor() {
    this.listeners = new Map();
    this.onceListeners = new Map();
    this.wildcardListeners = new Set();
    this.eventHistory = [];
    this.maxHistory = 100;
  }

  /**
   * Add event listener
   */
  on(event, callback, options = {}) {
    const { priority = 0, context = null } = options;

    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }

    const listener = {
      callback: context ? callback.bind(context) : callback,
      priority,
      id: this.generateListenerId()
    };

    this.listeners.get(event).push(listener);

    // Sort listeners by priority (higher priority first)
    this.listeners.get(event).sort((a, b) => b.priority - a.priority);

    logger.debug(`Event listener added: ${event}`, { priority, id: listener.id });

    // Return unsubscribe function
    return () => this.off(event, listener.id);
  }

  /**
   * Add one-time event listener
   */
  once(event, callback, options = {}) {
    const { priority = 0, context = null } = options;

    if (!this.onceListeners.has(event)) {
      this.onceListeners.set(event, []);
    }

    const listener = {
      callback: context ? callback.bind(context) : callback,
      priority,
      id: this.generateListenerId()
    };

    this.onceListeners.get(event).push(listener);

    // Sort listeners by priority
    this.onceListeners.get(event).sort((a, b) => b.priority - a.priority);

    logger.debug(`Once listener added: ${event}`, { priority, id: listener.id });

    // Return unsubscribe function
    return () => this.offOnce(event, listener.id);
  }

  /**
   * Add wildcard event listener
   */
  onAny(callback, options = {}) {
    const { priority = 0, context = null } = options;

    const listener = {
      callback: context ? callback.bind(context) : callback,
      priority,
      id: this.generateListenerId()
    };

    this.wildcardListeners.add(listener);

    logger.debug('Wildcard listener added', { priority, id: listener.id });

    // Return unsubscribe function
    return () => this.offAny(listener.id);
  }

  /**
   * Remove event listener
   */
  off(event, listenerId) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) {
      const index = eventListeners.findIndex(l => l.id === listenerId);
      if (index !== -1) {
        eventListeners.splice(index, 1);
        logger.debug(`Event listener removed: ${event}`, { id: listenerId });
      }
    }
  }

  /**
   * Remove once listener
   */
  offOnce(event, listenerId) {
    const onceListeners = this.onceListeners.get(event);
    if (onceListeners) {
      const index = onceListeners.findIndex(l => l.id === listenerId);
      if (index !== -1) {
        onceListeners.splice(index, 1);
        logger.debug(`Once listener removed: ${event}`, { id: listenerId });
      }
    }
  }

  /**
   * Remove wildcard listener
   */
  offAny(listenerId) {
    for (const listener of this.wildcardListeners) {
      if (listener.id === listenerId) {
        this.wildcardListeners.delete(listener);
        logger.debug('Wildcard listener removed', { id: listenerId });
        break;
      }
    }
  }

  /**
   * Emit event
   */
  async emit(event, data = null) {
    const startTime = performance.now();
    let listenerCount = 0;

    // Add to history
    this.addToHistory(event, data);

    logger.debug(`Emitting event: ${event}`, data);

    try {
      // Execute regular listeners
      const eventListeners = this.listeners.get(event) || [];
      for (const listener of eventListeners) {
        await this.executeListener(listener.callback, event, data);
        listenerCount++;
      }

      // Execute once listeners
      const onceListeners = this.onceListeners.get(event) || [];
      for (const listener of onceListeners) {
        await this.executeListener(listener.callback, event, data);
        listenerCount++;
      }

      // Remove once listeners after execution
      this.onceListeners.delete(event);

      // Execute wildcard listeners
      for (const listener of this.wildcardListeners) {
        await this.executeListener(listener.callback, event, data);
        listenerCount++;
      }

      const duration = performance.now() - startTime;
      logger.performance(`Event emitted: ${event}`, duration, { listeners: listenerCount });

      return true;
    } catch (error) {
      logger.error(`Error emitting event: ${event}`, error);
      return false;
    }
  }

  /**
   * Execute listener with error handling
   */
  async executeListener(callback, event, data) {
    try {
      if (typeof callback === 'function') {
        await callback(data, event);
      }
    } catch (error) {
      logger.error(`Error in event listener for: ${event}`, error);
      // Emit error event
      this.emit(EVENTS.APP_ERROR, {
        type: 'listener_error',
        event,
        error: error.message
      });
    }
  }

  /**
   * Add event to history
   */
  addToHistory(event, data) {
    this.eventHistory.push({
      event,
      data,
      timestamp: Date.now()
    });

    // Keep only recent events
    if (this.eventHistory.length > this.maxHistory) {
      this.eventHistory.shift();
    }
  }

  /**
   * Get event history
   */
  getEventHistory(limit = 50) {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Clear event history
   */
  clearEventHistory() {
    this.eventHistory = [];
  }

  /**
   * Get listener count for event
   */
  getListenerCount(event) {
    let count = 0;
    if (this.listeners.has(event)) {
      count += this.listeners.get(event).length;
    }
    if (this.onceListeners.has(event)) {
      count += this.onceListeners.get(event).length;
    }
    count += this.wildcardListeners.size;
    return count;
  }

  /**
   * Get all events with listeners
   */
  getAllEvents() {
    const events = new Set();

    for (const event of this.listeners.keys()) {
      events.add(event);
    }

    for (const event of this.onceListeners.keys()) {
      events.add(event);
    }

    return Array.from(events);
  }

  /**
   * Remove all listeners for event
   */
  removeAllListeners(event) {
    this.listeners.delete(event);
    this.onceListeners.delete(event);
    logger.debug(`All listeners removed for event: ${event}`);
  }

  /**
   * Remove all listeners
   */
  destroy() {
    this.listeners.clear();
    this.onceListeners.clear();
    this.wildcardListeners.clear();
    this.clearEventHistory();
    logger.info('Event system destroyed');
  }

  /**
   * Generate unique listener ID
   */
  generateListenerId() {
    return `listener_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Create and export singleton instance
export const eventSystem = new EventSystem();

// Export class for testing
export { EventSystem };