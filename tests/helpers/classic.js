import fs from 'node:fs';

// Evaluate a classic-script source (store.js / fuzzy.js / sort-utils.js /
// sync-manager.js) in a sandbox with named dependencies — wraps the
// `new Function('window', …)` pattern so a suite doesn't hand-roll the eval.
// deps keys become the function's parameter names, so store.js passes
// `{ window, chrome, localStorage, document }` while sort-utils/fuzzy pass
// `{ window }`. The script assigns its `window.*` globals onto the window stub.
export const loadClassicScript = (source, deps = {}) => {
    const names = Object.keys(deps);
    return new Function(...names, source)(...names.map(n => deps[n]));
};

// Convenience: read a src file relative to the repo root, then evaluate it.
export const loadClassicFromFile = (modulePath, deps = {}) =>
    loadClassicScript(fs.readFileSync(new URL(`../../${modulePath}`, import.meta.url), 'utf8'), deps);
