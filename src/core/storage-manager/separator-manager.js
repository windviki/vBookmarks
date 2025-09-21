/**
 * 分隔符管理器
 * 管理书签分隔符的配置和状态
 */
import { StringList, isBlank } from '../../utils/string/string-utils.js';

export class SeparatorManager {
    constructor(localStorage) {
        this.localStorage = localStorage || window.localStorage;
        this.stringList = new StringList();

        // 初始化分隔符配置
        this.separatorTitle = this.localStorage.separatorTitle || "|";
        this.separatorURL = this.localStorage.separatorURL || "http://separatethis.com/";

        // 初始化分隔符字符串数组
        this.separatorString = [];
        if (!isBlank(this.localStorage.separatorString)) {
            this.separatorString = this.localStorage.separatorString.split(';');
        } else {
            this.separatorString.push("separatethis.com");
        }

        // 加载保存的分隔符
        this.load();
    }

    /**
     * 从本地存储加载分隔符
     */
    load() {
        if (this.localStorage.separators) {
            this.stringList.fromString(this.localStorage.separators);
        }
    }

    /**
     * 保存分隔符到本地存储
     */
    save() {
        this.localStorage.separators = this.stringList.toString();
    }

    /**
     * 添加分隔符
     * @param {string} str - 分隔符字符串
     */
    add(str) {
        if (!this.stringList.contains(str)) {
            this.stringList.append(str);
            this.save();
        }
    }

    /**
     * 更新分隔符
     * @param {string} str - 旧分隔符
     * @param {string} strNew - 新分隔符
     */
    update(str, strNew) {
        this.stringList.replace(str, strNew);
        this.save();
    }

    /**
     * 移除分隔符
     * @param {string} str - 要移除的分隔符
     */
    remove(str) {
        this.stringList.remove(str);
        this.save();
    }

    /**
     * 获取所有分隔符
     * @returns {Array} 分隔符数组
     */
    getAll() {
        return this.stringList.getAll();
    }

    /**
     * 清空所有分隔符
     */
    clear() {
        this.stringList.clear();
        this.save();
    }

    /**
     * 获取分隔符数量
     * @returns {number} 分隔符数量
     */
    size() {
        return this.stringList.size();
    }

    /**
     * 检查是否为分隔符
     * @param {string} title - 书签标题
     * @param {string} url - 书签URL
     * @returns {boolean} 是否为分隔符
     */
    isSeparator(title, url) {
        if (!title || !url) return false;

        const lowerTitle = title.toLowerCase();
        const lowerUrl = url.toLowerCase();

        // 检查标题是否为分隔符标题
        if (lowerTitle === this.separatorTitle.toLowerCase()) {
            return true;
        }

        // 检查URL是否包含分隔符字符串
        for (const separatorStr of this.separatorString) {
            if (lowerUrl.indexOf(separatorStr.toLowerCase()) !== -1) {
                return true;
            }
        }

        // 检查是否在保存的分隔符列表中
        return this.stringList.contains(title) || this.stringList.contains(url);
    }

    /**
     * 重置分隔符到默认状态
     */
    reset() {
        this.separatorTitle = "|";
        this.separatorURL = "http://separatethis.com/";
        this.separatorString = ["separatethis.com"];
        this.clear();

        // 清除本地存储
        delete this.localStorage.separatorTitle;
        delete this.localStorage.separatorURL;
        delete this.localStorage.separatorString;
        delete this.localStorage.separators;
    }

    /**
     * 更新分隔符配置
     * @param {Object} config - 新的配置对象
     */
    updateConfig(config) {
        if (config.title !== undefined) {
            this.separatorTitle = config.title;
            this.localStorage.separatorTitle = config.title;
        }

        if (config.url !== undefined) {
            this.separatorURL = config.url;
            this.localStorage.separatorURL = config.url;
        }

        if (config.strings !== undefined) {
            this.separatorString = Array.isArray(config.strings) ? config.strings : config.strings.split(';');
            this.localStorage.separatorString = this.separatorString.join(';');
        }
    }

    /**
     * 获取当前配置
     * @returns {Object} 当前配置对象
     */
    getConfig() {
        return {
            title: this.separatorTitle,
            url: this.separatorURL,
            strings: this.separatorString
        };
    }
}