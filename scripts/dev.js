import { build } from 'esbuild';
import { watch } from 'chokidar';
import { copyFile, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { execSync } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

async function copyStaticFiles() {
  try {
    // Copy HTML files
    await copyFile('popup.html', 'dist/popup.html');
    await copyFile('options.html', 'dist/options.html');
    await copyFile('advanced-options.html', 'dist/advanced-options.html');

    // Copy CSS files
    await copyFile('neat.css', 'dist/neat.css');
    await copyFile('sync-styles.css', 'dist/sync-styles.css');

    // Copy and update manifest
    const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
    manifest.version = version;
    await writeFile('dist/manifest.json', JSON.stringify(manifest, null, 2));

    // Copy icons
    const { glob } = await import('glob');
    const iconFiles = await glob('icon*.png');
    for (const icon of iconFiles) {
      await copyFile(icon, join('dist', icon));
    }

    // Copy localization
    const localeFiles = await glob('_locales/**/*.json');
    for (const locale of localeFiles) {
      const destPath = join('dist', locale);
      await copyFile(locale, destPath);
    }
  } catch (error) {
    console.warn('Warning copying static files:', error.message);
  }
}

async function startDevServer() {
  console.log('🚀 Starting vBookmarks development server...');

  // Clean and create dist directory
  try {
    execSync('node scripts/clean.js', { stdio: 'inherit' });
  } catch (error) {
    console.log('Clean step completed');
  }

  // Copy static files first
  await copyStaticFiles();

  // Build background script (less frequent changes)
  try {
    await build({
      entryPoints: ['background.js'],
      bundle: false,
      outfile: 'dist/background.js',
      format: 'esm',
      minify: false,
      sourcemap: true,
      target: 'es2022'
    });
  } catch (error) {
    console.error('Background script build failed:', error);
  }

  // Setup watcher for main source files
  const ctx = await build({
    entryPoints: ['src/app.js'],
    bundle: true,
    outfile: 'dist/popup.js',
    format: 'esm',
    minify: false,
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': '"development"',
      'process.env.VERSION': `"${version}"`
    },
    watch: {
      onRebuild(error, result) {
        if (error) {
          console.error('❌ Rebuild failed:', error);
        } else {
          console.log('✅ Rebuilt successfully at', new Date().toLocaleTimeString());
        }
      },
    },
  });

  console.log('📡 Watching for changes...');
  console.log('🔧 Development server ready');
  console.log('💡 Load dist/ in Chrome extension manager for testing');

  // Watch for other file changes
  const watcher = watch([
    'popup.html',
    'options.html',
    'advanced-options.html',
    'neat.css',
    'sync-styles.css',
    'manifest.json',
    'icon*.png',
    '_locales/**/*.json'
  ]);

  watcher.on('change', async (path) => {
    console.log(`📁 Changed: ${path}`);
    await copyStaticFiles();
    console.log('📄 Static files updated');
  });

  watcher.on('error', (error) => {
    console.error('Watcher error:', error);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down development server...');
    await watcher.close();
    await ctx.dispose();
    process.exit(0);
  });
}

startDevServer().catch(console.error);