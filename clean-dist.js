#!/usr/bin/env node

/**
 * Clean Distribution Directory Script
 *
 * This script cleans up the distribution directory and temporary files.
 */

const fs = require('fs');
const path = require('path');

class Cleaner {
    constructor() {
        this.rootDir = process.cwd();
        this.distDir = path.join(this.rootDir, 'dist');
        this.tempFiles = [
            'translation-template.json',
            '*.tmp',
            '*.temp'
        ];
    }

    async clean() {
        console.log('🧹 Cleaning distribution files...\n');

        // Clean dist directory
        if (fs.existsSync(this.distDir)) {
            fs.rmSync(this.distDir, { recursive: true, force: true });
            console.log('🗑️  Removed dist/ directory');
        }

        // Clean temporary files
        for (const pattern of this.tempFiles) {
            this.removeFiles(pattern);
        }

        // Clean package files
        this.removeFiles('*.zip');
        this.removeFiles('*.crx');

        console.log('\n✅ Cleaning completed!');
    }

    removeFiles(pattern) {
        const glob = require('glob');
        try {
            const files = glob.sync(path.join(this.rootDir, pattern));
            for (const file of files) {
                fs.unlinkSync(file);
                console.log(`🗑️  Removed ${path.basename(file)}`);
            }
        } catch (error) {
            // glob module not available, simple pattern matching
            this.removeFilesSimple(pattern);
        }
    }

    removeFilesSimple(pattern) {
        const files = fs.readdirSync(this.rootDir);
        for (const file of files) {
            if (this.matchesPattern(file, pattern)) {
                try {
                    fs.unlinkSync(path.join(this.rootDir, file));
                    console.log(`🗑️  Removed ${file}`);
                } catch (error) {
                    console.warn(`⚠️  Could not remove ${file}: ${error.message}`);
                }
            }
        }
    }

    matchesPattern(filename, pattern) {
        if (pattern.startsWith('*.')) {
            const extension = pattern.substring(1);
            return filename.endsWith(extension);
        }
        return filename === pattern;
    }
}

// Run the cleaner
if (require.main === module) {
    const cleaner = new Cleaner();
    cleaner.clean().catch(console.error);
}

module.exports = Cleaner;