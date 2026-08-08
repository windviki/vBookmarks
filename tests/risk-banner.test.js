import { describe, it, expect, afterEach } from 'vitest';
import { makeRiskBanner, RISK_HELP_URL } from '../src/risk-banner.js';

// v4 task-4 #14: the shared risk-banner factory (dead/dupes pre-use
// warning). chrome.* is stubbed per case; the i18n double renders keys
// verbatim so the assertions can lean on them.

const realChrome = globalThis.chrome;

const stubChrome = version => {
    globalThis.chrome = {
        runtime: { getManifest: () => ({ version }) },
        i18n: { getMessage: key => key }
    };
};

const makeStore = (data = {}) => ({
    get: (k, d) => (k in data ? data[k] : (d === undefined ? '' : d)),
    set: (k, v) => { data[k] = v; },
    _data: data
});

afterEach(() => {
    globalThis.chrome = realChrome;
});

describe('risk banner (v4 task-4 #14)', () => {
    it('shows with no ack recorded, carrying text/help/never/dismiss', () => {
        stubChrome('4.2.0');
        const b = makeRiskBanner({ store: makeStore(), ackKey: 'deadRiskAck', textKey: 'deadRiskBanner' });
        expect(b.visible()).toBe(true);
        const html = b.html();
        expect(html).toContain('deadRiskBanner');
        expect(html).toContain(RISK_HELP_URL);
        expect(html).toContain('risk-banner-help');
        expect(html).toContain('risk-banner-never');
        expect(html).toContain('risk-banner-dismiss');
        // in-list convention: the Tab cycle owns the stops, native Tab stays out
        expect(html).toContain('tabindex="-1"');
    });

    it('the × dismisses for the session only (storage untouched)', () => {
        stubChrome('4.2.0');
        const store = makeStore();
        const b = makeRiskBanner({ store, ackKey: 'deadRiskAck', textKey: 'deadRiskBanner' });
        b.dismiss();
        expect(b.visible()).toBe(false);
        expect(b.html()).toBe('');
        expect('deadRiskAck' in store._data).toBe(false);
    });

    it('"don\'t show again" records the current version and hides', () => {
        stubChrome('4.2.0');
        const store = makeStore();
        const b = makeRiskBanner({ store, ackKey: 'dupesRiskAck', textKey: 'dupesRiskBanner' });
        b.ack();
        expect(store._data.dupesRiskAck).toBe('4.2.0');
        expect(b.visible()).toBe(false);
        expect(b.html()).toBe('');
    });

    it('a patch bump stays silent; a minor or major bump re-arms an acked banner', () => {
        stubChrome('4.0.1');
        const store = makeStore({ deadRiskAck: '4.0.0' });
        const b = makeRiskBanner({ store, ackKey: 'deadRiskAck', textKey: 'deadRiskBanner' });
        expect(b.visible()).toBe(false); // patch bump: silent, stays acked
        stubChrome('4.1.0');
        expect(b.visible()).toBe(true); // minor bump re-arms
        stubChrome('5.0.0');
        expect(b.visible()).toBe(true); // major bump re-arms
        stubChrome('4.0.0');
        expect(b.visible()).toBe(false); // same version: stays acked
        stubChrome('3.9');
        expect(b.visible()).toBe(false); // an ack from a NEWER version still counts
    });

    it('a malformed ack value is treated as "never acked"', () => {
        stubChrome('4.2.0');
        const b = makeRiskBanner({
            store: makeStore({ deadRiskAck: 'garbage' }),
            ackKey: 'deadRiskAck', textKey: 'deadRiskBanner'
        });
        expect(b.visible()).toBe(true);
    });

    it('an unparsable manifest version fails open too', () => {
        stubChrome('garbage');
        const b = makeRiskBanner({
            store: makeStore({ deadRiskAck: '4.0.0' }),
            ackKey: 'deadRiskAck', textKey: 'deadRiskBanner'
        });
        expect(b.visible()).toBe(true);
    });
});
