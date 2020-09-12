vBookmarks
==============

[English Readme](README.md) | [中文说明](README.zh.md)

[![Donate me](https://img.shields.io/badge/donate-me-orange.svg)](donation/donation.md) | [![捐赠](https://img.shields.io/badge/捐赠-支持-orange.svg)](donation/donation.zh.md)

![Image of vBookmarks](vbookmarks.png)

[插件WebStore页面](https://chrome.google.com/webstore/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb)

[主页](http://windviki.github.com/vBookmarks/)

[历史版本下载](https://github.com/windviki/vBookmarks/blob/master/release/)


本项目本来是[Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks)的一个fork，该扩展是Chrome上面一个知名的书签管理器。但是原作者已经停止了开发。

本人早年使用Firefox，觉得扩展"AddBookmarkHere"有一个右键选项——“在此处添加书签”，非常方便，是书签超级多的人的福音。因此当时萌生出想法在[Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks)的基础上增加这个功能。后来功能越加越多，于是就形成了一个新的扩展独立出来。

授权为 [MIT License](http://www.opensource.org/licenses/mit-license.php).

此处有 [FAQ](https://github.com/windviki/vBookmarks/wiki/FAQ).


# 增加功能（相对于[Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks)）：

1) 在选中的书签或者文件夹之前添加当前页为书签

2) 在选中的书签或者文件夹之后添加当前页为书签

3) 在选中的文件夹顶部添加当前页为书签.

4) 在选中的文件夹底部添加当前页为书签

5) 给选中的文件夹添加子文件夹

6) 更新选中的书签网址为当前页面网址

7) 拷贝选中书签的页面标题和链接到剪贴板

8) 选项：仅显示书签栏里的书签

9) 新功能：可以随着书签同步的可定制书签分隔线

10) 基于Github的更新检测。在上架Webstore之后已经禁用

