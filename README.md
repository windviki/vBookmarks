vBookmarks
==============

Modified from NeatBookmarks, an excellent bookmark extension for Google Chrome. 

Clicking the Bookmark Star in Chrome is an awful way to add a bookmark, and what I need is an extension just like "AddBookmarkHere" for Firefox.
So I added some new features to "NeatBookmarks", it's easy to manage your bookmarks now.

1) Bookmark current tab before selected bookmark/folder.

2) Bookmark current tab after selected bookmark/folder.

3) Bookmark current tab to the top of selected folder.

4) Bookmark current tab to the bottom of selected folder.

5) Add a sub-folder into selected folder.

6) Update URL of selected bookmark with current URL.

7) Copy title and URL information for selected bookmarks into clipboard.

8) Add an option: only show the nodes of the Bookmark Bar.

9) Fix bugs in Neat Bookmarks.

Licensed under the [MIT License](http://www.opensource.org/licenses/mit-license.php).

Read the [FAQ](https://github.com/windviki/vBookmarks/wiki/FAQ).


Attensions
-----------------

Above Chrome 20+, please drag this crx file to chrome://chrome/extensions/ to install it.

Otherwise there will be an error.


Chinese Introduction
-----------------

功能：

1) 在选中的书签/文件夹之前/之后添加当前tab为新书签

2) 在选中的文件夹顶部/底部添加当前tab为新书签

3) 在选中的文件夹中添加子文件夹

4) 替换选中的书签的URL为当前tab的URL

5) 拷贝选中书签的标题和URL到剪贴板

6) 增加选项：仅在插件里显示书签工具栏中的书签

7) 修正Neat Bookmarks中的已知BUG

近期版本说明：

版本1.2 在Chrome20+有双滚动条问题。 <-- 推荐Chrome20以下版本使用

版本1.3 修正以上问题，但是Chrome20以下版本滚动条不出现。

版本1.4 彻底解决滚动条问题。

版本1.5 解决Chrome的更新引起的一些问题，推荐Chrome20以上版本使用。

注意：

Chrome20+ 在安装本扩展的时候，需要把crx拖动到扩展程序这个页面（chrome://chrome/extensions/）才能正常安装，否则会报错。


Technical Details
-----------------

Neat Bookmarks was powered by [MooTools](http://mootools.net/), but is now powered by Neatools, a custom-coded smaller subset of MooTools. 
[CodeMirror](http://codemirror.net/) is used for the Custom CSS section.


Changelogs
-----------------

ver1.0 2011/11/15

First version.


ver1.1 2011/11/16

Added: option for only displaying bookmarks in Bookmark Bar.

Added: context menu for adding folder before/after bookmark/folder.

Fixed: some translations in multi-language support.


ver1.2 2011/11/30

Added: update selected bookmark with current URL.

Added: copy title and URL of selected bookmark to clipboard.

Fixed: after adding new bookmark or folder to a closed folder, its original children cannot be shown correctly. 

Fixed: make up some missing translations for cs(Czech).


ver1.3 2012/05/25

Fixed: Scrollbar glitch. https://github.com/windviki/vBookmarks/issues/1


ver1.4 2012/06/20

Fixed: Scrollbar problem in Chrome 18,19. https://github.com/windviki/vBookmarks/issues/2


ver1.5 2012/06/21

Fixed: manifest problem in Chrome 20+.

Fixed: separated script file instead of inline scripts. see Content Security Policy http://code.google.com/chrome/extensions/contentSecurityPolicy.html


ver1.6 2012/06/24

Fixed: Cannot search bookmarks in Omnibox (*+space). [seeContent Security Policy]

Fixed: Restore width of the popup window. [Content Security Policy]

