/**
 * Separator logic (extracted from neat.js as the first P1 ES module).
 *
 * Pure, chrome-free and DOM-free: the chrome.storage mirror is injected as
 * the `store` constructor argument, so the module is directly unit-testable
 * (tests/separators.test.js imports this real source).
 *
 * A "separator" is a bookmark whose URL matches the configured separator URL
 * prefix (default http://separatethis.com/) or contains one of the configured
 * separator substrings. SeparatorManager also tracks the ids of separators
 * present in the rendered tree (persisted as a comma-joined list).
 *
 * Also hosts uuidFast() (RFC4122v4, moved out of neat.js when neatools was
 * retired): actions.js imports it to mint unique separator URLs.
 */

export class StringList {
    constructor() {
        this._strings_ = [];
    }

    append(str) {
        const inputStr = `${str}`;
        if (inputStr) {
            this._strings_.push(inputStr);
        }
    }

    remove(str) {
        const inputStr = `${str}`;
        if (inputStr) {
            for (let i = 0; i < this._strings_.length; i++) {
                if (this._strings_[i] === inputStr) {
                    this._strings_.splice(i, 1);
                    break;
                }
            }
        }
    }

    replace(strOld, strNew) {
        const inputStr = `${strOld}`;
        const newStr = `${strNew}`;
        if (inputStr) {
            for (let i = 0; i < this._strings_.length; i++) {
                if (this._strings_[i] === inputStr) {
                    this._strings_[i] = newStr;
                }
            }
        }
    }

    clear() {
        return this._strings_ = [];
    }

    size() {
        return this._strings_.length;
    }

    fromString(str) {
        const inputStr = `${str}`;
        if (inputStr) {
            this._strings_ = inputStr.split(",");
        }
    }

    toString() {
        return this._strings_.join(",");
    }
}

export function isBlank(str) {
    return (!str || /^\s*$/.test(str));
}

export class SeparatorManager {
    constructor(store) {
        this.store = store;
        this.stringList = new StringList();
        if (!isBlank(store.get('separatorTitle'))) {
            this.separatorTitle = store.get('separatorTitle');
        } else {
            this.separatorTitle = "|";
        }
        if (!isBlank(store.get('separatorURL'))) {
            this.separatorURL = store.get('separatorURL');
        } else {
            this.separatorURL = "http://separatethis.com/";
        }
        this.separatorString = [];
        if (!isBlank(store.get('separatorString'))) {
            this.separatorString = store.get('separatorString').split(';');
        } else {
            this.separatorString.push("separatethis.com");
        }
    }

    load() {
        if (this.store.get('separators')) {
            this.stringList.fromString(this.store.get('separators'));
        }
    }

    save() {
        this.store.set('separators', this.stringList.toString());
    }

    add(str) {
        if (this.stringList._strings_.indexOf(str) === -1) {
            this.stringList.append(str);
        }
    }

    update(str, strNew) {
        this.stringList.replace(str, strNew);
    }

    remove(str) {
        this.stringList.remove(str);
    }

    getAll() {
        return this.stringList._strings_;
    }

    clear() {
        this.store.set('separators', "");
        this.stringList.clear();
    }

    size() {
        return this.stringList.size();
    }

    isSeparator(title, url) {
        let isSeparator = (this.separatorURL && url.indexOf(this.separatorURL) === 0);
        if (!isSeparator) {
            for (let j = 0; j < this.separatorString.length; j++) {
                if (this.separatorString[j].length > 1) {
                    if (url.indexOf(this.separatorString[j]) !== -1) {
                        isSeparator = true;
                        break;
                    }
                }
            }
        }
        return isSeparator;
    }
}

// Private array of chars to use
const UUIDCHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');

// A more performant, but slightly bulkier, RFC4122v4 solution.  We boost performance
// by minimizing calls to random()
export function uuidFast() {
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
