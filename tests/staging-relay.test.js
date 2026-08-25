import { describe, it, expect } from 'vitest';
import {
    isStagedUrl, stageBtnHtml, flipStageBtn, toggleStageItem
} from '../src/staging-relay.js';

// staging-relay.js (2026-08 relay round) is the shared 发送到暂存 row-button
// recipe — pure DOM/i18n over an injected staging api. The doubles below
// record the api calls; the button doubles carry the class/attribute surface
// flipStageBtn mutates.

const _m = key => key;

const makeApi = (staged = []) => {
    const calls = { added: [], removed: [] };
    const set = new Set(staged);
    return {
        calls,
        isStaged: url => set.has(url),
        addItems: items => { calls.added.push(items); },
        removeByUrl: url => { calls.removed.push(url); }
    };
};

const makeBtn = () => {
    const classes = new Set();
    const attrs = {};
    return {
        classes,
        innerHTML: '',
        title: '',
        get classList() {
            return {
                add: c => classes.add(c),
                remove: c => classes.delete(c),
                toggle: (c, on) => {
                    const want = on === undefined ? !classes.has(c) : !!on;
                    if (want)
                        classes.add(c);
                    else
                        classes.delete(c);
                },
                contains: c => classes.has(c)
            };
        },
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute: k => attrs[k],
        attrs
    };
};

describe('isStagedUrl', () => {
    it('reads the staged verdict through the api, guarding nulls', () => {
        expect(isStagedUrl(makeApi(['http://a/']), 'http://a/')).toBe(true);
        expect(isStagedUrl(makeApi(['http://a/']), 'http://b/')).toBe(false);
        expect(isStagedUrl(null, 'http://a/')).toBe(false);
        expect(isStagedUrl({}, 'http://a/')).toBe(false); // no isStaged fn
        expect(isStagedUrl(makeApi(['http://a/']), '')).toBe(false);
    });
});

describe('stageBtnHtml', () => {
    it('renders the unstaged plane: add label, aria-pressed false', () => {
        const html = stageBtnHtml(makeApi([]), { url: 'http://a/' }, _m);
        expect(html).toContain('class="row-btn staging-add-btn"');
        expect(html).toContain('aria-pressed="false"');
        expect(html).toContain('aria-label="stagingAdd"');
        expect(html).toContain('title="stagingAdd"');
    });

    it('renders the staged accent: filled plane, remove label', () => {
        const html = stageBtnHtml(makeApi(['http://a/']), { url: 'http://a/' }, _m);
        expect(html).toContain('staging-add-btn staged');
        expect(html).toContain('aria-pressed="true"');
        expect(html).toContain('aria-label="stagingRemove"');
    });

    it('escapes the label for the attribute contexts', () => {
        const m = (key) => (key === 'stagingAdd' ? 'Add "me"' : key);
        const html = stageBtnHtml(makeApi([]), { url: 'http://a/' }, m);
        expect(html).toContain('aria-label="Add &quot;me&quot;"');
    });
});

describe('flipStageBtn', () => {
    it('flips icon, accent and labels in place without a re-render', () => {
        const btn = makeBtn();
        flipStageBtn(btn, true, _m);
        expect(btn.classes.has('staged')).toBe(true);
        expect(btn.attrs['aria-pressed']).toBe('true');
        expect(btn.attrs['aria-label']).toBe('stagingRemove');
        expect(btn.title).toBe('stagingRemove');
        expect(btn.innerHTML).not.toBe('');
        flipStageBtn(btn, false, _m);
        expect(btn.classes.has('staged')).toBe(false);
        expect(btn.attrs['aria-pressed']).toBe('false');
        expect(btn.attrs['aria-label']).toBe('stagingAdd');
    });

    it('guards hand-written doubles that lack the attribute surface', () => {
        expect(() => flipStageBtn(null, true, _m)).not.toThrow();
        expect(() => flipStageBtn({ innerHTML: '' }, true, _m)).not.toThrow();
    });
});

describe('toggleStageItem', () => {
    it('unstaged → addItems with the dual-state snapshot shape, returns true', () => {
        const api = makeApi([]);
        const out = toggleStageItem(api, { id: '7', url: 'http://a/', title: 'A' });
        expect(out).toBe(true);
        expect(api.calls.added).toEqual([[{ id: '7', url: 'http://a/', title: 'A' }]]);
    });

    it('an unfav row (id null) stages as a url/title snapshot', () => {
        const api = makeApi([]);
        toggleStageItem(api, { id: null, url: 'http://h/', title: 'H' });
        expect(api.calls.added).toEqual([[{ id: null, url: 'http://h/', title: 'H' }]]);
    });

    it('staged → removeByUrl, returns false', () => {
        const api = makeApi(['http://a/']);
        expect(toggleStageItem(api, { id: '7', url: 'http://a/', title: 'A' })).toBe(false);
        expect(api.calls.removed).toEqual(['http://a/']);
        expect(api.calls.added).toEqual([]);
    });

    it('returns null when the api or the item url is missing', () => {
        expect(toggleStageItem(null, { url: 'http://a/' })).toBeNull();
        expect(toggleStageItem(makeApi([]), null)).toBeNull();
        expect(toggleStageItem(makeApi([]), { id: '7', title: 'no url' })).toBeNull();
    });
});
