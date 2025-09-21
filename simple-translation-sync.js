#!/usr/bin/env node

/**
 * vBookmarks 简化版翻译同步工具
 * 以英文和中文为基准，检查和同步所有翻译
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SimpleTranslationSync {
    constructor() {
        this.localesDir = path.join(__dirname, '_locales');
        this.baseLanguages = ['en', 'zh'];

        // 获取所有语言目录
        this.allLanguages = fs.readdirSync(this.localesDir)
            .filter(dir => {
                const dirPath = path.join(this.localesDir, dir);
                return fs.statSync(dirPath).isDirectory() &&
                       fs.existsSync(path.join(dirPath, 'messages.json'));
            });

        console.log(`发现的语言: ${this.allLanguages.join(', ')}`);
    }

    checkTranslations() {
        console.log('\n🔍 检查翻译状态...\n');

        // 加载基准语言
        const baseMessages = {};
        const allBaseKeys = new Set();

        for (const lang of this.baseLanguages) {
            const messages = this.loadMessages(lang);
            baseMessages[lang] = messages;
            Object.keys(messages).forEach(key => allBaseKeys.add(key));
        }

        console.log(`基准语言总key数: ${allBaseKeys.size}`);

        const report = {
            totalKeys: allBaseKeys.size,
            languages: {},
            missingKeys: {},
            incorrectKeys: {}
        };

        // 检查每个语言
        for (const lang of this.allLanguages) {
            if (this.baseLanguages.includes(lang)) continue;

            console.log(`\n🔍 检查 ${lang.toUpperCase()}...`);

            const langMessages = this.loadMessages(lang);
            const missingKeys = [];
            const incorrectKeys = [];
            let correctKeys = 0;

            for (const key of allBaseKeys) {
                if (!langMessages[key]) {
                    missingKeys.push(key);
                } else {
                    // 检查是否使用了正确的语言
                    if (this.isIncorrectLanguage(langMessages[key].message, lang)) {
                        incorrectKeys.push(key);
                    } else {
                        correctKeys++;
                    }
                }
            }

            const percentage = ((correctKeys / allBaseKeys.size) * 100).toFixed(1);
            console.log(`   ✅ 正确: ${correctKeys}, ❌ 缺失: ${missingKeys.length}, ⚠️ 错误语言: ${incorrectKeys.length} (${percentage}%)`);

            report.languages[lang] = {
                correctKeys,
                missingKeys: missingKeys.length,
                incorrectKeys: incorrectKeys.length,
                percentage
            };

            if (missingKeys.length > 0) {
                report.missingKeys[lang] = missingKeys;
            }

            if (incorrectKeys.length > 0) {
                report.incorrectKeys[lang] = incorrectKeys;
            }
        }

        this.printReport(report);
        this.saveReport(report);

        return report;
    }

    loadMessages(language) {
        const filePath = path.join(this.localesDir, language, 'messages.json');
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            return JSON.parse(content);
        } catch (error) {
            console.error(`❌ 加载 ${language} 失败:`, error.message);
            return {};
        }
    }

    isIncorrectLanguage(text, targetLang) {
        if (!text || typeof text !== 'string') return false;

        const cleanText = text.replace(/<[^>]*>/g, '').replace(/\$[^$]+\$/g, '').trim();

        if (targetLang === 'en') {
            // 检查是否包含非英文字符
            const nonEnglishPattern = /[^\x00-\x7F]/;
            return nonEnglishPattern.test(cleanText);
        }

        // 其他语言检查
        const patterns = {
            'zh': /[\u4e00-\u9fff]/,
            'ja': /[\u3040-\u309f\u30a0-\u30ff]/,
            'ko': /[\uac00-\ud7af]/,
            'ar': /[\u0600-\u06ff]/,
            'ru': /[\u0400-\u04ff]/,
            'th': /[\u0e00-\u0e7f]/,
            'hi': /[\u0900-\u097f]/,
            'el': /[\u0370-\u03ff]/,
            'he': /[\u0590-\u05ff]/,
            'fa': /[\u0600-\u06ff]/,
        };

        const pattern = patterns[targetLang];
        if (pattern) {
            return !pattern.test(cleanText) && cleanText.length > 0;
        }

        return false;
    }

    printReport(report) {
        console.log('\n📊 翻译状态报告:');
        console.log('='.repeat(50));
        console.log(`📏 总message入口: ${report.totalKeys}`);
        console.log(`🌍 检查语言数: ${Object.keys(report.languages).length}`);

        let totalMissing = 0;
        let totalIncorrect = 0;
        let completeLanguages = 0;

        for (const [lang, data] of Object.entries(report.languages)) {
            totalMissing += data.missingKeys;
            totalIncorrect += data.incorrectKeys;

            if (data.missingKeys === 0 && data.incorrectKeys === 0) {
                completeLanguages++;
            }

            const status = data.missingKeys === 0 && data.incorrectKeys === 0 ? '🟢' : '🔴';
            console.log(`${status} ${lang.toUpperCase()}: ${data.percentage}% (缺失: ${data.missingKeys}, 错误: ${data.incorrectKeys})`);
        }

        console.log('\n📈 统计:');
        console.log(`🟢 完整语言: ${completeLanguages}/${Object.keys(report.languages).length}`);
        console.log(`🔴 总缺失翻译: ${totalMissing}`);
        console.log(`⚠️ 总错误语言: ${totalIncorrect}`);

        if (totalMissing > 0 || totalIncorrect > 0) {
            console.log('\n💡 需要处理的翻译问题:');
            for (const [lang, data] of Object.entries(report.languages)) {
                if (data.missingKeys > 0 || data.incorrectKeys > 0) {
                    console.log(`   ${lang.toUpperCase()}: ${data.missingKeys} 缺失, ${data.incorrectKeys} 错误语言`);
                }
            }
        } else {
            console.log('\n🎉 所有翻译都是完整的!');
        }
    }

    saveReport(report) {
        const reportPath = path.join(__dirname, 'translation-status-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
        console.log(`\n📄 详细报告已保存到: translation-status-report.json`);
    }
}

// 运行检查
const sync = new SimpleTranslationSync();
sync.checkTranslations();