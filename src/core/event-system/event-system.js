/**
 * 事件系统
 * 提供统一的事件管理机制
 */

export class EventSystem {
    constructor() {
        this.events = new Map();
        this.onceEvents = new Set();
    }

    /**
     * 注册事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 回调函数
     * @param {boolean} once - 是否只执行一次
     */
    on(eventName, callback, once = false) {
        if (!this.events.has(eventName)) {
            this.events.set(eventName, new Set());
        }

        this.events.get(eventName).add(callback);

        if (once) {
            this.onceEvents.add(`${eventName}:${callback}`);
        }
    }

    /**
     * 注册一次性事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 回调函数
     */
    once(eventName, callback) {
        this.on(eventName, callback, true);
    }

    /**
     * 移除事件监听器
     * @param {string} eventName - 事件名称
     * @param {Function} callback - 回调函数
     */
    off(eventName, callback) {
        if (this.events.has(eventName)) {
            this.events.get(eventName).delete(callback);

            // 从一次性事件集合中移除
            this.onceEvents.delete(`${eventName}:${callback}`);
        }
    }

    /**
     * 触发事件
     * @param {string} eventName - 事件名称
     * @param {*} data - 事件数据
     */
    emit(eventName, data = null) {
        if (this.events.has(eventName)) {
            const callbacks = this.events.get(eventName);
            const callbacksToRemove = [];

            callbacks.forEach(callback => {
                try {
                    callback(data);

                    // 检查是否为一次性事件
                    if (this.onceEvents.has(`${eventName}:${callback}`)) {
                        callbacksToRemove.push(callback);
                    }
                } catch (error) {
                    console.error(`Error in event handler for ${eventName}:`, error);
                }
            });

            // 移除已执行的一次性事件
            callbacksToRemove.forEach(callback => {
                this.off(eventName, callback);
            });
        }
    }

    /**
     * 移除指定事件的所有监听器
     * @param {string} eventName - 事件名称
     */
    removeAllListeners(eventName) {
        if (eventName) {
            this.events.delete(eventName);
            // 清理一次性事件记录
            this.onceEvents.forEach(key => {
                if (key.startsWith(`${eventName}:`)) {
                    this.onceEvents.delete(key);
                }
            });
        } else {
            // 移除所有事件
            this.events.clear();
            this.onceEvents.clear();
        }
    }

    /**
     * 获取指定事件的监听器数量
     * @param {string} eventName - 事件名称
     * @returns {number} 监听器数量
     */
    listenerCount(eventName) {
        if (this.events.has(eventName)) {
            return this.events.get(eventName).size;
        }
        return 0;
    }

    /**
     * 获取所有事件名称
     * @returns {Array} 事件名称数组
     */
    eventNames() {
        return Array.from(this.events.keys());
    }
}

// 创建全局事件系统实例
export const globalEventSystem = new EventSystem();

// 预定义的事件类型
export const Events = {
    // 书签相关事件
    BOOKMARK_CREATED: 'bookmark:created',
    BOOKMARK_UPDATED: 'bookmark:updated',
    BOOKMARK_DELETED: 'bookmark:deleted',
    BOOKMARK_MOVED: 'bookmark:moved',

    // 书签树相关事件
    TREE_RENDERED: 'tree:rendered',
    TREE_EXPANDED: 'tree:expanded',
    TREE_COLLAPSED: 'tree:collapsed',
    TREE_REFRESHED: 'tree:refreshed',

    // 搜索相关事件
    SEARCH_PERFORMED: 'search:performed',
    SEARCH_CLEARED: 'search:cleared',
    SEARCH_RESULT_SELECTED: 'search:result-selected',

    // UI相关事件
    FOCUS_CHANGED: 'ui:focus-changed',
    SELECTION_CHANGED: 'ui:selection-changed',
    CONTEXT_MENU_SHOW: 'ui:context-menu-show',
    CONTEXT_MENU_HIDE: 'ui:context-menu-hide',

    // 拖拽相关事件
    DRAG_START: 'drag:start',
    DRAG_END: 'drag:end',
    DRAG_OVER: 'drag:over',
    DROP: 'drop',

    // 键盘相关事件
    KEY_PRESS: 'keyboard:press',
    KEY_DOWN: 'keyboard:down',
    KEY_UP: 'keyboard:up',

    // 同步相关事件
    SYNC_STARTED: 'sync:started',
    SYNC_COMPLETED: 'sync:completed',
    SYNC_FAILED: 'sync:failed',

    // 应用生命周期事件
    APP_INITIALIZED: 'app:initialized',
    APP_READY: 'app:ready',
    APP_DESTROY: 'app:destroy'
};