11) 解决[Neat Bookmarks](https://github.com/cheeaun/neat-bookmarks)的历史Bugs，以及在Chrome不断升级过程中出现的新Bugs


    ![Image of vBookmarks features](vbookmarks-menu.png)


# 高级功能说明：

1.扩展支持地址栏搜索，地址栏里敲*，然后空格，就可以输入关键词进行书签内的检索。

2.（popup打开的时候）扩展支持键盘方向键（↑↓←→）进行书签/文件夹的选择，空格键或者回车键打开选中书签或者文件夹，HOME/END跳到开头或者结尾。
PAGE DOWN/UP翻页，DELETE键删除书签。

3.选中书签，文件夹的时候，F2键可编辑。

4.鼠标中键打开目录下所有书签。

5.（popup打开的时候）Ctrl+F定位到搜索栏进行书签搜索。

6.支持书签拖放进行移动。

7.选项里可选打开书签链接后popup是否关闭。是否只显示书签栏中的书签。后台打开。书签树缩放等。

8.定制分隔符颜色（高级选项）支持十六进制颜色或者RGB颜色。#00FF00和RGB(255,0,0)都是合法的。

9.请用高级选项里的定制CSS获取更丰富的外观呈现。如改变书签树的字体。* {font-family: 微软雅黑;}

10.高级选项里可定制程序图标。


# 版本历史：

- 版本1.2 在Chrome20+有双滚动条问题。

- 版本1.3 修正以上问题，但是Chrome20以下版本滚动条不出现。

- 版本1.4 彻底解决滚动条问题。

- 版本1.5 解决Chrome的更新引起的一些问题，推荐Chrome20以上版本使用。

- 版本1.6 解决CSP相关的一些问题（Omnibox搜索（地址栏里*+空格）不能使用以及弹出框大小不能记忆的问题）。

- 版本1.7 修正Chrome19的双滚动条问题。之前没对Chrome19进行测试，遗漏了这个版本。请Chrome19的朋友重新更新。修正根目录展开时候popup宽度重置的问题。

- 版本1.8 实现书签分隔符（只存在于本地，无法随书签同步）。
修正Chrome18更新以来导致的drag-drop位置不正确的问题。
更改ICON颜色。
实现一个基于Github的更新检测和提醒（没有美元信用卡开不了webstore账户的人伤不起）。
移除多国语言，仅保留en,ja,zh,zh_TW（英语，日语，简体中文，繁体中文）。

- 版本1.9 修正popup刚刚打开时候滚动条会被重置到顶部的bug。
更改ICON细节。
更改更新检测的细节。
修改默认分割条的样式。

- 版本2.0 修正版本检测。
改进分隔条的实现，现在可以和书签一起同步了（其实就是特殊标识的书签）。
增加分隔条相关的几个高级选项。


  - “被用作分隔符的书签节点的标题”：默认为"|"，即通过vbookmarks菜单新建的分隔符（一个特殊书签）在Chrome自带的书签管理器或者书签栏里显示的书签标题文字。改为"------------"，可以在自带的书签菜单里起到视觉上的分割作用。


  - “被用作分隔符的书签节点的URL”：默认为"http://separatethis.com/ "，即通过vbookmarks菜单新建的分隔符（一个特殊书签）在Chrome自带的书签管理器或者书签栏里显示的书签链接地址。在vbookmarks里会显示为真正的分隔条，并且不可点击。


  - “如果任一书签URL含有以下字符串，将被显示为分隔符”：如果设置了该值（多个URL值用";"隔开），URL包含了该值的所有书签都会在vbookmarks里被显示为真正的分隔条。例如，设置为google.com，则所有google域名的书签都会变成分隔条。


- 版本2.1 现在可以正确记忆滚动条的位置了。
改进右键菜单的位置。并且右键菜单会在滚动页面的时候自动关闭。search模式下的右键菜单精简掉不直观的一些命令。
给新建文件夹对话框，重命名对话框增加“取消”按钮。


- 版本2.2 修正Chrome26+滚动条不滚动的问题。


- 版本2.3 修复右键菜单的自动关闭。修正滚动条位置的记忆（Chrome26+以及上个版本带来的问题）。


- 版本2.4 修正"Unexpected end of input"问题。


- 版本2.5 移除HTML notifications，现已不可用。参见https://bugs.webkit.org/show_bug.cgi?id=98388.


- 版本2.6 再次修复双滚动条。


- 版本2.8 
  - 修正鼠标中键点击打开两个页面的问题。https://github.com/windviki/vBookmarks/issues/9

  - 修正有时候搜索书签会出现空结果的问题。 https://github.com/windviki/vBookmarks/issues/7

  - 修正右键菜单有时候会被截断的问题。

  - 改进滚动条CSS样式。

  - 添加一个占位符"\_\_VBM_CURRENT_TAB_URL\_\_"。放在URL里可以自动被替换为当前激活的Tab的URL。主要用于Bookmarklet。（Chrome中使用BMLet常用的 _document.location.href_ 会取不到URL）。
  
    比如WIZ的BMLet“[添加到WIZ](http://note.wiz.cn/web/pages/client/url2wiz.html)”，官方的URL为：

    ```javascript:window.open('http://note.wiz.cn/url2wiz?url=' + encodeURIComponent(document.location.href)+'&folder=%2FMy%20Notes%2F&user=your_email@mywiz.cn&content-only=false&bookmark=1');```
    
    现在可以改为：

    ```[http://note.wiz.cn/url2wiz?url=\_\_VBM_CURRENT_TAB_URL\_\_&folder=%2FMy%20Notes%2F&user=your_email@mywiz.cn&content-only=false&bookmark=1](http://note.wiz.cn/url2wiz?url=__VBM_CURRENT_TAB_URL__&folder=%2FMy%20Notes%2F&user=your_email@mywiz.cn&content-only=false&bookmark=1)```


- 版本2.9 修正自版本77以来再次出现的双滚动条问题。

- 版本3.0 图标整体更换。

- 版本3.1 
  - 修正 [#12](https://github.com/windviki/vBookmarks/issues/12) 清除右键菜单时候导致的焦点丢失。现在可以全键盘操作。

  - 修正 [#18](https://github.com/windviki/vBookmarks/issues/18) 拖动书签或者文件夹到顶部或者底部时候的报错。

  - 修正 按方向盘下键时候一个未定义的错误。

  - 修正 对于bookmarklet的支持。多谢 @ZG-nico 的贡献。

  - 增加 法语。多谢 @Fab-fr 的贡献。

  - 增加 中国香港繁体中文。

- 版本3.2 
  - 修正 [#19](https://github.com/windviki/vBookmarks/issues/19) 添加到文件夹末尾不能正常工作。

  - 新增 [#15](https://github.com/windviki/vBookmarks/issues/15) 在Popup搜索栏搜索时可以搜索文件夹。

  - 新增 高度可以调节了。

  - 修正 一些未定义的错误。

  - 增加 意大利语。

  - 增加 俄语。多谢 @Stanislav 的贡献。

  - 代码升级到ECMAScript 6。最低Chrome版本要求调到61。


# 注意：

如果您需要离线安装扩展：

Chrome20+ 在安装本扩展的时候，需要把crx拖动到扩展程序这个页面（chrome://chrome/extensions/）才能正常安装，否则会报错。

Chrome22+ 可能需要添加启动参数才能安装非WebStore的扩展。右击 Chrome 桌面快捷方式，选择-"属性"-"快捷方式"，然后在"目标"一栏尾部添加参数 --enable-easy-off-store-extension-install，然后再运行浏览器就可以了。

详情参见[link](http://www.guao.hk/posts/chrome-extensions-not-in-the-chrome-web-store-more-difficult-to-install.html)。

现在已经上架在Webstore。请移步进行安装。

