/**
 * vBookmarks DOM Utilities
 *
 * Common DOM manipulation utilities and helpers.
 */

class DOMUtils {
    /**
     * Create element with attributes and children
     */
    static createElement(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);

        // Set attributes
        Object.entries(attributes).forEach(([key, value]) => {
            if (key === 'className') {
                element.className = value;
            } else if (key === 'textContent') {
                element.textContent = value;
            } else if (key === 'innerHTML') {
                element.innerHTML = value;
            } else if (value !== null && value !== undefined) {
                element.setAttribute(key, value);
            }
        });

        // Add children
        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof HTMLElement) {
                element.appendChild(child);
            }
        });

        return element;
    }

    /**
     * Create element with class name shorthand
     */
    static createDiv(className = '', children = []) {
        return this.createElement('div', { className }, children);
    }

    /**
     * Create element with text content
     */
    static createTextElement(tag, text, className = '') {
        return this.createElement(tag, { className, textContent: text });
    }

    /**
     * Find element by selector with error handling
     */
    static find(selector, parent = document) {
        const element = parent.querySelector(selector);
        if (!element) {
            console.warn(`Element not found: ${selector}`);
        }
        return element;
    }

    /**
     * Find all elements by selector
     */
    static findAll(selector, parent = document) {
        return parent.querySelectorAll(selector);
    }

    /**
     * Add event listener with error handling
     */
    static addEventListener(element, event, handler, options = {}) {
        if (!element) {
            console.warn(`Cannot add event listener to null element for event: ${event}`);
            return;
        }

        element.addEventListener(event, handler, options);
        return () => element.removeEventListener(event, handler, options);
    }

    /**
     * Remove element safely
     */
    static removeElement(element) {
        if (element && element.parentNode) {
            element.parentNode.removeChild(element);
        }
    }

    /**
     * Clear element contents
     */
    static clearElement(element) {
        if (element) {
            while (element.firstChild) {
                element.removeChild(element.firstChild);
            }
        }
    }

    /**
     * Toggle class on element
     */
    static toggleClass(element, className, force) {
        if (!element) return;
        element.classList.toggle(className, force);
    }

    /**
     * Add class to element
     */
    static addClass(element, ...classNames) {
        if (!element) return;
        element.classList.add(...classNames);
    }

    /**
     * Remove class from element
     */
    static removeClass(element, ...classNames) {
        if (!element) return;
        element.classList.remove(...classNames);
    }

    /**
     * Check if element has class
     */
    static hasClass(element, className) {
        return element && element.classList.contains(className);
    }

    /**
     * Set element style
     */
    static setStyle(element, styles) {
        if (!element) return;
        Object.entries(styles).forEach(([property, value]) => {
            element.style[property] = value;
        });
    }

    /**
     * Get element style
     */
    static getStyle(element, property) {
        return element ? getComputedStyle(element)[property] : undefined;
    }

    /**
     * Show element
     */
    static show(element, display = 'block') {
        if (element) {
            element.style.display = display;
        }
    }

    /**
     * Hide element
     */
    static hide(element) {
        if (element) {
            element.style.display = 'none';
        }
    }

    /**
     * Toggle element visibility
     */
    static toggleVisibility(element, show) {
        if (show === undefined) {
            const isVisible = this.getStyle(element, 'display') !== 'none';
            this.toggleVisibility(element, !isVisible);
        } else {
            this[show ? 'show' : 'hide'](element);
        }
    }

    /**
     * Check if element is visible
     */
    static isVisible(element) {
        return element && this.getStyle(element, 'display') !== 'none';
    }

    /**
     * Set element text content safely
     */
    static setText(element, text) {
        if (element) {
            element.textContent = text || '';
        }
    }

    /**
     * Get element text content
     */
    static getText(element) {
        return element ? element.textContent : '';
    }

    /**
     * Set element HTML content safely
     */
    static setHTML(element, html) {
        if (element) {
            element.innerHTML = html || '';
        }
    }

    /**
     * Get element HTML content
     */
    static getHTML(element) {
        return element ? element.innerHTML : '';
    }

    /**
     * Create document fragment
     */
    static createFragment() {
        return document.createDocumentFragment();
    }

    /**
     * Insert element at position
     */
    static insertAt(parent, element, index) {
        if (!parent || !element) return;

        if (index >= parent.children.length) {
            parent.appendChild(element);
        } else {
            parent.insertBefore(element, parent.children[index]);
        }
    }

    /**
     * Wrap element with wrapper
     */
    static wrapElement(element, wrapper) {
        if (!element || !wrapper) return;

        element.parentNode.insertBefore(wrapper, element);
        wrapper.appendChild(element);
    }

    /**
     * Unwrap element
     */
    static unwrapElement(element) {
        if (!element || !element.parentNode) return;

        const parent = element.parentNode;
        while (element.firstChild) {
            parent.insertBefore(element.firstChild, element);
        }
        parent.removeChild(element);
    }

    /**
     * Get element position relative to viewport
     */
    static getBoundingClientRect(element) {
        return element ? element.getBoundingClientRect() : null;
    }

    /**
     * Check if element is in viewport
     */
    static isInViewport(element) {
        if (!element) return false;

        const rect = this.getBoundingClientRect(element);
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    /**
     * Scroll element into view
     */
    static scrollToElement(element, options = {}) {
        if (element) {
            element.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                ...options
            });
        }
    }

    /**
     * Get element data attribute
     */
    static getData(element, key) {
        return element ? element.dataset[key] : undefined;
    }

    /**
     * Set element data attribute
     */
    static setData(element, key, value) {
        if (element) {
            element.dataset[key] = value;
        }
    }

    /**
     * Get parent element matching selector
     */
    static getParent(element, selector) {
        if (!element) return null;

        let parent = element.parentElement;
        while (parent) {
            if (parent.matches(selector)) {
                return parent;
            }
            parent = parent.parentElement;
        }
        return null;
    }

    /**
     * Get closest element matching selector
     */
    static getClosest(element, selector) {
        return element ? element.closest(selector) : null;
    }

    /**
     * Check if element matches selector
     */
    static matches(element, selector) {
        return element ? element.matches(selector) : false;
    }

    /**
     * Debounce function for DOM events
     */
    static debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Convenience alias for find() - jQuery-style selector
     */
    static $(selector, parent = document) {
        return this.find(selector, parent);
    }

    /**
     * Convenience alias for findAll() - jQuery-style selector
     */
    static $$(selector, parent = document) {
        return this.findAll(selector, parent);
    }

    /**
     * Convenience alias for addEventListener() - shorter syntax
     */
    static on(element, event, handler, options = {}) {
        return this.addEventListener(element, event, handler, options);
    }

    /**
     * Throttle function for DOM events
     */
    static throttle(func, limit) {
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
     * Load image with promise
     */
    static loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        });
    }

    /**
     * Get element center coordinates
     */
    static getElementCenter(element) {
        if (!element) return { x: 0, y: 0 };

        const rect = this.getBoundingClientRect(element);
        return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    }
}

// Export for use in other modules
export { DOMUtils };

// Also attach to window for legacy compatibility
if (typeof window !== 'undefined') {
    window.DOMUtils = DOMUtils;
    console.log('🛠️ DOMUtils attached to window object');
} else {
    console.warn('⚠️ window object not available, DOMUtils not attached globally');
}

// Fallback: try to attach to window even if it's not immediately available
setTimeout(() => {
    if (typeof window !== 'undefined' && !window.DOMUtils) {
        window.DOMUtils = DOMUtils;
        console.log('🛠️ DOMUtils attached to window object (delayed)');
    }
}, 100);