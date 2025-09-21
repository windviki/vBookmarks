/**
 * vBookmarks Performance Utils
 *
 * Performance monitoring and optimization utilities
 */

import { PERFORMANCE_CONFIG } from '../constants/index.js';
import { logger } from './logger.js';

export class PerformanceMonitor {
  constructor() {
    this.metrics = new Map();
    this.observers = new Set();
    this.thresholds = new Map();
    this.setupDefaultThresholds();
  }

  /**
   * Setup default performance thresholds
   */
  setupDefaultThresholds() {
    this.thresholds.set('render', 16); // 60fps
    this.thresholds.set('search', 100);
    this.thresholds.set('load', 500);
    this.thresholds.set('animation', 33);
  }

  /**
   * Measure performance of a function
   */
  async measure(name, fn) {
    const startTime = performance.now();
    let result;

    try {
      result = await fn();
      const duration = performance.now() - startTime;
      this.recordMetric(name, duration);
      return { result, duration };
    } catch (error) {
      const duration = performance.now() - startTime;
      this.recordMetric(name, duration, error);
      throw error;
    }
  }

  /**
   * Record performance metric
   */
  recordMetric(name, duration, error = null) {
    const metric = {
      name,
      duration,
      timestamp: Date.now(),
      error
    };

    // Store metric
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metrics = this.metrics.get(name);
    metrics.push(metric);

    // Keep only recent metrics (last 100)
    if (metrics.length > 100) {
      metrics.shift();
    }

    // Check threshold
    this.checkThreshold(name, duration);

    // Notify observers
    this.notifyObservers(metric);

    // Log if slow
    if (error) {
      logger.error(`Performance error in ${name}: ${duration}ms`, error);
    } else if (duration > this.getThreshold(name) * 2) {
      logger.warn(`Slow performance in ${name}: ${duration}ms`);
    }
  }

  /**
   * Get threshold for metric
   */
  getThreshold(name) {
    return this.thresholds.get(name) || 100;
  }

  /**
   * Check if metric exceeds threshold
   */
  checkThreshold(name, duration) {
    const threshold = this.getThreshold(name);
    if (duration > threshold) {
      logger.performance(`${name} exceeded threshold`, duration, { threshold });
    }
  }

  /**
   * Get performance statistics
   */
  getStats(name = null) {
    if (name) {
      const metrics = this.metrics.get(name) || [];
      return this.calculateStats(metrics, name);
    }

    const stats = {};
    for (const [metricName, metrics] of this.metrics.entries()) {
      stats[metricName] = this.calculateStats(metrics, metricName);
    }
    return stats;
  }

  /**
   * Calculate statistics for metrics
   */
  calculateStats(metrics, name) {
    if (metrics.length === 0) {
      return {
        name,
        count: 0,
        average: 0,
        min: 0,
        max: 0,
        p95: 0,
        p99: 0
      };
    }

    const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
    const sum = durations.reduce((a, b) => a + b, 0);
    const average = sum / durations.length;

    return {
      name,
      count: durations.length,
      average: Math.round(average * 100) / 100,
      min: Math.round(durations[0] * 100) / 100,
      max: Math.round(durations[durations.length - 1] * 100) / 100,
      p95: Math.round(durations[Math.floor(durations.length * 0.95)] * 100) / 100,
      p99: Math.round(durations[Math.floor(durations.length * 0.99)] * 100) / 100
    };
  }

  /**
   * Add performance observer
   */
  addObserver(callback) {
    this.observers.add(callback);
    return () => this.observers.delete(callback);
  }

  /**
   * Notify observers of new metric
   */
  notifyObservers(metric) {
    for (const callback of this.observers) {
      try {
        callback(metric);
      } catch (error) {
        logger.error('Error in performance observer', error);
      }
    }
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics.clear();
    logger.info('Performance metrics cleared');
  }

