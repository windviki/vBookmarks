import { describe, it, expect, vi } from 'vitest';
import {
    ANNOUNCE_URL, ANN_CACHE_KEY, ANN_SEEN_KEY, ANN_TTL_MS, ANN_MAX_MESSAGES, ANN_TEXT_MAX, ANN_SEEN_MAX,
    sanitizeAnnounce, announceMatch, firstAnnouncement, announceCacheFresh, readCache,
    parseSeen, markAnnounceSeen, announceBannerHtml, initAnnounce
} from '../src/announce.js';

// Remote announcement layer (4.1.0 §4 decision, built ahead for 4.0.8): pure
// rules over docs/announce.json + the initAnnounce render/dismiss glue. The
// version helpers come from the REAL src/version.js through announce.js.

const sampleMsg = {
    id: 'v408-whats-new',
    minVersion: '4.0.8', maxVersion: '',
    channel: 'all', once: true, display: 'banner', kind: 'tip',
    titleKey: 'announceV408Title', textKey: 'announceV408Text',
    textFallback: { en: 'fallback' },
    link: [{ labelKey: 'donationV4GuideLink', url: 'https://example.com/guide' },
        { labelKey: 'whatsNewChangelog', url: 'https://example.com/changelog' }]
};

const makeStore = (data = {}) => {
    const map = new Map(Object.entries(data));
    return {
        map,
        get: (k, dflt) => (map.has(k) ? map.get(k) : dflt),
        set: (k, v) => map.set(k, v),
        remove: k => map.delete(k)
    };
};

const _m = key => key;

// The renderer + cache flow only ever see messages that came out of
// sanitizeAnnounce (link → links normalization), so tests sanitize first.
const sanitized = m => sanitizeAnnounce({ version: 1, messages: [m] }).messages[0];
const cacheWith = msg => ({ version: 1, messages: [sanitized(msg)] });

describe('sanitizeAnnounce', () => {
    it('cleans a valid payload, normalizing single/array link', () => {
        const clean = sanitizeAnnounce({ version: 1, messages: [sampleMsg] });
        expect(clean.version).toBe(1);
        expect(clean.messages).toHaveLength(1);
        expect(clean.messages[0].links).toHaveLength(2);
        expect(clean.messages[0].display).toBe('banner');
        expect(clean.messages[0].once).toBe(true);
    });

    it('a single link object normalizes to a one-element array', () => {
        const clean = sanitizeAnnounce({ messages: [{ ...sampleMsg, link: { labelKey: 'k', url: 'u' } }] });
        expect(clean.messages[0].links).toEqual([{ labelKey: 'k', url: 'u' }]);
    });

    it('drops messages with an unknown channel or display', () => {
        const bad = [{ ...sampleMsg, channel: 'nowhere' }, { ...sampleMsg, display: 'popup-blast' }];
        const clean = sanitizeAnnounce({ messages: bad });
        expect(clean).toBeNull();
    });

    it('drops a message with neither textKey nor textFallback', () => {
        const clean = sanitizeAnnounce({ messages: [{ ...sampleMsg, textKey: '', textFallback: undefined }] });
        expect(clean).toBeNull();
    });

    it('truncates the fallback text to 500 chars', () => {
        const clean = sanitizeAnnounce({ messages: [{ ...sampleMsg, textKey: '', textFallback: { en: 'x'.repeat(600) } }] });
        expect(clean.messages[0].textFallback.en).toHaveLength(ANN_TEXT_MAX);
    });

    it('rejects a payload over the 10-message cap or without a messages array', () => {
        expect(sanitizeAnnounce({ version: 1 })).toBeNull();
        expect(sanitizeAnnounce({ messages: Array.from({ length: ANN_MAX_MESSAGES + 1 }, (_, i) => ({ ...sampleMsg, id: 'm' + i })) })).toBeNull();
        expect(sanitizeAnnounce(null)).toBeNull();
        expect(sanitizeAnnounce('garbage')).toBeNull();
    });

    it('defaults once to true and keeps kind when present', () => {
        const clean = sanitizeAnnounce({ messages: [{ ...sampleMsg, once: undefined, kind: 'tip' }] });
        expect(clean.messages[0].once).toBe(true);
        expect(clean.messages[0].kind).toBe('tip');
    });
});

