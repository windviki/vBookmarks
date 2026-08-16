// Header centering + storage-bar height + card row left-edge audit.
const puppeteer = require('puppeteer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const targets = await browser.targets();
    const sw = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(sw.url()).hostname;
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(`chrome-extension://${extId}/pages/options.html`, { waitUntil: 'networkidle0' });
    await sleep(1200);
    const out = await page.evaluate(() => {
        const q = s => document.querySelector(s);
        const R = el => { const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(1), r: +r.right.toFixed(1), t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), cx: +((r.left + r.right) / 2).toFixed(1), cy: +((r.top + r.bottom) / 2).toFixed(1) }; };
        const vpCx = window.innerWidth / 2;

        // Header: where does each piece sit, and the title-block center?
        const icon = R(q('h1 img'));
        const name = R(q('#ext-name'));
        const small = R(q('#small-options'));
        const links = R(q('#header-links'));
        const version = R(q('#options-version'));
        const since = R(q('#header-since'));
        const sinceFont = getComputedStyle(q('#header-since')).fontSize;
        const titleBlockCx = +((icon.l + version.r) / 2).toFixed(1);
        const header = {
            vpCx, icon, name, small, links, version, since,
            sinceFont,
            titleBlockCx,
            sinceOffsetFromTitleBlock: +(since.cx - titleBlockCx).toFixed(1),
            sinceOffsetFromVpCx: +(since.cx - vpCx).toFixed(1)
        };

        // Storage bar geometry.
        const bar = R(q('#storage-usage-bar'));
        const seg = R(q('#usage-icon'));

        // Card row left edges: for a few cards, list each li's first control.
        const cards = {};
        for (const sec of document.querySelectorAll('.options-group')) {
            const h2 = sec.querySelector(':scope > h2');
            if (!h2) continue;
            const id = h2.id;
            if (!['general', 'views-options', 'icons-options', 'sort-options', 'dead-scan-options', 'backup-options', 'stats-options', 'separator-options', 'custom-styles-options', 'context-menu-options', 'tools-options', 'sync-options', 'accessibility-options'].includes(id)) continue;
            const rows = [...sec.querySelectorAll(':scope > .options-list > li')].map(li => {
                const label = li.querySelector(':scope > label');
                const input = label && label.querySelector('input,select');
                const btn = li.querySelector(':scope > button');
                const small = li.querySelector(':scope > small');
                const probe = {};
                if (input) { const i = input.getBoundingClientRect(); probe.control = { tag: input.tagName, l: +i.left.toFixed(1), w: +i.width.toFixed(1) }; }
                if (label && label.firstChild) {
                    // text node left edge (after the hanging-indent text-indent)
                    const ls = label.getBoundingClientRect();
                    probe.labelLeft = +ls.left.toFixed(1);
                }
                if (btn) { const b = btn.getBoundingClientRect(); probe.button = { l: +b.left.toFixed(1), w: +b.width.toFixed(1), text: btn.innerText.slice(0, 18) }; }
                if (small) { const s = small.getBoundingClientRect(); probe.hint = { l: +s.left.toFixed(1) }; }
                return { firstChild: li.firstElementChild && li.firstElementChild.tagName, probe };
            });
            cards[id] = rows;
        }

        // Custom-icon row: the two buttons + the "or" divider + file input.
        const customIcon = (() => {
            const R = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: +r.left.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), cy: +((r.top + r.bottom) / 2).toFixed(1) }; };
            const btn = q('#default-icon-button');
            const or = q('#default-icon-button-or');
            const pick = q('#custom-icon-pick');
            const file = q('#custom-icon-file');
            const fsb = getComputedStyle(q('#custom-icon-file'), '::file-selector-button');
            const wk = getComputedStyle(q('#custom-icon-file'), '::-webkit-file-upload-button');
            // Does options.css's selector actually match? Scan the sheet rules.
            let matchesRule = null;
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        if (rule.selectorText && rule.selectorText.includes('file-selector-button'))
                            matchesRule = { selector: rule.selectorText, padding: rule.style.padding, radius: rule.style.borderRadius, fontSize: rule.style.fontSize };
                    }
                } catch (_) { /* cross-origin sheet */ }
            }
            return {
                button: R(btn), or: R(or), pick: R(pick), file: R(file),
                pickText: pick && pick.innerText,
                pickStyle: pick && { w: +getComputedStyle(pick).width.replace('px',''), h: +getComputedStyle(pick).height.replace('px',''), weight: getComputedStyle(pick).fontWeight, radius: getComputedStyle(pick).borderRadius },
                gapBtnOr: or ? +(or.getBoundingClientRect().left - btn.getBoundingClientRect().right).toFixed(1) : null,
                gapOrPick: or && pick ? +(pick.getBoundingClientRect().left - or.getBoundingClientRect().right).toFixed(1) : null,
                orFont: getComputedStyle(q('#default-icon-button-or')).fontSize,
                fileBtn: { w: +parseFloat(fsb.width).toFixed(1), h: +parseFloat(fsb.height).toFixed(1), weight: fsb.fontWeight, radius: fsb.borderRadius, padding: fsb.padding, fontSize: fsb.fontSize, bg: fsb.backgroundColor },
                webkitFileBtn: { weight: wk.fontWeight, radius: wk.borderRadius, padding: wk.padding, fontSize: wk.fontSize, bg: wk.backgroundColor },
                buttonStyle: { w: +getComputedStyle(btn).width.replace('px',''), h: +getComputedStyle(btn).height.replace('px',''), weight: getComputedStyle(btn).fontWeight, radius: getComputedStyle(btn).borderRadius, padding: getComputedStyle(btn).padding, fontSize: getComputedStyle(btn).fontSize },
                gapBtnOr: or ? +(or.getBoundingClientRect().left - btn.getBoundingClientRect().right).toFixed(1) : null,
                gapOrPick: or && pick ? +(pick.getBoundingClientRect().left - or.getBoundingClientRect().right).toFixed(1) : null,
                container: R(q('#custom-icon-preview').parentElement.querySelector('div:has(> #default-icon-button)')),
                matchesRule
            };
        })();

        // Does this engine apply ::file-selector-button at all? Inject an
        // !important rule on a throwaway clone and measure it.
        const fsbSupport = (() => {
            const probeInput = document.createElement('input');
            probeInput.type = 'file';
            probeInput.id = 'fsb-probe';
            probeInput.style.position = 'fixed';
            probeInput.style.left = '-9999px';
            document.body.appendChild(probeInput);
            const st = document.createElement('style');
            st.id = 'fsb-probe-style';
            st.textContent = '#fsb-probe::file-selector-button{ padding: 9px 13px !important; border-radius: 44px !important; font-weight: 700 !important; }';
            document.head.appendChild(st);
            const cs = getComputedStyle(probeInput, '::file-selector-button');
            const result = { padding: cs.padding, radius: cs.borderRadius, weight: cs.fontWeight };
            st.remove(); probeInput.remove();
            return result;
        })();

        // Dead-scan quota number inputs: left/right edges + widths.
        const quota = ['dead-scan-concurrency', 'dead-scan-timeout', 'sync-refresh-interval', 'zoom-input'].map(id => {
            const el = document.getElementById(id);
            if (!el) return { id, missing: true };
            const r = el.getBoundingClientRect();
            return { id, l: +r.left.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1) };
        });

        // Buttons in every card: left edge + role in the row (first-child? trails a label/input?).
        const allButtons = {};
        for (const sec of document.querySelectorAll('.options-group')) {
            const h2 = sec.querySelector(':scope > h2');
            if (!h2) continue;
            const btns = [...sec.querySelectorAll('.options-list li')].map(li => {
                const btn = li.querySelector(':scope > button');
                if (!btn) return null;
                const r = btn.getBoundingClientRect();
                const prev = btn.previousElementSibling;
                const textBefore = prev && prev.textContent.trim() ? prev.textContent.trim().slice(0, 22) : '';
                const firstChild = btn === li.firstElementChild;
                const labelText = li.querySelector(':scope > label');
                const textEl = labelText ? labelText.textContent.trim().slice(0, 22) : '';
                return { text: btn.innerText.slice(0, 16), l: +r.left.toFixed(1), firstChild, textBefore, labelText, textEl, cy: +((r.top + r.bottom) / 2).toFixed(1) };
            }).filter(Boolean);
            if (btns.length) allButtons[h2.id] = btns;
        }

        return { header, storage: { bar, seg }, customIcon, fsbSupport, quota, allButtons, cards };
    });
    console.log(JSON.stringify(out, null, 2));

    // Live hover behavior on the storage bar (task: confirm hover/move effects).
    const hover = {};
    hover.initialTooltipHidden = await page.$eval('#usage-tooltip', el => el.hidden);
    const barBox = await (await page.$('#storage-usage-bar')).boundingBox();
    // Hover a segment that actually has width (in the clean test profile the
    // icon/bookmarks/other segments are 0-wide and the free segment fills the
    // bar, so target the widest one).
    const segToHover = await page.evaluate(() => {
        const segs = [...document.querySelectorAll('.usage-seg')];
        const widest = segs.reduce((a, b) => b.getBoundingClientRect().width > a.getBoundingClientRect().width ? b : a);
        const r = widest.getBoundingClientRect();
        return { id: widest.id, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(segToHover.x, segToHover.y);
    await sleep(150);
    hover.onHover = await page.evaluate((id) => {
        const q = s => document.querySelector(s);
        const cs = el => getComputedStyle(el);
        const hovered = q('#' + id);
        const siblings = [...document.querySelectorAll('.usage-seg')].filter(s => s.id !== id);
        return {
            hoveredId: id,
            cursor: cs(hovered).cursor,
            hoveredOpacity: cs(hovered).opacity,
            hoveredFilter: cs(hovered).filter,
            siblingOpacities: siblings.map(s => s.id + '=' + cs(s).opacity),
            tooltipHidden: q('#usage-tooltip').hidden,
            tooltipText: q('#usage-tooltip').innerText,
            tooltipAboveBar: (() => {
                const t = q('#usage-tooltip').getBoundingClientRect();
                const b = q('#storage-usage-bar').getBoundingClientRect();
                return t.bottom < b.top;
            })()
        };
    }, segToHover.id);
    await page.mouse.move(barBox.x + barBox.width + 20, barBox.y + barBox.height / 2);
    await sleep(150);
    hover.afterLeaveBar = await page.$eval('#usage-tooltip', el => el.hidden);
    console.log('HOVER ' + JSON.stringify(hover));
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
