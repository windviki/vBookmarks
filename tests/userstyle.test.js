import { describe, it, expect } from 'vitest';
import { applyUserStyle } from '../src/userstyle.js';

// Minimal document stub — the module takes `doc` as a parameter (pure), so a
// plain object suffices. body.appendChild records order, which is the whole
// cascade contract: the userstyle <style> must be the LAST child (after the
// <head> stylesheet links in real document order → same-specificity rules win
// by source order).
const makeDoc = () => {
    const children = [];
    const body = {
        children,
        appendChild: el => { children.push(el); return el; }
    };
    return {
        body,
        createElement: tag => ({ tagName: tag, textContent: '' })
    };
};

describe('applyUserStyle', () => {
    it('returns null and touches nothing when the value is empty', () => {
        const doc = makeDoc();
        expect(applyUserStyle(doc, '')).toBeNull();
        expect(applyUserStyle(doc, undefined)).toBeNull();
        expect(applyUserStyle(doc, null)).toBeNull();
        expect(doc.body.children).toHaveLength(0);
    });

    it('returns null when the doc / body / createElement is unavailable (inert)', () => {
        expect(applyUserStyle(null, 'a{}')).toBeNull();
        expect(applyUserStyle({ body: {} }, 'a{}')).toBeNull();
        expect(applyUserStyle({ body: {}, createElement: () => null }, 'a{}')).toBeNull();
    });

    it('creates a <style>, sets the CSS text and appends it to body', () => {
        const doc = makeDoc();
        const style = applyUserStyle(doc, 'body { color: red; }');
        expect(style).not.toBeNull();
        expect(style.tagName).toBe('style');
        expect(style.textContent).toBe('body { color: red; }');
        expect(doc.body.children).toHaveLength(1);
        expect(doc.body.children[0]).toBe(style);
    });

    it('appends AFTER existing body children — later source order wins the cascade', () => {
        const doc = makeDoc();
        const existing = { tagName: 'div' };
        doc.body.appendChild(existing);
        const style = applyUserStyle(doc, 'a{}');
        expect(doc.body.children[0]).toBe(existing);
        expect(doc.body.children[1]).toBe(style);
    });

    it('injects the raw text verbatim (no sanitization loss)', () => {
        const doc = makeDoc();
        const css = '#search input { background: rgb(200, 0, 0); }\nbody { --vbm-radius: 20px; }';
        applyUserStyle(doc, css);
        expect(doc.body.children[0].textContent).toBe(css);
    });
});
