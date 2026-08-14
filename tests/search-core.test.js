import { describe, it, expect } from 'vitest';
import { rankBookmarks, xmlEncode, matcher } from '../src/search-core.js';
import { rank } from '../src/fuzzy-core.js';

const bm = (id, title, dateAdded, url = 'https://example.com/') => ({ id, title, url, dateAdded });

describe('rankBookmarks', () => {
    it('produces stable ordering across repeated sorts with the same query', () => {
        const make = () => [
            bm('1', 'git gud guide', 1),
            bm('2', 'GitHub', 2),
            bm('3', 'gitlab snippets', 3),
            bm('4', 'hub git tools', 4),
            bm('5', 'GitHub Gist', 5)
        ];
        const first = rankBookmarks('git', make()).map(r => r.title);
        const second = rankBookmarks('git', make()).map(r => r.title);
        expect(second).toEqual(first);
    });

    it('prefers a prefix title hit over a word-boundary hit', () => {
        const results = rankBookmarks('git', [
            bm('1', 'a git client', 10),
            bm('2', 'GitHub', 1)
        ]);
        expect(results[0].title).toBe('GitHub');
    });

    it('maps ranked hits back to the original objects (keeping extra fields)', () => {
        const original = { id: '42', title: 'GitHub', url: 'https://github.com', dateAdded: 1, syncing: true };
        const results = rankBookmarks('git', [original, bm('2', 'zzz', 2)]);
        expect(results).toHaveLength(1);
        expect(results[0]).toBe(original); // 原始引用,保留 syncing 等字段
    });

    it('filters out bookmarks the query does not match', () => {
        const results = rankBookmarks('zzz', [
            bm('1', 'old bookmark', 1),
            bm('2', 'new bookmark', 200),
            bm('3', 'mid bookmark', 100)
        ]);
        expect(results).toEqual([]);
    });

    it('returns at most 6 results', () => {
        const results = rankBookmarks('a', [
            bm('1', 'a1', 1), bm('2', 'a2', 2), bm('3', 'a3', 3), bm('4', 'a4', 4),
            bm('5', 'a5', 5), bm('6', 'a6', 6), bm('7', 'a7', 7), bm('8', 'a8', 8)
        ]);
        expect(results).toHaveLength(6);
    });
});

describe('xmlEncode', () => {
    it('escapes all five XML entities', () => {
        expect(xmlEncode(`<a href="x">&'</a>`))
            .toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
    });

    it('leaves plain text untouched', () => {
        expect(xmlEncode('plain text 123')).toBe('plain text 123');
    });
});

describe('matcher', () => {
    it('highlights every space-separated token', () => {
        const { text, matched } = matcher('foo xbar baz', 'foo bar');
        expect(matched).toBe(true);
        expect(text).toBe('<match>foo</match> x<match>bar</match> baz');
    });

    it('reports no match when nothing hits', () => {
        const { text, matched } = matcher('nothing here', 'zzz');
        expect(matched).toBe(false);
        expect(text).toBe('nothing here');
    });

    it('falls back to subsequence highlighting when no substring hits (B3)', () => {
        // "gub" is how "GitHub" gets RANKED (fzf subsequence) — the highlight
        // must not come back empty for the row the ranker put first
        const { text, matched } = matcher('GitHub', 'gub');
        expect(matched).toBe(true);
        expect(text).toBe('<match>G</match>itH<match>ub</match>');
    });

    it('per-word strategy: one word by substring, another by subsequence', () => {
        const { text, matched } = matcher('git gud guide', 'gud gg');
        expect(matched).toBe(true);
        // 'gud' hits as a substring; 'gg' only as a subsequence — greedy
        // leftmost g@0 ('git') then g@4 ('gud'), merging with the run
        const sub = matcher('gud guide', 'gg');
        expect(sub.matched).toBe(true);
        expect(sub.text).toBe('<match>g</match>ud <match>g</match>uide');
    });

    it('escapes regex metacharacters itself — raw queries are safe (B4)', () => {
        const dot = matcher('a.b (c) [d]', '.');
        expect(dot.matched).toBe(true);
        expect(dot.text).toBe('a<match>.</match>b (c) [d]');
        const paren = matcher('f(x)', '(');
        expect(paren.matched).toBe(true);
        expect(paren.text).toBe('f<match>(</match>x)');
        // a full metachar soup must not throw nor match spuriously
        const soup = matcher('plain title', '.*+?^${}()|[]\\');
        expect(soup.matched).toBe(false);
        expect(soup.text).toBe('plain title');
    });

    it('an empty or whitespace query never highlights anything', () => {
        expect(matcher('title', '')).toEqual({ text: 'title', matched: false });
        expect(matcher('title', '   ')).toEqual({ text: 'title', matched: false });
    });
});

describe('omnibox ↔ popup ranking parity (B5)', () => {
    it('rankBookmarks and fuzzy-core.rank agree on the top-6 id order', () => {
        const corpus = [
            bm('1', 'git gud guide', 1),
            bm('2', 'GitHub', 2),
            bm('3', 'gitlab snippets', 3, 'https://gitlab.com/snippets'),
            bm('4', 'hub git tools', 4),
            bm('5', 'GitHub Gist', 5, 'https://gist.github.com/'),
            bm('6', 'Vue docs', 6, 'https://vuejs.org/guide/'),
            bm('7', 'vue-api reference', 7, 'https://vuejs.org/api/'),
            bm('8', '我的书签收藏', 8),
            bm('9', '书签同步工具', 9),
            bm('10', 'API gateway', 10),
            bm('11', 'OpenAPI spec', 11),
            bm('12', 'unrelated thing', 12)
        ];
        // the popup path is window.VBMFuzzy.rank (the fuzzy-core module);
        // the omnibox path is rankBookmarks. Same corpus + query → same
        // order, or the two search surfaces drift apart silently.
        for (const q of ['git', 'gub', 'vue', '书签', 'api', 'guide gist', 'zzz']) {
            const omnibox = rankBookmarks(q, corpus).map(r => r.id);
            const popup = rank(q, corpus).map(r => r.id).slice(0, 6);
            expect(omnibox, `query "${q}"`).toEqual(popup);
        }
    });
});
