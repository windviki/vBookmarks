#!/usr/bin/env node

/**
 * vBookmarks 智能翻译同步工具
 *
 * 功能：
 * - 以英文和中文为基准，检查所有语种的翻译完整性
 * - 自动翻译缺失的翻译条目
 * - 检测并翻译非目标语言的条目
 * - 生成详细的翻译报告
 *
 * 使用方法：
 *   node translation-sync-tool.js check     # 检查翻译状态
 *   node translation-sync-tool.js sync      # 同步所有翻译
 *   node translation-sync-tool.js report    # 生成详细报告
 *   node translation-sync-tool.js dry-run   # 预览模式（不实际修改）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TranslationSyncTool {
    constructor() {
        this.rootDir = process.cwd();
        this.localesDir = path.join(this.rootDir, '_locales');
        this.baseLanguages = ['en', 'zh']; // 基准语言

        // 所有支持的语言
        this.allLanguages = [
            'en', 'zh', 'zh_TW', 'zh_HK', 'ja', 'ko', 'fr', 'de', 'es', 'it',
            'pt', 'ru', 'ar', 'hi', 'bn', 'th', 'vi', 'id', 'nl', 'pl', 'sv',
            'da', 'no', 'fi', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'et', 'lv',
            'lt', 'sl', 'uk', 'el', 'he', 'fa', 'tr', 'sv', 'nl', 'fi', 'da'
        ];

        // 需要忽略的key（非用户界面相关）
        this.ignoreKeys = [
            'description', 'example'
        ];

        // 语言检测映射（用于检测非目标语言）
        this.languagePatterns = {
            'zh': /[\u4e00-\u9fff]/, // 中文
            'ja': /[\u3040-\u309f\u30a0-\u30ff]/, // 日文
            'ko': /[\uac00-\ud7af]/, // 韩文
            'ar': /[\u0600-\u06ff]/, // 阿拉伯文
            'ru': /[\u0400-\u04ff]/, // 俄文
            'th': /[\u0e00-\u0e7f]/, // 泰文
            'hi': /[\u0900-\u097f]/, // 印地文
            'el': /[\u0370-\u03ff]/, // 希腊文
            'he': /[\u0590-\u05ff]/, // 希伯来文
            'fa': /[\u0600-\u06ff]/, // 波斯文
            'uk': /[\u0400-\u04ff]/, // 乌克兰文
            'bn': /[\u0980-\u09ff]/, // 孟加拉文
        };

        this.report = {
            totalKeys: 0,
            languages: {},
            missingTranslations: {},
            incorrectTranslations: {},
            timestamp: new Date().toISOString()
        };

        this.dryRun = false;
    }

    async run() {
        const command = process.argv[2] || 'check';
        const args = process.argv.slice(3);

        console.log('🌍 vBookmarks 智能翻译同步工具\n');

        switch (command) {
            case 'check':
                await this.checkTranslations();
                break;
            case 'sync':
                await this.syncTranslations();
                break;
            case 'report':
                await this.generateReport();
                break;
            case 'dry-run':
                this.dryRun = true;
                await this.syncTranslations();
                break;
            default:
                this.showHelp();
        }
    }

    async checkTranslations() {
        console.log('🔍 检查翻译状态...\n');

        // 获取基准语言的所有key
        const baseKeys = new Set();
        const baseMessages = {};

        for (const lang of this.baseLanguages) {
            const messages = this.loadMessages(lang);
            baseMessages[lang] = messages;
            Object.keys(messages).forEach(key => baseKeys.add(key));
        }

        this.report.totalKeys = baseKeys.size;

        // 检查所有语言
        const languages = this.getAvailableLanguages();

        for (const lang of languages) {
            if (this.baseLanguages.includes(lang)) continue;

            console.log(`🔍 检查 ${lang.toUpperCase()}...`);

            const langMessages = this.loadMessages(lang);
            const langReport = {
                totalKeys: baseKeys.size,
                missingKeys: [],
                incorrectKeys: [],
                correctKeys: 0
            };

            // 检查缺失的key
            for (const key of baseKeys) {
                if (!langMessages[key]) {
                    langReport.missingKeys.push(key);
                } else {
                    // 检查是否使用了正确的语言
                    if (this.isIncorrectLanguage(langMessages[key].message, lang)) {
                        langReport.incorrectKeys.push(key);
                    } else {
                        langReport.correctKeys++;
                    }
                }
            }

            this.report.languages[lang] = langReport;

            if (langReport.missingKeys.length > 0) {
                this.report.missingTranslations[lang] = langReport.missingKeys;
            }

            if (langReport.incorrectKeys.length > 0) {
                this.report.incorrectTranslations[lang] = langReport.incorrectKeys;
            }

            const percentage = ((langReport.correctKeys / baseKeys.size) * 100).toFixed(1);
            console.log(`   ✅ 正确: ${langReport.correctKeys}, ❌ 缺失: ${langReport.missingKeys.length}, ⚠️ 错误语言: ${langReport.incorrectKeys.length} (${percentage}%)`);
        }

        this.printSummary();
        this.saveReport();
    }

    async syncTranslations() {
        console.log(this.dryRun ? '🔍 预览模式（不会实际修改文件）...\n' : '🔄 开始同步翻译...\n');

        // 获取基准语言的所有key和消息
        const baseMessages = {};
        const allBaseKeys = new Set();

        for (const lang of this.baseLanguages) {
            const messages = this.loadMessages(lang);
            baseMessages[lang] = messages;
            Object.keys(messages).forEach(key => allBaseKeys.add(key));
        }

        console.log(`📊 基准语言总key数: ${allBaseKeys.size}`);

        // 处理每个语言
        const languages = this.getAvailableLanguages();
        let totalTranslated = 0;

        for (const lang of languages) {
            if (this.baseLanguages.includes(lang)) continue;

            console.log(`\n🔄 处理 ${lang.toUpperCase()}...`);

            const langMessages = this.loadMessages(lang);
            let translatedCount = 0;

            // 处理每个基准key
            for (const key of allBaseKeys) {
                let needsTranslation = false;
                let sourceText = '';
                let sourceLang = '';

                // 确定源文本和语言
                if (baseMessages.en[key] && baseMessages.en[key].message) {
                    sourceText = baseMessages.en[key].message;
                    sourceLang = 'en';
                } else if (baseMessages.zh[key] && baseMessages.zh[key].message) {
                    sourceText = baseMessages.zh[key].message;
                    sourceLang = 'zh';
                }

                if (!sourceText) continue;

                // 检查是否需要翻译
                if (!langMessages[key]) {
                    needsTranslation = true;
                    console.log(`   🔍 缺失 key: ${key}`);
                } else if (this.isIncorrectLanguage(langMessages[key].message, lang)) {
                    needsTranslation = true;
                    console.log(`   ⚠️ 语言错误: ${key} (当前: "${langMessages[key].message}")`);
                }

                if (needsTranslation) {
                    console.log(`   🤖 正在翻译: "${sourceText}" (${sourceLang} → ${lang})`);

                    if (!this.dryRun) {
                        try {
                            const translatedText = await this.translateText(sourceText, sourceLang, lang);

                            // 确保翻译结果存在
                            if (translatedText && translatedText.trim()) {
                                langMessages[key] = {
                                    message: translatedText,
                                    description: baseMessages[sourceLang][key]?.description || ''
                                };

                                // 添加placeholders
                                if (baseMessages[sourceLang][key]?.placeholders) {
                                    langMessages[key].placeholders = baseMessages[sourceLang][key].placeholders;
                                }

                                console.log(`   ✅ 翻译结果: "${translatedText}"`);
                                translatedCount++;
                            } else {
                                console.log(`   ❌ 翻译失败，结果为空`);
                            }
                        } catch (error) {
                            console.log(`   ❌ 翻译失败: ${error.message}`);
                        }
                    } else {
                        console.log(`   [预览] 将会翻译 "${sourceText}" 到 ${lang}`);
                        translatedCount++;
                    }
                }
            }

            if (translatedCount > 0 && !this.dryRun) {
                this.saveMessages(lang, langMessages);
                console.log(`   💾 保存了 ${translatedCount} 个翻译`);
            }

            totalTranslated += translatedCount;
        }

        console.log(`\n${this.dryRun ? '🔍 预览完成' : '🎉 同步完成'}! 总共处理了 ${totalTranslated} 个翻译`);

        if (this.dryRun) {
            console.log('\n💡 这是预览模式，运行 "node translation-sync-tool.js sync" 来实际应用更改');
        }
    }

    async generateReport() {
        console.log('📊 生成详细翻译报告...\n');

        await this.checkTranslations();

        console.log('\n📋 详细报告:');
        console.log('='.repeat(60));

        for (const [lang, data] of Object.entries(this.report.languages)) {
            console.log(`\n🌍 ${lang.toUpperCase()}:`);
            console.log(`   总key数: ${data.totalKeys}`);
            console.log(`   正确翻译: ${data.correctKeys}`);
            console.log(`   缺失翻译: ${data.missingKeys.length}`);
            console.log(`   错误语言: ${data.incorrectKeys.length}`);
            console.log(`   完成度: ${((data.correctKeys / data.totalKeys) * 100).toFixed(1)}%`);

            if (data.missingKeys.length > 0) {
                console.log(`   缺失的key:`);
                data.missingKeys.slice(0, 5).forEach(key => {
                    console.log(`     - ${key}`);
                });
                if (data.missingKeys.length > 5) {
                    console.log(`     ... 还有 ${data.missingKeys.length - 5} 个`);
                }
            }

            if (data.incorrectKeys.length > 0) {
                console.log(`   错误语言的key:`);
                data.incorrectKeys.slice(0, 3).forEach(key => {
                    console.log(`     - ${key}`);
                });
                if (data.incorrectKeys.length > 3) {
                    console.log(`     ... 还有 ${data.incorrectKeys.length - 3} 个`);
                }
            }
        }

        console.log('\n📊 统计概览:');
        const totalLanguages = Object.keys(this.report.languages).length;
        const completeLanguages = Object.values(this.report.languages).filter(l => l.missingKeys.length === 0 && l.incorrectKeys.length === 0).length;
        const languagesWithIssues = totalLanguages - completeLanguages;

        console.log(`   总语言数: ${totalLanguages}`);
        console.log(`   完整翻译: ${completeLanguages}`);
        console.log(`   有问题: ${languagesWithIssues}`);
        console.log(`   总message入口: ${this.report.totalKeys}`);
    }

    // 检查文本是否使用了正确的语言
    isIncorrectLanguage(text, targetLang) {
        if (!text || typeof text !== 'string') return false;

        // 去除HTML标签和特殊字符
        const cleanText = text.replace(/<[^>]*>/g, '').replace(/\$[^$]+\$/g, '').trim();

        // 如果是英文，检查是否包含其他语言的字符
        if (targetLang === 'en') {
            // 检查是否包含非英文字符
            const nonEnglishPattern = /[^\x00-\x7F]/;
            if (nonEnglishPattern.test(cleanText)) {
                // 检查是否包含特定语言的字符
                for (const [lang, pattern] of Object.entries(this.languagePatterns)) {
                    if (lang !== 'en' && pattern.test(cleanText)) {
                        return true;
                    }
                }
            }
            return false;
        }

        // 对于其他语言，检查是否匹配对应的语言模式
        const pattern = this.languagePatterns[targetLang];
        if (pattern) {
            return !pattern.test(cleanText) && cleanText.length > 0;
        }

        return false;
    }

    // 翻译文本（这里需要集成实际的翻译API）
    async translateText(text, fromLang, toLang) {
        // 由于这是演示版本，我们使用简单的翻译映射
        // 在实际使用中，这里应该调用Google Translate API或其他翻译服务

        // 模拟翻译延迟
        await new Promise(resolve => setTimeout(resolve, 100));

        // 简单的翻译示例（实际项目中应该使用专业翻译API）
        const translations = this.getSampleTranslations(text, fromLang, toLang);

        if (translations) {
            return translations;
        }

        // 如果没有找到预定义翻译，返回原文加上标记
        return `[${toLang.toUpperCase()}] ${text}`;
    }

    // 获取示例翻译（用于演示）
    getSampleTranslations(text, fromLang, toLang) {
        const commonTranslations = {
            'Advanced Options': {
                'zh': '高级选项',
                'ja': '詳細設定',
                'ko': '고급 옵션',
                'fr': 'Options avancées',
                'de': 'Erweiterte Optionen',
                'es': 'Opciones avanzadas',
                'it': 'Opzioni avanzate',
                'pt': 'Opções avançadas',
                'ru': 'Расширенные настройки',
                'ar': 'خيارات متقدمة'
            },
            'Add Sub Folder': {
                'zh': '添加子文件夹',
                'ja': 'サブフォルダを追加',
                'ko': '하위 폴더 추가',
                'fr': 'Ajouter un sous-dossier',
                'de': 'Unterordner hinzufügen',
                'es': 'Agregar subcarpeta',
                'it': 'Aggiungi sottocartella',
                'pt': 'Adicionar subpasta',
                'ru': 'Добавить подпапку'
            },
            'Accessibility': {
                'zh': '辅助功能',
                'ja': 'アクセシビリティ',
                'ko': '접근성',
                'fr': 'Accessibilité',
                'de': 'Barrierefreiheit',
                'es': 'Accesibilidad',
                'it': 'Accessibilità',
                'pt': 'Acessibilidade',
                'ru': 'Специальные возможности'
            }
        };

        return translations[text]?.[toLang];
    }

    loadMessages(language) {
        const filePath = path.join(this.localesDir, language, 'messages.json');
        if (!fs.existsSync(filePath)) {
            return {};
        }

        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`❌ 加载 ${language} 翻译文件失败:`, error.message);
            return {};
        }
    }

    saveMessages(language, messages) {
        const langDir = path.join(this.localesDir, language);
        if (!fs.existsSync(langDir)) {
            fs.mkdirSync(langDir, { recursive: true });
        }

        const filePath = path.join(langDir, 'messages.json');
        fs.writeFileSync(filePath, JSON.stringify(messages, null, 2) + '\n');
    }

    getAvailableLanguages() {
        if (!fs.existsSync(this.localesDir)) {
            return [];
        }

        return fs.readdirSync(this.localesDir).filter(dir => {
            const stats = fs.statSync(path.join(this.localesDir, dir));
            return stats.isDirectory() && this.allLanguages.includes(dir);
        });
    }

    printSummary() {
        console.log('\n📊 翻译状态概览:');
        console.log('='.repeat(50));
        console.log(`📏 总message入口: ${this.report.totalKeys}`);
        console.log(`🌍 检查的语言数: ${Object.keys(this.report.languages).length}`);

        let totalMissing = 0;
        let totalIncorrect = 0;
        let completeLanguages = 0;

        for (const [lang, data] of Object.entries(this.report.languages)) {
            totalMissing += data.missingKeys.length;
            totalIncorrect += data.incorrectKeys.length;

            if (data.missingKeys.length === 0 && data.incorrectKeys.length === 0) {
                completeLanguages++;
            }
        }

        console.log(`🔴 缺失翻译: ${totalMissing}`);
        console.log(`⚠️ 错误语言: ${totalIncorrect}`);
        console.log(`🟢 完整语言: ${completeLanguages}/${Object.keys(this.report.languages).length}`);

        if (totalMissing > 0 || totalIncorrect > 0) {
            console.log('\n💡 运行以下命令修复:');
            console.log('   node translation-sync-tool.js sync      # 同步所有翻译');
            console.log('   node translation-sync-tool.js dry-run   # 预览模式');
        } else {
            console.log('\n🎉 所有翻译都是完整的!');
        }
    }

    saveReport() {
        const reportPath = path.join(this.rootDir, 'translation-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(this.report, null, 2) + '\n');
        console.log(`\n📄 详细报告已保存到: translation-report.json`);
    }

    showHelp() {
        console.log('🌍 vBookmarks 智能翻译同步工具');
        console.log('');
        console.log('使用方法:');
        console.log('  node translation-sync-tool.js <command>');
        console.log('');
        console.log('命令:');
        console.log('  check      - 检查翻译状态');
        console.log('  sync       - 同步所有翻译');
        console.log('  report     - 生成详细报告');
        console.log('  dry-run    - 预览模式（不实际修改）');
        console.log('');
        console.log('示例:');
        console.log('  node translation-sync-tool.js check');
        console.log('  node translation-sync-tool.js sync');
        console.log('  node translation-sync-tool.js dry-run');
    }
}

// 运行工具
if (import.meta.url === `file://${process.argv[1]}`) {
    const tool = new TranslationSyncTool();
    tool.run().catch(console.error);
}

export default TranslationSyncTool;