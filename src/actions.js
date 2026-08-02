import { uuidFast } from './separators.js';
import { TREE_INDENT } from './tree-render.js';

/**
 * Popup action layer (P1 module extracted from neat.js).
 *
 * Owns every bookmark operation behind the click handlers, the context-menu
 * dispatch and the keyboard shortcuts: opening bookmarks/folders (current
 * tab, new tab, new window, incognito, tab group), adding bookmarks/folders/separators
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
 * ctx.undo                       — initUndo API (capture/showToast, P3.3): every delete
 *                                  path snapshots the subtree BEFORE removing it and
 *                                  ends with a toast offering undo. Optional — a missing
 *                                  ctx.undo degrades to plain deletes with no toast.
 *
 * document/window/chrome remain page globals, as in the rest of the popup.
 * uuidFast (for separator URLs) is imported from ./separators.js instead of
 * being patched onto the Math global by neat.js. No neatools helpers here:
 * plain getElementById and DOM calls only (neatools' el.destroy() is inlined
 * as parentNode.removeChild).
 */

// P3.4: chrome.tabGroups accepts exactly these nine group colors.
const tabGroupColors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

// Deterministic group color for a folder title: a plain charCode-sum hash
// modulo the palette, so the same folder name always lands on the same color.
const pickGroupColor = title => {
    let hash = 0;
    for (let i = 0; i < title.length; i++)
        hash += title.charCodeAt(i);
    return tabGroupColors[hash % tabGroupColors.length];
};

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
    const generateHTML = ctx.generateHTML;
    const httpsPattern = ctx.httpsPattern;
    // P3.3: deletions capture an undo snapshot and toast afterwards; without
    // an injected undo API (tests, defensive) they stay plain silent deletes.
    const undo = ctx.undo || { capture() {}, showToast() {} };

    // ++++++++ added by windviki@gmail.com ++++++++
    // 拷贝发生在 chrome.bookmarks.get 的异步回调里，早已脱离用户手势上下
    // 文，execCommand('copy') 会被 Chrome 静默拒绝；navigator.clipboard
    // .writeText 配合 manifest 的 clipboardWrite 权限不受此时序限制。
    // 失败时回退到隐藏 textarea + execCommand 的老路径。
    const copyToClipboard = copyText => {
        const legacyCopy = () => {
            const copier = $('copier-input');
            copier.value = copyText;
            copier.select();
            document.execCommand('copy');
        };
        // node 测试环境（Node <21）没有 navigator 全局，特性检测需先判存在
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(copyText).catch(legacyCopy);
        } else {
            legacyCopy();
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
        undo.capture(id);
        chrome.bookmarks.removeTree(id, () => {
            li.parentNode && li.parentNode.removeChild(li);
            separatorManager.remove(id);
            // Separators carry no meaningful title — toast with an empty one.
            undo.showToast(_m('deletedBookmark', ['']));
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
                // 目标文件夹处于折叠态：其子 ul 尚未渲染（generateHTML 只为
                // 展开的文件夹生成子树），此时插入 li 会造出只含新节点的残
                // 缺 ul。旧实现直接 return，导致书签已创建但视图毫无反馈。
                // 改为展开该文件夹并用最新 children 整体渲染（create 已完
                // 成，新节点就在其中），与 tree-view.js 的点击展开同一路径；
                // generateHTML 内部会顺带完成 separator 注册，无需手动 add。
                rNode.classList.add('open');
                rNode.setAttribute('aria-expanded', 'true');
                const childLevel = parseInt(rNode.parentNode.dataset.level) + 1;
                chrome.bookmarks.getChildren(parentId, children => {
                    const div = document.createElement('div');
                    div.innerHTML = generateHTML(children, childLevel);
                    const ul = div.querySelector('ul');
                    // 曾展开过的文件夹折叠后旧 ul 仍在 DOM 中，先移除再渲染，
                    // 避免重复子树，也顺带刷新可能陈旧的内容。
                    const stale = rNode.querySelector('ul');
                    if (stale)
                        stale.remove();
                    rNode.appendChild(ul);
                    div.remove();
                    const added = $(`neat-tree-item-${resultBm.id}`);
                    if (added)
                        added.scrollIntoView({ block: 'nearest' });
                });
                // 持久化展开状态（对齐 tree-view 的 toggle：只写 store）
                const openIds = Array.from(document.querySelectorAll('#tree li.open'))
                    .map(li => li.id.replace('neat-tree-item-', ''));
                store.set('opens', JSON.stringify(openIds));
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
            const paddingStart = TREE_INDENT * lv;
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
            // 'before'/'after' 插入位置相对于 rNode，优先以 rNode.parentNode
            // 作为正确的父级 ul；根级节点 pNode 退化为 document.body 时，
            // querySelector('ul') 可能找到错误容器（如 #recent-list）。
            // 若 rNode.parentNode 不可用则回退到 pNode.querySelector（兼容测试 mock）。
            let ul;
            if ((where === 'before' || where === 'after') && rNode.parentNode) {
                ul = rNode.parentNode; // rNode 所在的 <ul>
            } else {
                ul = pNode.querySelector('ul');
                // fix ul
                if (!ul) {
                    const tmpDiv = document.createElement('div');
                    tmpDiv.innerHTML = `<ul role="group" data-level="${lv}"></ul>`;
                    const newUl = tmpDiv.querySelector('ul');
                    pNode.appendChild(newUl);
                    ul = pNode.querySelector('ul');
                    tmpDiv.parentNode && tmpDiv.parentNode.removeChild(tmpDiv);
                }
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
                // 注：当前台打开新标签页时，Chrome 会自动关闭 popup（焦点转移），
                // 即使 bookmarkClickStayOpen 为 true 也无法阻止；但后台打开时
                // popup 可以保持，此时显式关闭逻辑才生效。
                if (!bookmarkClickStayOpen)
                    setTimeout(window.close, 200);
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

        // P3.4: same batch-open as openBookmarks (same >10 ConfirmDialog
        // gate), then the new tabs become one named tab group. On a Chrome
        // too old for tab groups the feature-detect fails and the tabs stay
        // a plain batch-open — no error, just no group.
        openBookmarksInGroup: (urls, groupTitle) => {
            const urlsLen = urls.length;
            const open = () => {
                const tabIds = [];
                let pending = urlsLen;
                const onCreated = tab => {
                    tabIds.push(tab.id);
                    if (--pending > 0)
                        return;
                    if (!(chrome.tabs.group && chrome.tabGroups))
                        return;
                    chrome.tabs.group({ tabIds: tabIds }, groupId => {
                        chrome.tabGroups.update(groupId, {
                            title: groupTitle,
                            color: pickGroupColor(groupTitle)
                        });
                    });
                };
                chrome.tabs.create({
                    url: urls[0],
                    active: true
                    // first tab will be selected
                }, onCreated);
                for (let i = 1; i < urlsLen; i++) {
                    chrome.tabs.create({
                        url: urls[i],
                        active: false
                    }, onCreated);
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
            // The row's <i> carries the displayed title (the anchor also
            // holds a sync-tooltip span, so its textContent would pollute
            // the toast). Results rows share the same markup.
            const titleNode = (li1 && li1.querySelector('i')) || (li2 && li2.querySelector('i'));
            const title = titleNode ? titleNode.textContent.trim() : '';
            undo.capture(id);
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
                undo.showToast(_m('deletedBookmark', [title]));
            });
        },

        // v4 task-2 (§5.7): deleting a NON-EMPTY folder asks for
        // confirmation first — a limited walk-back of the P3.3 quiet flow
        // (a misclicked folder delete is expensive and the toast's undo
        // window can be missed). Empty folders and single bookmarks keep
        // the direct delete+toast path; confirmDeleteFolder (default on)
        // restores the pure toast flow when turned off. The counts come
        // from the callers (keyboard.js/context-menu.js/palette.js), which
        // kept counting children after P3.3 — this reconnects the consumer.
        deleteBookmarks: (id, bookmarkCount, folderCount) => {
            const li = $(`neat-tree-item-${id}`);
            const item = li.querySelector('span');
            const folderName = item.textContent.trim();
            const doDelete = () => {
                undo.capture(id);
                chrome.bookmarks.removeTree(id, () => {
                    li.parentNode && li.parentNode.removeChild(li);
                    undo.showToast(_m('deletedFolder', [folderName]));
                });
                const nearLi = li.nextElementSibling || li.previousElementSibling;
                if (nearLi)
                    nearLi.querySelector('a, span').focus();
            };
            // Mixed contents (bookmarks + subfolders) are summed into one
            // count — a single dialog per folder delete.
            const totalChildren = (bookmarkCount || 0) + (folderCount || 0);
            if (totalChildren > 0 && !!store.get('confirmDeleteFolder', '1')) {
                dialogs.ConfirmDialog.open({
                    dialog: _m('confirmDeleteFolder', `${totalChildren}`),
                    button1: `<strong>${_m('confirmDeleteFolderButton')}</strong>`,
                    button2: _m('nope'),
                    fn1: doDelete
                });
            } else {
                doDelete();
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
