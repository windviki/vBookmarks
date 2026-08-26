#!/usr/bin/env node
/**
 * listing-test.js — publish.js listing(商店 listing 元信息)纯函数的离线单测。
 *
 * 覆盖:公开详情页 ld+json/og 解析(parseDetailPage)、changelog 节摘取、
 * README pitch 摘取、PNG 尺寸读取、草稿构建(buildProposal)。
 * 全部离线,不联网、不需凭据。运行:npm run test:webstore
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
    extractJsonLdObjects,
    parseDetailPage,
    extractLocaleCopy,
    extractChangelogSection,
    extractReadmePitch,
    pngSize,
    buildProposal
} from './publish.js';

// ---------------------------------------------------------------------------
// parseDetailPage — CWS 公开详情页 → listing 元信息
// ---------------------------------------------------------------------------

const DETAIL_HTML = `<!doctype html><html><head>
<title>vBookmarks - Chrome Web Store</title>
<meta property="og:title" content="vBookmarks">
<meta property="og:description" content="A popup bookmark manager.">
<link rel="canonical" href="https://chromewebstore.google.com/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"vBookmarks","description":"A popup bookmark manager. Enhanced Neat Bookmarks.","softwareVersion":"4.1.0","url":"https://chromewebstore.google.com/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb","screenshot":["https://storage.googleapis.com/webstore-content/screenshot_0.png","https://storage.googleapis.com/webstore-content/screenshot_1.png"],"aggregateRating":{"ratingValue":4.8,"ratingCount":321}}</script>
</head><body>…</body></html>`;

describe('parseDetailPage', () => {
    test('ld+json SoftwareApplication 优先,字段齐全', () => {
        const p = parseDetailPage(DETAIL_HTML);
        assert.equal(p.name, 'vBookmarks');
        assert.equal(p.description, 'A popup bookmark manager. Enhanced Neat Bookmarks.');
        assert.equal(p.version, '4.1.0');
        assert.equal(p.screenshots.length, 2);
        assert.equal(p.ratingValue, 4.8);
        assert.equal(p.ratingCount, 321);
    });

    test('无 ld+json 时回退 og meta', () => {
        const html = `<meta property="og:title" content="T"><meta property="og:description" content="D">`;
        const p = parseDetailPage(html);
        assert.equal(p.name, 'T');
        assert.equal(p.description, 'D');
        assert.equal(p.version, '');
        assert.deepEqual(p.screenshots, []);
    });

    test('@graph 与数组包裹的节点也能下钻命中', () => {
        const html = `<script type="application/ld+json">{"@graph":[{"@type":["WebApplication"],"name":"N","description":"D"}]}</script>`;
        assert.equal(parseDetailPage(html).name, 'N');
    });

    test('全空页面返回 null(被反爬墙拦下的信号)', () => {
        assert.equal(parseDetailPage('<html><head></head></html>'), null);
        assert.equal(parseDetailPage(''), null);
        assert.equal(parseDetailPage(null), null);
    });

    test('损坏的 ld+json 不炸解析(extractJsonLdObjects 容错)', () => {
        assert.deepEqual(extractJsonLdObjects('<script type="application/ld+json">{oops}</script>'), []);
    });

    test('screenshot 对象形态取 url', () => {
        const html = `<script type="application/ld+json">{"@type":"SoftwareApplication","name":"N","description":"D","screenshot":[{"url":"https://x/1.png"}]}</script>`;
        assert.deepEqual(parseDetailPage(html).screenshots, ['https://x/1.png']);
    });

    test('og:title 剥商店后缀;imageUrls 收集去重的 lh3 直链', () => {
        const html = `<meta property="og:title" content="vBookmarks - Chrome Web Store">
<meta property="og:description" content="D">
<img src="https://lh3.googleusercontent.com/abc123">
<img src="https://lh3.googleusercontent.com/abc123">
<img src="https://lh3.googleusercontent.com/def456">`;
        const p = parseDetailPage(html);
        assert.equal(p.name, 'vBookmarks');
        assert.deepEqual(p.imageUrls,
            ['https://lh3.googleusercontent.com/abc123', 'https://lh3.googleusercontent.com/def456']);
    });

    test('中文站后缀同样剥除', () => {
        const html = `<meta property="og:title" content="vBookmarks - Chrome 应用商店"><meta property="og:description" content="D">`;
        assert.equal(parseDetailPage(html).name, 'vBookmarks');
    });
});

// ---------------------------------------------------------------------------
// 规范源摘取
// ---------------------------------------------------------------------------

describe('extractLocaleCopy', () => {
    test('extName/extDesc 是商店文案规范源', () => {
        assert.deepEqual(extractLocaleCopy({ extName: { message: 'vBookmarks' }, extDesc: { message: 'Desc' } }),
            { name: 'vBookmarks', description: 'Desc' });
        assert.deepEqual(extractLocaleCopy({}), { name: '', description: '' });
    });
});

const README = `# Title

intro line

**The lead sentence goes here.**

- bullet one — detail
- bullet two

Successor paragraph breaks the list.

# Changelogs

### v4.1.0

*2026-08-26*

#### New

- feature A
- feature B

### v4.0.8

*2026-08-21*

- older feature
`;

describe('extractChangelogSection', () => {
    test('摘取指定版本整节,止于下一个版本标题', () => {
        const s = extractChangelogSection(README, '4.1.0');
        assert.match(s, /feature A/);
        assert.match(s, /feature B/);
        assert.doesNotMatch(s, /older feature/);
        assert.doesNotMatch(s, /### v4\.0\.8/);
    });

    test('版本不存在返回空串;点号不当正则通配', () => {
        assert.equal(extractChangelogSection(README, '9.9.9'), '');
        // 4.1.0 的点若被当通配符,4x1x0 也会命中 — 此处确保不会
        assert.equal(extractChangelogSection(README, '4x1x0'), '');
    });

    test('空输入返回空串', () => {
        assert.equal(extractChangelogSection('', '4.1.0'), '');
        assert.equal(extractChangelogSection(null, '4.1.0'), '');
    });
});

describe('extractReadmePitch', () => {
    test('lead 加紧随的子弹列表,止于首个非列表行', () => {
        const { lead, bullets } = extractReadmePitch(README);
        assert.equal(lead, 'The lead sentence goes here.');
        assert.deepEqual(bullets, ['bullet one — detail', 'bullet two']);
    });
});

// ---------------------------------------------------------------------------
// pngSize / buildProposal
// ---------------------------------------------------------------------------

describe('pngSize', () => {
    test('从 IHDR 读尺寸', () => {
        // 8 字节签名 + 4 长度 + "IHDR" + width/height(各 4 字节 BE)
        const buf = Buffer.alloc(24);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
        buf.write('IHDR', 12, 'ascii');
        buf.writeUInt32BE(1400, 16);
        buf.writeUInt32BE(560, 20);
        assert.deepEqual(pngSize(buf), { width: 1400, height: 560 });
    });

    test('非 PNG/短 buffer 返回 null', () => {
        assert.equal(pngSize(Buffer.from('not a png at all........')), null);
        assert.equal(pngSize(Buffer.alloc(4)), null);
        assert.equal(pngSize(null), null);
    });
});

describe('buildProposal', () => {
    const assets = [
        { file: 'vBookmarks-v4.png', size: { width: 1280, height: 800 } },
        { file: 'vbookmarks.png', size: { width: 1400, height: 560 } },
        { file: 'weird.png', size: { width: 333, height: 222 } },
        { file: 'broken.png', size: null }
    ];
    const proposal = buildProposal({
        version: '4.1.0',
        en: { name: 'vBookmarks', description: 'Desc EN'.repeat(10) },
        zh: { name: 'vBookmarks', description: '中文简介' },
        changelogEn: '- feature A',
        changelogZh: '- 功能 A',
        pitchEn: { lead: 'Lead.', bullets: ['b1'] },
        pitchZh: { lead: '导语。', bullets: ['条 1'] },
        assets
    });

    test("json 汇总双语 + what's-new + 截图册(含规格标注)", () => {
        const j = proposal.json;
        assert.equal(j.version, '4.1.0');
        assert.equal(j.en.name, 'vBookmarks');
        assert.equal(j.zh.description, '中文简介');
        assert.equal(j.whatsNew.en, '- feature A');
        assert.equal(j.screenshots[0].spec, 'screenshot 1280×800');
        assert.equal(j.screenshots[2].spec, null);
        assert.equal(j.screenshots[3].width, null);
    });

    test('markdown 双语产出含各栏与规格提示', () => {
        assert.match(proposal.mdEn, /## Name/);
        assert.match(proposal.mdEn, /vBookmarks/);
        assert.match(proposal.mdEn, /- feature A/);
        assert.match(proposal.mdEn, /✓ screenshot 1280×800/);
        assert.match(proposal.mdEn, /⚠ 非标准尺寸/);
        assert.match(proposal.mdZh, /中文简介/);
        assert.match(proposal.mdZh, /- 功能 A/);
    });
});
