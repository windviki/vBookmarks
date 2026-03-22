import { describe, it, expect } from 'vitest';

// Mock chrome API
global.chrome = {
    bookmarks: {
        search: () => {},
        get: () => {},
        getChildren: () => {}
    },
    storage: {
        local: {
            get: () => ({}),
            set: () => {}
        },
        sync: {
            get: () => ({}),
            set: () => {}
        }
    },
    i18n: {
        getMessage: (key) => key
    }
};

// Import functions to test
// Since background.js is not modular, we need to extract functions or test differently
// For now, create a test for utility functions

describe('Utility Functions', () => {
    describe('debounce', () => {
        it('should debounce function calls', async () => {
            let callCount = 0;
            const debounced = (func, delay) => {
                let timeoutId;
                return (...args) => {
                    clearTimeout(timeoutId);
                    timeoutId = setTimeout(() => func.apply(null, args), delay);
                };
            };

            const func = () => callCount++;
            const debouncedFunc = debounced(func, 100);

            debouncedFunc();
            debouncedFunc();
            debouncedFunc();

            await new Promise(resolve => setTimeout(resolve, 150));
            expect(callCount).toBe(1);
        });
    });

    describe('rankBookmarks', () => {
        it('should rank bookmarks by title match position', () => {
            const rankBookmarks = (query, results) => {
                if (results.length <= 1) return results;
                const v = query.replace(/([-.*+?^${}()|[\]\/\\])/g, '\\$1');
                const vPattern = new RegExp(`^${v.replace(/\s+/g, '.*')}`, 'ig');
                results.sort((a, b) => {
                    const aTitle = a.title.toLowerCase();
                    const bTitle = b.title.toLowerCase();
                    const queryLower = query.toLowerCase();
                    let aIndexTitle = aTitle.indexOf(queryLower);
                    let bIndexTitle = bTitle.indexOf(queryLower);
                    if (aIndexTitle >= 0 || bIndexTitle >= 0) {
                        if (aIndexTitle < 0) aIndexTitle = Infinity;
                        if (bIndexTitle < 0) bIndexTitle = Infinity;
                        return aIndexTitle - bIndexTitle;
                    }
                    const aTestTitle = vPattern.test(aTitle);
                    const bTestTitle = vPattern.test(bTitle);
                    if (aTestTitle && !bTestTitle) return -1;
                    if (!aTestTitle && bTestTitle) return 1;
                    return b.dateAdded - a.dateAdded;
                });
                return results.slice(0, 6);
            };

            const bookmarks = [
                { title: 'Google', url: 'https://google.com', dateAdded: 1 },
                { title: 'GitHub', url: 'https://github.com', dateAdded: 2 },
                { title: 'Stack Overflow', url: 'https://stackoverflow.com', dateAdded: 3 }
            ];

            const ranked = rankBookmarks('Git', bookmarks);
            expect(ranked[0].title).toBe('GitHub');
        });
    });
});