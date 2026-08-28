#!/usr/bin/env node
// Regenerate the ICON_SPRITE_SHEET block in src/icons.js from the inline
// icon exports (single source of truth — the sheet's symbols stay
// byte-identical to the inline <svg> bodies). Not part of any build; run on
// demand when an icon joins the sprite set:
//   node scripts/icons/gen-sprite.mjs
// Prints the ready-to-paste replacement for the ICON_SPRITE_SHEET export.
import * as icons from '../../src/icons.js';

// name → export const; keep in sync with the sheet's consumers (the row /
// group-head templates of the list views + the tree row tail).
const SET = {
    edit: 'EDIT_ICON',
    trash: 'TRASH_ICON',
    stage: 'STAGE_ICON',
    'stage-done': 'STAGE_ICON_DONE',
    'stage-remove': 'STAGE_REMOVE_ICON',
    pin: 'PIN_ICON',
    'pin-filled': 'PIN_ICON_FILLED',
    sleep: 'SLEEP_ICON',
    'sleep-filled': 'SLEEP_ICON_FILLED',
    star: 'STAR_ICON',
    'star-filled': 'STAR_ICON_FILLED',
    check: 'CHECK_ICON',
    activate: 'ACTIVATE_ICON',
    'folder-star': 'FOLDER_STAR_ICON',
    tabs: 'TABS_ICON',
    open: 'OPEN_ICON',
    ungroup: 'UNGROUP_ICON',
    flag: 'FLAG_ICON'
};

const lines = [];
lines.push('export const ICON_SPRITE_SHEET =');
for (const [name, exp] of Object.entries(SET)) {
    const svg = icons[exp];
    if (!svg || typeof svg !== 'string') {
        console.error(`missing export: ${exp}`);
        process.exit(1);
    }
    const attrs = svg.match(/<svg([^>]*)>/)[1];
    const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>')).trim();
    const keep = attrs
        .replace(/class="[^"]*"/, '')
        .replace(/width="[^"]*"/, '')
        .replace(/height="[^"]*"/, '')
        .replace(/aria-hidden="[^"]*"/, '')
        .replace(/\s+/g, ' ')
        .trim();
    const symbol = `vbm-ic-${name}`;
    lines.push(`    '<symbol id="${symbol}"${keep ? ' ' + keep : ''}>' +`);
    for (const part of inner.split(/(?=<)/)) {
        const p = part.trim();
        if (p)
            lines.push(`    '${p}' +`);
    }
    lines.push(`    '</symbol>' +`);
}
lines.push("    '</svg>';");

// emit with a small wrapper mirroring the hand-written block's shape
console.log(lines.join('\n').replace(/'\n/g, "'\n"));
