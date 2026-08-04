# Issues #46 / #47 / #48 反馈 · Feedback

针对 v4 发布后 2026-08-03 提交的三个 issue，逐一说明处理结论与修复情况。每条先给中文，再给可直接粘贴到 GitHub 的英文回复。

Status of the three issues filed on 2026-08-03 after the v4 release. Each section first gives the Chinese explanation, then a copy-paste-ready English reply.

---

## #46 — Folder search access seems broken ✅ 已解决 / Resolved

### 中文

**根因**：`src/tree-view.js` 的 `bookmarkHandler` 用 `el.className === "link-folder"` **整串精确匹配**判定文件夹搜索结果行。但自 116e44c 起，搜索/命令面板的文件夹行 class 一直是 `"link-folder tree-item-link"`（两个类），精确匹配永远为 `false`，点击于是落入普通书签分支：把 `el.href`（空 `href` 解析后是 popup 页面自身 URL）当书签打开——于是表现为"在 popup 外打开一个带着同样搜索结果的页面"，文件夹内容没有在 popup 内展开。

**修复**：改为 `el.classList.contains('link-folder')`（成员测试，与 `context-menu.js` 里文件夹右键的判定一致）。点击搜索结果中的文件夹现在会正确执行 `revealInTree`：退出搜索、打开祖先链、聚焦目标文件夹，全部留在 popup 内。

**验证**：Docker 真实浏览器探针——点击文件夹搜索结果后树视图可见且目标文件夹已展开、无新标签页被打开；vitest 44 套件 / 1419 例全绿。

> 附加说明：这同时解释了报告里"点文件夹链接后所有书签消失、像被锁在搜索模式"的现象——新标签页里加载的是 popup 页面自身，搜索结果随 popup 状态残留而显示为空。

### English

