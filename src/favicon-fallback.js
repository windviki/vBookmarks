/**
 * Default-favicon fallback (4.0.2).
 *
 * Chrome's `_favicon` API answers a favicon-less page with its stock
 * placeholder — a flat bitmap drawn for light backgrounds (a gray globe on
 * Chrome, a darker document glyph on Edge). On the dark/ink themes it nearly
 * vanishes (the recurring "default bookmark icon is black, invisible"
 * report). The 4.0.1 CSS brightness lift (902304a) is only a partial fix:
 * every browser build serves a different gray, so no single brightness
 * factor is reliable, and the filter hits real favicons too. This module
 * replaces the placeholder with our own currentColor line icon
 * (DEFAULT_BOOKMARK_ICON, icons.js) that follows the theme exactly like the
 * folder icon.
 *
 * Detection is CALIBRATED, not heuristic: at init we fetch the icon for a
 * guaranteed-favicon-less URL (a .invalid host never resolves, so _favicon
 * must answer with the placeholder) and fingerprint its pixels. Any favicon
 * <img> that later loads with the identical fingerprint IS the placeholder;
 * a real site's favicon cannot byte-match it. Verdicts are cached per src,
 * so each distinct icon is sampled once. If anything in the pipeline is
 * unavailable (no _favicon API, no canvas, tainted bitmap) the module stays
 * inert and the stock icon is kept — never worse than before.
 *
 * One capture-phase `load` delegation on the document covers every <img>
 * however it was created (tree rows, list views, palette) — img load events
 * don't bubble, but capture sees them all.
 */

import { DEFAULT_BOOKMARK_ICON } from './icons.js';

const FAVICON_MARKER = '/_favicon/';

// FNV-1a over the RGBA bytes — cheap and stable within a session. The
// placeholder bitmap is a static asset per Chrome build, so an exact hash
// match is the right granularity (no tolerance needed).
export const hashPixels = bytes => {
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
};

// v4.1 favicon contrast service: from the SAME getImageData buffer the
// placeholder check already samples, derive three stats — mean relative
// luminance, mean saturation (max−min), and the fraction of opaque pixels.
// No extra canvas, no extra decode: the contrast decision reuses one read.
// Transparent pixels are skipped; a fully transparent icon yields cover 0.
export const contrastStats = data => {
    let lumSum = 0, satSum = 0, cover = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] / 255 < 0.5)
            continue;
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        lumSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        satSum += mx - mn;
        cover++;
    }
    if (!cover)
        return { lum: 0, sat: 0, cover: 0 };
    return { lum: lumSum / cover, sat: satSum / cover, cover: cover / total };
};

// Invert decision: only flip icons that are BOTH on the wrong side of the
// background luminance AND near-monochrome (low saturation) — a white or
// black single-color logo, not a colorful brand mark that invert would
// distort. The luminance thresholds are deliberately NOT near the extremes
// (pure white/black would have no practical value): a white-ish icon down to
// lum 0.70 inverts to ≤0.30 (≈3:1 contrast on the light bg), and a black-ish
// icon up to lum 0.30 inverts to ≥0.70 on a dark bg. Mid-gray is left alone
// because invert() maps L→1−L, so flipping a mid-tone buys no contrast.
// Light background → flip too-light icons; dark → flip too-dark.
export const needsContrast = (stats, darkBg) => {
    if (!stats || !stats.cover)
        return false;
    if (darkBg)
        return stats.lum < 0.30 && stats.sat < 0.25;
    return stats.lum > 0.70 && stats.sat < 0.25;
};

