/**
 * dead-links-proxy.test.js — tests for proxy dual-channel (v4 task 2)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkUrl, statusLabel } from '../src/dead-links.js';

describe('checkUrl proxy dual-channel', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('returns skipped for non-http(s) URLs', async () => {
        const r = await checkUrl('javascript:void(0)');
        expect(r).toEqual({ status: 'skipped', ok: true });
    });

    it('returns skipped for empty/undefined URL', async () => {
        const r = await checkUrl('');
        expect(r).toEqual({ status: 'skipped', ok: true });
    });

    it('returns ok when direct probe succeeds', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ status: 200, ok: true });
        const r = await checkUrl('https://example.com/', { timeoutMs: 100 });
        expect(r.ok).toBe(true);
        expect(r.status).toBe(200);
    });

    it('returns dead when direct fails and no proxy configured', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
        const r = await checkUrl('https://dead.example/', { timeoutMs: 100 });
        expect(r.ok).toBe(false);
        expect(r.status).toBe('error');
    });

    it('returns blocked when direct fails but proxy succeeds', async () => {
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) return Promise.reject(new Error('Direct failed'));
            return Promise.resolve({ status: 200, ok: true }); // proxy succeeds
        });
        const r = await checkUrl('https://blocked.example/', {
            timeoutMs: 100,
            proxyTemplate: 'https://proxy.example/?url={url}'
        });
        expect(r.status).toBe('blocked');
        expect(r.ok).toBe(true);
        expect(r.directStatus).toBe('error');
    });

    it('returns dead when both direct and proxy fail', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('All failed'));
        const r = await checkUrl('https://dead.example/', {
            timeoutMs: 100,
            proxyTemplate: 'https://proxy.example/?url={url}'
        });
        expect(r.ok).toBe(false);
        expect(r.status).toBe('error');
    });
});

describe('statusLabel', () => {
    it('returns numeric status as string', () => {
        expect(statusLabel({ status: 404 })).toBe('404');
        expect(statusLabel({ status: 200 })).toBe('200');
    });

    it('returns "blocked" for blocked status', () => {
        expect(statusLabel({ status: 'blocked' })).toBe('blocked');
    });

    it('returns "timeout" for AbortError', () => {
        expect(statusLabel({ status: 'error', error: 'AbortError' })).toBe('timeout');
    });

    it('returns "error" for other errors', () => {
        expect(statusLabel({ status: 'error', error: 'TypeError' })).toBe('error');
        expect(statusLabel({ status: 'error' })).toBe('error');
    });

    it('handles skipped-like string status gracefully', () => {
        // 'skipped' is a string, not a number — falls through to error path
        const r = statusLabel({ status: 'skipped' });
        expect(r === 'skipped' || r === 'error').toBe(true);
    });
});
