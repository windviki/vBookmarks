// diag-r1-smooth.js — 定量分析 popup 宽度拖拽的“不丝滑”（真实 action popup）。
//
// 用户报告的两个症状：
//  A. 去重视图从很宽加速压缩 → 工具栏到列表的右缘“弹开”一大截空白，再填回；
//  B. 树视图右上角快速收藏/命令面板按钮在伸缩时“抖动”（popup 内绝对位置变化）。
//
// 假设：拖拽期间 resize.js 每个 pointermove 立即写 body+html 宽度，内容即时
// 重排，而原生弹窗 widget（innerWidth）异步追赶 → 两者之间出现随滞后波动的
// 缝隙：压缩时 = 右缘空白条（症状 A），伸缩时按钮到可见右缘的距离随之振荡
// （症状 B）。
//
// 本探针在 Docker 真实 action popup 里：
//  Phase 0  sanity（openPopup 后宽度/视图是否按种子恢复）
//  Phase A1 去重视图 · 加速压缩 640→320（125Hz move，对应用户“加速”）
//  Phase A2 同 A1，但 move 以 rAF 节流（≈60Hz）——模拟“写合并到每帧一次”
//  Phase A3 同 A1，但页面注入 html/body width .1s linear transition —— 模拟平滑追随
//  Phase B  去重视图 · 匀速拉伸 320→640（125Hz）
//  Phase C  树视图 · 拉伸+压缩混合，按钮右缘 vs 可见右缘偏移稳定性（症状 B）
// 每个 Phase 逐帧采样：target(样式宽) / rootW(内容宽) / innerWidth(widget) /
// 按钮右缘 / outerWidth，汇出 gap 峰值、>8px 帧数、回填耗时、帧间隔（jank）。
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED_BOOKMARKS = `
(async () => {
    const c = p => new Promise(r => chrome.bookmarks.create(p, r));
    const w = await c({parentId: '1', title: 'Dupes seed'});
    for (let i = 0; i < 12; i++) {
        const url = 'https://example.com/dup/' + i + '/page';
        await c({parentId: w.id, title: 'First copy ' + i, url});
        await c({parentId: w.id, title: 'Second copy ' + i, url});
        await c({parentId: w.id, title: 'Third copy ' + i, url});
    }
    const t = await c({parentId: '1', title: 'Tree seed'});
    for (let i = 0; i < 30; i++)
        await c({parentId: t.id, title: 'Link ' + i, url: 'https://example.com/t/' + i});
})()`;

// Page-side: install the rAF sampler + LoAF attribution. Row = [t, targetW, rootW, bodyW, innerW, outerW, qBtnR, tBtnR, barR]
const INSTALL_SAMPLER = `
window.__vbmS = { on: true, rows: [] };
window.__diag = { downs: 0, moves: 0, ups: 0, styleWrites: [] };
window.addEventListener('pointerdown', e => {
    if (e.target && e.target.id === 'resizer-x') window.__diag.downs++;
}, true);
window.addEventListener('pointermove', () => { window.__diag.moves++; }, true);
// window-bubble runs AFTER the document-bubble drag handler — confirms writes
window.addEventListener('pointermove', () => {
    window.__diag.styleWrites.push(document.documentElement.style.width);
});
window.addEventListener('pointerup', () => { window.__diag.ups++; }, true);
window.__loaf = [];
try {
    new PerformanceObserver(list => {
        for (const e of list.getEntries())
            window.__loaf.push({
                dur: +e.duration.toFixed(1),
                styleLayout: e.styleAndLayoutStart != null && e.renderStart != null
                    ? +(e.startTime + e.duration - e.styleAndLayoutStart).toFixed(1) : -1,
                scripts: (e.scripts || []).slice(0, 3).map(s =>
                    (s.invokerType || '?') + '/' + (s.invoker || s.entryPoint || '?') + '=' + (+s.duration).toFixed(1))
            });
    }).observe({ type: 'long-animation-frame', buffered: false });
} catch (_) { window.__loaf = ['unsupported']; }
(function loop() {
    if (!window.__vbmS.on) return;
    const doc = document.documentElement;
    const s = doc.style.width || '';
    const q = document.getElementById('quick-add-btn');
    const t = document.getElementById('tool-btn');
    const bar = document.querySelector('#view-dupes:not([hidden]) .dupes-toolbar')
        || document.querySelector('#view-tree:not([hidden]) #search');
    window.__vbmS.rows.push([
        +performance.now().toFixed(1),
        parseInt(s) || 0,
        doc.offsetWidth, document.body.offsetWidth,
        window.innerWidth, window.outerWidth,
        q ? +q.getBoundingClientRect().right.toFixed(1) : -1,
        t ? +t.getBoundingClientRect().right.toFixed(1) : -1,
        bar ? +bar.getBoundingClientRect().right.toFixed(1) : -1
    ]);
    requestAnimationFrame(loop);
})();true`;