export function initFaviconFallback(doc = document, ctx = {}) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL)
        return null;
    if (typeof Image !== 'function' || !doc || !doc.addEventListener)
        return null;

    // v4.1 favicon contrast service: themeIsDark / contrastEnabled are getters
    // read at DECISION time (not snapshotted at init), so a live palette theme
    // switch or an options-page toggle takes effect without a restart. Defaults
    // keep the service inert when no context is provided (unit tests, or any
    // page that doesn't opt in).
    const themeIsDark = ctx.themeIsDark || (() => false);
    const contrastEnabled = ctx.contrastEnabled || (() => false);

    const fingerprint = img => {
        const w = img.naturalWidth | 0, h = img.naturalHeight | 0;
        if (!w || !h)
            return null;
        try {
            const canvas = doc.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const c = canvas.getContext && canvas.getContext('2d');
            if (!c)
                return null;
            c.drawImage(img, 0, 0);
            const data = c.getImageData(0, 0, w, h).data;
            // One read serves both jobs: the placeholder hash and the
            // contrast stats for the invert decision.
            return { w, h, hash: hashPixels(data), ...contrastStats(data) };
        } catch (_) {
            return null; // canvas unavailable → leave the icon alone
        }
    };

    // size=32 matches every _favicon consumer (tree-render, palette).
    const probeSrc = `${chrome.runtime.getURL(FAVICON_MARKER)}?pageUrl=${
        encodeURIComponent('http://vbm-favicon-probe.invalid/')}&size=32`;

    let placeholder = null;       // {w, h, hash} of the stock placeholder
    const verdicts = new Map();   // src → true (placeholder) | false (real)
    const statsBySrc = new Map(); // src → { lum, sat, cover } of a real icon

    const swapForDefaultIcon = img => {
        const host = doc.createElement('span');
        host.innerHTML = DEFAULT_BOOKMARK_ICON;
        const svg = host.firstChild;
        if (svg && img.parentNode)
            img.parentNode.replaceChild(svg, img);
    };

    // Toggle the invert class from the cached stats for this src. The class
    // sits on the <img>; CSS (neat.css .favicon-contrast-invert) applies the
    // filter. Guarded so stubbed imgs without classList never throw.
    const applyContrast = img => {
        if (!contrastEnabled() || !img || !img.classList)
            return;
        const stats = statsBySrc.get(img.src);
        if (!stats)
            return;
        if (needsContrast(stats, themeIsDark()))
            img.classList.add('favicon-contrast-invert');
        else
            img.classList.remove('favicon-contrast-invert');
    };

    const calibrate = new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            placeholder = fingerprint(img);
            resolve();
        };
        img.onerror = () => resolve(); // no _favicon API → stay inert
        img.src = probeSrc;
    });

    const handle = img => {
        const src = img.src;
        if (!src || src.indexOf(FAVICON_MARKER) === -1)
            return;
        const cached = verdicts.get(src);
        if (cached === false) {
            // Already known real favicon: re-apply the (cached) contrast
            // decision — a re-render after a theme switch lands here.
            applyContrast(img);
            return;
        }
        if (cached === true) {
            swapForDefaultIcon(img);
            return;
        }
        calibrate.then(() => {
            // The row may have re-rendered while calibration was in flight.
            if (!img.parentNode)
                return;
            const fp = fingerprint(img); // one sample serves both verdicts
            const isPlaceholder = !!fp && !!placeholder
                && fp.w === placeholder.w && fp.h === placeholder.h
                && fp.hash === placeholder.hash;
            verdicts.set(src, isPlaceholder);
            if (isPlaceholder) {
                swapForDefaultIcon(img);
            } else {
                // Real favicon: cache its stats and decide contrast once.
                statsBySrc.set(src, fp || { lum: 0, sat: 0, cover: 0 });
                applyContrast(img);
            }
        });
    };

    doc.addEventListener('load', e => {
        const t = e.target;
        if (t && t.tagName === 'IMG')
            handle(t);
    }, true);

    // Live theme switches (palette.js swaps body[data-theme] in place) need
    // the invert classes re-decided near-real-time — cheap, no re-sampling,
    // just re-applying cached stats against the new background.
    const reapplyContrast = () => {
        if (typeof doc.querySelectorAll !== 'function')
            return;
        doc.querySelectorAll('img[src*="/_favicon/"]').forEach(applyContrast);
    };
    let themeObserver = null;
    if (typeof MutationObserver !== 'undefined' && doc.body && typeof doc.body.observe === 'function') {
        themeObserver = new MutationObserver(ms => {
            if (ms.some(m => m.attributeName === 'data-theme'))
                reapplyContrast();
        });
        themeObserver.observe(doc.body, { attributes: true, attributeFilter: ['data-theme'] });
    }

    return { verdicts, handle, statsBySrc, applyContrast, reapplyContrast, themeObserver };
}
