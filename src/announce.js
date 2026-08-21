/**
 * Remote announcement layer (4.1.0 §4 decision, built ahead of schedule for
 * 4.0.8): a static docs/announce.json served from the repo's GitHub master is
 * fetched by the popup/sidepanel and shown as a banner. This replaces the
 * version-gate "what's new" approach — announcements are data, not code, and
 * a release ships by bumping the JSON (Release process, AGENTS.md).
 *
 * Endpoint decision (4.1.0 §4.1): docs/announce.json fetched from
 * raw.githubusercontent.com — zero keys, zero new service deps, content goes
 * through git PR review, transparent to review/audit. connect-src * + <all_urls>
 * already cover the fetch (no manifest change).
 *
 * Client model (4.1.0 §4.3):
 *  - cache `vbmAnnounce = { ts, etag, data }`, TTL 6h — no network within TTL.
 *    Pulls happen only on popup/panel opens, at most once per TTL window
 *    (etag-conditional, so a quiet file is a cheap 304): ≤4 hits/day for an
 *    active user, never a poll loop. Re-pulls are what let a message added to
 *    the JSON LATER still reach long-installed users — the layer is a push
 *    channel, not an install-time one-shot.
 *  - fetch through the shared GitHub chain (direct → user proxy → mirror
 *    candidates, src/github-source.js) with If-None-Match + 4s timeouts;
 *    304 refreshes ts; every failure is silent (offline = no banner)
 *  - targeting: a message declares its audience with ONE of
 *      `version`:  a condition string — exact ("4.0.8") or space/comma-
 *                  separated comparators (">=4.0.0 <4.1.0", "<5", ">4.0.6")
 *      min/maxVersion: the legacy [min, max) range
 *      (neither):  every version — a general push (release news, appeals)
 *    intersected with channel ∩ once+not-dismissed; array order = priority.
 *    A stale-scope message simply matches nothing — never a wrong-audience push.
 *  - schedule: the donation card wins the same frame; the announcement defers
 *  - dismiss: id into `vbmAnnounceSeen` (cap 100, LRU, once semantics)
 *  - privacy switch `announceEnabled` (default on) — off means zero network
 *  - security: fallback text escaped, display enum (banner|dialog|toast),
 *    text ≤ 500 chars, messages array ≤ 10
 *
 * `link` accepts a single { labelKey, url } object (4.1.0 example) or an
 * array of them (4.0.8 needs guide + changelog on one banner).
 *
 * The pure rules (sanitizeAnnounce / parseVersionCondition / versionSatisfies /
 * announceMatch / firstAnnouncement / announceCacheFresh / parseSeen /
 * markAnnounceSeen / announceBannerHtml) are exported for direct testing;
 * initAnnounce does the fetch + render glue.
 */
import { parseVersion, compareVersions } from './version.js';
import { htmlspecialchars } from './escape.js';
import { fetchGithubResource } from './github-source.js';

export const ANNOUNCE_URL = 'https://raw.githubusercontent.com/windviki/vBookmarks/master/docs/announce.json';
export const ANN_CACHE_KEY = 'vbmAnnounce';
export const ANN_SEEN_KEY = 'vbmAnnounceSeen';
export const ANN_TTL_MS = 6 * 60 * 60 * 1000;   // 6h cache
export const ANN_FETCH_TIMEOUT = 4000;          // AbortSignal timeout
export const ANN_MAX_MESSAGES = 10;             // schema cap
export const ANN_TEXT_MAX = 500;                // schema cap
export const ANN_SEEN_MAX = 100;                // LRU cap

const CHANNELS = new Set(['all', 'popup', 'sidepanel']);
const DISPLAYS = new Set(['banner', 'dialog', 'toast']);

// Version-condition DSL (message-level `version` field): a space/comma-
// separated list of comparators, ALL of which must hold — ">=" "<=" ">" "<"
// or a bare/"="/"==" token for an exact match. "4.0.8" targets exactly that
// release; ">=4.0.0 <4.1.0" a half-open range; ">=4.0" everything from 4.0 on.
const COND_TOKEN = /^(>=|<=|>|<|==|=)?v?(\d+(?:\.\d+){0,2})$/;

// Parse a condition string into [{ op, ver }] terms, or null when malformed —
// sanitize drops a message whose condition does not parse, so a typo in the
// JSON can never widen the audience by accident.
export const parseVersionCondition = cond => {
    if (typeof cond !== 'string' || !cond.trim())
        return null;
    const terms = [];
    for (const token of cond.trim().split(/[\s,]+/)) {
        const m = COND_TOKEN.exec(token);
        if (!m)
            return null;
        const ver = parseVersion(m[2]);
        if (!ver)
            return null;
        terms.push({ op: m[1] || '=', ver });
    }
    return terms.length ? terms : null;
};

