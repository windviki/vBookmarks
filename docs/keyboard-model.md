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
  strategy/scope) is part of zone 4: a `Tab` stop group, never an arrow
  rung — arrows are for rows (§2.4).

## 2. The arrow-key laws

### 2.1 The vertical chain (browsing state)

```
search box  ──↓──▶  tab strip  ──↓──▶  active view's rows
           ◀──↑──             ◀──↑──  (↑ past the first row)
```

- **Box `↓`** (caret at the text end, browsing state — for the search-view
  exception see §3) lands on the **active tab**; a second `↓` enters the
  list. *(search.js keydown → views.focusDown)*
- **Strip `↓`** enters the active list at its **remembered row** (focus
  memory), else the first row. *(view-manager strip keydown → focusDefault)*
- **`↑` past the first row** of any list crosses to the **active tab**;
  **`↑` again** reaches the box. With the strip hidden, both crossings land
  on the box directly (§7). *(keyboard.js ArrowUp fallback → views.focusTop)*
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
jump to the ends, `↑` → the box, `↓` → the list. RTL mirrors `←`/`→`.
*(view-manager strip keydown)*

### 2.4 Rows: the universal list contract

Every list view (tree, search results, recent, stats, dead, dupes members):

| Key | Action |
|---|---|
| `↑` `↓` | previous / next row (past the first row, `↑` crosses per §2.1) |
| `Home` / `End` | first / last row (`Cmd+↑`/`Cmd+↓` on macOS) |
| `PageUp` / `PageDown` | one viewport up / down |
| `Enter` / `Space` | activate (`Ctrl/Cmd` new tab, `Shift` new window) |
| `→` (LTR) | open the row's context menu at the row's edge |
| `←` (LTR) | context-menu back-out / structural up (below) |
| `F2` | rename / edit (not on macOS) |
| `Delete` | delete (undoable; non-empty folders confirm) |

Structural overrides, additive only:

- **Tree folders**: `→` on a closed folder **expands** it (menu only when
  already open / on a bookmark); `←` **collapses** an open folder, else
  jumps to the parent folder. RTL mirrors.
- **Duplicates**: a member row's `←` jumps to its **group head**; on the
  head, `←`/`→`/`Enter`/`Space` **collapse/expand** the group (focus is
  re-parked on the replacement head element after the re-render). A member's
  `Enter`/`Space` dispatches to the row's anchor, never to the keeper radio.
- **Search history rows** (§3): `↑`/`↓` walk, `Enter` reruns, `Delete`
  removes, `→` opens the row menu.
- **Dead/Stats/Duplicates letter keys** stay view-local (`M` mark, `R`
  reveal, `K` keeper); type-ahead exists only in tree + search results.

### 2.5 In-list toolbar controls

Focus on a toolbar control (a button/select inside a list view): `↓` jumps
to the **first row**, `↑` to the **last row** (listbox convention);
`Home`/`End`/`Page*` fall through to the list's own handler; action keys
keep the control's native semantics. `←`/`→` are not consumed. The toolbar
itself is never an arrow rung between the strip and the rows — reaching it
is `Tab`'s job (§5).

### 2.6 Context menus

`↑`/`↓` walk items, skipping separators, wrap-around except on macOS;
`Enter`/`Space` execute; `Esc` or the *back* arrow (`←` LTR, `→` RTL) close
the menu and return focus to the owning row. The same handler serves all
five menus (bookmark, folder, search-history, history-row, dupes-group).

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

1. **Dialogs** open → close them.
2. **Context menu** open → close it, focus returns to the owning row.
3. **Banner** visible → dismiss it (the *Later* semantics — it snoozes,
   never unsubscribes).
