# #53 / #57 — Chrome 重启后被禁用（与 iGuge 冲突）· Disabled on every Chrome restart (iGuge conflict)

## 结论 · Conclusion

**冲突根因已定位并核实**：下载并解包了 Chrome 商店在售的 **iGuge CRX v2.3.9**（`ncldcbhpeplkfijdhnoepdgdnmjkckij`）分析。iGuge 是一个代理/加速类扩展，其 service worker 启动时会自动枚举所有已启用扩展，凡是**声明了 `proxy` 权限**、且不在其白名单中的扩展，都会被它调用 `chrome.management.setEnabled(id, false)` **主动禁用**。

**vBookmarks 因死链代理通道功能必须声明 `proxy` 权限**（Chrome 不允许把 `proxy` 列入 `optional_permissions`，只能安装时声明），恰好命中该规则。每次 Chrome 重启、iGuge 的 service worker 被唤醒时都会再次禁用 vBookmarks——表现为"每次重开 Chrome 插件都被禁用"。禁用 iGuge 后无人再执行该逻辑，vBookmarks 恢复正常，与用户反馈完全吻合。

**Root cause, verified**: I downloaded and unpacked the store-shipped **iGuge CRX v2.3.9** (`ncldcbhpeplkfijdhnoepdgdnmjkckij`). iGuge is a proxy/acceleration extension whose service worker, on startup, enumerates all enabled extensions and **actively disables** any one that declares the `proxy` permission and is not on its whitelist — via `chrome.management.setEnabled(id, false)`.

**vBookmarks must declare `proxy`** for its dead-link proxy channel (Chrome does not allow `proxy` in `optional_permissions`; it is install-time required), which puts it squarely in that rule. iGuge's service worker re-wakes on every Chrome restart and re-disables vBookmarks — hence "disabled on every restart". Disabling iGuge stops the logic and vBookmarks stays enabled, exactly as reported.

---

## 证据 · Evidence（iGuge v2.3.9 解包源码）

`js/iggservice.js`，service worker 启动 `init_config()` 回调即调用 `check_proxy_permissions()`：

```js
// js/iggservice.js:446
function check_proxy_permissions() {
    chrome.management.getAll(function (ExtensionInfo) {
        ExtensionInfo.forEach(check_clash_app);
    });
}
// js/iggservice.js:455
function check_clash_app(ExtensionInfo) {
    if (ExtensionInfo.id != chrome.runtime.id
        && typeof ExtensionInfo.permissions !== "undefined"
        && ExtensionInfo.permissions.indexOf('proxy') !== -1
        && ExtensionInfo.enabled === true
        && ExtensionInfo.id !== chrome.runtime.id) {
        if (!iggcfg.mzk_config.proxy_permissions_namewhilelist.includes(ExtensionInfo.name))
            chrome.management.setEnabled(ExtensionInfo.id, false);   // ← 主动禁用
    }
}
```

白名单 `proxy_permissions_namewhilelist` 默认仅 `["IDM Integration Module"]`（`js/iggservice.js:41`），且会被其服务端远程配置覆盖（`js/iggservice.js:141-142`、`720-721`，服务端字段 `data.proxy_namewhilelist`）。vBookmarks 的扩展名 `vBookmarks` 不在其中。

另有 `js/main.js` 的 `fix_proxy_permissions()`/`disable_clash_app()`：用户在 iGuge 里点击"自动修复"时，会禁用**所有**带 `proxy` 权限的其它扩展（连 Tampermonkey 也会被禁用）；`js/helper/tracket.js` 会把其它带 `proxy` 权限的扩展列表上报其服务器，用于白名单研判。

相关事实：

| 项 | 值 |
|---|---|
| vBookmarks 商店 ID | `odhjcodnoebmndcihdedenkmdmklpihb` |
| vBookmarks 扩展名 | `vBookmarks` |
| vBookmarks `proxy` 权限来源 | v4 死链扫描"用户自有代理双通道"；git 提交 `0c0ca3b` 因 Chrome 限制由可选权限改为安装时声明 |
| iGuge 商店 ID | `ncldcbhpeplkfijdhnoepdgdnmjkckij` |
| 分析所用 iGuge 版本 | 2.3.9 |
| iGuge 主页 | http://iguge.net |

vBookmarks 对 `proxy` 的使用是**非侵入式**的：仅死链扫描时临时安装一个"只路由带 `__vbm_px=1` 标记探测 URL"的 PAC（`src/dead-proxy.js`），扫描结束/取消/弹窗关闭即拆除，从不改动用户其它网页的流量路径。

---

## 处理方向 · Resolution

**保留死链代理特性，协调 iGuge 加入白名单**。vBookmarks 侧不改功能代码（`proxy` 权限为安装时必需，删除即失去该特性；Chrome 不允许其作为可选权限，故无"按需授予"中间态）。

**Keep the feature and coordinate with iGuge for whitelisting.** No functional code change on vBookmarks' side (`proxy` is install-time required — Chrome rejects it in `optional_permissions`, so there is no "grant on demand" middle state).

### 受影响用户怎么处理 · What affected users can do

1. 重新启用 vBookmarks：`chrome://extensions` → 找到 vBookmarks → 重新启用。（禁用是 iGuge 每次启动主动执行的结果，与权限弹窗无关。）
2. 向 iGuge 反馈，请其把 `vBookmarks` 加入 `proxy_permissions_namewhilelist` 白名单（iGuge 本身通过意见反馈/`tracket` 收集其它代理扩展清单并维护该白名单，属官方支持路径）。可选渠道：
   - iGuge 扩展内"意见反馈"入口（提交内容会携带当前已安装的代理扩展列表）
   - iGuge 主页 http://iguge.net 的客服/反馈
   - Chrome 商店该扩展的"支持/Support"标签页
3. 临时禁用 iGuge，或改用不主动禁用其它扩展的代理工具。

1. Re-enable vBookmarks: `chrome://extensions` → vBookmarks → Enable. (The disable is iGuge re-running its check on each startup, unrelated to any permission prompt.)
2. Ask iGuge to whitelist `vBookmarks` in `proxy_permissions_namewhilelist` (iGuge already collects the installed proxy-extension list via its feedback/`tracket` and maintains this whitelist server-side — a supported path). Channels: the extension's own feedback entry, http://iguge.net, or the Web Store "Support" tab.
3. Temporarily disable iGuge, or switch to a proxy tool that does not actively disable other extensions.

### 发给 iGuge 的白名单申请 · Draft request to iGuge

> **Subject**: Please whitelist the "vBookmarks" extension in `proxy_permissions_namewhilelist`
>
> Hello, we're the developers of the **vBookmarks** Chrome extension (ID `odhjcodnoebmndcihdedenkmdmklpihb`). Your extension (`ncldcbhpeplkfijdhnoepdgdnmjkckij`) disables vBookmarks on every browser restart, because your service worker's `check_clash_app()` disables any enabled extension that declares the `proxy` permission and is not on your `proxy_permissions_namewhilelist`.
>
> vBookmarks only uses `chrome.proxy` for its dead-link scan: while a scan runs it installs a temporary PAC that routes *only* the scanner's marker-tagged probe URLs (`__vbm_px=1`) through the user's own proxy; everything else stays DIRECT, and the setting is removed the moment the scan settles/cancels or the popup closes. It never sets a browser-wide proxy for normal traffic, so it cannot conflict with iGuge's proxy control.
>
> We'd be grateful if you'd add `vBookmarks` to the whitelist. Happy to provide any further detail.

---

*结论核验日期：2026-08-12 · 核验方式：Chrome 官方更新接口下载并解包商店在售 CRX*
