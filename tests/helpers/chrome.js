// chrome API double factories (batch A). The popup/options/SW code speaks a
// few storage shapes (callback and promise styles) plus the bookmarks/tabs
// surfaces; these factories record the calls a suite wants to assert.

// A chrome.storage area backed by a plain object; set/remove are recorded so
// "was anything written" is assertable. get() answers a key / array / object
// or the whole area, callback-style like the real API (plus promise style).
export const makeStorageArea = (data = {}) => {
    const calls = { set: [], remove: [] };
    return {
        data,
        calls,
        get: (keys, cb) => {
            let out;
            if (keys === null || keys === undefined)
                out = { ...data };
            else if (typeof keys === 'string')
                out = { [keys]: data[keys] };
            else if (Array.isArray(keys)) {
                out = {};
                for (const k of keys) if (k in data) out[k] = data[k];
            } else {
                out = {};
                for (const k of Object.keys(keys)) out[k] = k in data ? data[k] : keys[k];
            }
            if (cb) { cb(out); return undefined; }
            return Promise.resolve(out);
        },
        set: (obj, cb) => {
            calls.set.push({ ...obj });
            Object.assign(data, obj);
            if (cb) { cb(); return undefined; }
            return Promise.resolve();
        },
        remove: (keys, cb) => {
            const list = [].concat(keys);
            calls.remove.push(list);
            for (const k of list) delete data[k];
            if (cb) { cb(); return undefined; }
            return Promise.resolve();
        },
        clear: async () => { for (const k in data) delete data[k]; }
    };
};

// A bookmarks double: getTree/search/get/create/move/remove with recorded
// calls. `tree` seeds getTree, `searchResults` seeds search.
export const makeBookmarksDouble = () => {
    const calls = { create: [], remove: [], move: [] };
    const dbl = {
        tree: [],
        searchResults: [],
        lastErrorValue: undefined,
        calls,
        getTree(cb) { cb(dbl.tree); },
        search(query, cb) { cb(dbl.searchResults); },
        get(id, cb) { cb([]); },
        create(node, cb) { calls.create.push(node); if (cb) cb({ id: 'new', ...node }); },
        remove(id, cb) { calls.remove.push(id); if (cb) cb(); },
        move(id, props, cb) { calls.move.push([id, props]); if (cb) cb(); }
    };
    return dbl;
};
