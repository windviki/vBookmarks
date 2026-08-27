// Summarize a DevTools trace.json: total duration by event name and by
// coarse stage bucket (ParseHTML / styles / Layout / scripting / paint …).
// Usage: node analyze-trace.js <trace.json> [topN]
const fs = require('fs');
const file = process.argv[2];
const topN = parseInt(process.argv[3] || '20', 10);
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const evts = j.traceEvents || j;

// self duration = dur - children durs (trace events nest: parent starts
// before, ends after children). Bucket by top-level-ish names too.
const byName = new Map();
let total = 0;
const bucketOf = name => {
    if (/ParseHTML|ParseAuthorStyleSheet/.test(name)) return 'parse';
    if (/RecalculateStyles|UpdateLayoutTree|ScheduleStyleRecalculation/.test(name)) return 'style';
    if (name === 'Layout' || /^Layout$/.test(name)) return 'layout';
    if (/Paint|PrePaint|Layerize|Composite|Rasterize|Decode Image|Resize/.test(name)) return 'paint/composite';
    if (/FunctionCall|EvaluateScript|v8\.|Timer|FireAnimationFrame|EventDispatch|XHRLoad/.test(name)) return 'scripting';
    if (/GC|MajorGC|MinorGC/.test(name)) return 'gc';
    if (name === 'Program' || name === 'Task') return 'task-shell';
    if (/HitTest|RequestAnimationFrame|UpdateCounters/.test(name)) return 'misc';
    return 'other';
};
const byBucket = new Map();
for (const e of evts) {
    if (e.ph !== 'X' || !e.dur)
        continue;
    const name = e.name;
    const dur = e.dur / 1000; // µs → ms
    if (name === 'Program' || name === 'Task')
        continue; // shell wrappers double-count the real work
    byName.set(name, (byName.get(name) || 0) + dur);
    const b = bucketOf(name);
    byBucket.set(b, (byBucket.get(b) || 0) + dur);
    total += dur;
}
const fmt = d => `${(d).toFixed(0).padStart(7)}ms  ${(100 * d / (total || 1), 100 * d / (total || 1)).toFixed ? (100 * d / total).toFixed(1) : ''}%`;
console.log(`events: ${evts.length}, summed inclusive-ish durations: ${(total / 1000).toFixed(1)}s (nested — stages overlap)`);
console.log('\n== by stage bucket (ms) ==');
[...byBucket.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`${v.toFixed(0).padStart(8)}ms  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`));
console.log('\n== top event names (ms) ==');
[...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
    .forEach(([k, v]) => console.log(`${v.toFixed(0).padStart(8)}ms  ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`));
