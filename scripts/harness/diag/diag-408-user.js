// Diagnostic (4.0.8 user-data repro): reproduces the two reported issues with
// the user's real profile data.
//   1. dead-view tab badge hidden at popup open (tree active) until the dead
//      view is visited once;
//   2. the dupes view slightly widening the popup (content wider than the
//      pinned popupWidth).
// Seeds /work/settings-user.json (settings export, favicon cache skipped) and
// /work/favorites-user.html (Netscape bookmark export) into a fresh profile,
// then measures the tab badges + document scroll width per view and audits
// which elements overflow the pinned popup width.
//
// Run via tmp/run-diag-408.sh (builds the harness image, docker cp's the seed
// files into the container, executes this script and copies the captures).
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync('/tmp/shots/diag-408', { recursive: true });

const SETTINGS_PATH = '/work/settings-user.json';
const FAV_PATH = '/work/favorites-user.html';
if (!fs.existsSync(SETTINGS_PATH) || !fs.existsSync(FAV_PATH)) {
    console.error('seed files missing — docker cp settings.json + favorites.html into /work/ first');
    process.exit(2);
}
const SETTINGS = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
const FAV_HTML = fs.readFileSync(FAV_PATH, 'utf8');

// --- Netscape bookmark HTML → flat list with folder path stack -------------
const decodeEntities = s => s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const stripTags = s => s.replace(/<[^>]*>/g, '');

function parseNetscape(html) {
    const out = [];           // { type:'folder'|'url', title, url, depth }
    const stack = [];         // folder titles per depth
    let depth = 0;
    const re = /<DT><H3(?:\s[^>]*)?>([\s\S]*?)<\/H3>|<DT><A\s+HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<(\/DL)>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1] !== undefined) {
            const title = decodeEntities(stripTags(m[1])).trim();
            out.push({ type: 'folder', title: title || '(empty)', depth });
            stack[depth] = title;
            depth++;
        } else if (m[2] !== undefined) {
            out.push({
                type: 'url',
                url: m[2],
                title: decodeEntities(stripTags(m[3])).trim(),
                depth
            });
        } else { // </DL>
            depth = Math.max(0, depth - 1);
        }
    }
    return out;
}
const items = parseNetscape(FAV_HTML);
console.log('parsed', items.length, 'entries;',
    items.filter(i => i.type === 'url').length, 'urls;',
    items.filter(i => i.type === 'folder').length, 'folders');

