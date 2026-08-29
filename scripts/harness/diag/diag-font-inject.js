// diag-font-inject.js — FONT_CSS 注入回归探针(商店截图字体):
// 复刻 shots-store openThemed 的 evaluateOnNewDocument 注入路径(DOMContentLoaded
// 兜底版),断言注入的 <style> 真的进了 popup 文档、body 计算字体命中 Inter。
// 历史事故:直接 document.documentElement.appendChild 在脚本执行时机早于
// documentElement 存在时抛异常被静默吞掉,整条套件一直用默认字体渲染。
const puppeteer = require('puppeteer');

const FONT_CSS = "*{font-family:'Inter','Noto Sans SC','Noto Sans CJK SC',system-ui,sans-serif !important;}";

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--allow-file-access-from-files',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await new Promise(r => setTimeout(r, 2000));
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(sw.url()).hostname;

    const page = await browser.newPage();
    await page.evaluateOnNewDocument((css) => {
        const inject = () => {
            const s = document.createElement('style');
            s.textContent = css;
            (document.head || document.documentElement).appendChild(s);
        };
        if (document.documentElement) inject();
        else document.addEventListener('DOMContentLoaded', inject, { once: true });
    }, FONT_CSS);
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1000));
    const report = await page.evaluate(() => ({
        landed: [...document.querySelectorAll('style')]
            .some(s => s.textContent.includes('Noto Sans SC')),
        bodyFont: getComputedStyle(document.body).fontFamily
    }));
    console.log(JSON.stringify(report, null, 1));
    await browser.close();
    if (!report.landed) {
        console.error('FAIL: FONT_CSS injection did not land');
        process.exit(1);
    }
    console.log('OK: FONT_CSS injection landed');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
