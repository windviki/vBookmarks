/**
 * Staging view (velvet staging — docs/plan-velvet/velvet-feat-staging-glm.md).
 *
 * The former "recently added" tab (v4 task-2 slice B) upgrades into the
 * staging area: a decision workbench collecting bookmarks from every other
 * view for bulk organization. Layout is one scrolling container with two
 * regions — the staging list (dual-state rows: `id`-anchored = bookmarked,
 * `id = null` = url/title snapshot from stats history rows) on top, the
 * classic recently-added list below a foldable section head. Both regions
 * are sibling `<ul>`s inside `#staging-list`, so keyboard.js's crossRowUl
 * walks across them with zero new mechanism.
 *
 * The view keeps the `recent` view id, `#view-recent` container and the
 * `showRecentBookmarks`/`disableRecentView` setting keys — view-manager
 * registration, palette Go commands, Alt+N and viewState memory all keep
 * working. The tab title reads "Staging" (viewRecent reworded).
 *
 * Sending NEVER touches the tree (the requirement's only constraint); the
 * organize actions executed ON the staging rows are real (handled from
 * ST4/ST5 — favorite toggling, move/copy home, delete). Entries join by
 * URL uniqueness (src/staging.js owns the model).
 *
 * Tree-event sync (§0.5): onCreated promotes a matching id-less row, an
 * onRemoved anchor re-verifies through chrome.bookmarks.search (relink or
 * fall back to id=null — never silently drop), onChanged keeps snapshots
 * fresh. Every tree rebuild also feeds onTreeSnapshot (neat.js wires the
 * buildTreeSnapshot pass) for a full-index relink. chrome.storage.onChanged
 * replays the whole `staging` object when the other document writes it.
 *
 * initViewRecent(ctx) is called once by neat.js after treeView init.
 * ctx.store / ctx.views / ctx.treeRender / ctx.separatorManager /
 * ctx.treeView — as before; ctx.dialogs gates the >100-folder confirm;
 * ctx.visitStats + ctx.undo serve the history-permission banner; the
 * returned { refresh, api, onTreeSnapshot } is consumed by neat.js (the
 * api feeds context-menu / stats / tabgroups send entries).
 */

import { relTimeLabel } from './tree-render.js';
import { paintListChunked } from './list-chunks.js';
import { VIEW_ICONS, STAGE_ICON, STAGE_ICON_DONE, STAGE_REMOVE_ICON, STAR_ICON, STAR_ICON_FILLED, STAR_X_ICON, SELECT_ICON, FOLDER_STAR_ICON, FOLDER_PLUS_ICON, FOLDER_ICON, CLOCK_ICON, EDIT_ICON, TRASH_ICON, LIST_X_ICON, OPEN_ICON, TABS_ICON, GROUP_ICON, UNGROUP_ICON, SCISSORS_ICON, COLLAPSE_ALL_ICON, EXPAND_ALL_ICON } from './icons.js';
import { htmlspecialchars } from './escape.js';
import { parkRowFocus, unparkRowFocus, parkToolbarFocus, restoreToolbarFocus } from './list-focus.js';
import { flipStageBtn } from './staging-relay.js';
import { fitToolbarLabels, watchToolbarFit } from './toolbar-fit.js';
import * as staging from './staging.js';

