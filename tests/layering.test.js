import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Third-round item 4 — one deterministic z-index layering standard.
// The table lives in the header comment of neat.css (Layers 0–6); this test
// pins the actual rule values so the table and the CSS cannot drift apart,
// and so no overlay can accidentally cover a layer it must stay under:
//   base content < donation(1) < search(2) < sync-indicator(10)
//     < palette(100) < cover/dialog(200) < context menu(300) < toasts(400)
// The sync tooltip is inside .sync-indicator's stacking context (z-index 10),
// so its local z-index must stay small — a big local value like 1000 is
// misleading even though it cannot escape the context.

const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
const syncCss = fs.readFileSync(new URL('../css/sync-styles.css', import.meta.url), 'utf8');

// Extract the `{ … }` body following a selector (rules are flat — no nesting).
const ruleBody = (css, selector) => {
    const i = css.indexOf(selector);
    expect(i, `rule for ${selector} exists`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
};

const zIndexOf = (css, selector) => {
    const m = ruleBody(css, selector).match(/z-index:\s*(\d+)/);
    expect(m, `${selector} declares a z-index`).toBeTruthy();
    return Number(m[1]);
};

describe('z-index layering contract (third-round item 4)', () => {
    it('every documented layer carries its tabled z-index value', () => {
        expect(zIndexOf(neatCss, '#donation {')).toBe(1);
        expect(zIndexOf(neatCss, '#search {')).toBe(2);
        expect(zIndexOf(syncCss, '.sync-indicator {')).toBe(10);
        expect(zIndexOf(neatCss, '#command-palette {')).toBe(100);
        expect(zIndexOf(neatCss, '#cover {')).toBe(200);
        expect(zIndexOf(neatCss, '.dialog {')).toBe(200);
        expect(zIndexOf(neatCss, 'menu[type=context] {')).toBe(300);
        expect(zIndexOf(neatCss, '#undo-toast {')).toBe(400);
        expect(zIndexOf(neatCss, '#notice-toast {')).toBe(400);
    });

    it('layer order is strictly increasing along the overlay chain', () => {
        const chain = [
            zIndexOf(neatCss, '#donation {'),
            zIndexOf(neatCss, '#search {'),
            zIndexOf(syncCss, '.sync-indicator {'),
            zIndexOf(neatCss, '#command-palette {'),
            zIndexOf(neatCss, '#cover {'),
            zIndexOf(neatCss, 'menu[type=context] {'),
            zIndexOf(neatCss, '#undo-toast {'),
        ];
        for (let i = 1; i < chain.length; i++) {
            expect(chain[i]).toBeGreaterThan(chain[i - 1]);
        }
    });

    it('dialogs and the cover share one modal layer above the palette', () => {
        expect(zIndexOf(neatCss, '.dialog {')).toBe(zIndexOf(neatCss, '#cover {'));
        expect(zIndexOf(neatCss, '.dialog {')).toBeGreaterThan(zIndexOf(neatCss, '#command-palette {'));
    });

    it('the sync tooltip uses a small local z-index inside its parent context', () => {
        expect(zIndexOf(syncCss, '.sync-tooltip {')).toBeLessThanOrEqual(10);
        expect(syncCss).not.toContain('z-index: 1000');
    });
});