// Does `version` satisfy the condition string? Garbage on either side → false.
export const versionSatisfies = (version, cond) => {
    const current = parseVersion(version);
    const terms = parseVersionCondition(cond);
    if (!current || !terms)
        return false;
    return terms.every(({ op, ver }) => {
        const c = compareVersions(current, ver);
        switch (op) {
            case '>': return c > 0;
            case '>=': return c >= 0;
            case '<': return c < 0;
            case '<=': return c <= 0;
            default: return c === 0; // '=', '==', bare → exact match
        }
    });
};

// Validate + sanitize a docs/announce.json payload. Invalid messages are
// dropped one by one (a malformed entry never kills the whole banner); the
// payload is rejected outright only when its shape is fundamentally broken.
export const sanitizeAnnounce = raw => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > ANN_MAX_MESSAGES)
        return null;
    const messages = [];
    for (const m of raw.messages) {
        if (!m || typeof m !== 'object')
            continue;
        if (typeof m.id !== 'string' || !m.id)
            continue;
        const versionCond = typeof m.version === 'string' && m.version.trim() ? m.version.trim() : '';
        if (versionCond && !parseVersionCondition(versionCond))
            continue; // a malformed condition would mistarget — drop the message
        const minVersion = typeof m.minVersion === 'string' ? m.minVersion : '';
        const maxVersion = typeof m.maxVersion === 'string' ? m.maxVersion : '';
        if (minVersion && !parseVersion(minVersion))
            continue;
        if (maxVersion && !parseVersion(maxVersion))
            continue;
        if (!CHANNELS.has(m.channel))
            continue;
        if (!DISPLAYS.has(m.display))
            continue; // an unknown display type is dropped, never re-skinned
        const once = typeof m.once === 'boolean' ? m.once : true; // announcements default to once
        const textKey = typeof m.textKey === 'string' && m.textKey ? m.textKey : '';
        let fallback = '';
        if (m.textFallback && typeof m.textFallback === 'object' && typeof m.textFallback.en === 'string')
            fallback = m.textFallback.en.slice(0, ANN_TEXT_MAX);
        if (!textKey && !fallback)
            continue;
        let links = [];
        const rawLinks = Array.isArray(m.link) ? m.link : (m.link ? [m.link] : []);
        for (const l of rawLinks) {
            if (!l || typeof l !== 'object')
                continue;
            if (typeof l.labelKey !== 'string' || typeof l.url !== 'string' || !l.url)
                continue;
            links.push({ labelKey: l.labelKey, url: l.url });
        }
        messages.push({
            id: m.id,
            version: versionCond,
            minVersion,
            maxVersion,
            channel: m.channel,
            display: m.display,
            once,
            kind: typeof m.kind === 'string' ? m.kind : '',
            titleKey: typeof m.titleKey === 'string' ? m.titleKey : '',
            textKey,
            textFallback: fallback ? { en: fallback } : null,
            links
        });
    }
    if (!messages.length)
        return null;
    return { version: typeof raw.version === 'number' ? raw.version : 0, messages };
};

// Does one message apply to this open? Version targeting (a `version`
// condition when present, else the legacy [min, max) range, else every
// version — a general push) ∩ channel ∩ (once messages stay dismissed).
export const announceMatch = (msg, { version, channel, seen }) => {
    if (msg.once && seen.includes(msg.id))
        return false;
    const current = parseVersion(version);
    if (!current)
        return false;
    if (msg.version) {
        if (!versionSatisfies(version, msg.version))
            return false;
    } else {
        if (msg.minVersion) {
            const min = parseVersion(msg.minVersion);
            if (!min || compareVersions(current, min) < 0)
                return false;
        }
        if (msg.maxVersion) {
            const max = parseVersion(msg.maxVersion);
            if (!max || compareVersions(current, max) >= 0)
                return false;
        }
    }
    if (msg.channel !== 'all' && msg.channel !== channel)
        return false;
    return true;
};

// First matching message in array order (array order = priority, 4.1.0 §4.3).
export const firstAnnouncement = (data, ctx) => {
    if (!data || !Array.isArray(data.messages))
        return null;
    for (const msg of data.messages) {
        if (announceMatch(msg, ctx))
            return msg;
    }
    return null;
};

export const announceCacheFresh = (cache, now = Date.now()) =>
    !!cache && !!cache.data && now - (cache.ts || 0) < ANN_TTL_MS;

// The cache may be an object (store) or a JSON string (defensive).
export const readCache = store => {
    const raw = store.get(ANN_CACHE_KEY);
    if (!raw)
        return null;
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch (e) { return null; }
    }
    return raw;
};

export const parseSeen = raw => {
    if (Array.isArray(raw))
        return raw.filter(id => typeof id === 'string');
    if (typeof raw !== 'string')
        return [];
    try {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter(id => typeof id === 'string') : [];
    } catch (e) {
        return [];
    }
};

