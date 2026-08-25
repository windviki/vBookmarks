// vBookmarks resize probe v2 — paste the WHOLE block into the popup's DevTools
// console (right-click inside the popup → 检查/Inspect), then drag the left
// edge: 1) a fast accelerating compression from wide (去重视图复现"右缘弹开"),
// 2) a slow stretch (树视图复现右上角按钮"抖动"). Logs are tagged [VBM].
//
// v2 adds the per-frame smoothness sampler (the 2026-08 resize-smoothness
// diagnosis): while installed, a rAF loop records, every frame, the pointer
// TARGET (root style width), the root/body boxes and the ACHIEVED viewport
// (innerWidth). The interesting quantity is the divergence between what the
// content is laid out at and what the native bubble has actually painted:
//   gap   = innerWidth − bodyWidth  (>0 → 右缘空白条; the pre-fix symptom)
//   clip  = bodyWidth − innerWidth  (>0 → content clipped at the right edge)
//   btnOff= innerWidth − qBtn.right (should be CONSTANT while pinned; any
//           variance = the buttons oscillating against the visible edge)
// After the fix (chase-pinned body) gap/clip should stay ≈0±2px the whole
// drag and btnOff variance ≈0. __vbmSummary() prints the aggregates to paste
// back; __vbmRows() dumps the raw frames.
(() => {
    if (window.__vbmProbeInstalled) return console.log('[VBM] probe already installed');
    window.__vbmProbeInstalled = true;
    const rx = document.getElementById('resizer-x');
    const t0 = performance.now();
    const rec = (tag, data) => {
        console.log(`[VBM] ${((performance.now() - t0) / 1000).toFixed(2)}s ${tag} ${JSON.stringify(data)}`);
    };
    const snap = e => ({
        screenX: e.screenX, clientX: e.clientX,
        winX: window.screenX, outerW: window.outerWidth, innerW: window.innerWidth,
        bodyW: document.body.offsetWidth, styleW: document.body.style.width,
        target: e.target && (e.target.id || e.target.tagName)
    });
    let down = false, moves = 0;
    window.addEventListener('pointerdown', e => {
        if (e.target !== rx) return;
        down = true; moves = 0;
        window.__s = []; // fresh window per drag
        rec('DOWN', { ...snap(e), pointerId: e.pointerId, captureAPI: !!rx.setPointerCapture });
    }, true);
    window.addEventListener('pointermove', e => {
        if (!down) return;
        moves++;
        if (moves <= 3 || moves % 10 === 0 || e.target !== rx)
            rec('MOVE', { ...snap(e), moves });
    }, true);
    ['pointerup', 'pointercancel'].forEach(t =>
        window.addEventListener(t, e => {
            if (!down) return;
            rec(t.toUpperCase(), { ...snap(e), moves });
            down = false;
        }, true));
    window.addEventListener('blur', () => rec('BLUR', { down, moves }));
    document.addEventListener('visibilitychange', () =>
        rec('VISIBILITY', { state: document.visibilityState, down, moves }));
    window.addEventListener('pagehide', () => rec('PAGEHIDE', { down, moves }));

    // — v2: per-frame smoothness sampler ————————————————————————————————
    // Row: [t, target, rootW, bodyW, innerW, qBtnRight]
    window.__s = [];
    (function loop() {
        const doc = document.documentElement;
        const q = document.getElementById('quick-add-btn');
        window.__s.push([
            +(performance.now() - t0).toFixed(0),
            parseInt(doc.style.width) || 0,
            doc.offsetWidth, document.body.offsetWidth, window.innerWidth,
            q ? +q.getBoundingClientRect().right.toFixed(1) : -1
        ]);
        requestAnimationFrame(loop);
    })();
    const aggregate = rows => {
        let maxGap = 0, gapF = 0, maxClip = 0, clipF = 0, maxFrame = 0, prev = rows[0][0];
        const offs = [];
        for (const r of rows) {
            maxFrame = Math.max(maxFrame, r[0] - prev); prev = r[0];
            const gap = r[4] - r[3], clip = r[3] - r[4];
            if (gap > maxGap) maxGap = gap;
            if (gap > 2) gapF++;
            if (clip > maxClip) maxClip = clip;
            if (clip > 2) clipF++;
            if (r[5] >= 0 && r[4] > 0) offs.push(r[4] - r[5]);
        }
        const sd = a => a.length < 2 ? 0 :
            Math.sqrt(a.reduce((s, v) => s + (v - a.reduce((x, y) => x + y, 0) / a.length) ** 2, 0) / a.length);
        return {
            frames: rows.length,
            maxFrameMs: +maxFrame.toFixed(1),
            maxGapPx: +maxGap.toFixed(1), gapOver2Frames: gapF,
            maxClipPx: +maxClip.toFixed(1), clipOver2Frames: clipF,
            btnOff: offs.length ? {
                min: +Math.min(...offs).toFixed(1), max: +Math.max(...offs).toFixed(1),
                sd: +sd(offs).toFixed(2)
            } : null
        };
    };
    window.__vbmSummary = () => {
        const rows = window.__s || [];
        if (!rows.length) return console.log('[VBM] no frames recorded yet');
        const rest = rows.slice(-30); // last ~0.5s at rest
        const info = aggregate(rows);
        info.restBodyW = rest[rest.length - 1][3];
        info.restInnerW = rest[rest.length - 1][4];
        info.restRootW = rest[rest.length - 1][2];
        console.log('[VBM] SUMMARY ' + JSON.stringify(info));
        return info;
    };
    window.__vbmRows = (step = 5) => {
        (window.__s || []).filter((_, i) => i % step === 0)
            .forEach(r => console.log(`[VBM] t=${r[0]} target=${r[1]} root=${r[2]} body=${r[3]} inner=${r[4]} qBtn=${r[5]} gap=${(r[4] - r[3]).toFixed(1)}`));
    };
    window.__vbmDump = async () => {
        const stored = await chrome.storage.local.get(['popupWidth', 'popupHeight']);
        const info = {
            stored, mirror: window.store && store.get('popupWidth'),
            styleW: document.body.style.width, innerW: window.innerWidth,
            rootStyleW: document.documentElement.style.width
        };
        console.log('[VBM] DUMP ' + JSON.stringify(info));
        return info;
    };
    console.log('[VBM] probe v2 installed — now: 1) 去重视图从最宽加速压缩左缘, 2) 树视图缓慢拉伸左缘, 3) __vbmSummary() (+ __vbmRows() 若需逐帧), 4) __vbmDump(), 5) close & reopen popup, run the reopen snippet');
})();
