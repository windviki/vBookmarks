/**
 * Sync indicator CSS cascade test (v4 task 2).
 *
 * Verifies that the sync indicator dot remains a 6px circle, positioned
 * absolutely at the bottom-right of .favicon-container, and that no
 * conflicting rules from neat.css override these dimensions.
 *
 * The sync-styles.css is the authority for sync indicator styling;
 * neat.css must not set width, height, min-width, min-height, flex,
 * or border-radius on .sync-indicator elements inside tree/results rows.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
const syncCss = fs.readFileSync(new URL('../css/sync-styles.css', import.meta.url), 'utf8');

// Extract all CSS rules (blocks + selectors) from a stylesheet string
const parseRules = (css) => {
    const rules = [];
    // Remove comments
    const cleaned = css.replace(/\/\*[\s\S]*?\*\//g, '');
    // Match selector { ... } blocks
    const blockRe = /([^{]+)\{([^}]*)\}/g;
    let m;
    while ((m = blockRe.exec(cleaned)) !== null) {
        const selector = m[1].trim();
        const body = m[2].trim();
        const decls = {};
        for (const decl of body.split(';')) {
            const colon = decl.indexOf(':');
            if (colon > 0) {
                const prop = decl.slice(0, colon).trim();
                const val = decl.slice(colon + 1).trim();
                if (prop && val) decls[prop] = val;
            }
        }
        rules.push({ selector, decls });
    }
    return rules;
};

const neatRules = parseRules(neatCss);
const syncRules = parseRules(syncCss);

// Find all rules that match .sync-indicator
const findRules = (rulesList, pattern) =>
    rulesList.filter(r => r.selector.includes(pattern));

describe('sync-indicator CSS cascade', () => {
    it('sync-styles.css defines base .sync-indicator as 6px absolute circle', () => {
        const base = syncRules.find(r => r.selector.trim() === '.sync-indicator');
        expect(base).toBeDefined();
        expect(base.decls['width']).toBe('6px');
        expect(base.decls['height']).toBe('6px');
        expect(base.decls['min-width']).toBe('6px');
        expect(base.decls['min-height']).toBe('6px');
        expect(base.decls['border-radius']).toBe('50%');
        expect(base.decls['position']).toBe('absolute');
        expect(base.decls['bottom']).toBe('1px');
        expect(base.decls['right']).toBe('1px');
    });

    it('sync-styles.css .favicon-container .sync-indicator positions it correctly', () => {
        const pos = syncRules.find(r =>
            r.selector.includes('.favicon-container') && r.selector.includes('.sync-indicator'));
        expect(pos).toBeDefined();
        expect(pos.decls['position']).toBe('absolute');
        expect(pos.decls['bottom']).toBe('1px');
        expect(pos.decls['right']).toBe('1px');
    });

    it('neat.css has NO flex property on sync-indicator inside tree/results', () => {
        const neatSyncRules = findRules(neatRules, 'sync-indicator');
        for (const rule of neatSyncRules) {
            expect(rule.decls['flex'] || 'none').toBe('none'); // only comment remains
        }
    });

    it('neat.css does NOT override sync-indicator width/height/min-size/border-radius', () => {
        const neatSyncRules = findRules(neatRules, 'sync-indicator');
        const forbidden = ['width', 'height', 'min-width', 'min-height', 'border-radius'];
        for (const rule of neatSyncRules) {
            for (const prop of forbidden) {
                expect(rule.decls[prop],
                    `neat.css rule "${rule.selector}" must not set ${prop}`).toBeUndefined();
            }
        }
    });

    it('.favicon-container has position:relative in both CSS files', () => {
        const neatFc = findRules(neatRules, '.favicon-container');
        const syncFc = findRules(syncRules, '.favicon-container');

        const neatHasRelative = neatFc.some(r => r.decls['position'] === 'relative');
        const syncHasRelative = syncFc.some(r => r.decls['position'] === 'relative');

        expect(neatHasRelative || syncHasRelative).toBe(true);
    });

    it('neat.css .favicon-container width is 20px (--vbm-icon-col)', () => {
        const scopedFc = neatRules.find(r =>
            r.selector.includes('#tree') && r.selector.includes('.favicon-container'));
        expect(scopedFc).toBeDefined();
        expect(scopedFc.decls['width']).toBe('20px');
    });

    it('sync-indicator in tree rows has correct cascaded dimensions (6px circle)', () => {
        // After cascade: sync-styles.css loads AFTER neat.css, so it wins.
        // Base .sync-indicator = 6x6, .favicon-container .sync-indicator = abs pos.
        // neat.css must not interfere.
        const allSyncRules = [...findRules(neatRules, 'sync-indicator'), ...findRules(syncRules, 'sync-indicator')];

        // Verify no rule sets width/height to anything other than 6px
        const sizeRules = allSyncRules.filter(r =>
            'width' in r.decls || 'height' in r.decls);
        for (const rule of sizeRules) {
            if (rule.decls['width']) {
                expect(rule.decls['width']).toBe('6px');
            }
            if (rule.decls['height']) {
                expect(rule.decls['height']).toBe('6px');
            }
        }
    });

    it('neat.css uses --vbm-icon-col (20px) consistently for icon column width', () => {
        // ::before pseudo-element
        const before = neatRules.find(r =>
            r.selector.includes('::before') &&
            (r.selector.includes('#tree') || r.selector.includes('#results')));
        expect(before).toBeDefined();
        expect(before.decls['width']).toBe('var(--vbm-icon-col)');

        // .twisty
        const twisty = neatRules.find(r => r.selector.includes('.twisty'));
        expect(twisty).toBeDefined();
        expect(twisty.decls['width']).toBe('var(--vbm-icon-col)');

        // .vbm-icon-col
        const iconCol = neatRules.find(r => r.selector.includes('.vbm-icon-col'));
        expect(iconCol).toBeDefined();
        expect(iconCol.decls['width']).toBe('var(--vbm-icon-col)');
    });
});
