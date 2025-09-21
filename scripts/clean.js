import { rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { glob } from 'glob';

async function clean() {
  console.log('🧹 Cleaning up build artifacts...');

  const directoriesToRemove = [
    'dist',
    'release',
    'node_modules/.cache',
    '.esbuild'
  ];

  const filesToRemove = [
    '*.log',
    '*.tmp',
    '.DS_Store',
    'Thumbs.db'
  ];

  try {
    // Remove directories
    for (const dir of directoriesToRemove) {
      try {
        await rm(dir, { recursive: true, force: true });
        console.log(`📁 Removed directory: ${dir}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn(`Warning: Could not remove ${dir}: ${error.message}`);
        }
      }
    }

    // Remove files
    const globPatterns = filesToRemove.map(pattern => glob.sync(pattern)).flat();
    for (const file of globPatterns) {
      try {
        await rm(file, { force: true });
        console.log(`📄 Removed file: ${file}`);
      } catch (error) {
        console.warn(`Warning: Could not remove ${file}: ${error.message}`);
      }
    }

    // Recreate essential directories
    try {
      await mkdir('dist', { recursive: true });
      console.log('📁 Created dist directory');
    } catch (error) {
      console.warn(`Warning: Could not create dist directory: ${error.message}`);
    }

    console.log('✅ Cleanup completed successfully!');
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

clean();