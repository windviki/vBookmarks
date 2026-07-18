import { uuidFast } from './separators.js';

/**
 * Popup action layer (P1 module extracted from neat.js).
 *
 * Owns every bookmark operation behind the click handlers, the context-menu
 * dispatch and the keyboard shortcuts: opening bookmarks/folders (current
 * tab, new tab, new window, incognito), adding bookmarks/folders/separators
 * at a position relative to a tree node, editing and deleting entries (with
 * the focus hand-off to a sibling row), copying title+URL text and replacing
 * URLs. neat.js only sees the table returned at the bottom; every
 * `actions.xxx` call site is unchanged, and the two separator helpers ride
 * on the same table.
 *
 * initActions(ctx) is called once by neat.js after dialogs/search init.
 * ctx.store                      — chrome.storage mirror (click/confirm settings, sync settings)
 * ctx.dialogs                    — initDialogs API (ConfirmDialog/EditDialog/NewFolderDialog)
 * ctx.search                     — initSearch API (isActive)
 * ctx.separatorManager           — separator id registry + title/URL constants
 * ctx.generateBookmarkHTML(title, url, extras, id)    — bookmark row HTML
 * ctx.generateFolderHTML(title, extras, id, node)     — folder row HTML
 * ctx.generateSeparatorHTML(paddingStart)             — separator row HTML
 * ctx.httpsPattern               — shared ^https?:// regex (neat.js uses it too)
 *
 * document/window/chrome remain page globals, as in the rest of the popup.
 * uuidFast (for separator URLs) is imported from ./separators.js instead of
 * being patched onto the Math global by neat.js. No neatools helpers here:
 * plain getElementById and DOM calls only (neatools' el.destroy() is inlined
 * as parentNode.removeChild).
 */
export function initActions(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const dialogs = ctx.dialogs;
    const search = ctx.search;
    const separatorManager = ctx.separatorManager;
    const generateBookmarkHTML = ctx.generateBookmarkHTML;
    const generateFolderHTML = ctx.generateFolderHTML;
    const generateSeparatorHTML = ctx.generateSeparatorHTML;
    const httpsPattern = ctx.httpsPattern;

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
            _self1.text += `${title}\r\n`;
            if (isBookmark) {
                _self1.text += url;
                if (_fn1)
                    _fn1(_self1.text);
            }
        });
    };

    // ++++++++ end ++++++++

    const addSeparator = (nodeId, where) => {
        addNewNode(nodeId, where,
            `${separatorManager.separatorURL}#${uuidFast()}`,
            separatorManager.separatorTitle, true);
    };

    const deleteSeparator = id => {
        const li = $(`neat-tree-item-${id}`);
        chrome.bookmarks.removeTree(id, () => {
            li.parentNode && li.parentNode.removeChild(li);
            separatorManager.remove(id);
        });
        const nearLi = li.nextElementSibling || li.previousElementSibling;
        if (nearLi)
            nearLi.querySelector('a, span').focus();
    };

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
                tmpDiv.parentNode && tmpDiv.parentNode.removeChild(tmpDiv);
            }
            // a stale "(Empty)" marker must not survive a real child insert
            const emptyRow = ul.querySelector(':scope > li.empty-folder');
            if (emptyRow)
                emptyRow.parentNode && emptyRow.parentNode.removeChild(emptyRow);
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

            div.parentNode && div.parentNode.removeChild(div);

            if (isSeparator) {
                separatorManager.add(resultBm.id);
            }
        });
    }

    function addFolderTo(referId, parentId, iIndex, where) {
        dialogs.NewFolderDialog.open('NewFolder', dirTitle => {
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
    const dontConfirmOpenFolder = !!store.get('dontConfirmOpenFolder');
    const bookmarkClickStayOpen = !!store.get('bookmarkClickStayOpen');
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
                        // bookmarklet: run the code in the target page's main world
                        const bookmarkletCode = decodedUrl.replace(/^javascript:/i, '');
                        chrome.scripting.executeScript({
                            target: {tabId: tab.id},
                            func: code => {
                                try {
                                    (0, eval)(code);
                                } catch (e) {
                                    console.warn('vBookmarks: bookmarklet execution failed:', e);
                                }
                            },
                            args: [bookmarkletCode]
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
                dialogs.ConfirmDialog.open({
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
                dialogs.ConfirmDialog.open({
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
                dialogs.EditDialog.open({
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
                                        if (window.syncManager && store.getSyncSetting('showSyncStatus', 'true') === 'true') {
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
                                if (search.isActive()) {
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
                    li1.parentNode && li1.parentNode.removeChild(li1);
                    if (!search.isActive() && nearLi1)
                        nearLi1.querySelector('a, span').focus();
                }
                if (li2) {
                    const nearLi2 = li2.nextElementSibling || li2.previousElementSibling;
                    li2.parentNode && li2.parentNode.removeChild(li2);
                    if (search.isActive() && nearLi2)
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
                dialogs.ConfirmDialog.open({
                    dialog: dialog,
                    button1: `<strong>${_m('delete')}</strong>`,
                    button2: _m('nope'),
                    fn1: () => {
                        chrome.bookmarks.removeTree(id, () => {
                            li.parentNode && li.parentNode.removeChild(li);
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
                    li.parentNode && li.parentNode.removeChild(li);
                });
                const nearLi = li.nextElementSibling || li.previousElementSibling;
                if (nearLi)
                    nearLi.querySelector('a, span').focus();
            }
        }

    };

    // Separator actions ride on the same table: the context-menu dispatch and
    // generateTree's legacy-separator migration in tree-view.js reach them as
    // actions.addSeparator / actions.deleteSeparator.
    actions.addSeparator = addSeparator;
    actions.deleteSeparator = deleteSeparator;

    return actions;
}