export function initViewRecent(ctx = {}) {
    const $ = id => document.getElementById(id);
    const _m = chrome.i18n.getMessage;
    const store = ctx.store;
    const views = ctx.views;
    const treeRender = ctx.treeRender;
    const separatorManager = ctx.separatorManager;
    const treeView = ctx.treeView;
    const dialogs = ctx.dialogs || null;
    // History-permission banner collaborators (both optional so minimal
    // test setups keep working; neat.js always injects them).
    const visitStats = ctx.visitStats || { enabled: () => false, merge: () => 0 };
    const undo = ctx.undo || { showToast: () => {} };
    // 第五轮项3: after every render, neat.js re-lays the dead-mark ×
    // overlays (the innerHTML swap just wiped them).
    const onRowsRendered = ctx.onRowsRendered || (() => {});

    const $list = $('staging-list');

    const enabled = () => !!store.get('showRecentBookmarks', '1');
    // The staging master switch (options 暂存和最近添加 → stagingEnabled,
    // default on): off collapses the view to the classic recently-added
    // list — no workbench chrome, no toolbar, and every other view's
    // staging entries hide (they read this through api.isEnabled).
    const stagingOn = () => store.get('stagingEnabled', '1') === '1';
    const recentCount = () => {
        const n = parseInt(store.get('recentCount', '20'), 10);
        return n > 0 ? n : 20;
    };
    const toast = msg => undo.showToast(msg);

    // --- Staging state (src/staging.js owns the model) --------------------
    let stagingState = staging.parse(store.get('staging'));

    // chrome.storage.onChanged ALSO fires in the document that made the write
    // (verified against a real Chrome) — every persistStaging() would echo
    // back ~200ms later as a phantom cross-document replay (a second full
    // re-render + a stagingState object swap that can strand in-flight batch
    // closures on the stale object). Track the exact bytes we flushed; an
    // echo that matches ANY of our own recent writes is skipped. A genuine
    // external write can never byte-match one of ours unless the state is
    // identical — in which case skipping the replay is exactly right.
    const ownWrites = [];
    const rememberOwnWrite = raw => {
        ownWrites.push(raw);
        if (ownWrites.length > 16)
            ownWrites.shift();
    };

    const persistStaging = () => {
        const raw = staging.serialize(stagingState);
        rememberOwnWrite(raw);
        store.set('staging', raw);
        views.updateBadges(); // store.set does not auto-update tab badges
    };

    // Move-to-folder shortcut chips (the selection bar's customizable
    // quick row) — same device-local persistence discipline as staging:
    // byte-compare our own writes against the onChanged echo.
    let shortcuts = staging.parseShortcuts(store.get('stagingShortcuts'));
    const ownShortcutWrites = [];
    const persistShortcuts = () => {
        const raw = staging.serializeShortcuts(shortcuts);
        ownShortcutWrites.push(raw);
        if (ownShortcutWrites.length > 8)
            ownShortcutWrites.shift();
        store.set('stagingShortcuts', raw);
    };

    // Staging-only repaint (defined further down, next to render/refresh):
    // rebuilds banner + toolbar + #staging-items in place and leaves the
    // recently-added region's DOM untouched, so a fold toggle / drag /
    // selection change no longer re-hydrates every recent-row favicon
    // (the "favicon refresh process" lag source).
    const renderStaging = () => {
        if (views.isActive('recent'))
            renderStagingNow();
        else
            dirty = true;
    };

    // --- History-permission banner ------------------------------------------
    // Shown while: stats on + permission missing + not dismissed. The grant
    // seeds visitStats once (statsHistoryImportedAt gates it); a grant that
    // lands while the popup is closed is picked up by the next probe.
    let historyPerm = null; // null = probe pending
    const statsOn = () => !!visitStats.enabled();
    const bannerDismissed = () => !!store.get('statsHistoryBannerDismissed');

    const bannerHtml = () => {
        if (!statsOn() || historyPerm !== false || bannerDismissed())
            return '';
        const dismissLabel = _m('statsHistoryDismiss');
        return `<div class="stats-history-banner" role="note">` +
            `<i>${htmlspecialchars(_m('statsHistoryBanner'))}</i>` +
            `<a href="" class="stats-history-enable" tabindex="-1">${htmlspecialchars(_m('statsHistoryEnable'))}</a>` +
            `<button type="button" class="row-btn stats-history-dismiss" tabindex="-1" ` +
            `aria-label="${htmlspecialchars(dismissLabel)}" title="${htmlspecialchars(dismissLabel)}">×</button>` +
            `</div>`;
    };

    // --- Staging guide strip (above the toolbar) -------------------------
    // One quiet line: organize bookmarks here; selection mode unlocks the
    // batch actions. The universal × is the session-level dismiss (the
    // risk-banner / dead marked-banner × law — the hint returns on the next
    // popup open); 不再提醒 is the permanent one.
    let guideDismissed = false;
    const stagingGuideHtml = () => {
        if (store.get('stagingGuideDismissed') || guideDismissed)
            return '';
        const dismissLabel = _m('stagingGuideDismiss');
        const closeLabel = _m('riskBannerDismiss');
        return `<div class="staging-guide-banner" role="note">` +
            `<i>${htmlspecialchars(_m('stagingGuideText'))}</i>` +
            `<button type="button" class="staging-guide-close" tabindex="-1" ` +
            `aria-label="${htmlspecialchars(closeLabel)}" title="${htmlspecialchars(closeLabel)}">×</button>` +
            `<button type="button" class="staging-guide-dismiss" tabindex="-1">` +
            htmlspecialchars(dismissLabel) + `</button>` +
            `</div>`;
    };

    const chromeHtml = () => bannerHtml() + stagingGuideHtml();

    // chrome.history.search returns one item per URL (visitCount already
    // aggregated), so the cap only bounds memory: 100000 distinct URLs is
    // 全量 (附录 B 项 7a) for any realistic profile — the old 2000 silently
    // dropped every older bookmark's visits.
    const HISTORY_IMPORT_MAX = 100000;

    // History normalizes bare hosts to a trailing slash while bookmarks keep
    // whatever was saved; matching on the slash-folded key pairs those up
    // (exact matches are unaffected). A scheme-relative '//' is never folded.
    const matchUrl = u =>
        (u.length > 1 && u.endsWith('/') && !u.endsWith('//')) ? u.slice(0, -1) : u;

    // Probes run at startup AND on every activate while the gate is unstamped,
    // and the search callback is async — without the guard two overlapping
    // probes would import twice, and merge is additive (every count doubles).
    let importPending = false;
    const importHistory = () => {
        if (!statsOn() || !chrome.history || !chrome.history.search)
            return;
        if (importPending)
            return;
        importPending = true;
        chrome.bookmarks.getTree(tree => {
            // URL → bookmark ids (duplicates share a URL; every copy earns
            // the same baseline so their relative order stays fair)
            const urlToIds = new Map();
            const walk = nodes => {
                for (let i = 0, l = nodes.length; i < l; i++) {
                    const node = nodes[i];
                    if (node.children)
                        walk(node.children);
                    else if (node.url) {
                        const key = matchUrl(node.url);
                        const ids = urlToIds.get(key);
                        if (ids)
                            ids.push(node.id);
                        else
                            urlToIds.set(key, [node.id]);
                    }
                }
            };
            walk(tree || []);
            chrome.history.search({ text: '', startTime: 0, maxResults: HISTORY_IMPORT_MAX }, items => {
                importPending = false;
                const entries = [];
                for (let i = 0, l = (items || []).length; i < l; i++) {
                    const h = items[i];
                    const ids = h.url && urlToIds.get(matchUrl(h.url));
                    if (!ids)
                        continue;
                    for (let j = 0; j < ids.length; j++)
                        entries.push({ id: ids[j], c: h.visitCount || 1, t: h.lastVisitTime || 0 });
                }
                // merge persists synchronously, so the gate stamped below can
                // never outlive the dataset (a debounced write dies with the
                // popup and the import would be skipped forever).
                const n = visitStats.merge(entries);
                store.set('statsHistoryImportedAt', `${Date.now()}`);
                undo.showToast(_m('statsHistoryImported', `${n}`));
                views.updateBadges(); // the stats tab count may have grown
                if (views.isActive('recent'))
                    refresh();
            });
        });
    };

    const probePermission = () => {
        if (!statsOn() || !(chrome.permissions && chrome.permissions.contains)) {
            historyPerm = null;
            return;
        }
        chrome.permissions.contains({ permissions: ['history'] }, granted => {
            const resolved = !!granted;
            const changed = historyPerm !== resolved;
            historyPerm = resolved;
            if (resolved && !store.get('statsHistoryImportedAt')) {
                importHistory(); // grant landed while the popup was closed
            } else if (changed && views.isActive('recent')) {
                refresh(); // the banner zone changed — repaint once
            }
            // An unchanged verdict needs no repaint: the activate() hook that
            // triggered this probe runs its own refresh — the old unconditional
            // refresh made every view entry paint twice.
        });
    };

    // --- Staging rows (§2.4/§3.4/§3.5) --------------------------------------
    // Render order: ① the unbookmarked inbox bucket (id=null && group=null,
    // rendered-partition derivation — the workbench's progress bar) →
    // ② groups by createdAt ascending → ③ bookmarked loose rows. Row ids
    // use the DATA index (`staging-item-<items[i]>`), so folding a group
    // never renumbers the others; `data-node-id` only exists on bookmarked
    // rows (context-menu routes on that difference) and `data-url` is the
    // row's identity key.
    // `L` = the per-render label cache (i18n hoisting, the 4.1.0 view-
    // tabgroups recipe): row loops re-read the SAME strings hundreds of
    // times — resolving them once per render costs one getMessage each.
    const stagingRowHtml = (it, idx, inGroup, L, lastMember = false) => {
        const path = it.id ? (views.pathOf(it.id) || '') : '';
        const rel = relTimeLabel(it.ts, _m);
        const subText = it.id
            ? ((views.showItemPath() && path) ? `${path} · ${rel}` : rel)
            : `${L.fromHistory} · ${rel}`;
        const starLabel = it.id ? L.rowUnfav : L.rowFav;
        const removeLabel = L.remove;
        const sel = selecting && selected.has(it.url);
        // draggable: the row is an HTML5 drag source (group-to-group moves,
        // staging-only bookkeeping). The anchor itself must opt OUT
        // (draggable="false") or Chrome starts a native link drag from it and
        // the li never becomes the source. Selection mode drops the affordance.
        const dragAttr = selecting ? '' : ' draggable="true"';
        return `<li class="vbm-row staging-row${inGroup ? ' staging-member' : ''}${lastMember ? ' staging-last' : ''}${sel ? ' sel' : ''}" id="staging-item-${idx}" role="listitem" ` +
            `data-url="${htmlspecialchars(it.url)}"${dragAttr}` +
            (it.id ? ` data-node-id="${it.id}" data-parentid=""` : '') + '>' +
            (inGroup ? '<span class="staging-connector" aria-hidden="true"></span>' : '') +
            treeRender.generateBookmarkHTML(it.title, it.url, 'data-virtual="1" draggable="false"', it.id || null, null, {
                path,
                badge: { text: rel, cls: 'time' },
                rightText: (views.showItemPath() && path) ? path : '',
                subText
            }) +
            // Selection mode shows only the checkbox affordance (§3.1 — the
            // row buttons leave the DOM entirely, not CSS-hidden).
            (selecting ? '' :
                // Real-state star slot (§2.4): always visible, filled = the
                // URL IS a tree node; click performs the real create/remove.
                `<button type="button" class="row-btn staging-star" aria-pressed="${it.id ? 'true' : 'false'}" ` +
                `aria-label="${htmlspecialchars(starLabel)}" title="${htmlspecialchars(starLabel)}">` +
                (it.id ? STAR_ICON_FILLED : STAR_ICON) + '</button>' +
                // Inline remove (§3.8): hover-revealed × — leaves the tree alone.
                `<button type="button" class="row-btn staging-remove" ` +
                `aria-label="${htmlspecialchars(removeLabel)}" title="${htmlspecialchars(removeLabel)}">${STAGE_REMOVE_ICON}</button>`) +
            '</li>';
    };

    // The bucket head (§3.4 iteration C): the "not yet homed" inbox — a
    // hollow star, the live count, the "new since last visit" counter and
    // the one-hit "favorite all" shortcut.
    // Selection tri-state for a head (§3.2): all-in → .sel, some-in → .some.
    const headSelClass = urls => {
        if (!selecting || !urls.length)
            return '';
        const n = urls.reduce((acc, u) => acc + (selected.has(u) ? 1 : 0), 0);
        return n === urls.length ? ' sel' : (n ? ' some' : '');
    };

    const bucketHeadHtml = (count, news, collapsed) => {
        const favAllLabel = _m('stagingBucketFavAll');
        const removeAllLabel = _m('stagingRemove');
        const countText = news > 0 ? `${count} · ${_m('stagingNew', `${news}`)}` : `${count}`;
        const selCls = headSelClass(staging.unfavBucketItems(stagingState).map(it => it.url));
        return `<li class="staging-bucket${selCls}${count ? ' has-members' : ''}" role="presentation"><span class="staging-bucket-head" ` +
            `tabindex="-1" role="button" aria-expanded="${collapsed ? 'false' : 'true'}">` +
            // the fold chevron leads — the same leading position as the group
            // head, the section head, the tree and the dupes/tabgroups heads
            `<span class="chevron${collapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            `<i class="staging-bucket-star" aria-hidden="true">${STAR_ICON}</i>` +
            `<span class="staging-section-title">${_m('stagingBucketTitle')}</span>` +
            `<span class="count-pill" aria-label="${count}">${countText}</span>` +
            (selecting ? '' :
                `<span class="head-icon-cluster">` +
                `<button type="button" class="row-btn staging-bucket-fav-all" tabindex="-1" ` +
                `aria-label="${htmlspecialchars(favAllLabel)}" title="${htmlspecialchars(favAllLabel)}">${STAR_ICON_FILLED}</button>` +
                // 移除暂存 (rightmost): every bucket item leaves the workbench
                // (tree untouched) — confirm + toast undo, on the rows' axis.
                `<button type="button" class="row-btn staging-bucket-remove-all" tabindex="-1" ` +
                `aria-label="${htmlspecialchars(removeAllLabel)}" title="${htmlspecialchars(removeAllLabel)}">${STAGE_REMOVE_ICON}</button>` +
                `</span>`) +
            `</span></li>`;
    };

    // 移除暂存 (whole bucket): snapshots first, then the confirm + toast-undo
    // path the other bulk exits use.
    const removeBucketItems = () => {
        const items = staging.unfavBucketItems(stagingState);
        if (!items.length)
            return;
        const snapshots = items.map(it => ({ ...it }));
        const run = () => {
            staging.removeByUrls(stagingState, snapshots.map(it => it.url));
            persistStaging();
            renderStaging();
            undo.toastAction(_m('stagingRemovedCount', `${snapshots.length}`), _m('undoAction'), () => {
                const r = staging.restoreItems(stagingState, snapshots, []);
                if (r.full) {
                    toast(_m('stagingFull'));
                    return;
                }
                persistStaging();
                renderStaging();
            });
        };
        if (dialogs && dialogs.ConfirmDialog && snapshots.length > 10) {
            dialogs.ConfirmDialog.open({
                dialog: _m('stagingDeleteConfirm', `${snapshots.length}`),
                button1: `<strong>${_m('stagingRemove')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    // A named group head (§3.5). The quick tail (2026-08-26 reorder, six
    // always-visible keys): [open-all 全部打开][open-as-tab-group 打开为
    // 标签组 — the selection rung's TABS glyph][rename 编辑][dissolve 解散]
    // [place 保存为文件夹][remove 移出暂存] — the open pair leads (the
    // group's whole point), the dangerous 删除分组 stays off the head
    // (context menu / selection mode only) and the rightmost slot keeps the
    // tree-safe group removal (confirm + toast undo). Manual (user-created)
    // groups render even when EMPTY — they exist to be dragged into; the
    // open pair stands down at 0 members (nothing to open).
    const groupHeadHtml = (g, count) => {
        const collapsed = selecting ? false : g.collapsed;
        const openAllLabel = _m('openBookmarks');
        const openGroupLabel = _m('openBookmarksInGroup');
        const placeLabel = _m('groupPlaceTooltip');
        const renameLabel = _m('stagingGroupRename');
        const dissolveLabel = _m('stagingGroupDissolve');
        const removeLabel = _m('stagingRemove');
        const selCls = headSelClass(staging.groupItems(stagingState, g.id).map(it => it.url));
        const dragAttr = selecting ? '' : ' draggable="true"';
        const gname = htmlspecialchars(g.name || _m('noTitle'));
        return `<li class="staging-group${selCls}${count ? ' has-members' : ''}" data-group-id="${g.id}" role="presentation">` +
            `<span class="group-head staging-group-head" tabindex="-1" role="button" ` +
            `aria-expanded="${collapsed ? 'false' : 'true'}" title="${gname}"${dragAttr}>` +
            `<span class="chevron${collapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            // 2026-08-25 icon round: the tree's folder glyph leads the title
            // on the bucket star's slot — every fold head reads glyph-then-
            // title, and the glyph column stacks on the member favicon column.
            `<i class="staging-group-folder" aria-hidden="true">${FOLDER_ICON}</i>` +
            `<span class="staging-section-title" dir="auto">${gname}</span>` +
            `<span class="count-pill" aria-label="${count}">${count}</span>` +
            (selecting ? '' :
                // the quick tail rides one head-icon-cluster (design-laws §2:
                // 20px boxes, the cluster's own 4px gap, no per-button margins
                // — stride 24, last glyph on the rows' 8px axis)
                `<span class="head-icon-cluster">` +
                (count ?
                    `<button type="button" class="row-btn staging-group-open-all" tabindex="-1" ` +
                    `aria-label="${htmlspecialchars(openAllLabel)}" title="${htmlspecialchars(openAllLabel)}">${OPEN_ICON}</button>` +
                    `<button type="button" class="row-btn staging-group-open-group" tabindex="-1" ` +
                    `aria-label="${htmlspecialchars(openGroupLabel)}" title="${htmlspecialchars(openGroupLabel)}">${TABS_ICON}</button>`
                    : '') +
                `<button type="button" class="row-btn staging-group-rename" tabindex="-1" ` +
                `aria-label="${htmlspecialchars(renameLabel)}" title="${htmlspecialchars(renameLabel)}">${EDIT_ICON}</button>` +
                `<button type="button" class="row-btn staging-group-dissolve" tabindex="-1" ` +
                `aria-label="${htmlspecialchars(dissolveLabel)}" title="${htmlspecialchars(dissolveLabel)}">${UNGROUP_ICON}</button>` +
                `<button type="button" class="row-btn staging-group-place" tabindex="-1" ` +
                `aria-label="${htmlspecialchars(placeLabel)}" title="${htmlspecialchars(placeLabel)}">${FOLDER_STAR_ICON}</button>` +
                `<button type="button" class="row-btn staging-group-remove" tabindex="-1" ` +
                `aria-label="${htmlspecialchars(removeLabel)}" title="${htmlspecialchars(removeLabel)}">${STAGE_REMOVE_ICON}</button>` +
                `</span>`) +
            `</span></li>`;
    };

    // Per-render row label cache (i18n hoisting): the row loops re-read
    // the same strings once per row — resolve them once per render (and
    // once per surgical fold) instead.
    const stagingLabels = () => ({
        fromHistory: _m('stagingFromHistory'),
        rowFav: _m('stagingRowFav'),
        rowUnfav: _m('stagingRowUnfav'),
        remove: _m('stagingRemove')
    });

    // Returns { ul, pieces }: the EMPTY #staging-items <ul> (painted with
    // the head) + the row markup pieces (streamed inside it by
    // list-chunks — the 4.1.0 chunked-paint law). The pieces also join
    // back into one string for the synchronous partial repaint path.
    const renderStagingArea = () => {
        const state = stagingState;
        const idxOf = new Map(state.items.map((it, i) => [it.url, i]));
        const L = stagingLabels();
        const ul = `<ul role="list" id="staging-items"${selecting ? ' class="selecting"' : ''}></ul>`;
        const pieces = [];
        // Selection mode force-opens (selecting renders every candidate row,
        // the tabgroups law) — the fold state itself only gates whether the
        // pieces land in the DOM (render()/renderStagingNow read it); the
        // pieces are ALWAYS built so the unfold can drop them from the
        // stagingRowsCache in one innerHTML.
        // The guiding empty state yields to user-built groups: a workbench
        // with manual groups (even 0-item ones) is being set up, not empty.
        if (!state.items.length && !state.groups.some(g => g.manual)) {
            // §11: a guiding empty state — the plane glyph + one muted line
            // pointing at the three entry points.
            pieces.push(`<li class="empty-state staging-empty" role="listitem">${STAGE_ICON}<i>${_m('stagingEmpty')}</i></li>`);
        } else {
            // Selecting forces every fold open (§3.1) without writing back.
            const unfavCollapsed = selecting ? false : state.unfavCollapsed;
            // ① the unbookmarked inbox bucket
            const bucket = staging.unfavBucketItems(state);
            if (bucket.length) {
                pieces.push(bucketHeadHtml(bucket.length, staging.newCount(state), unfavCollapsed));
                if (!unfavCollapsed) {
                    // bucket rows indent under the bucket head too (its
                    // star column is their favicon column) — the inbox
                    // reads as a head with members, not as loose rows
                    for (let bi = 0, bl = bucket.length; bi < bl; bi++)
                        pieces.push(stagingRowHtml(bucket[bi], idxOf.get(bucket[bi].url), true, L, bi === bl - 1));
                }
            }
            // ② groups in createdAt order (the model sorts on create).
            // Manual (user-built) groups render their head even at 0 members
            // — an empty group is a landing zone for the next drag/drop.
            for (const g of state.groups) {
                const members = staging.groupItems(state, g.id);
                if (!members.length && !g.manual)
                    continue;
                pieces.push(groupHeadHtml(g, members.length));
                if (selecting || !g.collapsed) {
                    for (let mi = 0, ml = members.length; mi < ml; mi++)
                        pieces.push(stagingRowHtml(members[mi], idxOf.get(members[mi].url), true, L, mi === ml - 1));
                }
            }
            // ③ bookmarked loose rows
            for (const it of staging.looseItems(state))
                pieces.push(stagingRowHtml(it, idxOf.get(it.url), false, L));
        }
        return { ul, pieces };
    };

    // --- Recently-added region (§2.1/§2.2) ----------------------------------
    // Coarse time sections (第四轮项8) — non-interactive headers segment the
    // flat dateAdded-desc list; group membership never reorders rows.
    const GROUP_KEYS = ['recentGroupToday', 'recentGroupWeek', 'recentGroupMonth', 'recentGroupOlder'];
    const groupIndex = (ts, now) => {
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        if (ts >= midnight.getTime())
            return 0;
        if (ts >= now - 7 * 86400000)
            return 1;
        if (ts >= now - 30 * 86400000)
            return 2;
        return 3;
    };

    const stageBtnHtml = url => {
        const staged = !!staging.getByUrl(stagingState, url);
        const label = _m(staged ? 'stagingRemove' : 'stagingAdd');
        return `<button type="button" class="row-btn staging-add-btn${staged ? ' staged' : ''}" ` +
            `aria-pressed="${staged ? 'true' : 'false'}" ` +
            `aria-label="${htmlspecialchars(label)}" title="${htmlspecialchars(label)}">` +
            (staged ? STAGE_ICON_DONE : STAGE_ICON) + '</button>';
    };

    // Per-time-bucket urls of the last recent render — the bucket heads'
    // stage buttons read them (group membership is fixed at render time).
    let recentGroupUrls = [[], [], [], []];
    // Per-time-bucket ROWS of the last render — the surgical fold re-inserts
    // a folded bucket's member lis from this cache (no refetch, no favicon
    // re-hydration; the recent region stays untouched by staging repaints).
    let recentGroupRows = [[], [], [], []];
    // Prebuilt staging-rows HTML (all pieces joined): the staging head's
    // fold keeps the rows OUT of the DOM while collapsed, and the unfold
    // drops this cache in ONE innerHTML — no rebuild, no stream wait.
    let stagingRowsCache = '';

    // Recent rows as { ul, pieces, count } — the empty <ul> rides the head,
    // the row pieces stream inside it (same chunked-paint contract). The
    // bucket labels resolve once per render (i18n hoisting).
    // 折叠记忆轮: the coarse time sections (今天/本周/本月/更早) are now REAL
    // group heads (the staging virtual-group recipe — chevron + title +
    // count pill + stage button), each clickable to fold its own rows, the
    // fold state persisted per bucket (recentGroupCollapsed). Member rows
    // carry data-recent-group so the surgical fold can move exactly their
    // own contiguous block.
    const recentMemberHtml = (g, rows) => {
        const showPath = views.showItemPath();
        let html = '';
        for (let i = 0, l = rows.length; i < l; i++) {
            const d = rows[i];
            const path = views.pathOf(d.id);
            // §3.3: narrow right slot = relative time; wide second line =
            // `路径 · 绝对时间` (the path half follows showItemPath).
            const absTime = new Date(d.dateAdded || 0).toLocaleString();
            const subText = (showPath && path) ? `${path} · ${absTime}` : absTime;
            html += `<li class="vbm-row" id="recent-item-${d.id}" role="listitem" ` +
                `data-node-id="${d.id}" data-parentid="${d.parentId}" data-recent-group="${g}">` +
                treeRender.generateBookmarkHTML(d.title, d.url, 'data-virtual="1"', d.id, null, {
                    path,
                    badge: { text: relTimeLabel(d.dateAdded, _m), cls: 'time' },
                    rightText: (showPath && path) ? path : '',
                    subText
                }) +
                stageBtnHtml(d.url) +
                '</li>';
        }
        return html;
    };

    const renderRecentRows = items => {
        const pieces = [];
        const ul = '<ul role="list" id="recent-list"></ul>';
        let count = 0;
        const now = Date.now();
        const rowsByGroup = [[], [], [], []];
        const groupUrls = [[], [], [], []];
        const groupLabels = GROUP_KEYS.map(k => _m(k));
        const stageGroupLabels = groupLabels.map(t => _m('recentStageGroup', t));
        for (let i = 0, l = items.length; i < l; i++) {
            const d = items[i];
            if (!d.url || separatorManager.isSeparator(d.title, d.url))
                continue;
            const g = groupIndex(d.dateAdded || 0, now);
            count++;
            rowsByGroup[g].push(d);
            groupUrls[g].push({ id: d.id, url: d.url, title: d.title });
        }
        // The stage buttons render in BOTH modes; the selecting-view CSS
        // hides them (visibility, so the geometry stays frozen) — that lets
        // staging-only repaints leave this region alone.
        for (let g = 0; g < 4; g++) {
            const rows = rowsByGroup[g];
            if (!rows.length)
                continue;
            const key = GROUP_KEYS[g];
            const collapsed = !selecting && !!stagingState.recentGroupCollapsed[key];
            const label = groupLabels[g];
            pieces.push(`<li class="recent-group-li${collapsed ? ' collapsed' : ''}" data-recent-group="${g}" role="presentation">` +
                `<span class="group-head recent-group-head" role="button" tabindex="-1" ` +
                `aria-expanded="${collapsed ? 'false' : 'true'}" title="${htmlspecialchars(label)}">` +
                `<span class="chevron${collapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
                // 2026-08-25 icon round: the clock glyph leads on the bucket
                // star's slot — the time buckets read glyph-then-title like
                // the staging heads above (folder / hollow star).
                `<i class="recent-group-clock" aria-hidden="true">${CLOCK_ICON}</i>` +
                `<span class="staging-section-title" dir="auto">${label}</span>` +
                `<span class="count-pill" aria-label="${htmlspecialchars(label + ' · ' + rows.length)}">${rows.length}</span>` +
                (selecting ? '' :
                    `<span class="head-icon-cluster">` +
                    `<button type="button" class="row-btn recent-group-stage" tabindex="-1" ` +
                    `data-recent-group="${g}" aria-label="${htmlspecialchars(stageGroupLabels[g])}" ` +
                    `title="${htmlspecialchars(stageGroupLabels[g])}">${STAGE_ICON}</button>` +
                    `</span>`) +
                '</span></li>');
            if (collapsed)
                continue;
            pieces.push(recentMemberHtml(g, rows));
        }
        if (!count)
            pieces.push(`<li class="empty-state" role="listitem"><i>${_m('recentEmpty')}</i></li>`);
        recentGroupUrls = groupUrls;
        recentGroupRows = rowsByGroup;
        return { ul, pieces, count };
    };

    const renderRecentHead = count => {
        const collapsed = stagingState.recentCollapsed;
        const stageAllLabel = _m('recentStageAll');
        // The pill speaks the same count language as the staging head's:
        // title + count in the aria/title, the bare number in the pill.
        const countLabel = `${_m('recentSectionTitle')} · ${count}`;
        return `<div id="recent-head" class="staging-section-head${collapsed ? ' collapsed' : ''}" ` +
            `role="button" tabindex="-1" aria-expanded="${collapsed ? 'false' : 'true'}">` +
            `<span class="chevron${collapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            `<span class="staging-section-title">${_m('recentSectionTitle')}</span>` +
            (count ? `<span class="count-pill" aria-label="${htmlspecialchars(countLabel)}" ` +
                `title="${htmlspecialchars(countLabel)}">${count}</span>` : '') +
            `<button type="button" class="row-btn recent-stage-all" tabindex="-1" ` +
            `aria-label="${htmlspecialchars(stageAllLabel)}" title="${htmlspecialchars(stageAllLabel)}">${STAGE_ICON}</button>` +
            `</div>`;
    };

    // (折叠记忆轮: the recent region always paints — the fold hides it with
    // a root class, so no cached count is needed any more.)

    // --- Selection mode (§3.1: the dead/dupes/tabgroups machinery) ---------
    // The selection unit is the staging item = its URL (§3.2). Entering
    // expands every fold (snapshot restored on exit — the tabgroups law);
    // the fold writes are suppressed while selecting.
    let selecting = false;
    // The shortcut bar's manage state (rung 3): false = chips move on
    // click, true = chips edit and the floating delete × shows. Leaving
    // selection mode always resets it.
    let editingShortcuts = false;
    const selected = new Set(); // urls
    let pendingRowFocus = null;
    let selectionFocus = null;
    let foldSnapshot = null;
    let suppressFoldPersist = false;

    const setSelecting = (on, focus = null) => {
        if (on && !selecting) {
            foldSnapshot = {
                unfav: stagingState.unfavCollapsed,
                head: stagingState.headCollapsed,
                recentGroups: { ...(stagingState.recentGroupCollapsed || {}) },
                groups: stagingState.groups.map(g => [g.id, g.collapsed])
            };
        } else if (!on && selecting && foldSnapshot) {
            stagingState.unfavCollapsed = foldSnapshot.unfav;
            stagingState.headCollapsed = foldSnapshot.head;
            stagingState.recentGroupCollapsed = { ...(foldSnapshot.recentGroups || {}) };
            for (const [gid, collapsed] of foldSnapshot.groups)
                staging.setGroupCollapsed(stagingState, gid, collapsed);
            foldSnapshot = null;
        }
        selecting = on;
        // The root class hides the recently-added region's send buttons
        // while selecting (CSS visibility, slots stay occupied) — the
        // partial repaint below then never has to touch that region.
        if ($list.classList)
            $list.classList.toggle('selecting-view', on);
        if (!on) {
            selected.clear();
            editingShortcuts = false;
        }
        if (focus)
            selectionFocus = focus;
        renderStaging();
    };

    // Fold handlers route through here so selecting-time folds stay
    // ephemeral (never written back).
    // Returns the serialized state so fold toggles reuse it for
    // lastRenderedRaw — one serialize per fold, not two.
    const foldPersist = () => {
        const raw = staging.serialize(stagingState);
        if (!suppressFoldPersist && !selecting) {
            rememberOwnWrite(raw);
            store.set('staging', raw);
            views.updateBadges(); // store.set does not auto-update tab badges
        }
        return raw;
    };

    const renderToolbar = () => {
        const n = staging.count(stagingState);
        if (selecting) {
            // Rung 1: count + set ops + exit; Rung 2: the actions (§3.3).
            let r1 = '<div class="staging-toolbar staging-select-toolbar selecting-bar vbm-toolbar">';
            r1 += `<span class="select-count">${_m('selectCount', `${selected.size}`)}</span>` +
                `<button class="staging-select-all">${_m('selectAll')}</button>` +
                `<button class="staging-select-invert">${_m('selectInvert')}</button>` +
                `<button class="staging-select-clear">${_m('selectClear')}</button>` +
                `<button class="staging-select-exit">${_m('selectModeExit')}</button>`;
            r1 += '</div>';
            const hasSel = selected.size ? '' : ' disabled';
            // The ACTION rung is iconified (the dead-view law): every
            // glyph's meaning survives without text, so the labels move
            // into title/aria and all nine actions fit ONE row. Order =
            // the workbench's key ops: 打开(open / open-as-tab-group) →
            // 收藏态(收藏 / 取消收藏) → 组织(分组 / 移动复制到) → 离场
            // (移出 / 删除所选 / 清空暂存 — the destructive pair ends the
            // rung in danger red, delete before the staging-wide clear).
            const iconBtn = (cls, label, icon) => {
                const lab = htmlspecialchars(label);
                return `<button class="staging-icon-btn vbm-fit-btn ${cls}"${hasSel} aria-label="${lab}" title="${lab}">` +
                    `${icon}<span class="staging-btn-label vbm-fit-label">${lab}</span></button>`;
            };
            let r2 = '<div class="staging-toolbar staging-actions-toolbar selecting-bar vbm-toolbar">';
            r2 += iconBtn('staging-open', _m('open'), OPEN_ICON) +
                iconBtn('staging-open-group', _m('openBookmarksInGroup'), TABS_ICON) +
                iconBtn('staging-fav', _m('stagingFav'), STAR_ICON) +
                iconBtn('staging-unfav', _m('stagingUnfav'), STAR_X_ICON) +
                iconBtn('staging-assign', _m('stagingGroupAssign'), GROUP_ICON) +
                iconBtn('staging-movecopy', _m('stagingMoveCopy'), FOLDER_STAR_ICON) +
                iconBtn('staging-remove', _m('stagingRemove'), STAGE_REMOVE_ICON) +
                iconBtn('staging-delete', _m('deleteSelected'), TRASH_ICON) +
                // 清空暂存 acts on ALL items (not the selection), so its
                // gate is the item count, not the selection size
                `<button class="staging-icon-btn vbm-fit-btn staging-clear-all"${n ? '' : ' disabled'} ` +
                `aria-label="${htmlspecialchars(_m('stagingClear'))}" title="${htmlspecialchars(_m('stagingClear'))}">` +
                `${LIST_X_ICON}<span class="staging-btn-label vbm-fit-label">${htmlspecialchars(_m('stagingClear'))}</span></button>`;
            r2 += '</div>';
            // Rung 3: the customizable MOVE-TO shortcuts. Normal mode is
            // minimal-horizontal: chip = color dot + alias (click = move),
            // NO per-chip buttons. The right-edge cluster is [+] add and
            // [pencil] edit-mode; in edit mode chips get the dashed border
            // (click = edit) and a floating red × over the color dot to
            // delete.
            const shortcutItem = sc => {
                const path = views.pathOf(sc.folderId) || sc.folderId;
                const label = htmlspecialchars(sc.alias || path);
                const moveLabel = htmlspecialchars(_m('stagingShortcutMove', [label]));
                const editLabel = htmlspecialchars(_m('stagingShortcutEdit'));
                return '<span class="staging-shortcut-item">' +
                    '<button type="button" class="staging-shortcut tg-' + sc.color + '" data-shortcut-id="' + sc.id + '" ' +
                    'aria-label="' + (editingShortcuts ? editLabel : moveLabel) + '" title="' + htmlspecialchars(path) + '">' +
                    '<span class="tab-group-dot tg-' + sc.color + '" aria-hidden="true"></span>' +
                    '<span class="staging-shortcut-name" dir="auto">' + label + '</span></button>' +
                    // del chips exist ONLY in edit mode (leave the DOM, not
                    // CSS-hidden: a display:none button still catches the ←/→
                    // rung walk and dead-ends focus — H4)
                    (editingShortcuts
                        ? '<button type="button" class="staging-shortcut-del" data-shortcut-id="' + sc.id + '" tabindex="-1" ' +
                        'aria-label="' + htmlspecialchars(_m('stagingShortcutRemove')) + '" ' +
                        'title="' + htmlspecialchars(_m('stagingShortcutRemove')) + '">×</button>'
                        : '') +
                    '</span>';
            };
            let r3 = '<div class="staging-toolbar staging-shortcuts-toolbar vbm-toolbar' + (editingShortcuts ? ' editing' : '') + '">';
            if (!editingShortcuts)
                r3 += '<span class="staging-shortcuts-label">' + htmlspecialchars(_m('stagingShortcutBarLabel')) + '</span>';
            for (const sc of shortcuts)
                r3 += shortcutItem(sc);
            r3 += '<span class="staging-shortcuts-cluster">' +
                '<button type="button" class="staging-shortcut-add" aria-label="' + htmlspecialchars(_m('stagingShortcutAdd')) + '" ' +
                'title="' + htmlspecialchars(_m('stagingShortcutAdd')) + '">' + FOLDER_PLUS_ICON + '</button>' +
                '<button type="button" class="staging-shortcut-edit-mode" aria-pressed="' + (editingShortcuts ? 'true' : 'false') + '" ' +
                'aria-label="' + htmlspecialchars(_m('stagingShortcutEdit')) + '" title="' + htmlspecialchars(_m('stagingShortcutEdit')) + '">' + EDIT_ICON + '</button>' +
                '</span>';
            r3 += '</div>';
            return r1 + r2 + r3;
        }
        // The idle toolbar IS the staging section head (折叠记忆轮): one
        // foldable head row — chevron + bold title + count pill + the tool
        // buttons [新建分组][选择模式] — the count moved out of the old
        // left summary slot into the right cluster, the same pill the recent
        // head uses (one count language across both regions). The select-mode
        // icon needs rows to act on; 新建分组 works on an empty workbench too
        // — the head never disappears. Clicking the row folds the whole
        // staging area (headCollapsed persists); the buttons keep their own
        // actions (their click branches run first).
        const collapsed = stagingState.headCollapsed;
        const countLabel = _m('stagingCount', `${n}`);
        let html = '<div id="staging-head" class="staging-toolbar staging-section-head staging-head-main vbm-toolbar' +
            (collapsed ? ' collapsed' : '') + '" role="button" tabindex="-1" ' +
            `aria-expanded="${collapsed ? 'false' : 'true'}">` +
            `<span class="chevron${collapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            `<span class="staging-section-title">${htmlspecialchars(_m('viewRecent'))}</span>` +
            `<span class="count-pill" aria-label="${htmlspecialchars(countLabel)}" ` +
            `title="${htmlspecialchars(countLabel)}">${n}</span>` +
            // 清空全部 (danger, left of 新建分组): the same confirm + toast-
            // undo path the selection bar's clear button runs — an icon+text
            // entry like its neighbour, reading danger red.
            `<button class="staging-clear-entry"${n ? '' : ' disabled'} aria-label="${htmlspecialchars(_m('stagingClear'))}" ` +
            `title="${htmlspecialchars(_m('stagingClear'))}">${TRASH_ICON}<span class="staging-entry-label">${htmlspecialchars(_m('stagingClear'))}</span></button>` +
            `<button class="staging-new-group" aria-label="${htmlspecialchars(_m('stagingGroupNew'))}" ` +
            `title="${htmlspecialchars(_m('stagingGroupNew'))}">${FOLDER_PLUS_ICON}<span class="staging-entry-label">${htmlspecialchars(_m('stagingGroupNew'))}</span></button>`;
        // 全部折叠/全部展开 (the tabgroups toolbar pair, same icons + keys):
        // they act on every virtual folding unit — the named groups AND the
        // unbookmarked inbox bucket — and stand down when there is nothing
        // foldable on the workbench.
        const foldable = stagingState.groups.length > 0 ||
            staging.unfavBucketItems(stagingState).length > 0;
        const foldBtn = (cls, icon, key) => {
            const lab = htmlspecialchars(_m(key));
            return `<button class="staging-icon-btn vbm-fit-btn ${cls}"${foldable ? '' : ' disabled'} ` +
                `aria-label="${lab}" title="${lab}">${icon}</button>`;
        };
        html += foldBtn('staging-fold-collapse-all', COLLAPSE_ALL_ICON, 'tabGroupsCollapseAll') +
            foldBtn('staging-fold-expand-all', EXPAND_ALL_ICON, 'tabGroupsExpandAll');
        if (n)
            html += `<button class="staging-select-mode" aria-label="${htmlspecialchars(_m('selectModeEnter'))}" ` +
                `title="${htmlspecialchars(_m('selectModeEnter'))}">${SELECT_ICON}</button>`;
        html += '</div>';
        return html;
    };

    let dirty = false;
    // Whether the list has been fully painted at least once (a stubbable
    // flag — DOM probing via querySelector breaks the minimal test $list),
    // and the serialized staging state that paint reflected (a direct
    // model mutation between renders must force a repaint on activate).
    let painted = false;
    let lastRenderedRaw = null;
    // The in-flight chunked paint (4.1.0 list-chunks): every render cancels
    // its predecessor so an older paint's tail batches never race a newer one.
    let paintHandle = null;
    // Selection-mode focus handoff (dead/dupes law): 'first' → the
    // toolbar's first enabled control; 'entry' → the select-mode button.
    // Shared by the full render and the staging-only partial repaint.
    const applyFocusHandoffs = () => {
        if (selectionFocus === 'first') {
            selectionFocus = null;
            const firstBtn = $list.querySelector && $list.querySelector('.staging-select-toolbar button:not([disabled])');
            if (firstBtn && firstBtn.focus)
                firstBtn.focus();
        } else if (selectionFocus === 'entry') {
            selectionFocus = null;
            const entryBtn = $list.querySelector && $list.querySelector('.staging-select-mode');
            if (entryBtn && entryBtn.focus)
                entryBtn.focus();
        }
        if (pendingRowFocus !== null) {
            const row = document.getElementById('staging-item-' + pendingRowFocus);
            pendingRowFocus = null;
            const anchor = row && row.querySelector ? row.querySelector('a') : null;
            if (anchor && anchor.focus)
                anchor.focus();
        }
    };

    // Full repaint through the 4.1.0 chunked painter: the head (banners +
    // toolbars + the EMPTY #staging-items <ul> + scissors + recent head +
    // the EMPTY #recent-list <ul>) lands synchronously, the staging rows
    // stream inside their <ul> in adaptive rAF batches (the recent rows —
    // recentCount-bounded — land with the head). Node test doubles have no
    // rAF: paintListChunked degrades to ONE synchronous paint, exactly the
    // old innerHTML behavior.
    const render = (items, recentN) => {
        if (paintHandle)
            paintHandle.cancel();
        const stagingArea = renderStagingArea();
        // The rows cache serves the head folds: while the staging area is
        // folded the rows stay OUT of the DOM (the pipe below stays empty),
        // but the prebuilt pieces stay cached so the unfold drops them in
        // ONE innerHTML — no rebuild, no stream wait.
        stagingRowsCache = stagingArea.pieces.join('');
        const stagingCollapsed = stagingState.headCollapsed && !selecting;
        // The staging master switch (options 暂存和最近添加): off collapses
        // the view to the classic recently-added list — no workbench chrome,
        // no toolbar, no scissors (there is no upper half to cut from).
        const workbenchOn = stagingOn();
        let head = chromeHtml();
        if (workbenchOn) {
            head += renderToolbar();
            head += stagingArea.ul;
            // The scissors cut: the recently-added region is a separate
            // lower half, never a staging group — the dashed line + scissors
            // mark the boundary BEFORE the foldable section head.
            head += `<div class="staging-cut" aria-hidden="true">${SCISSORS_ICON}</div>`;
        }
        head += renderRecentHead(recentN);
        const pipes = [];
        if (workbenchOn)
            pipes.push({
                ul: '#staging-items',
                pieces: stagingCollapsed ? [] : stagingArea.pieces,
                first: 60,   // first rows land with the head
                chunk: 120   // then stream 120 rows per frame (fixed stride —
                             // the staging list is 500-capped, no need to adapt)
            });
        // The recent region always paints (its rows are recentCount-bounded);
        // the fold hides them with a root class, so folding/unfolding is a
        // zero-work display swap instead of a full repaint.
        const rendered = renderRecentRows(items || []);
        head += rendered.ul;
        pipes.push({
            ul: '#recent-list',
            pieces: rendered.pieces,
            first: 1000, // recentCount-bounded — land everything with the head
            chunk: 60
        });
        if ($list && $list.classList && typeof $list.classList.toggle === 'function') {
            $list.classList.toggle('staging-area-collapsed', stagingCollapsed || !workbenchOn);
            $list.classList.toggle('recent-area-collapsed', !!stagingState.recentCollapsed);
        }
        // 4.0.1 focus law: a focused row rides the swap (park above, restore
        // here) so the ↓ walk survives every refresh repaint. The toolbar
        // rides the same law (parkToolbarFocus/restoreToolbarFocus).
        const parkedToolbar = parkToolbarFocus($list);
        const parkedRow = parkRowFocus($list);
        paintSettled = false;
        paintHandle = paintListChunked($list, {
            head,
            pipes,
            onHead: list => {
                restoreToolbarFocus(list, parkedToolbar);
            },
            onSettled: list => {
                paintSettled = true;
                painted = true;
                lastRenderedRaw = staging.serialize(stagingState);
                unparkRowFocus(list, parkedRow);
                applyFocusHandoffs();
                fitSelectionLabels();
                onRowsRendered();
            }
        });
    };

    const refresh = () => {
        if (!enabled())
            return;
        // Inactive views skip the fetch; the activate hook replays it.
        if (!views.isActive('recent')) {
            dirty = true;
            return;
        }
        dirty = false;
        chrome.bookmarks.getRecent(recentCount(), items => {
            let count = 0;
            for (let i = 0, l = (items || []).length; i < l; i++) {
                const d = items[i];
                if (d.url && !separatorManager.isSeparator(d.title, d.url))
                    count++;
            }
            render(items || [], count);
        });
    };

    // --- Staging-only partial repaint (perf round) -------------------------
    // A fold toggle / drag / selection change rebuilds ONLY the leading
    // block (banner + toolbar + #staging-items) in place. #recent-head and
    // #recent-list keep their nodes — favicon fallback/enrichment is NOT
    // re-triggered for the recent rows, which was the bulk of the
    // "entering the view feels laggy" favicon churn.
    const renderStagingNow = () => {
        // A pending full paint's tail batches must never land after this
        // partial swap — cancel it first (and mark settled: a stale
        // in-flight handle would read as "streaming" to the folds).
        if (paintHandle) {
            paintHandle.cancel();
            paintHandle = null;
        }
        paintSettled = true;
        // minimal test stubs only carry innerHTML — fall back to the
        // full path when the DOM helpers are absent. The scissors cut is
        // the partial repaint's anchor: everything before it is staging
        // chrome, everything from it down (cut + recent region) stays.
        const anchor = $list.querySelector
            ? ($list.querySelector('.staging-cut') || $list.querySelector('#recent-head'))
            : null;
        if (!anchor) {
            // never fully painted yet (the recent head always leads the
            // recent region) — let the full path do the first paint
            refresh();
            return;
        }
        const parkedToolbar = parkToolbarFocus($list);
        const parkedRow = parkRowFocus($list);
        const stagingArea = renderStagingArea();
        // Cache the prebuilt rows for the unfold; while collapsed the DOM
        // gets the EMPTY <ul> (the rows drop in from the cache on unfold).
        stagingRowsCache = stagingArea.pieces.join('');
        const stagingCollapsed = stagingState.headCollapsed && !selecting;
        // pieces must join INSIDE the <ul>, never after its </ul> —
        // the list-chunks contract's own trap (li siblings of the list
        // are invisible to every `ul li` rule and row walk).
        const stagingUl = stagingCollapsed
            ? stagingArea.ul
            : stagingArea.ul.slice(0, -5) + stagingArea.pieces.join('') + '</ul>';
        const leading = chromeHtml() + renderToolbar() + stagingUl;
        while ($list.firstChild && $list.firstChild !== anchor)
            $list.firstChild.remove();
        anchor.insertAdjacentHTML('beforebegin', leading);
        if ($list && $list.classList && typeof $list.classList.toggle === 'function')
            $list.classList.toggle('staging-area-collapsed', stagingCollapsed);
        lastRenderedRaw = staging.serialize(stagingState);
        restoreToolbarFocus($list, parkedToolbar);
        unparkRowFocus($list, parkedRow);
        syncRecentStageButtons();
        applyFocusHandoffs();
        fitSelectionLabels();
        onRowsRendered();
    };

    // 渐进式文字 (selection action rung): the icon buttons' labels reveal
    // ONE BY ONE from the right edge as free width allows — measured per
    // render/resize instead of a handful of container breakpoints, so every
    // extra pixel of width earns the next label (never whole groups at
    // 520/680/820px jumps). Pure DOM measurement; guarded for test doubles.
    const fitSelectionLabels = () => {
        if (!$list.querySelector)
            return;
        fitToolbarLabels($list.querySelector('.staging-actions-toolbar'));
    };
    // A popup/panel resize re-fits the rung (width change only — the fit
    // itself only mutates the labels, never the container's width).
    watchToolbarFit($list, () => {
        if (selecting)
            fitSelectionLabels();
    });

    // Re-entry optimization: lastSeenTs advances on every activation, so
    // the bucket head's "new N" reads 0 afterwards — update the pill text
    // in place instead of re-rendering the whole view (which re-armed the
    // favicon refresh process on every tab switch).
    const syncBucketSeen = () => {
        const pill = $list.querySelector && $list.querySelector('.staging-bucket .count-pill');
        if (!pill)
            return;
        const n = `${staging.unfavBucketItems(stagingState).length}`;
        pill.textContent = n;
        pill.setAttribute('aria-label', n);
    };

    // Keep the untouched recent region's stage glyphs in step with the
    // staging state after a partial repaint (staged class + aria-pressed +
    // the remove/add label). Cheap: ≤ recentCount rows, only touched when
    // the state actually flipped.
    const syncRecentStageButtons = () => {
        if (!$list.querySelectorAll)
            return;
        const idToUrl = new Map();
        for (const grp of recentGroupUrls)
            for (const r of grp)
                idToUrl.set(r.id, r.url);
        const rows = $list.querySelectorAll('#recent-list li');
        for (let i = 0, l = rows.length; i < l; i++) {
            const li = rows[i];
            const btn = li.querySelector('.staging-add-btn');
            if (!btn || !li.dataset || !li.dataset.nodeId)
                continue;
            const url = idToUrl.get(li.dataset.nodeId);
            if (url === undefined)
                continue;
            const staged = !!staging.getByUrl(stagingState, url);
            if (btn.classList.contains('staged') === staged)
                continue;
            // The FULL flip (class + aria + labels + the inner svg): the
            // recent region never repaints, and .staged alone only re-tints
            // the hollow plane — the filled-plane swap needs the icon
            // innerHTML, exactly like the row-click path (2026-08-26 report:
            // a bucket-head send left never-sent rows hollow but accent).
            flipStageBtn(btn, staged, _m);
        }
    };

    // --- Real organize actions on the staging rows (§3.4 — "favorite" IS
    // a tree operation, exactly like the quick-add star and the stats
    // history-row ☆) ---------------------------------------------------------
    const quickAddFolderId = () => store.get('quickAddFolderId', '1') || '1';

    const refreshTree = () => {
        if (treeView && treeView.generateTree)
            chrome.bookmarks.getTree(treeView.generateTree);
    };

    // Resolve the tree node for a URL without creating one: the first exact
    // hit (same anchor rule the relink index uses).
    const findTreeBookmark = (url, cb) => {
        chrome.bookmarks.search({ url }, found => {
            const hit = (found || []).find(f => f.url === url);
            cb(hit || null);
        });
    };

    // Favorite one item: dedupe against the tree first (quick-add star
    // semantics), then create into the quick-add folder.
    const favOne = (it, cb) => {
        findTreeBookmark(it.url, hit => {
            if (hit) {
                staging.setFav(stagingState, it.url, hit.id);
                cb('linked');
                return;
            }
            chrome.bookmarks.create({
                parentId: quickAddFolderId(),
                url: it.url,
                title: it.title || it.url
            }, created => {
                if (!created || chrome.runtime.lastError) {
                    cb('failed');
                    return;
                }
                staging.setFav(stagingState, it.url, created.id);
                cb('created');
            });
        });
    };

    const favToggle = url => {
        const it = staging.getByUrl(stagingState, url);
        if (!it)
            return;
        if (it.id) {
            // Un-favorite: the REAL remove — the item stays, demoted to the
            // unbookmarked state (the workbench never loses your work).
            chrome.bookmarks.remove(it.id, () => {
                if (chrome.runtime.lastError)
                    return;
                staging.setUnfavById(stagingState, it.id);
                persistStaging();
                renderStaging();
                refreshTree();
                toast(_m('stagingUnfavDone', ['1']));
            });
        } else {
            favOne(it, how => {
                if (how === 'failed')
                    return;
                persistStaging();
                renderStaging();
                refreshTree();
                toast(_m('stagingFavDone', ['1']));
            });
        }
    };

    // The bucket head's one-hit "favorite all" (§3.4) — sequential, with a
    // linked/created/skipped tally.
    const favAllBucket = () => {
        const bucket = staging.unfavBucketItems(stagingState);
        if (!bucket.length)
            return;
        let done = 0;
        let failed = 0;
        const createdIds = [];
        const step = () => {
            if (done >= bucket.length) {
                persistStaging();
                renderStaging();
                refreshTree();
                const n = bucket.length - failed;
                if (n > 0)
                    undo.toastAction(_m('stagingFavDone', `${n}`), _m('undoAction'), () => {
                        for (const id of createdIds)
                            chrome.bookmarks.remove(id, () => {
                                if (chrome.runtime.lastError)
                                    return;
                                staging.setUnfavById(stagingState, id);
                            });
                        persistStaging();
                        renderStaging();
                        refreshTree();
                    });
                return;
            }
            const it = bucket[done++];
            favOne(it, how => {
                if (how === 'failed')
                    failed++;
                else if (how === 'created' && it.id)
                    createdIds.push(it.id);
                step();
            });
        };
        step();
    };

    // --- Bulk toolbar actions (§3.3 — every action takes effect NOW; the
    // danger tiers: confirm for delete/clear/big moves, toast+undo for the
    // high-frequency low-harm rest — §3.0) ----------------------------------
    const selectedItems = () => stagingState.items.filter(it => selected.has(it.url));

    const openSelected = () => {
        const urls = selectedItems().map(it => it.url);
        if (!urls.length || !ctx.actions)
            return;
        ctx.actions.openBookmarks(urls, false);
    };

    const openSelectedInGroup = () => {
        const urls = selectedItems().map(it => it.url);
        if (!urls.length || !ctx.actions)
            return;
        ctx.actions.openBookmarksInGroup(urls);
    };

    // Favorite the applicable (unbookmarked) items — mixed selections act on
    // what applies and report the tally (§3.2).
    const favSelected = () => {
        const items = selectedItems().filter(it => !it.id);
        if (!items.length)
            return;
        const createdIds = [];
        let failed = 0;
        let i = 0;
        const step = () => {
            if (i >= items.length) {
                persistStaging();
                renderStaging();
                refreshTree();
                const n = items.length - failed;
                if (n > 0)
                    undo.toastAction(_m('stagingFavDone', `${n}`), _m('undoAction'),
                        () => {
                            for (const id of createdIds)
                                chrome.bookmarks.remove(id, () => {
                                    if (chrome.runtime.lastError)
                                        return;
                                    staging.setUnfavById(stagingState, id);
                                });
                            persistStaging();
                            renderStaging();
                            refreshTree();
                        });
                return;
            }
            const it = items[i++];
            favOne(it, how => {
                if (how === 'failed')
                    failed++;
                else if (how === 'created' && it.id)
                    createdIds.push(it.id);
                step();
            });
        };
        step();
    };

    // Un-favorite the bookmarked items — REAL removes; the items fall back
    // to the unbookmarked state and STAY (§3.4).
    const unfavSelected = () => {
        const items = selectedItems().filter(it => it.id);
        if (!items.length)
            return;
        // restore bookkeeping: remember each node's real parent so undo
        // recreates into the ORIGINAL folder, not the quick-add catch-all (M1)
        const restorePlans = items.map(it => ({ it, parentId: null }));
        let i = 0;
        const step = () => {
            if (i >= items.length) {
                persistStaging();
                renderStaging();
                refreshTree();
                undo.toastAction(_m('stagingUnfavDone', `${items.length}`), _m('undoAction'), () => {
                    // restore the bookmarks and re-anchor the items
                    let j = 0;
                    const restore = () => {
                        if (j >= restorePlans.length) {
                            persistStaging();
                            renderStaging();
                            refreshTree();
                            return;
                        }
                        const plan = restorePlans[j++];
                        const parentId = plan.parentId || quickAddFolderId();
                        chrome.bookmarks.create({ parentId, url: plan.it.url, title: plan.it.title }, created => {
                            if (created)
                                staging.setFav(stagingState, plan.it.url, created.id);
                            restore();
                        });
                    };
                    restore();
                });
                return;
            }
            const idx = i++;
            const it = items[idx];
            chrome.bookmarks.get(it.id, nodes => {
                const node = nodes && nodes[0];
                if (node && node.parentId)
                    restorePlans[idx].parentId = node.parentId;
                chrome.bookmarks.remove(it.id, () => {
                    if (chrome.runtime.lastError)
                        return;
                    staging.setUnfavById(stagingState, it.id);
                    step();
                });
            });
        };
        step();
    };

    // Move/copy home through the extended picker (§3.3/§4.1). Move semantics:
    // bookmarked → real move (item LEAVES — homing completes the mission);
    // unbookmarked → create into the target (leaves too). Copy: real copies,
    // items stay (unbookmarked ones get anchored to their new node).
    const MOVE_CONFIRM_LIMIT = 10;
    const applyMoveOrCopy = (items, folderId, action) => {
        const run = () => {
            let done = 0;
            let moved = 0;
            let copied = 0;
            const leaveUrls = [];
                const step = () => {
                if (done >= items.length) {
                    if (leaveUrls.length)
                        staging.removeByUrls(stagingState, leaveUrls);
                    persistStaging();
                    renderStaging();
                    refreshTree();
                    toast(_m(action === 'move' ? 'stagingMoveDone' : 'stagingCopyDone',
                        `${action === 'move' ? moved : copied}`));
                    return;
                }
                const it = items[done++];
                if (action === 'copy') {
                    chrome.bookmarks.create({ parentId: folderId, url: it.url, title: it.title || it.url }, created => {
                        if (created) {
                            copied++;
                            staging.setFav(stagingState, it.url, created.id);
                        }
                        step();
                    });
                } else if (it.id) {
                    // §4.1: moving onto the current parent is a no-op + toast
                    // (a real move would silently reorder to the folder end)
                    chrome.bookmarks.get(it.id, nodes => {
                        const node = nodes && nodes[0];
                        if (node && node.parentId === folderId) {
                            step();
                            return;
                        }
                        chrome.bookmarks.move(it.id, { parentId: folderId }, () => {
                            if (!chrome.runtime.lastError) {
                                moved++;
                                leaveUrls.push(it.url);
                            }
                            step();
                        });
                    });
                } else {
                    chrome.bookmarks.create({ parentId: folderId, url: it.url, title: it.title || it.url }, created => {
                        if (created) {
                            moved++;
                            leaveUrls.push(it.url);
                        }
                        step();
                    });
                }
            };
            step();
        };
        // >10-item moves of real bookmarks are irreversible (no undo toast
        // restores a bulk move) — always confirm; deliberately NOT gated on
        // dontConfirmOpenFolder (that flag covers opening N tabs, a far less
        // destructive gesture — M4).
        if (action === 'move' && items.length > MOVE_CONFIRM_LIMIT &&
            dialogs && dialogs.ConfirmDialog) {
            dialogs.ConfirmDialog.open({
                dialog: _m('stagingMoveConfirm', `${items.length}`),
                button1: `<strong>${_m('stagingMoveConfirmOk')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    const openPickerForItems = items => {
        if (!dialogs || !dialogs.BookmarkFolderPickDialog || !items.length)
            return;
        dialogs.BookmarkFolderPickDialog.open({
            mode: null,
            hasUnfav: items.some(it => !it.id),
            onPick: (folderId, action) => applyMoveOrCopy(items, folderId, action)
        });
    };

    const moveCopySelected = () => openPickerForItems(selectedItems());

    // Delete: REAL bookmark removal + item exit; unbookmarked selections
    // reduce to a plain remove (counted separately — §3.3).
    const deleteSelected = () => {
        const items = selectedItems();
        if (!items.length)
            return;
        const bookmarked = items.filter(it => it.id);
        const run = () => {
            // restore bookkeeping: each bookmarked item keeps its original
            // parent folder for the undo recreate
            const restorePlans = bookmarked.map(it => ({ it, parentId: null }));
            // group snapshots must be taken BEFORE removeByUrls prunes the
            // emptied groups — at undo time they are already gone
            const groupSnaps = [...new Set(items.map(it => it.group).filter(Boolean))]
                .map(id => ({ ...staging.findGroup(stagingState, id) }));
            let i = 0;
            const step = () => {
                if (i >= bookmarked.length) {
                    staging.removeByUrls(stagingState, items.map(it => it.url));
                    persistStaging();
                    renderStaging();
                    refreshTree();
                    undo.toastAction(_m('stagingDeleted', `${bookmarked.length}`), _m('undoAction'), () => {
                        let j = 0;
                        const restore = () => {
                            if (j >= restorePlans.length) {
                                persistStaging();
                                renderStaging();
                                refreshTree();
                                return;
                            }
                            const plan = restorePlans[j++];
                            chrome.bookmarks.create({
                                parentId: plan.parentId || quickAddFolderId(),
                                url: plan.it.url,
                                title: plan.it.title
                            }, created => {
                                if (created)
                                    staging.setFav(stagingState, plan.it.url, created.id);
                                restore();
                            });
                        };
                        // group-aware re-add: the pruned groups come back
                        // first so organized members reattach (H1)
                        const r = staging.restoreItems(stagingState,
                            items.map(it => ({ ...it })), groupSnaps);
                        if (r.full) {
                            toast(_m('stagingFull'));
                            return;
                        }
                        restore();
                    });
                    return;
                }
                const idx = i++;
                const it = bookmarked[idx];
                chrome.bookmarks.get(it.id, nodes => {
                    const node = nodes && nodes[0];
                    if (node && node.parentId)
                        restorePlans[idx].parentId = node.parentId;
                    chrome.bookmarks.remove(it.id, () => step());
                });
            };
            step();
        };
        if (dialogs && dialogs.ConfirmDialog) {
            dialogs.ConfirmDialog.open({
                dialog: _m('stagingDeleteConfirm', `${items.length}`),
                button1: `<strong>${_m('delete')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    // Remove from staging (tree untouched) — undo re-adds the snapshots WITH
    // their group membership (restoreItems re-creates pruned groups first).
    const removeSelected = () => {
        const items = selectedItems();
        if (!items.length)
            return;
        const snapshots = items.map(it => ({ ...it }));
        const groupSnaps = [...new Set(items.map(it => it.group).filter(Boolean))]
            .map(id => ({ ...staging.findGroup(stagingState, id) }));
        staging.removeByUrls(stagingState, items.map(it => it.url));
        persistStaging();
        renderStaging();
        undo.toastAction(_m('stagingRemovedCount', `${snapshots.length}`), _m('undoAction'), () => {
            const r = staging.restoreItems(stagingState, snapshots, groupSnaps);
            if (r.full) {
                toast(_m('stagingFull'));
                return;
            }
            persistStaging();
            renderStaging();
        });
    };

    const clearStaging = () => {
        if (!staging.count(stagingState))
            return;
        const run = () => {
            // capture BEFORE clearAll wipes them — undo restores items with
            // group membership AND the user-built groups themselves (H2)
            const snaps = stagingState.items.map(it => ({ ...it }));
            const groups = stagingState.groups.map(g => ({ ...g }));
            staging.clearAll(stagingState);
            selected.clear();
            persistStaging();
            renderStaging();
            undo.toastAction(_m('stagingCleared'), _m('undoAction'), () => {
                const r = staging.restoreItems(stagingState, snaps, groups);
                if (r.full) {
                    toast(_m('stagingFull'));
                    return;
                }
                persistStaging();
                renderStaging();
            });
        };
        if (dialogs && dialogs.ConfirmDialog) {
            dialogs.ConfirmDialog.open({
                dialog: _m('stagingClearConfirm'),
                button1: `<strong>${_m('stagingClearConfirmOk')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    // --- Move-to shortcuts (selection bar rung 3) --------------------------
    // MOVE only (the more common homing gesture): bookmarked items really
    // move and leave staging, unbookmarked ones are created into the folder
    // and leave too — the §3.3 move semantics via applyMoveOrCopy.
    const shortcutOf = id => shortcuts.find(s => s.id === id);

    const shortcutMove = id => {
        const sc = shortcutOf(id);
        const items = selectedItems();
        if (!sc || !items.length)
            return;
        applyMoveOrCopy(items, sc.folderId, 'move');
    };

    const openShortcutEditor = id => {
        if (!dialogs || !dialogs.StagingShortcutDialog)
            return;
        dialogs.StagingShortcutDialog.open({
            shortcut: id ? shortcutOf(id) : null,
            onSave: data => {
                if (!data || !data.folderId)
                    return;
                const saved = staging.upsertShortcut(shortcuts, data);
                persistShortcuts();
                // Defer past the dialog's close (which restores focus to
                // the invoker): after the bar re-renders, land keyboard
                // focus on the saved chip so ←/→ walk it immediately.
                setTimeout(() => {
                    renderStaging();
                    if (saved && saved.id && $list.querySelector) {
                        const chip = $list.querySelector('.staging-shortcut[data-shortcut-id="' + saved.id + '"]');
                        if (chip && chip.focus)
                            chip.focus();
                    }
                }, 0);
            }
        });
    };

    const removeShortcutChip = id => {
        if (!staging.removeShortcut(shortcuts, id))
            return;
        persistShortcuts();
        renderStaging();
        toast(_m('stagingShortcutRemoved'));
    };

    // Group-level homing (§3.5): the head's hover button + the group menu's
    // save/copy entries — the §3.3 actions with the group's members
    // preselected (no third action semantics).
    const groupItemsOf = gid => staging.groupItems(stagingState, gid);
    const saveGroupToFolder = gid => openPickerForItems(groupItemsOf(gid));
    const copyGroupToFolder = gid => openPickerForItems(groupItemsOf(gid));

    // --- Group operations (§3.5 — purely local, zero tree ops) --------------
    // §perf (fold surgery): a group/bucket fold moves ONLY the head's own
    // contiguous .staging-member rows — the head li keeps its node (focus,
    // drag state and the quick-tail listeners all survive), the recent
    // region stays untouched and no favicon re-hydration runs. Falls back
    // to the full staging repaint when the head li is missing (minimal
    // test doubles / a repaint that never landed).
    const escSel = s => (typeof CSS !== 'undefined' && CSS.escape)
        ? CSS.escape(s)
        : String(s).replace(/["\\]/g, '\\$&');
    const syncHeadFoldState = (headLi, headSel, collapsedNow) => {
        const head = headLi.querySelector(headSel);
        if (head)
            head.setAttribute('aria-expanded', collapsedNow ? 'false' : 'true');
        const chev = headLi.querySelector('.chevron');
        if (chev)
            chev.classList.toggle('collapsed', !!collapsedNow);
    };
    // §perf (fold surgery, node stash): collapsing DETACHES the head's
    // contiguous member rows into a DocumentFragment keyed by the head li
    // (WeakMap — a full repaint replaces the head element and orphans any
    // stale stash). Expanding reinserts the ORIGINAL nodes: dead overlays,
    // hydrated favicons and focus state all survive — no HTML re-parse, no
    // favicon load storm, no overlay rescan. The HTML rebuild stays as the
    // fallback for a head that never painted members (test doubles).
    const foldStash = new WeakMap();
    // A fold while the chunked stream is still landing rows must cancel it
    // and repaint with the new fold state — surgery assumes a settled DOM:
    // a pending batch could re-append the just-folded members after the
    // surgical removal. paintHandle alone can't say "streaming" (the sync
    // degrade path fires onSettled DURING the paint call, before the handle
    // assignment completes), so the settle flag carries the truth.
    let paintSettled = true;
    const foldDuringStream = () => {
        if (!paintHandle || paintSettled)
            return false;
        paintHandle.cancel();
        paintHandle = null;
        return true;
    };
    const stashRows = headLi => {
        const frag = foldStash.get(headLi) || document.createDocumentFragment();
        let next = headLi.nextElementSibling;
        while (next && next.classList && next.classList.contains('staging-member')) {
            const rm = next;
            next = next.nextElementSibling;
            frag.appendChild(rm);
        }
        return frag;
    };
    const foldStagingRows = (headLi, membersHtml) => {
        const stash = stashRows(headLi);
        if (!membersHtml) {
            if (stash.childNodes.length)
                foldStash.set(headLi, stash);
            return; // collapsed: removed nodes keep their overlays
        }
        if (stash.childNodes.length) {
            headLi.after(stash);
            return; // reinserted nodes keep their overlays
        }
        // membersHtml may be a thunk — only stringified when the stash missed
        const html = typeof membersHtml === 'function' ? membersHtml() : membersHtml;
        headLi.insertAdjacentHTML('afterend', html);
        onRowsRendered(); // rebuilt rows carry no overlays — repaint them
    };
    const memberRowsHtml = items => {
        const idxOf = new Map(stagingState.items.map((it, i) => [it.url, i]));
        return items.map((it, mi) => stagingRowHtml(it, idxOf.get(it.url), true, stagingLabels(), mi === items.length - 1)).join('');
    };

    const toggleGroupFold = groupId => {
        const g = staging.findGroup(stagingState, groupId);
        if (!g || selecting)
            return;
        staging.setGroupCollapsed(stagingState, groupId, !g.collapsed);
        lastRenderedRaw = foldPersist();
        const headLi = $list.querySelector
            ? $list.querySelector('li.staging-group[data-group-id="' + escSel(groupId) + '"]')
            : null;
        if (!headLi) {
            renderStaging();
            return;
        }
        if (foldDuringStream()) {
            renderStaging();
            return;
        }
        syncHeadFoldState(headLi, '.staging-group-head', g.collapsed);
        foldStagingRows(headLi, g.collapsed ? '' : () => memberRowsHtml(staging.groupItems(stagingState, groupId)));
    };

    // The staging-area fold (headCollapsed, 折叠记忆轮): the whole
    // #staging-items list hides under its head — a staging-only repaint
    // (the head is the anchor's leading chrome, the recent region stays).
    const toggleHeadFold = () => {
        if (selecting)
            return;
        const collapsedNow = !stagingState.headCollapsed;
        staging.setHeadCollapsed(stagingState, collapsedNow);
        lastRenderedRaw = foldPersist();
        const head = $list.querySelector ? $list.querySelector('#staging-head') : null;
        const ul = $list.querySelector ? $list.querySelector('#staging-items') : null;
        if (!head || !ul || typeof ul.innerHTML !== 'string') {
            renderStaging();
            return;
        }
        if (foldDuringStream()) {
            renderStaging();
            return;
        }
        head.classList.toggle('collapsed', collapsedNow);
        head.setAttribute('aria-expanded', collapsedNow ? 'false' : 'true');
        const chev = head.querySelector('.chevron');
        if (chev)
            chev.classList.toggle('collapsed', collapsedNow);
        if ($list.classList && typeof $list.classList.toggle === 'function')
            $list.classList.toggle('staging-area-collapsed', collapsedNow);
        // first unfold after a folded-open: the rows never streamed — drop
        // the cached pieces in ONE innerHTML (no rebuild, no stream wait)
        if (!collapsedNow && !ul.children.length && stagingRowsCache) {
            ul.innerHTML = stagingRowsCache;
            onRowsRendered(); // rebuilt rows carry no overlays — repaint them
        }
        // else: pure class toggle — the rows never left the DOM, no rescan
    };

    // A recent time-bucket fold (recentGroupCollapsed, 折叠记忆轮): surgical
    // DOM update on the bucket's own contiguous member rows — the head li
    // survives (focus stays), rows come back from the last render's cache.
    const toggleRecentGroupFold = g => {
        if (selecting)
            return;
        const key = GROUP_KEYS[g];
        const collapsedNow = !stagingState.recentGroupCollapsed[key];
        staging.setRecentGroupCollapsed(stagingState, key, collapsedNow);
        lastRenderedRaw = foldPersist();
        const headLi = $list.querySelector
            ? $list.querySelector('li.recent-group-li[data-recent-group="' + g + '"]')
            : null;
        if (!headLi) {
            refresh();
            return;
        }
        if (foldDuringStream()) {
            refresh();
            return;
        }
        headLi.classList.toggle('collapsed', collapsedNow);
        const head = headLi.querySelector('.recent-group-head');
        if (head)
            head.setAttribute('aria-expanded', collapsedNow ? 'false' : 'true');
        const chev = headLi.querySelector('.chevron');
        if (chev)
            chev.classList.toggle('collapsed', !!collapsedNow);
        // §perf (node stash, same as foldStagingRows): detach into a
        // fragment keyed by the head, reinsert the ORIGINAL nodes on expand.
        const stash = foldStash.get(headLi) || document.createDocumentFragment();
        let next = headLi.nextElementSibling;
        while (next && next.classList && next.classList.contains('vbm-row')
            && next.dataset && next.dataset.recentGroup === String(g)) {
            const rm = next;
            next = next.nextElementSibling;
            stash.appendChild(rm);
        }
        if (collapsedNow) {
            if (stash.childNodes.length)
                foldStash.set(headLi, stash);
            return;
        }
        if (stash.childNodes.length) {
            headLi.after(stash);
            return; // reinserted nodes keep their overlays
        }
        if (recentGroupRows[g] && recentGroupRows[g].length) {
            headLi.insertAdjacentHTML('afterend', recentMemberHtml(g, recentGroupRows[g]));
            onRowsRendered(); // rebuilt rows carry no overlays — repaint them
        }
    };

    const toggleBucketFold = () => {
        if (selecting)
            return;
        staging.setUnfavCollapsed(stagingState, !stagingState.unfavCollapsed);
        lastRenderedRaw = foldPersist();
        const headLi = $list.querySelector
            ? $list.querySelector('li.staging-bucket')
            : null;
        if (!headLi) {
            renderStaging();
            return;
        }
        if (foldDuringStream()) {
            renderStaging();
            return;
        }
        syncHeadFoldState(headLi, '.staging-bucket-head', stagingState.unfavCollapsed);
        foldStagingRows(headLi, stagingState.unfavCollapsed ? '' : () => memberRowsHtml(staging.unfavBucketItems(stagingState)));
    };

    // 全部折叠/全部展开: every virtual folding unit (named groups + the
    // inbox bucket) snaps to `want`. An explicit bulk action pays one full
    // staging repaint — the surgical fold paths are for single-head toggles.
    const setAllFolds = want => {
        if (!stagingState.groups.length && !staging.unfavBucketItems(stagingState).length)
            return;
        for (const g of stagingState.groups)
            staging.setGroupCollapsed(stagingState, g.id, want);
        staging.setUnfavCollapsed(stagingState, want);
        lastRenderedRaw = foldPersist();
        renderStaging();
    };

    const renameGroup = groupId => {
        const g = staging.findGroup(stagingState, groupId);
        if (!g || !dialogs || !dialogs.NewFolderDialog)
            return;
        dialogs.NewFolderDialog.open(g.name, name => {
            if (!name || !name.trim())
                return;
            staging.renameGroup(stagingState, groupId, name.trim());
            persistStaging();
            renderStaging();
        });
    };

    const dissolveGroup = groupId => {
        const g = staging.findGroup(stagingState, groupId);
        if (!g)
            return;
        // undo bookkeeping BEFORE the dissolve: the group snapshot (name,
        // source binding, fold state) and the member urls (dissolve keeps
        // the members — undo just re-binds them to the restored group)
        const groupSnap = { ...g };
        const memberUrls = staging.groupItems(stagingState, groupId).map(it => it.url);
        if (!staging.dissolveGroup(stagingState, groupId))
            return;
        persistStaging();
        renderStaging();
        undo.toastAction(_m('stagingGroupDissolved'), _m('undoAction'), () => {
            staging.restoreItems(stagingState, [], [groupSnap]);
            staging.assignGroup(stagingState, memberUrls, groupSnap.id);
            persistStaging();
            renderStaging();
        });
    };

    // User-built groups (the workbench's organizing units): created empty
    // (manual: true — they survive pruneEmptyGroups), named through the same
    // NewFolderDialog the rename path uses.
    const newGroup = () => {
        if (!dialogs || !dialogs.NewFolderDialog)
            return;
        dialogs.NewFolderDialog.open('', name => {
            if (!name || !name.trim())
                return;
            staging.createGroup(stagingState, name.trim(), { manual: true });
            persistStaging();
            renderStaging();
        });
    };

    // Delete (vs dissolve): the group AND its member items leave staging —
    // confirm-gated (information deletion), toast-undo restores both.
    const deleteGroup = groupId => {
        const g = staging.findGroup(stagingState, groupId);
        if (!g)
            return;
        const count = staging.groupItems(stagingState, groupId).length;
        const run = () => {
            const receipt = staging.deleteGroup(stagingState, groupId);
            if (!receipt)
                return;
            persistStaging();
            renderStaging();
            undo.toastAction(_m('stagingGroupDeleted', `${receipt.removed.length}`), _m('undoAction'), () => {
                staging.restoreGroup(stagingState, receipt);
                persistStaging();
                renderStaging();
            });
        };
        if (dialogs && dialogs.ConfirmDialog) {
            dialogs.ConfirmDialog.open({
                dialog: _m('stagingGroupDeleteConfirm', [htmlspecialchars(g.name || _m('noTitle')), `${count}`]),
                button1: `<strong>${_m('delete')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    // Drag reorder of the groups themselves (manual arrangement, staging-only
    // bookkeeping): the dragged head lands BEFORE the target head.
    const reorderGroup = (draggedId, targetId) => {
        if (!staging.reorderGroups(stagingState, draggedId, targetId))
            return;
        persistStaging();
        renderStaging();
    };

    // The assign dialog (§3.3): existing groups as rows + a new-name input.
    const openGroupAssign = urls => {
        if (!dialogs || !dialogs.StagingGroupAssignDialog)
            return;
        const groups = stagingState.groups.map(g => ({
            id: g.id,
            name: g.name,
            count: staging.groupItems(stagingState, g.id).length
        }));
        dialogs.StagingGroupAssignDialog.open({
            groups,
            onAssign: (groupId, name) => {
                let target = groupId && staging.findGroup(stagingState, groupId);
                if (!target)
                    target = staging.createGroup(stagingState, name || '');
                staging.assignGroup(stagingState, urls, target.id);
                persistStaging();
                renderStaging();
            }
        });
    };

    // --- Send entries (the API other views call) ---------------------------
    const addItems = (entries, opts = {}) => {
        if (!entries || !entries.length)
            return { full: false, added: [], dupes: [] };
        const r = staging.add(stagingState, entries, opts);
        if (r.full) {
            toast(_m('stagingFull'));
            return r;
        }
        if (r.added.length || r.dupes.length) {
            persistStaging();
            renderStaging();
            if (opts.silent !== true) {
                if (!r.added.length)
                    toast(_m('stagingAlready'));
                else if (r.dupes.length)
                    toast(_m('stagingAddedSummary', [`${r.added.length}`, `${r.dupes.length}`]));
                else if (r.added.length === 1)
                    toast(_m('stagingAdded'));
                else
                    toast(_m('stagingAddedSummary', [`${r.added.length}`, '0']));
            }
        }
        return r;
    };

    // Named-group landing (2026-08-26): a bucket send (最近添加的时间组 /
    // the search results' keyword batch) lands in a staging group NAMED
    // after its origin — an existing same-name group absorbs the batch
    // (append, the model's URL dedupe keeps it clean), otherwise a fresh
    // group is created. Auto (not manual): emptying it prunes it away.
    const stageIntoNamedGroup = (name, entries) => {
        if (!entries || !entries.length)
            return { full: false, added: [], dupes: [] };
        const trimmed = (name || '').trim();
        let group = trimmed ? staging.findGroupByName(stagingState, trimmed) : null;
        if (!group)
            group = staging.createGroup(stagingState, trimmed, {});
        return addItems(entries, { defaultGroup: group.id });
    };

    // Folder send (§1.1/§1.3): flatten every descendant bookmark (skipping
    // separators and sub-folder nodes), auto-merge into a sourceFolderId
    // group, guard the >100 confirm and the 500 cap.
    const collectFolderBookmarks = node => {
        const out = [];
        const walk = nodes => {
            for (let i = 0, l = (nodes || []).length; i < l; i++) {
                const c = nodes[i];
                if (!c)
                    continue;
                if (c.url) {
                    if (!separatorManager.isSeparator(c.title, c.url))
                        out.push({ id: c.id, url: c.url, title: c.title });
                } else if (c.children) {
                    walk(c.children);
                }
            }
        };
        walk(node.children || []);
        return out;
    };

    const FOLDER_CONFIRM_LIMIT = 100;

    const sendFolderNode = node => {
        if (!node || !node.id)
            return;
        const entries = collectFolderBookmarks(node);
        if (!entries.length) {
            toast(_m('stagingFolderEmpty'));
            return;
        }
        const run = () => {
            let group = staging.findGroupBySource(stagingState, { sourceFolderId: node.id });
            if (!group)
                group = staging.createGroup(stagingState, node.title || '', { sourceFolderId: node.id });
            addItems(entries, { defaultGroup: group.id });
        };
        if (entries.length > FOLDER_CONFIRM_LIMIT && dialogs && dialogs.ConfirmDialog) {
            dialogs.ConfirmDialog.open({
                dialog: _m('stagingConfirmFolder', `${entries.length}`),
                button1: `<strong>${_m('stagingConfirmFolderOk')}</strong>`,
                button2: _m('nope'),
                fn1: run
            });
        } else {
            run();
        }
    };

    const sendFolder = folderId => {
        chrome.bookmarks.getSubTree(folderId, nodes => {
            if (nodes && nodes.length)
                sendFolderNode(nodes[0]);
        });
    };

    // The recent region's hover arrow (§2.2) — toggle semantics, the same
    // mental model as the quick-add star.
    const toggleUrl = (url, id, title) => {
        const existing = staging.getByUrl(stagingState, url);
        if (existing) {
            staging.removeByUrls(stagingState, [url]);
            persistStaging();
            renderStaging();
            toast(_m('stagingRemoved'));
        } else {
            addItems([{ id: id || null, url, title }]);
        }
    };

    const stageAllRecent = items => {
        const entries = [];
        for (let i = 0, l = (items || []).length; i < l; i++) {
            const d = items[i];
            if (d.url && !separatorManager.isSeparator(d.title, d.url))
                entries.push({ id: d.id, url: d.url, title: d.title });
        }
        if (!entries.length)
            return;
        addItems(entries);
    };

    // --- Tree-event sync (§0.5) ---------------------------------------------
    const relinkWith = urlIndex => {
        const r = staging.relink(stagingState, urlIndex);
        if (r.changed)
            commitStagingSoon();
    };

    // Incremental verification for a removed anchor: per-url search keeps it
    // item-scoped (never a full-tree walk between rebuilds).
    const verifyUrls = urls => {
        const unique = [...new Set(urls)];
        let pending = unique.length;
        if (!pending)
            return;
        const index = new Map();
        for (const url of unique) {
            chrome.bookmarks.search({ url }, found => {
                const hit = (found || []).find(f => f.url === url);
                index.set(url, hit ? hit.id : undefined);
                if (--pending === 0)
                    relinkWith(index);
            });
        }
    };

    chrome.bookmarks.onCreated.addListener((id, node) => {
        scheduleRefresh();
        // A staged id-less row whose URL just became a bookmark elsewhere
        // auto-promotes (workbench and tree stay consistent). State lands
        // synchronously; the repaint is coalesced (batch creates fire this
        // once per item — see commitStagingSoon).
        if (node && node.url) {
            const it = staging.getByUrl(stagingState, node.url);
            if (it && !it.id) {
                staging.setFav(stagingState, node.url, id);
                commitStagingSoon();
            }
        }
    });
    chrome.bookmarks.onRemoved.addListener(id => {
        scheduleRefresh();
        const affected = stagingState.items.filter(it => it.id === id).map(it => it.url);
        if (affected.length)
            verifyUrls(affected);
    });
    // NEW (§0.5): title/url edits keep the snapshot in step with the tree.
    chrome.bookmarks.onChanged.addListener((id, changes) => {
        if (staging.updateSnapshot(stagingState, id, changes))
            commitStagingSoon();
    });

    // Full-index relink riding every tree rebuild (neat.js feeds the
    // buildTreeSnapshot pass; zero extra traversal).
    const buildUrlIndex = tree => {
        const index = new Map();
        const walk = nodes => {
            for (let i = 0, l = (nodes || []).length; i < l; i++) {
                const n = nodes[i];
                if (!n)
                    continue;
                if (n.url && !index.has(n.url))
                    index.set(n.url, n.id);
                if (n.children)
                    walk(n.children);
            }
        };
        walk(tree || []);
        return index;
    };
    const onTreeSnapshot = (tree, snapshot) => {
        if (!staging.count(stagingState))
            return;
        const urlIndex = (snapshot && snapshot.urlIndex) ? snapshot.urlIndex : buildUrlIndex(tree);
        relinkWith(urlIndex);
    };

    // Cross-document consistency (§0.3): popup and sidepanel each hold a
    // store mirror; the other document's write replays here as a whole-
    // object re-parse (never trust the local mirror, never merge). Our OWN
    // writes echo too (see ownWrites above) and are skipped.
    if (chrome.storage && chrome.storage.onChanged)
        chrome.storage.onChanged.addListener((changes, area) => {
            // The master switch lives in the SYNC area (options page writes
            // it there through the area-transparent routing) — adopt + repaint
            // for both areas; a stale workbench must not survive the flip.
            if ('stagingEnabled' in changes) {
                if (store.adopt)
                    store.adopt('stagingEnabled', changes.stagingEnabled.newValue);
                if (views.isActive('recent'))
                    refresh();
                refreshTree();
                views.updateBadges();
                return;
            }
            if (area !== 'local')
                return;
            if ('staging' in changes) {
                const raw = changes.staging.newValue;
                if (ownWrites.includes(raw))
                    return; // our own echo — state and mirror already hold it
                if (store.adopt)
                    store.adopt('staging', raw);
                stagingState = staging.parse(raw);
                renderStaging();
            }
            if ('stagingShortcuts' in changes) {
                const raw = changes.stagingShortcuts.newValue;
                if (ownShortcutWrites.includes(raw))
                    return;
                if (store.adopt)
                    store.adopt('stagingShortcuts', raw);
                shortcuts = staging.parseShortcuts(raw);
                renderStaging();
            }
        });

    // Tree-event mutations (promotions, snapshot updates, relinks) land on
    // the state object synchronously, but their persist+render pass is
    // coalesced: a folder-send batch or an undo replay fires one bookmark
    // event per item, and a full innerHTML re-render per event froze the
    // popup through the whole sequence (the "extremely laggy" report).
    let eventCommitTimer = null;
    const commitStagingSoon = () => {
        if (eventCommitTimer)
            return;
        eventCommitTimer = setTimeout(() => {
            eventCommitTimer = null;
            persistStaging();
            renderStaging();
        }, 120);
    };

    // Debounced freshness while the popup stays open.
    let refreshTimer = null;
    const scheduleRefresh = () => {
        if (!enabled())
            return;
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(refresh, 300);
    };

    // Open semantics are the tree's (§5.3: 打开/右键菜单/键盘与 tree 书签行
    // 一致): the shared bookmarkHandler dispatches plain bookmark clicks;
    // the body-level contextmenu delegation picks the bookmark menu. The
    // banner's controls and the staging entry points are intercepted first.
    $list.addEventListener('click', e => {
        const closest = (e.target && e.target.closest) ? e.target.closest.bind(e.target) : () => null;
        if (selecting) {
            // toolbar buttons first, then row/group/bucket toggles; everything
            // else is swallowed while selecting (§3.1)
            const li = closest('li');
            const toolbarBtn = cls => {
                const btn = closest(cls);
                return btn && closest('.vbm-toolbar') ? btn : null;
            };
            if (toolbarBtn('.staging-select-all')) {
                for (const it of stagingState.items)
                    selected.add(it.url);
                renderStaging();
                return;
            }
            if (toolbarBtn('.staging-select-invert')) {
                for (const it of stagingState.items) {
                    if (selected.has(it.url))
                        selected.delete(it.url);
                    else
                        selected.add(it.url);
                }
                renderStaging();
                return;
            }
            if (toolbarBtn('.staging-select-clear')) {
                selected.clear();
                renderStaging();
                return;
            }
            if (toolbarBtn('.staging-select-exit')) {
                setSelecting(false, 'entry');
                return;
            }
            if (toolbarBtn('.staging-open')) { openSelected(); return; }
            if (toolbarBtn('.staging-open-group')) { openSelectedInGroup(); return; }
            if (toolbarBtn('.staging-fav')) { favSelected(); return; }
            if (toolbarBtn('.staging-unfav')) { unfavSelected(); return; }
            if (toolbarBtn('.staging-assign')) { openGroupAssign([...selected]); return; }
            if (toolbarBtn('.staging-movecopy')) { moveCopySelected(); return; }
            if (toolbarBtn('.staging-delete')) { deleteSelected(); return; }
            if (toolbarBtn('.staging-remove')) { removeSelected(); return; }
            if (toolbarBtn('.staging-clear-all')) { clearStaging(); return; }
            // move-to shortcuts (rung 3): normal mode = click moves the
            // whole selection; edit mode = click opens the editor and
            // the floating × deletes. [+] adds, [pencil] toggles edit mode.
            if (toolbarBtn('.staging-shortcut')) {
                const btn = closest('.staging-shortcut');
                if (btn && btn.dataset && btn.dataset.shortcutId) {
                    if (editingShortcuts)
                        openShortcutEditor(btn.dataset.shortcutId);
                    else
                        shortcutMove(btn.dataset.shortcutId);
                }
                return;
            }
            if (toolbarBtn('.staging-shortcut-del')) {
                const btn = closest('.staging-shortcut-del');
                if (btn && btn.dataset && btn.dataset.shortcutId)
                    removeShortcutChip(btn.dataset.shortcutId);
                return;
            }
            if (toolbarBtn('.staging-shortcut-add')) {
                openShortcutEditor(null);
                return;
            }
            if (toolbarBtn('.staging-shortcut-edit-mode')) {
                editingShortcuts = !editingShortcuts;
                renderStaging();
                return;
            }
            // a group/bucket head click selects ALL its members (§3.2)
            const headLi = closest('.staging-group') || closest('.staging-bucket');
            if (headLi) {
                e.preventDefault();
                let memberUrls;
                if (headLi.dataset && headLi.dataset.groupId)
                    memberUrls = groupItemsOf(headLi.dataset.groupId).map(it => it.url);
                else
                    memberUrls = staging.unfavBucketItems(stagingState).map(it => it.url);
                const allIn = memberUrls.length && memberUrls.every(u => selected.has(u));
                for (const u of memberUrls) {
                    if (allIn)
                        selected.delete(u);
                    else
                        selected.add(u);
                }
                renderStaging();
                return;
            }
            if (li && li.dataset && li.dataset.url !== undefined) {
                e.preventDefault();
                e.stopPropagation();
                const url = li.dataset.url;
                if (selected.has(url))
                    selected.delete(url);
                else
                    selected.add(url);
                renderStaging();
            }
            return;
        }
        if (closest('.staging-select-mode')) {
            e.preventDefault();
            setSelecting(true, 'first');
            return;
        }
        if (closest('.staging-clear-entry')) {
            e.preventDefault();
            e.stopPropagation();
            clearStaging();
            return;
        }
        if (closest('.staging-new-group')) {
            e.preventDefault();
            e.stopPropagation();
            newGroup();
            return;
        }
        if (closest('.staging-fold-collapse-all')) {
            e.preventDefault();
            e.stopPropagation();
            setAllFolds(true);
            return;
        }
        if (closest('.staging-fold-expand-all')) {
            e.preventDefault();
            e.stopPropagation();
            setAllFolds(false);
            return;
        }
        // The staging head folds the whole staging area; its buttons'
        // branches above win their own clicks first.
        if (closest('#staging-head')) {
            e.preventDefault();
            toggleHeadFold();
            return;
        }
        if (closest('.staging-group-open-all')) {
            e.preventDefault();
            e.stopPropagation();
            const headLi = closest('.staging-group');
            const gid = headLi && headLi.dataset && headLi.dataset.groupId;
            const urls = gid ? groupItemsOf(gid).map(it => it.url) : [];
            if (urls.length && ctx.actions && ctx.actions.openBookmarks)
                ctx.actions.openBookmarks(urls);
            return;
        }
        if (closest('.staging-group-open-group')) {
            e.preventDefault();
            e.stopPropagation();
            const headLi = closest('.staging-group');
            const gid = headLi && headLi.dataset && headLi.dataset.groupId;
            const urls = gid ? groupItemsOf(gid).map(it => it.url) : [];
            const g = gid ? staging.findGroup(stagingState, gid) : null;
            if (urls.length && ctx.actions && ctx.actions.openBookmarksInGroup)
                ctx.actions.openBookmarksInGroup(urls, (g && g.name) || '');
            return;
        }
        if (closest('.staging-group-rename')) {
            e.preventDefault();
            e.stopPropagation();
            const headLi = closest('.staging-group');
            if (headLi && headLi.dataset && headLi.dataset.groupId)
                renameGroup(headLi.dataset.groupId);
            return;
        }
        if (closest('.staging-group-place')) {
            e.preventDefault();
            e.stopPropagation();
            const headLi = closest('.staging-group');
            if (headLi && headLi.dataset && headLi.dataset.groupId)
                saveGroupToFolder(headLi.dataset.groupId);
            return;
        }
        // The quick tail's group-specific pair (dissolve / delete) — the
        // same handlers the group menu dispatches (delete is confirm-gated
        // with a toast undo, dissolve scatters members in place).
        if (closest('.staging-group-dissolve')) {
            e.preventDefault();
            e.stopPropagation();
            const headLi = closest('.staging-group');
            if (headLi && headLi.dataset && headLi.dataset.groupId)
                dissolveGroup(headLi.dataset.groupId);
            return;
        }
        if (closest('.staging-group-remove')) {
            // 移出暂存 (rightmost head slot): the group AND its member
            // items leave the staging area — tree untouched, confirm +
            // toast undo. The dangerous 删除分组 stays in the menu.
            e.preventDefault();
            e.stopPropagation();
            const headLi = closest('.staging-group');
            if (headLi && headLi.dataset && headLi.dataset.groupId)
                deleteGroup(headLi.dataset.groupId);
            return;
        }
        if (closest('.stats-history-enable')) {
            e.preventDefault();
            if (chrome.permissions && chrome.permissions.request) {
                chrome.permissions.request({ permissions: ['history'] }, granted => {
                    historyPerm = !!granted;
                    if (granted)
                        importHistory();
                    else
                        refresh(); // denied — the banner stays
                });
            }
            return;
        }
        if (closest('.stats-history-dismiss')) {
            e.preventDefault();
            store.set('statsHistoryBannerDismissed', '1');
            refresh();
            return;
        }
        if (closest('.staging-guide-close')) {
            // Session-level × (the risk-banner law): gone for this popup
            // open, back on the next one — 不再提醒 stays permanent.
            e.preventDefault();
            e.stopPropagation();
            guideDismissed = true;
            renderStaging();
            return;
        }
        if (closest('.staging-guide-dismiss')) {
            e.preventDefault();
            e.stopPropagation();
            store.set('stagingGuideDismissed', '1');
            renderStaging();
            return;
        }
        if (closest('.staging-add-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const li = closest('li');
            const id = li && li.dataset && li.dataset.nodeId;
            const url = li && ((li.dataset && li.dataset.url) ||
                (li.querySelector && li.querySelector('a') ? li.querySelector('a').getAttribute('href') : ''));
            const title = '';
            if (url) {
                const existing = staging.getByUrl(stagingState, url);
                toggleUrl(url, id, title);
                // The recent region is deliberately untouched by staging
                // repaints — flip the clicked plane in place (hollow → the
                // always-on filled plane, one visual law with every relay).
                flipStageBtn(e.target.closest('.staging-add-btn'), !existing, _m);
            }
            return;
        }
        if (closest('.staging-star')) {
            e.preventDefault();
            e.stopPropagation();
            const li = closest('li');
            const url = li && li.dataset && li.dataset.url;
            if (url)
                favToggle(url);
            return;
        }
        if (closest('.staging-remove')) {
            e.preventDefault();
            e.stopPropagation();
            const li = closest('li');
            const url = li && li.dataset && li.dataset.url;
            if (url)
                api.removeByUrl(url);
            return;
        }
        if (closest('.staging-bucket-remove-all')) {
            e.preventDefault();
            e.stopPropagation();
            removeBucketItems();
            return;
        }
        if (closest('.staging-bucket-fav-all')) {
            e.preventDefault();
            e.stopPropagation();
            favAllBucket();
            return;
        }
        if (closest('.staging-bucket-head')) {
            e.preventDefault();
            toggleBucketFold();
            return;
        }
        if (closest('.staging-group-head')) {
            e.preventDefault();
            const li = closest('li');
            const gid = li && li.dataset && li.dataset.groupId;
            if (gid)
                toggleGroupFold(gid);
            return;
        }
        if (closest('.recent-group-stage')) {
            e.preventDefault();
            e.stopPropagation();
            const btn = closest('.recent-group-stage');
            const g = parseInt(btn.dataset ? btn.dataset.recentGroup : '', 10);
            // 命名分组落地 (2026-08-26): the batch lands in a staging group
            // NAMED after the bucket (本周 → 本周); a same-name group
            // absorbs the append instead of forking a sibling.
            if (!isNaN(g) && recentGroupUrls[g] && recentGroupUrls[g].length)
                stageIntoNamedGroup(_m(GROUP_KEYS[g]), recentGroupUrls[g]);
            return;
        }
        if (closest('.recent-stage-all')) {
            e.preventDefault();
            e.stopPropagation();
            chrome.bookmarks.getRecent(recentCount(), items => stageAllRecent(items));
            return;
        }
        // A recent time-bucket head folds its own rows (折叠记忆轮); the
        // stage button inside it is handled above.
        if (closest('.recent-group-head')) {
            e.preventDefault();
            const headLi = closest('.recent-group-li') || closest('li');
            const g = headLi && headLi.dataset ? parseInt(headLi.dataset.recentGroup, 10) : NaN;
            if (!isNaN(g))
                toggleRecentGroupFold(g);
            return;
        }
        if (closest('#recent-head')) {
            e.preventDefault();
            // The rows stay painted; the fold is a zero-work display swap
            // (root class) — no refresh, no repaint, no stream.
            const collapsedNow = !stagingState.recentCollapsed;
            staging.setRecentCollapsed(stagingState, collapsedNow);
            persistStaging();
            lastRenderedRaw = staging.serialize(stagingState);
            const headEl = $list.querySelector ? $list.querySelector('#recent-head') : null;
            if (!headEl) {
                refresh();
                return;
            }
            headEl.classList.toggle('collapsed', collapsedNow);
            headEl.setAttribute('aria-expanded', collapsedNow ? 'false' : 'true');
            const chev = headEl.querySelector('.chevron');
            if (chev)
                chev.classList.toggle('collapsed', collapsedNow);
            if ($list.classList && typeof $list.classList.toggle === 'function')
                $list.classList.toggle('recent-area-collapsed', collapsedNow);
            return;
        }
        treeView.bookmarkHandler(e);
    });
    $list.addEventListener('auxclick', treeView.bookmarkHandler);

    // --- Drag & drop between staging groups (the workbench's manual organ-
    // izing): rows drag onto group heads / the bucket head (ungroup) / other
    // rows (adopt that row's group); group heads drag to reorder. Everything
    // lands ONLY in the staging model — the tree is never touched. HTML5 DnD
    // here never meets the tree's mousedown machinery: staging anchors carry
    // data-virtual (the tree drag skips them) and this list is not #tree.
    const STAGING_ROW_MIME = 'application/x-vbm-staging';
    const STAGING_GROUP_MIME = 'application/x-vbm-staging-group';
    let dragRowUrl = null;
    let dragGroupId = null;
    let dragOverEl = null;

    const dragTargetOf = t => {
        if (!t || !t.closest)
            return null;
        return t.closest('.staging-group-head') || t.closest('.staging-bucket-head') ||
            (dragRowUrl ? t.closest('li.staging-row') : null);
    };

    $list.addEventListener('dragstart', e => {
        if (selecting) {
            e.preventDefault();
            return;
        }
        // Interactive children never start a drag: a click on the star/× or
        // the head's rename/place buttons is an action, not a grab point.
        if (e.target && e.target.closest && e.target.closest('button, a'))
            return;
        const li = e.target && e.target.closest ? e.target.closest('li.staging-row') : null;
        if (li && li.dataset && li.dataset.url !== undefined) {
            dragRowUrl = li.dataset.url;
            dragGroupId = null;
            try {
                e.dataTransfer.setData(STAGING_ROW_MIME, dragRowUrl);
                e.dataTransfer.setData('text/plain', dragRowUrl);
                e.dataTransfer.effectAllowed = 'move';
            } catch (_) { dragRowUrl = null; }
            li.classList.add('dragging');
            return;
        }
        const head = e.target && e.target.classList && e.target.classList.contains('staging-group-head')
            ? e.target : null;
        const gid = head && head.parentNode && head.parentNode.dataset
            ? head.parentNode.dataset.groupId : null;
        if (gid) {
            dragGroupId = gid;
            dragRowUrl = null;
            try {
                e.dataTransfer.setData(STAGING_GROUP_MIME, gid);
                e.dataTransfer.effectAllowed = 'move';
            } catch (_) { dragGroupId = null; }
            head.classList.add('dragging');
        }
    });

    $list.addEventListener('dragover', e => {
        if (selecting || (!dragRowUrl && !dragGroupId))
            return;
        const target = dragTargetOf(e.target);
        if (!target)
            return;
        e.preventDefault();
        if (e.dataTransfer)
            e.dataTransfer.dropEffect = 'move';
        if (dragOverEl !== target) {
            if (dragOverEl && dragOverEl.classList)
                dragOverEl.classList.remove('drag-over');
            dragOverEl = target;
        }
        if (!target.classList.contains('drag-over'))
            target.classList.add('drag-over');
    });

    $list.addEventListener('drop', e => {
        if (selecting || (!dragRowUrl && !dragGroupId))
            return;
        const target = dragTargetOf(e.target);
        if (!target)
            return;
        e.preventDefault();
        e.stopPropagation();
        if (dragOverEl && dragOverEl.classList)
            dragOverEl.classList.remove('drag-over');
        dragOverEl = null;
        if (dragGroupId) {
            const headLi = target.classList.contains('staging-group-head')
                ? target.parentNode : null;
            const targetGid = headLi && headLi.dataset ? headLi.dataset.groupId : null;
            if (targetGid && targetGid !== dragGroupId)
                reorderGroup(dragGroupId, targetGid);
            dragGroupId = null;
            return;
        }
        const url = dragRowUrl;
        dragRowUrl = null;
        const it = url ? staging.getByUrl(stagingState, url) : null;
        if (!it)
            return;
        if (target.classList.contains('staging-group-head')) {
            const gid = target.parentNode && target.parentNode.dataset
                ? target.parentNode.dataset.groupId : null;
            if (gid && it.group !== gid) {
                staging.assignGroup(stagingState, [url], gid);
                // Dropping into a collapsed group reveals it — the result of
                // the move must be visible, not swallowed by the fold.
                staging.setGroupCollapsed(stagingState, gid, false);
                persistStaging();
                renderStaging();
            }
            return;
        }
        if (target.classList.contains('staging-bucket-head')) {
            // the inbox head = "no group": bookmarked rows fall to the loose
            // rows, unbookmarked ones to the bucket — assignGroup sorts it.
            if (it.group !== null) {
                staging.assignGroup(stagingState, [url], null);
                persistStaging();
                renderStaging();
            }
            return;
        }
        // a staging row target: adopt that row's group (loose row → ungroup)
        const rowLi = target;
        const rowIt = rowLi.dataset && rowLi.dataset.url
            ? staging.getByUrl(stagingState, rowLi.dataset.url) : null;
        const rowGroup = rowIt ? rowIt.group : undefined;
        if (rowGroup !== undefined && it.group !== rowGroup) {
            staging.assignGroup(stagingState, [url], rowGroup);
            persistStaging();
            renderStaging();
        }
    });

    $list.addEventListener('dragend', () => {
        dragRowUrl = null;
        dragGroupId = null;
        dragOverEl = null;
        for (const el of $list.querySelectorAll('.drag-over, .dragging'))
            el.classList.remove('drag-over', 'dragging');
    });
    $list.addEventListener('keydown', e => {
        // Delete on a staging row = remove-from-staging (the row × button's
        // semantics, with undo) — NOT actions.deleteBookmark: the shared
        // keyup handler would delete the REAL bookmark for staged rows and
        // silently no-op on unbookmarked ones (M3). Consumed here so the
        // keyup path never sees it.
        if (e.key === 'Delete') {
            const li = e.target && e.target.closest ? e.target.closest('li.vbm-row') : null;
            const url = li && li.dataset ? li.dataset.url : undefined;
            if (url !== undefined && staging.getByUrl(stagingState, url)) {
                e.preventDefault();
                e.stopPropagation();
                removeByUrl(url);
                return;
            }
        }
        // Esc closes the first-run guide banner (keyboard parity with the
        // click × — M5; the banner buttons stay mouse-only, but Esc must
        // always offer an exit).
        if (e.key === 'Escape' && !selecting && !guideDismissed &&
            !store.get('stagingGuideDismissed') &&
            $list.querySelector('.staging-guide-banner')) {
            e.preventDefault();
            e.stopPropagation();
            guideDismissed = true;
            renderStaging();
            return;
        }
        // Head keys (dupes group-head protocol): ←/→/Space/Enter fold a
        // group/bucket head, or the recently-added section head, when the
        // head itself holds focus (heads are tabindex=-1 rows of the walk).
        const headTarget = e.target && e.target.closest
            ? (e.target.closest('.staging-group-head') || e.target.closest('.staging-bucket-head') ||
                e.target.closest('.recent-group-head') || e.target.closest('#staging-head') ||
                e.target.closest('#recent-head'))
            : null;
        // A quick-tail button owns its own keys: after clicking
        // rename/dissolve/place/delete (or fav-all / stage-all) focus
        // stays on the button, and Space/Enter must re-activate the
        // BUTTON, not fold the head behind it.
        if (headTarget && e.target !== headTarget && e.target.closest &&
            e.target.closest('.staging-group-head button, .staging-bucket-head button, .recent-group-head button, #staging-head button, #recent-head button'))
            return;
        // F2 renames the focused group head (the tabgroups-head parity).
        if (headTarget && e.key === 'F2' && !selecting &&
            headTarget.classList.contains('staging-group-head')) {
            e.preventDefault();
            e.stopPropagation();
            const li = headTarget.closest('li');
            if (li && li.dataset && li.dataset.groupId)
                renameGroup(li.dataset.groupId);
            return;
        }
        if (headTarget && !selecting && [' ', 'Enter', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            const fold = () => {
                e.preventDefault();
                e.stopPropagation();
                headTarget.click();
            };
            const isRtl = !!(document.body && document.body.classList
                && document.body.classList.contains('rtl'));
            const li = headTarget.closest('li');
            const collapsedNow = headTarget.getAttribute && headTarget.getAttribute('aria-expanded') === 'false';
            const expand = (e.key === ' ' || e.key === 'Enter' || e.key === (isRtl ? 'ArrowLeft' : 'ArrowRight')) && collapsedNow;
            const collapse = (e.key === ' ' || e.key === 'Enter' || e.key === (isRtl ? 'ArrowRight' : 'ArrowLeft')) && !collapsedNow;
            if (expand || collapse)
                fold();
            void li;
            return;
        }
        // Selecting + Space on a group/bucket head selects ALL its members
        // (the dupes selecting-bar protocol — keyboard parity for the click).
        if (headTarget && selecting && e.key === ' ') {
            const headLi = headTarget.closest('li');
            if (headLi && (headLi.classList.contains('staging-group') || headLi.classList.contains('staging-bucket'))) {
                e.preventDefault();
                e.stopPropagation();
                headTarget.click();
            }
            return;
        }
        if (!selecting || e.key !== ' ')
            return;
        const li = e.target && e.target.closest ? e.target.closest('li.vbm-row') : null;
        const url = li && li.dataset ? li.dataset.url : undefined;
        if (url === undefined)
            return;
        e.preventDefault();
        e.stopPropagation();
        if (selected.has(url))
            selected.delete(url);
        else
            selected.add(url);
        const idx = stagingState.items.findIndex(it => it.url === url);
        pendingRowFocus = idx >= 0 ? idx : null;
        renderStaging();
    }, true);

    // R — reveal the focused row in the tree (docs/plan-4.0.0/v4task-2-list.md §2.3).
    // Consumed by keyboard.js before the type-ahead gate; recent registers
    // typeAhead:false, so letters never reach the keyBuffer here.
    const onKey = e => {
        if (selecting)
            return false; // selection owns the keys (dead/dupes law)
        if (e.key !== 'r' && e.key !== 'R')
            return false;
        const item = document.activeElement;
        const li = item && item.parentNode;
        const id = li && (li.dataset.nodeId || li.id.replace(/^recent-item-/, ''));
        if (!id)
            return false;
        e.preventDefault();
        treeView.revealInTree(id);
        return true;
    };

    views.register({
        id: 'recent',
        titleKey: 'viewRecent',
        icon: VIEW_ICONS.recent,
        container: $('view-recent'),
        listEl: $list,
        hidden: !enabled(), // showRecentBookmarks → tab visibility (§5.3 迁移)
        showKey: 'showRecentBookmarks',
        disableKey: 'disableRecentView',
        typeAhead: false,
        badge: () => stagingOn() ? staging.count(stagingState) : 0,
        persistScroll: true, // first user in the codebase — see view-manager tests
        onEscape: () => {
            if (selecting) {
                const ae = document.activeElement;
                const inToolbar = ae && ae.closest ? ae.closest('.vbm-toolbar') : null;
                setSelecting(false, inToolbar ? 'entry' : null);
                return true;
            }
            return false;
        },
        activate: () => {
            probePermission(); // the grant may have landed while away
            // §0.3: lastSeenTs advances on every activation — the bucket's
            // "new N" counts arrivals since the previous visit. The clean
            // re-entry updates just that pill in place: a full repaint on
            // every tab switch re-armed the favicon refresh process for
            // every row (the "enter the view and wait seconds" lag).
            if (staging.count(stagingState)) {
                const stagingChanged = lastRenderedRaw !== staging.serialize(stagingState);
                staging.markSeen(stagingState);
                persistStaging();
                if (dirty || !painted || stagingChanged)
                    refresh();
                else {
                    syncBucketSeen();
                    lastRenderedRaw = staging.serialize(stagingState);
                }
                return;
            }
            if (dirty || !painted)
                refresh();
        },
        onKey
    });

    probePermission(); // startup probe (refresh/banner resolve in the callback)

    // The send API consumed by context-menu (bookmark/folder/hist-row entries),
    // view-stats (history rows) and view-tabgroups (tabs) — see neat.js wiring.
    const removeByUrl = url => {
        const it = staging.getByUrl(stagingState, url);
        if (!it)
            return;
        const snap = { ...it };
        const groupSnap = it.group ? { ...staging.findGroup(stagingState, it.group) } : null;
        staging.removeByUrls(stagingState, [url]);
        persistStaging();
        renderStaging();
        undo.toastAction(_m('stagingRemoved'), _m('undoAction'), () => {
            const r = staging.restoreItems(stagingState, [snap], groupSnap ? [groupSnap] : []);
            if (r.full) {
                toast(_m('stagingFull'));
                return;
            }
            persistStaging();
            renderStaging();
        });
    };

    const api = {
        addItems,
        // Named-group batch sends (the recent time buckets / the search
        // keyword toolbar button) and the member-url read the group context
        // menu's open entries dispatch through.
        addItemsToNamedGroup: stageIntoNamedGroup,
        groupUrls: gid => staging.groupItems(stagingState, gid).map(it => it.url),
        groupName: gid => (staging.findGroup(stagingState, gid) || {}).name || '',
        sendFolder,
        favToggle,
        favAllBucket,
        toggleGroupFold,
        toggleBucketFold,
        isGroupCollapsed: gid => !!(staging.findGroup(stagingState, gid) || {}).collapsed,
        renameGroup,
        dissolveGroup,
        // User-built groups: create (named, manual — survives empty-pruning),
        // delete (group + members leave staging, confirm + toast-undo in the
        // view layer), and the DnD reorder hook the drop handler rides.
        newGroup,
        createGroup: name => {
            const g = staging.createGroup(stagingState, (name || '').trim(), { manual: true });
            persistStaging();
            renderStaging();
            return g.id;
        },
        deleteGroup,
        reorderGroup,
        // §2.4: the row-menu "Copy/move to…" on an UNbookmarked staging row —
        // the §3.3 unfav semantics (create into the target; move leaves,
        // copy stays) through the same picker.
        moveCopyItem: url => {
            const it = staging.getByUrl(stagingState, url);
            if (it)
                openPickerForItems([it]);
        },
        selectAllGroup: gid => {
            const urls = staging.groupItems(stagingState, gid).map(it => it.url);
            if (!urls.length)
                return;
            selected.clear();
            for (const u of urls)
                selected.add(u);
            setSelecting(true, 'first');
        },
        saveGroupToFolder,
        copyGroupToFolder,
        openGroupAssign: urls => openGroupAssign(urls),
        setSelecting: on => setSelecting(on, on ? 'first' : 'entry'),
        selectedUrls: () => [...selected],
        isSelecting: () => selecting,
        isStaged: url => !!staging.getByUrl(stagingState, url),
        // The master switch — every other view's staging entries gate on it.
        isEnabled: () => stagingOn(),
        // Batch exit for FOLDER planes (the tree's staged-folder toggle-off):
        // snapshots first so the toast undo restores group membership.
        removeByUrls: urls => {
            const set = new Set(urls || []);
            if (!set.size)
                return;
            const snapshots = stagingState.items.filter(it => set.has(it.url)).map(it => ({ ...it }));
            const groupSnaps = [...new Set(snapshots.map(it => it.group).filter(Boolean))]
                .map(id => ({ ...staging.findGroup(stagingState, id) }));
            staging.removeByUrls(stagingState, [...set]);
            persistStaging();
            renderStaging();
            if (snapshots.length)
                undo.toastAction(_m('stagingRemovedCount', `${snapshots.length}`), _m('undoAction'), () => {
                    const r = staging.restoreItems(stagingState, snapshots, groupSnaps);
                    if (r.full) {
                        toast(_m('stagingFull'));
                        return;
                    }
                    persistStaging();
                    renderStaging();
                });
        },
        removeByUrl,
        state: () => stagingState
    };

    return { refresh, api, onTreeSnapshot };
}