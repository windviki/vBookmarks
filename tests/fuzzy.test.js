import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
// The implementation lives in fuzzy-core.js (shared with search-core.js);
// fuzzy.js is now just a thin module that re-exposes it as window.VBMFuzzy.
import { score, rank } from '../src/fuzzy-core.js';

const item = (id, title, url, dateAdded, isFolder = false) =>
    ({ id, parentId: '0', title, url, dateAdded, isFolder });

describe('fuzzy.js score()', () => {
    it('matches a subsequence and reports its positions', () => {
        const res = score('vbm', 'vBookmarks');
        expect(res).not.toBeNull();
        expect(res.positions).toEqual([0, 1, 5]);
        expect(typeof res.score).toBe('number');
    });

    it('is case-insensitive', () => {
        expect(score('GM', 'gmail')).not.toBeNull();
        expect(score('gm', 'GMail')).not.toBeNull();
    });

    it('returns null when the query is not a subsequence', () => {
        expect(score('xyz', 'gmail')).toBeNull();
        expect(score('gmaill', 'gmail')).toBeNull();
    });

    it('matches CJK strings', () => {
        const res = score('书签', '我的书签收藏');
        expect(res).not.toBeNull();
        expect(res.positions).toEqual([2, 3]);
    });

    it('treats an empty query as matching everything with score 0', () => {
        expect(score('', 'anything')).toEqual({ score: 0, positions: [] });
    });

    it('rewards consecutive runs over scattered hits', () => {
        const consecutive = score('abc', 'abc');
        const scattered = score('abc', 'a-b-c');
        expect(consecutive.score).toBeGreaterThan(scattered.score);
    });

    it('rewards word-start / camelCase hits over mid-word hits', () => {
        const wordStart = score('bar', 'Foo Bar');
        const midWord = score('bar', 'zebar');
        expect(wordStart.score).toBeGreaterThan(midWord.score);
        const camel = score('bm', 'BookMark');
        expect(camel.positions).toEqual([0, 4]);
    });

    it('prefers matches that start earlier', () => {
        const early = score('gm', 'gmx');
        const late = score('gm', 'xxgm');
        expect(early.score).toBeGreaterThan(late.score);
    });
});

describe('fuzzy.js case folding that changes the string length', () => {
    // 'İ'.toLowerCase() is TWO chars ('i' + U+0307): positions computed on
    // the lowercased copy used to shift every later index, so the <mark>
    // highlight (tree-render.js's highlightTitlePositions) silently dropped
    // or misplaced hits. positions must index into the ORIGINAL string.
    it('reports original-string indices for score(\'x\', \'İx\')', () => {
        const res = score('x', 'İx');
        expect(res).not.toBeNull();
        expect(res.positions).toEqual([1]);
    });

    it('keeps multi-char matches consecutive in original indices', () => {
        const res = score('ix', 'İx'); // fold: 'i̇x' — 'i'@0, 'x'@2 → originals 0, 1
        expect(res).not.toBeNull();
        expect(res.positions).toEqual([0, 1]);
    });

    it('rank() exposes original indices for titles with length-shifting folds', () => {
        const results = rank('x', [
            item('folded', 'İx', 'https://a.example/', 100),
            item('plain', 'zx', 'https://b.example/', 50)
        ]);
        const byId = Object.fromEntries(results.map(r => [r.id, r]));
        expect(byId.folded.positions).toEqual([1]); // highlightTitlePositions-safe
        expect(byId.plain.positions).toEqual([1]);
    });

    it('same-length folds keep the fast path (identical behavior)', () => {
        expect(score('ab', 'AB').positions).toEqual([0, 1]);
        expect(score('ss', 'SS').positions).toEqual([0, 1]);
    });
});

