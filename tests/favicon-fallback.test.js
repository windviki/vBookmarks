import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initFaviconFallback, hashPixels } from '../src/favicon-fallback.js';
import { DEFAULT_BOOKMARK_ICON } from '../src/icons.js';

// favicon-fallback.js touches page globals (chrome.runtime.getURL, Image,
// document.createElement('canvas')) only inside initFaviconFallback, so the
// module imports cleanly in node once the globals are stubbed. The DOM is a
// hand-rolled double: fake <img> objects with preset pixel bytes, a fake
// canvas whose getImageData returns those bytes, and a fake document that
// records the capture-phase load listener.

const PLACEHOLDER_BYTES = new Uint8ClampedArray([95, 99, 104, 255, 95, 99, 104, 255]);
const REAL_BYTES = new Uint8ClampedArray([200, 30, 30, 255, 30, 200, 30, 255]);

const makeImage = (bytes, w = 2, h = 2) => ({
    tagName: 'IMG',
    src: '',
    naturalWidth: w,
    naturalHeight: h,
    parentNode: null,
    _bytes: bytes
});

let loadHandler;       // the capture-phase listener registered on the fake doc
let lastDocImages;     // Image instances created by the module (calibration)

const flush = () => new Promise(r => setTimeout(r, 0));

beforeAll(() => {
    globalThis.chrome = {
        runtime: { getURL: path => `chrome-extension://test${path}` }
    };
    globalThis.Image = class {
        constructor() {
            // The calibration fetch returns the stock placeholder bitmap.
            this.naturalWidth = 2;
            this.naturalHeight = 2;
            this._bytes = PLACEHOLDER_BYTES;
        }
        set src(v) {
            this._src = v;
            lastDocImages.push(this);
            // Calibration image resolves onload asynchronously, like a real load.
            setTimeout(() => this.onload && this.onload(), 0);
        }
        get src() { return this._src; }
    };
    globalThis.document = {
        addEventListener: (type, fn, capture) => {
            if (type === 'load' && capture) loadHandler = fn;
        },
        createElement: tag => {
            if (tag === 'canvas') {
                return {
                    width: 0, height: 0,
                    _img: null,
                    getContext: () => ({
                        drawImage(img) { this._img = img; },
                        getImageData(x, y, w, h) {
                            return { data: this._img._bytes };
                        }
                    })
                };
            }
            // <span> host for the SVG swap markup: parse just enough — the
            // module only reads .firstChild.
            return {
                innerHTML: '',
                get firstChild() { return { svgMarkup: this.innerHTML }; }
            };
        }
    };
});

beforeEach(() => {
    loadHandler = null;
    lastDocImages = [];
});

afterAll(() => {
    delete globalThis.chrome;
    delete globalThis.Image;
    delete globalThis.document;
});

describe('hashPixels', () => {
    it('is deterministic and sensitive to any byte', () => {
        expect(hashPixels(PLACEHOLDER_BYTES)).toBe(hashPixels(PLACEHOLDER_BYTES));
        expect(hashPixels(PLACEHOLDER_BYTES)).not.toBe(hashPixels(REAL_BYTES));
        const oneOff = PLACEHOLDER_BYTES.slice();
        oneOff[3] = 254;
        expect(hashPixels(PLACEHOLDER_BYTES)).not.toBe(hashPixels(oneOff));
    });
});

describe('initFaviconFallback', () => {
    it('stays inert without chrome.runtime', () => {
        delete globalThis.chrome;
        expect(initFaviconFallback(globalThis.document)).toBeNull();
        globalThis.chrome = { runtime: { getURL: p => p } };
    });

    it('replaces an img matching the calibrated placeholder fingerprint', async () => {
        const api = initFaviconFallback(globalThis.document);
        const parent = {
            replaced: null,
            replaceChild(svg, img) { this.replaced = { svg, img }; }
        };
        const img = makeImage(PLACEHOLDER_BYTES);
        img.src = 'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fa.example&size=32';
        img.parentNode = parent;
        loadHandler({ target: img });
        await flush(); await flush(); // calibration load + promise chain
        expect(parent.replaced).toBeTruthy();
        expect(parent.replaced.svg.svgMarkup).toBe(DEFAULT_BOOKMARK_ICON);
        expect(api.verdicts.get(img.src)).toBe(true);
    });

    it('keeps a real favicon (different pixels)', async () => {
        const api = initFaviconFallback(globalThis.document);
        const parent = { replaceChild() { throw new Error('must not swap'); } };
        const img = makeImage(REAL_BYTES);
        img.src = 'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fb.example&size=32';
        img.parentNode = parent;
        loadHandler({ target: img });
        await flush(); await flush();
        expect(api.verdicts.get(img.src)).toBe(false);
    });

    it('caches the verdict per src — a second identical icon swaps without re-sampling', async () => {
        const api = initFaviconFallback(globalThis.document);
        const mk = () => {
            const img = makeImage(PLACEHOLDER_BYTES);
            img.src = 'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fc.example&size=32';
            img.parentNode = { swapped: false, replaceChild() { this.swapped = true; } };
            return img;
        };
        const first = mk();
        loadHandler({ target: first });
        await flush(); await flush();
        expect(first.parentNode.swapped).toBe(true);
        const second = mk();
        second._bytes = null; // a re-sample would blow up → proves the cache hit
        loadHandler({ target: second });
        await flush();
        expect(second.parentNode.swapped).toBe(true);
    });

    it('ignores non-favicon imgs and non-img targets', async () => {
        const api = initFaviconFallback(globalThis.document);
        const other = makeImage(PLACEHOLDER_BYTES);
        other.src = 'https://example.com/icon.png'; // a page image, not a _favicon
        // Sentinel: if the module ever tried to swap a non-favicon img, this
        // replaceChild would throw and the test fails.
        const parent = { replaceChild() { throw new Error('must not swap'); } };
        other.parentNode = parent;
        loadHandler({ target: other });
        loadHandler({ target: { tagName: 'DIV' } }); // non-IMG: never reaches handle
        await flush(); await flush();
        // no verdict recorded for the non-favicon src, and nothing was swapped
        expect(api.verdicts.has(other.src)).toBe(false);
        expect(api.verdicts.size).toBe(0);
    });

    it('swapped icon is the currentColor document glyph from icons.js', () => {
        expect(DEFAULT_BOOKMARK_ICON).toContain('stroke="currentColor"');
        expect(DEFAULT_BOOKMARK_ICON).toContain('vbm-icon-doc');
        expect(DEFAULT_BOOKMARK_ICON).toContain('aria-hidden="true"');
    });
});
