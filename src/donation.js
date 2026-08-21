/**
 * Donation card (v4 gentle-ask model): no countdown, no forced navigation,
 * no focus stealing. The card reappears on every popup open until the user
 * makes an explicit choice — closing the popup never counts as an answer, so
 * the ask cannot be ignored away, but it never blocks usage either. Choices:
 * Donate (opens the page, long snooze), Rate it (opens the store listing —
 * reviews keep the updates coming — same long snooze), Later (short snooze),
 * Don't show again (permanent opt-out).
 *
 * The card's header is the consolidated v4 identity line — "v4.0 is the
 * modern-design remake, packed with new features" + the guide link. It shows
 * whenever the card shows and never carries a minor version number: the
 * statement covers the whole 4.x line, so a patch release never churns it.
 * (The network-independent #whats-new banner below owns the per-version
 * "what's new" story instead.)
 *
 * The pure rules (donationVisible / donationSnoozeKey / guideV4UrlFor) are
 * exported for direct testing; createDonation does the version gating, the
 * open-count / grace-key bookkeeping and the DOM wiring. Extracted from
 * neat.js — tests drive the real module (tests/donation.test.js).
 *
 * deps: store (currentVersion/openCount/donationKey/donationFactor/
 * donationDisabled), $ (the card element ids), chrome (runtime.getManifest,
 * i18n.getUILanguage), _m, openNewTab — a lazy callable resolving to
 * actions.openBookmarkNewTab (declared later in neat.js, TDZ-safe).
 */
import { applyVersionGate, bumpOpenCount } from './startup-flags.js';

export const DONATION_GRACE_OPENS = 30;   // new installs: first ask after ~30 opens
export const DONATION_MAX_KEY = 3200;     // snooze cap
export const DONATE_SNOOZE = 800;         // donors/raters get the longest quiet period
export const LATER_SNOOZE = 120;
export const DONATION_URL = 'https://github.com/windviki/vBookmarks/blob/master/donation/donation.md';
export const STORE_URL = 'https://chromewebstore.google.com/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb';
// Point at the changelog file explicitly, not the repo root: the root anchor
// breaks the moment a top-level README appears (audit B3/O13).
export const CHANGELOG_URL = 'https://github.com/windviki/vBookmarks/blob/master/docs/README.md#v408';

// The ask shows unless permanently disabled, and when this open is an
// upgrade (newOrUpgrade) OR the accumulated opens have crossed the key.
export const donationVisible = ({ donationDisabled, newOrUpgrade, donationFactor, donationKey }) => {
    if (donationDisabled)
        return false;
    return newOrUpgrade || !donationFactor
        || parseInt(donationFactor, 10) >= parseInt(donationKey, 10);
};

// A snooze pushes the next ask out by `step` opens (capped).
export const donationSnoozeKey = (currentKey, step) =>
    Math.min(parseInt(currentKey, 10) + step, DONATION_MAX_KEY);

// The v4 guide lives in the repo docs; pick the file by UI language.
export const guideV4UrlFor = lang =>
    `https://github.com/windviki/vBookmarks/blob/master/docs/guide-v4${
        (lang || '').startsWith('zh') ? '.zh' : ''}.md`;