  /**
   * Export metrics as JSON
   */
  export() {
    const metrics = {};
    for (const [name, values] of this.metrics.entries()) {
      metrics[name] = values;
    }
    return JSON.stringify(metrics, null, 2);
  }
}

/**
 * Debounce function to limit execution frequency
 */
export function debounce(func, wait = PERFORMANCE_CONFIG.DEBOUNCE_DELAY) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func.apply(this, args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttle function to limit execution rate
 */
export function throttle(func, limit = PERFORMANCE_CONFIG.THROTTLE_DELAY) {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

/**
 * Request animation frame wrapper for smooth animations
 */
export function rafThrottle(func) {
  let lastArgs;
  let lastThis;
  let requestId;

  const wrapper = function(...args) {
    lastArgs = args;
    lastThis = this;

    if (!requestId) {
      requestId = requestAnimationFrame(() => {
        func.apply(lastThis, lastArgs);
        requestId = null;
      });
    }
  };

  wrapper.cancel = () => {
    if (requestId) {
      cancelAnimationFrame(requestId);
      requestId = null;
    }
  };

  return wrapper;
}

/**
 * Memoization utility for expensive functions
 */
export function memoize(func, keyGenerator = (...args) => JSON.stringify(args)) {
  const cache = new Map();

  return function(...args) {
    const key = keyGenerator(...args);

    if (cache.has(key)) {
      return cache.get(key);
    }

    const result = func.apply(this, args);
    cache.set(key, result);

    // Limit cache size
    if (cache.size > PERFORMANCE_CONFIG.MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    return result;
  };
}

/**
 * Batch operations for better performance
 */
export function batch(items, batchSize = PERFORMANCE_CONFIG.BATCH_SIZE, processor) {
  return new Promise(async (resolve, reject) => {
    const results = [];
    const batches = [];

    // Split into batches
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    // Process batches with small delay to avoid blocking
    for (let i = 0; i < batches.length; i++) {
      try {
        const batchResults = await processor(batches[i]);
        results.push(...batchResults);

        // Small delay between batches to prevent blocking
        if (i < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      } catch (error) {
        reject(error);
        return;
      }
    }

    resolve(results);
  });
}

/**
 * Lazy loading utility
 */
export function lazyLoad(factory) {
  let instance;
  let promise;

  return function() {
    if (instance) {
      return Promise.resolve(instance);
    }

    if (!promise) {
      promise = factory().then(result => {
        instance = result;
        return instance;
      });
    }

    return promise;
  };
}

/**
 * Performance-aware event listener
 */
export function addPerformanceListener(element, event, handler, options = {}) {
  const { throttle: throttleTime = 0, debounce: debounceTime = 0, passive = false } = options;

  let wrappedHandler = handler;

  if (throttleTime > 0) {
    wrappedHandler = throttle(wrappedHandler, throttleTime);
  }

  if (debounceTime > 0) {
    wrappedHandler = debounce(wrappedHandler, debounceTime);
  }

  const eventOptions = { passive, capture: options.capture };

  element.addEventListener(event, wrappedHandler, eventOptions);

  return () => {
    element.removeEventListener(event, wrappedHandler, eventOptions);
  };
}

/**
 * Memory usage monitoring
 */
export function monitorMemory() {
  if (!performance.memory) {
    return null;
  }

  return {
    used: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
    total: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024),
    limit: Math.round(performance.memory.jsHeapSizeLimit / 1024 / 1024),
    usage: Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100)
  };
}

/**
 * Idle callback utility for non-critical tasks
 */
export function runWhenIdle(callback, timeout = 1000) {
  if ('requestIdleCallback' in window) {
    return window.requestIdleCallback(callback, { timeout });
  } else {
    // Fallback for browsers without idle callback
    return setTimeout(callback, 16); // Next frame
  }
}

// Create and export singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Export utilities
export {
  debounce,
  throttle,
  rafThrottle,
  memoize,
  batch,
  lazyLoad,
  addPerformanceListener,
  monitorMemory,
  runWhenIdle
};