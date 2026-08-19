import { describe, it, expect } from 'vitest';
import fs from 'node:fs';

// Release-gate contract: the extension version must be bumped consistently
// in the two places the build/packaging and the popup read it. Keeping this
// in the suite means a version bump that forgets one file fails instantly.
describe('version bump consistency', () => {
    it('manifest.json and package.json both read 4.0.9', () => {
        const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
        const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        expect(manifest.version).toBe('4.0.9');
        expect(pkg.version).toBe('4.0.9');
    });
});