describe('announceMatch / firstAnnouncement', () => {
    it('matches a message in the version range for the right channel', () => {
        expect(announceMatch(sampleMsg, { version: '4.0.8', channel: 'popup', seen: [] })).toBe(true);
        expect(announceMatch(sampleMsg, { version: '4.1.0', channel: 'sidepanel', seen: [] })).toBe(true);
    });

    it('stays silent below minVersion and at/above maxVersion (exclusive)', () => {
        const ranged = { ...sampleMsg, minVersion: '4.0.0', maxVersion: '4.1.0' };
        expect(announceMatch(ranged, { version: '3.9.9', channel: 'popup', seen: [] })).toBe(false);
        expect(announceMatch(ranged, { version: '4.1.0', channel: 'popup', seen: [] })).toBe(false);
        expect(announceMatch(ranged, { version: '4.0.9', channel: 'popup', seen: [] })).toBe(true);
    });

    it('is channel-specific unless channel is all', () => {
        const popupOnly = { ...sampleMsg, channel: 'popup' };
        expect(announceMatch(popupOnly, { version: '4.0.8', channel: 'popup', seen: [] })).toBe(true);
        expect(announceMatch(popupOnly, { version: '4.0.8', channel: 'sidepanel', seen: [] })).toBe(false);
    });

    it('does not re-show a dismissed once message', () => {
        expect(announceMatch(sampleMsg, { version: '4.0.8', channel: 'popup', seen: ['v408-whats-new'] })).toBe(false);
    });

    it('ignores an unparseable current version', () => {
        expect(announceMatch(sampleMsg, { version: 'garbage', channel: 'popup', seen: [] })).toBe(false);
    });

    it('picks the first matching message (array order = priority)', () => {
        const data = { version: 1, messages: [
            { ...sampleMsg, id: 'first', minVersion: '5.0.0' },
            { ...sampleMsg, id: 'second' }
        ] };
        expect(firstAnnouncement(data, { version: '4.0.8', channel: 'popup', seen: [] }).id).toBe('second');
    });

    it('returns null when nothing matches', () => {
        expect(firstAnnouncement({ version: 1, messages: [sampleMsg] }, { version: '4.0.6', channel: 'popup', seen: [] })).toBeNull();
    });
});

describe('announceCacheFresh / readCache / parseSeen / markAnnounceSeen', () => {
    it('a cache is fresh inside the TTL and stale after', () => {
        const cache = { ts: 1000, data: { version: 1, messages: [] } };
        expect(announceCacheFresh(cache, 1000 + ANN_TTL_MS - 1)).toBe(true);
        expect(announceCacheFresh(cache, 1000 + ANN_TTL_MS)).toBe(false);
        expect(announceCacheFresh(null)).toBe(false);
    });

    it('readCache accepts an object or a JSON string', () => {
        const store = makeStore({ [ANN_CACHE_KEY]: { ts: 1, data: {} } });
        expect(readCache(store)).toEqual({ ts: 1, data: {} });
        store.map.set(ANN_CACHE_KEY, JSON.stringify({ ts: 2, data: {} }));
        expect(readCache(store)).toEqual({ ts: 2, data: {} });
        store.map.set(ANN_CACHE_KEY, 'not json');
        expect(readCache(store)).toBeNull();
    });

    it('parseSeen tolerates arrays, JSON strings and garbage', () => {
        expect(parseSeen(['a', 'b'])).toEqual(['a', 'b']);
        expect(parseSeen('["a","b"]')).toEqual(['a', 'b']);
        expect(parseSeen('not json')).toEqual([]);
        expect(parseSeen(undefined)).toEqual([]);
        expect(parseSeen(['a', 1])).toEqual(['a']);
    });

    it('markAnnounceSeen records most-recent-first, dedupes and caps at 100', () => {
        const store = makeStore();
        markAnnounceSeen(store, 'a');
        markAnnounceSeen(store, 'b');
        markAnnounceSeen(store, 'a');
        expect(parseSeen(store.get(ANN_SEEN_KEY))).toEqual(['a', 'b']);
        for (let i = 0; i < ANN_SEEN_MAX + 20; i++)
            markAnnounceSeen(store, 'x' + i);
        expect(parseSeen(store.get(ANN_SEEN_KEY))).toHaveLength(ANN_SEEN_MAX);
    });
});

