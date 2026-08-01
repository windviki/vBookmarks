# Browser compatibility evaluation (v4, task-4 #12)

How portable the vBookmarks package is beyond Chrome, and what
`scripts/package.py --target` does with that.

## Chrome (baseline)

`--target chrome` (default) → `tmp/vBookmarks_[ver].zip`.
Everything is developed and verified against Chrome MV3
(`minimum_chrome_version: 114`).

## Microsoft Edge — same package, install as-is

`--target edge` → `tmp/vBookmarks_edge_[ver].zip` (byte-identical content;
the distinct name only keeps store uploads apart).

Edge is Chromium MV3, so the whole API surface the extension touches is
present:

- `side_panel` manifest key / `chrome.sidePanel` — supported since Edge 114,
  which lines up exactly with our `minimum_chrome_version: 114`.
- `tabGroups`, omnibox, `chrome.proxy` (PAC), the `/_favicon/` endpoint,
  module service workers — all shared with Chrome.
- `chrome.action.openPopup` (Chrome 127+) is feature-detected
  (`background.js`), so on an older Edge the palette falls back to the
  popup window instead of erroring.

One behavioural footnote, by design (v4 task-4 #10): on Edge the view
switcher uses **Alt+1…9** because **Ctrl+1…8 stays reserved for the
browser's own tab switching**. The portable Alt binding works everywhere,
including Chrome.

## Firefox — not packageable without a build step

`--target firefox` prints this summary and exits 1; there is no zip to
produce. The blockers, in order of how fatal they are:

1. **Module service worker.** `manifest.json` declares
   `"background": {"service_worker": "src/background.js", "type": "module"}`
   and the code uses real `import` statements. Firefox MV3 only accepts
   classic (non-module) background scripts, and its service-worker support
   is still event-page based. This alone requires a bundler pass
   (esbuild/rollup) to flatten the module graph into one classic script.
2. **`side_panel` / `chrome.sidePanel`.** Firefox's equivalent is
   `sidebar_action`, a different manifest key with a different API
   (`browser.sidebarAction.open()`), and it cannot be combined with
   `chrome.sidePanel` calls in one codebase without an abstraction layer.
3. **Tab groups.** `chrome.tabs.group` / `chrome.tabGroups` (used by
   "open folder as a tab group") have no Firefox equivalent; the code's
   feature-detect (`actions.js`) already degrades to a plain batch-open,
   so this one is survivable.
4. **`/_favicon/` endpoint.** Chrome-only; Firefox has no built-in favicon
   endpoint for extensions. Every favicon `<img>` would need a fallback
   (letter tiles already exist for exactly this case).
5. **`chrome.proxy` PAC hook.** The dead-link scanner's marker-PAC
   (`dead-proxy.js`) relies on `chrome.proxy.settings`; Firefox's proxy
   API differs (`browser.proxy.onRequest` instead of PAC settings), so the
   dead-link scan fallback path would need a rewrite or a degrade.
6. Smaller gaps: `chrome.action.openPopup` (already feature-detected),
   the `favicon` permission key, and `minimum_chrome_version` (ignored by
   Firefox, which wants `browser_specific_settings.gecko`).

A future Firefox port is therefore a bundling + feature-degrade project
(bundle background.js to a classic script, map `side_panel`→
`sidebar_action`, rely on the existing tab-group/favicon fallbacks,
degrade the dead-link proxy hook), not a packaging flag. It is also
unverifiable in the current dev environment, which has no Firefox.
