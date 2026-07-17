import { describe, it, expect } from 'vitest';
import { StringList, isBlank, SeparatorManager } from '../src/separators.js';

// Direct ESM import of the real module (no sandbox) — separators.js is
// chrome-free: the storage mirror is injected into SeparatorManager.
const makeStore = (data = {}) => ({
    get: key => data[key],
    set: (key, value) => { data[key] = value; },
    _data: data
});

describe('StringList', () => {
    it('append coerces to string and skips empty input', () => {
        const list = new StringList();
        list.append('a');
        list.append(5);
        list.append('');
        expect(list._strings_).toEqual(['a', '5']);
    });

    it('remove deletes only the first match', () => {
        const list = new StringList();
        list.fromString('a,b,a');
        list.remove('a');
        expect(list._strings_).toEqual(['b', 'a']);
        list.remove('missing');
        expect(list.size()).toBe(2);
    });

    it('replace rewrites every match', () => {
        const list = new StringList();
        list.fromString('a,b,a');
        list.replace('a', 'z');
        expect(list._strings_).toEqual(['z', 'b', 'z']);
    });

    it('fromString/toString round-trip; fromString("") keeps the list', () => {
        const list = new StringList();
        list.fromString('x,y');
        expect(list.toString()).toBe('x,y');
        list.fromString('');
        expect(list.toString()).toBe('x,y');
        list.clear();
        expect(list.size()).toBe(0);
        expect(list.toString()).toBe('');
    });
});

describe('isBlank', () => {
    it('treats null-ish and whitespace-only as blank', () => {
        expect(isBlank(undefined)).toBe(true);
        expect(isBlank(null)).toBe(true);
        expect(isBlank('')).toBe(true);
        expect(isBlank('   ')).toBe(true);
        expect(isBlank('\t\n')).toBe(true);
    });

    it('treats non-whitespace content as not blank', () => {
        expect(isBlank('a')).toBe(false);
        expect(isBlank(' a ')).toBe(false);
    });
});

describe('SeparatorManager', () => {
    it('falls back to defaults when the store is empty or blank', () => {
        const sm = new SeparatorManager(makeStore());
        expect(sm.separatorTitle).toBe('|');
        expect(sm.separatorURL).toBe('http://separatethis.com/');
        expect(sm.separatorString).toEqual(['separatethis.com']);

        const blank = new SeparatorManager(makeStore({
            separatorTitle: '   ',
            separatorURL: '',
            separatorString: ' '
        }));
        expect(blank.separatorTitle).toBe('|');
        expect(blank.separatorURL).toBe('http://separatethis.com/');
        expect(blank.separatorString).toEqual(['separatethis.com']);
    });

    it('reads configured values (separatorString splits on ";")', () => {
        const sm = new SeparatorManager(makeStore({
            separatorTitle: '-',
            separatorURL: 'http://example.com/sep',
            separatorString: 'foo;bar'
        }));
        expect(sm.separatorTitle).toBe('-');
        expect(sm.separatorURL).toBe('http://example.com/sep');
        expect(sm.separatorString).toEqual(['foo', 'bar']);
    });

    it('isSeparator matches URL prefix first, then substrings of length > 1', () => {
        const sm = new SeparatorManager(makeStore({ separatorString: 'marker;x' }));
        expect(sm.isSeparator('', 'http://separatethis.com/#abc')).toBe(true);
        expect(sm.isSeparator('', 'https://site.test/marker-page')).toBe(true);
        // single-character separator strings are ignored
        expect(sm.isSeparator('', 'https://x.test/')).toBe(false);
        expect(sm.isSeparator('', 'https://example.com/')).toBe(false);
    });

    it('add dedupes; update/remove/getAll/size manage the id list', () => {
        const sm = new SeparatorManager(makeStore());
        sm.add('10');
        sm.add('10');
        sm.add('20');
        expect(sm.getAll()).toEqual(['10', '20']);
        expect(sm.size()).toBe(2);
        sm.update('10', '30');
        expect(sm.getAll()).toEqual(['30', '20']);
        sm.remove('20');
        expect(sm.getAll()).toEqual(['30']);
    });

    it('load/save round-trip through the separators storage key; clear resets it', () => {
        const store = makeStore({ separators: '1,2,3' });
        const sm = new SeparatorManager(store);
        sm.load();
        expect(sm.getAll()).toEqual(['1', '2', '3']);
        sm.remove('2');
        sm.save();
        expect(store._data.separators).toBe('1,3');
        sm.clear();
        expect(store._data.separators).toBe('');
        expect(sm.size()).toBe(0);
    });
});
