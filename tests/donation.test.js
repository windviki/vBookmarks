import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import {
    createDonation,
    donationVisible,
    donationSnoozeKey,
    guideV4UrlFor,
    DONATION_GRACE_OPENS, DONATION_MAX_KEY, DONATE_SNOOZE, LATER_SNOOZE, DONATION_URL, STORE_URL, CHANGELOG_URL
} from '../src/donation.js';

// Donation card (v4 gentle-ask model): pure rules + the createDonation DOM
// wiring (version gate, open-count/grace bookkeeping, the four answer
// buttons, the always-on v4 identity line). The version helpers come from
// the REAL src/version.js through donation.js's import.

const makeStore = (data = {}) => {
    const map = new Map(Object.entries(data));
    return {
        map,
        get: (k, dflt) => (map.has(k) ? map.get(k) : dflt),
        set: (k, v) => map.set(k, v),
        remove: k => map.delete(k)
    };
};

const makeEl = (id) => ({
    id, innerHTML: '', textContent: '', href: '', hidden: false, title: '',
    style: { display: '' },
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    fire(type, ev = {}) { (this._listeners[type] || []).forEach(fn => fn(ev)); }
});

const DOM_IDS = ['donation', 'v4-notice', 'v4-notice-text',
    'v4-guide-link', 'donation-text', 'donation-go', 'donation-rate', 'donation-rate-text',
    'donation-later', 'donation-never',
    'whats-new', 'whats-new-text', 'whats-new-changelog'];

const _m = (key, subs) => key + (subs ? `[${subs.join(',')}]` : '');

const popupHtml = fs.readFileSync(new URL('../pages/popup.html', import.meta.url), 'utf8');
const sidepanelHtml = fs.readFileSync(new URL('../pages/sidepanel.html', import.meta.url), 'utf8');

describe('donationVisible (the ask rule)', () => {
    it('is permanently off once disabled — even on an upgrade', () => {
        expect(donationVisible({ donationDisabled: '1', newOrUpgrade: true, donationFactor: undefined, donationKey: 30 }))
            .toBe(false);
    });

    it('shows on a version upgrade (newOrUpgrade)', () => {
        expect(donationVisible({ donationDisabled: '', newOrUpgrade: true, donationFactor: '5', donationKey: 30 }))
            .toBe(true);
    });

    it('shows when no factor is recorded yet (the first ask)', () => {
        expect(donationVisible({ donationDisabled: '', newOrUpgrade: false, donationFactor: undefined, donationKey: 30 }))
            .toBe(true);
    });

    it('shows when the accumulated opens cross the key', () => {
        expect(donationVisible({ donationDisabled: '', newOrUpgrade: false, donationFactor: '30', donationKey: 30 }))
            .toBe(true);
        expect(donationVisible({ donationDisabled: '', newOrUpgrade: false, donationFactor: '31', donationKey: 30 }))
            .toBe(true);
    });

    it('stays hidden until the factor reaches the key', () => {
        expect(donationVisible({ donationDisabled: '', newOrUpgrade: false, donationFactor: '5', donationKey: 30 }))
            .toBe(false);
    });
});

describe('donationSnoozeKey / guideV4UrlFor (pure helpers)', () => {
    it('pushes the next ask out by the step, capped at 3200', () => {
        expect(donationSnoozeKey(30, LATER_SNOOZE)).toBe(150);
        expect(donationSnoozeKey(30, DONATE_SNOOZE)).toBe(830);
        expect(donationSnoozeKey(3100, DONATE_SNOOZE)).toBe(DONATION_MAX_KEY);
        expect(donationSnoozeKey('30', LATER_SNOOZE)).toBe(150); // string keys parse
    });

    it('picks the guide file by UI language', () => {
        expect(guideV4UrlFor('zh-CN')).toContain('guide-v4.zh.md');
        expect(guideV4UrlFor('zh')).toContain('guide-v4.zh.md');
        expect(guideV4UrlFor('en')).toContain('guide-v4.md');
        expect(guideV4UrlFor('')).toContain('guide-v4.md');
        expect(guideV4UrlFor(undefined)).toContain('guide-v4.md');
    });
});

