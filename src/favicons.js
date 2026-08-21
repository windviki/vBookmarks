/**
 * Favicon gallery page (pages/favicons.html) — the display-only window onto
 * the favicon-enrichment cache. Reached from the options page's "Clear icon
 * cache" row. Shows every host whose icon vBookmarks refetched, where the
 * icon came from (direct / proxy relay / which provider), and the bookmarks
 * living on that host (path, dead mark, sync status, recorded opens).
 *
 * Thin shell: all data shaping is pure in src/favicon-gallery.js; this file
 * only does chrome.* IO, HTML rendering (escaped via src/escape.js) and
 * event wiring. No mutations happen here — display only.
 */
import { FAVICON_DATA_PREFIX, FAVICON_IDX_KEY } from './favicon-enrich.js';
import { buildGallery, filterCards, sourceChips, sourceLabel, fmtBytes } from './favicon-gallery.js';
import { DEFAULT_BOOKMARK_ICON } from './icons.js';
import { htmlspecialchars } from './escape.js';
import { relTimeLabel } from './tree-render.js';

const _m = chrome.i18n.getMessage;
const $ = id => document.getElementById(id);
const esc = htmlspecialchars;

// Apply the theme before first paint (store.js's mirror is synchronously
// pre-filled from the localStorage boot copy), then refine once the real
// storage overlay lands — same recipe as popup.js.
document.body.dataset.theme = store.get('theme', 'auto');
store.ready.then(() => {
    document.body.dataset.theme = store.get('theme', 'auto');
});

let gallery = { cards: [], failed: [], totals: { sites: 0, bookmarks: 0, bytes: 0, byKind: {} } };
const state = { query: '', source: 'all', compare: false };

// --- Data loading ------------------------------------------------------------
const load = async () => {
    let all = {};
    try { all = await chrome.storage.local.get(null); } catch (_) { /* noop */ }
    const dataByHost = {};
    for (const [k, v] of Object.entries(all))
        if (k.startsWith(FAVICON_DATA_PREFIX) && typeof v === 'string')
            dataByHost[k.slice(FAVICON_DATA_PREFIX.length)] = v;
    let tree = [];
    try { tree = await chrome.bookmarks.getTree(); } catch (_) { /* noop */ }
    // The sync engine publishes per-bookmark indicators into session storage;
    // the blob may not exist yet (no SW run) — absence renders no dots.
    let syncStatus = {};
    try {
        const ses = await chrome.storage.session.get('vbmSyncStatus');
        syncStatus = (ses && ses.vbmSyncStatus) || {};
    } catch (_) { /* noop */ }
    gallery = buildGallery({
        idxRaw: all[FAVICON_IDX_KEY],
        dataByHost,
        tree,
        deadMarks: all.deadMarks,
        deadMarkTimes: all.deadMarkTimes,
        syncStatus,
        visitStats: all.visitStats
    });
    render();
};

