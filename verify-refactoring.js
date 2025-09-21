#!/usr/bin/env node

/**
 * vBookmarks 重构验证工具
 *
 * 功能：
 * - 验证所有模块文件是否存在
 * - 检查import/export路径是否正确
 * - 验证manifest.json配置
 * - 检查文件引用完整性
 * - 生成验证报告
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class RefactoringValidator {
    constructor() {
        this.rootDir = process.cwd();
        this.srcDir = path.join(this.rootDir, 'src');

        // 定义所有必需的模块文件
        this.requiredModules = {
            // 核心应用模块
            core: [
                'app/VBookmarksApp.js',
                'app-initializer.js',
                'render-engine.js',
                'ui-manager.js'
            ],

            // 组件模块
            components: [
                'ui/dialog-system.js',
                'ui/tooltip-manager.js',
                'ui/context-menu.js',
                'ui/keyboard-navigation.js',
                'ui/drag-drop-manager.js',
                'editors/bookmark-editor.js'
            ],

            // 工具模块
            utils: [
                'logger.js',
                'bookmark-utils.js',
                'html-generator.js',
                'separator-manager.js',
                'event-system/event-system.js'
            ],

            // 样式文件
            styles: [
                'base/variables.css',
                'base/reset.css',
                'themes/default.css',
                'components/dialog.css',
                'components/tooltip.css',
                'components/search.css',
                'components/bookmark-tree.css',
                'components/drag-drop.css',
                'components/keyboard-navigation.css'
            ],

            // 入口文件
            entry: [
                'popup.js',
                'popup.html',
                'options.js',
                'options.html',
                'background.js',
                'bookmark-editor.html',
                'advanced-options.html'
            ]
        };

        // 定义关键文件之间的依赖关系
        this.dependencies = {
            'src/entry/popup.js': [
                'src/app/VBookmarksApp.js',
                'src/core/app-initializer.js',
                'src/components/ui/dialog-system.js',
                'src/utils/logger.js'
            ],

            'src/app/VBookmarksApp.js': [
                'src/core/event-system/event-system.js',
                'src/utils/logger.js'
            ],

            'src/core/app-initializer.js': [
                'src/utils/logger.js'
            ],

            'src/components/ui/dialog-system.js': [
                'src/utils/logger.js'
            ],

            'src/utils/html-generator.js': [
                'src/utils/logger.js',
                'src/utils/bookmark-utils.js'
            ]
        };

        this.report = {
            totalFiles: 0,
            existingFiles: 0,
            missingFiles: [],
            dependencyIssues: [],
            manifestIssues: [],
            suggestion: []
        };
    }

    async run() {
        console.log('🔍 vBookmarks 重构验证工具\n');

        // 验证文件存在性
        this.verifyFileExistence();

        // 验证依赖关系
        this.verifyDependencies();

        // 验证manifest.json
        this.verifyManifest();

        // 验证文件引用
        this.verifyFileReferences();

        // 生成报告
        this.generateReport();

        // 输出结果
        this.printResults();

        // 保存详细报告
        this.saveReport();

        return this.report.missingFiles.length === 0 &&
               this.report.dependencyIssues.length === 0 &&
               this.report.manifestIssues.length === 0;
    }

    verifyFileExistence() {
        console.log('📁 验证文件存在性...\n');

        for (const [category, files] of Object.entries(this.requiredModules)) {
            console.log(`🔍 检查 ${category} 模块...`);

            for (const file of files) {
                this.report.totalFiles++;
                const filePath = path.join(this.srcDir, file);

                if (fs.existsSync(filePath)) {
                    this.report.existingFiles++;
                    console.log(`   ✅ ${file}`);
                } else {
                    this.report.missingFiles.push({
                        category,
                        file,
                        path: filePath
                    });
                    console.log(`   ❌ ${file} (缺失)`);
                }
            }
        }

        console.log('');
    }

    verifyDependencies() {
        console.log('🔗 验证模块依赖关系...\n');

        for (const [sourceFile, dependencies] of Object.entries(this.dependencies)) {
            const sourcePath = path.join(this.rootDir, sourceFile);

            if (!fs.existsSync(sourcePath)) {
                this.report.dependencyIssues.push({
                    type: 'missing_source',
                    file: sourceFile,
                    message: `源文件不存在: ${sourceFile}`
                });
                continue;
            }

            // 读取源文件内容
            const content = fs.readFileSync(sourcePath, 'utf8');

            for (const depFile of dependencies) {
                const depPath = path.join(this.rootDir, depFile);

                if (!fs.existsSync(depPath)) {
                    this.report.dependencyIssues.push({
                        type: 'missing_dependency',
                        source: sourceFile,
                        dependency: depFile,
                        message: `依赖文件不存在: ${depFile}`
                    });
                    continue;
                }

                // 检查import语句是否正确
                const relativePath = this.getRelativeImportPath(sourceFile, depFile);
                const expectedImport = `from '${relativePath}'`;
                const expectedImport2 = `from "${relativePath}"`;

                if (!content.includes(expectedImport) && !content.includes(expectedImport2)) {
                    this.report.dependencyIssues.push({
                        type: 'import_missing',
                        source: sourceFile,
                        dependency: depFile,
                        expectedImport,
                        message: `可能缺少import语句: ${expectedImport}`
                    });
                }
            }
        }

        console.log(`📊 发现 ${this.report.dependencyIssues.length} 个依赖问题\n`);
    }

    verifyManifest() {
        console.log('📋 验证 manifest.json...\n');

        const manifestPath = path.join(this.rootDir, 'manifest.json');

        if (!fs.existsSync(manifestPath)) {
            this.report.manifestIssues.push({
                type: 'missing_manifest',
                message: 'manifest.json 文件不存在'
            });
            return;
        }

        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

            // 检查必需字段
            const requiredFields = ['name', 'version', 'manifest_version', 'action'];
            for (const field of requiredFields) {
                if (!manifest[field]) {
                    this.report.manifestIssues.push({
                        type: 'missing_field',
                        field,
                        message: `缺少必需字段: ${field}`
                    });
                }
            }

            // 检查popup配置
            if (manifest.action && manifest.action.default_popup) {
                const popupPath = path.join(this.rootDir, manifest.action.default_popup);
                if (!fs.existsSync(popupPath)) {
                    this.report.manifestIssues.push({
                        type: 'missing_popup',
                        path: manifest.action.default_popup,
                        message: `popup文件不存在: ${manifest.action.default_popup}`
                    });
                }
            }

            // 检查background配置
            if (manifest.background && manifest.background.service_worker) {
                const bgPath = path.join(this.rootDir, manifest.background.service_worker);
                if (!fs.existsSync(bgPath)) {
                    this.report.manifestIssues.push({
                        type: 'missing_background',
                        path: manifest.background.service_worker,
                        message: `background脚本不存在: ${manifest.background.service_worker}`
                    });
                }
            }

            // 检查权限配置
            const requiredPermissions = ['bookmarks', 'tabs', 'storage'];
            if (manifest.permissions) {
                for (const perm of requiredPermissions) {
                    if (!manifest.permissions.includes(perm)) {
                        this.report.manifestIssues.push({
                            type: 'missing_permission',
                            permission: perm,
                            message: `缺少必需权限: ${perm}`
                        });
                    }
                }
            }

        } catch (error) {
            this.report.manifestIssues.push({
                type: 'parse_error',
                message: `manifest.json 解析失败: ${error.message}`
            });
        }

        console.log(`📊 发现 ${this.report.manifestIssues.length} 个manifest问题\n`);
    }

    verifyFileReferences() {
        console.log('🔍 验证文件引用...\n');

        // 检查popup.html中的引用
        const popupHtmlPath = path.join(this.srcDir, 'entry', 'popup.html');
        if (fs.existsSync(popupHtmlPath)) {
            const popupContent = fs.readFileSync(popupHtmlPath, 'utf8');

            // 检查CSS引用
            const cssRefs = [
                '../styles/themes/default.css',
                '../styles/components/dialog.css',
                '../styles/components/search.css',
                '../styles/components/bookmark-tree.css',
                '../styles/components/tooltip.css',
                '../styles/components/drag-drop.css',
                '../styles/components/keyboard-navigation.css'
            ];

            for (const cssRef of cssRefs) {
                if (!popupContent.includes(cssRef)) {
                    this.report.suggestion.push({
                        type: 'missing_css_ref',
                        file: 'popup.html',
                        ref: cssRef,
                        message: `可能缺少CSS引用: ${cssRef}`
                    });
                }
            }

            // 检查JS引用
            const jsRef = './popup.js';
            if (!popupContent.includes(jsRef)) {
                this.report.suggestion.push({
                    type: 'missing_js_ref',
                    file: 'popup.html',
                    ref: jsRef,
                    message: `可能缺少JS引用: ${jsRef}`
                });
            }
        }

        console.log(`📊 发现 ${this.report.suggestion.length} 个建议\n`);
    }

    getRelativeImportPath(fromFile, toFile) {
        const fromDir = path.dirname(fromFile);
        const toDir = path.dirname(toFile);
        const relativePath = path.relative(fromDir, toFile);

        // 移除.js扩展名
        return relativePath.replace(/\.js$/, '');
    }

    generateReport() {
        this.report.summary = {
            totalFiles: this.report.totalFiles,
            existingFiles: this.report.existingFiles,
            missingFiles: this.report.missingFiles.length,
            dependencyIssues: this.report.dependencyIssues.length,
            manifestIssues: this.report.manifestIssues.length,
            suggestions: this.report.suggestion.length,
            success: this.report.missingFiles.length === 0 &&
                    this.report.dependencyIssues.length === 0 &&
                    this.report.manifestIssues.length === 0
        };

        this.report.timestamp = new Date().toISOString();
    }

    printResults() {
        console.log('📊 验证结果概览:');
        console.log('='.repeat(50));
        console.log(`📁 总文件数: ${this.report.summary.totalFiles}`);
        console.log(`✅ 现有文件: ${this.report.summary.existingFiles}`);
        console.log(`❌ 缺失文件: ${this.report.summary.missingFiles}`);
        console.log(`🔗 依赖问题: ${this.report.summary.dependencyIssues}`);
        console.log(`📋 Manifest问题: ${this.report.summary.manifestIssues}`);
        console.log(`💡 建议: ${this.report.summary.suggestions}`);

        const successRate = ((this.report.summary.existingFiles / this.report.summary.totalFiles) * 100).toFixed(1);
        console.log(`📈 完成度: ${successRate}%`);

        if (this.report.summary.success) {
            console.log('\n🎉 所有验证都通过了！重构成功完成！');
        } else {
            console.log('\n⚠️ 发现问题需要修复：');

            if (this.report.missingFiles.length > 0) {
                console.log('\n📁 缺失的文件:');
                this.report.missingFiles.forEach(issue => {
                    console.log(`   - ${issue.file} (${issue.category})`);
                });
            }

            if (this.report.dependencyIssues.length > 0) {
                console.log('\n🔗 依赖问题:');
                this.report.dependencyIssues.forEach(issue => {
                    console.log(`   - ${issue.message}`);
                });
            }

            if (this.report.manifestIssues.length > 0) {
                console.log('\n📋 Manifest问题:');
                this.report.manifestIssues.forEach(issue => {
                    console.log(`   - ${issue.message}`);
                });
            }
        }

        console.log('');
    }

    saveReport() {
        const reportPath = path.join(this.rootDir, 'refactoring-validation-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(this.report, null, 2) + '\n');
        console.log(`📄 详细验证报告已保存到: refactoring-validation-report.json`);
    }
}

// 运行验证工具
if (import.meta.url === `file://${process.argv[1]}`) {
    const validator = new RefactoringValidator();
    validator.run().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('❌ 验证工具运行失败:', error);
        process.exit(1);
    });
}

export default RefactoringValidator;