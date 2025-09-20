> 本文由 [简悦 SimpRead](http://ksria.com/simpread/) 转码， 原文地址 [github.com](https://github.com/windviki/vBookmarks/issues/36)

When vBookmarks is opened from the title bar in Brave, it changes from an initial large frame that displays around 30 links to a small square frame that displays maybe a dozen links. Althouogh the frame size can be lengthened by click and hold and drag on the lower frame, it sould not resize itself.

 

When vBookmarks is opened from the title bar in Brave, it changes from an initial large frame that displays around 30 links to a small square frame that displays maybe a dozen links. Althouogh the frame size can be lengthened by click and hold and drag on the lower frame, it sould not resize itself.

 

> 当从 Brave 的标题栏打开 vBookmarks 时，它从一个最初显示大约 30 个链接的大框架变为一个显示可能只有一打链接的小正方形框架。尽管可以通过点击并按住下框架并拖动来延长框架大小，但它不应该自行调整大小。

我有同样问题， vBookmarks 窗口会自动缩小到固定值，这很难受

 

> 当从 Brave 的标题栏打开 vBookmarks 时，它从一个最初显示大约 30 个链接的大框架变为一个显示可能只有一打链接的小正方形框架。尽管可以通过点击并按住下框架并拖动来延长框架大小，但它不应该自行调整大小。

我有同样问题， vBookmarks 窗口会自动缩小到固定值，这很难受

 

Hey, this feature's been around since the original Neatbookmarks days. Here's how it works: When your bookmark tree is small and doesn't fill up the pop-up window, it automatically adjusts its height to either fit the content or meet Chrome's minimum size requirements. Chrome actually enforces maximum and minimum height limits for extensions.

If we remove this auto-sizing feature, some folks might find themselves staring at a half-empty popup with awkward blank space – which could be annoying. Maybe down the line, we could add a toggle in the settings to let users choose whether they want this auto-resizing behavior or not. That way people can pick what works best for their setup.

这个是从最初的 Neatbookmarks 开始就有的一个设计。当你的书签树比较小，内容不足以撑满最初的整个 popup 的高度时，它会尝试自动收缩到内容高度或者最小的高度（chrome 允许的高度有一个最大和最小值）。这个功能如果去掉，可能会有人不喜欢面对着大片空白的 popup。有时间的话以后的版本可以考虑提供一个设置项的开关开启用或者禁用这个行为。

 

Hey, this feature's been around since the original Neatbookmarks days. Here's how it works: When your bookmark tree is small and doesn't fill up the pop-up window, it automatically adjusts its height to either fit the content or meet Chrome's minimum size requirements. Chrome actually enforces maximum and minimum height limits for extensions.

If we remove this auto-sizing feature, some folks might find themselves staring at a half-empty popup with awkward blank space – which could be annoying. Maybe down the line, we could add a toggle in the settings to let users choose whether they want this auto-resizing behavior or not. That way people can pick what works best for their setup.

这个是从最初的 Neatbookmarks 开始就有的一个设计。当你的书签树比较小，内容不足以撑满最初的整个 popup 的高度时，它会尝试自动收缩到内容高度或者最小的高度（chrome 允许的高度有一个最大和最小值）。这个功能如果去掉，可能会有人不喜欢面对着大片空白的 popup。有时间的话以后的版本可以考虑提供一个设置项的开关开启用或者禁用这个行为。