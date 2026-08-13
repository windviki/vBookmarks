import { describe, it, expect } from 'vitest';
import { rankBookmarks, xmlEncode, matcher } from '../src/search-core.js';

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
});