// --- id remap helpers for settings keys that reference bookmark ids --------
const remapDeadLastScan = (raw, idMap) => {
    try {
        const scan = JSON.parse(raw || '{}');
        if (!scan.results) return raw;
        const results = {};
        const entries = Object.entries(scan.results);
        const n = Math.min(entries.length, idMap.oldToNew.length);
        for (let i = 0; i < n; i++)
            results[idMap.oldToNew[i]] = entries[i][1];
        scan.results = results;
        return JSON.stringify(scan);
    } catch (_) { return raw; }
};
const remapIdList = (raw, idMap) => {
    try {
        const arr = JSON.parse(raw || '[]');
        const out = [];
        for (const id of arr)
            if (idMap.map[id]) out.push(idMap.map[id]);
        return JSON.stringify(out);
    } catch (_) { return raw; }
};
const remapIdTimeMap = (raw, idMap) => {
    try {
        const obj = JSON.parse(raw || '{}');
        const out = {};
        for (const [id, t] of Object.entries(obj))
            if (idMap.map[id]) out[idMap.map[id]] = t;
        return JSON.stringify(out);
    } catch (_) { return raw; }
};
const remapVisitStats = (raw, idMap) => {
    try {
        const obj = JSON.parse(raw || '{}');
        const out = {};
        for (const [id, v] of Object.entries(obj))
            if (idMap.map[id]) out[idMap.map[id]] = v;
        return JSON.stringify(out);
    } catch (_) { return raw; }
};

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--lang=zh-CN',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });
    const errors = [];
    const page = await browser.newPage();
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    // The pinned popup width comes from the seeded popupWidth setting (513) —
    // the viewport MUST match it (verify-scrollbars' contract): a wider tab
    // viewport masks the horizontal overflow that drives the real popup's
    // content-based window sizing.
    await page.setViewport({ width: 513, height: 640 });

    await sleep(2000);
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    if (!swTarget) throw new Error('extension service worker not found');
    const extId = new URL(swTarget.url()).hostname;
    console.log('extension id:', extId);
    await page.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(800);

    // --- seed bookmarks (folder stack mirrors the export's DFS order) -------
    const created = await page.evaluate(async entries => {
        const make = (parentId, obj) => new Promise((resolve, reject) => {
            chrome.bookmarks.create({ ...obj, parentId }, r => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(r.id);
            });
        });
        const stack = ['1'];  // id stack: root folders → current folder id
        const createdIds = [];
        const CHUNK = 40;
        const pending = [];   // [fn] creation thunks
        const flush = async () => {
            for (let i = 0; i < pending.length; i += CHUNK) {
                const batch = pending.slice(i, i + CHUNK);
                await Promise.all(batch.map(fn => fn()));
            }
            pending.length = 0;
        };
        for (const e of entries) {
            if (e.type === 'folder') {
                const parentId = stack[e.depth];
                pending.push(async () => {
                    const id = await make(parentId, { title: e.title });
                    stack[e.depth + 1] = id;
                });
            } else {
                const parentId = stack[e.depth];
                pending.push(async () => {
                    const id = await make(parentId, { title: e.title || e.url, url: e.url });
                    createdIds.push(id);
                });
            }
            if (pending.length >= CHUNK) await flush();
        }
        await flush();
        return createdIds;
    }, items);
    console.log('created', created.length, 'bookmarks');
    if (errors.length) console.log('seeding errors:', errors.slice(0, 5));

    // --- build old-id → new-id map (verdict order × created order) ----------
    const oldIds = Object.keys(JSON.parse(SETTINGS.local.deadLastScan || '{}').results || {});
    const idMap = { map: {}, oldToNew: [] };
    for (let i = 0; i < oldIds.length && i < created.length; i++) {
        idMap.map[oldIds[i]] = created[i];
        idMap.oldToNew.push(created[i]);
    }
    console.log('remapped', idMap.oldToNew.length, 'of', oldIds.length, 'scan verdict ids');

    // --- seed storage ---------------------------------------------------------
    const localSeed = {};
    for (const [k, v] of Object.entries(SETTINGS.local || {})) {
        if (k.startsWith('vbmFavicon') || k.startsWith('vbmAnnounce')) continue;
        localSeed[k] = v;
    }
    localSeed.deadLastScan = remapDeadLastScan(SETTINGS.local.deadLastScan, idMap);
    localSeed.deadMarks = remapIdList(SETTINGS.local.deadMarks, idMap);
    localSeed.deadMarkTimes = remapIdTimeMap(SETTINGS.local.deadMarkTimes, idMap);
    localSeed.visitStats = remapVisitStats(SETTINGS.local.visitStats, idMap);
    localSeed.opens = '[]';
    localSeed.viewState = '{}';
    localSeed.focusSpot = '{}';
    localSeed.activeView = 'tree';
    localSeed.faviconEnrich = '';
    localSeed.faviconEnrichAgg = '';
    const syncSeed = { ...(SETTINGS.sync || {}) };
    syncSeed.faviconEnrich = '';
    syncSeed.faviconEnrichAgg = '';
    syncSeed.deadFilter = 'all';
    syncSeed.deadMarkFilter = '';
    await page.evaluate(([l, s]) => Promise.all([
        new Promise(r => chrome.storage.local.set(l, r)),
        new Promise(r => chrome.storage.sync.set(s, r))
    ]), [localSeed, syncSeed]);
    console.log('storage seeded: local keys', Object.keys(localSeed).length, 'sync keys', Object.keys(syncSeed).length);

    // --- measure helper -------------------------------------------------------
    const audit = () => {
        // Two offender classes:
        //   escapers — the box (or its scrollable overflow) reaches BEYOND the
        //   pinned body width: these are what widens a real popup window;
        //   clipped  — scrollWidth > clientWidth but inside the body box:
        //   normal ellipsis rows (reported as a count only).
        const escapers = [];
        let clipped = 0;
        const bodyW = document.body.offsetWidth;
        for (const el of document.querySelectorAll('*')) {
            if (el.nodeType !== 1) continue;
            const sw = el.scrollWidth, cw = el.clientWidth;
            const rect = el.getBoundingClientRect();
            const overflowR = rect.right - bodyW - 1;
            const overflowL = -rect.left - 1;
            if (overflowR > 0 || overflowL > 0) {
                const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
                escapers.push({
                    tag: el.tagName.toLowerCase(),
                    id: el.id || '',
                    cls: String(cls).slice(0, 60),
                    sw, cw,
                    rectR: Math.round(rect.right), rectL: Math.round(rect.left),
                    overflowR: Math.round(overflowR), overflowL: Math.round(overflowL),
                    text: (el.textContent || '').slice(0, 40),
                    hidden: el.hidden || getComputedStyle(el).display === 'none'
                });
            } else if (sw > cw + 1) {
                clipped++;
            }
        }
        escapers.sort((a, b) => Math.max(b.overflowR, b.overflowL) - Math.max(a.overflowR, a.overflowL));
        return { escapers, clipped };
    };
    const switchTo = async (viewId) => {
        await page.evaluate(id => document.getElementById(`view-tab-${id}`).click(), viewId);
        await sleep(1500);
    };
    // All measurement code must be browser-side — page.evaluate serializes the
    // function, so node closures (like the old `badges` helper) do not exist
    // inside the page. metrics returns the badge states + the scroll widths.
    const metrics = () => page.evaluate(`(() => {
        const badges = Array.from(document.querySelectorAll('.view-tab')).map(t => {
            const b = t.querySelector('.tab-badge');
            return { tab: t.id.replace('view-tab-', ''), badgeHidden: b ? b.hidden : null, badgeText: b ? b.textContent : null };
        });
        return {
            docScrollW: document.documentElement.scrollWidth,
            bodyScrollW: document.body.scrollWidth,
            bodyW: document.body.offsetWidth,
            innerW: window.innerWidth,
            viewportW: document.documentElement.clientWidth,
            badges
        };
    })()`);
    const dump = async (label) => {
        const m = await metrics();
        console.log(`\n=== ${label} ===`);
        console.log('  docScrollW', m.docScrollW, '| bodyScrollW', m.bodyScrollW, '| bodyW', m.bodyW, '| innerW', m.innerW);
        for (const b of m.badges)
            console.log(`  badge[${b.tab}] hidden=${b.badgeHidden} text=${b.badgeText}`);
        return m;
    };

    // --- 1. popup open in tree view (the reported repro) ----------------------
    // The seeded profile boots a 5161-bookmark tree + 435 dupes groups + a
    // 5154-verdict scan cache — the first render is slow under DinD, so the
    // reload gets a long timeout and the dump waits for the startup preloads
    // (stats/dupes badges visible) instead of a fixed sleep.
    await page.reload({ waitUntil: 'load', timeout: 180000 });
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
        const m = await metrics();
        const stats = m.badges.find(b => b.tab === 'stats');
        if (stats && !stats.badgeHidden) break;
        await sleep(1000);
    }
    await dump('open (tree active)');

    // --- 2. visit each view ----------------------------------------------------
    for (const v of ['stats', 'dead', 'dupes', 'recent', 'search', 'tree']) {
        await switchTo(v);
        const m = await dump(`view: ${v}`);
        if (v === 'dupes' || v === 'dead') {
            const a = await page.evaluate(audit);
            const visible = a.escapers.filter(x => !x.hidden);
            console.log(`  overflow audit: ${visible.length} escapers beyond bodyW, ${a.clipped} clipped (ellipsis)`);
            for (const x of visible.slice(0, 40))
                console.log(`   ${x.tag}#${x.id}.${x.cls} sw=${x.sw} cw=${x.cw} rectR=${x.rectR} overflowR=${x.overflowR} overflowL=${x.overflowL} "${x.text}"`);
            await page.screenshot({ path: `/tmp/shots/diag-408/${v}.png` });
        }
    }
    await page.screenshot({ path: '/tmp/shots/diag-408/tree.png' });

    // --- 3. badge-after-dead-visit check --------------------------------------
    await switchTo('tree');
    await dump('back to tree (dead visited once)');

    if (errors.length) console.log('\nPAGE ERRORS:', errors.slice(0, 10));
    await browser.close();
})().catch(e => {
    console.error('DIAG FAIL:', e);
    process.exit(2);
});
