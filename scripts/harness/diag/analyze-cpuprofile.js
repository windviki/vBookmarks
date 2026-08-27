// Summarize a .cpuprofile: top self-time functions (hitCount-weighted).
// Usage: node analyze-cpuprofile.js <file.cpuprofile> [topN]
const fs = require('fs');
const file = process.argv[2];
const topN = parseInt(process.argv[3] || '25', 10);
const prof = JSON.parse(fs.readFileSync(file, 'utf8'));
const totalHits = prof.nodes.reduce((a, n) => a + (n.hitCount || 0), 0);
const totalUs = prof.endTime - prof.startTime;
const byFn = new Map();
const byUrl = new Map();
for (const n of prof.nodes) {
    const cf = n.callFrame || {};
    const fn = cf.functionName || '(anonymous)';
    const url = (cf.url || '').replace(/^.*\//, '');
    const key = `${fn} @ ${url}:${cf.lineNumber}:${cf.columnNumber}`;
    byFn.set(key, (byFn.get(key) || 0) + (n.hitCount || 0));
    byUrl.set(url, (byUrl.get(url) || 0) + (n.hitCount || 0));
}
const fmt = hits => (100 * hits / (totalHits || 1)).toFixed(1).padStart(5) + '%';
console.log(`total samples ${totalHits}, window ${(totalUs / 1e6).toFixed(1)}s`);
console.log('\n== top self-time functions ==');
[...byFn.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN)
    .forEach(([k, v]) => console.log(`${fmt(v)}  ${k}`));
console.log('\n== by url ==');
[...byUrl.entries()].filter(([u]) => u).sort((a, b) => b[1] - a[1]).slice(0, topN)
    .forEach(([u, v]) => console.log(`${fmt(v)}  ${u}`));

// Caller attribution: for every sample in `targetFn`, credit its nearest
// non-querySelector ancestors. Pass --callers <fn> as argv[3].
if (process.argv.includes('--callers')) {
    const target = process.argv[process.argv.indexOf('--callers') + 1];
    const idToNode = new Map(prof.nodes.map(n => [n.id, n]));
    const parent = new Map();
    for (const n of prof.nodes)
        for (const c of n.children || [])
            parent.set(c, n.id);
    const callers = new Map();
    for (const n of prof.nodes) {
        const fn = (n.callFrame || {}).functionName || '(anonymous)';
        if (fn !== target)
            continue;
        let p = parent.get(n.id);
        const seen = new Set();
        while (p && !seen.has(p)) {
            seen.add(p);
            const pn = idToNode.get(p);
            const pf = (pn.callFrame || {}).functionName || '(anonymous)';
            if (pf !== target) {
                const url = ((pn.callFrame || {}).url || '').replace(/^.*\//, '');
                const key = `${pf} @ ${url}:${pn.callFrame.lineNumber}`;
                callers.set(key, (callers.get(key) || 0) + (n.hitCount || 0));
                break;
            }
            p = parent.get(p);
        }
    }
    console.log(`\n== nearest callers of ${target} (self hits attributed) ==`);
    [...callers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
        .forEach(([k, v]) => console.log(`${fmt(v)}  ${k}`));
}