4. **Palette** open → close it.
5. **View-local transient state**: Duplicates/Dead **selection mode** exits;
   a Dead **scan pauses** (next `Esc` resumes — non-destructive; cancelling
   is the toolbar's explicit button).
6. **Search query** in the box → record it into history, clear the box,
   keep the results and the view (level one of the two-level search exit).
7. **Non-tree view** active → back to the tree (browser-style "back").
8. Nothing left → **close the popup**.

Layers 1–4 are also reachable in any order a user could plausibly stack
them; the list is a priority order for simultaneous states, not a required
sequence.

## 5. The Tab region cycle

`Tab`/`Shift+Tab` walk a ring of regions, forward and backward:

```
search box → quick-add → tools → [banner controls] → active tab
→ [in-list toolbar controls] → remembered/first row → (wrap)
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
| `Ctrl/Cmd+1…9` | jump to the Nth **visible** view (never fires inside inputs) |
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
| `showViewTabs` off (`body.no-view-tabs`) | `↑`-past-top and box `↓` retarget: box ⇄ list directly (focusTop/focusDown read the flag live). Strip keys don't exist; `Ctrl+1…9` and the palette still reach every view. |
| One feature view disabled (`showRecentBookmarks` / `showStatsView` / `showDeadView` / `showDupesView`) | No tab, activation refused, `Ctrl+N` indexes the visible set. A remembered startup view that is now disabled falls back to the tree. |
| `quickAddEnabled` off | Header `→` chain: box → tools; `←` chain: tools → box. Tab cycle skips it. |
| `showToolButton` off (or palette off, which hides it) | `→` from quick-add is a no-op; Tab cycle skips it. |
| Classic experience (all three off at once) | Header is the bare box: `→` inert, `↓` straight into the list — the v3 chain, exactly what the option promises. |
| `rememberView` off | Startup is always the tree; no other law changes. |
| Side panel mode | Identical model; startup always restores the last view. |
| RTL locale | Every horizontal law mirrors (`←`/`→` swap) on the strip, the header chain, tree folders, menus, history rows. |
| Banner visible | Joins the `Tab` ring between header and strip; `Esc` dismisses (Later). Never an arrow rung — the arrow chain stays stable whether or not the banner happens to be up. |
| Tree-only filter (`onlyShowBMBar`) | Content-level filter; the keyboard model is untouched. |
| Dialog / menu / palette open | Overlay laws (§2.6, §5) replace the zone chain until closed. |

**Invariant worth a test whenever the model changes:** no keystroke may
ever focus a hidden element, and no visible, enabled control may be
unreachable by `Tab`.

## 8. Where each law lives

| Law | Code | Tests |
|---|---|---|
| Vertical chain (§2.1) | `view-manager.js` focusTop/focusDown/strip keydown; `search.js` box keydown; `keyboard.js` ArrowUp fallback | `tests/view-manager.test.js`, `tests/search.test.js`, Docker `verify-keyboard.js` §2.2/§2.2c/§2.1d |
| Header chain (§2.2) | `search.js` (box `→`), `keyboard.js` headerArrow | `tests/search.test.js`, `tests/keyboard.test.js` (header-row arrows), verify §2.1d |
| Strip model (§2.3) | `view-manager.js` strip keydown | `tests/view-manager.test.js`, verify §2.2 |
| List contract (§2.4) | `keyboard.js` treeKeyDown/treeKeyUp; dupes overrides in `view-dupes.js`; history in `search.js` | `tests/keyboard.test.js`, `tests/view-dupes.test.js`, `tests/search-history.test.js`, verify §2.2c/§4.3b |
| Toolbars (§2.5) | `keyboard.js` non-row branch of treeKeyDown | verify §2.2c (dead/dupes/stats rows) |
| Menus (§2.6) | `keyboard.js` contextKeyDown | `tests/keyboard.test.js`, `tests/context-menu.test.js` |
| Dual zone (§3) | `search.js` box/history keydown | `tests/search.test.js`, verify §4.3/§4.3b |
| Esc cake (§4) | `keyboard.js` document capture handlers + `view-manager.js` onEscapeActive/escapeToTree + view `onEscape` hooks | `tests/keyboard.test.js` (Esc layering), view suites; Chrome-side popup-close suppression documented in `docs/cdp-escape-limitation.md` |
| Tab ring (§5) | `keyboard.js` tabCycle | `tests/keyboard.test.js` (Tab region cycle), verify §2.1 |
| Matrix (§7) | visibility checks in `tabCycle`/headerArrow/`focusTop`/`focusDown` | verify-keyboard option seeds + `tests/keyboard.test.js` hidden-button cases |
