// Diagnostic (4.0.8 issue 2 root cause): with the user's real data in the
// REAL action popup, find what drives documentElement.scrollWidth beyond the
// pinned popup width, and how that varies per view and per width.
// 1. per-view docScrollW/bodyScrollW at the user's pinned width (513);
// 2. bisect the overflow source in the dupes view (hide #container parts);
// 3. width matrix: resize root+body to w ∈ {320,400,450,513,560,640} and
//    measure docScrollW per view — any view whose content exceeds w is what
//    widens the popup window at that width.
const puppeteer = require('puppeteer');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SETTINGS = JSON.parse(fs.readFileSync('/work/settings-user.json', 'utf8'));
const FAV_HTML = fs.readFileSync('/work/favorites-user.html', 'utf8');
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

(async () => {
    const browser = await puppeteer.launch({
        executablePath: process.env.CHROME_BIN || '/usr/bin/chromium-browser',
        headless: 'new',
        protocolTimeout: 300000,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--lang=zh-CN',
            '--load-extension=/ext', '--disable-extensions-except=/ext']
    });
    await sleep(2000);
    const swTarget = browser.targets().find(t => t.url().startsWith('chrome-extension://') && t.type() === 'service_worker');
    const extId = new URL(swTarget.url()).hostname;

    const seedPage = await browser.newPage();
    await seedPage.goto(`chrome-extension://${extId}/pages/popup.html`, { waitUntil: 'load' });
    await sleep(800);
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
                pending.push(async () => { createdIds.push(await make(parentId, { title: e.title || e.url, url: e.url })); });
            }
            if (pending.length >= CHUNK) await flush();
        }
        await flush();
        return createdIds;
    }, items);
    console.log('created', created.length, 'bookmarks');

    // dupes cache only (no scan/marks remap needed for the width question)
    const localSeed = {};
    for (const [k, v] of Object.entries(SETTINGS.local || {})) {
        if (k.startsWith('vbmFavicon') || k.startsWith('vbmAnnounce') || k === 'deadLastScan'
            || k === 'deadMarks' || k === 'deadMarkTimes' || k === 'visitStats') continue;
        localSeed[k] = v;
    }
    localSeed.activeView = 'tree';
    localSeed.faviconEnrich = '';
    const syncSeed = { ...(SETTINGS.sync || {}), faviconEnrich: '', faviconEnrichAgg: '' };
    await seedPage.evaluate(([l, s]) => Promise.all([
        new Promise(r => chrome.storage.local.set(l, r)),
        new Promise(r => chrome.storage.sync.set(s, r))
    ]), [localSeed, syncSeed]);
    console.log('storage seeded (dupes cache only)');

    await seedPage.evaluate(() => new Promise(resolve => {
        chrome.action.openPopup(() => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok'));
    }));
    await sleep(8000);

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
            innerW: window.innerWidth, bodyW: document.body.offsetWidth,
            rootW: document.documentElement.offsetWidth,
            docScrollW: document.documentElement.scrollWidth,
            bodyScrollW: document.body.scrollWidth,
            tabsScrollW: document.getElementById('view-tabs').scrollWidth,
            tabsClientW: document.getElementById('view-tabs').clientWidth,
            active: (document.querySelector('#view-tabs [aria-selected="true"]') || {}).id || ''
        })`));
        console.log(label, JSON.stringify(m));
        return m;
    };

    await measure('open (tree)');
    for (const v of ['stats', 'dead', 'dupes', 'recent', 'search', 'tree'])
        await evalIn(`document.getElementById('view-tab-${v}').click(); true`), await sleep(1500), await measure(`view: ${v}`);

    // bisect in dupes: find the +overflow source
    await evalIn(`document.getElementById('view-tab-dupes').click(); true`);
    await sleep(1500);
    for (const [label, expr] of [
        ['hide #view-tabs', `document.getElementById('view-tabs').style.display='none'`],
        ['hide #views', `document.getElementById('views').style.display='none'`],
        ['hide #search', `document.getElementById('search').style.display='none'`],
        ['restore all', `document.getElementById('view-tabs').style.display='';document.getElementById('views').style.display='';document.getElementById('search').style.display=''`]
    ]) {
        await evalIn(expr + '; true');
        await sleep(600);
        await measure('bisect: ' + label);
    }

    // width matrix
    for (const w of [320, 400, 450, 513, 560, 640]) {
        await evalIn(`document.body.style.width='${w}px';document.documentElement.style.width='${w}px';true`);
        await sleep(600);
        const row = [];
        for (const v of ['tree', 'stats', 'dead', 'dupes', 'recent']) {
            await evalIn(`document.getElementById('view-tab-${v}').click(); true`);
            await sleep(900);
            const m = JSON.parse(await evalIn(`JSON.stringify({
                docScrollW: document.documentElement.scrollWidth,
                bodyScrollW: document.body.scrollWidth,
                tabsScrollW: document.getElementById('view-tabs').scrollWidth
            })`));
            row.push(`${v}:${m.docScrollW}/${m.bodyScrollW}/tabs${m.tabsScrollW}`);
        }
        console.log(`width ${w} →`, row.join('  '));
    }
    await browser.close();
})().catch(e => {
    console.error('DIAG FAIL:', e);
    process.exit(2);
});
