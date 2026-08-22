// vBookmarks 4.0.8 diagnostic probe — paste the WHOLE block into the popup's
// DevTools console (right-click inside the popup → 检查/Inspect). Logs are
// tagged [VBM]; copy the console output back to the reporter.
//
// Covers the two reported issues:
//   A. dead-view tab badge missing at popup open (tree active) — paste the
//      probe IMMEDIATELY after opening the popup in the tree view (before
//      visiting the dead view); the first [VBM] BADGES line captures it.
//   B. dupes view slightly widening the popup window — run __vbmWidthSweep()
//      once (it clicks through every view and logs window.innerWidth +
//      the exact horizontal-overflow offenders per view), then __vbmWidthDelta()
//      for a quick tree↔dupes back-and-forth.
(() => {
    if (window.__vbmProbeInstalled) return console.log('[VBM] probe already installed');
    window.__vbmProbeInstalled = true;
    const t0 = performance.now();
    const rec = (tag, data) => {
        console.log(`[VBM] ${((performance.now() - t0) / 1000).toFixed(2)}s ${tag} ${JSON.stringify(data)}`);
    };
    const $ = id => document.getElementById(id);
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const sleepFrames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // --- A. badge states + storage facts (issue 1) ---------------------------
    const badgeStates = () => Array.from(document.querySelectorAll('.view-tab')).map(t => {
        const b = t.querySelector('.tab-badge');
        return { tab: t.id.replace('view-tab-', ''), hidden: b ? b.hidden : null, text: b ? b.textContent : null };
    });
    const dumpBadges = async () => {
        const local = await new Promise(r => chrome.storage.local.get(null, r));
        const deadLastScan = (() => {
            try {
                const s = JSON.parse(local.deadLastScan || '{}');
                return { has: !!local.deadLastScan, ts: s.ts || null, results: Object.keys(s.results || {}).length };
            } catch (e) { return { has: !!local.deadLastScan, parseError: true }; }
        })();
        const dupesLast = (() => {
            try {
                const d = JSON.parse(local.dupesLastResult || '{}');
                return { has: !!local.dupesLastResult, groups: (d.groups || []).length };
            } catch (e) { return { has: !!local.dupesLastResult, parseError: true }; }
        })();
        rec('BADGES', {
            active: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id || '',
            badges: badgeStates(),
            showTabBadges: window.store ? store.get('showTabBadges', '1') : '?',
            deadLastScan, dupesLast,
            deadMarks: (local.deadMarks || '').length,
            visitStatsKeys: (() => { try { return Object.keys(JSON.parse(local.visitStats || '{}')).length; } catch (e) { return -1; } })(),
            uiLang: chrome.i18n.getUILanguage(),
            ua: navigator.userAgent
        });
    };

    // --- B. per-view geometry (issue 2) ---------------------------------------
    const geo = () => {
        const el = x => {
            if (!x) return null;
            const r = x.getBoundingClientRect();
            return {
                sw: x.scrollWidth, cw: x.clientWidth,
                left: +r.left.toFixed(2), right: +r.right.toFixed(2), w: +r.width.toFixed(2)
            };
        };
        return {
            innerW: window.innerWidth, outerW: window.outerWidth,
            dpr: window.devicePixelRatio, screenX: window.screenX,
            availW: screen.availWidth, screenW: screen.width,
            root: el(document.documentElement),
            body: el(document.body),
            bodyStyleW: document.body.style.width, rootStyleW: document.documentElement.style.width,
            container: el($('container')),
            tabs: el($('view-tabs')),
            views: el($('views')),
            active: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id || '',
            badges: badgeStates()
        };
    };
    // Elements whose box reaches BEYOND the body width (the popup window
    // follows content, so these are what widen it). Excludes the parked
    // off-screen menus/drag overlays. Unrounded: the dupes delta is ~1.3px.
    const escapers = () => {
        const bodyW = document.body.offsetWidth;
        const out = [];
        for (const el of document.querySelectorAll('*')) {
            if (el.nodeType !== 1) continue;
            if (el.tagName === 'MENU' || el.closest('menu') || el.id === 'drop-overlay' || el.id === 'bookmark-clone'
                || el.id === 'command-palette' || el.id === 'cover' || el.classList.contains('visually-hidden')) continue;
            if (el.hidden || getComputedStyle(el).display === 'none') continue;
            const r = el.getBoundingClientRect();
            const over = r.right - bodyW;
            const under = -r.left;
            if (over > 0.4 || under > 0.4) {
                const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
                out.push({
                    tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(cls).slice(0, 40),
                    right: +r.right.toFixed(2), left: +r.left.toFixed(2),
                    over: +over.toFixed(2), under: +under.toFixed(2),
                    sw: el.scrollWidth, cw: el.clientWidth,
                    text: (el.textContent || '').trim().slice(0, 25)
                });
            }
        }
        out.sort((a, b) => Math.max(b.over, b.under) - Math.max(a.over, a.under));
        return out.slice(0, 15);
    };
    const measure = async label => {
        await sleepFrames();
        await wait(250); // let the fade + Chrome's async window resize settle
        const g = geo();
        // The ACTIVE view's list + toolbars — a sub-pixel in-list overflow
        // (the dupes delta is ~1.3px) shows up here even though the list
        // clips it visually.
        const activeList = document.querySelector('.view:not([hidden]) [id$="-list"], .view:not([hidden]) [id$="-area"], .view:not([hidden]) #tree, .view:not([hidden]) #results');
        const listInfo = activeList ? (() => {
            const r = activeList.getBoundingClientRect();
            return {
                id: activeList.id, sw: activeList.scrollWidth, cw: activeList.clientWidth,
                right: +r.right.toFixed(2)
            };
        })() : null;
        const toolbars = Array.from(document.querySelectorAll('.view:not([hidden]) .vbm-toolbar, .view:not([hidden]) .dupes-toolbar, .view:not([hidden]) .dead-toolbar'))
            .slice(0, 4).map(t => {
                const r = t.getBoundingClientRect();
                return { cls: String(t.className).slice(0, 45), sw: t.scrollWidth, cw: t.clientWidth, right: +r.right.toFixed(2) };
            });
        rec(label, {
            innerW: g.innerW, outerW: g.outerW, dpr: g.dpr,
            rootW: g.root && g.root.cw, rootScrollW: g.root && g.root.sw,
            bodyW: g.body && g.body.cw, bodyScrollW: g.body && g.body.sw,
            bodyStyleW: g.bodyStyleW, rootStyleW: g.rootStyleW,
            tabsCw: g.tabs && g.tabs.cw, tabsSw: g.tabs && g.tabs.sw,
            activeList: listInfo, toolbars,
            escapers: escapers(),
            active: g.active, badges: g.badges
        });
        await wait(250);
        const g2 = geo(); // second sample — Chrome's window resize can lag a frame
        rec(label + '#2', {
            innerW: g2.innerW, rootScrollW: g2.root && g2.root.sw,
            bodyW: g2.body && g2.body.cw, bodyScrollW: g2.body && g2.body.sw
        });
    };
    window.__vbmWidthSweep = async () => {
        await dumpBadges();
        for (const v of ['tree', 'stats', 'dead', 'dupes', 'recent', 'search', 'tree']) {
            const tab = $(`view-tab-${v}`);
            if (!tab) { rec('SWEEP', { error: `no tab ${v}` }); continue; }
            tab.click();
            await measure(`VIEW ${v}`);
        }
        console.log('[VBM] sweep done — copy the [VBM] lines above and report back');
    };
    window.__vbmWidthDelta = async () => {
        for (let i = 0; i < 3; i++) {
            $('view-tab-tree').click();
            await wait(400);
            const a = geo();
            $('view-tab-dupes').click();
            await wait(400);
            const b = geo();
            rec('DELTA', { tree: a.innerW, dupes: b.innerW, delta: +(b.innerW - a.innerW).toFixed(2) });
        }
    };
    window.__vbmDumpBadges = dumpBadges;

    // Immediately capture the open state (issue 1) and the stored size facts.
    dumpBadges().then(() => console.log(
        '[VBM] probe installed — for issue 2 run __vbmWidthSweep() (then __vbmWidthDelta()); ' +
        'for issue 1 keep this first [VBM] BADGES line, then visit the dead view and run __vbmDumpBadges() again'));
})();
