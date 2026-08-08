import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Phase 2a design-token contract: the 12 core tokens must exist in :root,
// be overridden for the explicit dark theme, and have a prefers-color-scheme
// fallback for the "auto" theme. The theme option labels must exist in en
// (the default locale) and zh_CN.
const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
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

    // The explicit fable-taste themes (ink = dark, paper = light) must be
    // complete token overrides too; partial blocks would fall back to the
    // default light tokens and visually break.
    it.each(['ink', 'paper'])('overrides all 12 tokens in body[data-theme="%s"]', name => {
        const block = extractBlock(neatCss, `body[data-theme="${name}"]`);
        expect(block).not.toBe('');
        for (const token of TOKENS) {
            expect(block).toContain(`${token}:`);
        }
    });

    it('has a prefers-color-scheme dark fallback for body[data-theme="auto"]', () => {
        const mediaBlock = extractBlock(neatCss, '@media (prefers-color-scheme: dark)');
        expect(mediaBlock).not.toBe('');
        expect(mediaBlock).toContain('body[data-theme="auto"]');
    });
});

// Third-round item 5 — four themes, one level of finish.
// (a) Every theme block overrides the SAME full color-token set (structural
//     tokens --vbm-radius/--vbm-row-h stay :root-only by design).
// (b) Badge on-colors meet WCAG AA (4.5:1) against their fill in every
//     theme — white on the pale dark-theme danger fills was 2.4:1 before
//     --vbm-danger-fg existed.
describe('theme parity & badge contrast (third-round item 5)', () => {
    const COLOR_TOKENS = [
        ...TOKENS,
        '--vbm-scrim', '--vbm-shadow', '--vbm-flash',
        '--vbm-scrollbar', '--vbm-scrollbar-hover',
        '--vbm-warning', '--vbm-danger-fg', '--vbm-warning-fg'
    ];
    const THEME_BLOCKS = {
        light: extractBlock(neatCss, ':root'),
        dark: extractBlock(neatCss, 'body[data-theme="dark"]'),
        auto: extractBlock(neatCss, 'body[data-theme="auto"]'),
        ink: extractBlock(neatCss, 'body[data-theme="ink"]'),
        paper: extractBlock(neatCss, 'body[data-theme="paper"]')
    };

    it.each(Object.keys(THEME_BLOCKS))('body[data-theme="%s"] overrides the full color-token set', name => {
        const block = THEME_BLOCKS[name];
        expect(block, `block for ${name} exists`).not.toBe('');
        for (const token of COLOR_TOKENS) {
            expect(block, `${token} in ${name}`).toContain(`${token}:`);
        }
    });

    const lum = hex => {
        let h = hex.replace('#', '');
        if (h.length === 3) h = [...h].map(c => c + c).join('');
        const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
        const f = c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    const tokenValue = (block, token) => {
        const m = block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{3,8})`));
        expect(m, `${token} is a hex color`).toBeTruthy();
        return m[1];
    };

    it.each(Object.keys(THEME_BLOCKS))('badge on-colors reach 4.5:1 AA in "%s"', name => {
        const block = THEME_BLOCKS[name];
        const pairs = [
            ['--vbm-danger-fg', '--vbm-danger'],
            ['--vbm-warning-fg', '--vbm-warning'],
            ['--vbm-accent-fg', '--vbm-accent']
        ];
        for (const [fg, bg] of pairs) {
            const ratio = contrast(tokenValue(block, fg), tokenValue(block, bg));
            expect(ratio, `${fg} on ${bg} in ${name}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('danger/warning fills always pair with their on-color token, never raw #fff/#000', () => {
        const fillRules = neatCss.match(/[^{}]*background:\s*var\(--vbm-(danger|warning)\)[^{}]*/g) || [];
        expect(fillRules.length).toBeGreaterThanOrEqual(4); // tab-badge, row-badge ×2, dead-indicator
        for (const rule of fillRules) {
            expect(rule).not.toMatch(/color:\s*#(fff|000|ffffff|000000)\b/);
            expect(rule).toMatch(/color:\s*var\(--vbm-(danger|warning)-fg\)/);
        }
    });
});

describe('theme i18n messages', () => {
    const KEYS = ['optionTheme', 'optionThemeAuto', 'optionThemeLight', 'optionThemeDark',
        'optionThemeInk', 'optionThemePaper'];

    it('defines the 6 theme option keys in en', () => {
        for (const key of KEYS) {
            expect(enMessages[key], key).toBeDefined();
            expect(enMessages[key].message).toBeTruthy();
        }
    });

    it('defines the 6 theme option keys in zh_CN', () => {
        for (const key of KEYS) {
            expect(zhCNMessages[key], key).toBeDefined();
            expect(zhCNMessages[key].message).toBeTruthy();
        }
    });
});
