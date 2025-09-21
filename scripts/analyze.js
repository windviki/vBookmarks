import { glob } from 'glob';
import { readFile } from 'fs/promises';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

class CodeAnalyzer {
  constructor() {
    this.metrics = {
      totalFiles: 0,
      totalLines: 0,
      totalSize: 0,
      largestFile: null,
      averageFileSize: 0,
      modules: {},
      complexity: {},
      dependencies: []
    };
  }

  async analyze() {
    console.log('🔍 Analyzing vBookmarks codebase...\n');

    // Analyze source files
    await this.analyzeSourceFiles();

    // Analyze dependencies
    await this.analyzeDependencies();

    // Check code quality
    await this.checkCodeQuality();

    // Generate recommendations
    this.generateRecommendations();

    // Print report
    this.printReport();
  }

  async analyzeSourceFiles() {
    console.log('📊 Analyzing source files...');

    const sourceFiles = await glob('src/**/*.js');
    const legacyFiles = await glob('*.js', { ignore: ['node_modules/**', 'dist/**', 'release/**'] });

    const allFiles = [...sourceFiles, ...legacyFiles.filter(f => !f.startsWith('scripts/'))];

    for (const file of allFiles) {
      try {
        const content = await readFile(file, 'utf8');
        const lines = content.split('\n');
        const lineCount = lines.length;
        const size = content.length;

        this.metrics.totalFiles++;
        this.metrics.totalLines += lineCount;
        this.metrics.totalSize += size;

        // Track largest file
        if (!this.metrics.largestFile || size > this.metrics.largestFile.size) {
          this.metrics.largestFile = { file, size, lineCount };
        }

        // Analyze by module type
        const moduleType = this.getModuleType(file);
        if (!this.metrics.modules[moduleType]) {
          this.metrics.modules[moduleType] = { count: 0, lines: 0, size: 0 };
        }
        this.metrics.modules[moduleType].count++;
        this.metrics.modules[moduleType].lines += lineCount;
        this.metrics.modules[moduleType].size += size;

        // Basic complexity analysis
        const complexity = this.analyzeComplexity(content);
        this.metrics.complexity[file] = complexity;

      } catch (error) {
        console.warn(`Warning: Could not analyze ${file}: ${error.message}`);
      }
    }

    this.metrics.averageFileSize = Math.round(this.metrics.totalSize / this.metrics.totalFiles);
  }

  getModuleType(file) {
    if (file.includes('core/')) return 'core';
    if (file.includes('utils/')) return 'utils';
    if (file.includes('scripts/')) return 'scripts';
    if (file === 'neat.js') return 'legacy-core';
    if (file === 'neatools.js') return 'legacy-utils';
    return 'other';
  }

