# vBookmarks 4.2 — the tag system, new interactions & the velvet visual language

> [中文版](guide-4.2.zh.md) | Applies to 4.2.x (Chrome 114+).
> Covers: the brand-new tag system, the operation methods 4.2 introduces, and the design language the extension now wears. The base v4 model — the seven views, the full keyboard grammar, the palette — lives in the [v4 guide](guide-v4.md); read that first if you're new, this supplement only covers the delta.

The answer to Chrome, extensions and bookmarks is 42 — and 4.2.0 is where vBookmarks cashes the joke in. This release brings a **brand-new tag system** (grown into one workbench with the search view) and rebuilds the surface layer ("velvet"): a real theme system over one color-temperature token chain, and a standalone window grown into a desktop workbench with drag & drop that crosses window boundaries. Same engine, same keyboard grammar — one more organizing dimension, new clothes, a bigger desk.

## Contents

1. [A brand-new tag system](#1-a-brand-new-tag-system)
2. [The standalone workbench](#2-the-standalone-workbench)
3. [Drag & drop across windows](#3-drag--drop-across-windows)
4. [Surfaces graded by display area](#4-surfaces-graded-by-display-area)
5. [Stats learns dwell time](#5-stats-learns-dwell-time)
6. [The velvet visual language](#6-the-velvet-visual-language)
7. [Coming from 4.1.x](#7-coming-from-41x)

---

## 1. A brand-new tag system

A folder holds a bookmark once; a tag lets it belong to *work*, *reading* and *later* at the same time. The 4.2 tag system is a **colored organization layer across folders** — nine colors taken from Chrome's own tab-group palette, constant across every theme — grown into one workbench with the search view: the search box is both a search box and the first scene of the tag language.

### Tagging is always within reach

- **Right-click any bookmark** → the tags flyout lists every tag; one click tags or untags.
- **The hover tag-add button** on search and staging rows, revealed as the pointer passes the row tail.
- **Batch tagging in selection mode**: select a set of rows, one tag action covers the batch.
- **Create tags in-place in the picker**: type a new name while picking and the *＋ new* row appears, auto-colored.
- **Save-time tagging**: the quick-add star (or `Ctrl/Cmd+D`) saves the page as before — the confirmation toast now carries an **Add tags…** action that opens the tag picker for the fresh bookmark. Organize at the moment of filing, zero second-pass cleanup. Don't click it and the flow is byte-identical to before.
- **The standalone inspector**: the right-hand details panel's tag section gives every chip a hovering × to remove and zero-tag rows an always-visible add button.

The new-tag dialog gains a **Save & continue** button — the tag commits with its name and chosen color, the name clears, the color stays selected and the dialog stays put for the next one. Build a batch of tags without reopening anything; a rejection (duplicate name / the 100-tag cap) keeps the typed name in place with the reason inline.

### `#` — the tag language inside the search box

Type `#` in the search box to summon the **tag suggestion panel**: autocomplete over names; click or Enter completes a token. From there:

- `#work #reading` tokens **intersect**; `-#work` **excludes**; `#!` lists bookmarks with **no tags at all**.
- Tag tokens AND freely with the field tokens: `#work site:github.com` is one query.
- Active tokens ride the results toolbar as removable **× chips**; every result set carries a **"Narrow further:"** strip of its co-occurring tags — one click appends another AND leg, parked right under the count bar where you're already looking.
- A `#tag` member query's group head carries a **mark all shown / unmark all** pair of directional buttons — one gesture over the whole result set.
- A bare palette `/tag` lists your tags with counts, Enter runs the member query; the `#` panel's footer action bar (view all / new tag / manage tags) is arrow-reachable and Enter-activated — the whole panel stays pure-keyboard.

The search view's **idle face** is the tag workbench: a **hot-tag rail** on top (top-8 recommendations, overflow gathered into a +N badge, an *Add tag* entry at its right end; with zero tags it's a guide row straight to creating your first) above the foldable recent-searches list. The tags you click most are the ones at hand.

### Tags on the row, and how they look

Each row's tags render in one of **six display styles** — soft-tint pill (the default), solid pill, outlined pill, `#`-text, dot, off — switched globally in the options. Overflow folds into `+n`, and clicking it **expands in place on that very row** (every chip plus a `−` toggle; Esc folds too). Row chips mean the same thing everywhere: **click a tag to run its `#tag` member query** — tree, search, staging, stats, dead links, duplicates and the tab-groups view, no exceptions. Want one row quiet without touching the tag? The per-row *hide this tag on this row* mask exists for exactly that.

### The tag manager page

Right-click a tag (or the `#` panel's *manage tags*) for the master–detail manager: the left-hand tag list — WYSIWYG pills exactly as rows render them, live counts, per-tag show gates — drives a member panel with bulk re-assignment, open/copy and per-member hide switches. **Rename with merge-on-conflict**, recolor, pour a whole folder into a tag, Raindrop `#tag` interop import/export, and a full reset. Deleting a tag snapshots the assignment map before writing on every path — **undo replays it exactly**; all four delete paths share the one safety net.

### Cross-device by design

Tags ride bookmark guids and sync through `chrome.storage.sync`. On Chrome builds without per-node guids (< 138) tags stay strictly local, and a promotion path carries them into the sync tier the moment the browser upgrades — no silent loss, no cross-device misattribution. A one-time notice appears if a write ever exceeds the storage quota; the local mirror keeps working.

## 2. The standalone workbench

The standalone window — previously a thin pop-out of one view — is now a full workbench in the chrome://bookmarks / Raindrop layout language.

**Four ways in:**

- The header's pop-out button on any view (turn it off with `showStandaloneButton`).
- The palette: `/open` (alias `/standalone`).
- Directly by URL: `pages/standalone.html?view=…`.
- A **custom command** with the new *open the standalone workbench* action — pick the view it boots on and where it opens (tab / window / background), like every other custom command.

**What's different once you're in:**

- **A labeled left navigation rail** replaces the top tab strip — all seven views with their names, sliding indicator, automatic RTL mirroring. The wide window finally has room for words.
- **Three surfaces, three memories**: the popup, the side panel and the standalone window each remember their own last view. Burying the standalone window on *Duplicates* no longer yanks your popup off *Tree*.
- **New bookmark / New folder** buttons sit in the header, aimed at the folder the tree is focused on (falling back to your quick-add root). Dialog-first: cancel builds nothing.
- **The wide-canvas dual column.** The canvas steps up through 1200 / 1480 px automatically (or pin it wide / full-bleed in the standalone preferences). On a wide window, a second column pins the **staging view** permanently on the right: browse any view on the left, drag tree rows straight across the gap onto it — or use the selection toolbar's *Send to staging* — and the pane updates live for bulk filing. The column's width is drag-adjustable and it collapses away when you don't need it.
- **The window title follows the view** you're on, so a taskbar glance tells you which desk you're at.
- **A Home dashboard** joins the rail: the day's greeting, one-tap 新建/暂存/死链扫描 actions, four counter cards (bookmarks / staging inbox / dead links / duplicates — the same numbers the rail badges use), and the newest bookmarks as ordinary rows. Make it the landing view from the standalone preferences if you like.
- **Three row forms for the central column.** The header's **mode menu** (the current mode's icon) lists **list / compact / cards** explicitly — modes unavailable for the current view grey out, so "which view speaks which form" is visible at a glance: compact keeps one-line titles at a 28px beat; cards re-flow the flat lists (staging / recently added / Home) into a favicon-card grid — same rows, same hover buttons, same keyboard walk, only the geometry changes. Views whose rows carry toolbars (stats / dead / duplicates / tab groups) and the structural tree & search keep their own form — the mode clamps per view.
- **A Details inspector for the right column.** The header's `[Staging | Details]` switch (or the palette's `/inspect`) re-rents the wide window's right pane: it follows whatever row has focus — tree row, search hit, staging card — and shows the full picture: big favicon, path breadcrumb, tag chips (click one to run its `#tag` search), visit count, total dwell time, dead-link verdict and staging state, with 打开 / 复制 / 编辑 / 打标签 / 送暂存 / 删除 one click away. Every action goes through the same dialogs, confirmations and undo toasts you already know — the panel never writes behind your back.

The keyboard follows the layout, not the other way round: the Tab ring gains a dock at the pinned staging column, and the arrow keys treat the two columns as one continuous space (the full adaptation matrix lives in `docs/keyboard-model.md`).

## 3. Drag & drop across windows

4.2 moves the side panel and the standalone window onto the **native HTML5 drag pipeline**, and a native drag session is the one thing that crosses window boundaries:

- **Tree ↔ tree**: drag a row from the side panel's tree to the standalone window's tree (or back) — the bookmark moves, and the source window refreshes itself. Same zone laws as inside one window (the decision core is shared between both pipelines).
- **Links from anywhere**: drop a URL dragged out of any page, any window, onto the **staging pane** and it lands in the inbox bucket as an unbookmarked staging row — the desk is a drop target for the whole browser. Drop it on the **tree** instead and it becomes a real bookmark created at the drop position (http/https only; drag sources polite enough to carry a title pass it along).
- **Tabs across windows**: drag tab rows between two *Tab groups* views open in different windows — the tabs move between windows. Two facing tab-groups views are now a way to re-balance your session by hand.

## 4. Surfaces graded by display area

One codebase, three bodies: the **popup** stays a compact 320 px glance; the **side panel** is the always-on companion; the **standalone window** is the desk. The view tab strip now grades with the body:

- Popup & side panel pin the four *companion* views — Tree / Search / Tab groups / Staging — and tuck Stats / Dead / Duplicates behind a trailing `⋯` whose badge aggregates their danger counts. `Alt+number` and the palette reach everything unchanged.
- The standalone rail lists all seven with labels (§2).

Selection toolbars across the list views also gained **copy the selection** (titles + URLs), right next to delete.

## 5. Stats learns dwell time

Visits count *opens*; 4.2 adds the time you actually spent. The service worker journals **foreground dwell time per URL** and the journal survives browser restarts, so the number is honest across sessions. The Stats view gains a dwell-time sort and a dwell pill on each row; duplicated bookmarks share their URL's total — a URL with a big dwell number and no bookmark on it is exactly the "you should bookmark this" signal. Like visit counts, dwell is local to the device and clears together with the statistics.

## 6. The velvet visual language

### 6.1 One token chain, thirteen entries

Every color the UI wears flows through one `--vbm-*` token vocabulary; a theme is a token sheet loaded after the structural CSS. `/theme` switches between the thirteen entries — auto (follow system) / light / dark / ink / paper / classic / classic-dark / dracula (shown as **Dracula (@Andrew)** — Andrew's author-integrated build) / solarized-light / monokai-pro / dracula-remake (shown as **Dracula**, the spec remake) / quiet-light / github-light-hc — and `/theme dr` style prefixes work too.

### 6.2 Grayscale first, hue second

The structural layer of every theme is a **grayscale ladder**: three planes (canvas / surface / elev) and three text tiers (fg / muted / subtle). Hue is *atmosphere dyed onto fixed lightness* — a theme may tint a token, but never reorder the ladder: hover must stay distinguishable from selected, muted text must stay readable, in every skin. This is not a convention but a gate: pure-math contrast tests run in CI (fg ≥ 7:1, muted ≥ 4.5:1, plane lightness monotonic), and a real-browser probe screenshots every theme under a grayscale filter to assert the ladder survives with hue removed.

### 6.3 The light has a direction

Elevation is lit, not just stacked: in the cool themes the planes grow colder and whiter toward the top (the elevated plane sits nearest the light), while the warm *paper* theme reverses — warmer and deeper toward the bottom. Hairlines and elevation shadows carry the same temperature, so a dialog floating over the page reads as *lit from above*, in every theme.

### 6.4 Themes are files, density is not a theme

The options page's **theme manager** imports theme packages from plain CSS files — validated against the token vocabulary, with a WCAG-AA contrast pre-check before anything is applied. Imported or hand-written theme styles live in the **Custom CSS workbench** (multi-style, reorderable, individually toggleable), not a buried textarea. **Row density** (compact → spacious) is its own setting and stays orthogonal to skins: any theme at any density.

Below the group sit two outbound links: the **theme authoring guide** (how to write a package) and the **official sample themes** (the GitHub `docs/samples` directory, home of aurora-bench — the show-off sample riding every enthusiast channel). Download a `.json` package and import it via *Import theme package*; what you see is what you study.

### 6.5 Staged glyphs & one-shot motion

One glyph grammar for "collected vs not": a **hollow plane** appears on hover for *not yet staged*; a **solid plane** in the accent color, always visible, means *staged*. The tag mark follows the same grammar (hollow tag → solid tag). Toggles flip **in place** — the row never re-renders, folder heads cascade the flip to their children — and motion is reserved for the ON transition only: the star pops once when a save lands, the plane/tag glides in when an item becomes staged. Already-staged rows re-render silently; `prefers-reduced-motion` clamps all of it.

### 6.6 Geometry laws

The chrome around the content follows a small set of hard laws, held by tests: every list's last row button, every toolbar's last icon and every group head's tail sit on **one right axis 8px** from the container edge; icon buttons are **20px boxes at an even 4px step**; selection mode is a **two-rung bar** — counts and All/Invert/Clear on top, iconized batch actions below, their text labels lighting up one by one as width allows; **danger red sits rightmost**, always; tag chips live in a still two-slot geometry (the row tail on narrow surfaces, a line of their own on wide ones) and overflow into a `+n` chip. **A tagged row reads title → tags → meta**: the tags are the identity you typed in, path and time are derived context and come last. Clicking `+n` expands **in place on that very tag row** — every chip plus a `−` toggle, no second copy, nothing orphaned below the meta line; `−` or `Esc` folds it back. What doesn't fit folds behind `⋯` menus or iconizes under container queries — never wraps into visual noise.

### 6.7 Tags wear the language

The nine tag colors are **Chrome's own tab-group palette, constant across every theme** — your `#work` is the same blue in light and in dracula. Chips render in six display styles (soft-tint pill — the default, solid pill, outline, `#`-text, dot, off), and contrast is held by a computed contract: one ink formula across nine hues × every theme, WCAG AA verified in tests. The tag manager page follows your theme.

Chips mean the same thing everywhere they appear — tree, search, staging, stats, dead links, duplicates and the tab-groups view: **click a tag to run its `#tag` member query**, click `+n` to expand that row's chips in place. In the tab-groups view a chip never opens the tab it sits on.

### 6.8 Personality, on a leash

Inside the discipline, themes get to speak: folder icons take the theme's folder hue so structure scans before decoration; *ink* breathes with a faint glow, *Dracula (@Andrew)* wears a neon accent bar (and uses its Exo 2 typeface when your machine has it installed — no web fonts, ever), *paper* counters with vermilion. And for the faithful: **classic / classic-dark** recreate the v3 look — see the [classic-look recipe](guide-v4.md#5-getting-the-classic-look-and-feel-back) in the v4 guide.

## 7. Coming from 4.1.x

- **The tag system is new in 4.2**: your bookmarks, folders, staging area and statistics carry over untouched; tags start from zero — right-click a bookmark for the first tag, or pour a frequently-used folder into a tag (tag manager → folder pour), and you're two minutes from your first `#` query.
- **Jumping from 4.1.0–4.1.1**: 4.2.0 also includes the scroll-memory fixes of 4.1.2/4.1.3 (deep scroll positions survive slow machines; the highlight no longer drags the reopened view).
- The [changelog](README.md#v420) has the complete, versioned list.

---

*Spot an issue or want to fuel the next answer? [Rate it on the store](https://chromewebstore.google.com/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb) or [donate](https://github.com/windviki/vBookmarks/blob/master/donation/donation.md).*
