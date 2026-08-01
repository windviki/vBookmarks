// v4 task-4 #14: pre-use risk banner for the bulk-destructive views (dead
// links + duplicates). One shared factory keeps the two views' copy,
// storage gate and keyboard integration identical.
//
// Gate model (mirrors the donation card's version gate): the banner shows
// until the user picks "Don't show again", which records the current
// version; a later MAJOR version bump re-arms it once. The × dismisses for
// the popup session only (an in-memory flag). The banner is a Tab-ring
// stop and an Esc layer (keyboard.js), never an arrow rung — keyboard-model
// §7: transient UI must not move the arrow chain.

// Chrome's official bookmark export/import help.
export const RISK_HELP_URL = 'https://support.google.com/chrome/answer/96816';

const majorOf = version => {
    const m = (version || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : -1;
};

export const makeRiskBanner = ({ store, ackKey, textKey }) => {
    const _m = chrome.i18n.getMessage;
    let dismissed = false; // session-only (the ×)

    const visible = () => {
        if (dismissed)
            return false;
        const ack = store.get(ackKey, '') || '';
        if (!ack)
            return true;
        // An ack recorded under an older major re-arms the banner once.
        return majorOf(ack) < majorOf(chrome.runtime.getManifest().version);
    };

    const ack = () => {
        store.set(ackKey, chrome.runtime.getManifest().version || '');
    };
    const dismiss = () => {
        dismissed = true;
    };

    const html = () => {
        if (!visible())
            return '';
        return `<div class="risk-banner" role="note">` +
            `<i>${_m(textKey)}</i>` +
            `<a class="risk-banner-help" tabindex="-1" href="${RISK_HELP_URL}">${_m('riskBannerHelp')}</a>` +
            `<button type="button" class="risk-banner-never" tabindex="-1">${_m('riskBannerNever')}</button>` +
            `<button type="button" class="risk-banner-dismiss" tabindex="-1" aria-label="${_m('riskBannerDismiss')}" ` +
            `title="${_m('riskBannerDismiss')}">×</button>` +
            '</div>';
    };

    return { visible, ack, dismiss, html };
};
