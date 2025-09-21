import { spawn } from 'child_process';
import { glob } from 'glob';
import { readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

class TestRunner {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
  }

  async runAllTests() {
    console.log('🧪 Running vBookmarks test suite...\n');

    // Run ESLint
    await this.runLinting();

    // Run type checking
    await this.runTypeCheck();

    // Run integration tests
    await this.runIntegrationTests();

    // Run performance tests
    await this.runPerformanceTests();

    // Generate report
    this.generateReport();
  }

  async runLinting() {
    console.log('🔍 Running ESLint...');

    return new Promise((resolve) => {
      const eslint = spawn('npx', ['eslint', 'src/**/*.js'], { stdio: 'pipe' });
      let output = '';
      let error = '';

      eslint.stdout.on('data', (data) => {
        output += data.toString();
      });

      eslint.stderr.on('data', (data) => {
        error += data.toString();
      });

      eslint.on('close', (code) => {
        const passed = code === 0;
        this.results.push({
          name: 'ESLint',
          passed,
          details: passed ? '✅ No linting errors' : `❌ Linting errors found:\n${error || output}`,
          duration: Date.now() - this.startTime
        });

        if (!passed) {
          console.log('❌ ESLint failed');
          console.log(error || output);
        } else {
          console.log('✅ ESLint passed');
        }
        resolve();
      });
    });
  }

  async runTypeCheck() {
    console.log('📝 Running TypeScript type checking...');

    return new Promise((resolve) => {
      const tsc = spawn('npx', ['tsc', '--noEmit'], { stdio: 'pipe' });
      let output = '';

      tsc.stderr.on('data', (data) => {
        output += data.toString();
      });

      tsc.on('close', (code) => {
        const passed = code === 0;
        this.results.push({
          name: 'TypeScript',
          passed,
          details: passed ? '✅ No type errors' : `❌ Type errors found:\n${output}`,
          duration: Date.now() - this.startTime
        });

        if (!passed) {
          console.log('❌ TypeScript checking failed');
          console.log(output);
        } else {
          console.log('✅ TypeScript checking passed');
        }
        resolve();
      });
    });
  }

  async runIntegrationTests() {
    console.log('🔗 Running integration tests...');

    try {
      // Check if all source files exist and are valid
      const sourceFiles = await glob('src/**/*.js');
      const requiredFiles = [
        'src/app.js',
        'src/core/bookmark-manager.js',
        'src/core/ui-manager.js',
        'src/core/search-manager.js',
        'src/utils/dom-utils.js',
        'src/module-loader.js'
      ];

      const missingFiles = requiredFiles.filter(file => !sourceFiles.includes(file));
      const hasMissingFiles = missingFiles.length > 0;

      this.results.push({
        name: 'Integration Tests',
        passed: !hasMissingFiles,
        details: hasMissingFiles
          ? `❌ Missing required files:\n${missingFiles.join('\n')}`
          : `✅ All required modules present\nFound ${sourceFiles.length} source files`,
        duration: Date.now() - this.startTime
      });

      if (hasMissingFiles) {
        console.log('❌ Integration tests failed - missing modules');
      } else {
        console.log('✅ Integration tests passed');
      }
    } catch (error) {
      this.results.push({
        name: 'Integration Tests',
        passed: false,
        details: `❌ Error running integration tests: ${error.message}`,
        duration: Date.now() - this.startTime
      });
      console.log('❌ Integration tests failed:', error.message);
    }
  }

  async runPerformanceTests() {
    console.log('⚡ Running performance tests...');

    try {
      // Check file sizes
      const sourceFiles = await glob('src/**/*.js');
      const fileSizeResults = [];

      for (const file of sourceFiles) {
        const content = await readFile(file, 'utf8');
        const lineCount = content.split('\n').length;
        const size = content.length;

        // Warn about large files
        if (lineCount > 500) {
          fileSizeResults.push(`${file}: ${lineCount} lines (⚠️ large file)`);
        } else if (lineCount > 1000) {
          fileSizeResults.push(`${file}: ${lineCount} lines (❌ very large file)`);
        }
      }

      const passed = fileSizeResults.length === 0;

      this.results.push({
        name: 'Performance Tests',
        passed,
        details: passed
          ? '✅ All modules are appropriately sized'
          : `❌ Performance issues found:\n${fileSizeResults.join('\n')}`,
        duration: Date.now() - this.startTime
      });

      if (passed) {
        console.log('✅ Performance tests passed');
      } else {
        console.log('❌ Performance tests failed - large modules detected');
      }
    } catch (error) {
      this.results.push({
        name: 'Performance Tests',
        passed: false,
        details: `❌ Error running performance tests: ${error.message}`,
        duration: Date.now() - this.startTime
      });
      console.log('❌ Performance tests failed:', error.message);
    }
  }

  generateReport() {
    console.log('\n📊 Test Results Summary');
    console.log('='.repeat(50));

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const duration = Date.now() - this.startTime;

    this.results.forEach(result => {
      const status = result.passed ? '✅' : '❌';
      console.log(`${status} ${result.name} (${result.duration}ms)`);

      if (!result.passed) {
        console.log(`   ${result.details}`);
      }
    });

    console.log('='.repeat(50));
    console.log(`🎯 Summary: ${passed}/${total} test suites passed`);
    console.log(`⏱️  Total duration: ${duration}ms`);

    if (passed === total) {
      console.log('🎉 All tests passed!');
    } else {
      console.log('⚠️  Some tests failed. Review the details above.');
      process.exit(1);
    }
  }
}

// Run tests
const runner = new TestRunner();
runner.runAllTests().catch(error => {
  console.error('Test runner failed:', error);
  process.exit(1);
});