// Page-side: scripted synthetic drag on #resizer-x.
//   fromW/toW: width endpoints; T: duration ms; mode: 'accel' | 'linear'
//   pacing: 'timer' (setInterval 8ms ≈ 125Hz) | 'raf' (once per frame ≈ 60Hz)
// LTR: width = bodyWidth@down + (startScreenX - screenX) → screenX = sx0 - (w - fromW)
const RUN_DRAG = `
async ({
    toW, T, mode = 'linear', pacing = 'timer', settleMs = 500
}) => {
    const rx = document.getElementById('resizer-x');
    const fromW = document.documentElement.offsetWidth; // real current width
    const rb = rx.getBoundingClientRect();
    const y = Math.max(24, Math.min(rb.top + 120, window.innerHeight - 24));
    const sx0 = 10000, pid = 7;
    const ev = (type, w) => {
        const sx = sx0 - (w - fromW);
        rx.dispatchEvent(new PointerEvent(type, {
            pointerId: pid, bubbles: true, cancelable: true, composed: true,
            clientX: rb.left + 2 + (sx - sx0), clientY: y,
            screenX: sx, screenY: 500, buttons: 1, isPrimary: true, pointerType: 'mouse'
        }));
    };
    ev('pointerdown', fromW);
    const t0 = performance.now();
    let last = -1;
    await new Promise(done => {
        const emit = () => {
            const t = Math.min(1, (performance.now() - t0) / T);
            const p = mode === 'accel' ? t * t : t;
            const w = Math.round(fromW + (toW - fromW) * p);
            if (w !== last) { ev('pointermove', w); last = w; }
            if (t >= 1) { ev('pointerup', toW); done(); return true; }
            return false;
        };
        if (pacing === 'raf') {
            (function step() { if (!emit()) requestAnimationFrame(step); })();
        } else {
            const iv = setInterval(() => { if (emit()) clearInterval(iv); }, 8);
        }
    });
    await new Promise(r => setTimeout(r, settleMs));
    return true;
}`;

const INJECT_TRANSITION = on => `
(() => {
    let el = document.getElementById('__diag-tr');
    if (${on} && !el) {
        el = document.createElement('style'); el.id = '__diag-tr';
        el.textContent = 'html, body { transition: width .1s linear; }';
        document.head.appendChild(el);
    } else if (!${on} && el) el.remove();
    return true;
})();`;

