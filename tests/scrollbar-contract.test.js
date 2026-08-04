import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// 横向滚动条 / 双滚动条防护契约（scrollbar-contract）。
//
// 背景：popup 偶尔出现横向滚动条（最近一次 commit 98e29b3：`#tree ul li span`
// 后代选择器误伤 .sync-indicator/.sync-tooltip，覆盖 .sync-indicator.synced
// { display:none }，本应隐藏的 tooltip 气泡 opacity:0 + nowrap + overflow:visible
// 文字撑出 #tree.scrollWidth > clientWidth）。该 bug 类（不可见元素撑出横向
// 溢出）不限于 #tree——所有允许纵向滚动的容器若 overflow-x 未裁剪，都可能被
// 同类隐形内容（tooltip、超长 URL 的 min-content）撑出横向滚动条。
//
// 本套件把"防横向滚动条"的不变量钉成 CSS 文本契约（jsdom 无布局，无法做真实
// 测量——真实布局矩阵由 scripts/screenshots/verify-scrollbars.js 覆盖）：
//   1. 每个滚动容器都在 overflow-x:hidden 规则里（裁剪横向，纵向滚动保留）
//   2. 行文本槽一律省略号截断（min-width:0 + ellipsis + nowrap，撑不出 min-content）
//   3. 固定槽 flex:none（绝不参与弹性收缩/膨胀）
//   4. body overflow:hidden（body 自身永不滚动）
//   5. 扩展 zoom 规则只缩放、不改几何（width/height/overflow 不出现）
//   6. sync-tooltip 回归守卫（98e29b3：特征 + 容器裁剪兜底配对）
//
// CSS 源是扁平规则（无嵌套），`ruleBody` 沿用 layering/list-view-parity 模式；
// `topLevelRules` 是 brace-depth 感知的顶层规则扫描（对 @media/@container 安全）。

const neatCss = fs.readFileSync(new URL('../css/neat.css', import.meta.url), 'utf8');
const syncCss = fs.readFileSync(new URL('../css/sync-styles.css', import.meta.url), 'utf8');

