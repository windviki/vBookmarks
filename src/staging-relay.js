/**
 * The staging relay's shared row-button recipe (docs/plan-velvet/
 * velvet-feat-staging.md §13): one button builder, one click-toggle, one
 * in-place flip. Consumers: the dead/dupes/search rows (+ the dupes group
 * heads) — the stats view owns the original §2.3 recipe it was extracted
 * from, the recent/tabgroups views have their own head/row semantics.
 *
 * The hosting views do NOT re-render when the staging state changes (only
 * the staging view itself listens to the storage echo), so a click must
 * flip its OWN button in place — the icon, the .staged accent and the
 * labels all swap here, no repaint, no favicon churn.
 *
 * Pure DOM/i18n only; the staging api (view-recent's) is passed in by the
 * caller exactly as ctx.staging / ctx.stagingApi.
 */
import { STAGE_ICON, STAGE_ICON_DONE } from './icons.js';
import { htmlspecialchars } from './escape.js';

export const isStagedUrl = (api, url) =>
    !!(api && api.isStaged && url && api.isStaged(url));

// The hover 发送到暂存 toggle (the stats-view recipe verbatim:
// .staging-add-btn + .staged accent + staged → the filled plane).
// `icons` lets heavy-list callers (the tree row tail) pass the sprite-sheet
// <use> variants — every inline SVG copy dropped ~280 bytes per row of
// cold-open innerHTML (2026-08-27 perf round); the default stays inline.
export const stageBtnHtml = (api, item, _m, icons) => {
    const off = (icons && icons.off) || STAGE_ICON;
    const done = (icons && icons.done) || STAGE_ICON_DONE;
    const staged = isStagedUrl(api, item.url);
    const label = _m(staged ? 'stagingRemove' : 'stagingAdd');
    return `<button type="button" class="row-btn staging-add-btn${staged ? ' staged' : ''}" ` +
        `aria-pressed="${staged}" aria-label="${htmlspecialchars(label)}" ` +
        `title="${htmlspecialchars(label)}">${staged ? done : off}</button>`;
};

// Reflect a toggle on the live button without a re-render.
export const flipStageBtn = (btn, staged, _m) => {
    if (!btn || !btn.classList || !btn.setAttribute)
        return; // hand-written test doubles carry innerHTML only
    const label = _m(staged ? 'stagingRemove' : 'stagingAdd');
    btn.classList.toggle('staged', !!staged);
    btn.setAttribute('aria-pressed', staged ? 'true' : 'false');
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = staged ? STAGE_ICON_DONE : STAGE_ICON;
};

// One click = one toggle for a SINGLE item; returns the new staged state,
// or null when the api/item is unavailable (the caller leaves the button).
export const toggleStageItem = (api, item) => {
    if (!api || !item || !item.url)
        return null;
    if (api.isStaged(item.url)) {
        api.removeByUrl(item.url);
        return false;
    }
    api.addItems([{ id: item.id || null, url: item.url, title: item.title || '' }]);
    return true;
};
