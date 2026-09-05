/**
 * Tree view layer (P1 module extracted from neat.js, slice 8b — the state +
 * behavior half of the tree view; the pure rendering/data half lives in
 * src/tree-render.js, slice 8a).
 *
 * Owns: the tree-view state (the nodeTrees parent map and the onlyShowBMBar
 * startup flag, plus the v4 task-3 #14 session-only show-all override), generateTree (subtree selection incl. onlyShowBMBar, the
 * scroll/focus restore and
 * the legacy local-separator migration) plus the startup
 * chrome.bookmarks.getTree call, the four tree event handlers (scroll
 * persistence, focus tracking with focusID, folder expand/collapse incl. lazy
 * child loading + closeUnusedFolders sibling collapse + opens persistence,
 * middle-click focus forcing), generateTreeForTarget (the search-result jump
 * scroll handler) and bookmarkHandler (bookmark/folder open dispatch on
 * click/auxclick for the tree, the search results pane and — bound by
 * src/view-recent.js — the recent view's list). The virtual "recently added"
 * section moved out to src/view-recent.js in v4 task-2 (slice B).
 *
 * initTreeView(ctx) is called once by neat.js right after actions/dnd init —
 * menus/search/dialogs/actions/dnd are all ready by then, so everything is
 * passed as a plain value (no lazy getters).
 * hoisted function declaration in neat.js (sync-ui 尚未剥离) and
 * SeparatorManager an imported class there, so both arrive via ctx too.
 * ctx.store                 — settings store
 * ctx.tree                  — the #tree element (all tree event bindings)
 * ctx.SeparatorManager      — class, for the legacy local-separator migration
 * ctx.treeRender            — tree-render.js API (generateHTML & co.)
 * ctx.search                — search.js API (quit/reset/results)
 * ctx.actions               — actions.js API (the open* calls + addSeparator)
 * ctx.dnd                   — dnd.js API (consumeNoOpen swallows post-drag click)
 * ctx.getOpens()            — current expanded-folder id array (shared channel
 *                             with treeRender's getter; the view only writes)
 * ctx.getRememberState()    — current remember-state flag (read per call)
 * ctx.setOpens(arr)         — replace the expanded-folder id array (neat.js state)
 * ctx.setRememberState(b)   — set the remember-state flag (neat.js state)
 * ctx.middleClickBgTab      — middle-click opens a background tab when true
 * ctx.leftClickNewTab       — left-click opens a new tab when true
 * ctx.onOpenBookmark(id,url) — v4 task-2 slice D: optional hook fired on every
 *                             bookmark open (the visit-stats collection point;
 *                             slice E: the url feeds the SW dedupe marker)
 * ctx.toastAction(message, buttonLabel, onAction) — v4 task-3 #14: optional
 *                             generic action toast (neat.js passes
 *                             undo.toastAction); revealInTree uses it when the
 *                             target sits outside an onlyShowBMBar-filtered
 *                             tree. Missing → the guard silently falls back
 *                             to the plain reveal (minimal setups).
 *
 * Returns { generateTree, revealFolder, revealInTree,
 * bookmarkHandler }: neat.js's sortFolderContents rebuilds via
 * treeView.generateTree, the command palette (P2) jumps to a folder
 * via treeView.revealFolder (the search-result link-folder branch of
 * bookmarkHandler runs the same chain), and src/view-recent.js binds its
 * list clicks to treeView.bookmarkHandler and its R key to
 * treeView.revealInTree. (The adaptive-tooltip pass was retired by the
 * 4.1.1 full-info tooltip round — every row bakes its tooltip at render.)
 * chrome.bookmarks.*, chrome.i18n.getMessage, document and setTimeout remain
 * page globals. No neatools helpers: hasClass/addClass/removeClass/toggleClass
 * → classList.* (the removeClass('open').setAttribute(...) chain became two
 * statements), inject → appendChild, destroy → remove, $ →
 * document.getElementById, Array.map(fn, list) → Array.from(list).map(fn),
 * Array.prototype.clean → filter(Boolean), getSiblings('li') → an
 * Array.from(children).filter (neatools' getSiblings ignored its selector
 * argument anyway), String.prototype.htmlspecialchars became the
 * module-private pure function below (same implementation as tree-render.js's).
 */

import { parkRowFocus, unparkRowFocus } from './list-focus.js';
import { toggleStageItem, flipStageBtn } from './staging-relay.js';

