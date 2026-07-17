import { describe, it, expect } from 'vitest';
import { rankBookmarks, xmlEncode, matcher } from '../src/search-core.js';

const bm = (title, dateAdded, url = 'https://example.com/') => ({ title, url, dateAdded });

describe('rankBookmarks', () => {
    it('produces stable ordering across repeated sorts with the same query', () => {
        // Regression test for the old `g`-flagged vPattern: RegExp#test with
        // the global flag mutates lastIndex, making the comparator
        // inconsistent across calls.
        const make = () => [
            bm('git gud guide', 1),
            bm('GitHub', 2),
            bm('gitlab snippets', 3),
            bm('hub git tools', 4),
            bm('GitHub Gist', 5)
        ];
        const first = rankBookmarks('git hub', make()).map(r => r.title);
        const second = rankBookmarks('git hub', make()).map(r => r.title);
        expect(second).toEqual(first);
    });

    it('prefers titles where the query hits earlier', () => {
        const results = rankBookmarks('git', [
            bm('a git client', 10),
            bm('GitHub', 1)
        ]);
        expect(results[0].title).toBe('GitHub');
    });

    it('ranks pattern-matching titles above non-matching ones', () => {
        // 'git hub' is not a literal substring anywhere; the `^git.*hub`
        // pattern only matches 'GitHub'
        const results = rankBookmarks('git hub', [
            bm('git gud guide', 100),
            bm('GitHub', 1)
        ]);
        expect(results[0].title).toBe('GitHub');
    });

    it('falls back to dateAdded (newest first) when nothing matches', () => {
        const results = rankBookmarks('zzz', [
            bm('old bookmark', 1),
            bm('new bookmark', 200),
            bm('mid bookmark', 100)
        ]);
        expect(results.map(r => r.title)).toEqual([
            'new bookmark', 'mid bookmark', 'old bookmark'
        ]);
    });

    it('returns at most 6 results', () => {
        const results = rankBookmarks('a', [
            bm('a1', 1), bm('a2', 2), bm('a3', 3), bm('a4', 4),
            bm('a5', 5), bm('a6', 6), bm('a7', 7), bm('a8', 8)
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
