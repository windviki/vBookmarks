# vBookmarks Keyboard Model (v4, final)

The authoritative design for every key the popup handles. It is written as
*laws* — each one states the rule, the rationale, and the code that enforces
it — so future changes extend the model instead of accreting exceptions.
guide-v4.md §2 is the user-facing summary of this document; when the two
disagree, this document wins.

Design goals, in priority order:

1. **One model everywhere.** Muscle memory learned in the tree transfers to
   all six views unchanged; view-specific keys are strictly additive.
2. **Naive layout correspondence.** Arrow keys walk the UI exactly the way
   the eye scans it: `↓` moves to the next visual rung below, `↑` to the one
   above, `←`/`→` along the current rung. No hidden shortcuts that skip
   rungs a new user would expect to stop at.
3. **Everything reachable.** Any control a mouse can click is reachable by
   keyboard — directly, or through a documented two-step path.
4. **Esc peels one layer.** Every `Esc` dismisses exactly the topmost
   transient state and nothing else; it never destroys user input.
5. **Options never break the model.** Disabling views, hiding the tab strip
   or the header buttons re-flows the same laws over the remaining UI —
   the user never relearns, and no keystroke ever dies in a hidden element.

---

## 1. Zones: the visual stack

Top to bottom, the popup is:

```
┌ 1 Header row   [search box] [☆ quick-add] [⚙ tools]        ┐ always there
├ 2 Banner       donation / what's-new (transient, rare)     ┤ sometimes
├ 3 Tab strip    [tree][search][recent][stats][dead][dupes]  ┤ hideable
├ 4 View content [in-list toolbar?] + list rows              ┤ one visible
└ 5 Overlays     context menu · dialogs · palette (modal)    ┘ on demand
```

- The **search-clear × button** lives inside the box (`tabindex="-1"`):
  a mouse affordance; the keyboard path to clear the box is `Esc` (§4).
- The **banner** is transient chrome, not a rung: it joins the `Tab` cycle
  and answers to `Esc`, but arrow keys never stop on it (§7).
- Each view's **in-list toolbar** (Stats sort, Dead scan controls, Duplicates
  strategy/scope) is part of zone 4 AND a rung of the arrow chain: it sits
  between the strip and the rows for `↑`/`↓` and its controls walk on
  `←`/`→` (§2.5).

## 2. The arrow-key laws

One cycling principle underlies them all: **bounded fixed sets cycle** —
menus, the tab strip, and in-list toolbar rungs wrap around at their edges;
**long lists don't** — tree/results/per-view rows keep their one-way
top/bottom crossings instead. (The header row also never cycles: the text
box's caret editing takes priority there, §2.2.)

### 2.1 The vertical chain (browsing state)

```
search box  ──↓──▶  tab strip  ──↓──▶  [in-list toolbar]  ──↓──▶  active view's rows
           ◀──↑──             ◀──↑──   (stats/dead/dupes)  ◀──↑──  (↑ past the first row)
```

- **Box `↓`** (caret at the text end, browsing state — for the search-view
  exception see §3) lands on the **active tab**; a second `↓` enters the
  zone below. *(search.js keydown → views.focusDown)*
- **Strip `↓`** lands on the active view's **in-list toolbar** when it has
  one (§2.5), else enters the list at its **remembered row** (focus
  memory), else the first row. *(view-manager strip keydown →
  focusToolbar/focusDefault)*
- **Toolbar `↓`** enters the list (remembered row first); **toolbar `↑`**
  crosses to the strip/box. *(keyboard.js non-row branch)*
- **`↑` past the first row** of any list crosses to the **toolbar** when
  the active view has one, else the **active tab**; **`↑` again** reaches
  the box. With the strip hidden, the chain re-flows over the surviving
  rungs (§7). *(keyboard.js ArrowUp fallback → views.focusListExit)*
- **Header buttons `↓`** behave like the box's `↓` (same focusDown rung).

### 2.2 The horizontal chain on the header row

`→` walks the header row in reading order — **but only once the caret hits
the text's end with no selection** (text editing always wins inside the
box): box `→` quick-add `→` tools. `←` walks back; landing in the box parks
the caret at the end, ready to type. Hidden buttons are skipped (§7).
RTL locales mirror both arrows. *(search.js box keydown; keyboard.js
headerArrow)*

### 2.3 The tab strip

`←`/`→` move **and activate** the neighbor tab (roving tabindex, focus
follows, auto-activation is cheap because rendering is local), `Home`/`End`
focus the **current view's** first/last row — view-scoped, they never
switch views, and with no rows focus simply stays on the tab — `↑` → the
box, `↓` → the list. RTL mirrors `←`/`→`. *(view-manager strip keydown,
focusEdgeRow)*