// Record a dismiss — most-recent-first, capped at 100 (LRU, once semantics).
export const markAnnounceSeen = (store, id) => {
    const seen = parseSeen(store.get(ANN_SEEN_KEY));
    const next = [id, ...seen.filter(x => x !== id)];
    if (next.length > ANN_SEEN_MAX)
        next.length = ANN_SEEN_MAX;
    store.set(ANN_SEEN_KEY, JSON.stringify(next));
};

// Banner HTML (risk-banner-style inline, Tab-ring stop). The leading speaker
// glyph marks the strip as "news" — the visual counterpart of the warm rose
// donation card. Title/text come from i18n keys, text falling back to
// textFallback.en; everything dynamic is escaped (the icon is static markup).
const ANNOUNCE_ICON = '<svg class="announce-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
    '<path d="M9.5 2.8L5.2 5.3H2.8v5.4h2.4l4.3 2.5z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' +
    '<path d="M11.8 5.8a3.4 3.4 0 0 1 0 4.4M13.4 4.2a5.8 5.8 0 0 1 0 7.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

export const announceBannerHtml = (msg, _m) => {
    const esc = htmlspecialchars;
    const title = msg.titleKey ? _m(msg.titleKey) : '';
    const titleHtml = title ? `<strong class="announce-title">${esc(title)}</strong> ` : '';
    let text = msg.textKey ? _m(msg.textKey) : '';
    if (!text && msg.textFallback)
        text = msg.textFallback.en || '';
    const linksHtml = (msg.links || []).map(l =>
        `<a class="announce-link" href="${esc(l.url)}">${esc(_m(l.labelKey) || l.labelKey)}</a>`).join(' ');
    const dismissLabel = esc(_m('announceDismiss') || '');
    return `<div class="announce-banner" role="note">${ANNOUNCE_ICON}${titleHtml}` +
        `<span class="announce-text">${esc(text)}</span>` +
        (linksHtml ? ` ${linksHtml}` : '') +
        `<button class="announce-dismiss" type="button" aria-label="${dismissLabel}" title="${dismissLabel}">×</button>` +
        '</div>';
};

const fetchAnnounce = async ({ url, etag, fetchImpl, chromeImpl, now }) => {
    // The shared GitHub fetch chain: direct → user's proxy (when configured)
    // → github.akams.cn mirror candidates. Every layer is timeout-bounded and
    // every failure is silent; see src/github-source.js.
    const got = await fetchGithubResource({
        url,
        etag,
        fetchImpl,
        chromeImpl,
        now,
        validate: async res => {
            try {
                return sanitizeAnnounce(await res.json());
            } catch (e) {
                return null;
            }
        },
        probeUrl: url
    });
    if (!got)
        return null;
    if (got.notModified)
        return { notModified: true };
    return { data: got.data, etag: got.etag || '' };
};

export const initAnnounce = async ({ store, $, chrome, _m, channel, donationShowing, localBannerShowing = false, openNewTab, fetchImpl, now }) => {
    // Privacy switch: on by default, only an explicit '0' disables it (and
    // the network fetch with it).
    if (store.get('announceEnabled') === '0')
        return;
    const nowMs = (now && now()) || Date.now();
    const cache = readCache(store);
    let data = cache && cache.data ? cache.data : null;
    if (!announceCacheFresh(cache, nowMs)) {
        const got = await fetchAnnounce({ url: ANNOUNCE_URL, etag: cache ? cache.etag : null, fetchImpl, chromeImpl: chrome, now });
        if (got && got.data) {
            data = got.data;
            store.set(ANN_CACHE_KEY, { ts: nowMs, etag: got.etag || (cache && cache.etag) || null, data });
        } else if (got && got.notModified && cache) {
            // 304: keep the old payload, refresh the timestamp only
            store.set(ANN_CACHE_KEY, { ts: nowMs, etag: cache.etag, data: cache.data });
        }
        // fetch failure with a stale cache → keep using it; no cache at all → bail
    }
    if (!data)
        return;
    const msg = firstAnnouncement(data, {
        version: chrome.runtime.getManifest().version,
        channel,
        seen: parseSeen(store.get(ANN_SEEN_KEY))
    });
    if (!msg)
        return;
    // The donation card wins the frame — this announcement defers to the next
    // open (not marked seen, so it still shows then). Same for the local
    // what's-new banner (4.0.8 version crossing): it claims the upgrade open,
    // so the remote twin defers rather than double-bannering the same release.
    if (donationShowing || localBannerShowing)
        return;
    const bannerEl = $('announce');
    if (!bannerEl)
        return;
    bannerEl.hidden = false;
    bannerEl.innerHTML = announceBannerHtml(msg, _m);
    const dismissBtn = bannerEl.querySelector('.announce-dismiss');
    if (dismissBtn)
        dismissBtn.addEventListener('click', () => {
            markAnnounceSeen(store, msg.id);
            bannerEl.hidden = true;
        });
    for (const link of bannerEl.querySelectorAll('.announce-link')) {
        link.addEventListener('click', e => {
            e.preventDefault();
            openNewTab(link.getAttribute('href'), true, true);
        });
    }
};
