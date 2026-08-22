// Compare perf.json outputs from perf-run.sh runs.
// Usage: node scripts/harness/perf-compare.js <dir1> <dir2> [<dir3>]
const fs = require('fs');
const path = require('path');
const median = arr => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const dirs = process.argv.slice(2);
const rows = dirs.map(d => {
    const j = JSON.parse(fs.readFileSync(path.join(d, 'perf.json'), 'utf8'));
    const settle = j.profile && j.profile.settleMs ? j.profile.settleMs : 0;
    const cold = j.popupColdOpen || [];
    const dup = j.dupesActivate || [];
    const m = k => median(cold.map(r => r[k]));
    const dm = k => median(dup.map(r => r[k]));
    return {
        name: j.mode + (settle ? ' (settle ' + settle + ')' : ''),
        seeded: j.seeded,
        coldWall: m('wallMs'), coldWallNoSettle: m('wallMs') - settle,
        coldScript: m('scriptingMs'), coldLayout: m('layoutCount'),
        dupWall: dm('wallMs'), dupScript: dm('scriptingMs'), dupLayout: dm('layoutCount'), dupRows: dm('rows')
    };
});
console.log('=== popup cold open (medians) ===');
console.log('| mode | wall(ms) | wall-settle(ms) | scripting(ms) | layouts |');
for (const r of rows)
    console.log('| ' + r.name + ' | ' + r.coldWall.toFixed(1) + ' | ' + r.coldWallNoSettle.toFixed(1) + ' | ' + r.coldScript.toFixed(1) + ' | ' + r.coldLayout + ' |');
console.log('\n=== dupes regroup on bookmark event (medians) ===');
console.log('| mode | wall(ms) | scripting(ms) | layouts | rows |');
for (const r of rows)
    console.log('| ' + r.name + ' | ' + r.dupWall.toFixed(1) + ' | ' + r.dupScript.toFixed(1) + ' | ' + r.dupLayout + ' | ' + r.dupRows + ' |');
