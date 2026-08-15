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
const REAL_BYTES = new Uint8ClampedArray([29, 99, 237, 255, 29, 99, 237, 255]); // docker blue: mid-tone

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
    // Per-test stubs installed by the runtime-gap tests below must not leak.
    delete globalThis.matchMedia;
    delete globalThis.document.querySelectorAll;
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

    it('a white icon is fully light-extreme, fully covered', () => {
        expect(contrastStats(white())).toEqual({ dark: 0, light: 1, colored: 0, cover: 1 });
    });

    it('a black icon is fully dark-extreme, fully covered', () => {
        expect(contrastStats(black())).toEqual({ dark: 1, light: 0, colored: 0, cover: 1 });
    });

    it('transparent pixels are skipped; a fully transparent icon has cover 0', () => {
        expect(contrastStats(transparent())).toEqual({ dark: 0, light: 0, colored: 0, cover: 0 });
    });

    it('a mid-tone colorful icon lands in neither extreme bucket', () => {
        // (29,99,237) docker blue → lum ≈ 94, between the 77/179 bucket edges;
        // sat = 237−29 = 208 > 38 → counted colored (the brand hue must shield it)
        expect(contrastStats(REAL_BYTES)).toEqual({ dark: 0, light: 0, colored: 1, cover: 1 });
    });

    it('a dark-but-colorful icon counts as dark AND colored (netflix red N)', () => {
        // #E50914 → lum ≈ 56 < 77 and sat = 220 > 38
        const netflixRed = new Uint8ClampedArray([229, 9, 20, 255, 229, 9, 20, 255]);
        expect(contrastStats(netflixRed)).toEqual({ dark: 1, light: 0, colored: 1, cover: 1 });
    });

    it('half dark + half light reads as both fractions, neither colored (two-tone)', () => {
        const twoTone = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]);
        expect(contrastStats(twoTone)).toEqual({ dark: 0.5, light: 0.5, colored: 0, cover: 1 });
    });
});

