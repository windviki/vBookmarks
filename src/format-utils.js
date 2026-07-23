/**
 * Shared formatting utilities (v4 task 2 list spec).
 *
 * Pure functions for relative-time formatting used by recent, stats,
 * and any other view that needs human-readable timestamps.
 *
 * formatRelativeTime(ts, _m) — returns a localized relative-time string
 *   ("刚刚", "3分钟前", "2小时前", "昨天", "3天前", or date string for >7 days).
 *   Accepts _m (chrome.i18n.getMessage) so it works in any module without
 *   importing chrome.i18n directly.
 */

/**
 * @param {number} ts - Unix timestamp in milliseconds
 * @param {function} _m - chrome.i18n.getMessage
 * @returns {string} localized relative time
 */
export function formatRelativeTime(ts, _m) {
    if (!ts) return '';
    const now = Date.now();
    const diffMs = now - ts;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) {
        return _m('timeJustNow') || '刚刚';
    }
    if (diffMin < 60) {
        return (_m('timeMinutesAgo') || '$n$分钟前').replace('$n$', String(diffMin));
    }
    if (diffHr < 24) {
        return (_m('timeHoursAgo') || '$n$小时前').replace('$n$', String(diffHr));
    }
    if (diffDay === 1) {
        return _m('timeYesterday') || '昨天';
    }
    if (diffDay <= 7) {
        return (_m('timeDaysAgo') || '$n$天前').replace('$n$', String(diffDay));
    }
    // >7 days: show date
    return new Date(ts).toLocaleDateString();
}
