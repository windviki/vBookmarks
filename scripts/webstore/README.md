# scripts/webstore — 商店发布(Chrome Web Store API V2)

本目录实现发布流程中的「**商店发布**」步骤:通过 **Chrome Web Store API V2** 把打包产物
上传并提交发布到 Chrome Web Store。不包含任何真实凭据。

## 发布流程概念(两步)

```
发布流程 = git发布 + 商店发布
```

| 步骤 | 内容 | 入口 |
|---|---|---|
| **git发布** | 版本跃进 → 双语 changelog → commit → `git tag v<version>` → `python3 scripts/package.py` 本地打包 → push | AGENTS.md「Release process」 |
| **商店发布** | 上传 `tmp/vBookmarks_<version>.zip` 到 CWS + 提交发布审核 | `scripts/webstore/publish.js` |

**商店发布前置校验(默认强制)**:执行前自动检查 git发布 是否已完成——

1. `git` 最大 tag 必须为 `v<manifest.version>`(当前版本已打 tag);
2. 待上传 zip 存在,且其内嵌 `manifest.json` 版本与仓库一致(已重新打包)。

校验不通过即中止(加 `--skip-check` 可跳过,仅用于显式上传草稿等场景)。先 `check` 可离线确认。

> 底层: [chrome-webstore-upload@6](https://www.npmjs.com/package/chrome-webstore-upload) 是 CWS API **V2** 原生封装。
> Google 于 2025-10-15 发布 V2,旧 V1.1 API 将于 **2026-10-15 后移除**;本项目只走 V2,无 V1 存量负担。

## 依赖与运行环境

- Node.js ≥ 20(依赖库要求;仓库当前用 Node 24)。
- 依赖声明在**仓库根** `package.json`(devDependencies: `chrome-webstore-upload` / `undici` / `yauzl`),先执行:
  ```bash
  npm install
  ```
- `scripts/webstore/package.json` 仅声明 `"type": "module"`,把 ESM 作用域限定在本目录
  (根目录的 harness/screenshots 脚本仍是 CommonJS,不受影响)。

## 凭据准备(一次性)

`publish.js` 读取(优先级从高到低):**真实环境变量** → **仓库根 `.env`**(git-ignored)。

需要在 `.env` 追加(git-ignored,绝不入库;`.env.example` 只放占位):

```bash
# 商店发布(CWS V2)凭据 — 见 scripts/webstore/README.md「凭据准备」
CWS_PUBLISHER_ID=            # 开发者账号 ID:Dashboard → Publisher → Settings
CWS_CLIENT_ID=               # GCP OAuth Client(Web application)ID
CWS_CLIENT_SECRET=           # 上述 Client 的 Secret(可留空)
CWS_REFRESH_TOKEN=           # OAuth Playground 换取(scope: chromewebstore)
CWS_TRUSTED_TESTERS=         # 测试用户邮箱,逗号分隔(TRUSTED_TESTERS 灰度用;留空默认 windviki@gmail.com)
```

获取步骤(详见 [官方教程 Use the Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api)):

1. **GCP 项目 + 启用 API**: [Google Cloud Console](https://console.cloud.google.com/) 建项目 →
   APIs & Services → Library → 启用 **Chrome Web Store API**。
2. **OAuth 同意屏**: APIs & Services → OAuth consent screen → External,把**自己的 Google 邮箱**
   加进 Test users → Publish app。
3. **OAuth Client ID**: Credentials → Create credentials → **OAuth client ID** →
   Application type **Web application**,Authorized redirect URIs 加 `https://developers.google.com/oauthplayground`。
4. **换 refresh_token**: [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
   → 齿轮勾选 *Use your own OAuth credentials* 填入上面 → Input your own scopes 填
   `https://www.googleapis.com/auth/chromewebstore` → Authorize → Exchange → 复制 **refresh_token**。
5. **publisherId**: [Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
   → Publisher → Settings(多发布者先切到目标 publisher)。
6. **账号要求**: 必须**开启两步验证**;首次需完成开发者注册(一次性 $5)。

`extensionId` 无需填,`publish.js` 从 `manifest.json` 的 `homepage_url` 自动推导。

## 用法

```bash
# 1) git发布 前置校验(离线,不需凭据)
node scripts/webstore/publish.js check

# 2) 查询当前已发布/待审状态
node scripts/webstore/publish.js status

# 3) 上传(不发布)—— dry-run 默认,加 --yes 执行
node scripts/webstore/publish.js upload --yes
node scripts/webstore/publish.js upload --file tmp/vBookmarks_4.0.2.zip --yes   # 指定包

# 4) 发布(DEFAULT_PUBLISH 提交审核;审核通过自动全量)
node scripts/webstore/publish.js publish --yes

# 5) 上传 + 发布(共用一次 access_token)
node scripts/webstore/publish.js all --yes

# 6) 灰度给测试用户(TRUSTED_TESTERS)—— 版本先给指定测试者,验证通过再恢复全量
node scripts/webstore/publish.js publish --type TRUSTED_TESTERS --yes
#    发布时脚本打印测试用户列表(默认 windviki@gmail.com,可用 CWS_TRUSTED_TESTERS 覆盖)
#    ⚠ 测试者邮箱列表 CWS API 无法代管,须在 Dashboard → Users and permissions
#      → Testers 手动维护(Editor 角色可管理),脚本仅展示列表供核对。

# 7) 从测试用户恢复到所有人(再发一次 DEFAULT_PUBLISH 全量)
node scripts/webstore/publish.js publish --type DEFAULT_PUBLISH --yes

# 8) listing 元信息·取回:公开详情页快照(?hl=en / zh-CN 各一份;凭据齐备时附带
#    官方 item 状态)→ tmp/webstore/listing-current.*.json,并与仓库 extName/extDesc 比对
node scripts/webstore/publish.js listing            # dry-run 打印将抓取的 URL
node scripts/webstore/publish.js listing --yes      # 真正抓取

# 9) listing 元信息·更新草稿(纯离线):名称/简介(_locales extName/extDesc)+
#    详述(docs/README pitch 段)+ What's new(changelog 当前版本节)+ 截图清单
#    (assets/store 逐张核对尺寸规格)→ listing-proposal.{en,zh-CN}.md + .json
node scripts/webstore/publish.js listing-draft
```

## listing 元信息(为什么是「快照 + 草稿」)

**官方 CWS API V2 的 REST 面只有 upload / publish / fetchStatus / cancelSubmission /
setPublishedDeployPercentage —— 没有 listing(名称/简介/详述/截图)的读写端点**
(Dashboard 内部接口也未开放)。因此本目录对 listing 的自动化边界是:

- **取回**(`listing`):抓公开详情页解析 og meta 与页面图片直链,存快照供比对。
  实测(2026-08)详情页无 ld+json、无 itemprop,截图/评分/版本由 XHR 渲染,
  静态 HTML 拿不到 —— 对应快照字段留空,不硬猜。
- **更新**(`listing-draft`):从仓库规范源生成可粘贴的双语草稿,人工核对后
  粘贴进 Developer Dashboard → 包 → Store listing,图片按清单手动上传 ——
  与商店素材「人工挑选、手动上传」同一纪律。规范源改动(改 extDesc、发新版)
  后重跑一次即得最新草稿;线上现值用 `listing --yes` 快照做 diff。
- 若未来 Google 为 V2 开放 listing 端点,接入点就是本文件里已隔离的
  `runListing` / `runListingDraft`(纯函数部分在 `parseDetailPage` / `buildProposal`,
  均有离线单测)。

参数:

| 参数 | 说明 |
|---|---|
| `--file 路径` | 指定要上传的 zip(默认自动选 `tmp/vBookmarks_<version>.zip`;可传相对仓库根或绝对路径) |
| `--type T` | `DEFAULT_PUBLISH`(默认·发布给所有人)· `TRUSTED_TESTERS`(灰度给测试用户)· `STAGED_PUBLISH`(分阶段) |
| `--deploy N` | 灰度百分比(需 >10000 周活用户,V2 免重新审核) |
| `--skip-check` | 跳过 git发布 前置校验(仅限显式上传草稿等场景) |
| `--yes` | 真正执行;否则只 dry-run 打印将执行的请求 |

> **审核注意**: `host_permissions: <all_urls>` + `proxy` 权限是审核高风险点,须在
> Developer Dashboard 的 listing 里说明用途(死链检测需探测任意书签 URL;proxy 是用户自配的
> 死链扫描代理)。2025-08-01 起隐私政策为强制项。详见 `tmp/webstore-publish-plan.md`(调研存档,
> git-ignored)或按需回查官方 [Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)。

## 网络代理

Node 全局 fetch(undici)默认**不读** `HTTP(S)_PROXY` 环境变量。本环境直连 Google API 被墙,
脚本在启动时自动复用 `HTTP(S)_PROXY` 安装 undici `ProxyAgent` 作全局 dispatcher,
`chrome-webstore-upload` 内部的 fetch 即自动走代理(与 `curl` 行为一致)。

## 测试

```bash
npm run test:webstore          # 等价于: node --test scripts/webstore/upload-test.js scripts/webstore/listing-test.js
```

`upload-test.js` 全离线(mock 全局 fetch),验证:
- v6 库对 CWS V2 端点的请求契约(upload/publish/fetchStatus/setDeployPercentage、token 刷新、
  IN_PROGRESS 轮询、`publish('default')` 兼容);
- 打包产物 CWS 结构合规(zip 根含 manifest.json、version 一致、icons 齐全、description ≤ 132);
- 权限清单快照(供审核自查)。

`listing-test.js` 全离线,验证 listing 纯函数:详情页解析(`parseDetailPage`:
ld+json 优先 / og 兜底 / 商店标题后缀剥除 / lh3 图片直链收集)、changelog 节摘取、
README pitch 摘取、PNG 尺寸读取与规格核对、`buildProposal` 双语草稿组装。

## 安全与版本控制约定

- 仓库内所有文件**不得出现真实凭据**;凭据只放 git-ignored 的 `.env` 或 CI secrets。
- `scripts/` 在 `scripts/package.py` 的排除列表中,本目录**不会被打进扩展 zip**。
- 发版流程、命名与更多背景见 AGENTS.md「Release process」与记忆 `release-process.md`。
