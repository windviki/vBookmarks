// vBookmarks resize probe — paste the WHOLE block into the popup's DevTools
// console (right-click inside the popup → 检查/Inspect), then drag the left
// edge to reproduce the problem. Logs are tagged [VBM].
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
        rec('DOWN', { ...snap(e), pointerId: e.pointerId, captureAPI: !!rx.setPointerCapture });
    }, true);
    window.addEventListener('pointermove', e => {
        if (!down) return;
        moves++;
        // first 3, then every 10th, plus EVERY event whose target is not the
        // resizer (shows whether capture retargeting is working)
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
    window.__vbmDump = async () => {
        const stored = await chrome.storage.local.get(['popupWidth', 'popupHeight']);
        const info = {
            stored, mirror: window.store && store.get('popupWidth'),
            styleW: document.body.style.width, innerW: window.innerWidth
        };
        console.log('[VBM] DUMP ' + JSON.stringify(info));
        return info;
    };
    console.log('[VBM] probe installed — now: 1) drag left edge to max width, 2) release, 3) try to drag back narrow, 4) run __vbmDump(), 5) close & reopen popup, run the reopen snippet');
})();