const summary = (label, rows, dragSpanMs) => {
    // rows: all sampler frames; dragSpanMs = wall time of the drag window to bound analysis
    const n = rows.length;
    if (!n) return { label, error: 'no samples' };
    let maxFrame = 0, prevT = rows[0][0];
    let maxGap = 0, gapFrames = 0, maxClip = 0, clipFrames = 0;
    let maxBodyRoot = 0, hScrollFrames = 0;
    let settleIdx = -1;
    const offQ = [];
    for (let i = 0; i < n; i++) {
        const r = rows[i];
        const dt = r[0] - prevT; prevT = r[0];
        if (dt > maxFrame) maxFrame = dt;
        const gap = r[4] - r[2];              // innerWidth - rootW
        if (gap > maxGap) maxGap = gap;
        if (gap > 8) gapFrames++;
        const clip = r[2] - r[4];             // rootW - innerWidth (expansion clipping)
        if (clip > maxClip) maxClip = clip;
        if (clip > 8) clipFrames++;
        const bodyRoot = r[2] - r[3];         // root - body（<0 = body 铺满更宽的视口, 追逐中）
        if (Math.abs(bodyRoot) > Math.abs(maxBodyRoot)) maxBodyRoot = bodyRoot;
        if (r[6] >= 0 && r[4] > 0) offQ.push(r[4] - r[6]); // innerWidth - qBtn.right
    }
    // settle: last index whose |gap|>1, then time from there to end
    for (let i = n - 1; i >= 0; i--)
        if (Math.abs(rows[i][4] - rows[i][2]) > 1) { settleIdx = i; break; }
    const settleMs = settleIdx >= 0 ? +(rows[n - 1][0] - rows[settleIdx][0]).toFixed(0) : 0;
    const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
    const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) * (v - m)))); };
    return {
        label,
        frames: n,
        spanMs: +(rows[n - 1][0] - rows[0][0]).toFixed(0),
        maxFrameMs: +maxFrame.toFixed(1),
        maxGapPx: +maxGap.toFixed(1),        // 压缩: widget 比内容宽多少（右侧空白条）
        gapOver8Frames: gapFrames,
        maxClipPx: +maxClip.toFixed(1),      // 拉伸: 内容比 widget 宽多少（右侧被裁）
        clipOver8Frames: clipFrames,
        maxRootBodyDivergencePx: +maxBodyRoot.toFixed(1), // root−body（修复后拖拽中应≈−8 量级=铺满视口）
        settleTailMs: settleMs,
        qBtnOffsetFromEdge: {
            mean: +mean(offQ).toFixed(2), sd: +sd(offQ).toFixed(2),
            min: +Math.min(...offQ).toFixed(2), max: +Math.max(...offQ).toFixed(2)
        }
    };
};