### 2.4 Rows: the universal list contract

Every list view (tree, search results, recent, stats, dead, dupes members):

| Key | Action |
|---|---|
| `↑` `↓` | previous / next row (past the first row, `↑` crosses per §2.1) |
| `Home` / `End` | first / last row (`Cmd+↑`/`Cmd+↓` on macOS); a focusable `li[tabindex]` row (the dead view's start row) is focused directly, not via a child; on a row-less container `Home`/`End` cross OUT to the view anchor (focusTop — the tab or the search box), same landing as `↑` |
| `PageUp` / `PageDown` | one viewport up / down |
| `Enter` / `Space` | activate (`Ctrl/Cmd` new tab, `Shift` new window) |
| `→` (LTR) | open the row's context menu at the row's edge |
| `←` (LTR) | context-menu back-out / structural up (below) |
| `F2` | rename / edit (not on macOS; root folders are refused — the same guard as `Delete`) |
| `Delete` | delete (undoable; non-empty folders confirm; root folders are refused — the same guard as the context menu's disabled delete, and with no `.focus` row (a freshly focused list container) `Delete` does nothing) |

Structural overrides, additive only:

- **Tree folders**: `→` on a closed folder **expands** it (menu only when
  already open / on a bookmark); `←` **collapses** an open folder, else
  jumps to the parent folder. RTL mirrors.
- **Duplicates**: a member row's `←` jumps to its **group head**; on the
  head, `←`/`→`/`Enter`/`Space` **collapse/expand** the group (focus is
  re-parked on the replacement head element after the re-render). A member's
  `Enter`/`Space` dispatches to the row's anchor, never to the keeper radio.
- **Selection mode** (dead + dupes, v4 task-4 #8): `Space` on the focused
  element **toggles its selection** — a dead row's membership, or the whole
  group from either a dupes head or a dupes member row (click parity; focus
  is re-parked on the replacement row/head after the re-render). `Enter`
  keeps its activation semantics (dupes head still folds, member rows still
  open). Outside selection mode `Space` is unchanged: activate a dead row,
  fold a dupes head.
- **Search history rows** (§3): `↑`/`↓` walk, `Enter` reruns, `Delete`
  removes, `→` opens the row menu.
- **Dead/Stats/Duplicates letter keys** stay view-local (`M` mark, `R`
  reveal, `K` keeper); type-ahead exists only in tree + search results.

### 2.5 In-list toolbar controls (a real rung)

The stats/dead/dupes toolbars render between the strip and the rows, so the
naive layout correspondence makes them a **rung** of the vertical chain
(revised in the final polish — they used to be Tab-only territory, which
left the arrow chain inconsistent with the Tab ring). A view may stack
**several** toolbars (v4 task-4 #13: the dead view's proxy strip above its
scan toolbar) — each is then its own rung in visual (DOM) order, and a rung
without an enabled control is skipped transparently:

- **Entering**: strip `↓` lands on the **topmost** rung's first enabled
  control; `↑` past the list's first row lands on the **lowest** rung's
  first enabled control (the one visually nearest the rows). Toolbar-less
  views (tree/search/recent) skip the rung transparently.
- **`↓`** from a control enters the next rung below, or the rows from the
  lowest rung (remembered row first); **`↑`** enters the previous rung
  above, or crosses to the strip from the topmost rung (to the box when
  the strip is hidden).
- **`←`/`→`** walk the rung's enabled controls in reading order (RTL
  mirrors) and **wrap around** at the edges — a rung is a bounded fixed
  set, so it cycles like the tab strip (they used to be dead ends). The
  header row stays non-cycling: the text box's caret editing takes
  priority there (§2.2). This supersedes the old view-local seg walkers
  (stats sort, dead filter), which would double-step.
- **Dropdowns follow one shared protocol** (`dropdown.js`; the dupes toolbar's
  strategy/scope are the first users — native `<select>` handed its open-state
  keys to the browser, so it could not follow this). On the **closed trigger**:
  `↓`/`Enter`/`Space` open the list and move focus to the current option, while
  `↑` is **not** intercepted — the rung walks it to the toolbar/strip/box
  above. Inside the **open list**: `↑`/`↓` navigate options (greyed options
  are skipped), `Home`/`End` jump to the first/last pickable option (Page*
  are swallowed, never leaking to the rows behind), `→` (RTL `←`), `Enter`
  or `Space` picks the focused option, closes and refocuses the trigger,
  `←` (RTL `→`) or `Esc` cancels — closes, keeps the
  current pick, refocuses the trigger — and `Tab` picks + closes, refocuses
  the trigger and lets the §5 Tab ring step on from there (the dropdown
  itself never moves focus; a greyed current option closes WITHOUT picking —
  the cancel semantics). Buttons and the scheme checkbox leave the rung on
  `↑`/`↓`; action keys (Enter/Space/letters) are never hijacked.
- **Home/End/Page\*** fall through to the list's own handler (first/last
  row, one viewport), unchanged — except while a dropdown is open: the list
  handles `Home`/`End` itself and swallows Page* (and the row handler's
  first/last-row selectors exclude `.vbm-dropdown-list` markup anyway).
- **Focus survives re-renders**: sort switches, filter clicks, regroups and
  scan-progress ticks re-render the toolbar with the rows; each view
  restores focus to the same-index control across the innerHTML swap, so
  the rung never drops the user's place. The views now also park/restore a
  focused **list row** across the swap (the dupes/dead/stats/recent renders
  and the search-history area): same-id replacement row first, then the
  index-clamped row, then the container/input when the list is empty — so a
  menu action that re-renders (e.g. "set as keeper") no longer loses
  keyboard focus. *(the views' render functions)*
- **The remembered-row marker is row-scoped**: the live `.focus` marker
  (view-manager's focusin handler) never lands on a toolbar dropdown's
  option `<li role="option" tabindex="-1">` — those are listbox chrome, not
  rows, and a marker parked on a HIDDEN option dead-ended the rung's `↓`
  (the 4.0.1 regression: after opening the strategy dropdown, the button
  area could no longer enter the rows). The rung's ↓ also skips a
  listbox-resident marker defensively. *(view-manager `bindFocusMarker`,
  keyboard.js rung ↓; gate in verify-keyboard.js + tests/view-manager and
  tests/keyboard)*
- **Inline row controls** (the dupes keeper radio, the dead ⚑/× buttons)
  are not the rung: when one holds focus (mouse click), `↑`/`↓` walk rows
  relative to its owning row, and `↑` past the top takes the §2.1 crossing.

`Tab` reaches the rung too, exactly as before (§5) — arrow chain and Tab
ring now agree.

### 2.6 Context menus

All seven menus are keyboard-bound — bookmark, folder, search-history,
history-row, dupes-group, palette-command (the last also joins the §5 Tab
ring's menu containers) **and the separator menu** (its lone "remove
separator" entry used to be keyboard-unreachable — that was the reported
bug; the "unbound by design" exception is gone). `↑`/`↓` walk items,
skipping separators and hidden entries, and wrap around **on every
platform** (the old macOS no-wrap exception is deleted); `Home`/`End` jump
to the first/last enabled item. Confirm/cancel mirrors the dropdown.js
protocol: `→` (LTR; RTL `←`) = `Enter` = `Space` **confirm** — execute the
focused enabled item, close the menu, focus returns to the owning row;
`←` (LTR; RTL `→`) = `Esc` **cancel** — close without executing, focus
returns to the owning row. Confirming while the bare menu **container**
holds focus (no item chosen yet) or on a greyed (disabled) item is a no-op.
One exception stays: a menu opened from the **palette** (the
palette-command edit/delete menu) returns focus to the palette's input box,
its real keyboard anchor, and the palette stays open. New focus law (4.0.1):
a menu-item dispatch closes the menu FIRST and returns focus to the owning
row, THEN runs the action; if the action re-renders the list and the owning
row element was swapped, focus lands on the same-id replacement row (then
the list container as fallback).

## 3. The search view: the dual-zone exception

In the search view **the box is the view's primary control** (v3 muscle
memory: the box and the results were one screen). So inside this view the
box's `↓` enters its content directly instead of stopping at the strip:

- **Live query**: box `↓` → first **result** row.
- **Empty box in the search view**: box `↓` → first **history** row; history
  `↓` past the last row crosses into the kept results.
- **`↑` past the top of either zone** obeys the universal law (§2.1): the
  tab strip when visible, else the box. (The history zone's `↑`-crossing
  was aligned to this in the final polish — it used to skip the strip.)
- Results render into the same list contract as §2.4, including `Home`/`End`
  and type-ahead.

Everywhere else (tree/recent/stats/dead/dupes active, box empty or not — a
query in the box means the search view is active by definition), §2.1 holds
without exception.

## 4. The Esc layer cake

`Esc` is captured at the document before Chrome's built-in "Escape closes
the popup" (keydown **and** keyup are both pre-empted), so the popup closes
only as the deliberate last layer. From top to bottom, exactly one layer
per press:

1. **Open dropdown** → close it, focus returns to its trigger. This layer
   sits ABOVE all the others: the dropdown's `Esc` handler is a
   window-capture listener (registered ahead of the document-capture chain
   that owns layers 2–9), so an open listbox always eats the first `Esc`,
   even with a dialog or the palette open behind it.
2. **Dialogs** open → close them.
3. **Context menu** open → close it, focus returns to the owning row (a
   palette-opened menu: to the palette's input box, §2.6). The collapsed
   tab-group/sort **flyout** (issue #48 follow-up) is an *inner* layer of this
   one: the first `Esc` closes only the flyout and refocuses its collapse
   entry (the menu stays open and arrowable), the second `Esc` closes the
   menu. `←` mirrors the same one-layer rule on any menu item — the flyout
   first, then the menu — and arrowing away from the collapse entry inside
   the parent menu closes the flyout (no stale flyout).
4. **Banner** visible → dismiss it (the donation card uses the *Later*
   semantics — it snoozes, never unsubscribes; a dead/dupes **risk banner**
   (v4 task-4 #14) dismisses with its session × semantics).
5. **Palette** open → close it.
6. **View-local transient state**: Duplicates/Dead **selection mode** exits;
   a Dead **scan pauses** (next `Esc` resumes — non-destructive; cancelling
   is the toolbar's explicit button).
7. **Search query** in the box → record it into history, clear the box,
   keep the results and the view (level one of the two-level search exit).
8. **Non-tree view** active → back to the tree (browser-style "back").
9. Nothing left → **close the popup**.

Layers 2–5 are also reachable in any order a user could plausibly stack
them; the list is a priority order for simultaneous states, not a required
sequence.

## 5. The Tab region cycle

`Tab`/`Shift+Tab` walk a ring of regions, forward and backward:

```
search box → quick-add → tools → [banner controls] → active tab
→ [risk-banner controls] → [in-list toolbar controls] → remembered/first row
→ (wrap)
```

- A stop counts only when **actually rendered**: the `.hidden` class, an
  inline `display:none`, or zero client rects (stylesheet-driven hiding such
  as `body.no-view-tabs`, option-hidden header buttons) all exclude it —
  the cycle re-flows itself over any option combination (§7).
- All list rows are `tabindex="-1"`: this cycle is the *only* Tab path into
  or out of a list, and it lands on the remembered row (focus memory).
- **Dialogs** trap `Tab` among their own enabled controls (aria-modal
  contract); open **menus** and the **palette** keep their local `Tab`.
- Focus memory is symmetric: leaving a list for the strip/header and coming
  back — by `Tab`, by arrows, or by view switch — lands on the row left
  behind, restored even across the views' async re-renders.

## 6. Jump and action keys

| Key | Action |
|---|---|
| `Ctrl/Cmd+F` | activate the search view, focus + select the box |
| `Alt+1…9` | jump to the Nth **visible** view (an ordinary input does NOT swallow it — since 9888f8a the search box keeps typing digits yet `Ctrl/Alt+1…9` still switches views; only an open modal dialog or the open palette intercepts). `Ctrl/Cmd+1…9` is the legacy twin — kept where the browser lets it through (Chrome's popup/side panel), but Edge reserves `Ctrl+1…8` for browser-tab switching, so `Alt` is the portable form (v4 task-4 #10) |
| `Ctrl/Cmd+K` | command palette |
| `Ctrl/Cmd+D` | quick-add the current page (edit dialog if already bookmarked) |
| Letters/digits | tree + search results: type-ahead (500 ms rolling buffer, wraps) |
| `M` / `R` / `K` | view-local: dead mark / reveal in tree / dupes keeper |

## 7. The option-combination adaptation matrix

The laws above must hold under every settings combination. "Skip" means the
element is neither an arrow rung nor a Tab stop; "retarget" means the chain
endpoint moves to the next surviving rung.

| Setting | Effect on the model |
|---|---|
| `showViewTabs` off (`body.no-view-tabs`) | `↑`-past-top and box `↓` retarget: box ⇄ [toolbar] ⇄ list (focusTop/focusDown/focusListExit read the flag live; the toolbar rung survives — it belongs to the view, not the strip). Strip keys don't exist; `Alt+1…9` and the palette still reach every view. |
| One feature view disabled (`showRecentBookmarks` / `showStatsView` / `showDeadView` / `showDupesView`) | No tab, activation refused, `Alt+N` indexes the visible set. A remembered startup view that is now disabled falls back to the tree. |
| `quickAddEnabled` off | Header `→` chain: box → tools; `←` chain: tools → box. Tab cycle skips it. |
| `showToolButton` off (or palette off, which hides it) | `→` from quick-add is a no-op; Tab cycle skips it. |
| Classic experience (all three off at once) | Header is the bare box: `→` inert, `↓` straight into the list — the v3 chain, exactly what the option promises. |
| `rememberView` off | Startup is always the tree; no other law changes. |
| Side panel mode | Identical model; startup always restores the last view. |
| RTL locale | Every horizontal law mirrors (`←`/`→` swap) on the strip, the header chain, tree folders, menus, history rows. |
| Banner visible | Joins the `Tab` ring between header and strip; `Esc` dismisses (Later). Never an arrow rung — the arrow chain stays stable whether or not the banner happens to be up. |
| Risk banner visible (dead/dupes, v4 task-4 #14) | Same laws as the donation banner, at its own visual spot: `Tab` ring between the strip and the toolbar rungs; `Esc` dismisses (session ×); never an arrow rung, so the multi-toolbar chain of §2.5 is unaffected. |
| Tree-only filter (`onlyShowBMBar`) | Content-level filter; the keyboard model is untouched. |
| Dialog / menu / palette open | Overlay laws (§2.6, §5) replace the zone chain until closed. |

**Invariant worth a test whenever the model changes:** no keystroke may
ever focus a hidden element, and no visible, enabled control may be
unreachable by `Tab`.

## 8. Where each law lives

| Law | Code | Tests |
|---|---|---|
| Vertical chain (§2.1) | `view-manager.js` focusTop/focusDown/focusListExit/strip keydown; `search.js` box keydown; `keyboard.js` ArrowUp fallback | `tests/view-manager.test.js`, `tests/search.test.js`, Docker `verify-keyboard.js` §2.2/§2.2c/§2.1d |
| Header chain (§2.2) | `search.js` (box `→`), `keyboard.js` headerArrow | `tests/search.test.js`, `tests/keyboard.test.js` (header-row arrows), verify §2.1d |
| Strip model (§2.3) | `view-manager.js` strip keydown + focusEdgeRow (view-scoped Home/End) | `tests/view-manager.test.js`, verify §2.2 |
| List contract (§2.4) | `keyboard.js` treeKeyDown/treeKeyUp; dupes overrides in `view-dupes.js`; history in `search.js` | `tests/keyboard.test.js`, `tests/view-dupes.test.js`, `tests/search.test.js` (the search-history rows), verify §2.2c/§4.3b |
| Toolbar rung (§2.5) | `view-manager.js` focusToolbar/focusListExit; `keyboard.js` non-row branch of treeKeyDown; focus restore in the three views' render(); the dropdown protocol in `dropdown.js` + `view-dupes.js` (strategy/scope) | `tests/view-manager.test.js` (rung describe), `tests/keyboard.test.js` (item-7b + §2.5), `tests/dropdown.test.js` (protocol), verify §2.2c |
| Menus (§2.6) | `keyboard.js` contextKeyDown + `context-menu.js` closeMenu/refocusOwner | `tests/keyboard.test.js`, `tests/context-menu.test.js` (all seven menus, wrap + Home/End + confirm/cancel, dispatch refocus) |
| Dual zone (§3) | `search.js` box/history keydown | `tests/search.test.js`, verify §4.3/§4.3b |
| Esc cake (§4) | `keyboard.js` document capture handlers + `view-manager.js` onEscapeActive/escapeToTree + view `onEscape` hooks | `tests/keyboard.test.js` (Esc layering), view suites; Chrome-side popup-close suppression documented in `docs/cdp-escape-limitation.md` |
| Tab ring (§5) | `keyboard.js` tabCycle | `tests/keyboard.test.js` (Tab region cycle), verify §2.1 |
| Matrix (§7) | visibility checks in `tabCycle`/headerArrow/`focusTop`/`focusDown` | verify-keyboard option seeds + `tests/keyboard.test.js` hidden-button cases |
| Cross-module focus transfers (§2.1/§4/§5) | the real `view-manager.js` + `palette.js` + `keyboard.js` wired together (the per-module suites mock each other) | `tests/focus-regression.test.js` — the mandatory gate: view-jump keys land focus, dialogs/palette own their keys, the layered Esc order holds end-to-end |
