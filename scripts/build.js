import { build } from 'esbuild';
import { copyFile, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

async function buildExtension() {
  console.log('🚀 Building vBookmarks extension...');

  // Clean dist directory
  const { execSync } = await import('child_process');
  try {
    execSync('node scripts/clean.js', { stdio: 'inherit' });
  } catch (error) {
    console.log('Clean step completed');
  }

  try {
    // Build main application
    await build({
      entryPoints: ['src/app.js'],
      bundle: true,
      outfile: 'dist/popup.js',
      format: 'esm',
      target: 'es2022',
      minify: true,
      sourcemap: true,
      define: {
        'process.env.NODE_ENV': '"production"',
        'process.env.VERSION': `"${version}"`
      }
    });

    // Build background script
    await build({
      entryPoints: ['background.js'],
      bundle: false,
      outfile: 'dist/background.js',
      format: 'esm',
      minify: true,
      target: 'es2022'
    });

    // Copy HTML files
    await copyFile('popup.html', 'dist/popup.html');
    await copyFile('options.html', 'dist/options.html');
    await copyFile('advanced-options.html', 'dist/advanced-options.html');

    // Copy CSS files
    await copyFile('neat.css', 'dist/neat.css');
    await copyFile('sync-styles.css', 'dist/sync-styles.css');

    // Copy manifest
    const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
    manifest.version = version;
    await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2));

    // Copy icons and assets
    const iconFiles = await glob('icon*.png');
    for (const icon of iconFiles) {
      await copyFile(icon, join('dist', icon));
    }

    // Copy localization files
    const localeFiles = await glob('_locales/**/*.json');
    for (const locale of localeFiles) {
      const destPath = join('dist', locale);
      await copyFile(locale, destPath);
    }

    console.log('✅ Build completed successfully!');
    console.log('📦 Extension built in dist/ directory');

  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

buildExtension();