const timeline = (rows, step) => rows
    .filter((_, i) => i % step === 0)
    .map(r => `t=${r[0].toFixed(0)} target=${r[1]} root=${r[2]} inner=${r[4]} gap=${(r[4] - r[2]).toFixed(1)} qBtn=${r[6]} bar=${r[8]}`)
    .join('\n');

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new', protocolTimeout: 600000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=zh-CN',
            '--window-size=1600,1200',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    try {
        await sleep(2000);
        const swTarget = browser.targets().find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
        if (!swTarget) throw new Error('sw not found');
        const extId = new URL(swTarget.url()).hostname;

        const opener = await browser.newPage();
        await opener.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await opener.evaluate(`chrome.storage.local.set({popupWidth: 640, popupHeight: 560, donationDismissed: '1'})`);
        await opener.evaluate(SEED_BOOKMARKS);
        await sleep(400);
        await opener.evaluate(`new Promise(r => chrome.action.openPopup(() => r(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok')))`);
        await sleep(3000);

        const openerTarget = opener.target();
        const popupTarget = browser.targets().find(t => t.type() === 'page' && t.url().includes('popup.html') && t !== openerTarget);
        if (!popupTarget) throw new Error('action popup target not found');
        const client = await popupTarget.createCDPSession();
        const evalIn = async expr => {
            const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw new Error('eval fail: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
            return r.result ? r.result.value : undefined;
        };

        // Phase 0 — sanity
        await evalIn(`document.getElementById('view-tab-dupes').click(); true`);
        await sleep(1200);
        const sane = await evalIn(`JSON.stringify({
            innerW: window.innerWidth, rootW: document.documentElement.offsetWidth,
            screenX: window.screenX, availW: screen.availWidth,
            groups: document.querySelectorAll('#dupes-list .dupes-group, #dupes-list li').length,
            barR: (document.querySelector('#view-dupes .dupes-toolbar')||{getBoundingClientRect:()=>({right:-1})}).getBoundingClientRect().right
        })`);
        console.log('Phase0 sanity:', sane);
        if (JSON.parse(sane).innerW < 500) console.log('  NOTE: popup did not open at seeded 640 width');

        await evalIn(INSTALL_SAMPLER);

        const phase = async (label, dragArgs, useTransition, verbose) => {
            await evalIn(`window.__vbmS.rows = []; window.__diag = { downs: 0, moves: 0, ups: 0, styleWrites: [] };
                if (Array.isArray(window.__loaf)) window.__loaf.length = 0; true`);
            await evalIn(INJECT_TRANSITION(!!useTransition));
            if (dragArgs)
                await evalIn(`(${RUN_DRAG})(${JSON.stringify(dragArgs)})`);
            else
                await sleep(900); // idle baseline
            const rows = await evalIn(`window.__vbmS.rows`);
            const diag = await evalIn(`JSON.stringify({
                downs: window.__diag.downs, moves: window.__diag.moves, ups: window.__diag.ups,
                firstW: window.__diag.styleWrites[0] || '(none)', lastW: window.__diag.styleWrites[window.__diag.styleWrites.length - 1] || '(none)',
                writes: window.__diag.styleWrites.length
            })`);
            const loaf = await evalIn(`JSON.stringify(
                (window.__loaf && window.__loaf.slice && window.__loaf.slice().sort((a, b) => (b.dur || 0) - (a.dur || 0)).slice(0, 5)) || [])`);
            const rmin = k => Math.min(...rows.map(r => r[k]));
            const rmax = k => Math.max(...rows.map(r => r[k]));
            console.log('\n== ' + label + ' ==');
            console.log('events ' + diag +
                ` | ranges: target ${rmin(1)}-${rmax(1)} root ${rmin(2)}-${rmax(2)} inner ${rmin(4)}-${rmax(4)}`);
            console.log(JSON.stringify(summary(label, rows)));
            console.log('topLoAF ' + loaf);
            if (verbose || process.env.VBM_DIAG_VERBOSE)
                console.log(timeline(rows, Math.max(1, Math.floor(rows.length / 30))));
            return rows;
        };

        // —— idle 基线（帧预算校准）——
        await phase('IDLE dupes 静置（基线）', null);

        // —— 现状基线（timer=125Hz move，逐事件写宽度）——
        await phase('A1 dupes 加速压缩 640→320 @125Hz（现状）',
            { toW: 320, T: 1000, mode: 'accel', pacing: 'timer' });
        await phase('B1 dupes 匀速拉伸 320→640 @125Hz（现状）',
            { toW: 640, T: 1500, mode: 'linear', pacing: 'timer' });
        // —— 候选①：move 以 rAF 节流（每帧一次写）——
        await phase('A3 dupes 加速压缩 640→320 @rAF（写合并模拟）',
            { toW: 320, T: 1000, mode: 'accel', pacing: 'raf' });
        await phase('B3 dupes 匀速拉伸 320→640 @rAF（写合并模拟）',
            { toW: 640, T: 1500, mode: 'linear', pacing: 'raf' });
        // —— 候选②：html/body width .1s linear transition（内容平滑追随）——
        await phase('A5 dupes 加速压缩 640→320 @125Hz + width transition',
            { toW: 320, T: 1000, mode: 'accel', pacing: 'timer' }, true, true);
        await phase('B5 dupes 匀速拉伸 320→640 @125Hz + width transition',
            { toW: 640, T: 1500, mode: 'linear', pacing: 'timer' }, true, true);
        await evalIn(INJECT_TRANSITION(false));

        // —— 症状 B：树视图按钮抖动（压缩+拉伸，现状）——
        await evalIn(`document.getElementById('view-tab-tree').click(); true`);
        await sleep(900);
        await phase('C1 tree 加速压缩 640→320 @125Hz（现状·按钮抖动）',
            { toW: 320, T: 1000, mode: 'accel', pacing: 'timer' });
        await phase('C2 tree 匀速拉伸 320→640 @125Hz（现状·按钮抖动）',
            { toW: 640, T: 1500, mode: 'linear', pacing: 'timer' });
    } catch (e) {
        console.error('DIAG FAIL:', e.message);
        process.exitCode = 2;
    } finally {
        await browser.close().catch(() => {});
    }
})();
