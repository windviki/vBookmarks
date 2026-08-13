/**
 * vBookmarks fuzzy search — page-side shim (Phase 2b).
 *
 * The scoring/ranking implementation lives in src/fuzzy-core.js (shared with
 * the omnibox via search-core.js's rankBookmarks). This module only re-exposes
 * it as window.VBMFuzzy for the classic consumers (palette.js / search.js read
 * the global synchronously). Loaded as an ES module by popup.html/sidepanel.html
 * before neat.js.
 */
import { score, rank } from './fuzzy-core.js';

window.VBMFuzzy = { score, rank };
