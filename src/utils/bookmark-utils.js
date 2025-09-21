/**
 * 书签工具函数
 * 从 neat.js 迁移的书签相关工具函数
 */

import { Logger } from './logger.js';

const logger = new Logger('BookmarkUtils');

/**
 * 获取书签图标URL
 * @param {string} url - 书签URL
 * @returns {string} 图标URL
 */
export function getFaviconUrl(url) {
    if (!url) {
        return 'icon.png';
    }

    try {
        const favUrl = new URL(chrome.runtime.getURL("/_favicon/"));
        favUrl.searchParams.set("pageUrl", url);
        favUrl.searchParams.set("size", "32");
        return favUrl.toString();
    } catch (error) {
        logger.warn('Failed to create favicon URL:', error);
        return 'icon.png';
    }
}

/**
 * 获取元数据设置
 * @returns {object} 元数据设置对象
 */
export function getMetadataSettings() {
    return {
        showAddedDate: localStorage.getItem('vbookmarks_show_added_date') !== 'false',
        showLastAccessed: localStorage.getItem('vbookmarks_show_last_accessed') !== 'false',
        showClickCount: localStorage.getItem('vbookmarks_show_click_count') !== 'false'
    };
}

/**
 * 获取紧凑日期表示
 * @param {string|Date} date - 日期
 * @returns {string} 紧凑日期字符串
 */
export function getCompactDate(date) {
    if (!date) return '';

    const now = new Date();
    const timestamp = typeof date === 'string' ? new Date(date) : date;
    const diff = now - timestamp;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return '今';
    if (days === 1) return '昨';
    if (days < 7) return `${days}天`;
    if (days < 30) return `${Math.floor(days / 7)}周`;
    if (days < 365) return `${Math.floor(days / 30)}月`;
    return `${Math.floor(days / 365)}年`;
}

/**
 * 格式化日期用于显示
 * @param {string|Date} date - 日期
 * @returns {string} 格式化后的日期字符串
 */
export function formatDate(date) {
    if (!date) return '';

    const now = new Date();
    const timestamp = typeof date === 'string' ? new Date(date) : date;
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return timestamp.toLocaleDateString();
    } else if (hours > 0) {
        return `${hours}小时前`;
    } else if (minutes > 0) {
        return `${minutes}分钟前`;
    } else {
        return '刚刚';
    }
}

/**
 * 复制文本到剪贴板
 * @param {string} text - 要复制的文本
 * @returns {boolean} 是否成功
 */
export function copyToClipboard(text) {
    if (!text) {
        logger.warn('No text provided to copy');
        return false;
    }

    try {
        // 现代方法
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                logger.info('Text copied to clipboard using modern API');
            }).catch(err => {
                logger.warn('Modern clipboard API failed:', err);
                fallbackCopyText(text);
            });
        } else {
            // 降级方法
            fallbackCopyText(text);
        }
        return true;
    } catch (error) {
        logger.error('Failed to copy text to clipboard:', error);
        return false;
    }
}

/**
 * 降级复制文本方法
 * @param {string} text - 要复制的文本
 */
function fallbackCopyText(text) {
    const copier = document.getElementById('copier-input');
    if (!copier) {
        logger.warn('Copier input element not found');
        return;
    }

    copier.value = text;
    copier.select();
    copier.setSelectionRange(0, 99999); // 移动设备兼容

    try {
        const successful = document.execCommand('copy');
        if (successful) {
            logger.info('Text copied using fallback method');
        } else {
            logger.warn('Fallback copy command failed');
        }
    } catch (error) {
        logger.error('Fallback copy failed:', error);
    }
}

/**
 * 自适应书签工具提示
 */
export function adaptBookmarkTooltips() {
    const bookmarks = document.querySelectorAll('li.child a');

    for (let i = 0, l = bookmarks.length; i < l; i++) {
        const bookmark = bookmarks[i];
        if (bookmark.querySelector('hr')) {
            bookmark.title = '';
        } else {
            if (bookmark.classList.contains('titled')) {
                if (bookmark.scrollWidth <= bookmark.offsetWidth) {
                    bookmark.title = bookmark.href;
                    bookmark.classList.remove('titled');
                }
            } else if (bookmark.scrollWidth > bookmark.offsetWidth) {
                const textElement = bookmark.querySelector('i');
                const text = textElement ? textElement.textContent : '';
                const title = bookmark.title;
                if (text !== title) {
                    bookmark.title = `${text}\\n${title}`;
                    bookmark.classList.add('titled');
                }
            }
        }
    }
}

