// Diagnostic (4.0.8 user-data repro, REAL action popup): seeds the user's
// settings + bookmark tree, opens the genuine action popup via
// chrome.action.openPopup, attaches through CDP and measures the actual
// popup window width across view switches. The real popup sizes itself from
// the document content width (probe3 proved window.innerWidth follows
// documentElement.scrollWidth, not the pinned root width), so a dupes-view
// overflow shows up as a wider window — exactly the reported issue 2.
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SETTINGS_PATH = '/work/settings-user.json';
const FAV_PATH = '/work/favorites-user.html';
const SETTINGS = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
const FAV_HTML = fs.readFileSync(FAV_PATH, 'utf8');

const decodeEntities = s => s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const stripTags = s => s.replace(/<[^>]*>/g, '');
function parseNetscape(html) {
    const out = [];
    let depth = 0;
    const re = /<DT><H3(?:\s[^>]*)?>([\s\S]*?)<\/H3>|<DT><A\s+HREF="([^"]*)"[^>]*>([\s\S]*?)<\/A>|<(\/DL)>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1] !== undefined) {
            out.push({ type: 'folder', title: decodeEntities(stripTags(m[1])).trim() || '(empty)', depth });
            depth++;
        } else if (m[2] !== undefined) {
            out.push({ type: 'url', url: m[2], title: decodeEntities(stripTags(m[3])).trim(), depth });
        } else {
            depth = Math.max(0, depth - 1);
        }
    }
    return out;
}
const items = parseNetscape(FAV_HTML);
console.log('parsed', items.length, 'entries');

