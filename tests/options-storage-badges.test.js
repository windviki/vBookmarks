import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Options-page storage-area badges (src/options-storage-badges.js): each
// options group carries a cloud / crossed-cloud badge telling whether its
// settings persist in chrome.storage.sync (store.js SYNC_KEYS) or locally.
// This suite drives the REAL module plus the REAL store.js key lists:
//
//   1. consistency — every mapped key is a real store key, every mapped
//      row/heading id exists in pages/options.html, and the classification
//      of every group matches the storage-audit segment decisions;
//   2. pure classification — majority/tie/rowless rules;
//   3. DOM application — badges land on the section / outlier li with the
//      right kind, tooltip and icon;
//   4. page wiring — script tag, runtime-files entry, css rules, i18n keys.

import {
    OPTIONS_STORAGE_GROUPS,
    DATA_ROW_BADGES,
    classifyGroup,
    applyStorageBadges,
    STORAGE_SYNC,
    STORAGE_LOCAL
} from '../src/options-storage-badges.js';

const storeSource = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
const optionsHtml = fs.readFileSync(new URL('../pages/options.html', import.meta.url), 'utf8');
const optionsCss = fs.readFileSync(new URL('../css/options.css', import.meta.url), 'utf8');
const runtimeFiles = fs.readFileSync(new URL('../scripts/runtime-files.json', import.meta.url), 'utf8');

// Minimal store.js sandbox — only the static key lists matter here (the
// async ready chain may never resolve; storage-usage.test.js uses the same
// trick). store.js assigns onto the `window` object it receives.
const makeArea = () => ({
    get: async () => ({}),
    set: async () => {},
    remove: async () => {}
});
const storeWindow = { addEventListener: () => {} };
new Function('window', 'chrome', 'localStorage', 'document', storeSource)(
    storeWindow,
    { storage: { local: makeArea(), sync: makeArea() } },
    { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} },
    { getElementById: () => null }
);
const realSyncKeys = new Set(storeWindow.store.syncKeys);
const realKnownKeys = new Set(storeWindow.store.knownKeys);

const planOf = () => {
    const plan = {};
    for (const headingId in OPTIONS_STORAGE_GROUPS)
        plan[headingId] = classifyGroup(OPTIONS_STORAGE_GROUPS[headingId], realSyncKeys);
    return plan;
};

describe('storage badges: real store.js consistency', () => {
    it('maps only real store keys (typo tripwire)', () => {
        for (const entries of Object.values(OPTIONS_STORAGE_GROUPS)) {
            for (const entry of entries) {
                expect(realSyncKeys.has(entry.key) || realKnownKeys.has(entry.key),
                    `key ${entry.key} exists in store.js knownKeys/syncKeys`).toBe(true);
            }
        }
    });

    it('anchors every row/heading id to the real options.html', () => {
        for (const [headingId, entries] of Object.entries(OPTIONS_STORAGE_GROUPS)) {
            expect(optionsHtml, `heading id ${headingId}`).toContain(`id="${headingId}"`);
            for (const entry of entries) {
                if (entry.row)
                    expect(optionsHtml, `row id ${entry.row}`).toContain(`id="${entry.row}"`);
            }
        }
        // groups without settings stay badge-free (buttons-only / placeholder)
        expect(OPTIONS_STORAGE_GROUPS).not.toHaveProperty('backup-options');
        expect(OPTIONS_STORAGE_GROUPS).not.toHaveProperty('dupes-options');
        // dataset-row badge anchors are real options.html ids too
        for (const rowId of Object.keys(DATA_ROW_BADGES))
            expect(optionsHtml, `data row id ${rowId}`).toContain(`id="${rowId}"`);
    });

    it('classifies every group per the storage-audit segments', () => {
        const plan = planOf();
        const allSync = [];
        const allLocal = [];
        const mixed = [];
        for (const [headingId, placement] of Object.entries(plan)) {
            if (placement.outliers.length)
                mixed.push(headingId);
            else if (placement.dominant === STORAGE_SYNC)
                allSync.push(headingId);
            else
                allLocal.push(headingId);
        }
        // General mixes 10 sync preferences with the device-state keys
        // (autoResizePopup, openInSidePanel + the 2026-08-26 recent-search
        // display count) — the only mixed group.
        expect(mixed).toEqual(['general']);
        expect(plan.general.dominant).toBe(STORAGE_SYNC);
        expect(plan.general.outliers).toEqual([
            { row: 'search-history-count', key: 'searchHistoryCount', kind: STORAGE_LOCAL },
            { row: 'auto-resize-popup', key: 'autoResizePopup', kind: STORAGE_LOCAL },
            { row: 'open-in-side-panel', key: 'openInSidePanel', kind: STORAGE_LOCAL }
        ]);
        expect([...allLocal].sort()).toEqual([
            'accessibility', 'custom-icon', 'custom-styles', 'dead-scan-options',
            'labs-options', 'separator-options'
        ]);
        expect([...allSync].sort()).toEqual([
            'context-menu-options', 'icons-options', 'palette-cmd-options',
            'recent-options', 'search-options', 'sort-options', 'stats-options',
            'sync-options', 'tabgroups-options', 'tools-options', 'tree-options',
            'views-options'
        ]);
    });

    it('keeps rowless entries on their group\'s dominant side (never unmarked minority)', () => {
        // a rowless key differing from its group's dominant kind would be
        // invisible — the header would claim one area for a key in the
        // other. See the module's map comment.
        const plan = planOf();
        for (const [headingId, entries] of Object.entries(OPTIONS_STORAGE_GROUPS)) {
            for (const entry of entries) {
                if (entry.row) continue;
                const kind = realSyncKeys.has(entry.key) ? STORAGE_SYNC : STORAGE_LOCAL;
                expect(kind === plan[headingId].dominant,
                    `rowless key ${entry.key} (${headingId}) matches the group dominant`).toBe(true);
            }
        }
    });
});

