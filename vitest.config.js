import { defineConfig, configDefaults } from 'vitest/config';

// Keep third-party tool worktrees (.qoder/, .claude/) out of the suite —
// their copies of tests/ are not this repo's gate.
export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, '.qoder/**', '.claude/**']
    }
});
