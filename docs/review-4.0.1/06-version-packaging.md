# 审阅报告 06:版本机制重构 + 4.0.1 静默补丁 + #49 + 打包修复

> 所有验证均为实跑证据(打包实跑 + zip 闭包比对 + 153 例相关测试实跑全绿)。审阅日期:2026-08-07。

## 审阅要点逐项结论

**1. version.js 语义** — 与 changelog 声明一致:
- 4.0→4.0.1:`sameOrNewerMinor({4,0,0},{4,0,1})` = true → `newOrUpgrade=false` → 不弹卡 ✓(`tests/version.test.js:74` 锁定)
- 3.x→4.0.1:`crossedInto(3.x, 4.0.1, V4)` = true → `#v4-notice` 钉上卡片 ✓(`src/neat.js:208`)
- 4.0→4.1:patch 静默、minor 晋升弹"新版本"卡(无 v4 notice)——与 docs/issues/issues-46-48-feedback.md:151 声明一致
- 边界:空存储走 `neat.js:200` fresh 分支只记录不比较;garbage → `parseVersion` 返 null → 跳过比较;`"4.0.1.99"` 第 4 段丢弃(有测试)。旧比较点迁移干净——全 src grep 无残留手写扩展版本比较(`neat.js:58` 是 Chrome 浏览器 UA 版本,`options.js:242` 仅备份元数据,均正确不迁移)。

**2. risk-banner MAJOR 门** — "4.0 已 dismiss → 4.0.1 不重弹 ✓、5.0 重弹 ✓" 成立;但 **4.1 不重弹**(见问题 1)。

**3. #49** — 创建/移除时机:SW 顶层调用 + `onInstalled` + `storage.onChanged` 实时生效(`src/background.js:260-265`);options 页 `setSetting` 直写 `chrome.storage.local`(`src/store.js:287`),链路闭环。与 `quickAddEnabled` 键分离彻底(`neat.js:694` 只读星标键)。经典预设覆盖(`src/options.js:120` + `tests/options.test.js:402-417`)。Views 组放置合理(`pages/options.html:46`,紧邻星标/工具按钮)。

**4. #46/#47** — #46 根治:`classList.contains` 成员测试,两种渲染点 `search.js:495`、`palette.js:364` 均为 `link-folder tree-item-link`,全库再无 `className ===` 精确匹配;handler 顶部有 `preventDefault`(`tree-view.js:394`),`href=""` 不会自导航。#47:`.row-badge.time` 解除药丸几何 + scrollbar-contract 测试锁定 ✓。

**5. package.py** — 实跑 `python3 scripts/package.py`:107 文件/692.2 KB,无 WARNING。独立闭包验证(manifest SW + 4 个 HTML 的 script/link 标签 + 递归 import,含 `import(` 形式):46 个 JS 模块、全部 CSS **无一漏网**;`src/*.js` 全部可达且全部入 zip。`src/dropdown.js` 不在 JS_FILES 但被递归解析带入——机制确有实效。re-export 经 `from` 匹配 ✓。

**6. 版本同步** — manifest 4.0.1 = package.json 4.0.1 ✓(此前 package.json 滞留 3.7.0,本次顺带修正)。donation 卡 4.0.1 行为:存量 4.0 用户静默 ✓;3.x 升级用户见 v4-notice ✓。

相关测试实跑:`version/risk-banner/background/options/tree-view/scrollbar-contract` 6 套件 153 例全绿。

## 编号问题清单

1. **[中·语义确认] risk-banner 对 4.1 不重弹** — `src/risk-banner.js:28`。代码注释、`tests/risk-banner.test.js:62-71`、反馈文档三处一致声明 MAJOR-only(4.0→4.1 不重弹,5.0 才重弹),与审阅要点预期"4.1 重弹一次"不符。若产品意图是 minor 也重弹,需改用 `crossedInto` 阈值门;若 MAJOR-only 是设计,无需改动——需定夺。
   - **解决(2026-08-08)**:所有者定夺推翻 MAJOR-only——自 4.0.1 起 ack 门为 major.minor(patch 静默,major/minor 晋升重弹),`src/risk-banner.js` 已改用 `sameOrNewerMinor` 实现,`majorOf` 已从 `src/version.js` 移除。

2. **[低] #49 快速连切的 remove/create 竞态** — `src/background.js:245-258`。两次 onChanged 紧邻时,先发的 `storage.get` 回调读到旧值:on→off 快切可能在最终 off 状态下重新 create(菜单残留至下次 SW 冷启动自愈);双 on 时 `create` 撞 duplicate id(unchecked error)。修法:onChanged 分支直接读 `changes.quickAddContextMenu.newValue` 判定,免去二次异步 get。

3. **[低] parseVersion 注释与实现不符** — `src/version.js:13` 称 manifest 版本为 "1.4 dot-separated integers",但正则只取 3 段,`4.0.1.99` 的第 4 段静默丢弃,`compareVersions` 无法区分 4.0.1 与 4.0.1.99。当前无影响(本扩展 ≤3 段),建议注释明确"第四段忽略"。另 `"4.0-beta"` 类串会被静默解析为 {4,0,0}(正则未 `$` 锚定)——Chrome schema 不允许,仅文档化缺口。

4. **[低] IMPORT_RE 不覆盖动态 import** — `scripts/package.py:240`:`(?:from|import)\s+['"]` 不匹配 `import('./x.js')`(`\s+` 遇 `(` 失败)。当前 src 无动态 import(grep 证实),属潜伏缺口——一旦引入即回到"漏模块静默坏包"老路。修法:正则加 `import\s*\(\s*['"]` 分支。

5. **[低] 打包入口种子仍手工维护** — `scripts/package.py:39-85`。递归解析只覆盖"已打包模块的 import 目标";只被 HTML `<script src>` 引用的新入口若忘加 JS_FILES 仍会漏(仅 `verify_no_strays` WARNING 兜底,不 fail 构建)。CSS_FILES 同理。建议从 pages/*.html script 标签自动收集种子,或 strays 警告升级为非零退出。

6. **[提示] tree-view.js:405 注释过度声明** — 注释称覆盖 "palette folder rows",但 palette 未绑定 bookmarkHandler(自有激活逻辑)。功能无影响,注释易误导。

7. **[提示] donation 门无集成测试** — 仅 version.js 纯函数有测试;`neat.js:200-211` 接线无锁定。注意 fresh install 时 `currentVersion` 空 → `newOrUpgrade` 保持 true → 首次打开即弹卡(7fea4d1 既有行为,非本次回归),与 `neat.js:219-221` 的"30 次宽限"注释并存易误读。

## 缺口清单

- 动态 `import()` 的打包覆盖(问题 4)
- HTML 入口种子的自动收集 / strays 硬失败(问题 5)
- neat.js donation/v4-notice 接线的集成测试(问题 7)
- parseVersion 边界行为(第 4 段、预发布后缀)的文档化(问题 3)
- 工作区未提交改动 `css/neat.css`(#search `margin: 0 0 4px` → `2px`),提醒知悉(见报告 07 的评估:保留,建议微调为 `margin: 2px 2px 4px`)