/**
 * 生成书签元数据HTML
 * @param {string} bookmarkId - 书签ID
 * @returns {string} 元数据HTML字符串
 */
export function generateBookmarkMetadataHTML(bookmarkId) {
    if (!bookmarkId) {
        logger.warn('No bookmark ID provided for metadata generation');
        return '';
    }

    try {
        // 获取书签信息
        return new Promise((resolve) => {
            chrome.bookmarks.get(bookmarkId, (bookmark) => {
                if (chrome.runtime.lastError || !bookmark || bookmark.length === 0) {
                    logger.warn('Failed to get bookmark for metadata:', chrome.runtime.lastError);
                    resolve('');
                    return;
                }

                const bm = bookmark[0];
                const settings = getMetadataSettings();
                let html = '';

                // 添加日期
                if (settings.showAddedDate && bm.dateAdded) {
                    const dateAdded = formatDate(bm.dateAdded);
                    html += `<span class="meta-badge date" title="Added: ${new Date(bm.dateAdded).toLocaleString()}">${dateAdded}</span>`;
                }

                // 添加最后访问时间
                if (settings.showLastAccessed && bm.lastAccessed) {
                    const lastAccessed = getCompactDate(bm.lastAccessed);
                    html += `<span class="meta-badge accessed" title="Last accessed: ${new Date(bm.lastAccessed).toLocaleString()}">${lastAccessed}</span>`;
                }

                // 添加点击次数（如果有）
                const clickCount = localStorage.getItem(`vbookmarks_clicks_${bookmarkId}`);
                if (settings.showClickCount && clickCount) {
                    html += `<span class="meta-badge clicks" title="Click count: ${clickCount}">${clickCount} clicks</span>`;
                }

                resolve(html);
            });
        });
    } catch (error) {
        logger.error('Failed to generate bookmark metadata HTML:', error);
        return Promise.resolve('');
    }
}

/**
 * 生成书签HTML
 * @param {string} title - 书签标题
 * @param {string} url - 书签URL
 * @param {object} extras - 额外属性
 * @param {string} bookmarkId - 书签ID
 * @returns {string} HTML字符串
 */
export function generateBookmarkHTML(title, url, extras = {}, bookmarkId) {
    const safeTitle = escapeHtml(title || 'Untitled');
    const safeUrl = escapeHtml(url || '');
    const id = bookmarkId || generateUUID();

    let html = `<a href="${safeUrl}" id="${id}" class="child" draggable="true">`;

    // 图标
    if (url && url !== 'about:blank') {
        const faviconUrl = getFaviconUrl(url);
        html += `<img src="${faviconUrl}" alt="" onerror="this.src='icon.png'">`;
    }

    // 标题
    html += `<i>${safeTitle}</i>`;

    // 元数据
    if (bookmarkId) {
        // 这里应该异步生成元数据
        // 为了简化，我们在渲染后添加
    }

    html += '</a>';

    return html;
}

/**
 * 生成文件夹HTML
 * @param {string} title - 文件夹标题
 * @param {object} extras - 额外属性
 * @param {string} folderId - 文件夹ID
 * @param {HTMLElement} folderNode - 文件夹节点
 * @returns {string} HTML字符串
 */
export function generateFolderHTML(title, extras = {}, folderId, folderNode) {
    const safeTitle = escapeHtml(title || 'Untitled Folder');
    const id = folderId || generateUUID();
    const isOpen = extras.open ? ' open' : '';

    let html = `<li id="${id}" class="child folder${isOpen}" draggable="true">`;
    html += `<span><span class="twisty">▶</span><span class="label">${safeTitle}</span></span>`;
    html += '<ul></ul></li>';

    return html;
}

/**
 * 生成分隔符HTML
 * @param {number} paddingStart - 缩进开始位置
 * @returns {string} HTML字符串
 */
export function generateSeparatorHTML(paddingStart = 0) {
    const padding = paddingStart * 16;
    return `<li class="child separator" draggable="true"><hr style="margin-left: ${padding}px;" /></li>`;
}

/**
 * 生成书签树HTML
 * @param {Array} data - 书签数据
 * @param {number} level - 层级
 * @returns {string} HTML字符串
 */