describe('needsContrast', () => {
    const white = { dark: 0, light: 1, colored: 0, cover: 1 };
    const black = { dark: 1, light: 0, colored: 0, cover: 1 };
    const nearWhite = { dark: 0, light: 0.9, colored: 0, cover: 0.94 };   // yabook: 偏白浅灰，远非纯白
    const nearBlack = { dark: 0.9, light: 0, colored: 0, cover: 0.6 };    // 偏黑深色 logo，透明底
    const midGray = { dark: 0, light: 0, colored: 0, cover: 1 };
    const darkColorful = { dark: 1, light: 0, colored: 1, cover: 0.49 };  // netflix: 暗而饱和
    const lightColorful = { dark: 0, light: 0.66, colored: 0.42, cover: 1 }; // devconsole: 白底彩色 logo
    const lightSlightlyColored = { dark: 0, light: 0.8, colored: 0.25, cover: 1 }; // 浅底 + 少量彩: 仍翻
    const darkPlateLightGlyph = { dark: 0.82, light: 0.1, colored: 0, cover: 1 }; // x.com: 黑盘白字
    const lightPlateDarkGlyph = { dark: 0.2, light: 0.75, colored: 0, cover: 1 }; // 白盘黑字
    const twoTone = { dark: 0.5, light: 0.5, colored: 0, cover: 1 };      // 均衡双色：翻转无收益
    const empty = { dark: 0, light: 0, colored: 0, cover: 0 };

    it('flips icons on the wrong side of the background', () => {
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

    it('flips a dark-but-colorful mark on dark — the hue-preserving filter keeps its hue', () => {
        expect(needsContrast(darkColorful, true)).toBe(true);   // netflix 红 N → 浅红
        expect(needsContrast(darkColorful, false)).toBe(false);
    });

    it('leaves a light-but-colorful logo alone on light — the white card would go black (devconsole)', () => {
        // devconsole's chrome-color-block icon is legible on white; inverting
        // would black the card and shift every hue. The colored guard stops it.
        expect(needsContrast(lightColorful, false)).toBe(false);
        expect(needsContrast(lightColorful, true)).toBe(false);
    });

    it('still flips a light mark with only a little color (guard threshold 0.30)', () => {
        expect(needsContrast(lightSlightlyColored, false)).toBe(true);
    });

    it('leaves a self-inverting dark plate with a light glyph alone (x.com)', () => {
        // 黑盘在暗背景上隐形、白字自然浮现——翻转只会得到刺眼白盘
        expect(needsContrast(darkPlateLightGlyph, true)).toBe(false);
        expect(needsContrast(darkPlateLightGlyph, false)).toBe(false);
    });

    it('leaves a readable light plate with a dark glyph alone on light', () => {
        expect(needsContrast(lightPlateDarkGlyph, false)).toBe(false);
        expect(needsContrast(lightPlateDarkGlyph, true)).toBe(false);
    });

    it('leaves mid-gray and balanced two-tone icons alone', () => {
        // 明度翻转映射 L→1−L：中间调与均衡双色翻转后对比度无收益
        expect(needsContrast(midGray, false)).toBe(false);
        expect(needsContrast(midGray, true)).toBe(false);
        expect(needsContrast(twoTone, false)).toBe(false);
        expect(needsContrast(twoTone, true)).toBe(false);
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
        // #bfbfbf → lum ≈ 0.749 > 0.70 light 桶：偏白但远非纯白，正是「偏白色图标」的实际场景
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

    it('the colored guard shields a light-plate colorful logo end to end (devconsole case)', async () => {
        // A white card carrying colorful blocks: light 5/8 = 0.625 > 0.60 and
        // dark 0 < 0.15 would flip it WITHOUT the guard — colored 3/8 = 0.375
        // ≥ 0.30 is what saves the brand mark (the devconsole regression).
        // Drives real bytes through the load handler → contrastStats →
        // statsBySrc → applyContrast, not a hand-written stats fixture.
        const plate = (block) => new Uint8ClampedArray([
            255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255,
            255, 255, 255, 255, 255, 255, 255, 255, ...block, ...block, ...block
        ]);
        const COLORFUL = plate([29, 99, 237, 255]);   // chroma 208 > 38 → colored
        const MONO = plate([200, 200, 200, 255]);     // chroma 0 → monochrome
        initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => false
        });
        const colorful = makeClassImg(COLORFUL,
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fdevconsole.example&size=32');
        loadHandler({ target: colorful });
        await flush(); await flush();
        expect(colorful.classList.set.has('favicon-contrast-invert')).toBe(false);
        // the same plate shape in monochrome still flips — the guard reads
        // chroma, not geometry
        const mono = makeClassImg(MONO,
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fmonoplate.example&size=32');
        loadHandler({ target: mono });
        await flush(); await flush();
        expect(mono.classList.set.has('favicon-contrast-invert')).toBe(true);
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

    it('the contrast service stays inert when disabled (never adds the invert class)', async () => {
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

    // --- v4.0.5 runtime gaps -------------------------------------------------
    // (a) auto 主题下 OS 级明暗切换不动 body[data-theme]，只有
    // prefers-color-scheme 媒体查询发声——模块订阅它的 change 事件做同样的
    // 重判。(b) options 页翻转 faviconContrast 后，neat.js 的
    // chrome.storage.onChanged wiring 把新值推进 getter 并调
    // reapplyContrast()——这里钉住这条路径依赖的两个原语。
    it('re-decides on a prefers-color-scheme change (auto theme OS switch)', async () => {
        let dark = false;
        let schemeListener = null;
        globalThis.matchMedia = query => ({
            media: query,
            addEventListener: (type, fn) => {
                if (type === 'change')
                    schemeListener = fn;
            }
        });
        const img = makeClassImg(WHITE_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fos-flip.example&size=32');
        globalThis.document.querySelectorAll = () => [img];
        const api = initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => dark
        });
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(true); // white on light
        expect(api.schemeMedia).toBeTruthy();
        expect(api.schemeMedia.media).toBe('(prefers-color-scheme: dark)');
        expect(schemeListener).toBeTruthy();
        // OS flips to dark under the auto theme: no attribute mutation, only
        // the media-query change event — the cached stats are re-decided
        dark = true;
        schemeListener();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(false);
    });

    it('no matchMedia in the environment → schemeMedia stays null (inert)', () => {
        const api = initFaviconFallback(globalThis.document);
        expect(api.schemeMedia).toBeNull();
    });

    it('toggling the setting off sweeps previously applied invert classes', async () => {
        let on = true;
        const img = makeClassImg(WHITE_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Ftoggle-off.example&size=32');
        globalThis.document.querySelectorAll = () => [img];
        const api = initFaviconFallback(globalThis.document, {
            contrastEnabled: () => on,
            themeIsDark: () => false
        });
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);
        // the neat.js storage.onChanged wiring: push the new value into the
        // getter, then reapplyContrast() — the stale class must not outlive
        // the setting
        on = false;
        api.reapplyContrast();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(false);
    });

    it('toggling the setting on re-applies invert from the cached stats', async () => {
        let on = false;
        const img = makeClassImg(WHITE_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Ftoggle-on.example&size=32');
        globalThis.document.querySelectorAll = () => [img];
        const api = initFaviconFallback(globalThis.document, {
            contrastEnabled: () => on,
            themeIsDark: () => false
        });
        loadHandler({ target: img });
        await flush(); await flush();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(false); // disabled at load
        on = true;
        api.reapplyContrast();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);
    });

    // --- live theme-change wiring (A2+A3 regression) ------------------------
    // The re-decide path must be WIRED, not just callable: a body[data-theme]
    // MutationObserver (explicit palette switches) and a prefers-color-scheme
    // matchMedia listener (the auto theme, where data-theme stays "auto")
    // both drive reapplyContrast. Regression: the old guard installed the
    // observer on `doc.body.observe` (a method that never exists), so NO
    // observer was ever created and a theme switch left stale invert classes.
    it('observes body[data-theme] and re-decides invert classes on the switch (A2)', async () => {
        const saved = globalThis.MutationObserver;
        globalThis.MutationObserver = class {
            constructor(cb) { this.cb = cb; }
            observe(target, opts) { this.target = target; this.opts = opts; }
        };
        try {
            let dark = false;
            const imgs = [];
            const doc = Object.assign(Object.create(globalThis.document), {
                body: { tagName: 'BODY' },
                querySelectorAll: () => imgs
            });
            const api = initFaviconFallback(doc, {
                contrastEnabled: () => true,
                themeIsDark: () => dark
            });
            expect(api.themeObserver).toBeTruthy();
            expect(api.themeObserver.target).toBe(doc.body);
            expect(api.themeObserver.opts).toEqual({ attributes: true, attributeFilter: ['data-theme'] });

            const img = makeClassImg(WHITE_ICON(),
                'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fmo.example&size=32');
            imgs.push(img);
            loadHandler({ target: img });
            await flush(); await flush();
            expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);

            // palette flips to dark → the observer must drop the stale class
            dark = true;
            api.themeObserver.cb([{ attributeName: 'data-theme' }]);
            expect(img.classList.set.has('favicon-contrast-invert')).toBe(false);

            // a non-theme body attribute must NOT re-decide
            img.classList.add('favicon-contrast-invert');
            api.themeObserver.cb([{ attributeName: 'class' }]);
            expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);
        } finally {
            if (saved) globalThis.MutationObserver = saved;
            else delete globalThis.MutationObserver;
        }
    });

    it('listens to prefers-color-scheme via doc.defaultView.matchMedia (auto theme)', async () => {
        let dark = false;
        const imgs = [];
        const listeners = [];
        const doc = Object.assign(Object.create(globalThis.document), {
            querySelectorAll: () => imgs,
            defaultView: {
                matchMedia: q => ({
                    query: q,
                    addEventListener(type, fn) { listeners.push({ type, fn }); }
                })
            }
        });
        const api = initFaviconFallback(doc, {
            contrastEnabled: () => true,
            themeIsDark: () => dark
        });
        expect(api.themeMedia).toBeTypeOf('function');
        expect(api.schemeMedia).toBeTruthy();
        expect(api.schemeMedia.query).toBe('(prefers-color-scheme: dark)');
        expect(listeners).toHaveLength(1);
        expect(listeners[0].type).toBe('change');

        const img = makeClassImg(BLACK_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fauto.example&size=32');
        imgs.push(img);
        loadHandler({ target: img });
        await flush(); await flush();
        // black icon, currently light bg → not inverted yet
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(false);
        dark = true;
        listeners[0].fn();
        expect(img.classList.set.has('favicon-contrast-invert')).toBe(true);
    });

    it('degrades gracefully with no MutationObserver / no matchMedia', () => {
        const saved = globalThis.MutationObserver;
        if (saved)
            delete globalThis.MutationObserver;
        try {
            const api = initFaviconFallback(globalThis.document, {
                contrastEnabled: () => true,
                themeIsDark: () => false
            });
            expect(api).toBeTruthy();
            expect(api.themeObserver).toBeNull(); // no body in the shared stub
            expect(api.schemeMedia).toBeNull();   // no defaultView.matchMedia, no global
            expect(api.themeMedia).toBeNull();
            // manual re-decide still works — only the auto-wiring is absent
            expect(() => api.reapplyContrast()).not.toThrow();
        } finally {
            if (saved) globalThis.MutationObserver = saved;
        }
    });

    // --- 4.0.5 favicon enrichment hook (§4.1) --------------------------------
    it('onPlaceholder returning true suppresses the default swap', async () => {
        let called = 0;
        const api = initFaviconFallback(globalThis.document, {
            onPlaceholder: img => { called++; return true; }   // "I handled it"
        });
        const parent = { replaced: null, replaceChild() { this.replaced = true; } };
        const img = makeImage(PLACEHOLDER_BYTES);
        img.src = 'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fhook-true.example&size=32';
        img.parentNode = parent;
        loadHandler({ target: img });
        await flush(); await flush();
        expect(called).toBe(1);
        expect(parent.replaced).toBeNull();   // no default swap
        expect(api.verdicts.get(img.src)).toBe(true);  // still marked placeholder
    });

    it('onPlaceholder returning false falls through to the default swap', async () => {
        let called = 0;
        const api = initFaviconFallback(globalThis.document, {
            onPlaceholder: () => { called++; return false; }   // "enqueue, fall back"
        });
        const parent = { replaced: null, replaceChild(svg) { this.replaced = svg; } };
        const img = makeImage(PLACEHOLDER_BYTES);
        img.src = 'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fhook-false.example&size=32';
        img.parentNode = parent;
        loadHandler({ target: img });
        await flush(); await flush();
        expect(called).toBe(1);
        expect(parent.replaced).toBeTruthy();  // default SVG swapped in
    });

    it('onPlaceholder is also consulted on the cached-placeholder re-render path', async () => {
        const api = initFaviconFallback(globalThis.document, {
            onPlaceholder: () => true
        });
        // First paint: mark as placeholder, hook suppresses swap.
        const parent = { replaced: null, replaceChild() { this.replaced = true; } };
        const img = makeImage(PLACEHOLDER_BYTES);
        img.src = 'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fhook-re.example&size=32';
        img.parentNode = parent;
        loadHandler({ target: img });
        await flush(); await flush();
        expect(parent.replaced).toBeNull();
        // Re-render: verdicts already true → the cached branch must consult the
        // hook again (a re-render after the enricher cached an icon).
        let hookCalls = 0;
        api.reapplyContrast = () => {};
        // Patch the hook reference? It's closure-captured at init — instead
        // verify the cached branch calls onPlaceholder by re-dispatching and
        // checking the swap is still suppressed (same hook → returns true).
        const img2 = makeImage(PLACEHOLDER_BYTES);
        img2.src = img.src;
        img2.parentNode = { replaced: false, replaceChild() { this.replaced = true; } };
        loadHandler({ target: img2 });
        await flush();
        expect(img2.parentNode.replaced).toBe(false);   // hook still suppresses
        void hookCalls;
    });

    it('exposes sampleIcon (the internal fingerprint) on the API', () => {
        const api = initFaviconFallback(globalThis.document);
        expect(typeof api.sampleIcon).toBe('function');
        const img = makeImage(PLACEHOLDER_BYTES);
        const fp = api.sampleIcon(img);
        expect(fp).toBeTruthy();
        expect(typeof fp.hash).toBe('number');
        expect(fp.cover).toBeGreaterThan(0);
    });

    it('reapplyContrast covers enriched imgs (img.favicon-enriched)', async () => {
        // The extended selector must reach injected icons on theme switches.
        const called = [];
        const api = initFaviconFallback(globalThis.document, {
            contrastEnabled: () => true,
            themeIsDark: () => false
        });
        const enriched = makeClassImg(WHITE_ICON(),
            'chrome-extension://test/_favicon/?pageUrl=http%3A%2F%2Fenr.example&size=32');
        enriched.classList.add('favicon-enriched');
        // Override the querySelectorAll to capture what reapplyContrast selects.
        const origQSA = globalThis.document.querySelectorAll;
        globalThis.document.querySelectorAll = sel => {
            called.push(sel);
            return sel === 'img[src*="/_favicon/"], img.favicon-enriched' ? [enriched] : [];
        };
        try {
            api.reapplyContrast();
        } finally {
            globalThis.document.querySelectorAll = origQSA;
        }
        expect(called).toContain('img[src*="/_favicon/"], img.favicon-enriched');
        // A themed enriched icon (white on light) would get the invert class —
        // but without cached stats it's a no-op; the selector reach is the point.
        expect(enriched.classList.set.has('favicon-contrast-invert')).toBe(false);
    });
});
