#!/usr/bin/env node

/**
 * vBookmarks Translation Helper Script
 *
 * This script helps manage translations across multiple languages:
 * - Find new messages in source language that need translation
 * - Check for missing translations across languages
 * - Generate translation templates
 *
 * Usage:
 *   node translation-helper.js check          # Check all translations
 *   node translation-helper.js missing         # Show missing translations
 *   node translation-helper.js template        # Generate translation template
 *   node translation-helper.js sync en zh_CN  # Sync specific languages
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TranslationHelper {
    constructor() {
        this.rootDir = process.cwd();
        this.localesDir = path.join(this.rootDir, '_locales');
        this.sourceLanguage = 'en';
        this.supportedLanguages = [
            'en', 'zh', 'zh_TW', 'zh_HK', 'ja', 'ko', 'fr', 'de', 'es', 'it',
            'pt', 'ru', 'ar', 'hi', 'bn', 'th', 'vi', 'id', 'nl', 'pl', 'sv',
            'da', 'no', 'fi', 'cs', 'sk', 'hu', 'ro', 'bg', 'hr', 'et', 'lv',
            'lt', 'sl', 'uk', 'el', 'he', 'fa', 'tr'
        ];

        // Keys that should be ignored as they're not user-facing
        this.ignoreKeys = [
            'description',
            'example'
        ];
    }

    async run() {
        const command = process.argv[2] || 'check';

        console.log('🌍 vBookmarks Translation Helper\n');

        switch (command) {
            case 'check':
                await this.checkAllTranslations();
                break;
            case 'missing':
                await this.showMissingTranslations();
                break;
            case 'template':
                await this.generateTemplate();
                break;
            case 'sync':
                await this.syncLanguages(process.argv.slice(3));
                break;
            default:
                this.showHelp();
        }
    }

    async checkAllTranslations() {
        console.log('🔍 Checking all translations...\n');

        const sourceKeys = this.getTranslationKeys(this.sourceLanguage);
        const languages = this.getAvailableLanguages();

        let totalMissing = 0;
        const missingByLanguage = {};

        for (const lang of languages) {
            if (lang === this.sourceLanguage) continue;

            const langKeys = this.getTranslationKeys(lang);
            const missing = sourceKeys.filter(key => !langKeys.includes(key));

            if (missing.length > 0) {
                missingByLanguage[lang] = missing;
                totalMissing += missing.length;
            }
        }

        this.printTranslationReport(sourceKeys.length, languages.length, missingByLanguage, totalMissing);
    }

    async showMissingTranslations() {
        console.log('📋 Missing translations by language:\n');

        const sourceKeys = this.getTranslationKeys(this.sourceLanguage);
        const languages = this.getAvailableLanguages();

        for (const lang of languages.sort()) {
            if (lang === this.sourceLanguage) continue;

            const langKeys = this.getTranslationKeys(lang);
            const missing = sourceKeys.filter(key => !langKeys.includes(key));

            if (missing.length > 0) {
                console.log(`🔴 ${lang.toUpperCase()} (${missing.length} missing):`);
                missing.forEach(key => {
                    console.log(`   - ${key}`);
                });
                console.log('');
            } else {
                console.log(`🟢 ${lang.toUpperCase()}: Complete`);
            }
        }
    }

    async generateTemplate() {
        console.log('📝 Generating translation template...\n');

        const sourceKeys = this.getTranslationKeys(this.sourceLanguage);
        const sourceMessages = this.loadMessages(this.sourceLanguage);

        const template = {
            generated: new Date().toISOString(),
            sourceLanguage: this.sourceLanguage,
            totalKeys: sourceKeys.length,
            messages: {}
        };

        for (const key of sourceKeys) {
            template.messages[key] = {
                description: sourceMessages[key]?.description || '',
                message: '', // Empty for translation
                placeholders: sourceMessages[key]?.placeholders || {}
            };
        }

        const templatePath = path.join(this.rootDir, 'translation-template.json');
        fs.writeFileSync(templatePath, JSON.stringify(template, null, 2) + '\n');

        console.log(`✅ Template saved to: translation-template.json`);
        console.log(`📊 Total keys: ${sourceKeys.length}`);
    }

    async syncLanguages(targetLanguages) {
        if (targetLanguages.length === 0) {
            console.log('❌ Please specify target languages:');
            console.log('   node translation-helper.js sync zh_CN fr de');
            return;
        }

        console.log('🔄 Syncing translations...\n');

        const sourceKeys = this.getTranslationKeys(this.sourceLanguage);
        const sourceMessages = this.loadMessages(this.sourceLanguage);

        for (const targetLang of targetLanguages) {
            console.log(`🔄 Processing ${targetLang.toUpperCase()}...`);

            if (!this.languageExists(targetLang)) {
                console.log(`   ⚠️  Language ${targetLang} not found, creating...`);
                this.createLanguageFile(targetLang);
            }

            const targetMessages = this.loadMessages(targetLang);
            let addedCount = 0;

            for (const key of sourceKeys) {
                if (!targetMessages[key]) {
                    targetMessages[key] = {
                        description: sourceMessages[key]?.description || '',
                        message: '', // Empty for manual translation
                        placeholders: sourceMessages[key]?.placeholders || {}
                    };
                    addedCount++;
                }
            }

            if (addedCount > 0) {
                this.saveMessages(targetLang, targetMessages);
                console.log(`   ✅ Added ${addedCount} new keys for translation`);
            } else {
                console.log(`   ✅ Already up to date`);
            }
        }

        console.log('\n🎯 Sync completed! Please manually translate the new keys.');
    }

    getTranslationKeys(language) {
        const messages = this.loadMessages(language);
        return Object.keys(messages).filter(key => !this.ignoreKeys.includes(key));
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
            console.error(`❌ Error loading ${language} messages:`, error.message);
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
            return stats.isDirectory() && this.supportedLanguages.includes(dir);
        });
    }

    languageExists(language) {
        return fs.existsSync(path.join(this.localesDir, language, 'messages.json'));
    }

    createLanguageFile(language) {
        const langDir = path.join(this.localesDir, language);
        if (!fs.existsSync(langDir)) {
            fs.mkdirSync(langDir, { recursive: true });
        }

        const filePath = path.join(langDir, 'messages.json');
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '{}\n');
        }
    }

    printTranslationReport(totalKeys, totalLanguages, missingByLanguage, totalMissing) {
        console.log('📊 Translation Report');
        console.log('=' .repeat(50));
        console.log(`📏 Total keys: ${totalKeys}`);
        console.log(`🌍 Total languages: ${totalLanguages}`);
        console.log(`🔴 Missing translations: ${totalMissing}`);
        console.log('');

        console.log('📋 Language Status:');
        const languages = this.getAvailableLanguages();

        for (const lang of languages.sort()) {
            if (lang === this.sourceLanguage) {
                console.log(`🟢 ${lang.toUpperCase()}: Source language (${totalKeys} keys)`);
            } else if (missingByLanguage[lang]) {
                const missing = missingByLanguage[lang].length;
                const percentage = ((totalKeys - missing) / totalKeys * 100).toFixed(1);
                console.log(`🔴 ${lang.toUpperCase()}: ${missing} missing (${percentage}% complete)`);
            } else {
                console.log(`🟢 ${lang.toUpperCase()}: Complete (${totalKeys} keys)`);
            }
        }

        if (totalMissing > 0) {
            console.log('\n⚠️  Action needed:');
            console.log('   Run "node translation-helper.js missing" to see missing translations');
            console.log('   Run "node translation-helper.js sync <lang>" to add missing keys');
        } else {
            console.log('\n🎉 All translations are complete!');
        }
    }

    showHelp() {
        console.log('🌍 vBookmarks Translation Helper');
        console.log('');
        console.log('Usage:');
        console.log('  node translation-helper.js <command>');
        console.log('');
        console.log('Commands:');
        console.log('  check          - Check all translations and show report');
        console.log('  missing         - Show missing translations by language');
        console.log('  template        - Generate translation template');
        console.log('  sync <langs>    - Sync specific languages (e.g., sync zh_CN fr de)');
        console.log('');
        console.log('Examples:');
        console.log('  node translation-helper.js check');
        console.log('  node translation-helper.js missing');
        console.log('  node translation-helper.js sync zh_CN fr de');
    }
}

// Run the helper
if (import.meta.url === `file://${process.argv[1]}`) {
    const helper = new TranslationHelper();
    helper.run().catch(console.error);
}

export default TranslationHelper;