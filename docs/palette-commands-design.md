# 命令面板自定义指令设计方案（palette custom commands）

> 状态：**设计稿，未实现**。本文档回答"如何榨干命令面板的价值"——把命令面板从
> 内置启动器升级为**用户可编程的快速入口**。配套文档：
> [keyboard-model.md](keyboard-model.md)（键盘模型）、guide-v4 §2.3（现有命令清单）。
> 实现排期见 §9 路线图；落地时以本文为准回写 guide-v4 与 keyboard-model。

## 1. 背景与现状

v4 命令面板（`src/palette.js`）当前形态：

- **18 条内置命令**，统一结构 `{ slash, aliases, name, fn, keepOpen }`：
  快速操作（`/add` `/new` `/folder` `/session`）、视图直达（`/tree` `/search` …
  slash 别名即视图 id）、主题五连（`/themeauto`…`/themepaper`）、开关
  （`/tabs` `/path`）、`/options`。
- **两种查询模式**：`/` 前缀 = 指令模式（首词匹配 slash 名，余词作为
  `slashRest` 传给 `fn`——参数通道已经存在，`/search foo` 即在用）；
  普通查询 = 模糊匹配书签/文件夹 + 桥接行进搜索视图。
- 权限家底（manifest.json）：`bookmarks` `tabs` `tabGroups` `storage`
  `alarms` `clipboardWrite` `scripting` + `<all_urls>` host；`history` 可选。
  **没有 `sessions` 权限**——`/session` 的会话快照本来就是落成书签文件夹
  （`src/session.js`），这恰好是"URL 组"的天然载体。

结论：面板的**分发与参数通道已经完备**，缺的是让用户往 `commands` 数组里
注册自己的条目。自定义指令 = 数据驱动的第 20+ 条命令，不是新子系统。

## 2. 目标与价值定位

| 用户场景 | 今天的路径 | 有自定义指令后 |
|---|---|---|
| 每天上班开同一组 5 个页面 | 找到文件夹 → 右键 → 打开全部 | `/work` 回车 |
| 常用深层 URL（内部控制台等） | 书签树里翻 / 面板模糊搜全名 | `/ops` 直达（别名比标题短而稳） |
| 周期性清理 | 进重复视图 → 选策略 → 应用 | `/clean` 一条到位（带去重预设） |
| 站点内搜索 | 开引擎 → 输关键词 | `/g kimi code`（参数化模板） |
| 会话恢复 | 面板 `/session` 只能存，恢复要翻书签 | `/restore 昨晚` 打开快照文件夹 |

定位一句话：**书签是数据，自定义指令是数据的快捷键**——面板由此从"找书签"
变成"执行意图"。

## 3. 数据模型

新增一个设置键 `paletteCustomCommands`（数组，默认 `[]`）：

```js
{
  id: 'cc_<timestamp36>',        // 内部稳定 id，删除/排序用
  name: '开工作台',               // 面板行显示名（可被 i18n 之外的任意语言）
  slash: 'work',                 // 主 slash 名，小写字母/数字/连字符
  aliases: ['w', 'morning'],     // 可选，附加 slash 名
  action: { type: 'open-url-group', folderId: '357' },
  createdAt: 1722500000000,
  useCount: 0,                   // §7 排序加成
  lastUsedAt: 0
}
```

- **存储与同步**：写入 `chrome.storage.local` 镜像（store.js 既有机制），并把
  `paletteCustomCommands` 加入 `SYNC_KEYS` 跨设备同步。注意 sync 配额
  （单键 8KB、总量 100KB 量级）：URL 组动作只存 `folderId` 不存 URL 本体，
  单条指令正常 <300B，**上限设为 100 条**（约 30KB，安全），选项页显示用量。
- **校验**（创建/导入时）：`slash` 必填且匹配 `/^[a-z0-9][a-z0-9-]{0,23}$/`；
  `name` 必填（缺省回退 slash）；`action.type` 必须在白名单内（§4）。

## 4. Action 类型分层

按实现成本与价值分三层。**白名单制**——数据里只允许下列 type，杜绝任意代码
执行（CSP 也不允许 eval）。

### Tier 0 — MVP（第一版就做）

| type | payload | 行为 | 复用 |
|---|---|---|---|
| `open-url` | `{ url, where: 'current' \| 'tab' \| 'window' \| 'background' }` | 打开指定 URL（别名直达） | `actions.openBookmark*` 四兄弟 |
| `open-url-group` | `{ folderId, where? }` | 打开书签文件夹内全部 URL（URL 组） | actions 现有"打开文件夹全部"路径 |
| `view-preset` | `{ view: 'dupes', strategy?, scope? }` / `{ view: 'dead', scan: true }` | 带预设直达视图：如 `/clean` = 进重复视图并预选 strategy=keep-newest + scope=全局 | `views.activate` + 视图自身预设参数（需小幅扩展 activate 签名） |

`open-url-group` 用**书签文件夹**当组，是刻意设计：组内容用户用既有树视图
就能维护，会话快照（`/session` 产物）天然是可打开的组——"恢复昨晚的会话"
零新增概念。

### Tier 1 — 参数化与批量（第二波）

| type | payload | 行为 |
|---|---|---|
| `url-template` | `{ template: 'https://google.com/search?q=%s', where? }` | 参数化命令：`/g kimi code` → 替换 `%s` 打开。slashRest 通道现成；模板必须含且仅含一个 `%s`，无参数时打开 `%s` 为空的主页形态或直接打开模板去掉 `%s` 的 origin（创建时声明 `fallback: 'origin' \| 'prompt'`） |
| `bookmark-batch` | `{ op: 'dead-scan' \| 'dedupe-apply', scope: 'all' \| folderId, preset? }` | 批量操作：`/scan` 全局死链扫描、`/dedup` 按预设策略直接应用去重（需确认对话框，破坏性操作不静默） |
| `tab-batch` | `{ op: 'close-dupes' \| 'close-domain', domain? }` | 超出书签范围的第一步：关重复标签、按域关标签（`tabs` 权限已有） |

