/**
 * vBookmarks Security Utils
 *
 * Security utilities and sanitization functions
 */

/**
 * HTML Sanitizer to prevent XSS attacks
 */
export class HTMLSanitizer {
  constructor() {
    this.allowedTags = new Set([
      'a', 'abbr', 'acronym', 'address', 'area', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo',
      'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col',
      'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div',
      'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'i', 'iframe',
      'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map',
      'mark', 'menu', 'menuitem', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol',
      'optgroup', 'option', 'output', 'p', 'param', 'picture', 'pre', 'progress', 'q',
      'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select', 'small', 'source',
      'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
      'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track',
      'u', 'ul', 'var', 'video', 'wbr'
    ]);

    this.allowedAttributes = new Set([
      'href', 'src', 'alt', 'title', 'class', 'id', 'style', 'width', 'height',
      'disabled', 'readonly', 'required', 'type', 'name', 'value', 'placeholder',
      'min', 'max', 'step', 'pattern', 'autocomplete', 'autofocus', 'checked',
      'selected', 'multiple', 'size', 'maxlength', 'minlength'
    ]);

    this.forbiddenProtocols = new Set([
      'javascript:', 'data:', 'vbscript:', 'mailto:', 'tel:', 'sms:', 'file:'
    ]);
  }

  /**
   * Sanitize HTML string
   */
  sanitize(html) {
    if (typeof html !== 'string') {
      return '';
    }

    // Remove potentially dangerous content
    let sanitized = html
      .replace(/<!--[\s\S]*?-->/g, '') // Remove comments
      .replace(/<script[\s\S]*?<\/script>/gi, '') // Remove script tags
      .replace(/<style[\s\S]*?<\/style>/gi, '') // Remove style tags
      .replace(/on\w+="[^"]*"/gi, '') // Remove event handlers
      .replace(/on\w+='[^']*'/gi, '') // Remove event handlers (single quotes)
      .replace(/on\w+=[^\s>]*/gi, '') // Remove event handlers (unquoted)
      .replace(/javascript:[^"']*/gi, '') // Remove javascript protocols
      .replace(/data:[^"']*/gi, '') // Remove data protocols
      .replace(/vbscript:[^"']*/gi, ''); // Remove vbscript protocols

    // Basic tag sanitization (simplified - in production use DOMPurify)
    sanitized = sanitized.replace(/<([^>]+)>/g, (match, tagContent) => {
      const [tagName, ...attributes] = tagContent.split(/\s+/);
      const cleanTagName = tagName.toLowerCase();

      if (!this.allowedTags.has(cleanTagName)) {
        return '';
      }

      // Sanitize attributes
      const cleanAttributes = attributes
        .map(attr => this.sanitizeAttribute(attr))
        .filter(attr => attr !== null);

      if (cleanAttributes.length === 0) {
        return `<${cleanTagName}>`;
      }

      return `<${cleanTagName} ${cleanAttributes.join(' ')}>`;
    });

    return sanitized.trim();
  }

  /**
   * Sanitize individual attribute
   */
  sanitizeAttribute(attribute) {
    const [name, ...valueParts] = attribute.split('=');
    const value = valueParts.join('=');

    if (!this.allowedAttributes.has(name.toLowerCase())) {
      return null;
    }

    // Check for dangerous protocols
    if (value && (name === 'href' || name === 'src')) {
      const cleanValue = value.replace(/["']/g, '');
      if (this.forbiddenProtocols.has(cleanValue.toLowerCase())) {
        return null;
      }
    }

    return attribute;
  }

  /**
   * Sanitize text content
   */
  sanitizeText(text) {
    if (typeof text !== 'string') {
      return '';
    }

    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }
}

/**
 * URL Validator and Sanitizer
 */
export class URLValidator {
  constructor() {
    this.allowedProtocols = new Set([
      'http:', 'https:', 'ftp:', 'ftps:', 'mailto:', 'tel:', 'data:image/'
    ]);

    this.sanitizer = new HTMLSanitizer();
  }

  /**
   * Validate URL
   */
  isValid(url) {
    if (typeof url !== 'string') {
      return false;
    }

    try {
      const parsed = new URL(url);
      return this.allowedProtocols.has(parsed.protocol.toLowerCase());
    } catch {
      return false;
    }
  }

  /**
   * Sanitize URL
   */
  sanitize(url) {
    if (!this.isValid(url)) {
      return '';
    }

    try {
      const parsed = new URL(url);

      // Remove sensitive parameters
      const safeParams = new URLSearchParams(parsed.search);
      const sensitiveParams = ['password', 'token', 'key', 'secret', 'auth'];

      for (const param of sensitiveParams) {
        safeParams.delete(param);
      }

      parsed.search = safeParams.toString();
      return parsed.toString();
    } catch {
      return '';
    }
  }

  /**
   * Extract domain from URL
   */
  getDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname;
    } catch {
      return '';
    }
  }

  /**
   * Check if URL is same origin
   */
  isSameOrigin(url) {
    try {
      const target = new URL(url);
      const current = new URL(window.location.href);
      return target.origin === current.origin;
    } catch {
      return false;
    }
  }
}

/**
 * Content Security Policy Helper
 */
export class CSPHelper {
  constructor() {
    this.nonce = this.generateNonce();
  }

  /**
   * Generate nonce for CSP
   */
  generateNonce() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array));
  }

  /**
   * Get CSP nonce
   */
  getNonce() {
    return this.nonce;
  }

  /**
   * Add nonce to script element
   */
  addNonceToScript(script) {
    if (script && script.setAttribute) {
      script.setAttribute('nonce', this.nonce);
    }
  }

  /**
   * Validate CSP compliance
   */
  validateCSP() {
    // Check if CSP is enforced
    const cspHeader = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (!cspHeader) {
      console.warn('No CSP header found - consider adding one for security');
      return false;
    }

    return true;
  }
}

/**
 * Input Validator
 */
export class InputValidator {
  /**
   * Validate bookmark title
   */
  validateTitle(title) {
    if (typeof title !== 'string') {
      return { valid: false, error: 'Title must be a string' };
    }

    const trimmed = title.trim();

    if (trimmed.length === 0) {
      return { valid: false, error: 'Title cannot be empty' };
    }

    if (trimmed.length > 255) {
      return { valid: false, error: 'Title too long (max 255 characters)' };
    }

    // Check for dangerous characters
    const dangerousChars = /[<>"'&]/;
    if (dangerousChars.test(trimmed)) {
      return { valid: false, error: 'Title contains invalid characters' };
    }

    return { valid: true, sanitized: trimmed };
  }

  /**
   * Validate URL
   */
  validateURL(url) {
    if (typeof url !== 'string') {
      return { valid: false, error: 'URL must be a string' };
    }

    const trimmed = url.trim();

    if (trimmed.length === 0) {
      return { valid: false, error: 'URL cannot be empty' };
    }

    if (trimmed.length > 2048) {
      return { valid: false, error: 'URL too long (max 2048 characters)' };
    }

    const urlValidator = new URLValidator();
    if (!urlValidator.isValid(trimmed)) {
      return { valid: false, error: 'Invalid URL format' };
    }

    return { valid: true, sanitized: urlValidator.sanitize(trimmed) };
  }

  /**
   * Validate folder name
   */
  validateFolderName(name) {
    return this.validateTitle(name); // Same validation as title
  }

  /**
   * Sanitize search query
   */
  sanitizeSearchQuery(query) {
    if (typeof query !== 'string') {
      return '';
    }

    // Remove potentially dangerous characters but allow search operators
    return query
      .trim()
      .replace(/[<>"'&]/g, '')
      .substring(0, 100); // Limit search query length
  }
}

/**
 * Permission Checker
 */
export class PermissionChecker {
  /**
   * Check if extension has required permissions
   */
  async checkPermissions() {
    const requiredPermissions = ['bookmarks', 'storage'];

    try {
      const permissions = await new Promise((resolve) => {
        chrome.permissions.getAll(resolve);
      });

      const missing = requiredPermissions.filter(perm =>
        !permissions.permissions.includes(perm)
      );

      return {
        hasAllPermissions: missing.length === 0,
        missing,
        current: permissions.permissions
      };
    } catch (error) {
      console.error('Error checking permissions:', error);
      return {
        hasAllPermissions: false,
        missing: requiredPermissions,
        current: [],
        error: error.message
      };
    }
  }

  /**
   * Request additional permissions
   */
  async requestPermissions(permissions) {
    try {
      const granted = await new Promise((resolve) => {
        chrome.permissions.request({ permissions }, resolve);
      });

      return granted;
    } catch (error) {
      console.error('Error requesting permissions:', error);
      return false;
    }
  }
}

/**
 * Security Utilities
 */
export const security = {
  sanitizer: new HTMLSanitizer(),
  urlValidator: new URLValidator(),
  cspHelper: new CSPHelper(),
  inputValidator: new InputValidator(),
  permissionChecker: new PermissionChecker(),

  /**
   * Quick sanitize method
   */
  sanitize(content, type = 'text') {
    switch (type) {
      case 'html':
        return this.sanitizer.sanitize(content);
      case 'url':
        return this.urlValidator.sanitize(content);
      case 'text':
      default:
        return this.sanitizer.sanitizeText(content);
    }
  },

  /**
   * Validate input
   */
  validate(input, type) {
    switch (type) {
      case 'title':
        return this.inputValidator.validateTitle(input);
      case 'url':
        return this.inputValidator.validateURL(input);
      case 'folder':
        return this.inputValidator.validateFolderName(input);
      case 'search':
        return { valid: true, sanitized: this.inputValidator.sanitizeSearchQuery(input) };
      default:
        return { valid: false, error: 'Unknown validation type' };
    }
  },

  /**
   * Check permissions
   */
  async checkPermissions() {
    return this.permissionChecker.checkPermissions();
  }
};

// Export individual classes
export {
  HTMLSanitizer,
  URLValidator,
  CSPHelper,
  InputValidator,
  PermissionChecker
};