describe('fuzzy.js rank()', () => {
    it('weighs title hits above url hits', () => {
        const results = rank('gmail', [
            item('1', 'mail archive', 'https://gmail.com/inbox', 100),
            item('2', 'Gmail', 'https://example.com', 50)
        ]);
        expect(results.map(r => r.id)).toEqual(['2', '1']);
    });

    it('exposes title positions for highlighting, null for url-only hits', () => {
        const results = rank('gmail', [
            item('1', 'zzz', 'https://gmail.com/', 100),
            item('2', 'Gmail', 'https://example.com/', 50)
        ]);
        const byId = Object.fromEntries(results.map(r => [r.id, r]));
        expect(byId['2'].positions).toEqual([0, 1, 2, 3, 4]);
        expect(byId['1'].positions).toBeNull();
    });

    it('drops non-matching items and keeps folders', () => {
        const results = rank('zzz', [
            item('1', 'Gmail', 'https://gmail.com/', 100),
            item('2', 'Zazzle folder', '', 90, true)
        ]);
        expect(results).toHaveLength(1);
        expect(results[0].isFolder).toBe(true);
    });

    it('sorts by score desc, then dateAdded desc for ties', () => {
        const results = rank('gmail', [
            item('1', 'Gmail', 'https://a.example/', 100),
            item('2', 'Gmail', 'https://b.example/', 300),
            item('3', 'Gmail', 'https://c.example/', 200)
        ]);
        expect(results.map(r => r.id)).toEqual(['2', '3', '1']);
    });

    it('returns every item for an empty query, ordered by dateAdded desc', () => {
        const results = rank('', [
            item('1', 'a', 'https://a.example/', 100),
            item('2', 'b', 'https://b.example/', 200)
        ]);
        expect(results.map(r => r.id)).toEqual(['2', '1']);
    });

    it('prefers a tighter subsequence when both are partial matches', () => {
        // Both are tier-3 subsequence hits. 'loose' scores higher without the
        // span penalty (a leading '12' run + boundary bonuses: 61 vs 57), so
        // this pair REVERSES pre-fix — it pins the span penalty itself. The
        // doc example (10.200.31.0 vs vs1-something2/version3.html) ranks the
        // same either way and cannot serve as the regression pin.
        const results = rank('123', [
            item('tight', '', 'web123', 100),
            item('loose', '', '12.x......3', 100)
        ]);
        expect(results.map(r => r.id)).toEqual(['tight', 'loose']);
        expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('ranks 10k items without algorithmic blowup (perf smoke)', () => {
        const items = [];
        for (let i = 0; i < 10000; i++) {
            items.push(item(`${i}`, `Bookmark number ${i} about bookmarking`,
                `https://example.com/some/page/${i}`, i));
        }
        const start = performance.now();
        const results = rank('bmk', items);
        const elapsed = performance.now() - start;
        expect(results.length).toBeGreaterThan(0);
        // Wall-clock guard against algorithmic regression only: local dev
        // lands ~50ms, but shared CI runners routinely run 2-4x slower, so
        // the threshold keeps ample headroom. A real blowup (e.g. accidental
        // O(n^2)) would take orders of magnitude longer and still trip this.
        expect(elapsed).toBeLessThan(250);
    });
});

describe('fuzzy.js rank precision tiers', () => {
    it('ranks an exact title above a prefix title, ignoring dateAdded', () => {
        const results = rank('git', [
            item('prefix', 'github', 'https://github.example/', 999),
            item('exact', 'git', 'https://git.example/', 100)
        ]);
        expect(results.map(r => r.id)).toEqual(['exact', 'prefix']);
        expect(results[0].tier).toBe(0);
        expect(results[1].tier).toBe(1);
    });

    it('orders tiers 1 < 2 < 3 for the same query', () => {
        const results = rank('gb', [
            item('subseq', 'agb', 'https://a.example/', 300),
            item('wordstart', 'Git Bugs', 'https://b.example/', 200),
            item('prefix', 'gb tool', 'https://c.example/', 100)
        ]);
        expect(results.map(r => r.id)).toEqual(['prefix', 'wordstart', 'subseq']);
        expect(results.map(r => r.tier)).toEqual([1, 2, 3]);
    });

    it('lets an exact url hit outrank a loose title hit', () => {
        const results = rank('gmail', [
            item('loose-title', 'foo gmail', 'https://example.com/', 200),
            item('exact-url', 'mail archive', 'https://gmail.com/inbox', 100)
        ]);
        expect(results.map(r => r.id)).toEqual(['exact-url', 'loose-title']);
        expect(results[0].tier).toBe(1); // bare-host prefix
        expect(results[1].tier).toBe(3); // title subsequence
    });
});

describe('fuzzy.js URL noise stripping (scheme + www)', () => {
    it('scores equivalent hosts identically with and without www', () => {
        const results = rank('github', [
            item('bare', '', 'https://github.com/', 100),
            item('www', '', 'https://www.github.com/', 200)
        ]);
        expect(results).toHaveLength(2);
        expect(results[0].score).toBe(results[1].score);
        expect(results[0].tier).toBe(results[1].tier);
    });

    it('matches a bare scheme-less host', () => {
        const results = rank('github', [
            item('host', '', 'www.github.com', 100),
            item('other', '', 'https://example.com/', 50)
        ]);
        expect(results.map(r => r.id)).toEqual(['host']);
    });

    it('falls back to the raw url so a www query still hits', () => {
        const results = rank('www', [
            item('host', '', 'https://www.example.com/', 100)
        ]);
        expect(results.map(r => r.id)).toEqual(['host']);
    });

    it('falls back to the raw url so a scheme query still hits', () => {
        const results = rank('https', [
            item('host', '', 'https://github.com/', 100)
        ]);
        expect(results.map(r => r.id)).toEqual(['host']);
    });

    it('keeps TLDs intact: a .com query matches the .com host exactly', () => {
        const results = rank('github.com', [
            item('com', '', 'https://github.com', 100),
            item('io', '', 'https://github.io', 200)
        ]);
        expect(results.map(r => r.id)).toEqual(['com']);
        expect(results[0].tier).toBe(0); // bare === query
    });

    it('ranks a host hit above a path hit', () => {
        const results = rank('github', [
            item('path', '', 'https://example.com/github/', 200),
            item('host', '', 'https://github.com/', 100)
        ]);
        expect(results.map(r => r.id)).toEqual(['host', 'path']);
        expect(results[0].tier).toBe(1); // host prefix
        expect(results[1].tier).toBe(3); // path subsequence
    });
});

// Phase 2b CSS/wiring contract: panel-mode + empty-state styles exist,
// popup.html loads fuzzy.js before neat.js.
describe('phase 2b wiring', () => {
    const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
    const popupHtml = fs.readFileSync(new URL('../pages/popup.html', import.meta.url), 'utf8');

    it('neat.css defines panel-mode and empty-state styles', () => {
        expect(neatCss).toContain('body.panel-mode');
        expect(neatCss).toContain('.empty-state');
        expect(neatCss).toContain('.empty-folder');
        expect(neatCss).toContain('#results mark');
    });

    it('popup.html loads fuzzy.js (as a module) before neat.js', () => {
        const fuzzyAt = popupHtml.indexOf('<script type="module" src="/src/fuzzy.js"></script>');
        const neatAt = popupHtml.indexOf('<script type="module" src="/src/neat.js"></script>');
        expect(fuzzyAt).toBeGreaterThan(-1);
        expect(neatAt).toBeGreaterThan(-1);
        expect(fuzzyAt).toBeLessThan(neatAt);
    });

    it('sidepanel.html mirrors popup.html (panel-mode body, same scripts)', () => {
        const sidepanelHtml = fs.readFileSync(new URL('../pages/sidepanel.html', import.meta.url), 'utf8');
        // side_panel.default_path rejects query strings (verified on Chrome 124):
        // the panel page is a copy of popup.html carrying panel-mode on <body>.
        expect(sidepanelHtml).toContain('<body class="panel-mode">');
        // neat.js loads as an ES module (P1); classic scripts have no type attribute
        const scriptsOf = html => [...html.matchAll(/<script( type="module")? src="([^"]+)"><\/script>/g)].map(m => m[2]);
        expect(scriptsOf(sidepanelHtml)).toEqual(scriptsOf(popupHtml));
    });

    it('manifest side_panel.default_path has no query string', () => {
        const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
        expect(manifest.side_panel.default_path).toBe('pages/sidepanel.html');
        expect(manifest.side_panel.default_path).not.toContain('?');
    });
});
