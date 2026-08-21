import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Banner geometry contract (4.0.8): body is the containing block for the
// absolute #container/banners, so a restored popupWidth narrower than the
// initial viewport still lays banners out against BODY width — otherwise
// right-aligned controls (donation "Don't show again", announce ×) clip.
// The donation card anchors its illustration to the top of the text column
// and wraps its action row on narrow widths instead of clipping the last
// button.
const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');

const ruleBody = (css, selector) => {
    const i = css.indexOf(selector);
    expect(i, `rule for ${selector} exists`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
};

describe('banner layout contract', () => {
    it('body is the positioning context for the absolute banner shell', () => {
        expect(ruleBody(neatCss, 'body {')).toContain('position: relative');
    });

    it('donation card top-anchors the illustration and lets its text/actions wrap', () => {
        expect(ruleBody(neatCss, '#donation-card {')).toContain('align-items: flex-start');
        expect(ruleBody(neatCss, '#donation-illustration {')).toContain('flex: none');
        expect(ruleBody(neatCss, '#information-text {')).toContain('overflow-wrap: break-word');
        expect(ruleBody(neatCss, '#donation-actions {')).toContain('flex-wrap: wrap');
        expect(ruleBody(neatCss, '#donation-actions button {')).toContain('white-space: nowrap');
    });
});
