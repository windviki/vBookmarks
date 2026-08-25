// diag-r3-probe.js — 在 Docker 真实 action popup 里实测 scripts/console/probe-resize.js v3：
// 注入探针源码 → 情况A（去重视图·加速压缩）+ 情况B（树视图·匀速拉伸+往返）→
// 取回自动打印的 DRAG# 汇总行，验证探针在两种情况下都能产出有效读数。
// 期望（修复后 headless）：bubbleLag≈8（headless 边框伪差）、btnSd≈0、gap≤8、tail 短。
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SEED_BOOKMARKS = `
(async () => {
    const c = p => new Promise(r => chrome.bookmarks.create(p, r));
    const w = await c({parentId: '1', title: 'Dupes seed'});
    for (let i = 0; i < 12; i++) {
        const url = 'https://example.com/dup/' + i + '/page';
        await c({parentId: w.id, title: 'First copy ' + i, url});
        await c({parentId: w.id, title: 'Second copy ' + i, url});
    }
})()`;

const RUN_DRAG = `
async ({ toW, T, mode = 'linear', pacing = 'timer', settleMs = 200 }) => {
    const rx = document.getElementById('resizer-x');
    const fromW = document.documentElement.offsetWidth;
    const y = Math.max(24, Math.min(window.innerHeight - 24, 200));
    const sx0 = 10000, pid = 9;
    const ev = (type, w) => {
        const sx = sx0 - (w - fromW);
        rx.dispatchEvent(new PointerEvent(type, {
            pointerId: pid, bubbles: true, cancelable: true, composed: true,
            clientX: 10 + (sx - sx0), clientY: y,
            screenX: sx, screenY: 500, buttons: 1, isPrimary: true, pointerType: 'mouse'
        }));
    };
    ev('pointerdown', fromW);
    const t0 = performance.now();
    let last = -1;
    await new Promise(done => {
        const emit = () => {
            const t = Math.min(1, (performance.now() - t0) / T);
            const w = Math.round(fromW + (toW - fromW) * (mode === 'accel' ? t * t : t));
            if (w !== last) { ev('pointermove', w); last = w; }
            if (t >= 1) { ev('pointerup', toW); done(); return true; }
            return false;
        };
        const iv = setInterval(() => { if (emit()) clearInterval(iv); }, 8);
    });
    await new Promise(r => setTimeout(r, settleMs));
    return true;
}`;

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
        const probeSrc = fs.readFileSync('/ext/scripts/console/probe-resize.js', 'utf8');

        const opener = await browser.newPage();
        await opener.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
        await sleep(800);
        await opener.evaluate(`chrome.storage.local.set({popupWidth: 640, popupHeight: 560})`);
        await opener.evaluate(SEED_BOOKMARKS);
        await sleep(300);
        await opener.evaluate(`new Promise(r => chrome.action.openPopup(() => r('ok')))`);
        await sleep(3000);

        const popupTarget = browser.targets().find(t => t.type() === 'page' && t.url().includes('popup.html') && t !== opener.target());
        if (!popupTarget) throw new Error('popup target not found');
        const client = await popupTarget.createCDPSession();
        const evalIn = async expr => {
            const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw new Error('eval fail: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
            return r.result ? r.result.value : undefined;
        };

        await evalIn(`document.getElementById('view-tab-dupes').click(); true`);
        await sleep(1000);
        await evalIn(probeSrc); // install probe v3
        await sleep(300);

        // 情况 A：去重视图 · 加速压缩 640→320（含松手后 1s 尾巴）
        await evalIn(`(${RUN_DRAG})(${JSON.stringify({ toW: 320, T: 1000, mode: 'accel' })})`);
        await sleep(1100);

        // 情况 B：树视图 · 匀速拉伸 320→640，再往返一轮
        await evalIn(`document.getElementById('view-tab-tree').click(); true`);
        await sleep(800);
        await evalIn(`(${RUN_DRAG})(${JSON.stringify({ toW: 640, T: 1500, mode: 'linear' })})`);
        await sleep(1100);
        await evalIn(`(${RUN_DRAG})(${JSON.stringify({ toW: 400, T: 900, mode: 'linear' })})`);
        await sleep(1100);

        const lines = await evalIn(`JSON.stringify(window.__vbmAll ? __vbmAll() : ['probe missing'])`);
        console.log('PROBE OUTPUT:\n' + JSON.parse(lines).join('\n'));
        const dump = await evalIn(`__vbmDump().then ? 'async' : 'n/a'`).catch(() => 'skip');
        console.log('dump check:', dump);
    } catch (e) {
        console.error('DIAG FAIL:', e.message);
        process.exitCode = 2;
    } finally {
        await browser.close().catch(() => {});
    }
})();
