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

## #49 — Right-click menu: remove the "Bookmark this page" entry ✅ 已解决 / Resolved

### 中文

**需求**：v4 在页面右键菜单新增了"用 vBookmarks 收藏此页"条目，且无法移除；报告者请求提供设置开关。

**实现**（4.0.1）：
- 设置页 **Views 组新增独立开关**「在页面右键菜单添加"用 vBookmarks 收藏此页"条目」，默认开启。关闭后立即移除该菜单条目（服务端 worker 监听 `chrome.storage.onChanged` 实时生效，无需等下次冷启动）；与搜索框旁的快速收藏**星标按钮相互独立**。
- 该开关**纳入"一键恢复经典界面"预设**（与命令面板、星标、工具按钮、视图标签一起关闭）。
- 新增 2 个 i18n 键并全量翻译（42 个 locale，missing=0、TODO=0、verify 0 错误）。

**验证**：vitest 45 套件 / 1439 例全绿；Docker 真实浏览器探针——选项页开关默认开、可切换并持久化、经典预设一并关闭、manifest 4.0.1 加载无报错。

### English

**Request**: v4 added a "Bookmark this page with vBookmarks" entry to the page right-click menu that could not be removed; the reporter asked for a settings switch.

**Implemented** (4.0.1):
- A **dedicated toggle in the Settings → Views group**: "Add a 'Bookmark this page with vBookmarks' entry to the page right-click menu", on by default. Turning it off removes the entry live (the service worker listens to `chrome.storage.onChanged`, so it takes effect immediately, no cold start needed). It is **independent from the quick-add star button** next to the search box.
- The toggle is **covered by the "Restore the classic header" one-click preset** (turned off together with the command palette, the star, the tool button and the view tabs).
- Two new i18n keys fully translated across 42 locales (missing=0, TODO=0, verify 0 errors).

**Verified**: vitest 45 suites / 1439 cases all green; Docker real-browser probe — the options toggle defaults on, toggles and persists, the classic preset also switches it off, manifest 4.0.1 loads with no page errors.

---

## 附带建议（版本号）· Version numbering note

### 中文

**最终决定：本次发版采用 4.0.1（可接受的静默补丁更新），并重构了版本读取与比较机制。**

- **manifest / package 版本号升到 4.0.1**。按现有捐赠门禁语义（major.minor 粒度），老 4.0 用户升级到 4.0.1 时 `minor` 不变、**不会**弹"新版本发布"卡——正是补丁版想要的静默升级；3.x→4.0.1 跨版本升级（v4 须知）与风险横幅（major 制）均正常。
- **版本机制重构**：新增 `src/version.js`（纯 ESM），统一所有版本读取与比较——
  - `parseVersion` 解析完整 major.minor.patch（缺段补 0）；
  - `compareVersions` / `versionBelow` / `versionAtLeast` 做完整语义比较，**能区分 4.0.1 与 4.0**（补丁级差异可感知）；
  - `sameOrNewerMinor` 保留捐赠门禁的"补丁静默"语义（4.0→4.0.1 不算新版本）；
  - `crossedInto(recorded, current, threshold)` 泛化了"从 X 以下跨到 X 及以上"判断——**以后任何横幅都可以用阈值版本声明"跨进某版本就弹"**（例如跨进 4.1 弹一次），不再局限于 major/minor 硬编码。
  - `neat.js` 捐赠/v4 门禁与 `risk-banner.js` 均改用该模块，行为不变，语义集中。

### English

**Decision: ship this fix as 4.0.1 (an acceptable silent patch update), and rework the version read/compare mechanism.**

- **manifest / package version bumped to 4.0.1**. Under the existing donation gate's major.minor granularity, existing 4.0 users upgrading to 4.0.1 keep the same `minor` — the "new version" donation card is **not** shown, exactly the silent patch upgrade a fix release wants. 3.x→4.0.1 major-crossing upgrades (v4 notice) and the risk banner (major-only) both behave correctly.
- **Mechanism rework**: a new `src/version.js` (pure ESM) centralizes every version read/compare —
  - `parseVersion` parses the full major.minor.patch (missing segments → 0);
  - `compareVersions` / `versionBelow` / `versionAtLeast` do full semantic comparison and **can distinguish 4.0.1 from 4.0** (patch-level differences are observable);
  - `sameOrNewerMinor` keeps the donation gate's "patch is silent" semantics (4.0→4.0.1 is not a new version);
  - `crossedInto(recorded, current, threshold)` generalizes the "crossed from below X to at-or-above X" test — **any future banner can declare a threshold version and gate on it** (e.g. announce once when crossing into 4.1), no longer hardcoded to a major or minor bump.
  - `neat.js`'s donation/v4 gate and `risk-banner.js` both use the module now; behavior is unchanged, the semantics live in one place.