export function generateBookmarkTreeHTML(data, level = 0) {
    if (!data || !Array.isArray(data.children)) {
        logger.warn('Invalid bookmark data for HTML generation');
        return '';
    }

    let html = '';

    for (const node of data.children) {
        if (node.children) {
            // 文件夹
            html += generateFolderHTML(node.title, { open: false }, node.id, node);
        } else if (node.url === 'about:blank' || node.title === '---') {
            // 分隔符
            html += generateSeparatorHTML(level);
        } else if (node.url) {
            // 书签
            html += generateBookmarkHTML(node.title, node.url, {}, node.id);
        }
    }

    return html;
}

/**
 * 添加分隔符
 * @param {string} nodeId - 节点ID
 * @param {string} where - 添加位置 ('before' 或 'after')
 */
export function addSeparator(nodeId, where = 'before') {
    if (!nodeId) {
        logger.warn('No node ID provided for separator addition');
        return;
    }

    logger.info(`Adding separator ${where} node: ${nodeId}`);

    // 触发分隔符添加事件
    if (window.globalEventSystem) {
        window.globalEventSystem.emit('separator:add', { nodeId, where });
    }
}

/**
 * 删除分隔符
 * @param {string} id - 分隔符ID
 */
export function deleteSeparator(id) {
    if (!id) {
        logger.warn('No separator ID provided for deletion');
        return;
    }

    logger.info(`Deleting separator: ${id}`);

    // 触发分隔符删除事件
    if (window.globalEventSystem) {
        window.globalEventSystem.emit('separator:delete', { id });
    }
}

/**
 * HTML转义
 * @param {string} text - 要转义的文本
 * @returns {string} 转义后的文本
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * 生成UUID
 * @returns {string} UUID字符串
 */
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * 更新书签点击统计
 * @param {string} bookmarkId - 书签ID
 */
export function updateBookmarkClickCount(bookmarkId) {
    if (!bookmarkId) return;

    try {
        const key = `vbookmarks_clicks_${bookmarkId}`;
        const currentCount = parseInt(localStorage.getItem(key) || '0');
        const newCount = currentCount + 1;
        localStorage.setItem(key, newCount.toString());

        logger.debug(`Updated click count for bookmark ${bookmarkId}: ${newCount}`);
    } catch (error) {
        logger.error('Failed to update bookmark click count:', error);
    }
}

/**
 * 获取书签点击统计
 * @param {string} bookmarkId - 书签ID
 * @returns {number} 点击次数
 */
export function getBookmarkClickCount(bookmarkId) {
    if (!bookmarkId) return 0;

    try {
        const key = `vbookmarks_clicks_${bookmarkId}`;
        return parseInt(localStorage.getItem(key) || '0');
    } catch (error) {
        logger.error('Failed to get bookmark click count:', error);
        return 0;
    }
}

/**
 * 更新书签最后访问时间
 * @param {string} bookmarkId - 书签ID
 */
export function updateBookmarkLastAccessed(bookmarkId) {
    if (!bookmarkId) return;

    try {
        const key = `vbookmarks_last_accessed_${bookmarkId}`;
        localStorage.setItem(key, Date.now().toString());

        logger.debug(`Updated last accessed time for bookmark ${bookmarkId}`);
    } catch (error) {
        logger.error('Failed to update bookmark last accessed time:', error);
    }
}

/**
 * 获取书签最后访问时间
 * @param {string} bookmarkId - 书签ID
 * @returns {Date|null} 最后访问时间
 */
export function getBookmarkLastAccessed(bookmarkId) {
    if (!bookmarkId) return null;

    try {
        const key = `vbookmarks_last_accessed_${bookmarkId}`;
        const timestamp = localStorage.getItem(key);
        return timestamp ? new Date(parseInt(timestamp)) : null;
    } catch (error) {
        logger.error('Failed to get bookmark last accessed time:', error);
        return null;
    }
}

// 导出所有工具函数
export default {
    getFaviconUrl,
    getMetadataSettings,
    getCompactDate,
    formatDate,
    copyToClipboard,
    adaptBookmarkTooltips,
    generateBookmarkMetadataHTML,
    generateBookmarkHTML,
    generateFolderHTML,
    generateSeparatorHTML,
    generateBookmarkTreeHTML,
    addSeparator,
    deleteSeparator,
    updateBookmarkClickCount,
    getBookmarkClickCount,
    updateBookmarkLastAccessed,
    getBookmarkLastAccessed
};