describe('createDonation wiring', () => {
    let store, els, $, openNewTab, donation;

    const boot = (storeData, { version = '4.0.1', lang = 'en', presetDonationDisplay = true } = {}) => {
        store = makeStore(storeData);
        ({ els, $ } = (() => {
            const elMap = Object.fromEntries(DOM_IDS.map(id => [id, makeEl(id)]));
            // match popup.html: v4-notice and whats-new carry `hidden`,
            // #donation is display:none via CSS until showDonation(true)
            // reveals it (presetDonationDisplay:false simulates the pre-fix
            // state where the hidden boot path left no inline style at all)
            elMap['v4-notice'].hidden = true;
            elMap['whats-new'].hidden = true;
            if (presetDonationDisplay)
                elMap.donation.style.display = 'none';
            return { els: elMap, $: id => elMap[id] || null };
        })());
        openNewTab = vi.fn();
        donation = createDonation({
            store, $,
            chrome: { runtime: { getManifest: () => ({ version }) }, i18n: { getUILanguage: () => lang } },
            _m,
            openNewTab
        });
    };

    it('a fresh install gets a 30-open grace period and shows the card', () => {
        boot({});
        // version gating bookkeeping ran
        expect(store.get('currentVersion')).toBe('4.0.1');
        expect(store.get('openCount')).toBe(1);
        expect(store.get('donationKey')).toBe(DONATION_GRACE_OPENS);
        // the retired 10s-timer key is dropped
        expect(store.map.has('donationCountDown')).toBe(false);
        // card visible, labels assigned, the v4 identity line always on
        expect(donation.shouldShow).toBe(true);
        expect(els.donation.style.display).toBe('block');
        expect(els['donation-go'].innerHTML).toBe('donationGo');
        expect(els['donation-rate-text'].textContent).toBe('donationRate');
        expect(els['donation-rate'].title).toBe('donationRateTitle');
        expect(els['v4-notice'].hidden).toBe(false);
        expect(els['v4-notice-text'].textContent).toBe('donationV4Notice');
        expect(els['v4-guide-link'].href).toBe(guideV4UrlFor('en'));
    });

    it('a returning user sees the card until an explicit choice, then the counter bumps', () => {
        boot({ currentVersion: '4.0.1', donationFactor: '5', donationKey: '30' });
        // same version → not an upgrade; factor (5) below the key (30) → hidden
        expect(donation.shouldShow).toBe(false);
        expect(els.donation.style.display).toBe('none');
        expect(store.get('donationFactor')).toBe(6); // bumped toward the next ask
        expect(store.get('openCount')).toBe(1); // this boot is the first open
    });

    it('a hidden ask still writes inline display:none at boot (Esc-layer regression)', () => {
        // Regression: pre-fix the hidden branch only bumped donationFactor,
        // leaving #donation with NO inline display style — keyboard.js reads
        // `style.display !== 'none'` as visible, so the first Esc on every
        // popup open fired a silent "Later" and ratcheted the snooze.
        boot({ currentVersion: '4.0.1', donationFactor: '5', donationKey: '30' }, { presetDonationDisplay: false });
        expect(donation.shouldShow).toBe(false);
        expect(els.donation.style.display).toBe('none');
    });

    it('a 3.x → 4.x crossing shows the card with the v4 identity line + guide link', () => {
        boot({ currentVersion: '3.5.0' }, { version: '4.0.1', lang: 'zh-CN' });
        expect(donation.shouldShow).toBe(true);
        expect(els['v4-notice'].hidden).toBe(false);
        expect(els['v4-notice-text'].textContent).toBe('donationV4Notice');
        expect(els['v4-guide-link'].href).toBe(guideV4UrlFor('zh-CN'));
        expect(els['v4-guide-link'].textContent).toBe('donationV4GuideLink');
    });

    it('a patch bump (4.0 → 4.0.1) stays silent — no upgrade, no re-ask re-arm', () => {
        boot({ currentVersion: '4.0.0', donationFactor: '20', donationKey: '30' });
        // sameOrNewerMinor(4.0.0, 4.0.1) → true → not an upgrade; 20 < 30 → hidden
        expect(donation.shouldShow).toBe(false);
        expect(els.donation.style.display).toBe('none');
    });

    it('Donate snoozes 800 opens and opens the donation page', () => {
        boot({});
        els['donation-go'].fire('click');
        expect(store.get('donationFactor')).toBe(1);
        expect(store.get('donationKey')).toBe(30 + DONATE_SNOOZE);
        expect(els.donation.style.display).toBe('none');
        expect(openNewTab).toHaveBeenCalledWith(DONATION_URL, true, true);
    });

    it('Rate it earns the same long snooze and opens the store listing', () => {
        boot({});
        els['donation-rate'].fire('click');
        expect(store.get('donationFactor')).toBe(1);
        expect(store.get('donationKey')).toBe(30 + DONATE_SNOOZE);
        expect(els.donation.style.display).toBe('none');
        expect(openNewTab).toHaveBeenCalledWith(STORE_URL, true, true);
    });

    it('Later snoozes 120 opens without opening anything', () => {
        boot({ donationKey: '30' });
        els['donation-later'].fire('click');
        expect(store.get('donationKey')).toBe(30 + LATER_SNOOZE);
        expect(store.get('donationFactor')).toBe(1);
        expect(els.donation.style.display).toBe('none');
        expect(openNewTab).not.toHaveBeenCalled();
    });

    it("Don't show again opts out permanently", () => {
        boot({});
        els['donation-never'].fire('click');
        expect(store.get('donationDisabled')).toBe('1');
        expect(els.donation.style.display).toBe('none');
    });

    it('the v4 guide link routes through openNewTab (popup semantics)', () => {
        boot({});
        const ev = { preventDefault: vi.fn() };
        els['v4-guide-link'].fire('click', ev);
        expect(ev.preventDefault).toHaveBeenCalled();
        expect(openNewTab).toHaveBeenCalledWith(guideV4UrlFor('en'), true, true);
    });

    describe('whats-new (4.1.1 local banner)', () => {
        it('a 4.0.x → 4.1.1 crossing shows the banner with the version summary + changelog link', () => {
            boot({ currentVersion: '4.0.8' }, { version: '4.1.1', lang: 'zh-CN' });
            expect(donation.whatsNewShown).toBe(true);
            expect(els['whats-new'].hidden).toBe(false);
            expect(els['whats-new-text'].textContent).toBe('whatsNewV411[4.1.1]');
            expect(els['whats-new-changelog'].textContent).toBe('whatsNewChangelog');
            expect(els['whats-new-changelog'].href).toBe(CHANGELOG_URL);
        });

        it('a 3.x → 4.1.0 upgrade keeps whats-new hidden (the v4 notice owns it)', () => {
            boot({ currentVersion: '3.3.0' }, { version: '4.1.0' });
            expect(donation.whatsNewShown).toBe(false);
            expect(els['whats-new'].hidden).toBe(true);
            expect(els['v4-notice'].hidden).toBe(false); // the card carries the story
        });

        it('the same version stays hidden', () => {
            boot({ currentVersion: '4.1.0' }, { version: '4.1.0' });
            expect(donation.whatsNewShown).toBe(false);
            expect(els['whats-new'].hidden).toBe(true);
        });

        it('a fresh install (no recorded version) stays hidden', () => {
            boot({}, { version: '4.1.0' });
            expect(donation.whatsNewShown).toBe(false);
            expect(els['whats-new'].hidden).toBe(true);
        });

        it('the changelog link routes through openNewTab (popup semantics)', () => {
            boot({ currentVersion: '4.0.8' }, { version: '4.1.0', lang: 'en' });
            const changelogEv = { preventDefault: vi.fn() };
            els['whats-new-changelog'].fire('click', changelogEv);
            expect(changelogEv.preventDefault).toHaveBeenCalled();
            expect(openNewTab).toHaveBeenCalledWith(CHANGELOG_URL, true, true);
        });
    });
});

