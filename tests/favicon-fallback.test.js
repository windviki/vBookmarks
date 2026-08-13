import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { initFaviconFallback, hashPixels, contrastStats, needsContrast } from '../src/favicon-fallback.js';
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

describe('contrastStats', () => {
    const white = () => new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    const black = () => new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    const transparent = () => new Uint8ClampedArray([255, 255, 255, 0, 0, 0, 0, 0]);

    it('a white icon is full-luminance, zero-saturation, fully covered', () => {
        expect(contrastStats(white())).toEqual({ lum: 1, sat: 0, cover: 1 });
    });

    it('a black icon is zero-luminance, zero-saturation, fully covered', () => {
        expect(contrastStats(black())).toEqual({ lum: 0, sat: 0, cover: 1 });
    });

    it('transparent pixels are skipped; a fully transparent icon has cover 0', () => {
        expect(contrastStats(transparent())).toEqual({ lum: 0, sat: 0, cover: 0 });
    });

    it('a colorful icon keeps its saturation', () => {
        const s = contrastStats(REAL_BYTES);
        expect(s.lum).toBeCloseTo(0.427, 2);
        expect(s.sat).toBeCloseTo(0.667, 2);
        expect(s.cover).toBe(1);
    });
});

describe('needsContrast', () => {
    const white = { lum: 1, sat: 0, cover: 1 };
    const black = { lum: 0, sat: 0, cover: 1 };
    const nearWhite = { lum: 0.75, sat: 0.05, cover: 1 };   // #bfbfbf — 偏白，非纯白
    const nearBlack = { lum: 0.25, sat: 0.05, cover: 1 };   // #404040 — 偏黑，非纯黑
    const midGray = { lum: 0.5, sat: 0, cover: 1 };
    const colorfulLight = { lum: 0.9, sat: 0.5, cover: 1 };
    const empty = { lum: 0, sat: 0, cover: 0 };

    it('flips icons on the wrong side of the background luminance', () => {
        expect(needsContrast(white, false)).toBe(true);   // white on light bg
        expect(needsContrast(white, true)).toBe(false);   // white is fine on dark
        expect(needsContrast(black, true)).toBe(true);    // black on dark bg
        expect(needsContrast(black, false)).toBe(false);  // black is fine on light
    });

    it('catches near-white / near-black, not just pure tones', () => {
        expect(needsContrast(nearWhite, false)).toBe(true);  // 偏白在亮背景上不可见
        expect(needsContrast(nearWhite, true)).toBe(false);
        expect(needsContrast(nearBlack, true)).toBe(true);   // 偏黑在暗背景上不可见
        expect(needsContrast(nearBlack, false)).toBe(false);
    });

    it('leaves mid-gray and colorful icons alone', () => {
        // mid-gray 反色后仍是 mid-gray（invert 映射 L→1−L），无对比收益
        expect(needsContrast(midGray, false)).toBe(false);
        expect(needsContrast(midGray, true)).toBe(false);
        expect(needsContrast(colorfulLight, false)).toBe(false); // saturated → not inverted
    });

    it('an icon with no opaque pixels is never flipped', () => {
        expect(needsContrast(empty, false)).toBe(false);
        expect(needsContrast(empty, true)).toBe(false);
        expect(needsContrast(null, false)).toBe(false);
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

    // --- v4.1 favicon contrast service --------------------------------------
    // A real (non-placeholder) favicon's classList toggles the invert class
    // from its cached stats; the decision is re-read live from the theme and
    // setting getters.
    const WHITE_ICON = () => new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]);
    const BLACK_ICON = () => new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);
    const makeClassImg = (bytes, src) => {
        const img = makeImage(bytes);
        img.classList = {
            set: new Set(),
            add(c) { this.set.add(c); },
            remove(c) { this.set.delete(c); }
        };
        img.src = src;
        img.parentNode = { replaceChild() { throw new Error('must not swap'); } };
        return img;
    };

    it('inverts a near-monochrome too-light icon on a light background', async () => {
        const api = initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => false
        });
        const img = makeClassImg(WHITE_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fwhite.example&size=32');
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);
        expect(api.verdicts.get(img.src)).toBe(false);
    });

    it('inverts a near-monochrome too-dark icon on a dark background', async () => {
        initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => true
        });
        const img = makeClassImg(BLACK_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fblack.example&size=32');
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);
    });

    it('inverts a light-gray (not pure-white) icon on a light background', async () => {
        // #bfbfbf → lum 0.75, sat 0：偏白但远非纯白，正是「偏白色图标」的实际场景
        const LIGHT_GRAY_ICON = () => new Uint8ClampedArray([191, 191, 191, 255, 191, 191, 191, 255]);
        initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => false
        });
        const img = makeClassImg(LIGHT_GRAY_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Flightgray.example&size=32');
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);
    });

    it('leaves a colorful favicon alone even on the wrong background', async () => {
        initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => false
        });
        const img = makeClassImg(REAL_BYTES,
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fcolorful.example&size=32');
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(false);
    });

    it('a white icon is not inverted on a dark background', async () => {
        initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => true
        });
        const img = makeClassImg(WHITE_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fwhite-dark.example&size=32');
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(false);
    });

    it('the contrast service stays inert when disabled (no classList access)', async () => {
        initFaviconFallback(globalThis.document, {
            contrastEnabled: () => false,
            themeIsDark: () => false
        });
        const img = makeClassImg(WHITE_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Foff.example&size=32');
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.size).toBe(0);
    });

    it('re-decides against the live theme getter (palette switch)', async () => {
        let dark = false;
        const api = initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => dark
        });
        const img = makeClassImg(WHITE_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fflip.example&size=32');
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);
        // palette switches to dark: the cached stats now say "no invert"
        dark = true;
        api.applyContrast(img);
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(false);
    });
});