const remapScan = (raw, idMap) => {
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
const remapList = (raw, idMap) => {
    try {
        const arr = JSON.parse(raw || '[]');
        return JSON.stringify(arr.map(id => idMap.map[id]).filter(Boolean));
    } catch (_) { return raw; }
};
const remapTimeMap = (raw, idMap) => {
    try {
        const obj = JSON.parse(raw || '{}');
        const out = {};
        for (const [id, t] of Object.entries(obj))
            if (idMap.map[id]) out[idMap.map[id]] = t;
        return JSON.stringify(out);
    } catch (_) { return raw; }
};
const remapStats = (raw, idMap) => {
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
        protocolTimeout: 300000,
        args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--lang=zh-CN',
            '--load-extension=/ext',
            '--disable-extensions-except=/ext'
        ]
    });
    await sleep(2000);
    const swTarget = browser.targets().find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;

    const seedPage = await browser.newPage();
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(800);
    // seed bookmarks (DFS folder stack mirroring the export order)
    const created = await seedPage.evaluate(async entries => {
        const make = (parentId, obj) => new Promise((resolve, reject) => {
            chrome.bookmarks.create({ ...obj, parentId }, r => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(r.id);
            });
        });
        const stack = ['1'];
        const createdIds = [];
        const CHUNK = 40;
        const pending = [];
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
                pending.push(async () => { stack[e.depth + 1] = await make(parentId, { title: e.title }); });
            } else {
                const parentId = stack[e.depth];
                pending.push(async () => {
                    createdIds.push(await make(parentId, { title: e.title || e.url, url: e.url }));
                });
            }
            if (pending.length >= CHUNK) await flush();
        }
        await flush();
        return createdIds;
    }, items);
    console.log('created', created.length, 'bookmarks');

    const oldIds = Object.keys(JSON.parse(SETTINGS.local.deadLastScan || '{}').results || {});
    const idMap = { map: {}, oldToNew: [] };
    for (let i = 0; i < oldIds.length && i < created.length; i++) {
        idMap.map[oldIds[i]] = created[i];
        idMap.oldToNew.push(created[i]);
    }
    console.log('remapped', idMap.oldToNew.length, 'scan ids');

    const localSeed = {};
    for (const [k, v] of Object.entries(SETTINGS.local || {})) {
        if (k.startsWith('vbmFavicon') || k.startsWith('vbmAnnounce')) continue;
        localSeed[k] = v;
    }
    localSeed.deadLastScan = remapScan(SETTINGS.local.deadLastScan, idMap);
    localSeed.deadMarks = remapList(SETTINGS.local.deadMarks, idMap);
    localSeed.deadMarkTimes = remapTimeMap(SETTINGS.local.deadMarkTimes, idMap);
    localSeed.visitStats = remapStats(SETTINGS.local.visitStats, idMap);
    localSeed.opens = '[]';
    localSeed.viewState = '{}';
    localSeed.focusSpot = '{}';
    localSeed.activeView = 'tree';
    localSeed.faviconEnrich = '';
    localSeed.faviconEnrichAgg = '';
    const syncSeed = { ...(SETTINGS.sync || {}), faviconEnrich: '', faviconEnrichAgg: '', deadFilter: 'all', deadMarkFilter: '' };
    await seedPage.evaluate(([l, s]) => Promise.all([
        new Promise(r => chrome.storage.local.set(l, r)),
        new Promise(r => chrome.storage.sync.set(s, r))
    ]), [localSeed, syncSeed]);
    console.log('storage seeded');

    // open the REAL action popup (the seed page stays open as the opener)
    const opened = await seedPage.evaluate(() => new Promise(resolve => {
        chrome.action.openPopup(() => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok'));
    }));
    console.log('openPopup:', opened);
    await sleep(8000); // full user-data first render

    const openerTarget = seedPage.target();
    const candidates = browser.targets().filter(t => t.type() === 'page' && t.url().includes('popup.html'));
    const popupTarget = candidates.find(t => t !== openerTarget);
    if (!popupTarget) throw new Error('action popup target not found');
    const client = await popupTarget.createCDPSession();
    const evalIn = async expr => {
        const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
        return r.result ? r.result.value : JSON.stringify(r);
    };
    const measure = async label => {
        const m = JSON.parse(await evalIn(`JSON.stringify({
            innerW: window.innerWidth,
            outerW: window.outerWidth,
            bodyW: document.body.offsetWidth,
            rootW: document.documentElement.offsetWidth,
            docScrollW: document.documentElement.scrollWidth,
            bodyScrollW: document.body.scrollWidth,
            active: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id || '',
            badges: Array.from(document.querySelectorAll('.view-tab')).map(t => {
                const b = t.querySelector('.tab-badge');
                return t.id.replace('view-tab-', '') + (b && !b.hidden ? '=' + b.textContent : '');
            }).join(' ')
        })`));
        console.log(label, JSON.stringify(m));
        return m;
    };
    const audit = async label => {
        const a = JSON.parse(await evalIn(`JSON.stringify((() => {
            const escapers = [];
            const bodyW = document.body.offsetWidth;
            for (const el of document.querySelectorAll('*')) {
                if (el.nodeType !== 1) continue;
                const rect = el.getBoundingClientRect();
                const overflowR = Math.round(rect.right - bodyW - 1);
                const overflowL = Math.round(-rect.left - 1);
                if (overflowR > 0 || overflowL > 0) {
                    const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
                    escapers.push({
                        tag: el.tagName.toLowerCase(), id: el.id || '', cls: String(cls).slice(0, 50),
                        sw: el.scrollWidth, cw: el.clientWidth,
                        rectR: Math.round(rect.right), overflowR, overflowL,
                        text: (el.textContent || '').slice(0, 30),
                        hidden: el.hidden || getComputedStyle(el).display === 'none'
                    });
                }
            }
            return { escapers };
        })())`));
        const visible = a.escapers.filter(x => !x.hidden);
        console.log(label, `escapers=${visible.length}`);
        for (const x of visible.slice(0, 25))
            console.log('  ', `${x.tag}#${x.id}.${x.cls} sw=${x.sw} cw=${x.cw} rectR=${x.rectR} ovR=${x.overflowR} ovL=${x.overflowL} "${x.text}"`);
    };

    await measure('open (tree)');
    for (const v of ['stats', 'dead', 'dupes', 'recent', 'search', 'tree']) {
        await evalIn(`document.getElementById('view-tab-${v}').click(); true`);
        await sleep(2000);
        await measure(`view: ${v}`);
    }
    await evalIn(`document.getElementById('view-tab-dupes').click(); true`);
    await sleep(2000);
    await audit('dupes escapers');
    await evalIn(`document.getElementById('view-tab-tree').click(); true`);
    await sleep(2000);
    await measure('back to tree');
    await browser.close();
})().catch(e => {
    console.error('DIAG FAIL:', e);
    process.exit(2);
});