export function initTreeView(ctx = {}) {
    const store = ctx.store;
    const $tree = ctx.tree;
    const SeparatorManager = ctx.SeparatorManager;
    const treeRender = ctx.treeRender;
    const search = ctx.search;
    const actions = ctx.actions;
    const dnd = ctx.dnd;
    const getRememberState = ctx.getRememberState;
    const setOpens = ctx.setOpens;
    const setRememberState = ctx.setRememberState;
    const middleClickBgTab = ctx.middleClickBgTab;
    const leftClickNewTab = ctx.leftClickNewTab;
    // v4 task-2 §3.6: optional hook receiving the full bookmark tree on every
    // generateTree — neat.js feeds it to view-manager.buildPathMap.
    const onTreeGenerated = ctx.onTreeGenerated;
    // 第五轮项3: the lazy folder-expand below renders NEW rows (getChildren +
    // appendChild) outside generateTree — neat.js re-lays the dead-mark ×
    // overlays on them through this hook (default no-op for minimal setups).
    const onRowsRendered = ctx.onRowsRendered || (() => {});
    // v4 task-2: view-manager API — revealInTree activates the tree view
    // (optional so minimal test setups keep working).
    const views = ctx.views;
    // v4 task-3 #14: generic action toast (undo.toastAction in neat.js).
    const toastAction = ctx.toastAction;
    // issue #64: "open with the search field activated" — the option hands
    // the popup's startup focus to the search input (its autofocus
    // attribute), so the focusID row re-focus below must stand down (it
    // fires after the autofocus and would steal the focus right back).
    const getFocusSearchOnOpen = ctx.getFocusSearchOnOpen || (() => false);

    // 树视图状态：folder id -> parent id 映射（每次 generateTree 重建）与
    // onlyShowBMBar 启动开关（只有 generateTree 读取）。
    const nodeTrees = {};
    const onlyShowBMBar = !!store.get('onlyShowBMBar');
    // v4 task-3 #14: session-only override set by the reveal hint's toast
    // action — the tree shows the FULL tree until the page unloads; the
    // onlyShowBMBar setting itself is never touched.
    let showAllOverride = false;

    // 4.1.1 full-info tooltip: the LAST snapshot's canonical path map — the
    // lazy folder-expand below renders rows OUTSIDE generateTree and needs it
    // for the rows' Path tooltip line (stale only for nodes created after the
    // last full render; every bookmark event re-runs generateTree and
    // refreshes it).
    let lastPathsMap = null;

    // Round-4 item 4: generateNodeTrees maps folders only, so a bookmark id
    // never resolved an ancestor chain in revealFolder — "在树中定位" opened
    // nothing and the target row was never rendered. generateTree therefore
    // adds the bookmark parents to the same map and records the bookmark
    // ids, so revealFolder can resolve (and trim) a bookmark's path too.
    const bookmarkIds = new Set();
    const addBookmarkParents = nodes => {
        for (let i = 0, l = nodes.length; i < l; i++) {
            const d = nodes[i];
            if (d.url) {
                nodeTrees[d.id] = d.parentId;
                bookmarkIds.add(`${d.id}`);
            }
            if (d.children)
                addBookmarkParents(d.children);
        }
    };

    let rescueApplied = -1;
    let rescueSeq = 0;
    let settleWaiters = [];
    const treeSettling = () => rescueApplied >= 0;
    const whenTreeScrollSettled = fn => {
        settleWaiters.push(fn);
    };
    const flushSettleWaiters = () => {
        if (settleWaiters.length) {
            const waiters = settleWaiters;
            settleWaiters = [];
            for (const fn of waiters)
                fn();
        }
    };
    const setSettlingFlag = on => {
        const body = document.body;
        if (body && body.dataset) {
            if (on)
                body.dataset.vbmTreeSettling = '1';
            else
                delete body.dataset.vbmTreeSettling;
        }
    };

    // issues #65/#66 (residual round): the scroll-restore campaign. Owns the
    // tree's scrollTop until the stored position actually lands (the fresh
    // tree's layout settles late); rescueApplied ≥ 0 while a campaign is
    // live and equals the last value IT applied — the scroll listener uses
    // it to tell campaign intermediates (never persisted) from real scrolls
    // (persisted, and they cancel the campaign). 30 rAFs + a 40×100ms tail
    // ≈ 4.5s worst case — slow machines with big trees outlast a
    // frames-only budget.
    //
    // While a campaign is live, body carries data-vbm-tree-settling and the
    // reveal/spot focus grants wait for the landing (whenTreeScrollSettled):
    // Chromium's scroll anchoring PREFERS the focused row as its anchor, and
    // an off-viewport focused anchor makes the settle's height growth jump
    // the viewport toward that row (probe-verified: scrollTop 400 → 0).
    // Focusing after the settle keeps the anchor in-viewport, where the
    // anchoring compensation PROTECTS the restored view instead.
    //
    // issues #67/#68 (diag-68-slow-settle-duel): a clamped restore can
    // DEADLOCK. Since 4.1.0 the tree rows carry content-visibility:auto, so
    // an off-viewport band never lays out until the viewport visits it (the
    // probe froze folders' uls and proved both directions stall: a style
    // change on a far-off band leaves scrollHeight stale even under forced
    // reads). Re-assigning savedTop chases growth only at/below the clamped
    // view; growth needed ABOVE the frontier never comes — the campaign
    // would sit at the frontier until its budget ran out. After STALL_LIMIT
    // progressless steps the campaign therefore WALKS the bands: scrollTop
    // from the top in viewport steps, never outrunning the band that just
    // landed — every visited band renders, so the walk forces the settle
    // AND breaks the deadlock (the principled form of the pre-4.1.2
    // focus-yank that used to mask this class by dragging the viewport to
    // the highlight row).
    // issues #67/#68 (final round, the maintainer's "every reopen lands
    // somewhere different"): the PIXEL memory random-walks. On real machines
    // late correction waves trigger Chromium's content-stable anchoring
    // compensation — the view looks identical while scrollTop quietly
    // changes — and the scroll listener persists the new pixel; the next
    // session restores it against a different settle pattern, its own wave
    // drifts it again. The row at the top of the viewport is what the user
    // actually perceives: persist it (`scrollAnchor` = "id@offset") and the
    // restore lands by ROW — the pixel may wander, the memory does not.
    const treeAnchor = () => {
        if (typeof document.elementFromPoint !== 'function'
            || !$tree.getBoundingClientRect)
            return '';
        const base = $tree.getBoundingClientRect();
        for (let dy = 1; dy <= 12; dy += 3) {
            const hit = document.elementFromPoint(base.left + 12, base.top + dy);
            let node = hit;
            while (node && node !== $tree
                && !(node.id && String(node.id).startsWith('neat-tree-item-')))
                node = node.parentElement;
            if (node && node !== $tree && node.id) {
                const r = node.getBoundingClientRect();
                return `${node.id.replace('neat-tree-item-', '')}@${Math.round(r.top - base.top)}`;
            }
        }
        return '';
    };
    const parseScrollAnchor = v => {
        if (!v)
            return null;
        const at = String(v).indexOf('@');
        if (at < 1)
            return null;
        const off = parseInt(String(v).slice(at + 1), 10);
        if (!Number.isFinite(off))
            return null;
        return { id: String(v).slice(0, at), off };
    };

    // 4.1.4 实验室 gate: tree-row content-visibility is opt-in (treeCvLab,
    // default off). Off = ≤4.0.8 semantics — the swap lays the whole tree
    // out synchronously and the one-shot scrollTop assignment lands exactly
    // (issues #65-#68's whole problem class only exists under cv). On = the
    // 4.1.x fast path plus the scroll-rescue campaign. treeCvRevealLab is
    // the PK knob choosing the restore transport under cv (the band walk vs
    // the platform's scrollIntoView reveal).
    const treeCvOn = () => !!store.get('treeCvLab', '');
    const treeCvRevealOn = () => !!store.get('treeCvRevealLab', '');
    // One-shot row re-assert (no timers): measures the anchor row against
    // the saved offset and moves by the exact delta. With cv off the swap
    // laid everything out, so one pass is final; under cv the campaign
    // calls it on every stabilization step.
    const applyAnchorAdjust = anchor => {
        if (!anchor)
            return false;
        const row = document.getElementById(`neat-tree-item-${anchor.id}`);
        if (!row || !row.getBoundingClientRect || !$tree.getBoundingClientRect)
            return false;
        const dr = row.getBoundingClientRect().top - $tree.getBoundingClientRect().top;
        if (Math.abs(dr - anchor.off) <= 1)
            return false;
        $tree.scrollTop += dr - anchor.off;
        return true;
    };

    const scrollRescue = (savedTop, anchor) => {
        const seq = ++rescueSeq;
        let applied = $tree.scrollTop;
        let rafFrames = 0;
        let tailTicks = 0;
        let stallSteps = 0;
        let walkPos = -1; // < 0: climbing; ≥ 0: walking, the next band target
        let walkTicks = 0;
        let walkClock = 0; // virtual ms the walk has spent (its own delays)
        let bestApplied = $tree.scrollTop;
        let passBest = -1; // bestApplied when the current walk pass started
        let stalledPasses = 0; // consecutive passes with zero frontier progress
        let stableSteps = 0; // stabilization watch: consecutive equal scrollHeights
        let lastSh = -1;
        let landedOnce = false;
        // reveal transport (treeCvRevealLab PK knob, needs a live anchor
        // row): the platform's scrollIntoView is the principled form of the
        // pre-4.1.2 focus-yank — ONE hop to the target row, which forces
        // its cv band to render, then the shared anchor-verify +
        // stabilization watch. A missing anchor row falls back to the walk
        // (deleted bookmark).
        const revealMode = treeCvRevealOn() && !!anchor
            && !!document.getElementById(`neat-tree-item-${anchor.id}`);
        let revealed = false;
        // Re-assert the remembered ROW: once the pixel has landed, the
        // anchor decides — a shifted settle geometry (a collapsed-then-
        // released band, differing placeholder sums) maps the saved pixel
        // to the wrong row; the row is the invariant. Returns true when it
        // moved the view (the stabilization restarts its stability count).
        const anchorAdjust = () => {
            if (!applyAnchorAdjust(anchor))
                return false;
            applied = $tree.scrollTop;
            rescueApplied = applied;
            return true;
        };
        const viewStep = () => ($tree.clientHeight || 600);
        // The walk runs on its own bounded track with an ADAPTIVE cadence:
        // landed bands advance at 16ms (a deep restore must not starve on
        // the climb's 30 rAF + 40×100ms budget — the v4.1.3 field report:
        // a long folder's deep position gave up mid-walk), while a stalled
        // band re-walks on the 100ms settle clock (a staged settle window
        // can be seconds wide; a fast cadence would burn the walk cap
        // before the frontier starts growing). Two consecutive passes with
        // no frontier progress at all mean the tree can never hold the
        // target — park at the best reachable position and end quietly.
        const walkCap = () => Math.min(2000, Math.ceil(savedTop / viewStep()) * 4 + 150);
        setSettlingFlag(true);
        const done = () => {
            // The campaign's last assignment fires its scroll event only
            // after this point — hold the handshake value briefly so a
            // give-up is not persisted over the saved position (#67/#68:
            // the trailing event used to corrupt the stored scrollTop).
            const last = rescueApplied;
            const lastSeq = seq;
            setTimeout(() => {
                if (seq === lastSeq && rescueApplied === last) {
                    rescueApplied = -1;
                    flushSettleWaiters(); // waiters that arrived during the grace
                }
            }, 350);
            if (seq === rescueSeq) {
                setSettlingFlag(false);
                flushSettleWaiters();
            }
        };
        const parkAndEnd = () => {
            $tree.scrollTop = savedTop; // clamps to the true bottom — deterministic
            applied = $tree.scrollTop;
            rescueApplied = applied;
            anchorAdjust(); // the remembered row is the better "best position"
            done();
        };
        const step = () => {
            if (seq !== rescueSeq)
                return; // superseded — the newer campaign owns state and waiters
            if ($tree.scrollTop !== applied) {
                done(); // taken over — the scroller owns it now
                return;
            }
            if (landedOnce) {
                // Pixel-landing is not the end: the geometry may still be
                // settling (cv bands render late; a fast walk can land in
                // the middle of the growth), and the remembered ROW is the
                // real target — re-verify it, then hold until the
                // scrollHeight has held still for three checks. With the
                // campaign-scoped overflow-anchor suppression nothing moves
                // scrollTop but the user; when the anchoring resumes at the
                // end it protects a final, row-accurate view.
                if (anchorAdjust())
                    stableSteps = 0;
                const sh = $tree.scrollHeight;
                stableSteps = sh === lastSh ? stableSteps + 1 : 0;
                lastSh = sh;
                if (stableSteps >= 3) {
                    done();
                    return;
                }
                setTimeout(step, 100);
                return;
            }
            if (revealMode && !revealed) {
                // Platform hop: scrollIntoView renders + scrolls to the
                // remembered row (the "visit the target band" property the
                // band walk re-implements by hand), then the handshake owns
                // the resulting scroll event and the shared stabilization
                // watch takes over.
                const row = document.getElementById(`neat-tree-item-${anchor.id}`);
                if (row && typeof row.scrollIntoView === 'function')
                    row.scrollIntoView({ block: 'start', behavior: 'instant' });
                else
                    $tree.scrollTop = savedTop; // no platform — plain re-assert
                applied = $tree.scrollTop;
                rescueApplied = applied;
                anchorAdjust(); // restore the saved sub-row offset (post-reveal measure)
                revealed = true;
                landedOnce = true; // subsequent steps: the shared stabilization watch
                setTimeout(step, 100);
                return;
            }
            if (walkPos >= 0 && ++walkTicks > walkCap()) {
                parkAndEnd(); // pathological walk — bounded like the climb
                return;
            }
            const target = walkPos >= 0 ? Math.min(walkPos, savedTop) : savedTop;
            const prev = applied;
            $tree.scrollTop = target;
            applied = $tree.scrollTop;
            rescueApplied = applied;
            if (applied > bestApplied)
                bestApplied = applied;
            if (applied >= savedTop) {
                // landed — enter the stabilization watch
                landedOnce = true;
                stableSteps = 0;
                lastSh = $tree.scrollHeight;
                setTimeout(step, 100);
                return;
            }
            if (walkPos >= 0) {
                let delay = 16;
                if (applied >= target - 1) {
                    // the band landed — visit the next one; the walk must
                    // never outrun the frontier it is forcing
                    walkPos += viewStep();
                } else {
                    // the band did NOT land — the frontier stalled behind
                    // the walk (a band rendered a frame late, or the tree
                    // cannot hold the target). Re-walk from band zero on
                    // the settle clock; only after the walk has outlived a
                    // full settle window AND two passes made no frontier
                    // progress at all may it park — a staged settle keeps
                    // the frontier dead for seconds before the first band
                    // renders (the probes: ~1.5-1.8s of dead phase).
                    if (bestApplied > passBest)
                        stalledPasses = 0;
                    else
                        stalledPasses++;
                    passBest = bestApplied;
                    if (stalledPasses >= 2 && walkClock >= 3000) {
                        parkAndEnd();
                        return;
                    }
                    walkPos = 0;
                    delay = 100;
                }
                walkClock += delay;
                setTimeout(step, delay);
                return;
            }
            stallSteps = applied > prev ? 0 : stallSteps + 1;
            if (stallSteps >= 2) {
                walkPos = 0; // frontier stalled — walk from band zero
                passBest = bestApplied;
            }
            if (++rafFrames <= 30)
                requestAnimationFrame(step);
            else if (++tailTicks <= 40)
                setTimeout(step, 100);
            else
                done(); // never fit — give up quietly
        };
        rescueApplied = applied;
        requestAnimationFrame(step);
    };

    const generateTree = tree => {
        let subTree;
        if (onlyShowBMBar && !showAllOverride) {
            // Find the bookmarks bar folder using folderType instead of fixed position
            const bookmarksBarFolder = treeRender.findFolderByType(tree, 'bookmarks-bar');
            if (bookmarksBarFolder) {
                subTree = bookmarksBarFolder.children || [];
            } else {
                // Fallback to old logic if folderType not available
                subTree = tree[0].children[0].children;
            }
        } else {
            // Use getEffectiveSubTree to handle dual-storage Chrome
            subTree = treeRender.getEffectiveSubTree(tree);
        }
        // P1-1: buildTreeSnapshot walks the FULL tree once and returns the
        // rendered HTML + every derived map (nodeTrees/bookmarkIds/paths/ids)
        // in a single pass — no more generateNodeTrees/addBookmarkParents/
        // buildPathMap repeats. Minimal test doubles without the snapshot
        // API keep the old three-walk path.
        let snapshot = null;
        let html;
        if (treeRender.buildTreeSnapshot) {
            snapshot = treeRender.buildTreeSnapshot(tree, subTree);
            html = snapshot.html;
            if (snapshot.paths)
                lastPathsMap = snapshot.paths;
            for (const [id, parentId] of Object.entries(snapshot.nodeTrees))
                nodeTrees[id] = parentId;
            for (const id of snapshot.bookmarkIds)
                bookmarkIds.add(id);
        } else {
            html = treeRender.generateHTML(subTree);
            treeRender.generateNodeTrees(subTree, nodeTrees);
            addBookmarkParents(subTree);
        }

        // 4.0.1 focus law: the innerHTML swap below replaces every row, so a
        // focused row would drop to <body> and the ↓ walk would die. Park it
        // before the swap, restore after — unconditionally: by row id when
        // the bookmark survives, else the clamped index of the row that took
        // its place.
        const parked = parkRowFocus($tree);

        // 2026-08-28 perf 任务④ — CHUNKED first paint for big, "shallow"
        // renders: the one-shot swap parses the WHOLE 7MB tree string before
        // the first row shows (the maintainer's real 5161-URL cold open).
        // Gate (all must hold — every interactive restore path stays on the
        // synchronous old road):
        //   · the snapshot produced top-level blocks;
        //   · the estimated row count clears CHUNK_MIN_ROWS;
        //   · NO remembered deep scroll (scrollTop within the first
        //     viewport) — a remembered position must restore instantly;
        //   · NO focusID memory — the reveal/restore row may sit deep.
        // Mechanics: first chunk (~3 viewports of rows) lands synchronously,
        // the rest streams in per animation frame; scroll/focusin/dragstart
        // FLUSH the remainder synchronously (nobody scrolls into missing
        // rows); the focus/scroll restores run at settle (shallow by gate).
        // Geometry-less doubles (unit tests) fall back to the sync swap.
        let chunked = null;
        if (snapshot && snapshot.blocks && snapshot.blocks.length > 4) {
            const estRows = estimateTreeRows(snapshot.blocks);
            // 分层记忆: scroll layer off → no restore target, gate reads 0
            const savedTop = store.get('rememberScroll', '1')
                ? (parseInt(store.get('scrollTop') || '0', 10) || 0) : 0;
            const viewH = ($tree.clientHeight || 620);
            const hasFocusMemory = !!store.get('focusID');
            if (estRows > CHUNK_MIN_ROWS && savedTop <= viewH && !hasFocusMemory)
                chunked = paintTreeChunked(snapshot.blocks, tree, snapshot);
        }
        // 4.1.4 实验室 gate: the cv:auto fast path applies to the freshly
        // swapped rows only while treeCvLab is on (default off). The class
        // must land BEFORE the swap so the inserted rows inherit the rule.
        if ($tree.classList)
            $tree.classList.toggle('cv-tree', treeCvOn());
        if (!chunked)
            $tree.innerHTML = html;

        // v4 task-2 §3.6: the view layer rebuilds its shared id→parent-path
        // map from the same full tree (list-row path labels). AFTER the
        // innerHTML swap — the hook also re-lays DOM overlays (slice C's
        // dead-mark ×, 第五轮项3), which the swap itself just wiped.
        if (onTreeGenerated)
            onTreeGenerated(tree, snapshot);

        if (getRememberState() && store.get('rememberScroll', '1')) {
            const savedTop = parseInt(store.get('scrollTop') || '0', 10) || 0;
            $tree.scrollTop = savedTop;
            const scrollAnchor = parseScrollAnchor(store.get('scrollAnchor'));
            if (!treeCvOn()) {
                // cv off (default, ≤4.0.8 semantics): the assignment above
                // forced the whole tree's layout synchronously and landed
                // exactly — issues #65-#68's clamp/deadlock/walk machinery
                // only exists under cv. One-shot anchor re-assert covers
                // the only cross-geometry case left: the saved pixel was
                // captured while the lab was ON (placeholder mosaics) or
                // bookmarks changed. No campaign, no timers.
                applyAnchorAdjust(scrollAnchor);
            } else if (savedTop > 0
                && ($tree.scrollTop < savedTop || scrollAnchor)
                && typeof requestAnimationFrame === 'function') {
                // cv on (lab): the 4.1.x campaign owns the restore — see
                // the scrollRescue contract above (clamp retry, walk,
                // handshake, stabilization; or the reveal transport when
                // treeCvRevealLab is on).
                scrollRescue(savedTop, scrollAnchor);
            }
        }
        // after the scroll baseline is back — the focusID reveal below must
        // never move it (preventScroll): the remembered position is where the
        // user left the view, the highlight only marks the row.
        if (chunked)
            chunked.settle(() => unparkRowFocus($tree, parked));
        else
            unparkRowFocus($tree, parked);

        // issue #58: the focusID restore (refocus + .focus highlight-flash,
        // which re-paints the last-focused row on every open) is part of
        // "remember previous state" — gate it with the rest so the existing
        // remember-prev-state option turns the whole restore off (scroll,
        // opened folders AND the focus highlight), instead of only the first
        // two. revealFolder/revealInTree force rememberState=true on purpose,
        // so explicit "reveal in tree" keeps working with the option off.
        // issue #64: focusSearchOnOpen stands the row re-focus down (the
        // search input's autofocus owns the startup focus); the stale
        // focusID is dropped so a later bookmark-event re-render doesn't
        // scrollIntoView a row the user never restored to.
        // 分层记忆: rememberHighlight off → no row re-highlight/refocus (the
        // user-requested "disable the last-opened bookmark highlight");
        // the stale focusID is dropped either way so a later bookmark-event
        // re-render never scrollIntoViews an unrestored row.
        if (getRememberState() && store.get('rememberHighlight', '1') && !getFocusSearchOnOpen()) {
            const focusID = store.get('focusID');
            // The park/restore law above may already have re-focused a live
            // row. The reveal treatment (.focus flash + keyboard focus,
            // never a scroll — preventScroll) is for the reopen case — skip
            // it when the restored row IS the
            // focusID row; a DIFFERENT focusID means an explicit reveal
            // (revealFolder ran while a tree row still held focus) and wins.
            const parkedId = parked ? `${parked.id || ''}`.replace('neat-tree-item-', '') : '';
            if (typeof focusID !== 'undefined' && focusID !== null && `${focusID}` !== parkedId) {
                const focusEl = document.getElementById(`neat-tree-item-${focusID}`);
                if (focusEl) {
                    const focusTarget = focusEl.firstElementChild;
                    // A row without a focusable child (detached/mid-render) has
                    // no reveal target — skip the highlight; the cleanup timer
                    // below still runs.
                    if (focusTarget) {
                        focusTarget.classList.add('focus');
                        // The blueFade class only paints the reveal highlight — the
                        // row must ALSO take keyboard focus, or an "reveal in tree"
                        // from another view strands the user with no way to continue
                        // (arrow keys do nothing until they click). The tree rows are
                        // tabindex="-1"; a programmatic focus() here is what makes
                        // ArrowUp/Down/Right walk on from the revealed row. The focus
                        // listener removes the .focus class on its event — re-apply it
                        // after focus() so the reveal highlight is not wiped by the
                        // very focus we just granted.
                        // issues #65/#66: preventScroll — a bare focus() scrolls the
                        // row into view and overrides the restored scroll position
                        // (the user scrolled away from the row before closing: the
                        // reopen then "resets to the top"). The old overflow:hidden
                        // dance around this call (Neat-era) never actually stopped
                        // focus-scrolling in Chromium; the option does. Arrow keys
                        // still reveal the focused row the moment the user walks.
                        // Residual round: the focus GRANT waits for a live scroll
                        // campaign to land — an off-viewport focused row hijacks
                        // Chrome's scroll anchor during the layout settle and the
                        // compensation jumps the viewport toward the row (the
                        // "drift"); after the settle the anchor stays in-viewport
                        // and the compensation protects the restored view instead.
                        const grantFocus = () => {
                            if (focusTarget.focus)
                                focusTarget.focus({ preventScroll: true });
                            focusTarget.classList.add('focus');
                        };
                        if (treeSettling())
                            whenTreeScrollSettled(grantFocus);
                        else
                            grantFocus();
                        focusTarget.classList.add('focus');
                    }
                    setTimeout(() => {
                        store.remove('focusID');
                    }, 4000);
                }
            }
        } else if (getRememberState() && (getFocusSearchOnOpen() || !store.get('rememberHighlight', '1'))) {
            // issue #64: no row re-focus — drop the stale focusID eagerly
            // (the 4s delayed cleanup above belongs to the restore branch).
            store.remove('focusID');
        }

        // try to load local separator list used in last version
        const sm = new SeparatorManager(store);
        sm.load();
        const seps = sm.getAll();
        for (let i = 0; i < seps.length; i++) {
            if (seps[i]) {
                actions.addSeparator(seps[i], 'after');
            }
        }
        // and discard this setting from now on
        sm.clear();
        sm.save();

        tree = null;
    };

    // 启动时生成整棵树（8b 起随本模块一并剥离）
    chrome.bookmarks.getTree(generateTree);

    // ---- 2026-08-28 perf 任务④: chunked first paint for big shallow trees ----
    // One <li>-counting helper + the painter itself. The painter lives at
    // module scope (not inside generateTree) so a NEW generateTree can cancel
    // an in-flight stream before parking/swapping over it.
    const CHUNK_MIN_ROWS = 400;       // below this the sync swap wins outright
    const CHUNK_FIRST_ROWS = 100;     // ~3 viewports land synchronously
    const liOpenings = piece => {
        let n = 0, at = -1;
        while ((at = piece.indexOf('<li', at + 1)) !== -1) {
            if (at + 3 >= piece.length || /[\s>]/.test(piece[at + 3]))
                n++;
        }
        return n;
    };
    const estimateTreeRows = blocks => {
        let n = 0;
        for (let i = 0; i < blocks.length; i++)
            n += liOpenings(blocks[i]);
        return n;
    };
    let activeChunk = null;

    // Streams the top-level blocks: first chunk synchronously (the caller
    // then runs onTreeGenerated over it), the rest per animation frame.
    // scroll/focusin/dragstart flush synchronously — nothing interactive
    // ever meets a missing row. settle(fn) fires once the full tree is in
    // (flush included). Returns null when the environment (or a tiny first
    // chunk) can't stream — the caller falls back to the one-shot swap.
    const paintTreeChunked = (blocks, tree, snapshot) => {
        if (typeof requestAnimationFrame !== 'function' || !snapshot)
            return null;
        // first-chunk span: enough blocks to clear CHUNK_FIRST_ROWS
        let firstCount = 0, rows = 0;
        for (let i = 0; i < blocks.length && rows < CHUNK_FIRST_ROWS; i++) {
            rows += liOpenings(blocks[i]);
            firstCount++;
        }
        if (firstCount >= blocks.length)
            return null; // the whole tree IS the first chunk — sync swap
        if (activeChunk)
            activeChunk.cancel();
        const head = `<ul role="tree" data-level="0">${blocks.slice(0, firstCount).join('')}</ul>`;
        $tree.innerHTML = head;
        const ul = $tree.querySelector('ul');
        if (!ul || typeof ul.insertAdjacentHTML !== 'function')
            return null; // geometry-less double — the caller re-swaps html
        let next = firstCount;
        let done = false;
        let raf = 0;
        const settled = [];
        const state = {
            settle(fn) {
                if (done)
                    fn();
                else
                    settled.push(fn);
            },
            cancel() {
                done = true;
                if (raf)
                    cancelAnimationFrame(raf);
                detach();
            }
        };
        const finish = () => {
            if (done)
                return;
            done = true;
            detach();
            for (const fn of settled)
                fn();
            settled.length = 0;
        };
        const flush = () => {
            if (done || next >= blocks.length)
                return;
            ul.insertAdjacentHTML('beforeend', blocks.slice(next).join(''));
            next = blocks.length;
            finish();
        };
        const step = () => {
            if (done)
                return;
            if (next >= blocks.length) {
                finish();
                return;
            }
            // one frame ≈ a few blocks, capped by string weight (a top
            // folder can be a megabyte of rows on its own)
            let bytes = 0;
            const upto = next;
            while (next < blocks.length && (bytes < 262144 || next === upto)) {
                bytes += blocks[next].length;
                next++;
            }
            ul.insertAdjacentHTML('beforeend', blocks.slice(upto, next).join(''));
            if (next >= blocks.length)
                finish();
            else
                raf = requestAnimationFrame(step);
        };
        const onMaybeFlush = () => flush();
        const attach = () => {
            $tree.addEventListener('scroll', onMaybeFlush, { passive: true, capture: true });
            $tree.addEventListener('focusin', onMaybeFlush, true);
            document.addEventListener('dragstart', onMaybeFlush, true);
        };
        const detach = () => {
            $tree.removeEventListener('scroll', onMaybeFlush, { capture: true });
            $tree.removeEventListener('focusin', onMaybeFlush, true);
            document.removeEventListener('dragstart', onMaybeFlush, true);
        };
        attach();
        raf = requestAnimationFrame(step);
        activeChunk = state;
        return state;
    };

    // Events for the tree
    $tree.addEventListener('scroll', () => {
            // Any scroll that is not the campaign's own applied value — the
            // user, a reveal's scrollIntoView — takes over, cancels the
            // campaign and persists normally: the pixel AND the row anchor
            // (the anchor is what survives content-stable compensation —
            // the view does not move, but the pixel does).
            if (rescueApplied >= 0 && $tree.scrollTop === rescueApplied)
                return;
            rescueApplied = -1;
            store.set('scrollTop', $tree.scrollTop);
            store.set('scrollAnchor', treeAnchor());
        });
    $tree.addEventListener('focus', e => {
        const el = e.target;
        const tagName = el.tagName;
        const focusEl = $tree.querySelector('.focus');
        if (focusEl)
            focusEl.classList.remove('focus');
        if (tagName === 'A' || tagName === 'SPAN') {
            store.set('focusID', el.parentNode.id.replace('neat-tree-item-', ''));
        } else {
            store.set('focusID', null);
        }
    }, true);
    const closeUnusedFolders = store.get('closeUnusedFolders');
    // A folder plane's flip cascades: the folder's own button AND every
    // descendant row's plane inside its expanded subtree (the tree only
    // re-renders on bookmark events — the visual sync is our job here).
    const flipFolderPlanes = (folderLi, staged, _m2) => {
        if (!folderLi || !folderLi.querySelectorAll)
            return;
        flipStageBtn(folderLi.querySelector(':scope > span .staging-add-btn'), staged, _m2);
        for (const btn of folderLi.querySelectorAll('ul .staging-add-btn'))
            flipStageBtn(btn, staged, _m2);
    };

    // Tree-row hover quick actions (编辑/发送到暂存/删除): capture-phase so
    // the buttons win over bookmarkHandler (a click on a button inside the
    // row anchor would otherwise open the bookmark). Folder rows skip the
    // plane (their stage entry is the menu's flatten-send).
    $tree.addEventListener('click', e => {
        if (e.button !== 0)
            return;
        const btn = e.target && e.target.closest ? e.target.closest('.tree-row-btn, #tree .staging-add-btn') : null;
        if (!btn)
            return;
        e.preventDefault();
        e.stopPropagation();
        const li = btn.closest('li');
        const id = li ? String(li.id).replace(/^neat-tree-item-/, '') : '';
        if (!id)
            return;
        const _m2 = chrome.i18n.getMessage;
        if (btn.classList.contains('tree-row-edit')) {
            ctx.actions.editBookmarkFolder(id);
        } else if (btn.classList.contains('tree-row-delete')) {
            if (li.classList.contains('parent')) {
                chrome.bookmarks.getChildren(id, children => {
                    if (chrome.runtime.lastError)
                        return;
                    children = children || [];
                    const urlsLen = children.map(c => c.url).filter(Boolean).length;
                    ctx.actions.deleteBookmarks(id, urlsLen, children.length - urlsLen);
                });
            } else {
                ctx.actions.deleteBookmark(id);
            }
        } else if (btn.classList.contains('staging-add-btn') && ctx.staging) {
            if (li.classList.contains('parent')) {
                // A FOLDER plane is a symmetric toggle: unstaged → the menu's
                // flatten-send (every descendant joins as one sourceFolderId
                // group, >100 confirm inside); all-staged → every descendant
                // item leaves (batch exit with toast undo).
                chrome.bookmarks.getSubTree(id, nodes => {
                    if (chrome.runtime.lastError || !nodes || !nodes.length)
                        return;
                    const urls = [];
                    const walk = n => {
                        for (const c of (n.children) || []) {
                            if (c.url)
                                urls.push(c.url);
                            else
                                walk(c);
                        }
                    };
                    walk(nodes[0]);
                    const bookmarkable = urls.filter(u => !/^javascript:/i.test(u));
                    const allStaged = bookmarkable.length > 0
                        && bookmarkable.every(u => ctx.staging.isStaged(u));
                    if (allStaged) {
                        ctx.staging.removeByUrls(bookmarkable);
                        flipFolderPlanes(li, false, _m2);
                    } else {
                        ctx.staging.sendFolder(id);
                        flipFolderPlanes(li, true, _m2);
                    }
                });
            } else {
                const a = li.querySelector('a');
                const url = a ? a.getAttribute('href') : '';
                const nowStaged = toggleStageItem(ctx.staging, { id, url });
                if (nowStaged !== null)
                    flipStageBtn(btn, nowStaged, _m2);
            }
        }
    }, true);
    $tree.addEventListener('click', e => {
        if (e.button !== 0)
            return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName !== 'SPAN')
            return;
        if (e.shiftKey || e.ctrlKey)
            return;
        const parent = el.parentNode;
        parent.classList.toggle('open');
        const expanded = parent.classList.contains('open');
        parent.setAttribute('aria-expanded', expanded);
        const children = parent.querySelector('ul');
        // expand children for unexpanded folder node
        if (!children) {
            const id = parent.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id, children => {
                // A stale row (folder deleted/synced away meanwhile) makes
                // getChildren fail — read lastError so Chrome doesn't surface
                // the "Bookmark id is invalid" warning, then skip silently.
                if (chrome.runtime.lastError)
                    return;
                // same undefined-guard as bookmarkHandler's folder branch
                children = children || [];
                // lastPathsMap: the lazy rows carry the full-info tooltip too
                const html = treeRender.generateHTML(children, parseInt(parent.parentNode.dataset.level) + 1, lastPathsMap);
                const div = document.createElement('div');
                div.innerHTML = html;
                const ul = div.querySelector('ul');
                parent.appendChild(ul);
                div.remove();
                onRowsRendered(); // 第五轮项3: overlays for the fresh rows
            });
        }
        if (closeUnusedFolders && expanded) {
            // neatools 的 getSiblings 忽略其选择器实参、返回全部元素兄弟
            // （先后再前）；此循环与顺序无关，且 ul 的子元素本就全是 li。
            const siblings = Array.from(parent.parentNode.children).filter(sib => sib !== parent && sib.tagName === 'LI');
            for (let i = 0, l = siblings.length; i < l; i++) {
                const li = siblings[i];
                if (li.classList.contains('parent')) {
                    li.classList.remove('open');
                    li.setAttribute('aria-expanded', false);
                }
            }
        }
        // 局部变量：展开状态只持久化到 store；内存里的 opens（generateHTML
        // 经 getOpens 读取）保持启动时的值，与原实现一致。
        let opens = $tree.querySelectorAll('li.open');
        opens = Array.from(opens).map(li => li.id.replace('neat-tree-item-', ''));
        store.set('opens', JSON.stringify(opens));
    });
    // Force middle clicks to trigger the focus event
    $tree.addEventListener('mouseup', e => {
        if (e.button !== 1)
            return;
        const el = e.target;
        const tagName = el.tagName;
        if (tagName !== 'A' && tagName !== 'SPAN')
            return;
        el.focus();
    });

    function generateTreeForTarget(trees) {
        generateTree(trees);
        // This must be put int chrome API handler function.
        // Otherwise it may be called before generation completed.
        if (store.get('focusID')) {
            const item = $tree.querySelector(`#neat-tree-item-${store.get('focusID')}`);
            if (item) {
                item.scrollIntoView();
            }
        }
        store.set('scrollTop', $tree.scrollTop);
        store.set('scrollAnchor', treeAnchor());
    }

    // Reveal a folder in the tree: quit search, open its ancestor chain,
    // force remember-state recovery, focus it and rebuild with the scroll
    // handler. Extracted from bookmarkHandler's link-folder branch (P2) so the
    // command palette's "jump to folder" can reuse the exact same sequence.
    const revealFolder = id => {
        // switch to tree
        search.quit();
        // all parent folder ids
        // set them as opened folders
        let newOpens = treeRender.getParentPath(id, nodeTrees);
        // A bookmark's path ends with the bookmark itself — drop it: the
        // opens list may only hold folders (a bookmark row has no children
        // to expand, and li.open rows get persisted back into opens).
        if (bookmarkIds.has(`${id}`))
            newOpens = newOpens.slice(0, -1);
        setOpens(newOpens);
        store.set('opens', JSON.stringify(newOpens));
        // force to recover from remember state (opened folders)
        setRememberState(true);
        // focus on the target folder
        store.set('focusID', id);
        // new handler to handle the scrolling
        chrome.bookmarks.getTree(generateTreeForTarget);
    };

    // v4 task-2 (docs/plan-4.0.0/v4task-2-list.md §2.3): "Reveal in tree" from any list
    // view (recent/search R key + context-menu item) — activate the tree
    // view, then run the same reveal chain (works for bookmark ids too: the
    // row is focused via focusID, its ancestors opened).
    const revealInTree = id => {
        // v4 task-3 #14: with "only show the bookmarks bar" on, a target
        // outside the bar subtree has no nodeTrees entry at all — the old
        // chain then silently revealed nothing (getParentPath degenerated to
        // the bare id, the row never rendered). Instead of quietly failing,
        // explain via toast and offer a one-click, session-only override
        // that shows the full tree and completes the reveal. The user stays
        // in the current view until they explicitly pick the action.
        if (onlyShowBMBar && !showAllOverride && nodeTrees[id] === undefined && toastAction) {
            toastAction(
                chrome.i18n.getMessage('revealOutsideBarHint'),
                chrome.i18n.getMessage('revealOutsideBarAction'),
                () => {
                    showAllOverride = true;
                    // nodeTrees still maps the bar-only render — regenerate
                    // over the full tree first so revealFolder's
                    // getParentPath resolves the real ancestor chain.
                    chrome.bookmarks.getTree(tree => {
                        generateTree(tree);
                        revealFolder(id);
                        if (views)
                            views.activate('tree', { keepFocus: true });
                    });
                });
            return;
        }
        revealFolder(id);
        if (views)
            views.activate('tree', { keepFocus: true });
    };

    const bookmarkHandler = e => {
        e.preventDefault();
        if (e.button !== 0 && e.button !== 1)
            return;
        // only take left-click
        // noOpenBookmark 已收归 src/dnd.js：拖拽落点无效时吞掉随后的点击
        if (dnd.consumeNoOpen()) // flag that disables opening bookmark
            return;
        const el = e.target;
        const ctrlMeta = (e.ctrlKey || e.metaKey || (e.button === 1));
        const shift = e.shiftKey;
        if (el.tagName === 'A' && !el.querySelector('hr')) { // bookmark
            // Search-result / palette folder rows carry `link-folder tree-item-link`
            // — a classList membership test, never an exact className match
            // (the exact match silently fell through to the bookmark-open
            // branch and opened the popup page's own URL in a new tab).
            if (el.classList.contains('link-folder')) { // search result folder
                // get folder id (el parent is li); data-node-id is the
                // v4 task-2 unified row id
                const id = el.parentNode.dataset.nodeId
                    || el.parentNode.id.replace(/(neat-tree|neat-recent|results|recent)-item-/, '');
                revealInTree(id);
            } else {
                const url = el.href;
                // v4 task-2 slice D (§5.4): every bookmark open — mouse,
                // middle-click or the keyboard's synthetic click — funnels
                // through here, so this single hook is the page-side visit
                // collector. data-node-id is the unified row id; the legacy
                // prefix strip covers rows that predate it.
                if (ctx.onOpenBookmark) {
                    const openId = el.parentNode.dataset.nodeId
                        || el.parentNode.id.replace(/(neat-tree|neat-recent|results|recent|dead|dupes|stats)-item-/, '');
                    // velvet staging §2.4: unbookmarked staging rows have no
                    // tree id — their opens must not feed visit stats (an
                    // ordinal row id would pollute the dataset).
                    if (!el.parentNode.id.startsWith('staging-item-'))
                        ctx.onOpenBookmark(openId, url);
                }
                if (ctrlMeta) { // ctrl/meta click
                    actions.openBookmarkNewTab(url, middleClickBgTab ? shift : !shift);
                } else { // click
                    if (shift) {
                        actions.openBookmarkNewWindow(url);
                    } else {
                        leftClickNewTab ? actions.openBookmarkNewTab(url, true, true) : actions.openBookmark(url);
                    }
                }
                search.reset();
            }
        } else if (el.tagName === 'SPAN') { // folder
            const li = el.parentNode;
            const id = li.id.replace('neat-tree-item-', '');
            chrome.bookmarks.getChildren(id, children => {
                // A stale/ghost row (folder deleted meanwhile, or an id that
                // never resolves) makes getChildren call back with undefined
                // + lastError — read lastError to keep Chrome from surfacing
                // the "Bookmark id is invalid" warning, then guard the map.
                if (chrome.runtime.lastError)
                    return;
                const urls = (children || []).map(c => c.url).filter(Boolean);
                const urlsLen = urls.length;
                if (!urlsLen)
                    return;
                if (ctrlMeta) { // ctrl/meta click
                    actions.openBookmarks(urls, middleClickBgTab ? shift : !shift);
                } else if (shift) { // shift click
                    actions.openBookmarksNewWindow(urls);
                }
            });
        }
    };
    $tree.addEventListener('click', bookmarkHandler);
    search.results.addEventListener('click', bookmarkHandler);
    $tree.addEventListener('auxclick', bookmarkHandler);
    // Middle-click parity on the search results pane (the click-only binding
    // above was a legacy gap): auxclick with button 1 opens in a tab like a
    // ctrl-click, per bookmarkHandler's own modifier mapping.
    search.results.addEventListener('auxclick', bookmarkHandler);

    return {
        generateTree,
        revealFolder,
        revealInTree,
        // bound per list container: tree above, search results above, and the
        // recent view's list (src/view-recent.js)
        bookmarkHandler
    };
}
