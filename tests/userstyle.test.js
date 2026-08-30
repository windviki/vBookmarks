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

// CSP diagnosis: a remote @import inside the pasted CSS is blocked by the
// manifest's style-src — applyUserStyle must say so instead of failing
// silently (the block itself stays: CSP is doing its job).
describe('applyUserStyle remote @import diagnosis', () => {
    it('warns once for a remote @import and still injects the style', () => {
        const warnings = [];
        const origWarn = console.warn;
        console.warn = (...args) => warnings.push(args.join(' '));
        try {
            const css = "@import url('https://fonts.googleapis.com/css?family=Rubik');\nbody { color: red; }";
            const el = applyUserStyle(makeDoc(), css);
            expect(el).toBeTruthy();
            expect(warnings).toHaveLength(1);
            expect(warnings[0]).toContain('remote @import');
        } finally {
            console.warn = origWarn;
        }
    });

    it('no warning for local/data imports or plain css', () => {
        const warnings = [];
        const origWarn = console.warn;
        console.warn = (...args) => warnings.push(args);
        try {
            applyUserStyle(makeDoc(), "body { color: red; }");
            applyUserStyle(makeDoc(), "@import url('data:text/css,body{}');");
            expect(warnings).toHaveLength(0);
        } finally {
            console.warn = origWarn;
        }
    });
});
