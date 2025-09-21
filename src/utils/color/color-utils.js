/**
 * 颜色工具函数模块
 * 从 neat.js 迁移的颜色处理功能
 */

const hexColorRegex = /^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/;

/**
 * RGB 颜色转换为 HEX 颜色
 * @param {string} rgbString - RGB 格式的颜色字符串，如 "rgb(255, 255, 255)"
 * @returns {string} HEX 格式的颜色字符串，如 "#ffffff"
 */
export function rgbToHex(rgbString) {
    if (!rgbString) return '';

    if (/^(rgb|RGB)/.test(rgbString)) {
        const aColor = rgbString.replace(/(?:\(|\)|rgb|RGB)*/g, "").split(",");
        let strHex = "#";
        for (let i = 0; i < aColor.length; i++) {
            let hex = Number(aColor[i]).toString(16);
            if (hex === "0") {
                hex += hex;
            }
            strHex += hex;
        }
        if (strHex.length !== 7) {
            strHex = rgbString;
        }
        return strHex;
    } else if (hexColorRegex.test(rgbString)) {
        const aNum = rgbString.replace(/#/, "").split("");
        if (aNum.length === 6) {
            return rgbString;
        } else if (aNum.length === 3) {
            let numHex = "#";
            for (let i = 0; i < aNum.length; i += 1) {
                numHex += (aNum[i] + aNum[i]);
            }
            return numHex;
        }
    } else {
        return '';
    }
}

/**
 * HEX 颜色转换为 RGB 颜色
 * @param {string} hexString - HEX 格式的颜色字符串，如 "#ffffff"
 * @returns {string} RGB 格式的颜色字符串，如 "RGB(255,255,255)"
 */
export function hexToRgb(hexString) {
    if (!hexString) return '';

    let sColor = hexString.toLowerCase();
    if (sColor && hexColorRegex.test(sColor)) {
        if (sColor.length === 4) {
            let sColorNew = "#";
            for (let i = 1; i < 4; i += 1) {
                sColorNew += sColor.slice(i, i + 1).concat(sColor.slice(i, i + 1));
            }
            sColor = sColorNew;
        }
        //6 bit
        const sColorChange = [];
        for (let i = 1; i < 7; i += 2) {
            sColorChange.push(parseInt(`0x${sColor.slice(i, i + 2)}`));
        }
        return `RGB(${sColorChange.join(",")})`;
    } else {
        return '';
    }
}

/**
 * 验证 HEX 颜色格式
 * @param {string} hex - 要验证的 HEX 颜色
 * @returns {boolean} 是否为有效的 HEX 颜色
 */
export function isValidHex(hex) {
    return hexColorRegex.test(hex);
}

/**
 * 验证 RGB 颜色格式
 * @param {string} rgb - 要验证的 RGB 颜色
 * @returns {boolean} 是否为有效的 RGB 颜色
 */
export function isValidRgb(rgb) {
    return /^(rgb|RGB)\(\s*(\d{1,3}%?\s*,\s*){2}\d{1,3}%?\s*\)$/.test(rgb);
}

/**
 * 扩展 String 类的颜色处理方法（向后兼容）
 */
// 注意：在现代 JavaScript 中，不建议修改内置原型
// 这些方法保留为独立函数，提供更好的兼容性

/**
 * 将 RGB 字符串转换为 HEX（字符串方法版本）
 * @deprecated 使用 rgbToHex() 函数代替
 */
String.prototype.colorHex = function() {
    console.warn('String.prototype.colorHex is deprecated. Use rgbToHex() function instead.');
    return rgbToHex(this.toString());
};

/**
 * 将 HEX 字符串转换为 RGB（字符串方法版本）
 * @deprecated 使用 hexToRgb() 函数代替
 */
String.prototype.colorRgb = function() {
    console.warn('String.prototype.colorRgb is deprecated. Use hexToRgb() function instead.');
    return hexToRgb(this.toString());
};

export default {
    rgbToHex,
    hexToRgb,
    isValidHex,
    isValidRgb
};