/**
 * UUID 生成器模块
 * 从 neat.js 迁移的 UUID 生成功能
 */

// Private array of chars to use
const UUIDCHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');

/**
 * 生成指定长度的 UUID
 * @param {number} len - UUID 长度
 * @param {number} radix - 进制（默认62）
 * @returns {string} 生成的 UUID
 */
export function generateUUID(len, radix) {
    let chars = UUIDCHARS,
        uuid = [],
        i;
    radix = radix || chars.length;

    if (len) {
        // Compact form
        for (i = 0; i < len; i++) uuid[i] = chars[0 | Math.random() * radix];
    } else {
        // rfc4122, version 4 form
        let r;

        // rfc4122 requires these characters
        uuid[8] = uuid[13] = uuid[18] = uuid[23] = '-';
        uuid[14] = '4';

        // Fill in random data.  At i==19 set the high bits of clock sequence as
        // per rfc4122, sec. 4.1.5
        for (i = 0; i < 36; i++) {
            if (!uuid[i]) {
                r = 0 | Math.random() * 16;
                uuid[i] = chars[(i === 19) ? (r & 0x3) | 0x8 : r];
            }
        }
    }

    return uuid.join('');
}

/**
 * 更快速的 RFC4122v4 UUID 生成器
 * 通过最小化 random() 调用来提升性能
 * @returns {string} UUID v4 格式的字符串
 */
export function generateUUIDFast() {
    let uuid = new Array(36),
        rnd = 0,
        r;
    for (let i = 0; i < 36; i++) {
        if (i === 8 || i === 13 || i === 18 || i === 23) {
            uuid[i] = '-';
        } else if (i === 14) {
            uuid[i] = '4';
        } else {
            if (rnd <= 0x02) rnd = 0x2000000 + (Math.random() * 0x1000000) | 0;
            r = rnd & 0xf;
            rnd = rnd >> 4;
            uuid[i] = UUIDCHARS[(i === 19) ? (r & 0x3) | 0x8 : r];
        }
    }
    return uuid.join('');
}

/**
 * 生成简单的短 UUID
 * @param {number} length - UUID 长度，默认8
 * @returns {string} 短 UUID
 */
export function generateShortUUID(length = 8) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

/**
 * 生成基于时间戳的 UUID
 * @returns {string} 时间戳 UUID
 */
export function generateTimestampUUID() {
    const timestamp = Date.now().toString(36);
    const randomPart = Math.random().toString(36).substring(2);
    return `${timestamp}-${randomPart}`;
}

// 为了向后兼容，保留 Math.uuid 扩展
Math.uuid = generateUUID;
Math.uuidFast = generateUUIDFast;

export default {
    generateUUID,
    generateUUIDFast,
    generateShortUUID,
    generateTimestampUUID
};