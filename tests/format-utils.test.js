import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatRelativeTime } from '../src/format-utils.js';

// Fake i18n.getMessage for English
const _m = (key) => {
    const messages = {
        timeJustNow: 'Just now',
        timeMinutesAgo: '$n$ min ago',
        timeHoursAgo: '$n$ hr ago',
        timeYesterday: 'Yesterday',
        timeDaysAgo: '$n$ days ago'
    };
    return messages[key] || key;
};

describe('formatRelativeTime', () => {
    let now;

    beforeEach(() => {
        now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns empty string for falsy ts', () => {
        expect(formatRelativeTime(0)).toBe('');
        expect(formatRelativeTime(null)).toBe('');
        expect(formatRelativeTime(undefined)).toBe('');
    });

    it('returns "Just now" for < 1 minute ago', () => {
        expect(formatRelativeTime(now - 30 * 1000, _m)).toBe('Just now');
    });

    it('returns "N min ago" for 1-59 minutes ago', () => {
        expect(formatRelativeTime(now - 5 * 60 * 1000, _m)).toBe('5 min ago');
        expect(formatRelativeTime(now - 30 * 60 * 1000, _m)).toBe('30 min ago');
        expect(formatRelativeTime(now - 59 * 60 * 1000, _m)).toBe('59 min ago');
    });

    it('returns "N hr ago" for 1-23 hours ago', () => {
        expect(formatRelativeTime(now - 1 * 3600 * 1000, _m)).toBe('1 hr ago');
        expect(formatRelativeTime(now - 5 * 3600 * 1000, _m)).toBe('5 hr ago');
        expect(formatRelativeTime(now - 23 * 3600 * 1000, _m)).toBe('23 hr ago');
    });

    it('returns "Yesterday" for 24-47 hours ago', () => {
        expect(formatRelativeTime(now - 25 * 3600 * 1000, _m)).toBe('Yesterday');
    });

    it('returns "N days ago" for 2-7 days ago', () => {
        expect(formatRelativeTime(now - 2 * 86400 * 1000, _m)).toBe('2 days ago');
        expect(formatRelativeTime(now - 5 * 86400 * 1000, _m)).toBe('5 days ago');
        expect(formatRelativeTime(now - 7 * 86400 * 1000, _m)).toBe('7 days ago');
    });

    it('returns date string for > 7 days ago', () => {
        const pastDate = now - 10 * 86400 * 1000;
        const result = formatRelativeTime(pastDate, _m);
        // Should be a locale date string, not a relative time
        expect(result).not.toContain('ago');
        expect(result).not.toBe('Yesterday');
        expect(result).not.toBe('Just now');
        expect(result).toBe(new Date(pastDate).toLocaleDateString());
    });

    it('works with Chinese messages', () => {
        const zh = (key) => {
            const msgs = {
                timeJustNow: '刚刚',
                timeMinutesAgo: '$n$分钟前',
                timeHoursAgo: '$n$小时前',
                timeYesterday: '昨天',
                timeDaysAgo: '$n$天前'
            };
            return msgs[key] || key;
        };
        expect(formatRelativeTime(now - 3 * 60 * 1000, zh)).toBe('3分钟前');
        expect(formatRelativeTime(now - 2 * 3600 * 1000, zh)).toBe('2小时前');
        expect(formatRelativeTime(now, zh)).toBe('刚刚');
        expect(formatRelativeTime(now - 25 * 3600 * 1000, zh)).toBe('昨天');
    });
});
