/**
 * 重构功能测试
 * 验证重构后的模块功能完整性
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { StringList, isBlank } from '../../src/utils/string/string-utils.js';
import { SeparatorManager } from '../../src/core/storage-manager/separator-manager.js';
import { EventSystem, Events } from '../../src/core/event-system/event-system.js';
import { BookmarkManager } from '../../src/core/bookmark-manager/bookmark-manager.js';
import { BookmarkTree } from '../../src/components/bookmark-tree/bookmark-tree.js';

describe('String Utils', () => {
    test('isBlank should detect empty strings', () => {
        expect(isBlank('')).toBe(true);
        expect(isBlank('   ')).toBe(true);
        expect(isBlank(null)).toBe(true);
        expect(isBlank(undefined)).toBe(true);
        expect(isBlank('hello')).toBe(false);
        expect(isBlank('  hello  ')).toBe(false);
    });

    test('StringList should manage strings correctly', () => {
        const stringList = new StringList();

        // 测试添加
        stringList.append('hello');
        stringList.append('world');
        expect(stringList.size()).toBe(2);

        // 测试包含
        expect(stringList.contains('hello')).toBe(true);
        expect(stringList.contains('world')).toBe(true);
        expect(stringList.contains('nonexistent')).toBe(false);

        // 测试移除
        stringList.remove('hello');
        expect(stringList.size()).toBe(1);
        expect(stringList.contains('hello')).toBe(false);

        // 测试替换
        stringList.replace('world', 'universe');
        expect(stringList.contains('world')).toBe(false);
        expect(stringList.contains('universe')).toBe(true);

        // 测试清空
        stringList.clear();
        expect(stringList.size()).toBe(0);
    });

    test('StringList should handle fromString and toString', () => {
        const stringList = new StringList();
        const testString = 'a,b,c,d';

        stringList.fromString(testString);
        expect(stringList.size()).toBe(4);
        expect(stringList.contains('a')).toBe(true);
        expect(stringList.contains('d')).toBe(true);

        const result = stringList.toString();
        expect(result).toBe(testString);
    });
});

describe('SeparatorManager', () => {
    let separatorManager;
    let mockLocalStorage;

    beforeEach(() => {
        // 模拟 localStorage
        mockLocalStorage = {
            separatorTitle: '|',
            separatorURL: 'http://separatethis.com/',
            separatorString: 'separatethis.com',
            separators: 'sep1,sep2,sep3'
        };

        separatorManager = new SeparatorManager(mockLocalStorage);
    });

    test('should initialize with default values', () => {
        expect(separatorManager.separatorTitle).toBe('|');
        expect(separatorManager.separatorURL).toBe('http://separatethis.com/');
        expect(separatorManager.separatorString).toEqual(['separatethis.com']);
    });

    test('should load separators from storage', () => {
        separatorManager.load();
        expect(separatorManager.size()).toBe(3);
        expect(separatorManager.contains('sep1')).toBe(true);
        expect(separatorManager.contains('sep3')).toBe(true);
    });

    test('should add new separator', () => {
        separatorManager.add('sep4');
        expect(separatorManager.contains('sep4')).toBe(true);
        expect(mockLocalStorage.separators).toBe('sep1,sep2,sep3,sep4');
    });

    test('should not add duplicate separator', () => {
        separatorManager.add('sep1');
        expect(mockLocalStorage.separators).toBe('sep1,sep2,sep3');
    });

    test('should update separator', () => {
        separatorManager.update('sep1', 'newSep1');
        expect(separatorManager.contains('sep1')).toBe(false);
        expect(separatorManager.contains('newSep1')).toBe(true);
    });

    test('should remove separator', () => {
        separatorManager.remove('sep2');
        expect(separatorManager.contains('sep2')).toBe(false);
        expect(separatorManager.size()).toBe(2);
    });

    test('should detect separator', () => {
        expect(separatorManager.isSeparator('|', 'http://separatethis.com/')).toBe(true);
        expect(separatorManager.isSeparator('normal', 'http://example.com/')).toBe(false);
        expect(separatorManager.isSeparator('sep1', 'any url')).toBe(true);
    });

    test('should reset to defaults', () => {
        separatorManager.reset();
        expect(separatorManager.separatorTitle).toBe('|');
        expect(separatorManager.separatorURL).toBe('http://separatethis.com/');
        expect(separatorManager.size()).toBe(0);
    });
});

describe('EventSystem', () => {
    let eventSystem;

    beforeEach(() => {
        eventSystem = new EventSystem();
    });

    test('should register and emit events', () => {
        const mockCallback = vi.fn();

        eventSystem.on('test-event', mockCallback);
        eventSystem.emit('test-event', { data: 'test' });

        expect(mockCallback).toHaveBeenCalledWith({ data: 'test' });
    });

    test('should handle multiple listeners', () => {
        const callback1 = vi.fn();
        const callback2 = vi.fn();

        eventSystem.on('multi-event', callback1);
        eventSystem.on('multi-event', callback2);
        eventSystem.emit('multi-event', 'test-data');

        expect(callback1).toHaveBeenCalledWith('test-data');
        expect(callback2).toHaveBeenCalledWith('test-data');
    });

    test('should remove listeners', () => {
        const callback = vi.fn();

        eventSystem.on('remove-test', callback);
        eventSystem.off('remove-test', callback);
        eventSystem.emit('remove-test', 'data');

        expect(callback).not.toHaveBeenCalled();
    });

    test('should handle once events', () => {
        const callback = vi.fn();

        eventSystem.once('once-test', callback);
        eventSystem.emit('once-test', 'data1');
        eventSystem.emit('once-test', 'data2');

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith('data1');
    });

    test('should provide listener count', () => {
        expect(eventSystem.listenerCount('count-test')).toBe(0);

        eventSystem.on('count-test', vi.fn());
        eventSystem.on('count-test', vi.fn());

        expect(eventSystem.listenerCount('count-test')).toBe(2);
    });

    test('should list event names', () => {
        eventSystem.on('event1', vi.fn());
        eventSystem.on('event2', vi.fn());

        const names = eventSystem.eventNames();
        expect(names).toContain('event1');
        expect(names).toContain('event2');
    });
});

describe('BookmarkManager', () => {
    let bookmarkManager;
    let mockChrome;

    beforeEach(() => {
        // 模拟 Chrome API
        mockChrome = {
            bookmarks: {
                getTree: vi.fn(),
                onCreated: { addListener: vi.fn() },
                onRemoved: { addListener: vi.fn() },
                onChanged: { addListener: vi.fn() },
                onMoved: { addListener: vi.fn() },
                onChildrenReordered: { addListener: vi.fn() }
            }
        };

        // 模拟全局 chrome 对象
        global.chrome = mockChrome;

        bookmarkManager = new BookmarkManager();
    });

    test('should initialize properly', () => {
        expect(bookmarkManager.bookmarks).toBeInstanceOf(Map);
        expect(bookmarkManager.treeNodes).toBeInstanceOf(Map);
        expect(bookmarkManager.searchResults).toEqual([]);
        expect(bookmarkManager.isSearchMode).toBe(false);
    });

    test('should load bookmarks from Chrome API', async () => {
        const mockTree = [{
            id: '1',
            title: 'Root',
            children: [
                {
                    id: '2',
                    title: 'Folder',
                    children: [],
                    url: undefined
                },
                {
                    id: '3',
                    title: 'Bookmark',
                    url: 'https://example.com',
                    children: undefined
                }
            ]
        }];

        mockChrome.bookmarks.getTree.mockResolvedValue(mockTree);

        await bookmarkManager.loadBookmarks();

        expect(bookmarkManager.bookmarks.has('1')).toBe(true);
        expect(bookmarkManager.bookmarks.has('2')).toBe(true);
        expect(bookmarkManager.bookmarks.has('3')).toBe(true);

        const folder = bookmarkManager.getBookmark('2');
        expect(folder.isFolder).toBe(true);
        expect(folder.children).toEqual([]);

        const bookmark = bookmarkManager.getBookmark('3');
        expect(bookmark.isFolder).toBe(false);
        expect(bookmark.url).toBe('https://example.com');
    });

    test('should search bookmarks', async () => {
        // 设置测试数据
        bookmarkManager.bookmarks.set('1', {
            id: '1',
            title: 'Google',
            url: 'https://google.com',
            isFolder: false
        });

        bookmarkManager.bookmarks.set('2', {
            id: '2',
            title: 'Test Folder',
            url: '',
            isFolder: true
        });

        const results = await bookmarkManager.searchBookmarks('google');

        expect(results).toHaveLength(1);
        expect(results[0].title).toBe('Google');
        expect(results[0].score).toBeGreaterThan(0);
    });

    test('should get bookmark children', () => {
        bookmarkManager.bookmarks.set('parent', {
            id: 'parent',
            children: ['child1', 'child2']
        });

        bookmarkManager.bookmarks.set('child1', { id: 'child1' });
        bookmarkManager.bookmarks.set('child2', { id: 'child2' });

        const children = bookmarkManager.getChildren('parent');
        expect(children).toHaveLength(2);
        expect(children.map(c => c.id)).toEqual(['child1', 'child2']);
    });
});

describe('Integration Tests', () => {
    test('should handle complete workflow', async () => {
        // 创建完整的应用场景
        const mockLocalStorage = {};
        const mockChrome = {
            bookmarks: {
                getTree: vi.fn().mockResolvedValue([{
                    id: 'root',
                    title: 'Bookmarks Bar',
                    children: []
                }]),
                onCreated: { addListener: vi.fn() },
                onRemoved: { addListener: vi.fn() },
                onChanged: { addListener: vi.fn() },
                onMoved: { addListener: vi.fn() },
                onChildrenReordered: { addListener: vi.fn() }
            }
        };

        global.chrome = mockChrome;

        // 初始化所有组件
        const eventSystem = new EventSystem();
        const bookmarkManager = new BookmarkManager();
        const separatorManager = new SeparatorManager(mockLocalStorage);

        // 测试事件集成
        const eventSpy = vi.fn();
        eventSystem.on(Events.BOOKMARK_CREATED, eventSpy);

        // 模拟书签创建
        bookmarkManager.handleBookmarkCreated('test-id', {
            id: 'test-id',
            title: 'Test Bookmark',
            url: 'https://test.com'
        });

        expect(eventSpy).toHaveBeenCalledWith({
            id: 'test-id',
            bookmark: {
                id: 'test-id',
                title: 'Test Bookmark',
                url: 'https://test.com'
            }
        });

        // 测试分隔符集成
        separatorManager.add('test-separator');
        expect(separatorManager.isSeparator('test-separator', 'any-url')).toBe(true);

        console.log('✅ 集成测试通过');
    });

    test('should handle error scenarios', async () => {
        const eventSystem = new EventSystem();
        const errorSpy = vi.fn();

        // 测试错误处理
        eventSystem.on('error-event', errorSpy);
        eventSystem.emit('error-event', new Error('Test error'));

        expect(errorSpy).toHaveBeenCalled();
        console.log('✅ 错误处理测试通过');
    });
});

describe('Performance Tests', () => {
    test('should handle large datasets efficiently', async () => {
        // 创建大量书签数据
        const largeDataset = [];
        for (let i = 0; i < 1000; i++) {
            largeDataset.push({
                id: `bookmark-${i}`,
                title: `Bookmark ${i}`,
                url: `https://example${i}.com`
            });
        }

        const stringList = new StringList();

        // 测试批量添加性能
        const startTime = performance.now();
        largeDataset.forEach(item => {
            stringList.append(item.id);
        });
        const endTime = performance.now();

        expect(stringList.size()).toBe(1000);
        expect(endTime - startTime).toBeLessThan(100); // 应该在100ms内完成

        console.log(`✅ 性能测试通过: ${endTime - startTime}ms`);
    });
});

// 运行测试时的设置
if (typeof global !== 'undefined') {
    // 设置全局对象
    global.performance = { now: () => Date.now() };
}

console.log('🧪 重构功能测试 suite 准备完成');