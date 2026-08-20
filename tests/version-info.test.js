import { describe, it, expect } from 'vitest';
import { parseBrowser, collectVersionMeta } from '../src/version-info.js';

describe('parseBrowser', () => {
    it('recognises Edge before Chrome', () => {
        expect(parseBrowser('Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0')).toEqual({ name: 'Edge', version: '124.0.0.0' });
    });
    it('recognises Chrome', () => {
        expect(parseBrowser('Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36')).toEqual({ name: 'Chrome', version: '124.0.0.0' });
    });
    it('falls back to Unknown', () => {
        expect(parseBrowser('curl/8.0')).toEqual({ name: 'Unknown', version: '' });
    });
});

describe('collectVersionMeta', () => {
    it('builds the stable JSON shape with browser metadata', () => {
        const meta = collectVersionMeta({
            version: '4.0.8',
            announce: 'favicon-enhanced release',
            channel: 'popup',
            userAgent: 'Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36',
            platform: 'macOS',
            language: 'en'
        });
        expect(meta).toEqual({
            app: 'vBookmarks',
            version: '4.0.8',
            manifestVersion: 3,
            channel: 'popup',
            announce: 'favicon-enhanced release',
            browser: 'Chrome',
            browserVersion: '124.0.0.0',
            os: 'macOS',
            language: 'en',
            userAgent: 'Mozilla/5.0 Chrome/124.0.0.0 Safari/537.36'
        });
    });
});
