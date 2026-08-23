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

// 4.0.5 favicon contrast service: from the SAME getImageData buffer the
// placeholder check already samples, derive four stats — the fraction of
// opaque pixels sitting on the DARK extreme (lum < 0.30), on the LIGHT
// extreme (lum > 0.70), the COLORED share (chroma — max−min of the RGB
// channels — > 38 of 255; a chroma measure, not HSL saturation, so pale
// tints are not misread as colorful), and the opaque coverage. No extra
// canvas, no extra decode: the contrast decision reuses one read.
// Transparent pixels are skipped; a fully transparent icon yields cover 0.
//
// Why extreme-tone FRACTIONS instead of mean luminance (the earlier
// pre-release 4.0.5-cycle approach):
// a mean is fooled by plate-style icons — x.com's white-X-on-black-plate
// averages to "very dark" (0.14), so a mean rule flips it on a dark theme
// and turns the elegant self-inverting design (black plate vanishes, white
// X remains) into a glaring white plate. The fractions see the design
// directly: predominantly dark pixels PLUS a meaningful light minority =
// the icon already handles dark backgrounds, leave it alone. Thresholds and
// the flip filter were tuned against a 14-real-favicon matrix (thepaper,
// github, x, netflix, youtube, yabook, ccav1, spotify, zhihu,
// stackoverflow, docker, bilibili, devconsole, …) rendered on all four
// theme backgrounds — see tmp/favicon-lab for the harness. 4.1.0 retuned
// the dark branch against a 60-icon matrix (tmp/favicon-lab/icons2 —
// netflix/youtube/figma/tiktok/x/bilibili/zhihu + 45 more common sites):
// a colored guard (0.10) now stops dark-but-vivid marks from being
// hue-wrecked by the flip; sheet-2.py renders the visual comparison.
export const contrastStats = data => {
    let dark = 0, light = 0, colored = 0, cover = 0;
    const total = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] / 255 < 0.5)
            continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum < 77)
            dark++;
        else if (lum > 179)
            light++;
        // A pixel counts as colored when it carries enough chroma — the
        // hue-preserving flip (invert + hue-rotate) is only faithful for
        // near-monochrome marks, so a colorful logo must be shielded.
        if ((Math.max(r, g, b) - Math.min(r, g, b)) > 38)
            colored++;
        cover++;
    }
    if (!cover)
        return { dark: 0, light: 0, colored: 0, cover: 0 };
    return { dark: dark / cover, light: light / cover, colored: colored / cover, cover: cover / total };
};

// Flip decision. Dark background: flip only a PREDOMINANTLY dark, NEAR-
// MONOCHROME mark with essentially no light pixels (thepaper/github —
// dark glyphs on transparency). A dark plate carrying a real light glyph
// (x.com: light ≈ 0.10) already reads correctly and stays. And since
// 4.1.0 the dark branch ALSO refuses to flip dark-but-COLORFUL marks
// (netflix's dark-red N, the old youtube .ico's red plate): the
// invert+hue-rotate filter halves their chroma (measured netflix red
// 190→90 — a washed pastel users reported as a "weird filter"), while
// the saturated original reads fine on dark by chroma contrast alone.
// The dark guard (0.10) is deliberately stricter than the light one
// (0.30): wrongly flipping a colorful mark is a glaring visible defect,
// wrongly not flipping a dark mark is merely a dim icon.
// Light background mirrors it: a light plate with a dark glyph (a white
// card with black text) is perfectly readable as-is, so the flip needs
// light > 0.60 with dark < 0.15 AND the mark near-monochrome
// (colored < 0.30). devconsole's white-card-with-chrome-color-block icon
// (colored ≈ 0.42) is perfectly legible on white — inverting it would
// turn the white card black and shift every hue, wrecking the brand
// mark. yabook's pure-white glyph (colored 0) still flips. Mid-tone and
// two-tone icons fall between the guards and are never flipped — a
// lightness flip (L→1−L) buys them no contrast either way. (`?? 0`
// keeps callers that hand a stats object without the colored field
// working — treated as monochrome.)
export const needsContrast = (stats, darkBg) => {
    if (!stats || !stats.cover)
        return false;
    if (darkBg)
        return stats.dark > 0.55 && stats.light < 0.05 && (stats.colored ?? 0) < 0.10;
    return stats.light > 0.60 && stats.dark < 0.15 && (stats.colored ?? 0) < 0.30;
};