// Extract the `{ … }` body following a selector (rules are flat — no nesting).
const ruleBody = (css, selector) => {
    const i = css.indexOf(selector);
    expect(i, `rule for ${selector} exists`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    return css.slice(open + 1, close);
};

// Assert a rule body contains every required declaration string.
const assertProps = (css, selector, props) => {
    const body = ruleBody(css, selector);
    for (const p of props)
        expect(body, `${selector} contains ${p}`).toContain(p);
};

// Brace-depth aware, comment-skipping top-level rule scan. At-rules
// (@media/@container) surface as opaque entries (selector = the at-rule head,
// body = its whole block) — pane rules are all top-level, so this is enough.
const topLevelRules = (css) => {
    const rules = [];
    let i = 0;
    const n = css.length;
    while (i < n) {
        if (css.startsWith('/*', i)) {
            const end = css.indexOf('*/', i + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        const open = css.indexOf('{', i);
        if (open === -1) break;
        const selector = css.slice(i, open).trim();
        let depth = 1;
        let j = open + 1;
        while (j < n && depth > 0) {
            if (css[j] === '{') depth++;
            else if (css[j] === '}') depth--;
            else if (css.startsWith('/*', j)) {
                const end = css.indexOf('*/', j + 2);
                j = end === -1 ? n : end + 2;
                continue;
            }
            j++;
        }
        rules.push({ selector, body: css.slice(open + 1, j - 1) });
        i = j;
    }
    return rules;
};

// Every scrollable pane — the containers that may grow a vertical scrollbar and
// must never grow a horizontal one.
const SCROLL_PANES = [
    '#tree', '#results',
    '#recent-list', '#dupes-list', '#dead-list', '#stats-list',
    '#search-history-area', '#palette-results'
];

// Selectors of every top-level rule that clips horizontal overflow.
const xHiddenSelectors = topLevelRules(neatCss)
    .filter(r => /overflow-x\s*:\s*hidden/.test(r.body))
    .map(r => r.selector)
    .join('\n');

describe('scrollbar-contract: 滚动容器横向裁剪 (A)', () => {
    it('every scrollable pane is covered by an overflow-x:hidden rule', () => {
        for (const id of SCROLL_PANES)
            expect(xHiddenSelectors, `${id} in an overflow-x:hidden rule`).toMatch(new RegExp(`(?:^|,|\\n|\\s)${id}\\b`));
    });

    it('a consolidated overflow-x:hidden guard rule exists (end of file wins the cascade)', () => {
        const body = ruleBody(neatCss, '#tree,\n#results,\n#recent-list,\n#dupes-list,\n#dead-list,\n#stats-list,\n#search-history-area,\n#palette-results {');
        expect(body).toContain('overflow-x: hidden');
    });

    it('no rule anywhere declares overflow-x auto/visible (horizontal scroll is never legal)', () => {
        expect(neatCss).not.toMatch(/overflow-x\s*:\s*(auto|visible)\b/);
    });
});

describe('scrollbar-contract: 纵向滚动保留 (B)', () => {
    it('the tree/search panes keep overflow:auto (vertical)', () => {
        expect(ruleBody(neatCss, '#results,\n#tree {')).toContain('overflow: auto');
    });

    it('the four list panes keep overflow:auto (vertical)', () => {
        expect(ruleBody(neatCss, '#recent-list,\n#dupes-list,\n#dead-list,\n#stats-list {')).toContain('overflow: auto');
    });

    it('search-history and palette keep overflow-y:auto (vertical)', () => {
        expect(ruleBody(neatCss, '#search-history-area {')).toContain('overflow-y: auto');
        expect(ruleBody(neatCss, '#palette-results {')).toContain('overflow-y: auto');
    });
});

describe('scrollbar-contract: 文本槽省略号契约 (C)', () => {
    it('tree/results title <i> shrinks and truncates', () => {
        assertProps(neatCss, '#results ul li i,\n#tree ul li i {',
            ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']);
    });

    it('unscoped .tree-item-link title truncates', () => {
        assertProps(neatCss, '.tree-item-link i {',
            ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']);
    });

    it('list-view row slots truncate (main/sub/path)', () => {
        assertProps(neatCss, '.vbm-row .row-main {', ['min-width: 0', 'overflow: hidden']);
        assertProps(neatCss, '.vbm-row .row-sub {', ['overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']);
        assertProps(neatCss, '.vbm-row .row-path {', ['max-width: 45%', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']);
    });

    it('dupes key and search-history slots truncate', () => {
        assertProps(neatCss, '.dupes-group .dupes-key {', ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']);
        assertProps(neatCss, '.search-history-head i {', ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']);
        assertProps(neatCss, '.search-history-row a i {', ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']);
    });

    it('view tabs and context-menu items truncate', () => {
        assertProps(neatCss, '.view-tab {', ['overflow: hidden', 'white-space: nowrap']);
        assertProps(neatCss, '.view-tab .tab-label {', ['min-width: 0', 'overflow: hidden', 'text-overflow: ellipsis', 'white-space: nowrap']);
        // 前导换行锚定独立规则——`body[data-zoom=…] menu[type=context] .menu-item`
        // 复合选择器也含该子串，必须跳过
        assertProps(neatCss, '\nmenu[type=context] .menu-item {', ['overflow: hidden', 'white-space: nowrap', 'text-overflow: ellipsis']);
    });

    it('palette rows truncate (title/url clip; flex slots fixed)', () => {
        assertProps(neatCss, '.palette-row .palette-title {', ['overflow: hidden', 'text-overflow: ellipsis']);
        assertProps(neatCss, '.palette-row .palette-url {', ['flex: 1', 'overflow: hidden', 'text-overflow: ellipsis']);
    });
});

describe('scrollbar-contract: 固定槽 flex:none (D)', () => {
    it('favicon slots never shrink/grow', () => {
        assertProps(neatCss, '#tree ul li a .favicon-container,\n#tree ul li span .favicon-container,\n#results ul li a .favicon-container {', ['flex: none']);
        assertProps(neatCss, '.tree-item-link .favicon-container {', ['flex: none']);
    });

    it('twisty slot is fixed', () => {
        assertProps(neatCss, '#tree ul li span .twisty {', ['flex: none']);
    });

    it('the 16px ::before placeholder slot is fixed in tree/results and every list view', () => {
        assertProps(neatCss, '#tree ul li a::before,\n#results ul li a::before {', ['flex: none', 'width: 16px']);
        assertProps(neatCss, '#recent-list ul li a::before,\n#dupes-list ul li a::before,\n#dead-list ul li a::before,\n#stats-list ul li a::before {', ['flex: none', 'width: 16px']);
    });

    it('header chrome and row controls are fixed-width', () => {
        assertProps(neatCss, '#quick-add-btn {', ['flex: none', 'width: 30px']);
        assertProps(neatCss, '#tool-btn {', ['flex: none', 'width: 30px']);
        assertProps(neatCss, '.view-tab .tab-icon {', ['flex: none']);
        assertProps(neatCss, '.row-btn {', ['flex: none', 'width: 20px']);
        assertProps(neatCss, '.dupes-group .count-pill,\n.vbm-row .row-badge {', ['flex: none']);
        // 前导换行锚定独立规则——`#dupes-list ul.selecting .keeper-radio` 含同子串
        assertProps(neatCss, '\n.keeper-radio {', ['flex: none']);
    });

    it('palette fixed slots never flex', () => {
        for (const sel of ['.palette-row .palette-kind {', '.palette-row .palette-icon {', '.palette-row .palette-slash {', '.palette-row .palette-badge {'])
            assertProps(neatCss, sel, ['flex: none']);
    });
});

describe('scrollbar-contract: body chrome (E)', () => {
    it('body is the fixed popup frame and never scrolls', () => {
        const body = ruleBody(neatCss, 'body {');
        expect(body).toContain('overflow: hidden');
        expect(body).toContain('width: 320px');
        expect(body).toContain('height: 600px');
    });
});

describe('scrollbar-contract: 扩展 zoom 只缩放不改几何 (F)', () => {
    it.each([
        [90, '.9'], [110, '1.1'], [120, '1.2'], [130, '1.3'], [140, '1.4'], [150, '1.5']
    ])('data-zoom=%s scales children with zoom:%s only', (z, val) => {
        const body = ruleBody(neatCss,
            `body[data-zoom='${z}']>*:not(menu),\nbody[data-zoom='${z}'] menu[type=context] .menu-item {`);
        expect(body).toContain(`zoom: ${val}`);
        // 只缩放，绝不直接改宽高/溢出 —— zoom 引起的横向溢出必须靠容器
        // overflow-x:hidden 兜底，而不是靠规则本身"修正几何"。
        expect(body).not.toMatch(/width:|height:|min-width:|max-width:|min-height:|max-height:|overflow:/);
    });

    it('the data-zoom set is exactly the six non-default levels (100 is default)', () => {
        // 每档在 selector 里出现两次（>*:not(menu) 行与 menu .menu-item 行），去重
        const zoomSet = [...new Set([...neatCss.matchAll(/body\[data-zoom='(\d+)'\]/g)].map(m => m[1]))].sort();
        expect(zoomSet).toEqual(['110', '120', '130', '140', '150', '90']);
        expect(neatCss).not.toContain("body[data-zoom='100']");
    });
});

describe('scrollbar-contract: sync-tooltip 回归守卫 98e29b3 (G)', () => {
    it('the tooltip is the invisible nowrap overflow:visible bubble that used to stretch #tree', () => {
        assertProps(syncCss, '.sync-tooltip {',
            ['position: absolute', 'width: 0', 'height: 0', 'overflow: visible', 'white-space: nowrap',
             'opacity: 0', 'pointer-events: none', 'z-index: 1']);
    });

    it('synced indicators hide (display:none) and dots are absolutely positioned', () => {
        assertProps(syncCss, '.sync-indicator.synced {', ['display: none']);
        const ind = ruleBody(syncCss, '.sync-indicator {');
        expect(ind).toContain('position: absolute');
        expect(ind).toContain('z-index: 10');
    });

    it('the row flex selector is a child selector, so it can never reach nested overlay spans', () => {
        // 98e29b3 曾用 `#tree ul li span:not(.sync-indicator):not(.sync-tooltip)`
        // （后代选择器），特异性升到 (1,2,3) 反超 dead-indicator 防线，导致树
        // 视图 × 变黑/偏移。改用子选择器 `#tree ul li > span` 后结构性排除所有
        // 嵌套覆盖物（sync/死链 ×），特异性回到 (1,0,3)。
        expect(neatCss).toContain('#tree ul li > span {');
        // 后代版不得残留（它会把 display/line-height/padding 泄漏进覆盖物）
        expect(neatCss).not.toContain('#tree ul li span:not(');
    });

    it('the dead-indicator pins its own box and its guard beats the row rule', () => {
        // dead × 的防线规则（specificity 1,1,3）必须钉死白 × 与居中盒属性，
        // 且不被行 flex 规则（现在是 > span，1,0,3）覆盖——98e29b3 的回退曾让
        // 行规则的 color:var(--vbm-fg)（黑）、line-height:1.67em、padding 泄漏
        // 进来，× 变黑、偏移、圆形被拉成椭圆（搜索视图因无 `#results ul li
        // span` 后代规则而不受影响）。
        const guard = ruleBody(neatCss, '#tree ul li span.dead-indicator {');
        expect(guard).toContain('display: inline-flex');
        expect(guard).toContain('color: var(--vbm-danger-fg)');
        expect(guard).toContain('line-height: 1');
        expect(guard).toContain('padding: 0');
        expect(guard).toContain('width: 10px');
        expect(guard).toContain('height: 10px');
    });

    it('the stats "by recent" time badge undoes the shared pill geometry (issue #47)', () => {
        // The shared .vbm-row .row-badge base sizes every badge as a pill
        // (fixed 14px height / 7px radius / centered 9px type). The time
        // badge must reset that so a relative-time string renders as plain
        // muted text — otherwise it is a transparent pill with clipped tiny
        // centered text ("by recent" looked broken, issue #47).
        const time = ruleBody(neatCss, '.vbm-row .row-badge.time {');
        for (const prop of ['height: auto', 'border-radius: 0', 'min-width: 0',
            'font-size: 12px', 'color: var(--vbm-muted)'])
            expect(time, `.row-badge.time contains ${prop}`).toContain(prop);
        // Pill-only geometry must NOT leak back in (regression guard).
        expect(time).not.toContain('height: 14px');
        expect(time).not.toContain('border-radius: 7px');
    });

    it('the sync dot is pinned absolute from neat.css too (never enters the flex flow)', () => {
        const guard = ruleBody(neatCss, '#tree ul li .favicon-container .sync-indicator,\n#results ul li .favicon-container .sync-indicator {');
        expect(guard).toContain('position: absolute');
    });

    it('pairing: the tree pane that hosts the tooltip clips horizontally (belt and suspenders)', () => {
        expect(xHiddenSelectors).toMatch(/#tree\b/);
    });
});
