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

export function initFaviconFallback(doc = document) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL)
        return null;
    if (typeof Image !== 'function' || !doc || !doc.addEventListener)
        return null;

    const fingerprint = img => {
        const w = img.naturalWidth | 0, h = img.naturalHeight | 0;
        if (!w || !h)
            return null;
        try {
            const canvas = doc.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext && canvas.getContext('2d');
            if (!ctx)
                return null;
            ctx.drawImage(img, 0, 0);
            return { w, h, hash: hashPixels(ctx.getImageData(0, 0, w, h).data) };
        } catch (_) {
            return null; // canvas unavailable → leave the icon alone
        }
    };

    // size=32 matches every _favicon consumer (tree-render, palette).
    const probeSrc = `${chrome.runtime.getURL(FAVICON_MARKER)}?pageUrl=${
        encodeURIComponent('http://vbm-favicon-probe.invalid/')}&size=32`;

    let placeholder = null;       // {w, h, hash} of the stock placeholder
    const verdicts = new Map();   // src → true (placeholder) | false (real)

    const swapForDefaultIcon = img => {
        const host = doc.createElement('span');
        host.innerHTML = DEFAULT_BOOKMARK_ICON;
        const svg = host.firstChild;
        if (svg && img.parentNode)
            img.parentNode.replaceChild(svg, img);
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

    const judge = img => {
        if (!placeholder)
            return false;
        const fp = fingerprint(img);
        return !!fp && fp.w === placeholder.w && fp.h === placeholder.h
            && fp.hash === placeholder.hash;
    };

    const handle = img => {
        const src = img.src;
        if (!src || src.indexOf(FAVICON_MARKER) === -1)
            return;
        const cached = verdicts.get(src);
        if (cached === false)
            return;
        if (cached === true) {
            swapForDefaultIcon(img);
            return;
        }
        calibrate.then(() => {
            // The row may have re-rendered while calibration was in flight.
            if (!img.parentNode)
                return;
            const verdict = judge(img);
            verdicts.set(src, verdict);
            if (verdict)
                swapForDefaultIcon(img);
        });
    };

    doc.addEventListener('load', e => {
        const t = e.target;
        if (t && t.tagName === 'IMG')
            handle(t);
    }, true);

    return { verdicts, handle }; // exposed for tests / diagnostics
}