// --- Rendering ---------------------------------------------------------------
const displayTitle = bm => bm.title || bm.url.replace(/^[a-z]+:\/\//i, '');

const markHtml = bm => {
    let out = '';
    if (bm.dead) {
        const tip = bm.deadTs
            ? `${_m('deadMarkTimeLabel')} ${new Date(bm.deadTs).toLocaleString()}`
            : _m('deadMarkedRow');
        out += `<span class="fav-mark fav-mark-dead" title="${esc(tip)}">⚑</span>`;
    }
    if (bm.sync === 'local')
        out += `<span class="fav-mark fav-mark-sync sync-local" title="${esc(_m('syncStatusLocal'))}"></span>`;
    else if (bm.sync === 'unsyncable')
        out += `<span class="fav-mark fav-mark-sync sync-unsyncable" title="${esc(_m('syncStatusUnsyncable'))}"></span>`;
    if (bm.visits > 0)
        out += `<span class="fav-mark fav-mark-visits" title="${esc(_m('favGalleryVisits', String(bm.visits)))}">×${bm.visits}</span>`;
    return out;
};

const bookmarkRowHtml = (bm, card) => {
    const icon = `<img class="fav-bm-ico fav-ico-after" src="${card.dataUrl}" width="16" height="16" alt="" loading="lazy">`
        + `<span class="fav-bm-ico fav-ico-before" aria-hidden="true">${DEFAULT_BOOKMARK_ICON}</span>`;
    const text = `<span class="fav-bm-text">`
        + `<span class="fav-bm-title">${esc(displayTitle(bm))}</span>`
        + (bm.path ? `<span class="fav-bm-path">${esc(bm.path)}</span>` : '')
        + `</span>`;
    // Only http(s) rows are real links — bookmarklets and other schemes stay
    // inert text on this display page.
    const inner = /^https?:/i.test(bm.url)
        ? `<a class="fav-bm-link" href="${esc(bm.url)}" target="_blank" rel="noreferrer" title="${esc(bm.url)}">${icon}${text}${markHtml(bm)}</a>`
        : `<span class="fav-bm-link fav-bm-inert" title="${esc(bm.url)}">${icon}${text}${markHtml(bm)}</span>`;
    return `<li class="fav-bm">${inner}</li>`;
};

const cardHtml = card => {
    const head = `<header class="fav-card-head">`
        + `<span class="fav-ico-slot">`
        + `<img class="fav-ico fav-ico-after" src="${card.dataUrl}" width="24" height="24" alt="" loading="lazy">`
        + `<span class="fav-ico fav-ico-before" aria-hidden="true">${DEFAULT_BOOKMARK_ICON}</span>`
        + `</span>`
        + `<div class="fav-card-text">`
        + `<h2 class="fav-host" title="${esc(card.host)}">${esc(card.host)}</h2>`
        + `<span class="fav-meta">${esc(relTimeLabel(card.ts, _m))} · ${esc(fmtBytes(card.bytes))}</span>`
        + `</div>`
        + `<span class="fav-src src-${card.kind}">${esc(sourceLabel(card.source, _m))}</span>`
        + `</header>`;
    const body = card.bookmarks.length
        ? `<ul class="fav-bms">${card.bookmarks.map(bm => bookmarkRowHtml(bm, card)).join('')}</ul>`
        : `<p class="fav-orphan">${esc(_m('favGalleryOrphan'))}</p>`;
    return `<article class="fav-card" data-kind="${card.kind}">${head}${body}</article>`;
};

const chipLabel = id => id === 'all' ? _m('favGalleryAll') : sourceLabel(id === 'legacy' ? '' : id, _m);

const renderChips = () => {
    const chips = sourceChips(gallery.cards);
    if (!chips.some(c => c.id === state.source))
        state.source = 'all';
    $('fav-chips').innerHTML = chips.map(c =>
        `<button type="button" class="fav-chip${c.id === state.source ? ' active' : ''}" data-source="${c.id}">`
        + `${esc(chipLabel(c.id))} <span class="fav-chip-count">${c.count}</span></button>`
    ).join('');
};

const render = () => {
    const { totals, failed } = gallery;
    const hasAny = totals.sites > 0;
    $('fav-controls').hidden = !hasAny;
    $('fav-compare').hidden = !hasAny;
    $('fav-stats').textContent = hasAny
        ? `${_m('favGalleryStatSites', String(totals.sites))} · ${_m('favGalleryStatBookmarks', String(totals.bookmarks))} · ${fmtBytes(totals.bytes)}`
        : '';
    $('fav-empty').hidden = hasAny;
    if (!hasAny)
        $('fav-grid').innerHTML = '';
    renderChips();

    const { cards } = filterCards(gallery.cards, state);
    $('fav-grid').innerHTML = cards.map(cardHtml).join('');

    const failedEl = $('fav-failed');
    failedEl.hidden = !failed.length;
    if (failed.length) {
        $('fav-failed-list').innerHTML = failed.map(f =>
            `<li${f.gaveUp ? ' class="gave-up"' : ''}><span class="fav-failed-host">${esc(f.host)}</span>`
            + `<span class="fav-meta">${esc(relTimeLabel(f.ts, _m))}</span>`
            + (f.gaveUp ? `<span class="fav-gaveup">${esc(_m('favGalleryGaveUp'))}</span>` : '')
            + `</li>`
        ).join('');
    }
};

// --- Labels + events -----------------------------------------------------------
const initLabels = () => {
    document.title = _m('favGalleryTitle');
    $('fav-title').textContent = _m('favGalleryTitle');
    $('fav-hint').textContent = _m('favGalleryHint');
    $('fav-filter').placeholder = _m('favGallerySearch');
    $('fav-compare').textContent = _m('favGalleryCompare');
    $('fav-failed-title').textContent = _m('favGalleryFailedTitle');
    $('fav-failed-hint').textContent = _m('favGalleryFailedHint');
    $('fav-empty-title').textContent = _m('favGalleryEmptyTitle');
    $('fav-empty-text').textContent = _m('favGalleryEmptyText');
};

$('fav-filter').addEventListener('input', e => {
    state.query = e.target.value;
    render();
});
$('fav-chips').addEventListener('click', e => {
    const chip = e.target.closest('.fav-chip');
    if (!chip)
        return;
    state.source = chip.dataset.source;
    render();
});
$('fav-compare').addEventListener('click', () => {
    state.compare = !state.compare;
    document.body.classList.toggle('show-before', state.compare);
    $('fav-compare').setAttribute('aria-pressed', String(state.compare));
    $('fav-compare').textContent = _m(state.compare ? 'favGalleryShowingBefore' : 'favGalleryCompare');
});

// Live follow: enrichment writes, dead-mark toggles, visit bumps and bookmark
// edits all re-render (debounced); a theme switch lands without a reload.
let reloadTimer = null;
const scheduleReload = () => {
    if (reloadTimer)
        return;
    reloadTimer = setTimeout(() => {
        reloadTimer = null;
        load();
    }, 300);
};
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes && changes.vbmSyncStatus)
        return scheduleReload();
    if ((area === 'sync' || area === 'local') && changes && 'theme' in changes) {
        const v = changes.theme.newValue;
        document.body.dataset.theme = typeof v === 'string' && v ? v : 'auto';
        return;
    }
    if (area !== 'local' || !changes)
        return;
    for (const key of Object.keys(changes)) {
        if (key.startsWith(FAVICON_DATA_PREFIX) || key === FAVICON_IDX_KEY
            || key === 'deadMarks' || key === 'deadMarkTimes' || key === 'visitStats')
            return scheduleReload();
    }
});
for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved'])
    chrome.bookmarks[ev].addListener(scheduleReload);

initLabels();
load();
