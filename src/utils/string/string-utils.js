/**
 * 字符串处理工具函数
 */

/**
 * 检查字符串是否为空或只包含空白字符
 * @param {string} str - 要检查的字符串
 * @returns {boolean} 是否为空
 */
export function isBlank(str) {
    return (!str || /^\s*$/.test(str));
}

/**
 * 字符串列表管理类
 */
export class StringList {
    constructor() {
        this._strings_ = [];
    }

    /**
     * 添加字符串到列表
     * @param {string} str - 要添加的字符串
     */
    append(str) {
        const inputStr = `${str}`;
        if (inputStr) {
            this._strings_.push(inputStr);
        }
    }

    /**
     * 从列表中移除字符串
     * @param {string} str - 要移除的字符串
     */
    remove(str) {
        const inputStr = `${str}`;
        if (inputStr) {
            const index = this._strings_.indexOf(inputStr);
            if (index > -1) {
                this._strings_.splice(index, 1);
            }
        }
    }

    /**
     * 替换列表中的字符串
     * @param {string} strOld - 旧字符串
     * @param {string} strNew - 新字符串
     */
    replace(strOld, strNew) {
        const inputStr = `${strOld}`;
        const newStr = `${strNew}`;
        if (inputStr) {
            const index = this._strings_.indexOf(inputStr);
            if (index > -1) {
                this._strings_[index] = newStr;
            }
        }
    }

    /**
     * 清空列表
     * @returns {Array} 空数组
     */
    clear() {
        return this._strings_ = [];
    }

    /**
     * 获取列表大小
     * @returns {number} 列表长度
     */
    size() {
        return this._strings_.length;
    }

    /**
     * 从逗号分隔的字符串加载
     * @param {string} str - 逗号分隔的字符串
     */
    fromString(str) {
        const inputStr = `${str}`;
        if (inputStr) {
            this._strings_ = inputStr.split(",");
        }
    }

    /**
     * 转换为逗号分隔的字符串
     * @returns {string} 逗号分隔的字符串
     */
    toString() {
        return this._strings_.join(",");
    }

    /**
     * 获取所有字符串
     * @returns {Array} 字符串数组
     */
    getAll() {
        return [...this._strings_];
    }

    /**
     * 检查是否包含指定字符串
     * @param {string} str - 要检查的字符串
     * @returns {boolean} 是否包含
     */
    contains(str) {
        return this._strings_.indexOf(`${str}`) > -1;
    }
}

/**
 * 扩展String类的颜色处理方法
 */
// String.prototype.colorHex = function() {
//     // 实现从neat.js迁移
// };

// String.prototype.colorRgb = function() {
//     // 实现从neat.js迁移
// };