export function initFaviconFallback(doc = document, ctx = {}) {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL)
        return null;
    if (typeof Image !== 'function' || !doc || !doc.addEventListener)
        return null;

    // 4.0.5 favicon contrast service: themeIsDark / contrastEnabled are getters
    // read at DECISION time (not snapshotted at init), so a live palette theme
    // switch or an options-page toggle takes effect without a restart. Defaults
    // keep the service inert when no context is provided (unit tests, or any
    // page that doesn't opt in).
    const themeIsDark = ctx.themeIsDark || (() => false);
    const contrastEnabled = ctx.contrastEnabled || (() => false);
    // 4.0.6 favicon enrichment hook: when a placeholder is identified, ask the
    // enricher first — it may inject a real icon (returns true) or enqueue the
    // host for async fetching (returns false → fall through to the default SVG).
    const onPlaceholder = typeof ctx.onPlaceholder === 'function' ? ctx.onPlaceholder : null;

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
    const statsBySrc = new Map(); // src → { dark, light, colored, cover } of a real icon

    // The default-icon SVG markup is parsed ONCE and cloned per swap — a
    // list re-render swaps the placeholder img of every placeholder row
    // (measured ~40 ms of innerHTML parsing per 1371-row refresh when each
    // swap re-parsed the same markup).
    let defaultIconTemplate = null;
    const swapForDefaultIcon = img => {
        if (!defaultIconTemplate) {
            const host = doc.createElement('span');
            host.innerHTML = DEFAULT_BOOKMARK_ICON;
            defaultIconTemplate = host.firstChild;
            if (!defaultIconTemplate)
                return;
        }
        const svg = defaultIconTemplate.cloneNode(true);
        if (img.parentNode)
            img.parentNode.replaceChild(svg, img);
    };

    // Toggle the invert class from the cached stats for this src. The class
    // sits on the <img>; CSS (neat.css .favicon-contrast-invert) applies the
    // filter. Guarded so stubbed imgs without classList never throw. A
    // disabled service SWEEPS the class instead of bailing out: the options
    // toggle can flip off after icons were already inverted, and the stale
    // class must not outlive the setting.
    const applyContrast = img => {
        if (!img || !img.classList)
            return;
        if (!contrastEnabled()) {
            img.classList.remove('favicon-contrast-invert');
            return;
        }
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
            // The enricher may have a cached real icon for this host (it
            // hot-swaps immediately and returns true); otherwise fall back to
            // the default SVG as before.
            if (!onPlaceholder || !onPlaceholder(img))
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
                if (!onPlaceholder || !onPlaceholder(img))
                    swapForDefaultIcon(img);
            } else {
                // Real favicon: cache its stats and decide contrast once.
                statsBySrc.set(src, fp || { dark: 0, light: 0, colored: 0, cover: 0 });
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
        doc.querySelectorAll('img[src*="/_favicon/"], img.favicon-enriched').forEach(applyContrast);
    };
    // The body[data-theme] mutation covers explicit palette switches. The
    // guard installs the observer only when MutationObserver exists AND a
    // body node is present (the observer is a property of the instance, not
    // of doc.body — the old `typeof doc.body.observe === 'function'` check
    // was always false, so no observer was ever created).
    let themeObserver = null;
    if (typeof MutationObserver === 'function' && doc.body) {
        themeObserver = new MutationObserver(ms => {
            if (ms.some(m => m.attributeName === 'data-theme'))
                reapplyContrast();
        });
        themeObserver.observe(doc.body, { attributes: true, attributeFilter: ['data-theme'] });
    }

    // Under the auto theme an OS-level light/dark flip resolves through the
    // prefers-color-scheme media query without ever touching
    // body[data-theme], so the observer above can't see it and a resident
    // side panel would keep the stale invert state. Re-decide from the same
    // cached stats on every scheme change. Subscribing unconditionally is
    // harmless on explicit themes: the background token didn't change, so
    // the re-decision is a no-op. The query is resolved through
    // doc.defaultView when available (injectable in tests); a global
    // matchMedia is the fallback.
    let schemeMedia = null;
    let themeMedia = null;
    const media = (doc.defaultView && typeof doc.defaultView.matchMedia === 'function')
        ? doc.defaultView.matchMedia('(prefers-color-scheme: dark)')
        : (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);
    if (media && typeof media.addEventListener === 'function') {
        themeMedia = () => reapplyContrast();
        schemeMedia = media;
        media.addEventListener('change', themeMedia);
    }

    return { verdicts, handle, statsBySrc, applyContrast, reapplyContrast,
        sampleIcon: fingerprint,   // img → {w,h,hash,dark,light,colored,cover} | null
        themeObserver, schemeMedia, themeMedia };
}
