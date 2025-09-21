import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,tsx,jsx}'],
    exclude: ['node_modules', 'dist', 'release'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        'dist/',
        'release/',
        '**/*.config.js',
        '**/*.config.mjs',
        '**/setup.js'
      ]
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@/core': resolve(__dirname, 'src/core'),
      '@/utils': resolve(__dirname, 'src/utils'),
      '@/constants': resolve(__dirname, 'src/constants')
    }
  },
  esbuild: {
    target: 'es2022'
  }
});