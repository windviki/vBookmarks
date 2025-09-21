#!/usr/bin/env node

/**
 * vBookmarks 翻译修正工具
 *
 * 功能：
 * - 修正错误添加的[xx]标记条目
 * - 恢复被错误覆盖的正确翻译
 * - 保护专有名词不被翻译
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TranslationFixTool {
    constructor() {
        this.localesDir = path.join(__dirname, '_locales');
        this.baseLanguages = ['en', 'zh'];

        // 永不翻译的key及其正确值
        this.protectedKeys = {
            'extName': 'vBookmarks',
            'url': 'URL',
            'donationGo': 'OK',
            'noTitle': '(no title)',
            'customStyles': 'Customstyles'
        };

        // 特定语言的正确翻译
        this.correctTranslations = {
            'ja': {
                'delete': '削除',
                'deleteEllipsis': '削除...',
                'edit': '編集...',
                'general': '一般',
                'ignore': '無視',
                'name': '名前',
                'optionZoom': 'ズーム',
                'save': '保存',
                'optionSyncRefreshInterval': '更新間隔',
                'optionSyncRefreshIntervalSeconds': '秒',
                'toolbarSettings': '設定'
            }
        };

        // 获取所有语言目录
        this.allLanguages = fs.readdirSync(this.localesDir)
            .filter(dir => {
                const dirPath = path.join(this.localesDir, dir);
                return fs.statSync(dirPath).isDirectory() &&
                       fs.existsSync(path.join(dirPath, 'messages.json'));
            });

        console.log(`发现的语言: ${this.allLanguages.join(', ')}`);
    }

    fixTranslations() {
        console.log('\n🔧 开始修正翻译错误...\n');

        let totalFixed = 0;
        let languagesFixed = 0;

        for (const lang of this.allLanguages) {
            if (this.baseLanguages.includes(lang)) continue;

            console.log(`🔧 修正 ${lang.toUpperCase()}...`);

            const messages = this.loadMessages(lang);
            let fixedCount = 0;

            // 修正被保护的key
            for (const [key, correctValue] of Object.entries(this.protectedKeys)) {
                if (messages[key]) {
                    const currentValue = messages[key].message;

                    // 如果包含[XX]标记，修正为正确的值
                    if (currentValue && currentValue.includes(`[${lang.toUpperCase()}]`)) {
                        console.log(`   ✏️ 修正 ${key}: "${currentValue}" → "${correctValue}"`);
                        messages[key].message = correctValue;
                        fixedCount++;
                    }
                    // 如果值不正确，也进行修正
                    else if (currentValue !== correctValue && key === 'extName') {
                        console.log(`   ✏️ 修正 ${key}: "${currentValue}" → "${correctValue}"`);
                        messages[key].message = correctValue;
                        fixedCount++;
                    }
                }
            }

            // 修正特定语言的翻译
            if (this.correctTranslations[lang]) {
                for (const [key, correctValue] of Object.entries(this.correctTranslations[lang])) {
                    if (messages[key]) {
                        const currentValue = messages[key].message;

                        // 如果包含[XX]标记，修正为正确的翻译
                        if (currentValue && currentValue.includes(`[${lang.toUpperCase()}]`)) {
                            console.log(`   ✏️ 修正 ${key}: "${currentValue}" → "${correctValue}"`);
                            messages[key].message = correctValue;
                            fixedCount++;
                        }
                    }
                }
            }

            // 修正optionsFooterText (通常是作者信息)
            if (messages['optionsFooterText']) {
                const currentValue = messages['optionsFooterText'].message;
                if (currentValue && currentValue.includes(`[${lang.toUpperCase()}]`)) {
                    // 对于作者信息，如果没有合适的翻译，保持英文
                    console.log(`   ✏️ 修正 optionsFooterText: "${currentValue}" → "Built by $authorName$."`);
                    messages['optionsFooterText'].message = 'Built by $authorName$.';
                    fixedCount++;
                }
            }

            if (fixedCount > 0) {
                this.saveMessages(lang, messages);
                console.log(`   💾 保存了 ${fixedCount} 个修正`);
                totalFixed += fixedCount;
                languagesFixed++;
            } else {
                console.log(`   ✅ 无需修正`);
            }
        }

        console.log(`\n🎉 修正完成! 总共修正了 ${totalFixed} 个错误，涉及 ${languagesFixed} 种语言`);
        return totalFixed;
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

    saveMessages(language, messages) {
        const filePath = path.join(this.localesDir, language, 'messages.json');
        fs.writeFileSync(filePath, JSON.stringify(messages, null, 2) + '\n');
    }
}

// 运行修正工具
const fixer = new TranslationFixTool();
fixer.fixTranslations();