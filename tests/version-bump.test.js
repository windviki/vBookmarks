import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Release-gate contract: the extension version must be bumped consistently
// in the two places the build/packaging and the popup read it. The check
// compares the two files against each other (not a pinned literal), so a
// version bump never has to edit this test — forgetting ONE of the two
// files is what fails here.
describe('version bump consistency', () => {
    it('manifest.json and package.json carry the same semver version', () => {
        const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
        const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        expect(manifest.version).toBe(pkg.version);
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
});