  analyzeComplexity(content) {
    const lines = content.split('\n');
    let complexity = 1; // Base complexity

    const complexityIndicators = [
      /if\s*\(/g,
      /else\s+if/g,
      /for\s*\(/g,
      /while\s*\(/g,
      /switch\s*\(/g,
      /catch\s*\(/g,
      /\?\s*[^:]*\s*:/g, // ternary
      /\&\&|\|\|/g // logical operators
    ];

    complexityIndicators.forEach(indicator => {
      const matches = content.match(indicator);
      if (matches) {
        complexity += matches.length;
      }
    });

    return {
      score: complexity,
      lines: lines.length,
      functions: (content.match(/function\s+\w+/g) || []).length,
      classes: (content.match(/class\s+\w+/g) || []).length,
      arrows: (content.match(/=>/g) || []).length
    };
  }

  async analyzeDependencies() {
    console.log('📦 Analyzing dependencies...');

    try {
      const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };

      this.metrics.dependencies = Object.entries(allDeps).map(([name, version]) => ({
        name,
        version,
        type: packageJson.dependencies[name] ? 'production' : 'development'
      }));

      console.log(`📦 Found ${this.metrics.dependencies.length} dependencies`);
    } catch (error) {
      console.warn('Warning: Could not analyze dependencies:', error.message);
    }
  }

  async checkCodeQuality() {
    console.log('🔍 Checking code quality indicators...');

    // Check for modern ES6+ features usage
    const sourceFiles = await glob('src/**/*.js');
    let modernFeatures = 0;
    let totalFeatures = 0;

    for (const file of sourceFiles) {
      try {
        const content = await readFile(file, 'utf8');

        // Check for modern features
        const features = {
          classes: (content.match(/class\s+\w+/g) || []).length,
          arrows: (content.match(/=>/g) || []).length,
          async: (content.match(/async\s+/g) || []).length,
          await: (content.match(/await\s+/g) || []).length,
          constLet: (content.match(/(const|let)\s+/g) || []).length,
          template: (content.match(/`[^`]*`/g) || []).length,
          destructuring: (content.match(/\{[^}]*\}\s*=/g) || []).length,
          spread: (content.match(/\.\.\./g) || []).length
        };

        modernFeatures += Object.values(features).reduce((a, b) => a + b, 0);
        totalFeatures += Object.keys(features).length;

      } catch (error) {
        console.warn(`Warning: Could not check quality for ${file}: ${error.message}`);
      }
    }

    this.metrics.quality = {
      modernizationScore: totalFeatures > 0 ? Math.round((modernFeatures / totalFeatures) * 100) : 0,
      modernFeatures,
      totalFeatures
    };
  }

  generateRecommendations() {
    this.recommendations = [];

    // File size recommendations
    if (this.metrics.largestFile && this.metrics.largestFile.lineCount > 1000) {
      this.recommendations.push({
        priority: 'high',
        type: 'refactor',
        message: `Large file detected: ${this.metrics.largestFile.file} (${this.metrics.largestFile.lineCount} lines). Consider splitting into smaller modules.`
      });
    }

    // Complexity recommendations
    const highComplexityFiles = Object.entries(this.metrics.complexity)
      .filter(([_, complexity]) => complexity.score > 20)
      .map(([file, _]) => file);

    if (highComplexityFiles.length > 0) {
      this.recommendations.push({
        priority: 'medium',
        type: 'refactor',
        message: `High complexity detected in: ${highComplexityFiles.join(', ')}. Consider simplifying logic.`
      });
    }

    // Modernization recommendations
    if (this.metrics.quality?.modernizationScore < 80) {
      this.recommendations.push({
        priority: 'low',
        type: 'modernize',
        message: `Modernization score: ${this.metrics.quality.modernizationScore}%. Consider using more ES6+ features.`
      });
    }

    // Legacy code recommendations
    const legacyLines = this.metrics.modules['legacy-core']?.lines || 0;
    const totalLines = this.metrics.totalLines;
    const legacyPercentage = Math.round((legacyLines / totalLines) * 100);

    if (legacyPercentage > 50) {
      this.recommendations.push({
        priority: 'high',
        type: 'migration',
        message: `${legacyPercentage}% of code is in legacy files. Prioritize migration to modern modular structure.`
      });
    }
  }

  printReport() {
    console.log('\n📊 Code Analysis Report for vBookmarks v' + version);
    console.log('='.repeat(60));

    // Basic metrics
    console.log('\n📈 Basic Metrics:');
    console.log(`   Total Files: ${this.metrics.totalFiles}`);
    console.log(`   Total Lines: ${this.metrics.totalLines.toLocaleString()}`);
    console.log(`   Total Size: ${Math.round(this.metrics.totalSize / 1024)}KB`);
    console.log(`   Average File Size: ${this.metrics.averageFileSize} lines`);

    // Largest file
    if (this.metrics.largestFile) {
      console.log(`   Largest File: ${this.metrics.largestFile.file} (${this.metrics.largestFile.lineCount} lines)`);
    }

    // Module breakdown
    console.log('\n📦 Module Breakdown:');
    Object.entries(this.metrics.modules).forEach(([type, stats]) => {
      const percentage = Math.round((stats.lines / this.metrics.totalLines) * 100);
      console.log(`   ${type}: ${stats.count} files, ${stats.lines} lines (${percentage}%)`);
    });

    // Dependencies
    console.log('\n📚 Dependencies:');
    console.log(`   Total: ${this.metrics.dependencies.length}`);
    this.metrics.dependencies.forEach(dep => {
      console.log(`   ${dep.name} (${dep.version}) [${dep.type}]`);
    });

    // Code quality
    if (this.metrics.quality) {
      console.log('\n🎯 Code Quality:');
      console.log(`   Modernization Score: ${this.metrics.quality.modernizationScore}%`);
    }

    // High complexity files
    const highComplexityFiles = Object.entries(this.metrics.complexity)
      .filter(([_, complexity]) => complexity.score > 15)
      .sort((a, b) => b[1].score - a[1].score);

    if (highComplexityFiles.length > 0) {
      console.log('\n⚠️  High Complexity Files:');
      highComplexityFiles.slice(0, 5).forEach(([file, complexity]) => {
        console.log(`   ${file}: ${complexity.score} complexity`);
      });
    }

    // Recommendations
    if (this.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      this.recommendations.forEach((rec, index) => {
        const priorityIcon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢';
        console.log(`   ${priorityIcon} ${index + 1}. ${rec.message}`);
      });
    }

    console.log('\n✅ Analysis completed!');
    console.log('💡 Use these insights to prioritize refactoring efforts.');
  }
}

// Run analysis
const analyzer = new CodeAnalyzer();
analyzer.analyze().catch(console.error);