describe('banner markup contract (audit T8)', () => {
    it.each(['popup', 'sidepanel'])('%s.html carries #whats-new/#announce with their interactive children', page => {
        const html = page === 'popup' ? popupHtml : sidepanelHtml;
        for (const id of ['whats-new', 'whats-new-text', 'whats-new-changelog', 'announce'])
            expect(html).toContain(`id="${id}"`);
        expect(html).toMatch(/<div id="whats-new" hidden>/);
        expect(html).toMatch(/<div id="announce" hidden>/);
    });

    it.each(['popup', 'sidepanel'])('%s.html carries the redesigned donation card (rate button, no version line)', page => {
        const html = page === 'popup' ? popupHtml : sidepanelHtml;
        for (const id of ['donation-illustration', 'v4-notice', 'v4-notice-text',
            'v4-guide-link', 'donation-rate', 'donation-rate-text',
            'donation-go', 'donation-later', 'donation-never'])
            expect(html).toContain(`id="${id}"`);
        expect(html).not.toContain('new-version-text'); // no minor version on the card
    });

    it('the whats-new changelog link points at the docs/README.md changelog anchor (audit B3/O13)', () => {
        expect(CHANGELOG_URL).toBe('https://github.com/windviki/vBookmarks/blob/master/docs/README.md#v411');
    });

    it('the rate button points at the Chrome Web Store listing', () => {
        expect(STORE_URL).toContain('odhjcodnoebmndcihdedenkmdmklpihb');
    });
});
