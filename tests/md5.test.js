import { describe, it, expect } from 'vitest';
import { md5 } from '../src/md5.js';

describe('md5 (RFC 1321)', () => {
    it('matches the reference vectors', () => {
        expect(md5('')).toBe('d41d8cd98f00b204e9800998ecf8427e');
        expect(md5('abc')).toBe('900150983cd24fb0d6963f7d28e17f72');
        expect(md5('The quick brown fox jumps over the lazy dog'))
            .toBe('9e107d9d372bb6826bd81d3542a419d6');
    });

    it('encodes UTF-8 bytes, not UTF-16', () => {
        expect(md5('中')).toBe('aed1dfbc31703955e64806b799b67645');
    });
});