describe('announceBannerHtml', () => {
    it('renders title + text + links + dismiss, labels from _m', () => {
        const html = announceBannerHtml(sanitized(sampleMsg), _m);
        expect(html).toContain('announce-title');
        expect(html).toContain('announceV408Title');
        expect(html).toContain('announceV408Text');
        expect(html).toContain('donationV4GuideLink');
        expect(html).toContain('whatsNewChangelog');
        expect(html).toContain('class="announce-dismiss"');
        expect(html).toContain('href="https://example.com/guide"');
        expect(html).toContain('href="https://example.com/changelog"');
    });

    it('falls back to textFallback.en when the text key is empty, and to the labelKey for links', () => {
        const noTextKey = sanitized({ ...sampleMsg, textKey: '', textFallback: { en: '<script>alert(1)</script>' } });
        const html = announceBannerHtml(noTextKey, () => '');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); // escaped
        expect(html).toContain('>donationV4GuideLink<'); // labelKey fallback
    });
});

describe('initAnnounce wiring', () => {
    // A minimal #announce stub: querySelector/All resolve the injected banner
    // children — the real page gets them by parsing the innerHTML we set, so
    // the stub's innerHTML setter parses the .announce-link hrefs the same way.
    const makeBannerEl = () => {
        const linkStub = href => ({
            href: '',
            getAttribute: () => href,
            _listeners: {},
            addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
            fire(type, ev = {}) { (this._listeners[type] || []).forEach(fn => fn(ev)); }
        });
        const el = {
            hidden: true, _links: [], _html: '',
            dismiss: { _listeners: {}, addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }, fire(t, ev = {}) { (this._listeners[t] || []).forEach(fn => fn(ev)); } },
            set innerHTML(v) {
                this._html = v;
                this._links = [...v.matchAll(/class="announce-link" href="([^"]+)"/g)].map(m => linkStub(m[1]));
            },
            get innerHTML() { return this._html; },
            querySelector(sel) { return sel === '.announce-dismiss' ? this.dismiss : null; },
            querySelectorAll(sel) { return sel === '.announce-link' ? this._links : []; }
        };
        return el;
    };

    const boot = (storeData, { donationShowing = false } = {}) => {
        const store = makeStore(storeData);
        const bannerEl = makeBannerEl();
        const $ = id => (id === 'announce' ? bannerEl : null);
        const openNewTab = vi.fn();
        return { store, bannerEl, $, openNewTab };
    };

    const now = () => 2000; // fixed clock for TTL math

    it('renders a matching cached message and wires dismiss + link clicks', async () => {
        const { store, bannerEl, $, openNewTab } = boot({
            [ANN_CACHE_KEY]: { ts: 1000, data: cacheWith(sampleMsg) }
        });
        await initAnnounce({ store, $, chrome: { runtime: { getManifest: () => ({ version: '4.0.8' }) } }, _m, channel: 'popup', donationShowing: false, openNewTab, now });
        expect(bannerEl.hidden).toBe(false);
        expect(bannerEl.innerHTML).toContain('announceV408Text');
        // dismiss → mark seen + hide
        bannerEl.dismiss.fire('click');
        expect(bannerEl.hidden).toBe(true);
        expect(parseSeen(store.get(ANN_SEEN_KEY))).toEqual([sampleMsg.id]);
        // link → openNewTab (popup-respecting semantics)
        const link = bannerEl._links[0];
        const ev = { preventDefault: vi.fn() };
        link.fire('click', ev);
        expect(ev.preventDefault).toHaveBeenCalled();
        expect(openNewTab).toHaveBeenCalledWith(link.getAttribute('href'), true, true);
    });

    it('does nothing when the privacy switch is off', async () => {
        const { store, bannerEl, $, openNewTab } = boot({
            announceEnabled: '0',
            [ANN_CACHE_KEY]: { ts: 1000, data: cacheWith(sampleMsg) }
        });
        await initAnnounce({ store, $, chrome: { runtime: { getManifest: () => ({ version: '4.0.8' }) } }, _m, channel: 'popup', donationShowing: false, openNewTab, now });
        expect(bannerEl.hidden).toBe(true);
        expect(store.map.has(ANN_CACHE_KEY)).toBe(true); // untouched
    });

    it('defers to the donation card — no banner, no seen record', async () => {
        const { store, bannerEl, $, openNewTab } = boot({
            [ANN_CACHE_KEY]: { ts: 1000, data: cacheWith(sampleMsg) }
        });
        await initAnnounce({ store, $, chrome: { runtime: { getManifest: () => ({ version: '4.0.8' }) } }, _m, channel: 'popup', donationShowing: true, openNewTab, now });
        expect(bannerEl.hidden).toBe(true);
        expect(store.get(ANN_SEEN_KEY)).toBeUndefined();
    });

    it('defers to the local what\'s-new banner (no double-banner on the 4.0.8 upgrade)', async () => {
        const { store, bannerEl, $, openNewTab } = boot({
            [ANN_CACHE_KEY]: { ts: 1000, data: cacheWith(sampleMsg) }
        });
        await initAnnounce({ store, $, chrome: { runtime: { getManifest: () => ({ version: '4.0.8' }) } }, _m, channel: 'popup', donationShowing: false, localBannerShowing: true, openNewTab, now });
        expect(bannerEl.hidden).toBe(true);
        expect(store.get(ANN_SEEN_KEY)).toBeUndefined(); // deferred, not dismissed
    });

    it('falls back to a stale cache when the fetch fails', async () => {
        const { store, bannerEl, $, openNewTab } = boot({
            [ANN_CACHE_KEY]: { ts: -ANN_TTL_MS, data: cacheWith(sampleMsg) } // expired vs the fixed now()=2000
        });
        const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
        await initAnnounce({ store, $, chrome: { runtime: { getManifest: () => ({ version: '4.0.8' }) } }, _m, channel: 'popup', donationShowing: false, openNewTab, fetchImpl, now });
        expect(bannerEl.hidden).toBe(false);
        expect(fetchImpl).toHaveBeenCalled();
        expect(fetchImpl.mock.calls[0][0]).toBe(ANNOUNCE_URL);
    });

    it('stays silent with no cache and a failing fetch', async () => {
        const { store, bannerEl, $, openNewTab } = boot({});
        const fetchImpl = vi.fn(() => Promise.reject(new Error('offline')));
        await initAnnounce({ store, $, chrome: { runtime: { getManifest: () => ({ version: '4.0.8' }) } }, _m, channel: 'popup', donationShowing: false, openNewTab, fetchImpl, now });
        expect(bannerEl.hidden).toBe(true);
    });

    it('does not show when the version is below the message minVersion', async () => {
        const { store, bannerEl, $, openNewTab } = boot({
            [ANN_CACHE_KEY]: { ts: 1000, data: cacheWith(sampleMsg) }
        });
        await initAnnounce({ store, $, chrome: { runtime: { getManifest: () => ({ version: '4.0.6' }) } }, _m, channel: 'popup', donationShowing: false, openNewTab, now });
        expect(bannerEl.hidden).toBe(true);
    });
});
