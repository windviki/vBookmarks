/**
 * Clipboard module suite (velvet staging §6) — drives the real
 * src/clipboard.js: the three folder-list formatters (pure) and the
 * clipboard write path with its fallback chain.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
    writeText, formatAsText, formatAsMarkdown, formatAsJson, FORMATTERS
} from '../src/clipboard.js';

const ITEMS = [
    { title: 'GitHub', url: 'https://github.com/' },
    { title: '', url: 'https://example.com/' }, // untitled → url fallback
    { title: 'Weird ] title [', url: 'https://w.example/a(b)c' },
    { title: 'Multi\nline', url: 'https://m.example/' }
];

describe('formatAsText (§6.1 plain list)', () => {
    it('writes title-line + url-line per bookmark, blank line between entries', () => {
        // untitled entries fall back to the url on the title line (the same
        // fallback the markdown/json formatters use)
        expect(formatAsText(ITEMS.slice(0, 2))).toBe(
            'GitHub\nhttps://github.com/\n\nhttps://example.com/\nhttps://example.com/'
        );
    });

    it('handles empty input without noise', () => {
        expect(formatAsText([])).toBe('');
        expect(formatAsText(undefined)).toBe('');
    });
});

describe('formatAsMarkdown (§6.1 markdown)', () => {
    it('emits one - [title](url) line per bookmark', () => {
        expect(formatAsMarkdown([{ title: 'A', url: 'https://a/' }])).toBe('- [A](https://a/)');
    });

    it('escapes brackets in the title and parens in the url, folds newlines', () => {
        const out = formatAsMarkdown(ITEMS.slice(2, 4));
        const lines = out.split('\n');
        expect(lines[0]).toBe('- [Weird \\] title \\[](https://w.example/a\\(b\\)c)');
        expect(lines[1]).toBe('- [Multi line](https://m.example/)'); // \n → space
    });

    it('untitled bookmarks fall back to the url as the link text', () => {
        expect(formatAsMarkdown([{ title: '', url: 'https://x.example/' }]))
            .toBe('- [https://x.example/](https://x.example/)');
    });
});

describe('formatAsJson (§6.1 json)', () => {
    it('emits a flat 2-space-indented array of {title, url}', () => {
        expect(formatAsJson([{ title: 'A', url: 'https://a/' }])).toBe(
            `[
  {
    "title": "A",
    "url": "https://a/"
  }
]`
        );
    });

    it('keeps the full list order and untitled fallback', () => {
        const parsed = JSON.parse(formatAsJson(ITEMS));
        expect(parsed).toHaveLength(4);
        expect(parsed[1]).toEqual({ title: 'https://example.com/', url: 'https://example.com/' });
    });
});

describe('FORMATTERS registry', () => {
    it('maps the three menu formats', () => {
        expect(FORMATTERS.text).toBe(formatAsText);
        expect(FORMATTERS.markdown).toBe(formatAsMarkdown);
        expect(FORMATTERS.json).toBe(formatAsJson);
    });
});

describe('writeText fallback chain', () => {
    const realNavigator = globalThis.navigator;
    const realDocument = globalThis.document;
    const setNavigator = value => {
        Object.defineProperty(globalThis, 'navigator', {
            value, configurable: true, writable: true
        });
    };
    const setDocument = value => {
        Object.defineProperty(globalThis, 'document', {
            value, configurable: true, writable: true
        });
    };
    afterEach(() => {
        setNavigator(realNavigator);
        setDocument(realDocument);
    });

    it('prefers navigator.clipboard.writeText and reports success', async () => {
        const calls = [];
        setNavigator({ clipboard: { writeText: async t => { calls.push(t); } } });
        await expect(writeText('hello')).resolves.toBe(true);
        expect(calls).toEqual(['hello']);
    });

    it('falls back to the textarea + execCommand path on rejection', async () => {
        setNavigator({ clipboard: { writeText: async () => { throw new Error('gone'); } } });
        const ta = {
            value: '', removed: false,
            select() {}, remove() { this.removed = true; }
        };
        const body = { children: [], appendChild(c) { this.children.push(c); } };
        setDocument({
            createElement: () => ta,
            body,
            execCommand: () => true
        });
        await expect(writeText('fallback')).resolves.toBe(true);
        expect(ta.value).toBe('fallback');
        expect(ta.removed).toBe(true);
    });

    it('returns false with no clipboard path at all', async () => {
        setNavigator(undefined);
        setDocument(undefined);
        await expect(writeText('x')).resolves.toBe(false);
    });
});
