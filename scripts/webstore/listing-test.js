#!/usr/bin/env node
/**
 * listing-test.js — publish.js listing(商店 listing 元信息)纯函数的离线单测。
 *
 * 覆盖:详情页 ds:0 内嵌数据解析(extractInitData / parseDetailPage 主路径)、
 * ld+json/og 兜底解析、changelog 节摘取、README pitch 摘取、PNG 头信息
 * (尺寸 + alpha)、草稿构建(buildProposal)。全部离线,不联网、不需凭据。
 * 运行:npm run test:webstore
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
    extractJsonLdObjects,
    extractInitData,
    parseDetailPage,
    extractLocaleCopy,
    extractChangelogSection,
    extractReadmePitch,
    pngSize,
    pngInfo,
    buildProposal
} from './publish.js';

// ---------------------------------------------------------------------------
// parseDetailPage — CWS 公开详情页 → listing 元信息
// 主路径:页面内嵌 AF_initDataCallback ds:0 数据块(2026-08-28 实测结构);
// 兜底:ld+json / og meta(ds:0 消失时的降级)。
// ---------------------------------------------------------------------------

const DETAIL_HTML = `<!doctype html><html><head>
<title>vBookmarks - Chrome Web Store</title>
<meta property="og:title" content="vBookmarks">
<meta property="og:description" content="A popup bookmark manager.">
<link rel="canonical" href="https://chromewebstore.google.com/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"vBookmarks","description":"A popup bookmark manager. Enhanced Neat Bookmarks.","softwareVersion":"4.1.0","url":"https://chromewebstore.google.com/detail/vbookmarks/odhjcodnoebmndcihdedenkmdmklpihb","screenshot":["https://storage.googleapis.com/webstore-content/screenshot_0.png","https://storage.googleapis.com/webstore-content/screenshot_1.png"],"aggregateRating":{"ratingValue":4.8,"ratingCount":321}}</script>
</head><body>…</body></html>`;

// 与 2026-08-28 实测同构的最小 ds:0 fixture(位置字段映射见 publish.js 注释;
// JSON 是合法 JS 字面量,真实页面是无引号键 + 单引号字符串,vm 求值两者皆可)。
const DS0_ITEM = [
    'extid123', 'https://lh3/icon', 'vBookmarks', 4.5, 102,
    'https://lh3/tile440', 'A summary.', 'https://home/', 1, 1, null,
    ['productivity/workflow', null, 4], 1, 1, 10000, 1,
    'https://lh3/feature', [1402811530, 217000000], '{"version":"4.0.8"}', 'vBookmarks'
];
const DS0_DATA = [
    DS0_ITEM, null, null, null, null,
    [[1, 'https://lh3/shot1'], [1, 'https://lh3/shot2']],
    '**Full** description text.', null, 1, 1,
    ['dev@example.com', null, null, null, 1, 'devname'],
    null, null, '4.0.8', [1787336815, 139338000], '1.02MiB', ['English'],
    null, null, null, null, 1, null, null, null, 'G-XXX', null, '114.0.0.0',
    null, 1, null, null, null, null, null, null, 1, 3, ['en', 'zh_CN']
];
const DS0_HTML = `<!doctype html><html><head>
<meta property="og:title" content="WRONG - Chrome Web Store">
<meta property="og:description" content="WRONG summary">
</head><body>
<script>AF_initDataCallback({key: 'ds:1', hash: '1', data:[], sideChannel: {}});</script>
<script>AF_initDataCallback({key: 'ds:0', hash: '2', data: ${JSON.stringify(DS0_DATA)}, sideChannel: {}});</script>
</body></html>`;

describe('parseDetailPage — ds:0 内嵌数据(主路径)', () => {
    test('ds:0 全量字段:名称/简介/说明全文/类别/截图/小图块/版本/评分/语言', () => {
        const p = parseDetailPage(DS0_HTML);
        assert.equal(p.source, 'ds:0');
        assert.equal(p.id, 'extid123');
        assert.equal(p.name, 'vBookmarks');
        assert.equal(p.summary, 'A summary.');
        assert.equal(p.description, '**Full** description text.');
        assert.equal(p.category, 'productivity/workflow');
        assert.equal(p.version, '4.0.8');
        assert.equal(p.publishedManifestVersion, '4.0.8');
        assert.equal(p.size, '1.02MiB');
        assert.equal(p.users, 10000);
        assert.equal(p.ratingValue, 4.5);
        assert.equal(p.ratingCount, 102);
        assert.deepEqual(p.screenshots, ['https://lh3/shot1', 'https://lh3/shot2']);
        assert.equal(p.smallPromoTile, 'https://lh3/tile440');
        assert.equal(p.featureGraphic, 'https://lh3/feature');
        assert.equal(p.minChrome, '114.0.0.0');
        assert.deepEqual(p.languages, ['en', 'zh_CN']);
        assert.deepEqual(p.developer, { email: 'dev@example.com', name: 'devname' });
        assert.equal(p.publishedAt, new Date(1402811530 * 1000).toISOString());
        assert.equal(p.updatedAt, new Date(1787336815 * 1000).toISOString());
    });

    test('ds:0 优先于 og meta(og 字段不参与)', () => {
        const p = parseDetailPage(DS0_HTML);
        assert.equal(p.name, 'vBookmarks');
        assert.notEqual(p.summary, 'WRONG summary');
    });

    test('ds:0 的 data 首元素不是数组时回退兜底解析', () => {
        const html = `<meta property="og:title" content="T"><meta property="og:description" content="D">
<script>AF_initDataCallback({key: 'ds:0', hash: '2', data: ["just-a-string"], sideChannel: {}});</script>`;
        const p = parseDetailPage(html);
        assert.equal(p.source, 'og');
        assert.equal(p.name, 'T');
    });
});

describe('extractInitData', () => {
    test('按 key 提取目标块,跳过其他 key', () => {
        assert.equal(extractInitData(DS0_HTML, 'ds:0')[13], '4.0.8');
        assert.equal(extractInitData(DS0_HTML, 'ds:9'), null);
    });

    test('blob 求值失败(未定义标识符)不炸,返回 null', () => {
        const html = `<script>AF_initDataCallback({key: 'ds:0', hash: '2', data: [boom], sideChannel: {}});</script>`;
        assert.equal(extractInitData(html), null);
    });

    test('空输入返回 null', () => {
        assert.equal(extractInitData(''), null);
        assert.equal(extractInitData(null), null);
    });
});

describe('parseDetailPage — og/ld+json 兜底', () => {
    test('ld+json SoftwareApplication 字段齐全(简介入 summary,说明全文兜底不可得)', () => {
        const p = parseDetailPage(DETAIL_HTML);
        assert.equal(p.source, 'og');
        assert.equal(p.name, 'vBookmarks');
        assert.equal(p.summary, 'A popup bookmark manager. Enhanced Neat Bookmarks.');
        assert.equal(p.description, '');
        assert.equal(p.version, '4.1.0');
        assert.equal(p.screenshots.length, 2);
        assert.equal(p.ratingValue, 4.8);
        assert.equal(p.ratingCount, 321);
    });

    test('无 ld+json 时取 og meta', () => {
        const html = `<meta property="og:title" content="T"><meta property="og:description" content="D">`;
        const p = parseDetailPage(html);
        assert.equal(p.name, 'T');
        assert.equal(p.summary, 'D');
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
        // + bitDepth/colorType(pngInfo 需要 26 字节读齐 IHDR 定长头)
        const buf = Buffer.alloc(26);
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

describe('pngInfo', () => {
    const mkPng = (w, h, colorType) => {
        const buf = Buffer.alloc(26);
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
        buf.write('IHDR', 12, 'ascii');
        buf.writeUInt32BE(w, 16);
        buf.writeUInt32BE(h, 20);
        buf[24] = 8;          // bitDepth
        buf[25] = colorType;
        return buf;
    };

    test('RGBA(colorType 6)标记 hasAlpha;RGB(colorType 2)不标记', () => {
        const rgba = pngInfo(mkPng(1280, 800, 6));
        assert.equal(rgba.width, 1280);
        assert.equal(rgba.height, 800);
        assert.equal(rgba.colorType, 6);
        assert.equal(rgba.hasAlpha, true);
        const rgb = pngInfo(mkPng(440, 280, 2));
        assert.equal(rgb.hasAlpha, false);
    });

    test('非 PNG/短 buffer 返回 null', () => {
        assert.equal(pngInfo(Buffer.from('not a png')), null);
        assert.equal(pngInfo(Buffer.alloc(24)), null); // 不足 26 字节读不到 colorType
        assert.equal(pngInfo(null), null);
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

    test('给了 detailed 文案则原样进草稿(缺省回退 README pitch)', () => {
        const p2 = buildProposal({
            version: '4.1.0',
            en: { name: 'vBookmarks', description: 'D' },
            zh: { name: 'vBookmarks', description: '中文简介' },
            changelogEn: '', changelogZh: '',
            pitchEn: { lead: 'Lead.', bullets: ['b1'] },
            pitchZh: { lead: '导语。', bullets: ['条 1'] },
            assets: [],
            detailedEn: 'Plain text detailed description.\n\n• no markdown here',
            detailedZh: '纯文本详情。\n\n• 没有标记'
        });
        // 规范文案原样出现,pitch 内容不再出现;json 携带 detailedDescription
        assert.match(p2.mdEn, /Plain text detailed description\./);
        assert.match(p2.mdEn, /• no markdown here/);
        assert.doesNotMatch(p2.mdEn, /\*\*Lead\.\*\*/);
        assert.match(p2.mdZh, /纯文本详情。/);
        assert.doesNotMatch(p2.mdZh, /导语。/);
        assert.equal(p2.json.detailedDescription.en, 'Plain text detailed description.\n\n• no markdown here');
        assert.equal(p2.json.detailedDescription['zh-CN'], '纯文本详情。\n\n• 没有标记');
        // 缺省路径不受影响(上面的 proposal 无 detailed,仍渲染 pitch)
        assert.match(proposal.mdEn, /\*\*Lead\.\*\*/);
        assert.deepEqual(proposal.json.detailedDescription, { en: '', 'zh-CN': '' });
    });
});
