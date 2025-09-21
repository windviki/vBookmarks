#!/usr/bin/env node

/**
 * vBookmarks Extension Packaging Script
 *
 * This script packages the Chrome extension for distribution,
 * excluding development and unnecessary files.
 *
 * Usage:
 *   node package-extension.js [version]
 *   node package-extension.js 4.0.1
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { execSync } = require('child_process');

class ExtensionPackager {
    constructor() {
        this.rootDir = process.cwd();
        this.distDir = path.join(this.rootDir, 'dist');
        this.packageName = 'vbookmarks';

        // Files and directories to exclude from packaging
        this.excludePatterns = [
            '.git',
            '.gitignore',
            '.claude',
            'node_modules',
            'dist',
            '*.log',
            '*.md',
            '*.jpg',
            'package.json',
            'package-lock.json',
            '.DS_Store',
            'Thumbs.db',
            '*.zip',
            '*.crx'
        ];

        // Required files for the extension
        this.requiredFiles = [
            'manifest.json',
            'popup.html',
            'popup.js',
            'neat.js',
            'background.js',
            'options.html',
            'options.js',
            'advanced-options.html',
            'advanced-options.js',
            'neatools.js',
            'codemirror.js',
            'codemirror.css',
            'neat.css',
            'options.css',
            'sync-styles.css',
            '_locales',
            'icon16.png',
            'icon32.png',
            'icon48.png',
            'icon128.png',
            'icon.png'
        ];
    }

    async init() {
        console.log('🚀 Starting vBookmarks extension packaging...\n');

        // Get version from command line or manifest
        const version = this.getVersion();
        console.log(`📦 Version: ${version}`);

        // Create dist directory
        this.createDistDirectory();

        // Copy files
        await this.copyFiles();

        // Create package
        await this.createPackage(version);

        console.log('✅ Packaging completed successfully!');
    }

    getVersion() {
        const args = process.argv.slice(2);
        if (args[0]) {
            return args[0];
        }

        // Read version from manifest.json
        const manifestPath = path.join(this.rootDir, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            return manifest.version;
        }

        throw new Error('Version not provided and manifest.json not found');
    }

    createDistDirectory() {
        if (fs.existsSync(this.distDir)) {
            fs.rmSync(this.distDir, { recursive: true, force: true });
        }
        fs.mkdirSync(this.distDir, { recursive: true });
        console.log('📁 Created dist directory');
    }

    async copyFiles() {
        console.log('📋 Copying extension files...');

        for (const file of this.requiredFiles) {
            const sourcePath = path.join(this.rootDir, file);
            const destPath = path.join(this.distDir, file);

            if (fs.existsSync(sourcePath)) {
                const stats = fs.statSync(sourcePath);

                if (stats.isDirectory()) {
                    this.copyDirectory(sourcePath, destPath);
                } else {
                    this.copyFile(sourcePath, destPath);
                }
            } else {
                console.warn(`⚠️  Required file not found: ${file}`);
            }
        }
    }

    copyDirectory(source, dest) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }

        const files = fs.readdirSync(source);
        for (const file of files) {
            const sourcePath = path.join(source, file);
            const destPath = path.join(dest, file);

            if (this.shouldExclude(file)) {
                continue;
            }

            const stats = fs.statSync(sourcePath);
            if (stats.isDirectory()) {
                this.copyDirectory(sourcePath, destPath);
            } else {
                this.copyFile(sourcePath, destPath);
            }
        }
    }

    copyFile(source, dest) {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }

        fs.copyFileSync(source, dest);
        console.log(`   ✅ ${path.relative(this.rootDir, source)}`);
    }

    shouldExclude(filePath) {
        return this.excludePatterns.some(pattern => {
            if (pattern.startsWith('.')) {
                return filePath.startsWith(pattern) || filePath.includes(pattern);
            }
            return filePath === pattern || filePath.endsWith(pattern);
        });
    }

    async createPackage(version) {
        console.log('\n📦 Creating package...');

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const zipFileName = `${this.packageName}-v${version}-${timestamp}.zip`;
        const zipPath = path.join(this.distDir, '..', zipFileName);

        return new Promise((resolve, reject) => {
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', {
                zlib: { level: 9 }
            });

            output.on('close', () => {
                const fileSizeInMB = (archive.pointer() / 1024 / 1024).toFixed(2);
                console.log(`   ✅ Created: ${zipFileName}`);
                console.log(`   📊 Size: ${fileSizeInMB} MB`);
                console.log(`   📦 Files: ${archive.pointer()} bytes`);
                resolve();
            });

            archive.on('error', reject);
            archive.pipe(output);

            // Add all files from dist directory
            this.addFilesToArchive(archive, this.distDir, '');

            archive.finalize();
        });
    }

    addFilesToArchive(archive, sourceDir, basePath) {
        const files = fs.readdirSync(sourceDir);

        for (const file of files) {
            const fullPath = path.join(sourceDir, file);
            const relativePath = path.join(basePath, file);

            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()) {
                this.addFilesToArchive(archive, fullPath, relativePath);
            } else {
                archive.file(fullPath, { name: relativePath });
            }
        }
    }

    printStatistics() {
        console.log('\n📊 Package Statistics:');
        console.log(`   📁 Total files: ${this.countFiles(this.distDir)}`);
        console.log(`   📏 Package size: ${this.getPackageSize()} MB`);
        console.log(`   🌍 Languages: ${this.countLanguages()} locales`);
    }

    countFiles(dir) {
        let count = 0;
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            const stats = fs.statSync(fullPath);
            if (stats.isDirectory()) {
                count += this.countFiles(fullPath);
            } else {
                count++;
            }
        }
        return count;
    }

    getPackageSize() {
        // Implementation for getting package size
        return 'TBD';
    }

    countLanguages() {
        const localesDir = path.join(this.distDir, '_locales');
        if (!fs.existsSync(localesDir)) {
            return 0;
        }
        return fs.readdirSync(localesDir).length;
    }
}

// Run the packager
if (require.main === module) {
    const packager = new ExtensionPackager();
    packager.init().catch(console.error);
}

module.exports = ExtensionPackager;