**Root cause**: `bookmarkHandler` in `src/tree-view.js` detected folder rows by an exact whole-string match — `el.className === "link-folder"`. But since 116e44c the folder rows in the search results and command palette carry two classes: `"link-folder tree-item-link"`. The exact match never succeeded, so a click fell through to the plain-bookmark branch and tried to open `el.href` (an empty `href` resolves to the popup page's own URL) as a bookmark — hence "it opens a page outside the popup with the same search results" instead of revealing the folder inside the popup.

**Fix**: switched to a membership test — `el.classList.contains('link-folder')` (matching how the folder context menu already detects folders in `context-menu.js`). Clicking a folder in the search results now correctly runs `revealInTree`: it quits search, opens the ancestor chain, focuses the target folder, all inside the popup.

**Verified**: real-browser probe (Docker harness) — clicking the folder result now shows the tree view with the target folder expanded and opens no new tab; vitest 44 suites / 1419 cases all green.

> Side note: this also explains the "all bookmarks vanished / locked in search mode" part of the report — the new tab was loading the popup page itself, and the stale search state left the results empty.

---

## #47 — Count badge styles in stats tab look broken for "by recent" ✅ 已解决 / Resolved

### 中文

**先澄清一个点**：计数**数值**没有错（×N 的 N 是对的）。坏的是**样式**。

stats 视图两种排序下，徽章槽位的内容不同：
- **by count**：徽章槽放 `×N`（计数），右侧槽放相对时间 —— 计数徽章是正常的药丸（蓝底、圆角、居中）。
- **by recent**：徽章槽放**相对时间**（"just now"、"1 hr ago"…），右侧槽放 `×N`。

问题出在共享的 `.vbm-row .row-badge` 基础规则把所有徽章都按**药丸**排版（固定 14px 高、7px 圆角、9px 居中字号）。`.row-badge.time` 只改了颜色和左右 padding，没有解除药丸几何——于是 "by recent" 下的时间字符串被挤进一个**透明药丸**里，小号居中、无底色，看起来就是"坏掉了"。

**修复**：`.row-badge.time` 重置药丸几何为普通弱化文本——`height: auto`、`border-radius: 0`、`font-size: 12px`、左对齐、muted 色，与右侧 `.row-path` 的排版一致。

**验证**：Docker 真实浏览器 computed style——修复前 `height:14px / radius:7px / font:9px / center`，修复后 `radius:0px / font:12px / start / 自适应高度`；vitest 全绿。

### English

**To be clear up front**: the **count value is correct** — the ×N numbers are right. What was broken is the **styling**.

In the stats view the badge slot shows different content per sort mode:
- **By count**: the badge slot holds `×N` (the count) and the right slot holds the relative time — a proper pill (blue fill, rounded, centered).
- **By recent**: the badge slot holds the **relative time** ("just now", "1 hr ago"…), and the right slot holds `×N`.

The problem: the shared `.vbm-row .row-badge` base rule lays every badge out as a **pill** (fixed 14px height, 7px radius, 9px centered type). `.row-badge.time` only changed the color and horizontal padding — it never undid the pill geometry. So in "by recent" the time string got squeezed into a **transparent pill**: tiny, centered, no fill. That is the "broken" look.

**Fix**: `.row-badge.time` now resets the pill geometry to plain muted text — `height: auto`, `border-radius: 0`, `font-size: 12px`, left-aligned, muted color — matching the `.row-path` label typography.

**Verified**: real-browser computed styles — before `height:14px / radius:7px / font:9px / center`, after `radius:0px / font:12px / start / auto height`; vitest all green.

---

## #48 — Right-clicking a folder no longer brings up options ⚠️ 未复现，需要更多信息 / Could not reproduce — need more info

### 中文

在**当前代码**上做了穷尽性真实浏览器测试，下列场景下右键文件夹**均正常**弹出文件夹菜单（15 项全部可见，含"在新窗口打开全部书签"）：

- 树视图中普通文件夹（含子书签）✅
- 树视图中根文件夹（书签栏 / 其他书签）✅
- 搜索结果中的文件夹行 ✅
- 点击文件夹**标题文字**而非行中间 ✅
- 侧边栏（panel）模式 ✅
- 空文件夹 ✅
- 全流程无页面 JS 报错 ✅

右键判定逻辑本身没有发现回归：`context-menu.js` 对文件夹用 `classList.contains('link-folder')` + `li` 祖先守卫，与 3.x 相比是增强而非削弱。

**需要你提供更多信息**以便定位：

1. **具体场景**：右键"没反应"时，你是在哪个视图（树 / 搜索结果 / 命令面板）？当时 popup 处于什么状态（刚打开？搜索过？展开过哪些文件夹）？是**所有**文件夹都这样，还是特定某个文件夹？
2. **自定义样式**：是否在选项页设置了**自定义 CSS / userstyle**？自定义样式可能覆盖右键菜单的 z-index / 显示规则导致菜单不可见。
3. **环境**：浏览器版本（Chrome 具体版本号）、操作系统、是否在侧边栏模式下也复现。
4. **截图/录屏**：如果能提供右键瞬间的截图（含菜单是否短暂闪现又消失），判断是"没触发"还是"触发了但被立即关掉"会快很多。

如果确实有自定义 CSS，请一并说明大致内容，我可以直接针对复现环境修。

### English

I tested the current code exhaustively in a real browser (Docker harness). In every scenario below, right-clicking a folder **does** open the folder menu (all 15 items visible, including "Open all bookmarks in new window"):

- A regular folder with bookmarks in the tree view ✅
- Root folders ("Bookmarks bar" / "Other bookmarks") in the tree ✅
- A folder row in the search results ✅
- Right-clicking the folder **title text** (not the row center) ✅
- Side-panel mode ✅
- An empty folder ✅
- No page JS errors across the whole run ✅

The folder-detection logic itself shows no regression: `context-menu.js` detects folders via `classList.contains('link-folder')` plus an `li` ancestor guard — a strengthening over 3.x, not a weakening.

**To pin this down I'd need a bit more info:**

1. **Exact scenario**: which view were you in (tree / search results / command palette) when right-clicking did nothing? What state was the popup in (just opened? after searching? with some folders expanded)? Did **every** folder fail, or only a specific one?
2. **Custom styles**: do you have a **custom CSS / userstyle** set on the options page? Custom styles could override the context menu's z-index / display rules and make it invisible.
3. **Environment**: browser version (exact Chrome build), OS, and whether it also happens in the side panel.
4. **Screenshot / screen recording**: a capture of the right-click moment (including whether the menu flashes and disappears) would quickly tell "never triggered" vs "triggered but immediately dismissed".

If you do have custom CSS, please share roughly what it does — I can then reproduce against that exact setup.

---

## 附带建议（版本号）· Version numbering note

### 中文

针对修复版发版的版本号选择（4.1 vs 4.0.1），说明如下：

- 当前版本判定机制里，`neat.js parseVersion` 只用正则 `/(\d+)\.(\d+)/` 取**前两段**（major.minor），忽略 patch。
- 因此选 **4.0.1**：老 4.0 用户升级到 4.0.1 时 `minor` 不变，`newOrUpgrade=false`，**不会**弹"新版本发布"卡片——这正是补丁版想要的静默升级；3.x→4.0.1 跨版本升级、风险横幅（只看 major）都正常。
- 选 **4.1**：老 4.0 用户升级会触发"新版本"捐赠卡片。
- 两者都是合法的 Chrome manifest 版本号。若选 4.0.1，唯一的限制是：想给存量 4.0 用户"播报这次修复内容"的话，现有版本门禁做不到（patch 升级不可见），需要另想机制。

### English

On choosing the version number for this fix release (4.1 vs 4.0.1):

- In the current version-gate logic, `neat.js parseVersion` reads only the **first two segments** with `/(\d+)\.(\d+)/` (major.minor); the patch segment is ignored.
- So **4.0.1** means: existing 4.0 users upgrading to 4.0.1 keep the same `minor`, so `newOrUpgrade=false` — the "new version" donation card is **not** shown. That is exactly the silent patch upgrade a fix release wants; 3.x→4.0.1 major-crossing upgrades and the risk banner (major-only) both behave correctly.
- Choosing **4.1** would trigger the "new version" donation card for existing 4.0 users.
- Both are valid Chrome manifest versions. The only limitation of 4.0.1: if you ever want to broadcast the contents of this fix to existing 4.0 users, the current version gate cannot do it (a patch bump is invisible), so you'd need a separate mechanism.