describe('storage badges: classification rules', () => {
    it('picks the majority kind and flags differing rows as outliers', () => {
        const placement = classifyGroup([
            { row: 'a', key: 's1' },
            { row: 'b', key: 's2' },
            { row: 'c', key: 'l1' }
        ], new Set(['s1', 's2']));
        expect(placement.dominant).toBe(STORAGE_SYNC);
        expect(placement.outliers).toEqual([{ row: 'c', key: 'l1', kind: STORAGE_LOCAL }]);
    });

    it('settles a tie on sync', () => {
        const placement = classifyGroup([
            { row: 'a', key: 's1' },
            { row: 'b', key: 'l1' }
        ], new Set(['s1']));
        expect(placement.dominant).toBe(STORAGE_SYNC);
        expect(placement.outliers).toEqual([{ row: 'b', key: 'l1', kind: STORAGE_LOCAL }]);
    });

    it('counts rowless entries toward the tally without badging them', () => {
        const placement = classifyGroup([
            { key: 's1' },
            { key: 's2' },
            { key: 's3' },
            { row: 'a', key: 'l1' }
        ], new Set(['s1', 's2', 's3']));
        expect(placement.dominant).toBe(STORAGE_SYNC);
        expect(placement.outliers).toEqual([{ row: 'a', key: 'l1', kind: STORAGE_LOCAL }]);
        // local majority flips the dominant; the lone sync key is rowless,
        // so nothing carries an outlier badge (the documented caveat)
        const flipped = classifyGroup([
            { key: 's1' },
            { row: 'a', key: 'l1' },
            { row: 'b', key: 'l2' }
        ], new Set(['s1']));
        expect(flipped.dominant).toBe(STORAGE_LOCAL);
        expect(flipped.outliers).toEqual([]);
    });
});

