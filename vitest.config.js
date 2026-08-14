import { defineConfig, configDefaults } from 'vitest/config';

// Keep third-party tool worktrees (e.g. .qoder/) out of the suite — their
// copies of tests/ are not this repo's gate.
export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, '.qoder/**']
    }
});
