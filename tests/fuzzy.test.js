import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Load the real fuzzy.js source and evaluate it in a sandbox with a bare
// window global — the same way a classic script would run inside popup.html.
const fuzzySource = fs.readFileSync(new URL('../fuzzy.js', import.meta.url), 'utf8');
const window = {};
new Function('window', fuzzySource)(window);
const VBMFuzzy = window.VBMFuzzy;

const item = (id, title, url, dateAdded, isFolder = false) =>
    ({ id, parentId: '0', title, url, dateAdded, isFolder });

describe('fuzzy.js score()', () => {
    it('matches a subsequence and reports its positions', () => {
        const res = VBMFuzzy.score('vbm', 'vBookmarks');
        expect(res).not.toBeNull();
        expect(res.positions).toEqual([0, 1, 5]);
        expect(typeof res.score).toBe('number');
    });

    it('is case-insensitive', () => {
        expect(VBMFuzzy.score('GM', 'gmail')).not.toBeNull();
        expect(VBMFuzzy.score('gm', 'GMail')).not.toBeNull();
    });

    it('returns null when the query is not a subsequence', () => {
        expect(VBMFuzzy.score('xyz', 'gmail')).toBeNull();
        expect(VBMFuzzy.score('gmaill', 'gmail')).toBeNull();
    });

    it('matches CJK strings', () => {
        const res = VBMFuzzy.score('书签', '我的书签收藏');
        expect(res).not.toBeNull();
        expect(res.positions).toEqual([2, 3]);
    });

    it('treats an empty query as matching everything with score 0', () => {
        expect(VBMFuzzy.score('', 'anything')).toEqual({ score: 0, positions: [] });
    });

    it('rewards consecutive runs over scattered hits', () => {
        const consecutive = VBMFuzzy.score('abc', 'abc');
        const scattered = VBMFuzzy.score('abc', 'a-b-c');
        expect(consecutive.score).toBeGreaterThan(scattered.score);
    });

    it('rewards word-start / camelCase hits over mid-word hits', () => {
        const wordStart = VBMFuzzy.score('bar', 'Foo Bar');
        const midWord = VBMFuzzy.score('bar', 'zebar');
        expect(wordStart.score).toBeGreaterThan(midWord.score);
        const camel = VBMFuzzy.score('bm', 'BookMark');
        expect(camel.positions).toEqual([0, 4]);
    });

    it('prefers matches that start earlier', () => {
        const early = VBMFuzzy.score('gm', 'gmx');
        const late = VBMFuzzy.score('gm', 'xxgm');
        expect(early.score).toBeGreaterThan(late.score);
    });
});

describe('fuzzy.js rank()', () => {
    it('weighs title hits above url hits', () => {
        const results = VBMFuzzy.rank('gmail', [
            item('1', 'mail archive', 'https://gmail.com/inbox', 100),
            item('2', 'Gmail', 'https://example.com', 50)
        ]);
        expect(results.map(r => r.id)).toEqual(['2', '1']);
    });

    it('exposes title positions for highlighting, null for url-only hits', () => {
        const results = VBMFuzzy.rank('gmail', [
            item('1', 'zzz', 'https://gmail.com/', 100),
            item('2', 'Gmail', 'https://example.com/', 50)
        ]);
        const byId = Object.fromEntries(results.map(r => [r.id, r]));
        expect(byId['2'].positions).toEqual([0, 1, 2, 3, 4]);
        expect(byId['1'].positions).toBeNull();
    });

    it('drops non-matching items and keeps folders', () => {
        const results = VBMFuzzy.rank('zzz', [
            item('1', 'Gmail', 'https://gmail.com/', 100),
            item('2', 'Zazzle folder', '', 90, true)
        ]);
        expect(results).toHaveLength(1);
        expect(results[0].isFolder).toBe(true);
    });

    it('sorts by score desc, then dateAdded desc for ties', () => {
        const results = VBMFuzzy.rank('gmail', [
            item('1', 'Gmail', 'https://a.example/', 100),
            item('2', 'Gmail', 'https://b.example/', 300),
            item('3', 'Gmail', 'https://c.example/', 200)
        ]);
        expect(results.map(r => r.id)).toEqual(['2', '3', '1']);
    });

    it('returns every item for an empty query, ordered by dateAdded desc', () => {
        const results = VBMFuzzy.rank('', [
            item('1', 'a', 'https://a.example/', 100),
            item('2', 'b', 'https://b.example/', 200)
        ]);
        expect(results.map(r => r.id)).toEqual(['2', '1']);
    });

    it('ranks 10k items in under 50ms', () => {
        const items = [];
        for (let i = 0; i < 10000; i++) {
            items.push(item(`${i}`, `Bookmark number ${i} about bookmarking`,
                `https://example.com/some/page/${i}`, i));
        }
        const start = performance.now();
        const results = VBMFuzzy.rank('bmk', items);
        const elapsed = performance.now() - start;
        expect(results.length).toBeGreaterThan(0);
        expect(elapsed).toBeLessThan(50);
    });
});

// Phase 2b CSS/wiring contract: panel-mode + empty-state styles exist,
// popup.html loads fuzzy.js before neat.js.
describe('phase 2b wiring', () => {
    const neatCss = fs.readFileSync(new URL('../neat.css', import.meta.url), 'utf8');
    const popupHtml = fs.readFileSync(new URL('../popup.html', import.meta.url), 'utf8');

    it('neat.css defines panel-mode and empty-state styles', () => {
        expect(neatCss).toContain('body.panel-mode');
        expect(neatCss).toContain('.empty-state');
        expect(neatCss).toContain('.empty-folder');
        expect(neatCss).toContain('#results mark');
    });

    it('popup.html loads fuzzy.js before neat.js', () => {
        const fuzzyAt = popupHtml.indexOf('<script src="fuzzy.js"></script>');
        const neatAt = popupHtml.indexOf('<script src="neat.js"></script>');
        expect(fuzzyAt).toBeGreaterThan(-1);
        expect(neatAt).toBeGreaterThan(-1);
        expect(fuzzyAt).toBeLessThan(neatAt);
    });

    it('sidepanel.html mirrors popup.html (panel-mode body, same scripts)', () => {
        const sidepanelHtml = fs.readFileSync(new URL('../sidepanel.html', import.meta.url), 'utf8');
        // side_panel.default_path rejects query strings (verified on Chrome 124):
        // the panel page is a copy of popup.html carrying panel-mode on <body>.
        expect(sidepanelHtml).toContain('<body class="panel-mode">');
        const scriptsOf = html => [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
        expect(scriptsOf(sidepanelHtml)).toEqual(scriptsOf(popupHtml));
    });

    it('manifest side_panel.default_path has no query string', () => {
        const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
        expect(manifest.side_panel.default_path).toBe('sidepanel.html');
        expect(manifest.side_panel.default_path).not.toContain('?');
    });
});