describe('storage badges: DOM application', () => {
    const makeNode = (id = '', tagName = 'SPAN') => ({
        id,
        tagName,
        className: '',
        title: '',
        innerHTML: '',
        children: [],
        _closestBy: {},
        appendChild(child) { this.children.push(child); },
        closest(selector) { return this._closestBy[selector] || null; }
    });

    const makeDoc = () => {
        const registry = {};
        return {
            registry,
            getElementById: id => registry[id] || null,
            createElement: tagName => makeNode('', tagName)
        };
    };

    const wireGroup = (doc, headingId, rowIds) => {
        const section = makeNode('', 'SECTION');
        const heading = makeNode(headingId, 'H2');
        heading._closestBy.section = section;
        doc.registry[headingId] = heading;
        const lis = {};
        for (const rowId of rowIds) {
            const li = makeNode('', 'LI');
            const control = makeNode(rowId, 'INPUT');
            control._closestBy.li = li;
            doc.registry[rowId] = control;
            lis[rowId] = li;
        }
        return { section, lis };
    };

    it('badges the section with the dominant kind and only outlier rows', () => {
        const doc = makeDoc();
        const g1 = wireGroup(doc, 'g1', ['row1', 'row2']);
        const g2 = wireGroup(doc, 'g2', ['row3']);
        applyStorageBadges({
            groups: {
                g1: [
                    { row: 'row1', key: 'l1' },
                    { row: 'row2', key: 's1' },
                    { key: 's2' }
                ],
                g2: [{ row: 'row3', key: 'l2' }]
            },
            syncKeySet: new Set(['s1', 's2']),
            tipSync: 'TIP-SYNC',
            tipLocal: 'TIP-LOCAL',
            doc
        });

        // g1: sync-dominant header badge, local outlier row badge
        expect(g1.section.children).toHaveLength(1);
        const groupBadge = g1.section.children[0];
        expect(groupBadge.className).toContain('group-storage-badge');
        expect(groupBadge.className).toContain('storage-sync');
        expect(groupBadge.title).toBe('TIP-SYNC');
        expect(groupBadge.innerHTML).toContain('<svg');
        expect(groupBadge.innerHTML).not.toContain('M4 4l16 16');

        expect(g1.lis.row1.children).toHaveLength(1);
        const rowBadge = g1.lis.row1.children[0];
        expect(rowBadge.className).toContain('row-storage-badge');
        expect(rowBadge.className).toContain('storage-local');
        expect(rowBadge.title).toBe('TIP-LOCAL');
        expect(rowBadge.innerHTML).toContain('M4 4l16 16');

        // the sync row carries nothing — only differing rows get a badge
        expect(g1.lis.row2.children).toHaveLength(0);

        // g2: uniform local group → crossed header badge, no row badges
        expect(g2.section.children[0].className).toContain('storage-local');
        expect(g2.lis.row3.children).toHaveLength(0);
    });

    it('appends dataset-row badges inline after their anchor (dataRows)', () => {
        const doc = makeDoc();
        const li = makeNode('', 'LI');
        const link = makeNode('data-link', 'A');
        link._closestBy.li = li;
        doc.registry['data-link'] = link;
        applyStorageBadges({
            groups: {},
            dataRows: { 'data-link': STORAGE_LOCAL },
            syncKeySet: new Set(),
            tipSync: 'TIP-SYNC',
            tipLocal: 'TIP-LOCAL',
            doc
        });
        expect(li.children).toHaveLength(1);
        const badge = li.children[0];
        expect(badge.className).toContain('storage-badge-inline');
        expect(badge.className).toContain('storage-local');
        expect(badge.title).toBe('TIP-LOCAL');
        expect(badge.innerHTML).toContain('M4 4l16 16');
    });

    it('skips unknown headings and rows quietly', () => {
        const doc = makeDoc();
        const g1 = wireGroup(doc, 'g1', ['row1']);
        expect(() => applyStorageBadges({
            groups: {
                g1: [{ row: 'missing-row', key: 'l1' }, { row: 'row1', key: 's1' }],
                'no-such-heading': [{ row: 'row1', key: 's1' }]
            },
            syncKeySet: new Set(['s1']),
            tipSync: 'TIP-SYNC',
            tipLocal: 'TIP-LOCAL',
            doc
        })).not.toThrow();
        // the known group still got its header badge; the known row (sync,
        // matching dominant) got nothing
        expect(g1.section.children).toHaveLength(1);
        expect(g1.lis.row1.children).toHaveLength(0);
    });
});

describe('storage badges: page wiring', () => {
    it('loads the module from options.html and ships it in the dist runtime set', () => {
        expect(optionsHtml).toContain('<script type="module" src="/src/options-storage-badges.js"></script>');
        expect(runtimeFiles).toContain('"src/options-storage-badges.js"');
    });

    it('styles the group, row and inline badges in options.css', () => {
        expect(optionsCss).toContain('.storage-badge{');
        expect(optionsCss).toContain('.group-storage-badge{');
        expect(optionsCss).toContain('.row-storage-badge{');
        expect(optionsCss).toContain('.storage-badge-inline{');
    });

    it('reorganizes the favicon cache row: label + button, gallery link badgeable', () => {
        // "Icon cache" row label (storageUsageIcon) before the clear button;
        // the gallery link (favGalleryLink) carries the inline device-local
        // badge via DATA_ROW_BADGES; the row wraps instead of overflowing
        // two-tier block (2026-08): the label heads, the actions flow below
        expect(optionsHtml).toContain('<div class="favicon-cache-head" id="favicon-cache-label"></div>');
        expect(optionsHtml).toContain('<button id="favicon-cache-clear"');
        expect(Object.keys(DATA_ROW_BADGES)).toEqual(['favicon-gallery-link']);
        expect(DATA_ROW_BADGES['favicon-gallery-link']).toBe(STORAGE_LOCAL);
    });

    it('carries real tooltip strings in en and zh_CN', () => {
        for (const loc of ['en', 'zh_CN']) {
            const messages = JSON.parse(fs.readFileSync(
                new URL(`../_locales/${loc}/messages.json`, import.meta.url), 'utf8'));
            for (const key of ['optionsStorageSyncTip', 'optionsStorageLocalTip']) {
                expect(messages[key], `${loc} ${key} exists`).toBeTruthy();
                expect(messages[key].message.startsWith('[TODO:'), `${loc} ${key} is translated`).toBe(false);
            }
        }
    });
});