### Tier 2 — 组合与生态（远期，先留接口）

- `macro`：`{ steps: [action, action, …] }` 顺序执行（如：存会话 → 关全部标签）。
  数据模型上 action 允许嵌套数组即可，UI 后补。
- 导入/导出 JSON（选项页一组按钮），配合 §6 的分享。
- `chrome.alarms` 定时触发（"早 9 点打开工作组"）——价值存疑，放最后。A：先不做

### 明确不做

- **不执行任意脚本/URL scheme**：只允许 `https?://`（`open-url`/`url-template`
  在保存时校验；`javascript:` `data:` `file:` 直接拒绝）。这是安全红线。
- 不做跨扩展调用、不做 native messaging。

## 5. 与内置命令的共存裁决

1. **命名冲突**：内置命令的 slash 名与别名是保留字（`add` `new` `folder`
   `session` `tree` `search` … 完整清单由 palette.js 导出常量），创建/改名
   时撞车 → 表单红字拒绝。自定义之间不允许 slash 或别名互撞（大小写不敏感）。
2. **排序**：面板行 = 命令区（内置 + 自定义合并，按匹配度排）→ 书签/文件夹区
   → 桥接行，结构不变。`useCount` 给自定义命令加分（§7），让它们越用越靠前。
3. **视觉区分**：自定义命令行 slash 列照常显示，右侧加一个小 "custom" 标记
   （CSS class `palette-custom-tag`），右键（或 `→`）弹出的上下文菜单带
   **编辑 / 删除**两项——管理入口之一就长在面板上。
4. **Esc/键盘模型**：零改动——自定义命令就是普通命令行，selection、
   `scrollIntoView`、keepOpen 语义全部继承。

## 6. 管理 UI

两个入口，一主一辅：

- **选项页新组 "Command palette / 命令面板"**（第 10 组）：自定义指令列表
  （每行：slash、名称、动作摘要、编辑/删除）+ "新增指令"按钮。编辑用对话框
  （复用 dialogs.js 的 ConfirmDialog 样式体系）：名称、slash、别名（逗号分隔）、
  动作类型 `<select>` + 按类型切换的参数表单（URL、目标位置、文件夹选择器、
  模板……）。文件夹选择器复用"快速收藏目标文件夹"那套树形下拉。
- **面板内快捷创建**：普通查询无命中时，桥接行下方追加一条
  "把 `<query>` 存为指令…"（仅 slash 模式无命中时也出现）——点了直接弹出
  上述编辑对话框并预填 slash=query。这是把"查不到"转化为"可定义"的关键闭环。

## 7. 排序、统计与修剪

- 每次执行自定义命令：`useCount++`、`lastUsedAt=now`（走 store 镜像，
  200ms 防抖现成）。
- 排序分 = 前缀匹配权重 + `min(useCount, 50)` 加成；内置命令保持现状
  （不参与计数，避免既有肌肉记忆漂移）。
- 选项页列表按 `lastUsedAt` 倒序可选，方便用户发现"从没用过"的死指令并删除。

## 8. 边界与风险

| 风险 | 对策 |
|---|---|
| sync 配额爆掉 | 100 条上限 + 选项页显示用量条；超限拒绝新增并提示 |
| 用户删掉被引用的文件夹 | 执行时 `folderId` 查不到 → toast 提示"指令失效，是否删除？"（复用 AlertDialog 体系） |
| URL 模板被填成 `javascript:` | 保存校验只允许 `https?://` 模板；`%s` 必须出现一次 |
| i18n | 管理 UI 文案走 _locales 常规流程（新增约 25 键）；用户自定义的 `name` 原文存储不翻译 |
| 键盘模型 | 无新键位；`→` 上下文菜单遵循 keyboard-model §6 |
| 破坏性批量操作 | `bookmark-batch` 的 dedupe-apply 必须先弹确认（与死链/去重视图同一 ConfirmDialog） |

## 9. 路线图

- **阶段 1（MVP）**：数据模型 + 选项页管理组 + Tier 0 三种 action + 面板执行
  与 custom 标记 + useCount 排序。验收：`/work` 打开组、`/ops` 别名直达、
  `/clean` 带预设进重复视图；选项页 CRUD 全套；sync 生效。
- **阶段 2**：Tier 1（url-template 参数化、bookmark-batch、tab-batch）+
  面板内"存为指令"闭环 + 失效指令处理。
- **阶段 3**：macro、导入导出、（可选）alarms 定时。

每阶段都需补：vitest 单测（数据校验、排序、冲突裁决）、verify-keyboard 断言
（自定义命令行的 ↑↓/→ 行为）、guide-v4 §2.3 回写、选项页实拍图。

## 10. 开放问题（实现前需拍板）

1. `open-url-group` 是否提供 "background 全部后台打开" 选项？（一次开 10+
   标签前台抢焦点体验差，倾向 where 默认 background。） A：提供
2. 自定义命令要不要支持 emoji 图标前缀（面板行视觉）？A：低成本高辨识度，做。
3. `view-preset` 的视图预设参数是 activate 签名扩展还是 view-manager 增加
   `activateWith(view, preset)`？A：倾向前者加可选第二参。
4. 内置命令是否允许用户"改名/禁用"（完整自定义）？倾向阶段 3 再说，
   保留字机制已能保证不撞车。A：暂时不做
