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
import { VIEW_ICONS, STAGE_ICON, STAGE_ICON_DONE, STAR_ICON, STAR_ICON_FILLED, LIST_X_ICON } from './icons.js';
import { htmlspecialchars } from './escape.js';
import { parkRowFocus, unparkRowFocus } from './list-focus.js';
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
    const recentCount = () => {
        const n = parseInt(store.get('recentCount', '20'), 10);
        return n > 0 ? n : 20;
    };
    const toast = msg => undo.showToast(msg);

    // --- Staging state (src/staging.js owns the model) --------------------
    let stagingState = staging.parse(store.get('staging'));

    const persistStaging = () => {
        store.set('staging', staging.serialize(stagingState));
        views.updateBadges(); // store.set does not auto-update tab badges
    };

    const renderStaging = () => {
        if (views.isActive('recent'))
            refresh();
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
            historyPerm = !!granted;
            if (historyPerm && !store.get('statsHistoryImportedAt')) {
                importHistory(); // grant landed while the popup was closed
            } else if (views.isActive('recent')) {
                refresh(); // repaint with the banner resolved
            }
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
    const stagingRowHtml = (it, idx, inGroup) => {
        const path = it.id ? (views.pathOf(it.id) || '') : '';
        const rel = relTimeLabel(it.ts, _m);
        const subText = it.id
            ? ((views.showItemPath() && path) ? `${path} · ${rel}` : rel)
            : `${_m('stagingFromHistory')} · ${rel}`;
        const starLabel = _m(it.id ? 'stagingRowUnfav' : 'stagingRowFav');
        const removeLabel = _m('stagingRemove');
        return `<li class="vbm-row staging-row${inGroup ? ' staging-member' : ''}" id="staging-item-${idx}" role="listitem" ` +
            `data-url="${htmlspecialchars(it.url)}"` +
            (it.id ? ` data-node-id="${it.id}" data-parentid=""` : '') + '>' +
            treeRender.generateBookmarkHTML(it.title, it.url, 'data-virtual="1"', it.id || null, null, {
                path,
                badge: { text: rel, cls: 'time' },
                rightText: (views.showItemPath() && path) ? path : '',
                subText
            }) +
            // Real-state star slot (§2.4): always visible, filled = the URL
            // IS a tree node; click performs the real create/remove.
            `<button type="button" class="row-btn staging-star" aria-pressed="${it.id ? 'true' : 'false'}" ` +
            `aria-label="${htmlspecialchars(starLabel)}" title="${htmlspecialchars(starLabel)}">` +
            (it.id ? STAR_ICON_FILLED : STAR_ICON) + '</button>' +
            // Inline remove (§3.8): hover-revealed × — leaves the tree alone.
            `<button type="button" class="row-btn staging-remove" ` +
            `aria-label="${htmlspecialchars(removeLabel)}" title="${htmlspecialchars(removeLabel)}">${LIST_X_ICON}</button>` +
            '</li>';
    };

    // The bucket head (§3.4 iteration C): the "not yet homed" inbox — a
    // hollow star, the live count, the "new since last visit" counter and
    // the one-hit "favorite all" shortcut.
    const bucketHeadHtml = (count, news, collapsed) => {
        const favAllLabel = _m('stagingBucketFavAll');
        const countText = news > 0 ? `${count} · ${_m('stagingNew', `${news}`)}` : `${count}`;
        return `<li class="staging-bucket" role="presentation"><span class="staging-bucket-head" ` +
            `tabindex="-1" role="button" aria-expanded="${collapsed ? 'false' : 'true'}">` +
            `<i class="staging-bucket-star" aria-hidden="true">${STAR_ICON}</i>` +
            `<span class="staging-section-title">${_m('stagingBucketTitle')}</span>` +
            `<span class="count-pill" aria-label="${count}">${countText}</span>` +
            `<button type="button" class="row-btn staging-bucket-fav-all" tabindex="-1" ` +
            `aria-label="${htmlspecialchars(favAllLabel)}" title="${htmlspecialchars(favAllLabel)}">${STAR_ICON_FILLED}</button>` +
            `<span class="chevron${collapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            `</span></li>`;
    };

    // A named group head (§3.5): fold control + name + member count. The
    // hover homing button and the group context menu land with ST5.
    const groupHeadHtml = (g, count) => {
        const collapsed = g.collapsed;
        return `<li class="staging-group" data-group-id="${g.id}" role="presentation">` +
            `<span class="group-head staging-group-head" tabindex="-1" role="button" aria-expanded="${collapsed ? 'false' : 'true'}">` +
            `<span class="chevron${collapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            `<span class="staging-section-title" dir="auto">${htmlspecialchars(g.name || _m('noTitle'))}</span>` +
            `<span class="count-pill" aria-label="${count}">${count}</span>` +
            `</span></li>`;
    };

    const renderStagingArea = () => {
        const state = stagingState;
        const idxOf = new Map(state.items.map((it, i) => [it.url, i]));
        let html = '<ul role="list" id="staging-items">';
        if (!state.items.length) {
            html += `<li class="empty-state" role="listitem"><i>${_m('stagingEmpty')}</i></li>`;
        } else {
            // ① the unbookmarked inbox bucket
            const bucket = staging.unfavBucketItems(state);
            if (bucket.length) {
                html += bucketHeadHtml(bucket.length, staging.newCount(state), state.unfavCollapsed);
                if (!state.unfavCollapsed) {
                    for (const it of bucket)
                        html += stagingRowHtml(it, idxOf.get(it.url), false);
                }
            }
            // ② groups in createdAt order (the model sorts on create)
            for (const g of state.groups) {
                const members = staging.groupItems(state, g.id);
                if (!members.length)
                    continue;
                html += groupHeadHtml(g, members.length);
                if (!g.collapsed) {
                    for (const it of members)
                        html += stagingRowHtml(it, idxOf.get(it.url), true);
                }
            }
            // ③ bookmarked loose rows
            for (const it of staging.looseItems(state))
                html += stagingRowHtml(it, idxOf.get(it.url), false);
        }
        html += '</ul>';
        return html;
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

    const renderRecentRows = items => {
        let html = '<ul role="list" id="recent-list">';
        let count = 0;
        let lastGroup = -1;
        const now = Date.now();
        const showPath = views.showItemPath();
        for (let i = 0, l = items.length; i < l; i++) {
            const d = items[i];
            if (!d.url || separatorManager.isSeparator(d.title, d.url))
                continue;
            count++;
            const path = views.pathOf(d.id);
            // §3.3: narrow right slot = relative time; wide second line =
            // `路径 · 绝对时间` (the path half follows showItemPath).
            const absTime = new Date(d.dateAdded || 0).toLocaleString();
            const subText = (showPath && path) ? `${path} · ${absTime}` : absTime;
            // Non-interactive section header (iOS-style): a plain div tucked
            // into the group's first row as its LAST DOM child — CSS order
            // pulls it above the row visually while li.firstElementChild
            // stays the anchor, so keyboard.js Enter still opens the
            // bookmark. Empty groups never appear.
            const g = groupIndex(d.dateAdded || 0, now);
            const groupHead = (g !== lastGroup)
                ? `<div class="recent-group-head" role="presentation">${_m(GROUP_KEYS[g])}</div>`
                : '';
            lastGroup = g;
            html += `<li class="vbm-row${groupHead ? ' has-head' : ''}" id="recent-item-${d.id}" role="listitem" ` +
                `data-node-id="${d.id}" data-parentid="${d.parentId}">` +
                treeRender.generateBookmarkHTML(d.title, d.url, 'data-virtual="1"', d.id, null, {
                    path,
                    badge: { text: relTimeLabel(d.dateAdded, _m), cls: 'time' },
                    rightText: (showPath && path) ? path : '',
                    subText
                }) +
                stageBtnHtml(d.url) +
                groupHead +
                '</li>';
        }
        if (!count)
            html += `<li class="empty-state" role="listitem"><i>${_m('recentEmpty')}</i></li>`;
        html += '</ul>';
        return { html, count };
    };

    const renderRecentHead = count => {
        const collapsed = stagingState.recentCollapsed;
        const stageAllLabel = _m('recentStageAll');
        return `<div id="recent-head" class="staging-section-head${collapsed ? ' collapsed' : ''}" ` +
            `role="button" tabindex="-1" aria-expanded="${collapsed ? 'false' : 'true'}">` +
            `<span class="chevron${collapsed ? ' collapsed' : ''}" aria-hidden="true"></span>` +
            `<span class="staging-section-title">${_m('recentSectionTitle')}</span>` +
            (count ? `<span class="count-pill" aria-label="${count}">${count}</span>` : '') +
            `<button type="button" class="row-btn recent-stage-all" tabindex="-1" ` +
            `aria-label="${htmlspecialchars(stageAllLabel)}" title="${htmlspecialchars(stageAllLabel)}">${STAGE_ICON}</button>` +
            `</div>`;
    };

    // Cached count for the fold: while collapsed the recent fetch is skipped
    // (§2.1) and the head keeps the last known number.
    let recentTotal = null;

    let dirty = false;
    const render = (items, recentN) => {
        let html = bannerHtml();
        html += renderStagingArea();
        html += renderRecentHead(recentN);
        if (!stagingState.recentCollapsed) {
            const rendered = renderRecentRows(items || []);
            recentTotal = rendered.count;
            html += rendered.html;
        }
        // 4.0.1 focus law: a focused row rides the swap (park above, restore
        // here) so the ↓ walk survives every refresh repaint.
        const parkedRow = parkRowFocus($list);
        $list.innerHTML = html;
        unparkRowFocus($list, parkedRow);
        onRowsRendered();
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
        if (stagingState.recentCollapsed && recentTotal !== null) {
            render(null, recentTotal);
            return;
        }
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
        const step = () => {
            if (done >= bucket.length) {
                persistStaging();
                renderStaging();
                refreshTree();
                if (bucket.length - failed > 0)
                    toast(_m('stagingFavDone', [`${bucket.length - failed}`]));
                return;
            }
            const it = bucket[done++];
            favOne(it, how => {
                if (how === 'failed')
                    failed++;
                step();
            });
        };
        step();
    };

    // --- Group operations (§3.5 — purely local, zero tree ops) --------------
    const toggleGroupFold = groupId => {
        const g = staging.findGroup(stagingState, groupId);
        if (!g)
            return;
        staging.setGroupCollapsed(stagingState, groupId, !g.collapsed);
        persistStaging();
        renderStaging();
    };

    const toggleBucketFold = () => {
        staging.setUnfavCollapsed(stagingState, !stagingState.unfavCollapsed);
        persistStaging();
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
        if (!staging.dissolveGroup(stagingState, groupId))
            return;
        persistStaging();
        renderStaging();
        toast(_m('stagingGroupDissolved'));
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
                button1: `<strong>${_m('ok')}</strong>`,
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
        if (r.changed) {
            persistStaging();
            renderStaging();
        }
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
        // auto-promotes (workbench and tree stay consistent).
        if (node && node.url) {
            const it = staging.getByUrl(stagingState, node.url);
            if (it && !it.id) {
                staging.setFav(stagingState, node.url, id);
                persistStaging();
                renderStaging();
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
        if (staging.updateSnapshot(stagingState, id, changes)) {
            persistStaging();
            renderStaging();
        }
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
    // object re-parse (never trust the local mirror, never merge).
    if (chrome.storage && chrome.storage.onChanged)
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !('staging' in changes))
                return;
            if (store.adopt)
                store.adopt('staging', changes.staging.newValue);
            stagingState = staging.parse(changes.staging.newValue);
            renderStaging();
        });

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
        if (closest('.staging-add-btn')) {
            e.preventDefault();
            e.stopPropagation();
            const li = closest('li');
            const id = li && li.dataset && li.dataset.nodeId;
            const url = li && ((li.dataset && li.dataset.url) ||
                (li.querySelector && li.querySelector('a') ? li.querySelector('a').getAttribute('href') : ''));
            const title = '';
            if (url)
                toggleUrl(url, id, title);
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
        if (closest('.recent-stage-all')) {
            e.preventDefault();
            e.stopPropagation();
            chrome.bookmarks.getRecent(recentCount(), items => stageAllRecent(items));
            return;
        }
        if (closest('#recent-head')) {
            e.preventDefault();
            staging.setRecentCollapsed(stagingState, !stagingState.recentCollapsed);
            persistStaging();
            refresh();
            return;
        }
        treeView.bookmarkHandler(e);
    });
    $list.addEventListener('auxclick', treeView.bookmarkHandler);

    // R — reveal the focused row in the tree (docs/plan-4.0.0/v4task-2-list.md §2.3).
    // Consumed by keyboard.js before the type-ahead gate; recent registers
    // typeAhead:false, so letters never reach the keyBuffer here.
    const onKey = e => {
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
        badge: () => staging.count(stagingState),
        persistScroll: true, // first user in the codebase — see view-manager tests
        activate: () => {
            probePermission(); // the grant may have landed while away
            // §0.3: lastSeenTs advances on every activation — the bucket's
            // "new N" counts arrivals since the previous visit, so the
            // repaint must follow the new baseline.
            if (staging.count(stagingState)) {
                staging.markSeen(stagingState);
                persistStaging();
                refresh();
                return;
            }
            if (dirty || !$list.innerHTML)
                refresh();
        },
        onKey
    });

    probePermission(); // startup probe (refresh/banner resolve in the callback)

    // The send API consumed by context-menu (bookmark/folder/hist-row entries),
    // view-stats (history rows) and view-tabgroups (tabs) — see neat.js wiring.
    const removeByUrl = url => {
        if (!staging.getByUrl(stagingState, url))
            return;
        staging.removeByUrls(stagingState, [url]);
        persistStaging();
        renderStaging();
        toast(_m('stagingRemoved'));
    };

    const api = {
        addItems,
        sendFolder,
        favToggle,
        favAllBucket,
        toggleGroupFold,
        toggleBucketFold,
        isGroupCollapsed: gid => !!(staging.findGroup(stagingState, gid) || {}).collapsed,
        renameGroup,
        dissolveGroup,
        openGroupAssign: urls => openGroupAssign(urls),
        isStaged: url => !!staging.getByUrl(stagingState, url),
        removeByUrl,
        state: () => stagingState
    };

    return { refresh, api, onTreeSnapshot };
}
