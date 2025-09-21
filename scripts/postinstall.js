import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

console.log('🚀 Running post-installation setup...');

// Install dependencies if node_modules doesn't exist
if (!existsSync(join(process.cwd(), 'node_modules'))) {
  console.log('📦 Installing dependencies...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    console.log('✅ Dependencies installed successfully!');
  } catch (error) {
    console.error('❌ Failed to install dependencies:', error);
    process.exit(1);
  }
}

// Create necessary directories
import { mkdir } from 'fs/promises';

const directories = [
  'dist',
  'release',
  'logs'
];

console.log('📁 Creating necessary directories...');
for (const dir of directories) {
  try {
    await mkdir(dir, { recursive: true });
    console.log(`✅ Created directory: ${dir}`);
  } catch (error) {
    if (error.code !== 'EEXIST') {
      console.warn(`Warning: Could not create ${dir}: ${error.message}`);
    }
  }
}

console.log('✅ Post-installation setup completed!');
console.log('💡 Run "npm run dev" to start development server');
console.log('💡 Run "npm run build" to build for production');