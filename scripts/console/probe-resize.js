// vBookmarks resize probe v3 — paste the WHOLE block into the popup's DevTools
// console (right-click inside the popup → 检查/Inspect). 每次拖拽自动打印一行
// DRAG# 汇总，两种症状一网打尽；修复前(商店版)/修复后(开发版)通用（纯观察）。
//
// 用法（两种情况各测 2–3 次）：
//  A. 症状一「右缘弹开」：切到「去重」视图 → 从最宽(≥600px)加速压缩左缘到底 →
//     松手后等 1 秒（让"填回"发生）。
//  B. 症状二「按钮抖动」：切到「树」视图 → 缓慢+反复拉伸/压缩左缘几轮。
// 测完把所有 [VBM] 行复制反馈即可。对照更有说服力的做法：商店版(修复前)与
// Load unpacked 开发版(修复后)各跑一遍 A/B。
//
// 每行 DRAG# 的读法：
//  bubbleLag  = |指针目标宽 − 视口已达宽| 的最大值 —— 气泡异步追赶的物理滞后，
//               >0 属正常（修复没有也不需要消除它）
//  gap/clip   = 视口−body / body−视口 的最大值 —— 「右侧空白条 / 内容被裁」，
//               修复生效的标志是两者都 ≈0（滞后被钉边吸收，变得不可见）
//  cStrip     = 视口 − 内容元素右缘(搜索栏/当前列表) 的最大值 —— 肉眼空白条
//  btn vsEdge = 右上角按钮到「可见右缘」的距离（sd=抖动幅度，修复后应≈0）
//  btn vsBody = 按钮到 body 右缘的距离（ sanity 值，任何版本都应恒定）
//  tail       = 松手后到一切归位的时间（"再计算填回"的耗时）
(() => {
    if (window.__vbmProbeInstalled)
        return console.log('[VBM] probe already installed (v' + window.__vbmProbeVersion + ')');
    window.__vbmProbeInstalled = true;
    window.__vbmProbeVersion = 3;
    const rx = document.getElementById('resizer-x');
    if (!rx) return console.log('[VBM] #resizer-x not found — 请在 popup 页面的控制台运行');
    const t0 = performance.now();
    const chromeVer = (navigator.userAgent.match(/Chrome\/(\S+)/) || [])[1] || '?';
    console.log('[VBM] probe v3 installed — Chrome/' + chromeVer +
        ' dpr=' + window.devicePixelRatio + ' 起始 inner=' + window.innerWidth +
        ' root=' + document.documentElement.offsetWidth);

    const DRAGS = [];           // closed slices: { line, rows }
    let slice = null;           // open slice
    let closeTimer = null;
    let verbose = false;
    const TAIL_MS = 700;        // post-release sampling window（抓"填回"尾巴）
    const ROW_CAP = 4000;

    const activeList = () =>
        document.querySelector('.view:not([hidden]) [id$="-list"]')
        || document.querySelector('.view:not([hidden]) #tree')
        || document.getElementById('tree');

    const openSlice = e => {
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        if (slice) closeSlice();
        slice = {
            rows: [], upT: 0,
            view: (document.querySelector('.view:not([hidden])') || {}).id || 'tree?',
            downScrX: e.screenX
        };
        console.log('[VBM] DOWN view=' + slice.view + ' inner=' + window.innerWidth +
            ' root=' + document.documentElement.offsetWidth +
            ' body=' + document.body.offsetWidth + ' outer=' + window.outerWidth +
            ' screenX=' + e.screenX);
    };

    const sd = a => a.length < 2 ? 0 : Math.sqrt(
        a.reduce((s, v) => s + (v - a.reduce((x, y) => x + y, 0) / a.length) ** 2, 0) / a.length);

    const closeSlice = () => {
        const s = slice; slice = null;
        if (!s || s.rows.length < 2) return;
        const rows = s.rows;
        let maxFrame = 0, prev = rows[0][0];
        let maxLag = 0, maxGap = 0, gapF = 0, maxClip = 0, clipF = 0, maxStrip = 0;
        const qEdge = [], qBody = [];
        // tail = 松手后"仍在运动"的时长：偏移最后一次发生变化（而非仍>阈值）的
        // 时刻——对恒定的设备像素/边框伪差稳健（headless 有 ±8px 恒差也不误报）
        let lastOffT = 0, prevLag = null, prevGap = null;
        for (let r of rows) {
            const [t, target, root, body, inner, qR, sR, lR] = r;
            maxFrame = Math.max(maxFrame, t - prev); prev = t;
            maxLag = Math.max(maxLag, Math.abs(target - inner));
            const lag = Math.abs(target - inner), gapOff = Math.abs(inner - body);
            if (prevLag !== null && (Math.abs(lag - prevLag) > 0.5 || Math.abs(gapOff - prevGap) > 0.5))
                lastOffT = t;
            prevLag = lag; prevGap = gapOff;
            const gap = inner - body, clip = body - inner;
            if (gap > maxGap) maxGap = gap;
            if (gap > 2) gapF++;
            if (clip > maxClip) maxClip = clip;
            if (clip > 2) clipF++;
            const cR = Math.max(sR, lR); // 内容元素最右缘
            if (cR > 0) maxStrip = Math.max(maxStrip, inner - cR);
            if (qR > 0 && inner > 0) { qEdge.push(inner - qR); qBody.push(body - qR); }
        }
        // max speed: consecutive-target delta over consecutive-time delta
        let maxV = 0;
        for (let i = 1; i < rows.length; i++) {
            const dt = rows[i][0] - rows[i - 1][0];
            if (dt > 0)
                maxV = Math.max(maxV, Math.abs(rows[i][1] - rows[i - 1][1]) * 1000 / dt);
        }
        const a = rows[0][1], b = rows[rows.length - 1][1];
        const dir = b < a - 2 ? 'shrink' : b > a + 2 ? 'grow' : 'mixed';
        const tail = s.upT ? (lastOffT > s.upT ? Math.round(lastOffT - s.upT) : 0) : -1;
        const line = '[VBM] DRAG#' + (DRAGS.length + 1) +
            ' view=' + s.view.replace(/^view-/, '') +
            ' dir=' + dir + ' span=' + Math.round(rows[rows.length - 1][0] - rows[0][0]) + 'ms' +
            ' maxV=' + Math.round(maxV) + 'px/s' +
            ' | bubbleLag≤' + maxLag.toFixed(0) + 'px' +
            ' | strip: gap≤' + maxGap.toFixed(1) + 'px(' + gapF + '帧>2)' +
            ' clip≤' + maxClip.toFixed(1) + 'px(' + clipF + '帧>2)' +
            ' cStrip≤' + maxStrip.toFixed(1) + 'px' +
            ' | btn vsEdge sd=' + sd(qEdge).toFixed(2) +
            '[' + (qEdge.length ? Math.min(...qEdge).toFixed(1) : '-') + '..' +
            (qEdge.length ? Math.max(...qEdge).toFixed(1) : '-') + ']' +
            ' vsBody sd=' + sd(qBody).toFixed(2) +
            ' | frame≤' + maxFrame.toFixed(0) + 'ms' +
            ' tail=' + (tail < 0 ? 'n/a(未松手)' : tail >= TAIL_MS - 60 ? '≥' + TAIL_MS + 'ms' : tail + 'ms');
        console.log(line);
        DRAGS.push({ line, rows });
        if (DRAGS.length > 20) DRAGS.shift();
    };

    const endSlice = why => {
        if (!slice) return;
        slice.upT = performance.now() - t0;
        if (verbose) console.log('[VBM] ' + why);
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => { closeTimer = null; closeSlice(); }, TAIL_MS);
    };

    window.addEventListener('pointerdown', e => {
        if (e.target === rx) openSlice(e);
    }, true);
    ['pointerup', 'pointercancel'].forEach(t =>
        window.addEventListener(t, e => {
            if (slice && slice.upT === 0) endSlice(t.toUpperCase());
        }, true));
    window.addEventListener('blur', () => { if (slice && slice.upT === 0) endSlice('BLUR'); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible' && slice && slice.upT === 0) endSlice('HIDDEN');
    });
    window.addEventListener('pagehide', () => { if (slice) closeSlice(); });

    // — per-frame sampler（仅拖拽期间收帧；含松手后 TAIL_MS 的尾巴）———————
    // Row: [t, target(root style), rootW, bodyW, innerW, qBtnR, searchR, listR]
    (function loop() {
        if (slice && slice.rows.length < ROW_CAP) {
            const doc = document.documentElement;
            const q = document.getElementById('quick-add-btn');
            const sb = document.getElementById('search');
            const li = activeList();
            const R = el => el ? +el.getBoundingClientRect().right.toFixed(1) : -1;
            slice.rows.push([
                +(performance.now() - t0).toFixed(0),
                parseInt(doc.style.width) || 0,
                doc.offsetWidth, document.body.offsetWidth, window.innerWidth,
                R(q), R(sb), R(li)
            ]);
        }
        requestAnimationFrame(loop);
    })();

    window.__vbmAll = () => {
        if (!DRAGS.length && !slice) return console.log('[VBM] 还没有已完成的拖拽');
        console.log(DRAGS.map(d => d.line).join('\n'));
        return DRAGS.map(d => d.line);
    };
    window.__vbmRows = (n = -1, step = 4) => {
        const d = DRAGS[n === -1 ? DRAGS.length - 1 : n];
        if (!d) return console.log('[VBM] 没有该 DRAG#');
        d.rows.filter((_, i) => i % step === 0).forEach(r =>
            console.log(`[VBM] t=${r[0]} target=${r[1]} root=${r[2]} body=${r[3]} inner=${r[4]}` +
                ` qBtn=${r[5]} search=${r[6]} list=${r[7]}` +
                ` gap=${(r[4] - r[3]).toFixed(1)} lag=${Math.abs(r[1] - r[4]).toFixed(0)}`));
    };
    window.__vbmVerbose = v => { verbose = !!v; console.log('[VBM] verbose=' + verbose); };
    window.__vbmDump = async () => {
        const stored = await chrome.storage.local.get(['popupWidth', 'popupHeight']);
        const info = {
            stored, mirror: window.store && store.get('popupWidth'),
            bodyStyleW: document.body.style.width,
            rootStyleW: document.documentElement.style.width,
            bodyW: document.body.offsetWidth, innerW: window.innerWidth
        };
        console.log('[VBM] DUMP ' + JSON.stringify(info));
        return info;
    };
    console.log('[VBM] 就绪：A)去重视图·从最宽加速压缩到底·松手等1秒  B)树视图·缓慢反复拉伸/压缩 — 每次松手自动打印 DRAG# 汇总；测完复制全部 [VBM] 行反馈（__vbmAll() 重印 / __vbmRows() 逐帧 / __vbmDump() 存储）');
})();
