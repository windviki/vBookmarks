#!/usr/bin/env node

/**
 * Simple translation sync tool for vBookmarks
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localesDir = path.join(__dirname, '_locales');

// Load English messages as source
const enMessages = JSON.parse(fs.readFileSync(path.join(localesDir, 'en', 'messages.json'), 'utf8'));

// Define new keys that need translation
const newKeys = {
  'toolbarOptions': 'Toolbar Options',
  'optionShowFloatingToolbar': 'Show floating toolbar'
};

// Add missing keys to English
let addedToEnglish = false;
for (const [key, value] of Object.entries(newKeys)) {
  if (!enMessages[key]) {
    enMessages[key] = { message: value };
    addedToEnglish = true;
  }
}

if (addedToEnglish) {
  fs.writeFileSync(path.join(localesDir, 'en', 'messages.json'), JSON.stringify(enMessages, null, 2) + '\n');
  console.log('✅ Added new keys to English');
}

// Check Chinese
const zhMessages = JSON.parse(fs.readFileSync(path.join(localesDir, 'zh', 'messages.json'), 'utf8'));
const zhNewKeys = {
  'toolbarOptions': '工具栏选项',
  'optionShowFloatingToolbar': '显示悬浮工具栏'
};

let addedToChinese = false;
for (const [key, value] of Object.entries(zhNewKeys)) {
  if (!zhMessages[key]) {
    zhMessages[key] = { message: value };
    addedToChinese = true;
  }
}

if (addedToChinese) {
  fs.writeFileSync(path.join(localesDir, 'zh', 'messages.json'), JSON.stringify(zhMessages, null, 2) + '\n');
  console.log('✅ Added new keys to Chinese');
}

console.log('🎉 Translation sync completed!');