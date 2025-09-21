(window => {
    let currentContext;
    const document = window.document;
    const chrome = window.chrome;
    const localStorage = window.localStorage;
    const navigator = window.navigator;
    const body = document.body;
    const _m = chrome.i18n.getMessage;

    function StringList() {
        this._strings_ = [];
    }

    StringList.prototype.append = function (str) {
        const inputStr = `${str}`;
        if (inputStr) {
            this._strings_.push(inputStr);
        }
    };

    StringList.prototype.remove = function (str) {
        const inputStr = `${str}`;
        if (inputStr) {
            for (let i = 0; i < this._strings_.length; i++) {
                if (this._strings_[i] === inputStr) {
                    this._strings_.splice(i, 1);
                    break;
                }
            }
        }
    };

    StringList.prototype.replace = function (strOld, strNew) {
        const inputStr = `${strOld}`;
        const newStr = `${strNew}`;
        if (inputStr) {
            for (let i = 0; i < this._strings_.length; i++) {
                if (this._strings_[i] === inputStr) {
                    this._strings_[i] = newStr;
                }
            }
        }
    };

    StringList.prototype.clear = function () {
        return this._strings_ = [];
    };

    StringList.prototype.size = function () {
        return this._strings_.length;
    };

    StringList.prototype.fromString = function (str) {
        const inputStr = `${str}`;
        if (inputStr) {
            this._strings_ = inputStr.split(",");
        }
    };

    StringList.prototype.toString = function () {
        return this._strings_.join(",");
    };

    function isBlank(str) {
        return (!str || /^\s*$/.test(str));
    }

    function SeparatorManager() {
        this.stringList = new StringList();
        if (!isBlank(localStorage.separatorTitle)) {
            this.separatorTitle = localStorage.separatorTitle;
        } else {
            this.separatorTitle = "|";
        }
        if (!isBlank(localStorage.separatorURL)) {
            this.separatorURL = localStorage.separatorURL;
        } else {
            this.separatorURL = "http://separatethis.com/";
        }
        this.separatorString = [];
        if (!isBlank(localStorage.separatorString)) {
            this.separatorString = localStorage.separatorString.split(';');
        } else {
            this.separatorString.push("separatethis.com");
        }
    }

    SeparatorManager.prototype.load = function () {
        if (localStorage.separators) {
            this.stringList.fromString(localStorage.separators);
        }
    };

    SeparatorManager.prototype.save = function () {
        localStorage.separators = this.stringList.toString();
    };

    SeparatorManager.prototype.add = function (str) {
        if (this.stringList._strings_.indexOf(str) === -1) {
            this.stringList.append(str);
        }
    };

    SeparatorManager.prototype.update = function (str, strNew) {
        this.stringList.replace(str, strNew);
    };

    SeparatorManager.prototype.remove = function (str) {
        this.stringList.remove(str);
    };

    SeparatorManager.prototype.getAll = function () {
        return this.stringList._strings_;
    };

    SeparatorManager.prototype.clear = function () {
        localStorage.separators = "";
        this.stringList.clear();
    };

    SeparatorManager.prototype.size = function () {
        return this.stringList.size();
    };

    SeparatorManager.prototype.isSeparator = function (title, url) {
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
    };

    const separatorManager = new SeparatorManager();

    //regex for color expressions
    const hexColorRegex = /^#([0-9a-fA-f]{3}|[0-9a-fA-f]{6})$/;
    //RGB -> HEX
    String.prototype.colorHex = function () {
        const that = this;
        if (/^(rgb|RGB)/.test(that)) {
            const aColor = that.replace(/(?:\(|\)|rgb|RGB)*/g, "").split(",");
            let strHex = "#";
            for (let i = 0; i < aColor.length; i++) {
                let hex = Number(aColor[i]).toString(16);
                if (hex === "0") {
                    hex += hex;
                }
                strHex += hex;
            }
            if (strHex.length !== 7) {
                strHex = that;
            }
            return strHex;
        } else if (hexColorRegex.test(that)) {
            const aNum = that.replace(/#/, "").split("");
            if (aNum.length === 6) {
                return that;
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
    };

    //HEX -> RGB
    String.prototype.colorRgb = function () {
        let sColor = this.toLowerCase();
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
    };

    // Private array of chars to use
    const UUIDCHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('');

    Math.uuid = (len, radix) => {
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
    };

    // A more performant, but slightly bulkier, RFC4122v4 solution.  We boost performance
    // by minimizing calls to random()
    Math.uuidFast = () => {
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
    };


    // ++++++++ added by windviki@gmail.com ++++++++
    const copyToClipboard = copyText => {
        if (window.clipboardData) {
            window.clipboardData.setData("Text", copyText);
        } else {
            const copier = $('copier-input');
            copier.value = copyText;
            copier.select();
            document.execCommand("Copy");
        }
    };

    // class for get tree style text
    function TreeText(nodeId) {
        this.id = nodeId;
        this.text = '';
        this.level = 0;
    }


    TreeText.prototype.get = function (fn) {
        const _self1 = this;
        const _fn1 = fn;
        chrome.bookmarks.get(_self1.id, nodeList => {
            if (!nodeList.length)
                return;
            const node = nodeList[0];
            const url = node.url;
            const title = node.title;
            // check whether the referenced node is bookmark or folder
            const isBookmark = !!url;
            _self1.text += _self1.level ? '\t' * _self1.level : `${title}\r\n`;
            if (isBookmark) {
                _self1.text += _self1.level ? '\t' * _self1.level : `${url}`;
                if (_fn1)
                    _fn1(_self1.text);
            } else {
            }
        });
    };

    // ++++++++ end ++++++++

    // Error alert
    const AlertDialog = {
        open: dialog => {
            if (!dialog)
                return;
            $('alert-dialog-text').innerHTML = dialog;
            body.addClass('needAlert');
        },
        close: () => {
            body.removeClass('needAlert');
        }
    };
    window.addEventListener('error', () => {
        AlertDialog.open(`<strong>${_m('errorOccured')}</strong><br>${_m('reportedToDeveloper')}`);
    }, false);

    // Platform detection
    const os = (navigator.platform.toLowerCase().match(/mac|win|linux/i) || ['other'])[0];
    body.addClass(os);

    // Chrome version detection
    const version = (() => {
        const v = {};
        const keys = ['major', 'minor', 'build', 'patch'];
        const matches = navigator.userAgent.match(/chrome\/([\d]+)\.([\d]+)\.([\d]+)\.([\d]+)/i);
        if (!matches)
            return null;
        matches.slice(1).forEach((m, i) => {
            v[keys[i]] = m.toInt();
        });
        return v;
    })();

    // Some i18n
    $('search-input').placeholder = _m('searchBookmarks');
    $('edit-dialog-name').placeholder = _m('name');
    $('edit-dialog-url').placeholder = _m('url');
    $('new-folder-dialog-name').placeholder = _m('name');
    $each({
        'bookmark-new-tab': 'openNewTab',
        'bookmark-new-window': 'openNewWindow',
        'bookmark-new-incognito-window': 'openIncognitoWindow',
        'bookmark-edit': 'edit',
        'bookmark-delete': 'delete',
        'add-bookmark-top': 'addBookmarkTop',
        'add-bookmark-bottom': 'addBookmarkBottom',
        'add-bookmark-before-bookmark': 'addBookmarkBefore',
        'add-bookmark-after-bookmark': 'addBookmarkAfter',
        'add-folder-before-bookmark': 'addNewFolderBefore',
        'add-folder-after-bookmark': 'addNewFolderAfter',
        'add-bookmark-before-folder': 'addBookmarkBefore',
        'add-bookmark-after-folder': 'addBookmarkAfter',
        'add-folder-before-folder': 'addNewFolderBefore',
        'add-folder-after-folder': 'addNewFolderAfter',
        'add-new-folder': 'addNewFolder',
        'add-separator': 'addSeparator',
        'remove-separator': 'removeSeparator',
        'add-folder-separator': 'addSeparator',
        'copy-title-and-url': 'copyTitleAndUrl',
        // 'copy-all-titles-and-urls' : 'copyAllTitlesAndUrls',
        'replace-url': 'replaceUrl',
        'folder-window': 'openBookmarks',
        'folder-new-window': 'openBookmarksNewWindow',
        'folder-new-incognito-window': 'openBookmarksIncognitoWindow',
        'folder-edit': 'edit',
        'folder-delete': 'deleteEllipsis',
        'edit-dialog-button': 'save',
        'edit-dialog-cancel-button': 'nope',
        'new-folder-dialog-button': 'save',
        'new-folder-dialog-cancel-button': 'nope'
    }, (msg, id) => {
        const el = $(id);
        const m = _m(msg);
        if (el.tagName === 'COMMAND')
            el.label = m;
        el.textContent = m;
    });

    // RTL indicator
    const rtl = (body.getComputedStyle('direction') === 'rtl');
    if (rtl)
        body.addClass('rtl');

    // Init some variables
    let opens = localStorage.opens ? JSON.parse(localStorage.opens) : [];
    let rememberState = !localStorage.dontRememberState;
    const httpsPattern = /^https?:\/\//i;
    const onlyShowBMBar = !!localStorage.onlyShowBMBar;

    // Adaptive bookmark tooltips
    const adaptBookmarkTooltips = () => {
        const bookmarks = document.querySelectorAll('li.child a');
        for (let i = 0, l = bookmarks.length; i < l; i++) {
            const bookmark = bookmarks[i];
            if (bookmark.querySelector('hr')) {
                bookmark.title = '';
            } else {
                if (bookmark.hasClass('titled')) {
                    if (bookmark.scrollWidth <= bookmark.offsetWidth) {
                        bookmark.title = bookmark.href;
                        bookmark.removeClass('titled');
                    }
                } else if (bookmark.scrollWidth > bookmark.offsetWidth) {
                    const text = bookmark.querySelector('i').textContent;
                    const title = bookmark.title;
                    if (text !== title) {
                        bookmark.title = `${text}\n${title}`;
                        bookmark.addClass('titled');
                    }
                }
            }
        }
    };

    const getFaviconUrl = (url) => {
        // return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
        // return chrome.runtime.getURL(`_favicon/?pageUrl=${encodeURIComponent(url)}&size=64`);
        const favUrl = new URL(chrome.runtime.getURL("/_favicon/"));
        favUrl.searchParams.set("pageUrl", url);
        favUrl.searchParams.set("size", "32");
        return favUrl.toString();
    };

    /**
     * Get metadata display settings
     */
    const getMetadataSettings = () => {
        return {
            showAddedDate: localStorage.getItem('vbookmarks_show_added_date') !== 'false',
            showLastAccessed: localStorage.getItem('vbookmarks_show_last_accessed') !== 'false',
            showClickCount: localStorage.getItem('vbookmarks_show_click_count') !== 'false'
        };
    };

    /**
     * Get compact date representation
     */
    const getCompactDate = (date) => {
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
    };

    /**
     * Format date for display
     */
    const formatDate = (date) => {
        if (!date) return '';

        const now = new Date();
        const timestamp = typeof date === 'string' ? new Date(date) : date;
        const diff = now - timestamp;
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));

        if (days === 0) {
            return '今天';
        } else if (days === 1) {
            return '昨天';
        } else if (days < 7) {
            return `${days}天前`;
        } else if (days < 30) {
            return `${Math.floor(days / 7)}周前`;
        } else if (days < 365) {
            return `${Math.floor(days / 30)}个月前`;
        } else {
            return `${Math.floor(days / 365)}年前`;
        }
    };

    /**
     * Get bookmark metadata HTML
     */
    const getBookmarkMetadataHTML = (bookmarkId) => {
        if (!bookmarkId) {
            return '';
        }

        // BookmarkMetadataManager应该已经初始化完成
        if (!window.metadataManager) {
            console.warn('MetadataManager not available for bookmark:', bookmarkId);
            return '';
        }

        try {
            const settings = getMetadataSettings();
            const metadata = window.metadataManager.getMetadata(bookmarkId);

            if (!settings.showAddedDate && !settings.showLastAccessed && !settings.showClickCount) {
                return '';
            }

        let metadataHtml = '';

            if (settings.showClickCount && metadata.clickCount > 0) {
                const clickTitle = chrome.i18n.getMessage('clickCount') || 'Clicks';
                metadataHtml += `<span class="meta-badge clicks" title="${clickTitle}: ${metadata.clickCount}">${metadata.clickCount}</span>`;
            }

            if (settings.showAddedDate && metadata.addedDate) {
                const dateStr = formatDate(metadata.addedDate);
                const addedTitle = chrome.i18n.getMessage('addedDate') || 'Added';
                metadataHtml += `<span class="meta-badge date" title="${addedTitle}: ${dateStr}">${getCompactDate(metadata.addedDate)}</span>`;
            }

            if (settings.showLastAccessed && metadata.lastAccessed) {
                const dateStr = formatDate(metadata.lastAccessed);
                const accessedTitle = chrome.i18n.getMessage('lastAccessed') || 'Accessed';
                metadataHtml += `<span class="meta-badge accessed" title="${accessedTitle}: ${dateStr}">${getCompactDate(metadata.lastAccessed)}</span>`;
            }

            return metadataHtml;
        } catch (error) {
            console.warn('Failed to generate bookmark metadata HTML for', bookmarkId, ':', error);
            return '';
        }
    };

    const generateBookmarkHTML = (title, url, extras, bookmarkId) => {
        if (!extras)
            extras = '';
        const u = url.htmlspecialchars();
        // let favicon = `chrome://favicon/${u}`;
        // let favicon = 'icon-2.png';
        let favicon = getFaviconUrl(url);
        let tooltipURL = url;
        if (/^javascript:/i.test(url)) {
            if (url.length > 140)
                tooltipURL = `${url.slice(0, 140)}...`;
            favicon = 'document-code.png';
        }
        tooltipURL = tooltipURL.htmlspecialchars();
        const name = title.htmlspecialchars() || (httpsPattern.test(url) ? url.replace(httpsPattern, '') : _m('noTitle'));

        // Add sync status indicator if enabled
        let syncIndicator = '';
        if (localStorage.showSyncStatus === 'true' && window.syncManager && bookmarkId) {
            const syncStatus = window.syncManager.getSyncStatusIndicator(bookmarkId);
            const syncTooltip = window.syncManager.getSyncTooltip(bookmarkId);
            if (syncStatus) {
                syncIndicator = `<span class="sync-indicator ${syncStatus}" title="${syncTooltip}">
                    <span class="sync-tooltip">${syncTooltip}</span>
                </span>`;
            }
        }

        // Add metadata display
        const metadataHTML = getBookmarkMetadataHTML(bookmarkId);

        return `<a href="${u}" title="${tooltipURL}" tabindex="0" ${extras} class="tree-item-link">
                <div class="favicon-container">
                    <img src="${favicon}" width="16" height="16" alt="">
                    ${syncIndicator}
                </div>
                <i>${name}</i>
                ${metadataHTML}
                </a>`;
    };

    const generateFolderHTML = (title, extras, folderId, folderNode) => {
        if (!extras)
            extras = '';

        // Handle dual storage folders - add suffix for non-syncing folders
        let displayTitle = title || _m('noTitle');
        if (folderNode && folderNode.syncing === false && folderNode.folderType) {
            // Add suffix to distinguish between syncing and non-syncing folders
            const suffix = ' (Local)';
            displayTitle += suffix;
        }

        // Add sync status indicator if enabled
        let syncIndicator = '';
        if (localStorage.showSyncStatus === 'true' && window.syncManager && folderId) {
            const syncStatus = window.syncManager.getSyncStatusIndicator(folderId);
            const syncTooltip = window.syncManager.getSyncTooltip(folderId);
            if (syncStatus) {
                syncIndicator = `<span class="sync-indicator ${syncStatus}" title="${syncTooltip}">
                    <span class="sync-tooltip">${syncTooltip}</span>
                </span>`;
            }
        }

        return `<span tabindex="0" ${extras} class="tree-item-span">
		   <b class="twisty"></b>
		   <div class="favicon-container">
		       <img src="folder.png" width="16" height="16" alt="">
		       ${syncIndicator}
		   </div>
		   <i>${displayTitle}</i>
		   </span>`;
    };

    const generateSeparatorHTML = paddingStart => {
        let color = '#888888';
        if (localStorage.separatorcolor) {
            color = localStorage.separatorcolor.colorHex();
        }
        const aStyle = `style="-webkit-padding-start: ${paddingStart}px"`;
        const hrWidth = window.innerWidth - paddingStart - 40;
        const hrStyle = `style="width=${hrWidth}px;align=right;border:1px dotted ${color};"`
        return `<a href="#" tabindex="0" ${aStyle} class="tree-item-link">
                <div class="favicon-container">
                    <img width="16" height="16" style="display:none;" alt="">
                </div>
                <i></i>
                <hr class="child" role="treeitem" ${hrStyle}">
                </a>`;
    };

    const generateHTML = (data, level) => {
        if (!level)
            level = 0;
        const paddingStart = 14 * level;
        const group = (level === 0) ? 'tree' : 'group';
        let html = `<ul role="${group}" data-level="${level}">`;

        for (let i = 0, l = data.length; i < l; i++) {
            const d = data[i];
            const children = d.children;
            const title = d.title.htmlspecialchars();
            const url = d.url;
            const id = d.id;
            const parentID = d.parentId;
            const idHTML = id ? `id="neat-tree-item-${id}"` : '';
            const isFolder = d.dateGroupModified || children || typeof url === 'undefined';
            const stylePad = `style="-webkit-padding-start: ${paddingStart}px"`;
            const classStr = isFolder ? 'parent' : 'child';
            const isOpen = rememberState && opens.contains(id);
            const open = isOpen ? 'open' : '';
            const ariaStr = isFolder ? `aria-expanded="${isOpen}"` : '';
            html += `<li class="${classStr} ${open}" ${idHTML} level="${level}" role="treeitem" ${ariaStr} data-parentid="${parentID}">`;
            if (isFolder) { // folder node
                html += generateFolderHTML(title, stylePad, id, d);
                // only generate children for opened folder
                if (isOpen) {
                    if (children) {
                        html += generateHTML(children, level + 1);
                    } else {
                        (_id => {
                            chrome.bookmarks.getChildren(_id, children => {
                                const html = generateHTML(children, level + 1);
                                const div = document.createElement('div');
                                div.innerHTML = html;
                                const ul = div.querySelector('ul');
                                ul.inject($(`neat-tree-item-${_id}`));
                                div.destroy();
                            });
                        })(id);
                    }
                }
            } else { // bookmark node
                if (separatorManager.isSeparator(title, url)) {
                    html += generateSeparatorHTML(paddingStart);
                    separatorManager.add(id);
                } else {
                    html += generateBookmarkHTML(title, url, stylePad, id);
                }
            }
            html += '</li>';
        }
        html += '</ul>';
        return html;
    };

    const addSeparator = (nodeId, where) => {
        addNewNode(nodeId, where,
            `${separatorManager.separatorURL}#${Math.uuidFast()}`,
            separatorManager.separatorTitle, true);
    };

    const deleteSeparator = id => {
        const li = $(`neat-tree-item-${id}`);
        chrome.bookmarks.removeTree(id, () => {
            li.destroy();
            separatorManager.remove(id);
        });
        const nearLi = li.nextElementSibling || li.previousElementSibling;
        if (nearLi)
            nearLi.querySelector('a, span').focus();
    };

    separatorManager.clear();
    const $tree = $('tree');

    const nodeTrees = {};
    const generateNodeTrees = (data, list) => {
        if (data) {
            for (let i = 0, l = data.length; i < l; i++) {
                const d = data[i];
                if (!d.url) {
                    if (d.parentId >= 1) {
                        list[d.id] = d.parentId;
                    }
                    generateNodeTrees(d.children, list);
                }
            }
        }
    };

    const getParentPath = (nodeID, list) => {
        const nodePath = [];
        nodePath.push(nodeID);
        let lastID = nodeID;
        while (nodeID) {
            if (nodeID in list) {
                if (lastID === list[nodeID]) {
                    break;
                }
                nodePath.push(list[nodeID]);
                nodeID = list[nodeID];
                lastID = nodeID;
            } else {
                break;
            }
        }
        return nodePath.reverse();
    };

    // Find folder by folderType in the tree (supports dual storage)
    const findFolderByType = (tree, folderType) => {
        if (!tree || !Array.isArray(tree)) return null;

        function searchFolder(nodes) {
            if (!nodes || !Array.isArray(nodes)) return null;

            for (const node of nodes) {
                if (node.folderType === folderType) {
                    return node;
                }
                if (node.children) {
                    const found = searchFolder(node.children);
                    if (found) return found;
                }
            }
            return null;
        }

        return searchFolder(tree);
    };

    const generateTree = tree => {
        let subTree;
        if (onlyShowBMBar) {
            // Find the bookmarks bar folder using folderType instead of fixed position
            const bookmarksBarFolder = findFolderByType(tree, 'bookmarks-bar');
            if (bookmarksBarFolder) {
                subTree = bookmarksBarFolder.children || [];
            } else {
                // Fallback to old logic if folderType not available
                subTree = tree[0].children[0].children;
            }
        } else {
            subTree = tree[0].children;
        }
        const html = generateHTML(subTree);
        generateNodeTrees(subTree, nodeTrees);

        $tree.innerHTML = html;

        // Refresh sync indicators after tree is generated
        if (localStorage.showSyncStatus === 'true') {
            setTimeout(() => {
                refreshSyncIndicators();
            }, 100);
        }

        if (rememberState) {
            $tree.scrollTop = localStorage.scrollTop ? localStorage.scrollTop : 0;
        }

        const focusID = localStorage.focusID;
        if (typeof focusID !== 'undefined' && focusID !== null) {
            const focusEl = $(`neat-tree-item-${focusID}`);
            if (focusEl) {
                const oriOverflow = $tree.style.overflow;
                $tree.style.overflow = 'hidden';
                focusEl.style.width = '100%';
                focusEl.firstElementChild.addClass('focus');
                setTimeout(() => {
                    $tree.style.overflow = oriOverflow;
                }, 1);
                setTimeout(() => {
                    localStorage.removeItem('focusID');
                }, 4000);
            }
        }

        setTimeout(adaptBookmarkTooltips, 100);

        // try to load local separator list used in last version
        const sm = new SeparatorManager();
        sm.load();
        const seps = sm.getAll();
        for (let i = 0; i < seps.length; i++) {
            if (seps[i]) {
                addSeparator(seps[i], 'after');
            }
        }
        // and discard this setting from now on
        sm.clear();
        sm.save();

        tree = null;
    };

    // restore height
    if (localStorage.popupHeight) {
        body.style.height = localStorage.popupHeight;
    }

    chrome.bookmarks.getTree(generateTree);

    // Events for the tree
    $tree.addEventListener('scroll', () => {
        localStorage.scrollTop = $tree.scrollTop;
    });
    $tree.addEventListener('focus', e => {
        const el = e.target;
        const tagName = el.tagName;
        const focusEl = $tree.querySelector('.focus');
        if (focusEl)
            focusEl.removeClass('focus');
        if (tagName === 'A' || tagName === 'SPAN') {
            localStorage.focusID = el.parentNode.id.replace('neat-tree-item-', '');
        } else {
            localStorage.focusID = null;
        }
    }, true);
    const closeUnusedFolders = localStorage.closeUnusedFolders;
    $tree.addEventListener('click', e => {
        if (e.button !== 0)
            return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName !== 'SPAN')
            return;
        if (e.shiftKey || e.ctrlKey)
            return;
        const parent = el.parentNode;
        parent.toggleClass('open');
        const expanded = parent.hasClass('open');
        parent.setAttribute('aria-expanded', expanded);
        const children = parent.querySelector('ul');
        // expand children for unexpanded folder node
        if (!children) {
            const id = parent.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id, children => {
                const html = generateHTML(children, parseInt(parent.parentNode.dataset.level) + 1);
                const div = document.createElement('div');
                div.innerHTML = html;
                const ul = div.querySelector('ul');
                ul.inject(parent);
                div.destroy();
                setTimeout(adaptBookmarkTooltips, 100);
            });
        }
        if (closeUnusedFolders && expanded) {
            const siblings = parent.getSiblings('li');
            for (let i = 0, l = siblings.length; i < l; i++) {
                const li = siblings[i];
                if (li.hasClass('parent')) {
                    li.removeClass('open').setAttribute('aria-expanded', false);
                }
            }
        }
        let opens = $tree.querySelectorAll('li.open');
        opens = Array.map(li => li.id.replace('neat-tree-item-', ''), opens);
        localStorage.opens = JSON.stringify(opens);
    });
    // Force middle clicks to trigger the focus event
    $tree.addEventListener('mouseup', e => {
        if (e.button !== 1)
            return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName !== 'A' && tagName !== 'SPAN')
            return;
        el.focus();
    });

    const switchBookmarkMenu = disable => {
        if (disable) {
            $('add-bookmark-before-bookmark').style.display = 'none';
            $('add-bookmark-after-bookmark').style.display = 'none';
            $('bookmark-context-menu-sep1').style.display = 'none';
            $('add-folder-before-bookmark').style.display = 'none';
            $('add-folder-after-bookmark').style.display = 'none';
            $('bookmark-context-menu-sep2').style.display = 'none';
            $('add-separator').style.display = 'none';
            $('bookmark-context-menu-sep3').style.display = 'none';
        } else {
            $('add-bookmark-before-bookmark').style.display = 'block';
            $('add-bookmark-after-bookmark').style.display = 'block';
            $('bookmark-context-menu-sep1').style.display = 'block';
            $('add-folder-before-bookmark').style.display = 'block';
            $('add-folder-after-bookmark').style.display = 'block';
            $('bookmark-context-menu-sep2').style.display = 'block';
            $('add-separator').style.display = 'block';
            $('bookmark-context-menu-sep3').style.display = 'block';
        }
    };

    // parse version to dictionary
    const parseVersion = function(strversion) {
        let v = {};
        const keys = [ 'major', 'minor' ];
        let matches = strversion.match(/([\d]+)\.([\d]+)/i);
        if (!matches)
            return null;
        matches.slice(1).forEach(function(m, i) {
            v[keys[i]] = m.toInt();
        });
        return v;
    };

    // Donation
    let newOrUpgrade = true;
    const mf = chrome.runtime.getManifest();
    const currentVer = parseVersion(mf["version"]);
    if (!localStorage.currentVersion) {
        localStorage.currentVersion = mf["version"];
    } else {
        let recordVer = parseVersion(localStorage.currentVersion);
        localStorage.currentVersion = mf["version"];
        if (recordVer && currentVer && recordVer['major'] && recordVer['minor'] && currentVer['major'] && currentVer['minor']) {     
            if ( (recordVer['major'] > currentVer['major']) ||
                ((recordVer['major'] == currentVer['major']) && (recordVer['minor'] >= currentVer['minor'])) ){
                newOrUpgrade = false;
            }
        }
    }
    if (!localStorage.openCount) {
        localStorage.openCount = 1;
    } else {
        localStorage.openCount++;
    }
    if (!localStorage.donationKey) {
        localStorage.donationKey = 1;
    }

    const $donation = $('donation');
    const showDonation = (show) => {
        if (show) {
            if (newOrUpgrade) {
                $('new-version-text').innerHTML = _m('versionMessage', 
                    [mf["version"], 'Github']);
            }
            $('donation-text').innerHTML = _m('donationMessage');
            $donation.style.display = 'block';
            let seconds = localStorage.donationCountDown > 0 ? localStorage.donationCountDown : 10;
            let countDown = setInterval(() => {
                localStorage.donationCountDown = seconds;
                if (seconds <= 0) {
                    $('donation-go').innerHTML = _m('donationGo');
                    $('donation-go').disabled = false;
                    clearInterval(countDown);
                    localStorage.donationCountDown = 0;
                } else {
                    $('donation-go').innerHTML = `${seconds}s`;
                    $('donation-go').disabled = true;
                    $('donation-go').focus();
                }
                seconds--;
            }, 1000);
        } else {
            $donation.style.display = 'none';
        }
    }

    if (newOrUpgrade || localStorage.donationCountDown > 0 
        || !localStorage.donationFactor 
        || localStorage.donationFactor.toInt() >= localStorage.donationKey.toInt()) {
        showDonation(true);
    } else {
        localStorage.donationFactor = localStorage.donationFactor.toInt() + 1;
    }

    // Search
    const searchAfterEnter = !!localStorage.searchAfterEnter;
    const $results = $('results');
    let searchMode = false;
    const searchInput = $('search-input');
    let prevValue = '';

    const quitSearchMode = (ignoreFocus) => {
        if (searchMode) {
            prevValue = '';
            if (searchInput.value) {
                searchInput.value = '';
            }
            localStorage.searchQuery = '';
            searchMode = false;
            switchBookmarkMenu(false);
            $tree.style.display = 'block';
            $results.style.display = 'none';

            if (ignoreFocus === null || !ignoreFocus) {
                // fix focus
                let item = $tree.querySelector('.focus');
                // not found focus, focus on the root node
                if (!item) {
                    item = $tree.querySelector('li:first-child>span');
                }
                if (item) {
                    item.focus();
                }
            }
        }
    };

    const search = (e) => {
        const value = searchInput.value.trim();
        localStorage.searchQuery = value;
        if (value === '') {
            quitSearchMode();
            return;
        }
        if (searchAfterEnter && !e) {
            return;
        }
        if (value === prevValue)
            return;
        prevValue = value;
        searchMode = true;
        switchBookmarkMenu(true);
        chrome.bookmarks.search(value, results => {
            const v = value.toLowerCase();
            let vPattern = new RegExp(`^${value.escapeRegExp().replace(/\s+/g, '.*')}`, 'ig');
            if (results.length > 1) {
                results.sort((a, b) => {
                    if (a.url && !b.url) {
                        return 1;
                    }
                    if (!a.url && b.url) {
                        return -1;
                    }
                    const aTitle = a.title;
                    const bTitle = b.title;
                    let aIndexTitle = aTitle.toLowerCase().indexOf(v);
                    let bIndexTitle = bTitle.toLowerCase().indexOf(v);
                    if (aIndexTitle >= 0 || bIndexTitle >= 0) {
                        if (aIndexTitle < 0)
                            aIndexTitle = Infinity;
                        if (bIndexTitle < 0)
                            bIndexTitle = Infinity;
                        return aIndexTitle - bIndexTitle;
                    }
                    const aTestTitle = vPattern.test(aTitle);
                    const bTestTitle = vPattern.test(bTitle);
                    if (aTestTitle && !bTestTitle)
                        return -1;
                    if (!aTestTitle && bTestTitle)
                        return 1;
                    return b.dateAdded - a.dateAdded;
                });
                results = results.slice(0, 100); // 100 is enough
            }
            let html = '<ul role="list">';
            for (let i = 0, l = results.length; i < l; i++) {
                const result = results[i];
                const id = result.id;
                if (result.url) {
                    if (!separatorManager.isSeparator(result.title, result.url)) {
                        html += `<li data-parentid="${result.parentId}" id="results-item-${id}" role="listitem">
                                ${generateBookmarkHTML(result.title, result.url, '', result.id)}</li>`;
                    }
                } else {  // folder
                    // Add sync status indicator for folders in search results
                    let syncIndicator = '';
                    if (localStorage.showSyncStatus === 'true' && window.syncManager && id) {
                        const syncStatus = window.syncManager.getSyncStatusIndicator(id);
                        const syncTooltip = window.syncManager.getSyncTooltip(id);
                        if (syncStatus) {
                            syncIndicator = `<span class="sync-indicator ${syncStatus}" title="${syncTooltip}">
                                <span class="sync-tooltip">${syncTooltip}</span>
                            </span>`;
                        }
                    }

                    html += `<li id="results-item-${id}" role="listitem"" data-parentid="${result.parentId}">
                            <a href="" class="link-folder tree-item-link">
                            <div class="favicon-container">
                            <img src="folder.png" width="16" height="16" alt="">
                            ${syncIndicator}
                            </div>
                            <i>${result.title || _m('noTitle')}</i>
                            </a></li>`;
                }
            }
            html += '</ul>';
            $tree.style.display = 'none';
            $results.innerHTML = html;
            $results.style.display = 'block';

            let lis = $results.querySelectorAll('li');
            Array.forEach(li => {
                const parentId = li.dataset.parentid;
                chrome.bookmarks.get(parentId, node => {
                    if (!node || !node.length)
                        return;
                    const a = li.querySelector('a');
                    // Add parent folder
                    if (a && node[0]) {
                        a.title = `${_m('parentFolder', node[0].title || 'root')}\n${a.title}`;
                    }
                });
            }, lis);

            results = null;
            vPattern = null;
            lis = null;
        });
    };

    searchInput.addEventListener('input', e => {
        if (!searchInput.value.length) {
            // keep focus on input
            // do not restore focus to item
            quitSearchMode(true);
        } else {
            search(null);
        }
    });

    searchInput.addEventListener('keydown', e => {
        const focusID = localStorage.focusID;
        if (e.key === 'ArrowDown' && searchInput.value.length === searchInput.selectionEnd) { // down
            e.preventDefault();
            if (searchMode) {
                $results.querySelector('ul>li:first-child a').focus();
            } else {
                $tree.querySelector('ul>li:first-child').querySelector('span, a').focus();
            }
        } else if (e.key === 'Enter' && searchInput.value.length) { // enter
            if (searchAfterEnter) {
                search(e);
            } else {
                const item = $results.querySelector('ul>li:first-child a');
                if (item) {
                    item.focus();
                    setTimeout(() => {
                        let event = new MouseEvent("click", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                        });
                        item.dispatchEvent(event);
                    }, 30);
                }
            }
        } else if (e.key === 'Tab' && !searchMode) { // tab
            if (typeof focusID !== 'undefined' && focusID !== null) {
                const focusEl = $(`neat-tree-item-${focusID}`);
                if (focusEl) {
                    e.preventDefault();
                    focusEl.firstElementChild.focus();
                }
            } else {
                const bound = $tree.scrollTop;
                const items = $tree.querySelectorAll('a, span');
                const firstItem = Array.filter(item =>
                    !!item.parentElement.offsetHeight && ((item.offsetTop + item.offsetHeight) > bound), items)[0];
                if (firstItem)
                    firstItem.focus();
            }
        } else if (e.key === 'Escape') { // esc
            if (searchInput.value) {
                // Pressing esc shouldn't close the popup when search field has value
                e.preventDefault();
                quitSearchMode(true);
            }
        }
    });

    searchInput.addEventListener('focus', () => {
        body.addClass('searchFocus');
    });
    searchInput.addEventListener('blur', () => {
        body.removeClass('searchFocus');
    });

    // Saved search query
    if (rememberState && localStorage.searchQuery) {
        searchInput.value = localStorage.searchQuery;
        search();
        searchInput.select();
        searchInput.scrollLeft = 0;
    }

    // Popup auto-height
    const resetHeight = () => {
        // Check if auto-resize is enabled (default to true for backward compatibility)
        const autoResizeEnabled = localStorage.autoResizePopup !== 'false';

        if (!autoResizeEnabled) {
            // If auto-resize is disabled, use the stored height or default to 600px
            const storedHeight = localStorage.popupHeight || '600';
            body.style.height = `${storedHeight}px`;
            return;
        }

        const zoomLevel = localStorage.zoom ? localStorage.zoom.toInt() / 100 : 1;
        const neatTree = $tree.firstElementChild;
        if (neatTree) {
            const fullHeight = (neatTree.offsetHeight + $tree.offsetTop + 16) * zoomLevel;
            // console.log(`fullHeight = ${fullHeight}`);
            chrome.tabs.getZoom(zoomFactor => {
                // zoomFactor is the zoom factor in chrome setting. e.g. 125%
                // left 50px at bottom if the screen is too short
                const maxHeight = Math.min(screen.height - window.screenY - 50, (600 / zoomFactor) - 1);
                // console.log(`zoomFactor = ${zoomFactor}, maxHeight = ${maxHeight}`);
                // 300 <= height <= maxHeight
                const height = Math.max(300 / zoomFactor, Math.min(fullHeight, maxHeight));
                // console.log(`height = ${height}`);
                const newHeightStyle = `${height}px`;
                // Slide up faster than down
                body.style.transitionDuration = (fullHeight < window.innerHeight) ? '.3s' : '.1s';
                body.style.height = newHeightStyle;
                localStorage.popupHeight = height;
            });
        }
    };

    if (!searchMode)
        resetHeight();

    $tree.addEventListener('click', resetHeight);
    $tree.addEventListener('keyup', resetHeight);

    // Confirm dialog
    const ConfirmDialog = {
        open: opts => {
            if (!opts)
                return;
            $('confirm-dialog-text').innerHTML = opts.dialog.widont();
            $('confirm-dialog-button-1').innerHTML = opts.button1;
            $('confirm-dialog-button-2').innerHTML = opts.button2;
            if (opts.fn1)
                ConfirmDialog.fn1 = opts.fn1;
            if (opts.fn2)
                ConfirmDialog.fn2 = opts.fn2;
            const focus = opts.focusButton || 1;
            $(`confirm-dialog-button-${focus}`).focus();
            document.body.addClass('needConfirm');
        },
        close: () => {
            document.body.removeClass('needConfirm');
        },
        fn1: () => {
        },
        fn2: () => {
        }
    };

    // Edit dialog
    const EditDialog = {
        open: opts => {
            if (!opts)
                return;
            $('edit-dialog-text').innerHTML = opts.dialog.widont();
            if (opts.fn)
                EditDialog.fn = opts.fn;
            const type = opts.type || 'bookmark';
            const name = $('edit-dialog-name');
            name.value = opts.name;
            name.focus();
            name.select();
            name.scrollLeft = 0; // very delicate, show first few words instead of last
            const url = $('edit-dialog-url');
            if (type === 'bookmark') {
                url.style.display = '';
                url.disabled = false;
                url.value = opts.url;
            } else {
                url.style.display = 'none';
                url.disabled = true;
                url.value = '';
            }
            //if lose focus, the page will submit it if bellowing class exists.
            body.addClass('needEdit');
        },
        close: needSave => {
            if (needSave === false) {
                body.removeClass('needEdit');
                return;
            }
            const urlInput = $('edit-dialog-url');
            let url = urlInput.value;
            if (!urlInput.validity.valid) {
                urlInput.value = `http://${url}`;
                if (!urlInput.validity.valid)
                    url = ''; // if still invalid, fuck it.
                url = `http://${url}`;
            }
            EditDialog.fn($('edit-dialog-name').value, url);
            body.removeClass('needEdit');
        },
        fn: () => {
        }
    };

    // ++++++++ modified by windviki@gmail.com ++++++++
    // New Folder Dialog
    const NewFolderDialog = {
        open: (optName, optCall) => {
            $('new-folder-dialog-text').innerHTML = _m('editFolder');
            if (optCall)
                NewFolderDialog.fn = optCall;
            const name = $('new-folder-dialog-name');
            name.value = optName;
            name.focus();
            name.select();
            name.scrollLeft = 0;
            //if lose focus, the page will submit it if bellowing class exists.
            body.addClass('needInputName');
        },
        close: needSave => {
            body.removeClass('needInputName');
            if (needSave !== false) {
                NewFolderDialog.fn($('new-folder-dialog-name').value);
            }
        },
        fn: () => {
        }
    };
    // ++++++++ end ++++++++

    // Events for dialogs
    $('confirm-dialog-button-1').addEventListener('click', () => {
        ConfirmDialog.fn1();
        ConfirmDialog.close();
    });
    $('confirm-dialog-button-2').addEventListener('click', () => {
        ConfirmDialog.fn2();
        ConfirmDialog.close();
    });
    $('edit-dialog-cancel-button').addEventListener('click', () => {
        EditDialog.close(false);
    });
    $('new-folder-dialog-cancel-button').addEventListener('click', () => {
        NewFolderDialog.close(false);
    });
    $('edit-dialog-form').addEventListener('submit', () => {
        EditDialog.close();
        return false;
    });
    $('new-folder-dialog-form').addEventListener('submit', () => {
        NewFolderDialog.close();
        return false;
    });

    function addNodeTo(referId, parentId, iIndex, addTitle, addUrl, where, isSeparator) {
        chrome.bookmarks.create({
            'parentId': parentId,
            'index': iIndex,
            'title': addTitle,
            'url': addUrl
        }, resultBm => {
            const addBm = !!addUrl;
            const rNode = $(`neat-tree-item-${referId}`);
            const isOpenDir = (rNode.getAttribute('aria-expanded') === 'true');
            if (!isOpenDir && (where === "top" || where === "bottom")) {
                return;
            }
            let lv = 0;
            let pNode = $(`neat-tree-item-${parentId}`);
            if (!pNode) {
                // root
                pNode = document.body;
            } else {
                lv = parseInt(pNode.parentNode.dataset.level) + 1;
            }
            const paddingStart = 14 * lv;
            const idHTML = resultBm.id ? `id="neat-tree-item-${resultBm.id}"` : '';
            const stylePad = `style="-webkit-padding-start: ${paddingStart}px"`;
            const classStr = `class="${addBm ? "child" : "parent"}"`;
            const extra = addBm ? '' : 'aria-expanded="false"';
            let inner;
            if (addBm) {
                if (isSeparator) {
                    inner = generateSeparatorHTML(paddingStart);
                }
                else {
                    inner = generateBookmarkHTML(addTitle, addUrl, stylePad, resultBm.id);
                }
            } else {
                inner = generateFolderHTML(addTitle, stylePad, resultBm.id, resultBm);
            }
            const html = `<li ${classStr} ${idHTML} level="${lv}" role="treeitem" ${extra} data-parentId="${parentId}">${inner}</li>`;

            const div = document.createElement('div');
            div.innerHTML = html;
            const li = div.querySelector('li');
            let ul = pNode.querySelector('ul');
            // fix ul
            if (!ul) {
                const tmpDiv = document.createElement('div');
                tmpDiv.innerHTML = `<ul role="group" data-level="${lv}"></ul>`;
                const newUl = tmpDiv.querySelector('ul');
                pNode.appendChild(newUl);
                ul = pNode.querySelector('ul');
                tmpDiv.destroy();
            }
            if (where === 'top') {
                if (ul.firstElementChild) {
                    ul.insertBefore(li, ul.firstElementChild);
                } else {
                    ul.appendChild(li);
                }
            }
            if (where === 'bottom') {
                ul.appendChild(li);
            }
            if (where === 'before') {
                ul.insertBefore(li, rNode);
            }
            if (where === 'after') {
                ul.insertBefore(li, rNode.nextSibling);
            }

            div.destroy();

            if (isSeparator) {
                separatorManager.add(resultBm.id);
            }
        });
    }

    function addFolderTo(referId, parentId, iIndex, where) {
        NewFolderDialog.open('NewFolder', dirTitle => {
            addNodeTo(referId, parentId, iIndex, dirTitle, "", where, false);
        }); // end NewFolderDialog.open
    }

    function addNewNode(nodeId, where, newUrl, newTitle, isSeparator) {
        chrome.bookmarks.get(nodeId, nodeList => {
            if (!nodeList.length)
                return;
            const node = nodeList[0];
            // check whether the target node is bookmark or folder
            const isAddBookmark = !!newUrl;
            // referenced node is folder - 'top', 'bottom', 'before', 'after'
            // referenced node is bookmark - 'before', 'after'
            let parentId = node.parentId;
            if (where === 'top' || where === 'bottom') {
                parentId = node.id;
            }

            let iIndex = 0;
            if (where === 'before') {
                iIndex = node.index;
            }
            if (where === 'after') {
                iIndex = node.index + 1;
            }
            if (where === 'bottom') {
                chrome.bookmarks.getChildren(node.id, nodeChildren => {
                    iIndex = nodeChildren.length;
                    if (isAddBookmark) { // add bookmark
                        addNodeTo(node.id, parentId, iIndex, newTitle, newUrl, where, isSeparator);
                    } else { // add folder
                        addFolderTo(node.id, parentId, iIndex, where);
                    }
                });
            }
            else {
                if (isAddBookmark) { // add bookmark
                    addNodeTo(node.id, parentId, iIndex, newTitle, newUrl, where, isSeparator);
                } else { // add folder
                    addFolderTo(node.id, parentId, iIndex, where);
                }
            }
        });
    }

    const filterURL = (url, target) => url.replace(/__VBM_CURRENT_TAB_URL__/, encodeURIComponent(target));

    // Bookmark handling
    const dontConfirmOpenFolder = !!localStorage.dontConfirmOpenFolder;
    const bookmarkClickStayOpen = !!localStorage.bookmarkClickStayOpen;
    const openBookmarksLimit = 10;
    const actions = {
        openBookmark: url => {
            chrome.tabs.query({
                    'active': true,
                    'windowId': chrome.windows.WINDOW_ID_CURRENT
                },
                tabs => {
                    const tab = tabs[0];
                    let filteredURL = url;
                    if (/^.*__VBM_CURRENT_TAB_URL__.*/i.test(url)) {
                        filteredURL = filterURL(url, tab.url);
                    }
                    let decodedUrl;
                    try {
                        decodedUrl = decodeURIComponent(filteredURL);
                    } catch (e) {
                        return;
                    }

                    if (/^javascript:.*/i.test(url)) {
                        //bookmarklet
                        // TODO
                        chrome.scripting.executeScript(tab.id, {
                            // code: decodedUrl,
                            target: {tabId: tab.id},
                            files: ['content-script.js']
                        });
                    } else {
                        //url
                        chrome.tabs.update(tab.id, {
                            url: decodedUrl
                        });
                    }

                    if (!bookmarkClickStayOpen)
                        setTimeout(window.close, 200);
                });
        },

        openBookmarkNewTab: (url, selected, blankTabCheck) => {
            const open = openURL => {
                chrome.tabs.create({
                    url: openURL,
                    active: selected
                });
            };
            chrome.tabs.query({
                    'active': true,
                    'windowId': chrome.windows.WINDOW_ID_CURRENT
                },
                tabs => {
                    const tab = tabs[0];
                    let filteredURL = url;
                    if (/^.*__VBM_CURRENT_TAB_URL__.*/i.test(url)) {
                        filteredURL = filterURL(url, tab.url);
                    }
                    if (blankTabCheck) {
                        if (/^chrome:\/\/newtab/i.test(tab.url)) {
                            chrome.tabs.update(tab.id, {
                                url: filteredURL
                            });
                            if (!bookmarkClickStayOpen) {
                                setTimeout(window.close, 200);
                            }
                        } else {
                            open(filteredURL);
                        }
                    } else {
                        open(filteredURL);
                    }
                });
        },

        openBookmarkNewWindow: (url, incognito) => {
            chrome.tabs.query({
                    'active': true,
                    'windowId': chrome.windows.WINDOW_ID_CURRENT
                },
                tabs => {
                    const tab = tabs[0];
                    let filteredURL = url;
                    if (/^.*__VBM_CURRENT_TAB_URL__.*/i.test(url)) {
                        filteredURL = filterURL(url, tab.url);
                    }
                    chrome.windows.create({
                        url: filteredURL,
                        incognito: incognito
                    });
                });
        },

        // ++++++++ added by windviki@gmail.com ++++++++
        addNewBookmarkNode: (nodeId, where, newUrl, newTitle) => {
            addNewNode(nodeId, where, newUrl, newTitle, false);
        },

        copyAllTitlesAndUrls: nodeId => {
            const tt = new TreeText(nodeId);
            tt.get(textResult => {
                copyToClipboard(textResult);
            });
        },

        replaceUrl: (nodeId, newUrl) => {
            chrome.bookmarks.get(nodeId, nodeList => {
                if (!nodeList.length)
                    return;
                const node = nodeList[0];
                // ensure it is a bookmark
                if (!!node.url && !!newUrl) {
                    chrome.bookmarks.update(node.id, {
                        url: newUrl
                    });
                }
            });
        },
        // ++++++++ end ++++++++

        openBookmarks: (urls, selected) => {
            const urlsLen = urls.length;
            const open = () => {
                chrome.tabs.create({
                    url: urls.shift(),
                    active: selected
                    // first tab will be selected
                });
                for (let i = 0, l = urls.length; i < l; i++) {
                    chrome.tabs.create({
                        url: urls[i],
                        active: false
                    });
                }
            };
            if (!dontConfirmOpenFolder && urlsLen > openBookmarksLimit) {
                ConfirmDialog.open({
                    dialog: _m('confirmOpenBookmarks', `${urlsLen}`),
                    button1: `<strong>${_m('open')}</strong>`,
                    button2: _m('nope'),
                    fn1: open
                });
            } else {
                open();
            }
        },

        openBookmarksNewWindow: (urls, incognito) => {
            const urlsLen = urls.length;
            const open = () => {
                chrome.windows.create({
                    url: urls,
                    incognito: incognito
                });
            };
            if (!dontConfirmOpenFolder && urlsLen > openBookmarksLimit) {
                const dialog = incognito ? _m('confirmOpenBookmarksNewIncognitoWindow', `${urlsLen}`) : _m(
                    'confirmOpenBookmarksNewWindow', `${urlsLen}`);
                ConfirmDialog.open({
                    dialog: dialog,
                    button1: `<strong>${_m('open')}</strong>`,
                    button2: _m('nope'),
                    fn1: open
                });
            } else {
                open();
            }
        },

        editBookmarkFolder: id => {
            chrome.bookmarks.get(id, nodeList => {
                if (!nodeList.length)
                    return;
                const node = nodeList[0];
                const url = node.url;
                const isBookmark = !!url;
                const type = isBookmark ? 'bookmark' : 'folder';
                const dialog = isBookmark ? _m('editBookmark') : _m('editFolder');
                let decodedUrl;
                try {
                    decodedUrl = decodeURIComponent(url);
                } catch (e) {
                    decodedUrl = url;
                }
                EditDialog.open({
                    dialog: dialog,
                    type: type,
                    name: node.title,
                    url: decodedUrl,
                    fn: (name, url) => {
                        chrome.bookmarks.update(id, {
                                title: name,
                                url: isBookmark ? url : ''
                            },
                            n => {
                                const title = n.title;
                                const url = n.url;
                                let li = $(`neat-tree-item-${id}`);
                                if (li) {
                                    if (isBookmark) {
                                        const css = li.querySelector('a').style.cssText;
                                        li.innerHTML = generateBookmarkHTML(title, url, `style="${css}"`, id);
                                    } else {
                                        const i = li.querySelector('i');
                                        i.textContent = title ||
                                            (httpsPattern.test(url) ?
                                                url.replace(httpsPattern, '') :
                                                _m('noTitle'));
                                        // Update sync status for folders
                                        if (window.syncManager && localStorage.showSyncStatus === 'true') {
                                            const syncIndicator = li.querySelector('.sync-indicator');
                                            if (syncIndicator) {
                                                syncIndicator.remove();
                                            }
                                            const syncStatus = window.syncManager.getSyncStatusIndicator(id);
                                            const syncTooltip = window.syncManager.getSyncTooltip(id);
                                            if (syncStatus) {
                                                const newSyncIndicator = document.createElement('span');
                                                newSyncIndicator.className = `sync-indicator ${syncStatus}`;
                                                newSyncIndicator.title = syncTooltip;
                                                newSyncIndicator.innerHTML = `<span class="sync-tooltip">${syncTooltip}</span>`;
                                                // Insert after the img element, not at the end of span
                                                const imgElement = li.querySelector('span img');
                                                if (imgElement && imgElement.nextSibling) {
                                                    li.querySelector('span').insertBefore(newSyncIndicator, imgElement.nextSibling);
                                                } else {
                                                    li.querySelector('span').appendChild(newSyncIndicator);
                                                }
                                            }
                                        }
                                    }
                                }
                                if (searchMode) {
                                    li = $(`results-item-${id}`);
                                    li.innerHTML = generateBookmarkHTML(title, url, '', id);
                                }
                                li.firstElementChild.focus();
                            });
                    }
                });
            });
        },

        deleteBookmark: id => {
            const li1 = $(`neat-tree-item-${id}`);
            const li2 = $(`results-item-${id}`);
            chrome.bookmarks.remove(id, () => {
                if (li1) {
                    const nearLi1 = li1.nextElementSibling || li1.previousElementSibling;
                    li1.destroy();
                    if (!searchMode && nearLi1)
                        nearLi1.querySelector('a, span').focus();
                }
                if (li2) {
                    const nearLi2 = li2.nextElementSibling || li2.previousElementSibling;
                    li2.destroy();
                    if (searchMode && nearLi2)
                        nearLi2.querySelector('a, span').focus();
                }
            });
        },

        deleteBookmarks: (id, bookmarkCount, folderCount) => {
            const li = $(`neat-tree-item-${id}`);
            const item = li.querySelector('span');
            if (bookmarkCount || folderCount) {
                let dialog;
                const folderName = `<cite>${item.textContent.trim()}</cite>`;
                if (bookmarkCount && folderCount) {
                    dialog = _m('confirmDeleteFolderSubfoldersBookmarks', [folderName, folderCount, bookmarkCount]);
                } else if (bookmarkCount) {
                    dialog = _m('confirmDeleteFolderBookmarks', [folderName, bookmarkCount]);
                } else {
                    dialog = _m('confirmDeleteFolderSubfolders', [folderName, folderCount]);
                }
                ConfirmDialog.open({
                    dialog: dialog,
                    button1: `<strong>${_m('delete')}</strong>`,
                    button2: _m('nope'),
                    fn1: () => {
                        chrome.bookmarks.removeTree(id, () => {
                            li.destroy();
                        });
                        const nearLi = li.nextElementSibling || li.previousElementSibling;
                        if (nearLi)
                            nearLi.querySelector('a, span').focus();
                    },
                    fn2: () => {
                        li.querySelector('a, span').focus();
                    }
                });
            } else {
                chrome.bookmarks.removeTree(id, () => {
                    li.destroy();
                });
                const nearLi = li.nextElementSibling || li.previousElementSibling;
                if (nearLi)
                    nearLi.querySelector('a, span').focus();
            }
        }

    };

    const middleClickBgTab = !!localStorage.middleClickBgTab;
    const leftClickNewTab = !!localStorage.leftClickNewTab;
    let noOpenBookmark = false;

    function generateTreeForTarget(trees) {
        generateTree(trees);
        // This must be put int chrome API handler function. 
        // Otherwise it may be called before generation completed.
        if (localStorage.focusID) {
            const item = $tree.querySelector(`#neat-tree-item-${localStorage.focusID}`);
            if (item) {
                item.scrollIntoView();
            }
        }
        localStorage.scrollTop = $tree.scrollTop;
    }

    const bookmarkHandler = e => {
        e.preventDefault();
        if (e.button !== 0 && e.button !== 1)
            return;
        // only take left-click
        if (noOpenBookmark) { // flag that disables opening bookmark
            noOpenBookmark = false;
            return;
        }
        const el = e.target;
        const ctrlMeta = (e.ctrlKey || e.metaKey || (e.button === 1));
        const shift = e.shiftKey;
        if (el.tagName === 'A' && !el.querySelector('hr')) { // bookmark
            // Track bookmark click if we have metadata manager
            if (window.BookmarkMetadataManager) {
                const bookmarkId = el.parentNode.id.replace(/(neat-tree|results)-item-/, '');
                if (bookmarkId && bookmarkId !== '0' && /^\d+$/.test(bookmarkId)) {
                    try {
                        const metadataManager = new BookmarkMetadataManager();
                        metadataManager.incrementClickCount(bookmarkId);
                    } catch (error) {
                        console.warn('Failed to track bookmark click:', error);
                    }
                }
            }

            if (el.className === "link-folder") { // search result folder
                // switch to tree
                quitSearchMode();
                // get folder id (el parent is li)
                const id = el.parentNode.id.replace(/(neat-tree|results)-item-/, '');
                // all parent folder ids
                // set them as opened folders
                opens = getParentPath(id, nodeTrees);
                localStorage.opens = JSON.stringify(opens);
                // force to recover from remember state (opened folders)
                rememberState = true;
                // focus on the target folder
                localStorage.focusID = id;
                // new handler to handle the scrolling
                chrome.bookmarks.getTree(generateTreeForTarget);
            } else {
                const url = el.href;
                if (ctrlMeta) { // ctrl/meta click
                    actions.openBookmarkNewTab(url, middleClickBgTab ? shift : !shift);
                } else { // click
                    if (shift) {
                        actions.openBookmarkNewWindow(url);
                    } else {
                        leftClickNewTab ? actions.openBookmarkNewTab(url, true, true) : actions.openBookmark(url);
                    }
                }
                if (searchMode) {
                    prevValue = '';
                    searchInput.value = '';
                    localStorage.searchQuery = '';
                    searchMode = false;
                    switchBookmarkMenu(false);
                }
            }
        } else if (el.tagName === 'SPAN') { // folder
            const li = el.parentNode;
            const id = li.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id, children => {
                const urls = Array.map(c => c.url, children).clean();
                const urlsLen = urls.length;
                if (!urlsLen)
                    return;
                if (ctrlMeta) { // ctrl/meta click
                    actions.openBookmarks(urls, middleClickBgTab ? shift : !shift);
                } else if (shift) { // shift click
                    actions.openBookmarksNewWindow(urls);
                }
            });
        }
    };
    $tree.addEventListener('click', bookmarkHandler);
    $results.addEventListener('click', bookmarkHandler);
    $tree.addEventListener('auxclick', bookmarkHandler);

    // donation
    $('donation-go').addEventListener('click', () => {  
        showDonation(false);
        localStorage.donationCountDown = 0;
        localStorage.donationFactor = 1;
        if (localStorage.donationKey.toInt() > 3200) {
            localStorage.donationKey = 3200;
        } else {
            localStorage.donationKey = localStorage.donationKey.toInt() + 800;
        }
        actions.openBookmarkNewTab("https://github.com/windviki/vBookmarks/blob/master/donation/donation.md", true, true);
    });

    $('new-version-text').addEventListener('click', () => {
        actions.openBookmarkNewTab("https://github.com/windviki/vBookmarks#changelogs", true, true);
    });

    // Disable Chrome auto-scroll feature
    window.addEventListener('mousedown', e => {
        if (e.button === 1) // middle-click
            e.preventDefault();
    });

    // Context menu
    const $bookmarkContextMenu = $('bookmark-context-menu');
    const $folderContextMenu = $('folder-context-menu');
    const $separatorContextMenu = $('separator-context-menu');

    const clearMenu = e => {
        currentContext = null;
        const active = body.querySelector('.active');
        if (active) {
            if (e) {
                active.removeClass('active');
                const el = e.target;
                if (el === $tree || el === $results) {
                    active.focus();
                }
            } else {
                // When menu is closed, do not lost focus
                active.focus();
            }
        }
        $bookmarkContextMenu.style.left = '-999px';
        $bookmarkContextMenu.style.opacity = '0';
        $folderContextMenu.style.left = '-999px';
        $folderContextMenu.style.opacity = '0';
        $separatorContextMenu.style.left = '-999px';
        $separatorContextMenu.style.opacity = '0';
    };

    body.addEventListener('click', clearMenu);
    //body.addEventListener('scroll', clearMenu);
    $tree.addEventListener('scroll', clearMenu);
    //invalid event handler?
    window.addEventListener('scroll', clearMenu);
    $results.addEventListener('scroll', clearMenu);
    $tree.addEventListener('focus', clearMenu, true);
    $results.addEventListener('focus', clearMenu, true);

    currentContext = null;
    let macCloseContextMenu = false;
    body.addEventListener('contextmenu', e => {
        e.preventDefault();
        clearMenu();
        if (os === 'mac') {
            macCloseContextMenu = false;
            setTimeout(() => {
                macCloseContextMenu = true;
            }, 500);
        }
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        let menu;
        if (el.tagName === 'A') {
            if (el.querySelector('hr')) {
                menu = $separatorContextMenu;
                if (el.parentNode.dataset.parentid === '0') {
                    menu.addClass('hide-editables');
                } else {
                    menu.removeClass('hide-editables');
                }
            } else {
                menu = $bookmarkContextMenu;
            }
        } else if (el.tagName === 'SPAN') {
            menu = $folderContextMenu;
        } else {
        }
        if (menu) {
            currentContext = el;
            const active = body.querySelector('.active');
            if (active)
                active.removeClass('active');
            el.addClass('active');
            const menuWidth = menu.offsetWidth;
            const menuHeight = menu.offsetHeight;
            const pageX = rtl ? Math.max(0, e.pageX - menuWidth) :
                Math.min(e.pageX, body.offsetWidth - menuWidth);
            let pageY;
            const boundY = window.innerHeight - e.clientY;
            if (boundY > menuHeight) {
                pageY = e.pageY;
            } else {
                pageY = Math.max(e.pageY - menuHeight, 0);
            }
            menu.style.left = `${pageX}px`;
            menu.style.top = `${pageY}px`;
            menu.style.opacity = '1';
            menu.focus();
        }
    });
    // on Mac, holding down right-click for a period of time closes the context menu
    // Not a complete implementation, but it works :)
    if (os === 'mac')
        body.addEventListener('mouseup', e => {
            if (e.button === 2 && macCloseContextMenu) {
                macCloseContextMenu = false;
                clearMenu();
            }
        });

    const bookmarkContextHandler = e => {
        e.stopPropagation();
        if (!currentContext)
            return;
        const el = e.target;
        if (el.tagName !== 'COMMAND')
            return;
        const url = currentContext.href;
        const li = currentContext.parentNode;
        const id = li.id.replace(/(neat-tree|results)-item-/, '');
        switch (el.id) {
            // ++++++++ modified by windviki@gmail.com ++++++++
            case 'add-bookmark-before-bookmark':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        const curTab = tabs[0];
                        actions.addNewBookmarkNode(id, 'before', curTab.url, curTab.title);
                    });
                break;
            case 'add-bookmark-after-bookmark':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        const curTab = tabs[0];
                        actions.addNewBookmarkNode(id, 'after', curTab.url, curTab.title);
                    });
                break;
            case 'add-folder-before-bookmark':
                actions.addNewBookmarkNode(id, 'before', '', '');
                break;
            case 'add-folder-after-bookmark':
                actions.addNewBookmarkNode(id, 'after', '', '');
                break;
            case 'add-separator':
                addSeparator(id, 'after');
                break;
            case 'copy-title-and-url':
                actions.copyAllTitlesAndUrls(id);
                break;
            case 'replace-url':
                chrome.tabs.query({
                        'active': true,
                        'windowId': chrome.windows.WINDOW_ID_CURRENT
                    },
                    tabs => {
                        actions.replaceUrl(id, tabs[0].url);
                    });
                break;
            // ++++++++ end ++++++++
            case 'bookmark-new-tab':
                actions.openBookmarkNewTab(url);
                break;
            case 'bookmark-new-window':
                actions.openBookmarkNewWindow(url);
                break;
            case 'bookmark-new-incognito-window':
                actions.openBookmarkNewWindow(url, true);
                break;
            case 'bookmark-edit': {
                const li = currentContext.parentNode;
                const id = li.id.replace(/(neat-tree|results)-item-/, '');
                actions.editBookmarkFolder(id);
            }
                break;
            case 'bookmark-delete': {
                const li = currentContext.parentNode;
                const id = li.id.replace(/(neat-tree|results)-item-/, '');
                actions.deleteBookmark(id);
            }
                break;
        }
        clearMenu();
    };
    // On Mac, all three mouse clicks work; on Windows, middle-click doesn't work
    $bookmarkContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            bookmarkContextHandler(e);
    });
    $bookmarkContextMenu.addEventListener('contextmenu', bookmarkContextHandler);
    $bookmarkContextMenu.addEventListener('click', e => {
        e.stopPropagation();
    });

    const folderContextHandler = e => {
        if (!currentContext)
            return;
        const el = e.target;
        if (el.tagName !== 'COMMAND')
            return;
        const li = currentContext.parentNode;
        const id = li.id.replace('neat-tree-item-', '');
        chrome.bookmarks.getChildren(id, children => {
            const urls = Array.map(c => c.url, children).clean();
            const urlsLen = urls.length;
            const noURLS = !urlsLen;
            switch (el.id) {
                // ++++++++ modified by windviki@gmail.com ++++++++
                case 'add-bookmark-top':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'top', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-bottom':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'bottom', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-before-folder':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'before', curTab.url, curTab.title);
                        });
                    break;
                case 'add-bookmark-after-folder':
                    chrome.tabs.query({
                            'active': true,
                            'windowId': chrome.windows.WINDOW_ID_CURRENT
                        },
                        tabs => {
                            const curTab = tabs[0];
                            actions.addNewBookmarkNode(id, 'after', curTab.url, curTab.title);
                        });
                    break;
                case 'add-folder-before-folder':
                    actions.addNewBookmarkNode(id, 'before', '', '');
                    break;
                case 'add-folder-after-folder':
                    actions.addNewBookmarkNode(id, 'after', '', '');
                    break;
                case 'add-new-folder':
                    actions.addNewBookmarkNode(id, 'top', '', '');
                    break;
                case 'add-folder-separator':
                    addSeparator(id, 'after', true);
                    break;
                case 'copy-all-titles-and-urls':
                    actions.copyAllTitlesAndUrls(id);
                    break;
                // ++++++++ end ++++++++
                case 'folder-window':
                    if (noURLS)
                        return;
                    actions.openBookmarks(urls);
                    break;
                case 'folder-new-window':
                    if (noURLS)
                        return;
                    actions.openBookmarksNewWindow(urls);
                    break;
                case 'folder-new-incognito-window':
                    if (noURLS)
                        return;
                    actions.openBookmarksNewWindow(urls, true);
                    break;
                case 'folder-edit':
                    actions.editBookmarkFolder(id);
                    break;
                case 'folder-delete':
                    actions.deleteBookmarks(id, urlsLen, children.length - urlsLen);
                    break;
            }
        });
        clearMenu();
    };
    $folderContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            folderContextHandler(e);
    });
    $folderContextMenu.addEventListener('contextmenu', folderContextHandler);
    $folderContextMenu.addEventListener('click', e => {
        e.stopPropagation();
    });


    const separatorContextHandler = e => {
        if (!currentContext)
            return;
        const el = e.target;
        if (el.tagName !== 'COMMAND')
            return;
        const li = currentContext.parentNode;
        const id = li.id.replace('neat-tree-item-', '');
        switch (el.id) {
            case 'remove-separator':
                deleteSeparator(id);
                break;
        }
        clearMenu();
    };
    $separatorContextMenu.addEventListener('mouseup', e => {
        e.stopPropagation();
        if (e.button === 0 || (os === 'mac' && e.button === 1))
            separatorContextHandler(e);
    });
    $separatorContextMenu.addEventListener('contextmenu', separatorContextHandler);

    // Keyboard navigation
    let keyBuffer = '';
    let keyBufferTimer = null;
    const treeKeyDown = function (e) {
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName)) {
            item = $tree.querySelector('.focus') || $tree.querySelector('li:first-child>span');
        }
        let li = item.parentNode;
        let keyValue = e.key;
        const metaKey = e.metaKey;
        if (keyValue === 'ArrowDown' && metaKey)
            keyValue = 'End'; // cmd + down (Mac)
        if (keyValue === 'ArrowUp' && metaKey)
            keyValue = 'Home'; // cmd + up (Mac)
        switch (keyValue) {
            case 'ArrowDown': // down
                e.preventDefault();
                const liChild = li.querySelector('ul>li:first-child');
                let nextLiSpan;
                if (li.hasClass('open') && liChild) {
                    liChild.querySelector('a, span').focus();
                } else {
                    let nextLi = li.nextElementSibling;
                    if (nextLi) {
                        nextLiSpan = nextLi.querySelector('a, span');
                        if (nextLiSpan) {
                            nextLiSpan.focus();
                        }
                    } else if (!searchMode) {
                        nextLi = null;
                        do {
                            if (li)
                                li = li.parentNode.parentNode;
                            if (li)
                                nextLi = li.nextElementSibling;
                            if (nextLi)
                                nextLiSpan = nextLi.querySelector('a, span');
                            if (nextLiSpan) //fixed: pushed down "DOWN" when the focus was at the last node
                                nextLiSpan.focus();
                        } while (li && !nextLi);
                    }
                }
                break;
            case 'ArrowUp': // up
            {
                e.preventDefault();
                let prevLi = li.previousElementSibling;
                if (prevLi) {
                    while (prevLi.hasClass('open') && prevLi.querySelector('ul>li:last-child')) {
                        const lis = prevLi.querySelectorAll('ul>li:last-child');
                        prevLi = Array.filter(li => !!li.parentNode.offsetHeight, lis).getLast();
                    }
                    prevLi.querySelector('a, span').focus();
                } else {
                    const parentPrevLi = li.parentNode.parentNode;
                    if (parentPrevLi && parentPrevLi.tagName === 'LI') {
                        parentPrevLi.querySelector('a, span').focus();
                    } else {
                        searchInput.focus();
                    }
                }
            }
                break;
            case 'ArrowRight': // right (left for RTL)
            {
                e.preventDefault();
                // open/close dir node
                if (li.hasClass('parent') && ((!rtl && !li.hasClass('open')) || (rtl && li.hasClass('open')))) {
                    let event = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    });
                    li.firstElementChild.dispatchEvent(event);
                } else {
                    if (rtl) {
                        // move back to parent node
                        const parentID = li.dataset.parentid;
                        if (parentID === '0')
                            return;
                        // fixed: check whether the parent item exists
                        const item = $(`neat-tree-item-${parentID}`);
                        if (item) {
                            item.querySelector('span').focus();
                        }
                    } else {
                        let elRect = e.target.getBoundingClientRect();
                        let event = new MouseEvent("contextmenu", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: elRect.right,
                            clientY: elRect.bottom,
                        });
                        e.target.dispatchEvent(event);
                    }
                }
            }
                break;
            case 'ArrowLeft': // left (right for RTL)
            {
                e.preventDefault();
                // open/close dir node
                if (li.hasClass('parent') && ((!rtl && li.hasClass('open')) || (rtl && !li.hasClass('open')))) {
                    let event = new MouseEvent("click", {
                        bubbles: true,
                        cancelable: true,
                        view: window,
                    });
                    li.firstElementChild.dispatchEvent(event);
                } else {
                    if (!rtl) {
                        // move back to parent node
                        const parentID = li.dataset.parentid;
                        if (parentID === '0')
                            return;
                        // fixed: check whether the parent item exists
                        const item = $(`neat-tree-item-${parentID}`);
                        if (item) {
                            item.querySelector('span').focus();
                        }
                    } else {
                        let elRect = e.target.getBoundingClientRect();
                        let event = new MouseEvent("contextmenu", {
                            bubbles: true,
                            cancelable: true,
                            view: window,
                            clientX: elRect.left,
                            clientY: elRect.bottom,
                        });
                        e.target.dispatchEvent(event);
                    }
                }
            }
                break;
            case ' ': // space
            case 'Enter': // enter
            {
                e.preventDefault();
                let event = new MouseEvent("click", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    ctrlKey: e.ctrlKey,
                    shiftKey: e.shiftKey,
                    metaKey: e.metaKey
                });
                li.firstElementChild.dispatchEvent(event);
            }
                break;
            case 'End': // end
                if (searchMode) {
                    this.querySelector('li:last-child a').focus();
                } else {
                    const lis = this.querySelectorAll('ul>li:last-child');
                    const li = Array.filter(li => !!li.parentNode.offsetHeight, lis).getLast();
                    li.querySelector('span, a').focus();
                }
                break;
            case 'Home': // home
                if (searchMode) {
                    this.querySelector('ul>li:first-child a').focus();
                } else {
                    this.querySelector('ul>li:first-child').querySelector('span, a').focus();
                }
                break;
            case 'PageDown': // page down
            {
                const self = this;
                const getLastItem = () => {
                    const bound = self.offsetHeight + self.scrollTop;
                    const items = self.querySelectorAll('a, span');
                    return Array.filter(item => !!item.parentElement.offsetHeight && item.offsetTop < bound, items).getLast();
                };
                const item = getLastItem();
                if (item !== document.activeElement) {
                    e.preventDefault();
                    item.focus();
                } else {
                    setTimeout(() => {
                        getLastItem().focus();
                    }, 0);
                }
            }
                break;
            case 'PageUp': // page up
            {
                const self = this;
                const getFirstItem = () => {
                    const bound = self.scrollTop;
                    const items = self.querySelectorAll('a, span');
                    return Array.filter(item => !!item.parentElement.offsetHeight && ((item.offsetTop + item.offsetHeight) > bound), items)[0];
                };
                const item = getFirstItem();
                if (item !== document.activeElement) {
                    e.preventDefault();
                    item.focus();
                } else {
                    setTimeout(() => {
                        getFirstItem().focus();
                    }, 0);
                }
            }
                break;
            case 'F2': // F2, not for Mac
            {
                if (os === 'mac')
                    break;
                const id = li.id.replace(/(neat-tree|results)-item-/, '');
                actions.editBookmarkFolder(id);
            }
                break;
            case 'Delete': // delete
                break; // don't run 'default'
            default: {
                if (keyValue.length > 1)
                    return;
                const key = keyValue;
                if (key !== keyBuffer)
                    keyBuffer += key;
                clearTimeout(keyBufferTimer);
                keyBufferTimer = setTimeout(() => {
                    keyBuffer = '';
                }, 500);
                const lis = this.querySelectorAll('ul>li');
                const items = [];
                for (let i = 0, l = lis.length; i < l; i++) {
                    const li = lis[i];
                    if (li.parentNode.offsetHeight)
                        items.push(li.firstElementChild);
                }
                const pattern = new RegExp(`^${keyBuffer.escapeRegExp()}`, 'i');
                const batch = [];
                let startFind = false;
                let found = false;
                const activeElement = document.activeElement;
                for (let i = 0, l = items.length; i < l; i++) {
                    const item = items[i];
                    if (item === activeElement) {
                        startFind = true;
                    } else if (startFind) {
                        if (pattern.test(item.textContent.trim())) {
                            found = true;
                            item.focus();
                            break;
                        }
                    } else {
                        batch.push(item);
                    }
                }
                if (!found) {
                    for (let i = 0, l = batch.length; i < l; i++) {
                        const item = batch[i];
                        if (pattern.test(item.textContent.trim())) {
                            item.focus();
                            break;
                        }
                    }
                }
            }
        }
    };
    $tree.addEventListener('keydown', treeKeyDown);
    $results.addEventListener('keydown', treeKeyDown);

    const treeKeyUp = e => {
        let item = document.activeElement;
        if (!/^(a|span)$/i.test(item.tagName))
            item = $tree.querySelector('.focus') || $tree.querySelector('li:first-child>span');
        const li = item.parentNode;
        switch (e.key) {
            case "Delete": // delete
                e.preventDefault();
                const id = li.id.replace(/(neat-tree|results)-item-/, '');
                if (li.hasClass('parent')) {
                    chrome.bookmarks.getChildren(id, children => {
                        const urlsLen = Array.map(c => c.url, children).clean().length;
                        actions.deleteBookmarks(id, urlsLen, children.length - urlsLen);
                    });
                } else {
                    actions.deleteBookmark(id);
                }
                break;
        }
    };
    $tree.addEventListener('keyup', treeKeyUp);
    $results.addEventListener('keyup', treeKeyUp);

    //use keyboardEvent.key (>= Chrome 51)
    const contextKeyDown = function (e) {
        const menu = this;
        const item = document.activeElement;
        const metaKey = e.metaKey;
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (metaKey) { // cmd + down (Mac)
                    menu.lastElementChild.focus();
                } else {
                    if (item.tagName === 'COMMAND') {
                        let nextItem = item.nextElementSibling;
                        if (nextItem && nextItem.tagName === 'HR')
                            nextItem = nextItem.nextElementSibling;
                        if (nextItem) {
                            nextItem.focus();
                        } else if (os !== 'mac') {
                            menu.firstElementChild.focus();
                        }
                    } else {
                        item.firstElementChild.focus();
                    }
                }
                break;
            case 'ArrowUp':
                e.preventDefault();
                if (metaKey) { // cmd + up (Mac)
                    menu.firstElementChild.focus();
                } else {
                    if (item.tagName === 'COMMAND') {
                        let prevItem = item.previousElementSibling;
                        if (prevItem && prevItem.tagName === 'HR')
                            prevItem = prevItem.previousElementSibling;
                        if (prevItem) {
                            prevItem.focus();
                        } else if (os !== 'mac') {
                            menu.lastElementChild.focus();
                        }
                    } else {
                        item.lastElementChild.focus();
                    }
                }
                break;
            case 'ArrowLeft':
                e.preventDefault();
                if (!rtl) {
                    const active = body.querySelector('.active');
                    if (active)
                        active.removeClass('active').focus();
                    clearMenu();
                }
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (rtl) {
                    const active = body.querySelector('.active');
                    if (active)
                        active.removeClass('active').focus();
                    clearMenu();
                }
                break;
            case " ": // space
            case 'Enter': // enter
                e.preventDefault();
                let event = new MouseEvent("mouseup", {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                });
                item.dispatchEvent(event);
                break;
            case 'Escape': // esc
                e.preventDefault();
                const active = body.querySelector('.active');
                if (active)
                    active.removeClass('active').focus();
                clearMenu();
                break;
        }
    };
    $bookmarkContextMenu.addEventListener('keydown', contextKeyDown);
    $folderContextMenu.addEventListener('keydown', contextKeyDown);
    //$separatorContextMenu.addEventListener('keydown', contextKeyDown);

    const contextMouseMove = e => {
        e.target.focus();
    };
    $bookmarkContextMenu.addEventListener('mousemove', contextMouseMove);
    $folderContextMenu.addEventListener('mousemove', contextMouseMove);
    $separatorContextMenu.addEventListener('mousemove', contextMouseMove);

    const contextMouseOut = function () {
        if (this.style.opacity.toInt())
            this.focus();
    };
    $bookmarkContextMenu.addEventListener('mouseout', contextMouseOut);
    $folderContextMenu.addEventListener('mouseout', contextMouseOut);
    $separatorContextMenu.addEventListener('mouseout', contextMouseOut);

    // Drag and drop, baby
    let draggedBookmark = null;
    let draggedOut = false;
    let canDrop = false;
    let zoomLevel = 1;
    const bookmarkClone = $('bookmark-clone');
    const dropOverlay = $('drop-overlay');
    $tree.addEventListener('mousedown', e => {
        if (e.button !== 0) //left-click
            return;
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        const elParent = el.parentNode; //li
        // can move any bookmarks/folders except the default root folders
        if ((el.tagName === 'A' && elParent.hasClass('child')) ||
            (el.tagName === 'SPAN' && elParent.hasClass('parent') && elParent.dataset.parentid !== '0')) {
            e.preventDefault();
            draggedOut = false;
            draggedBookmark = el; //a
            if (localStorage.zoom)
                zoomLevel = localStorage.zoom.toInt() / 100;
            bookmarkClone.innerHTML = el.innerHTML; //<a>..</a>
            el.focus();
        }
    });
    let scrollTree = null,
        scrollTreeInterval = 100,
        scrollTreeSpot = 10;
    const stopScrollTree = () => {
        clearInterval(scrollTree);
        scrollTree = null;
    };
    document.addEventListener('mousemove', e => {
        let top;
        let elRectBottom;
        let elRectTop;
        let elRect;
        if (e.button !== 0)
            return;
        if (!draggedBookmark)
            return;
        e.preventDefault();
        let el = e.target;
        let clientX = e.clientX;
        let clientY = e.clientY;
        //fixed clientY
        clientY += document.body.scrollTop;
        //hovering over the dragged element itself
        if (el === draggedBookmark) {
            bookmarkClone.style.left = '-999px';
            dropOverlay.style.left = '-999px';
            canDrop = false;
            return;
        }
        draggedOut = true;
        //cursor moves outside the tree
        const treeTop = $tree.offsetTop,
            treeBottom = window.innerHeight;
        if (clientX < 0 || clientY < treeTop || clientX > $tree.offsetWidth || clientY > treeBottom) {
            bookmarkClone.style.left = '-999px';
            dropOverlay.style.left = '-999px';
            canDrop = false;
        }
        // if hovering over the top or bottom edges of the tree,
        // scroll the tree
        const treeScrollHeight = $tree.scrollHeight,
            treeOffsetHeight = $tree.offsetHeight;
        if (treeScrollHeight > treeOffsetHeight) { // only scroll when it's scrollable
            const treeScrollTop = $tree.scrollTop;
            if (clientY <= treeTop + scrollTreeSpot) {
                if (treeScrollTop === 0) {
                    stopScrollTree();
                } else if (!scrollTree)
                    scrollTree = setInterval(() => {
                        $tree.scrollBy(0, -scrollTreeSpot);
                        dropOverlay.style.left = '-999px';
                    }, scrollTreeInterval);
            } else if (clientY >= treeBottom - scrollTreeSpot) {
                if (treeScrollTop === (treeScrollHeight - treeOffsetHeight)) {
                    stopScrollTree();
                } else if (!scrollTree)
                    scrollTree = setInterval(() => {
                        $tree.scrollBy(0, scrollTreeSpot);
                        dropOverlay.style.left = '-999px';
                    }, scrollTreeInterval);
            } else {
                stopScrollTree();
            }
        }
        // collapse the folder before moving it
        const draggedBookmarkParent = draggedBookmark.parentNode;
        if (draggedBookmark.tagName === 'SPAN' && draggedBookmarkParent.hasClass('open')) {
            draggedBookmarkParent.removeClass('open').setAttribute('aria-expanded', false);
        }
        clientX /= zoomLevel;
        clientY /= zoomLevel;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        if (el.tagName === 'A' /* || el.tagName === 'HR'*/) {
            canDrop = true;
            bookmarkClone.style.top = `${clientY}px`;
            bookmarkClone.style.left = `${rtl ? (clientX - bookmarkClone.offsetWidth) : clientX}px`;
            elRect = el.getBoundingClientRect();
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            //fixed elRectBottom
            elRectBottom = elRect.bottom + document.body.scrollTop;
            top = (clientY >= elRectTop + elRect.height / 2) ? elRectBottom : elRectTop;
            dropOverlay.className = 'bookmark';
            dropOverlay.style.top = `${top}px`;
            dropOverlay.style.left = rtl ? '0px' : `${el.style.webkitPaddingStart.toInt() + 16}px`;
            dropOverlay.style.width = `${el.getComputedStyle('width').toInt() - 12}px`;
            dropOverlay.style.height = null;
        } else if (el.tagName === 'SPAN') {
            canDrop = true;
            bookmarkClone.style.top = `${clientY}px`;
            bookmarkClone.style.left = `${clientX}px`;
            elRect = el.getBoundingClientRect();
            top = null;
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            //fixed elRectBottom
            elRectBottom = elRect.bottom + document.body.scrollTop;
            const elRectHeight = elRect.height;
            const elParent = el.parentNode;
            if (elParent.dataset.parentid !== '0') {
                if (clientY < elRectTop + elRectHeight * .3) {
                    top = elRectTop;
                } else if (clientY > elRectTop + elRectHeight * .7 && !elParent.hasClass('open')) {
                    top = elRectBottom;
                }
            }
            if (top === null) {
                dropOverlay.className = 'folder';
                dropOverlay.style.top = `${elRectTop}px`;
                dropOverlay.style.left = '0px';
                dropOverlay.style.width = `${elRect.width}px`;
                dropOverlay.style.height = `${elRect.height}px`;
            } else {
                dropOverlay.className = 'bookmark';
                dropOverlay.style.top = `${top}px`;
                dropOverlay.style.left = `${el.style.webkitPaddingStart.toInt() + 16}px`;
                dropOverlay.style.width = `${el.getComputedStyle('width').toInt() - 12}px`;
                dropOverlay.style.height = null;
            }
        }
    });
    const onDrop = () => {
        draggedBookmark = null;
        bookmarkClone.style.left = '-999px';
        dropOverlay.style.left = '-999px';
        canDrop = false;
        resetSeparator();
    };
    document.addEventListener('mouseup', e => {
        let moveBottom;
        let elRectTop;
        let elRect;
        if (e.button !== 0) //left-click
            return;
        if (!draggedBookmark)
            return;
        stopScrollTree();
        if (!canDrop) {
            if (draggedOut)
                noOpenBookmark = true;
            draggedOut = false;
            onDrop();
            return;
        }
        //el is the target element "A" "SPAN"
        let el = e.target;
        if ((el.tagName) === 'HR') {
            el = el.parentNode; //a
        }
        let elParent = el.parentNode; //li
        const id = elParent.id.replace('neat-tree-item-', '');
        if (!id) {
            onDrop();
            return;
        }
        const draggedBookmarkParent = draggedBookmark.parentNode; //li
        const draggedID = draggedBookmarkParent.id.replace('neat-tree-item-', '');

        const dragDisplay = () => {
            //display
            draggedBookmarkParent.inject(elParent, moveBottom ? 'after' : 'before');
            draggedBookmark.style.webkitPaddingStart = el.style.webkitPaddingStart;
            draggedBookmark.focus();
            draggedBookmarkParent.setAttribute("level", elParent.getAttribute("level"));
            draggedBookmarkParent.setAttribute("data-parentid", elParent.getAttribute("data-parentid"));
            onDrop();
        }
        //fixed clientY
        const clientY = (e.clientY + document.body.scrollTop) / zoomLevel;
        if (el.tagName === 'A') { //dropped target is bookmark
            elRect = el.getBoundingClientRect();
            //fixed elRectTop
            elRectTop = elRect.top + document.body.scrollTop;
            moveBottom = (clientY >= elRectTop + elRect.height / 2);
            chrome.bookmarks.get(id, node => {
                if (!node || !node.length)
                    return;
                node = node[0];
                let index = node.index;
                const parentId = node.parentId;
                chrome.bookmarks.move(draggedID, {
                    parentId: parentId,
                    index: moveBottom ? ++index : index
                }, dragDisplay);
            });
        } else if (el.tagName === 'SPAN') { //dropped target is directory
            elRect = el.getBoundingClientRect();
            let move = 0; // 0 = middle, 1 = top, 2 = bottom
            elRectTop = elRect.top;
            const elRectHeight = elRect.height;
            elParent = el.parentNode; //li
            if (elParent.dataset.parentid !== '0') {
                if (clientY < elRectTop + elRectHeight * .3) {
                    move = 1;
                } else if (clientY > elRectTop + elRectHeight * .7 && !elParent.hasClass('open')) {
                    move = 2;
                }
            }
            if (move > 0) { //top or bottom
                moveBottom = (move === 2);
                chrome.bookmarks.get(id, node => {
                    if (!node || !node.length)
                        return;
                    node = node[0];
                    let index = node.index;
                    const parentId = node.parentId;
                    if (draggedID) {
                        chrome.bookmarks.move(draggedID, {
                            parentId: parentId,
                            index: moveBottom ? ++index : index
                        }, dragDisplay);
                    }
                });
            } else { //middle position
                chrome.bookmarks.move(draggedID, {
                    parentId: id
                }, () => {
                    const ul = elParent.querySelector('ul');
                    const level = parseInt(elParent.parentNode.dataset.level) + 1;
                    draggedBookmark.style.webkitPaddingStart = `${14 * level}px`;
                    if (ul) {
                        draggedBookmarkParent.inject(ul); //inject into bottom of ul
                        draggedBookmarkParent.setAttribute("level", parseInt(elParent.getAttribute("level")) + 1);
                        draggedBookmarkParent.setAttribute("data-parentid", id);
                    } else {
                        draggedBookmarkParent.destroy();
                    }
                    el.focus();
                    onDrop();
                });
            }
        } else {
            onDrop();
        }
    });

    // Resizer
    const $resizerx = $('resizer-x');
    const $resizery = $('resizer-y');
    let resizerXDown = false;
    let resizerYDown = false;
    let bodyWidth = 0,
        bodyHeight = 0, 
        screenX = 0, 
        screenY = 0;

    // Reset separators
    function resetSeparator() {
        const seps = separatorManager.getAll();
        for (let i = 0; i < seps.length; i++) {
            if (seps[i]) {
                const bmNode = $(`neat-tree-item-${seps[i]}`); //li
                if (!bmNode) {
                    return;
                }
                let lv = bmNode.getAttribute('level'); //getAttribute!
                if (!lv) {
                    lv = 1;
                }
                const paddingStart = lv * 14;
                const hrWidth = window.innerWidth - paddingStart - 40;
                bmNode.querySelector('hr').style.width = `${hrWidth}`; //li.a.hr
            }
        }
    }

    // Drag the edge
    $resizerx.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        resizerXDown = true;
        bodyWidth = body.offsetWidth;
        screenX = e.screenX;
    });
    $resizery.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        resizerYDown = true;
        bodyHeight = body.offsetHeight;
        screenY = e.screenY;
    });
    let currentMaxHeight = 0;
    function mouseMoveHandler(e) {
        if (!resizerXDown && !resizerYDown)
            return;
        e.preventDefault();
        const isX = resizerXDown;
        if (e.type === 'mouseup') {
            resizerXDown = false;
            resizerYDown = false;
            adaptBookmarkTooltips();
        }
        if (isX) {
            // record current width
            const changedWidth = rtl ? (e.screenX - screenX) : (screenX - e.screenX);
            let width = bodyWidth + changedWidth;
            // 320 < width < 640
            width = Math.min(640, Math.max(320, width));
            // if (!rtl && e.screenX < 640 || rtl && e.screenX > 640) {
            //     $resizerx.style.cursor = 'not-allowed';
            // } else {
            //     $resizerx.style.cursor = 'col-resize';
            // }
            body.style.width = `${width}px`;
            localStorage.popupWidth = width;
            resetSeparator(); // Reset separators
            clearMenu();
        } else {
            // record current height
            const changedHeight = e.screenY - screenY;
            let height = bodyHeight + changedHeight;
            // 240 < height < 600
            if (currentMaxHeight <= 0) {
                chrome.tabs.getZoom(zoomFactor => {
                    currentMaxHeight = (600 / zoomFactor) - 1;
                    height = Math.min(currentMaxHeight, Math.max(currentMaxHeight / 2, height));
                    body.style.height = `${height}px`;
                    localStorage.popupHeight = height;
                    resetSeparator(); // Reset separators
                    clearMenu();
                });
            } else {
                height = Math.min(currentMaxHeight, Math.max(currentMaxHeight / 2, height));
                body.style.height = `${height}px`;
                localStorage.popupHeight = height;
                resetSeparator(); // Reset separators
                clearMenu();
                if (e.type === 'mouseup') {
                    currentMaxHeight = 0;
                }
            }
        }
    }
    document.addEventListener('mousemove', mouseMoveHandler);
    document.addEventListener('mouseup', mouseMoveHandler);

    // Closing dialogs on escape
    const closeDialogs = () => {
        if (body.hasClass('needConfirm'))
            ConfirmDialog.fn2();
        ConfirmDialog.close();
        if (body.hasClass('needEdit'))
            EditDialog.close(false);
        if (body.hasClass('needInputName'))
            NewFolderDialog.close(false);
        if (body.hasClass('needAlert'))
            AlertDialog.close();
    };
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (body.hasClass('needConfirm') || body.hasClass('needEdit') ||
                body.hasClass('needAlert') || body.hasClass('needInputName')) { // esc
                e.preventDefault();
                closeDialogs();
            } else {
                if (searchMode) {
                    // Pressing esc shouldn't close the popup when search field has value
                    e.preventDefault();
                    quitSearchMode();
                }
                if (searchInput.value) {
                    e.preventDefault();
                    searchInput.value = '';
                }
            }
        } else if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) { // cmd/ctrl + f
            searchInput.focus();
            searchInput.select();
            e.preventDefault();
        }
    });
    $('cover').addEventListener('click', closeDialogs);

    // Make webkit transitions work only after elements are settled down
    setTimeout(() => {
        body.addClass('transitional');
    }, 10);

    // Zoom
    if (localStorage.zoom) {
        body.dataset.zoom = localStorage.zoom;
    }
    const zoom = val => {
        if (draggedBookmark)
            return; // prevent zooming when drag-n-dropping
        const dataZoom = body.dataset.zoom;
        const currentZoom = dataZoom ? dataZoom.toInt() : 100;
        if (val === 0) {
            delete body.dataset.zoom;
            localStorage.removeItem('zoom');
        } else {
            let z = (val > 0) ? currentZoom + 10 : currentZoom - 10;
            z = Math.min(150, Math.max(90, z));
            body.dataset.zoom = `${z}`;
            localStorage.zoom = z;
        }
        body.addClass('dummy').removeClass('dummy'); // force redraw
        resetHeight();
    };
    //use 'wheel' event and 'e.deltaY' instead (>= Chrome 61)
    function wheelHandler(e) {
        if (!e.metaKey && !e.ctrlKey)
            return;
        e.preventDefault();
        zoom(e.deltaY || e.wheelDelta);
    }
    document.addEventListener('wheel', wheelHandler);
    document.addEventListener('mousewheel', wheelHandler);
    document.addEventListener('keydown', e => {
        if (!e.metaKey && !e.ctrlKey)
            return;
        switch (e.key) {
            case '+': // =/+ (plus)
            case '=': // =/+ (plus)
                e.preventDefault();
                zoom(1);
                break;
            case '-': // - (minus)
                e.preventDefault();
                zoom(-1);
                break;
            case '0': // 0 (zero)
                e.preventDefault();
                zoom(0);
                break;
        }
    });

    // Fix stupid Chrome build 536 bug
    if (version.build >= 536)
        body.addClass('chrome-536');

    // Fix stupid wrong offset of the page, on Chrome Mac
    if (os === 'mac') {
        setTimeout(() => {
            const top = body.scrollTop;
            if (top !== 0)
                body.scrollTop = 0;
        }, 1500);
    }

    if (localStorage.userstyle) {
        const style = document.createElement('style');
        style.textContent = localStorage.userstyle;
        style.inject(document.body);
    }

    // document.addEventListener('DOMContentLoaded', () => {

    //     const reportError = (msg, url, line) => {
    //         const manifest = chrome.runtime.getManifest();
    //         const version = manifest.version;
    //         const txt = `_s=84615e81d50c4ddabff522aee3c4b734&_r=img&Msg=${escape(msg)}&URL=${escape(url)}&Line=${line}&Platform=${escape(navigator.platform)}&Version=${escape(version)}&UserAgent=${escape(navigator.userAgent)}`;
    //         const i = document.createElement('img');
    //         i.setAttribute('src', `${('https:' === document.location.protocol) ? 'https://errorstack.appspot.com'
    //             : 'http://www.errorstack.com'}/submit?${txt}`);
    //         document.body.appendChild(i);
    //         i.onload = () => {
    //             document.body.removeChild(i);
    //         };
    //     };

    //     window.onerror = reportError;

    //     chrome.extension.onRequest.addListener(request => {
    //         if (request.error) reportError.apply(null, request.error);
    //     });
    // });
    
    if (localStorage.customIcon) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const customIcon = JSON.parse(localStorage.customIcon);
        const imageData = ctx.getImageData(0, 0, 19, 19);
        for (const key in customIcon) imageData.data[key] = customIcon[key];
        chrome.action.setIcon({
            imageData: imageData
        });
    }

    // Initialize sync status event listeners
    function initializeSyncControls() {
        // Listen for sync status changes
        if (window.addEventListener && window.syncManager) {
            window.addEventListener('syncStatusChanged', (event) => {
                // Update UI based on sync status changes
                const { bookmarkId, status } = event.detail;
                if (bookmarkId && status) {
                    updateBookmarkSyncStatus(bookmarkId, status);
                }
            });
        }
    }

    // Update individual bookmark sync status
    function updateBookmarkSyncStatus(bookmarkId, syncStatus) {
        const treeItem = document.getElementById(`neat-tree-item-${bookmarkId}`);
        const resultsItem = document.getElementById(`results-item-${bookmarkId}`);

        [treeItem, resultsItem].forEach(item => {
            if (item) {
                const syncIndicator = item.querySelector('.sync-indicator');
                if (syncIndicator) {
                    syncIndicator.remove();
                }

                if (localStorage.showSyncStatus === 'true' && window.syncManager) {
                    const statusClass = window.syncManager.getSyncStatusIndicator(bookmarkId);
                    const tooltip = window.syncManager.getSyncTooltip(bookmarkId);
                    if (statusClass) {
                        const newIndicator = document.createElement('span');
                        newIndicator.className = `sync-indicator ${statusClass}`;
                        newIndicator.title = tooltip;
                        newIndicator.innerHTML = `<span class="sync-tooltip">${tooltip}</span>`;

                        // Insert into the favicon container
                        const containerElement = item.querySelector('.tree-item-link') || item.querySelector('.tree-item-span');
                        const faviconContainer = containerElement ? containerElement.querySelector('.favicon-container') : null;
                        if (faviconContainer) {
                            faviconContainer.appendChild(newIndicator);
                        } else {
                            // Fallback to old logic
                            const fallbackContainer = item.querySelector('a') || item.querySelector('span');
                            const imgElement = fallbackContainer.querySelector('img');
                            if (imgElement && imgElement.nextSibling) {
                                fallbackContainer.insertBefore(newIndicator, imgElement.nextSibling);
                            } else {
                                fallbackContainer.appendChild(newIndicator);
                            }
                        }
                    }
                }
            }
        });
    }

    // Refresh all sync indicators in the UI
    function refreshSyncIndicators() {
        if (window.syncManager) {
            window.syncManager.refreshAllSyncStatus();
        }
        // Update existing UI elements
        const allTreeItems = document.querySelectorAll('[id^="neat-tree-item-"], [id^="results-item-"]');
        allTreeItems.forEach(item => {
            const bookmarkId = item.id.replace(/^neat-tree-item-/, '').replace(/^results-item-/, '');
            if (bookmarkId && window.syncManager) {
                const statusClass = window.syncManager.getSyncStatusIndicator(bookmarkId);
                const tooltip = window.syncManager.getSyncTooltip(bookmarkId);

                const syncIndicator = item.querySelector('.sync-indicator');
                if (syncIndicator) {
                    syncIndicator.remove();
                }

                if (localStorage.showSyncStatus === 'true' && statusClass) {
                    const newIndicator = document.createElement('span');
                    newIndicator.className = `sync-indicator ${statusClass}`;
                    newIndicator.title = tooltip;
                    newIndicator.innerHTML = `<span class="sync-tooltip">${tooltip}</span>`;

                    // Insert into the favicon container
                    const containerElement = item.querySelector('.tree-item-link') || item.querySelector('.tree-item-span');
                    const faviconContainer = containerElement ? containerElement.querySelector('.favicon-container') : null;
                    if (faviconContainer) {
                        faviconContainer.appendChild(newIndicator);
                    } else {
                        // Fallback to old logic
                        const fallbackContainer = item.querySelector('a') || item.querySelector('span');
                        const imgElement = fallbackContainer.querySelector('img');
                        if (imgElement && imgElement.nextSibling) {
                            fallbackContainer.insertBefore(newIndicator, imgElement.nextSibling);
                        } else {
                            fallbackContainer.appendChild(newIndicator);
                        }
                    }
                }
            }
        });
    }

    // Expose neat functions to window
    window.neat = {
        refreshSyncIndicators: refreshSyncIndicators
    };

    // Set default sync settings if not already set
    if (localStorage.showSyncStatus === undefined) {
        localStorage.showSyncStatus = 'true';
    }

    // Initialize sync controls when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeSyncControls);
    } else {
        initializeSyncControls();
    }
})(window);
