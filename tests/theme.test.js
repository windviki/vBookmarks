import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Phase 2a design-token contract: the 12 core tokens must exist in :root,
// be overridden for the explicit dark theme, and have a prefers-color-scheme
// fallback for the "auto" theme. The theme option labels must exist in en
// (the default locale) and zh_CN.
const neatCss = fs.readFileSync(new URL('../neat.css', import.meta.url), 'utf8');
const enMessages = JSON.parse(fs.readFileSync(new URL('../_locales/en/messages.json', import.meta.url), 'utf8'));
const zhCNMessages = JSON.parse(fs.readFileSync(new URL('../_locales/zh_CN/messages.json', import.meta.url), 'utf8'));

const TOKENS = [
    '--vbm-bg',
    '--vbm-bg-elev',
    '--vbm-bg-hover',
    '--vbm-bg-selected',
    '--vbm-fg',
    '--vbm-fg-selected',
    '--vbm-muted',
    '--vbm-border',
    '--vbm-accent',
    '--vbm-accent-fg',
    '--vbm-focus-ring',
    '--vbm-danger'
];

// Extract the body of the first block opened after `selector`, honoring
// nested braces (needed for @media blocks).
const extractBlock = (css, selector) => {
    const start = css.indexOf(selector);
    if (start === -1) return '';
    const open = css.indexOf('{', start);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}') {
            depth--;
            if (depth === 0) return css.slice(open + 1, i);
        }
    }
    return '';
};

describe('theme design tokens in neat.css', () => {
    const rootBlock = extractBlock(neatCss, ':root');
    const darkBlock = extractBlock(neatCss, 'body[data-theme="dark"]');

    it('defines all 12 tokens in :root', () => {
        expect(rootBlock).not.toBe('');
        for (const token of TOKENS) {
            expect(rootBlock).toContain(`${token}:`);
        }
    });

    it('overrides all 12 tokens in body[data-theme="dark"]', () => {
        expect(darkBlock).not.toBe('');
        for (const token of TOKENS) {
            expect(darkBlock).toContain(`${token}:`);
        }
    });

    it('has a prefers-color-scheme dark fallback for body[data-theme="auto"]', () => {
        const mediaBlock = extractBlock(neatCss, '@media (prefers-color-scheme: dark)');
        expect(mediaBlock).not.toBe('');
        expect(mediaBlock).toContain('body[data-theme="auto"]');
    });
});

describe('theme i18n messages', () => {
    const KEYS = ['optionTheme', 'optionThemeAuto', 'optionThemeLight', 'optionThemeDark'];

    it('defines the 4 theme option keys in en', () => {
        for (const key of KEYS) {
            expect(enMessages[key], key).toBeDefined();
            expect(enMessages[key].message).toBeTruthy();
        }
    });

    it('defines the 4 theme option keys in zh_CN', () => {
        for (const key of KEYS) {
            expect(zhCNMessages[key], key).toBeDefined();
            expect(zhCNMessages[key].message).toBeTruthy();
        }
    });
});