export const createDonation = ({ store, $, chrome, _m, openNewTab }) => {
    // Version gate + open-count live in the shared src/startup-flags.js (a
    // second banner consumer must not re-implement them).
    const mf = chrome.runtime.getManifest();
    const { newOrUpgrade, upgradedToV4, upgradedToAnnounced } = applyVersionGate(store, mf['version']);
    bumpOpenCount(store);
    if (!store.get('donationKey')) {
        // New installs: the very first open shows the card once as the
        // welcome/v4-identity frame (newOrUpgrade), then this seeded key
        // holds the next ask back for ~30 popup opens of real usage.
        store.set('donationKey', DONATION_GRACE_OPENS);
    }
    store.remove('donationCountDown'); // retired in v4 (was the 10s timer)

    const guideV4Url = guideV4UrlFor(chrome.i18n.getUILanguage());

    const showDonation = (show) => {
        if (show) {
            // The consolidated v4 identity line + guide link — the card's
            // permanent header, on every show (no minor version numbers).
            $('v4-notice-text').textContent = _m('donationV4Notice');
            const guideLink = $('v4-guide-link');
            guideLink.textContent = _m('donationV4GuideLink');
            guideLink.href = guideV4Url;
            $('v4-notice').hidden = false;
            $('donation-text').innerHTML = _m('donationMessage');
            $('donation-go').innerHTML = _m('donationGo');
            $('donation-rate-text').textContent = _m('donationRate');
            $('donation-rate').title = _m('donationRateTitle');
            $('donation-later').innerHTML = _m('donationLater');
            $('donation-never').innerHTML = _m('donationNever');
        }
        $('donation').style.display = show ? 'block' : 'none';
    };

    const donationSnooze = step => {
        showDonation(false);
        store.set('donationFactor', 1);
        store.set('donationKey', donationSnoozeKey(store.get('donationKey'), step));
    };

    const donationNever = () => {
        showDonation(false);
        store.set('donationDisabled', '1');
    };

    // Four explicit answers to the ask (see the model above).
    $('donation-go').addEventListener('click', () => {
        donationSnooze(DONATE_SNOOZE); // donors get the longest quiet period
        openNewTab(DONATION_URL, true, true);
    });
    // The store-rating path: a review is the same tier of support as a
    // donation, so it earns the same long snooze.
    $('donation-rate').addEventListener('click', () => {
        donationSnooze(DONATE_SNOOZE);
        openNewTab(STORE_URL, true, true);
    });
    $('donation-later').addEventListener('click', () => donationSnooze(LATER_SNOOZE));
    $('donation-never').addEventListener('click', donationNever);
    // The guide link on the v4 identity line (middle-click and the context
    // menu use the href; left-click goes through actions so the
    // popup-respecting open semantics stay uniform).
    $('v4-guide-link').addEventListener('click', e => {
        e.preventDefault();
        openNewTab(guideV4Url, true, true);
    });

    // Visibility: show the ask, else bump the counter toward the next ask.
    const shouldShow = donationVisible({
        donationDisabled: store.get('donationDisabled'),
        newOrUpgrade,
        donationFactor: store.get('donationFactor'),
        donationKey: store.get('donationKey')
    });
    if (shouldShow) {
        showDonation(true);
    } else {
        store.set('donationFactor', parseInt(store.get('donationFactor'), 10) + 1);
    }

    // 4.0.8 local what's-new banner (#whats-new): the network-independent twin
    // of the remote announce — the version gate fires it exactly once on the
    // 4.x → 4.0.8 crossing (recorded currentVersion keeps it from re-firing),
    // so it needs no dismiss and no network, and stays decoupled from the
    // donation card (donationDisabled never hides it). A 3.x → 4.x upgrade is
    // excluded: the v4 notice on the card already owns that story. A minor-
    // release banner carries only the version summary + the changelog link —
    // the v4 guide lives on the donation card's permanent header.
    const whatsNew = $('whats-new');
    const whatsNewShown = !!whatsNew && upgradedToAnnounced && !upgradedToV4;
    if (whatsNew) {
        if (whatsNewShown) {
            $('whats-new-text').textContent = _m('whatsNewFavicon', [mf['version']]);
            const changelogLink = $('whats-new-changelog');
            changelogLink.textContent = _m('whatsNewChangelog');
            changelogLink.href = CHANGELOG_URL;
        }
        whatsNew.hidden = !whatsNewShown;
        // Left-click routes through actions so the popup-respecting open
        // semantics stay uniform (same as the v4-guide-link handler).
        const changelog = $('whats-new-changelog');
        if (changelog)
            changelog.addEventListener('click', e => {
                e.preventDefault();
                openNewTab(CHANGELOG_URL, true, true);
            });
    }

    return { shouldShow, showDonation, donationSnooze, donationNever, whatsNewShown };
};
