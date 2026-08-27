#!/usr/bin/env node
/**
 * publish.js — 「商店发布」:通过 Chrome Web Store API V2 上传/发布 vBookmarks。
 *
 * 发布流程 = git发布 + 商店发布 两大步骤:
 *   - git发布   : 版本跃进 → 双语 changelog → commit → tag → 本地打包(tmp zip)→ push
 *                 详见 AGENTS.md「Release process」/ 记忆 release-process.md
 *   - 商店发布  : 本脚本。上传 tmp zip 到 CWS + 提交发布审核。
 *
 * 商店发布前置校验(默认强制):git发布 是否已执行——
 *   1) git 最大 tag 必须 == v<manifest.version>(版本已打 tag)
 *   2) 待上传 zip 必须存在且其内嵌 manifest 版本 == 仓库 manifest 版本(已打包)
 *   校验失败即中止(除非 --skip-check,仅用于显式上传草稿等场景)。
 *
 * 用法:
 *   node scripts/webstore/publish.js check                仅做 git发布 前置校验(离线,不需凭据)
 *   node scripts/webstore/publish.js status               查询当前已发布/待审状态
 *   node scripts/webstore/publish.js upload [--file 路径] [--skip-check]
 *   node scripts/webstore/publish.js publish [--type T] [--deploy N] [--skip-check]
 *   node scripts/webstore/publish.js all [--deploy N] [--file 路径] [--skip-check]
 *   node scripts/webstore/publish.js listing [--yes]      取回线上 listing 元信息(公开页快照 + item 状态)
 *   node scripts/webstore/publish.js listing-draft        依据仓库规范源生成 listing 更新草稿(离线)
 *   node scripts/webstore/publish.js help
 *
 * listing 说明(为什么是「快照 + 草稿」而不是直接改线上):
 *   CWS API V2 的 REST 面只有 upload/publish/fetchStatus/cancelSubmission/
 *   setPublishedDeployPercentage —— 官方不提供 listing(名称/简介/详述/截图)
 *   的读写端点,DashBoard 内部接口也未开放。因此本脚本对 listing 的能力是:
 *   - listing       「取回」:抓取公开详情页(?hl= 按语言)解析 ld+json/og 元信息
 *                   存快照(tmp/webstore/),与 item 状态一并打印,供比对审查;
 *   - listing-draft 「更新」:从仓库规范源(_locales extName/extDesc、docs/README
 *                   pitch 与 changelog、assets/store 图册)生成可粘贴的双语草稿,
 *                   人工核对后贴进 Dashboard —— 与「人工挑选、手动上传」同一纪律。
 *
 * 凭据来源(优先级从高到低):
 *   1) 真实环境变量  CWS_* (GitHub Actions secrets 等)
 *   2) 仓库根 .env 文件(KEY=VALUE,git-ignored;与 scripts/i18n.py 同规则)
 *   所需键: CWS_PUBLISHER_ID / CWS_CLIENT_ID / CWS_CLIENT_SECRET(可空) / CWS_REFRESH_TOKEN
 *           (CWS_EXTENSION_ID 可选,默认从 manifest.homepage_url 推导)
 *   申请步骤见 scripts/webstore/README.md「凭据准备」。
 *
 * 网络: Node 全局 fetch(undici)默认不读 HTTP(S)_PROXY;本环境直连 Google 被墙,
 *       必须走代理。脚本自动复用 HTTP(S)_PROXY 环境变量安装 undici ProxyAgent。
 *
 * 所有变更类命令默认先 dry-run(打印将执行的请求,不联网);加 --yes 才真正执行。
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import chromeWebstoreUpload from 'chrome-webstore-upload';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(`${REPO_ROOT}manifest.json`, 'utf8'));
const version = manifest.version;

// ---------------------------------------------------------------------------
// .env 加载(与 scripts/i18n.py#load_dotenv 同规则:真实环境变量优先)
// ---------------------------------------------------------------------------

/** 去掉 .env 值的行内注释(.env.example 同款 "KEY=value # 说明";值以 # 开头或 # 前有空白即截断)。 */
export function stripDotenvComment(value) {
    return value.replace(/(^|\s)#.*$/, '').trim();
}

function loadDotenv() {
    try {
        const text = fs.readFileSync(`${REPO_ROOT}.env`, 'utf8');
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
            const idx = trimmed.indexOf('=');
            const key = trimmed.slice(0, idx).trim();
            const value = stripDotenvComment(trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, ''));
            if (key && !(key in process.env)) process.env[key] = value;
        }
    } catch { /* .env 不存在时静默 */ }
}
loadDotenv();

// ---------------------------------------------------------------------------
// 测试用户(灰度给指定测试者用)
// ---------------------------------------------------------------------------

/** 未配置 CWS_TRUSTED_TESTERS 时的默认测试用户(owner 邮箱)。 */
export const DEFAULT_TESTERS = ['windviki@gmail.com'];

/**
 * 读取测试用户列表。来源:CWS_TRUSTED_TESTERS(逗号分隔邮箱,可空/空串)。
 * 未配置时回退到默认 [windviki@gmail.com]。
 *
 * 注意:CWS API 无法代管测试者邮箱列表,只能发布到「已配置的测试者」;邮箱列表
 * 须在 Developer Dashboard → Users and permissions → Testers 手动维护(Editor
 * 角色可管理)。本脚本仅负责展示列表供核对。
 */
export function loadTesters() {
    const raw = process.env.CWS_TRUSTED_TESTERS;
    if (!raw || !raw.trim()) return [...DEFAULT_TESTERS];
    const testers = raw.split(',').map(s => s.trim()).filter(Boolean);
    return testers.length ? testers : [...DEFAULT_TESTERS];
}

/** 发布目标的中文说明(TRUSTED_TESTERS 灰度测试者 / DEFAULT_PUBLISH 全量)。 */
function publishTargetNote(type) {
    const target = type ?? 'DEFAULT_PUBLISH';
    if (target === 'TRUSTED_TESTERS') return '灰度给测试用户(TRUSTED_TESTERS) — 测试者列表须在 Dashboard → Users and permissions → Testers 维护';
    if (target === 'DEFAULT_PUBLISH') return '发布给所有人(DEFAULT_PUBLISH) — 若此前是测试用户灰度,此命令即恢复到全量';
    return `分阶段发布(${target})`;
}

/** 打印测试用户列表 + Dashboard 核对指引(发布目标为 TRUSTED_TESTERS 时)。 */
function printTestersHint() {
    const testers = loadTesters();
    console.log(`\n本次将灰度给测试用户(${testers.length}): ${testers.join(', ')}`);
    console.log('  ⚠ CWS API 无法代管测试者邮箱列表,请到 Developer Dashboard →');
    console.log('    Users and permissions → Testers 核对已包含以上邮箱(Editor 角色可管理)。');
}

// ---------------------------------------------------------------------------
// 出网代理(undici 不读代理环境变量,需显式安装 ProxyAgent)
// ---------------------------------------------------------------------------

// 延迟到真正联网的 --yes 分支再安装:离线 check 不应装全局 dispatcher。
async function installProxyIfNeeded() {
    if (!(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy))
        return;
    const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
    try {
        const { ProxyAgent, setGlobalDispatcher } = await import('undici');
        setGlobalDispatcher(new ProxyAgent(proxyUrl));
        console.error(`[proxy] 出网走 ${String(proxyUrl).replace(/\/\/[^@]*@/, '//***@')}`);
    } catch (err) {
        console.error(`[proxy] undici 未安装,无法走代理: ${err.message}`);
    }
}

// ---------------------------------------------------------------------------
// git发布 前置校验
// ---------------------------------------------------------------------------

const PUBLISH_TYPES = new Set(['DEFAULT_PUBLISH', 'TRUSTED_TESTERS', 'STAGED_PUBLISH']);

function maxGitTag() {
    try {
        const tags = execSync('git tag --sort=-v:refname', { cwd: REPO_ROOT })
            .toString().trim().split('\n').filter(Boolean);
        // Only semantic release tags count — a stray v5.0.0-alpha must not
        // masquerade as the "latest" tag and trip the version comparison.
        return tags.find(t => /^v\d+\.\d+\.\d+$/.test(t)) || null;
    } catch {
        return null;
    }
}

/** 读取 zip 内 manifest.json 的 version;读不到返回 null。 */
async function zipManifestVersion(zipPath) {
    try {
        const { default: yauzl } = await import('yauzl');
        return await new Promise((resolve) => {
            yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
                if (err) return resolve(null);
                zip.readEntry();
                zip.on('entry', (entry) => {
                    if (entry.fileName !== 'manifest.json') return zip.readEntry();
                    zip.openReadStream(entry, (e, stream) => {
                        if (e) return resolve(null);
                        let buf = '';
                        stream.setEncoding('utf8');
                        stream.on('data', (c) => (buf += c));
                        stream.on('end', () => {
                            try { resolve(JSON.parse(buf).version); } catch { resolve(null); }
                        });
                    });
                });
                zip.on('error', () => resolve(null));
            });
        });
    } catch {
        return null;
    }
}

/**
 * 商店发布前置校验。返回 { issues, warnings }:
 * issues 非空即中止(除非 --skip-check);warnings 仅提示。
 */
async function gitReleaseCheck(zipPath) {
    const issues = [];
    const warnings = [];
    const expected = `v${version}`;
    const tag = maxGitTag();
    if (!tag) {
        issues.push('仓库没有任何 git tag — git发布 未执行(至少先打 v' + version + ' 的 tag)。');
    } else if (tag !== expected) {
        issues.push(`git 最大 tag 是 ${tag},与当前版本 ${expected} 不一致 — 说明 git发布 尚未为当前版本打 tag。`);
    }

    if (!zipPath || !fs.existsSync(zipPath)) {
        issues.push(`找不到待上传产物 ${zipPath ? zipPath.split('/').pop() : '(未指定)'} — 先运行 python3 scripts/package.py。`);
    } else {
        const zipVer = await zipManifestVersion(zipPath);
        if (zipVer === null) {
            warnings.push('无法读取 zip 内 manifest.json,未能核对内嵌版本。');
        } else if (zipVer !== version) {
            issues.push(`zip 内嵌版本 ${zipVer} ≠ 仓库 manifest 版本 ${version} — 上传错包或未重新打包。`);
        }
    }
    return { issues, warnings };
}

// ---------------------------------------------------------------------------
// listing 元信息(取回解析 + 草稿构建)—— 纯函数,离线单测覆盖(listing-test.js)
// ---------------------------------------------------------------------------

/** 从 HTML 里抽出全部 <script type="application/ld+json"> 的解析结果(容错)。 */
export function extractJsonLdObjects(html) {
    const out = [];
    const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    for (let m; (m = re.exec(html));) {
        try { out.push(JSON.parse(m[1].trim())); } catch { /* 页面噪声,跳过 */ }
    }
    return out;
}

/** 深度收集 @type 命中任一类型名的节点(@graph/数组均下钻)。 */
function collectByType(node, typeRe, acc = []) {
    if (Array.isArray(node)) {
        for (const n of node) collectByType(n, typeRe, acc);
    } else if (node && typeof node === 'object') {
        const t = node['@type'];
        const types = Array.isArray(t) ? t : t ? [t] : [];
        if (types.some(x => typeRe.test(x))) acc.push(node);
        for (const v of Object.values(node)) collectByType(v, typeRe, acc);
    }
    return acc;
}

/** 取 meta property/name=… 的 content。 */
function metaContent(html, key) {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["']`, 'i');
    const alt = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
    const m = html.match(re) ?? html.match(alt);
    return m ? m[1] : '';
}

/**
 * 解析 CWS 公开详情页 HTML → listing 元信息快照。
 * 现状(2026-08 实测):详情页无 ld+json、无 itemprop,名称/简介来自 og meta,
 * 图片是 lh3.googleusercontent.com 直链(截图/评分/版本由 XHR 渲染,静态
 * HTML 拿不到 —— 对应字段留空,不硬猜)。拿不到任何字段时返回 null。
 */
export function parseDetailPage(html) {
    if (!html) return null;
    const nodes = [];
    for (const blob of extractJsonLdObjects(html))
        nodes.push(...collectByType(blob, /SoftwareApplication|WebApplication/i));
    const app = nodes[0] ?? null;
    const screenshots = app && app.screenshot !== undefined
        ? (Array.isArray(app.screenshot) ? app.screenshot : [app.screenshot])
            .map(s => (typeof s === 'string' ? s : s?.url)).filter(Boolean)
        : [];
    // og:title 带「 - Chrome Web Store / - Chrome 应用商店」后缀,剥掉。
    const stripSuffix = s => String(s ?? '')
        .replace(/\s*-\s*Chrome Web Store\s*$/i, '')
        .replace(/\s*-\s*Chrome 应用商店\s*$/, '');
    const name = stripSuffix(app?.name ?? metaContent(html, 'og:title'));
    const description = String(app?.description ?? metaContent(html, 'og:description') ?? '');
    if (!name && !description) return null;
    // 页面里的图片直链(图标与截图混排,无法从静态 HTML 区分,单独列出不冒名 screenshots)。
    const imageUrls = [...new Set(
        [...html.matchAll(/https:\/\/lh3\.googleusercontent\.com\/[A-Za-z0-9_\-]+/g)].map(m => m[0])
    )].slice(0, 12);
    return {
        name,
        description,
        version: app?.softwareVersion ? String(app.softwareVersion) : '',
        url: app?.url ? String(app.url) : '',
        screenshots,
        imageUrls,
        ratingValue: app?.aggregateRating?.ratingValue ?? null,
        ratingCount: app?.aggregateRating?.ratingCount ?? app?.aggregateRating?.reviewCount ?? null,
        parsedAt: new Date().toISOString()
    };
}

/** 读取 messages.json 里的商店文案(extName/extDesc —— manifest i18n 的规范源)。 */
export function extractLocaleCopy(messages) {
    return {
        name: messages?.extName?.message ?? '',
        description: messages?.extDesc?.message ?? ''
    };
}

/**
 * 摘取 changelog 中指定版本的整节文本(从 `### v<version>` 到下一个 `### v`)。
 * 找不到该版本标题时返回 ''。
 */
export function extractChangelogSection(readme, version) {
    if (!readme) return '';
    const re = new RegExp(`^### v${version.replace(/\./g, '\\.')}\\s*$`, 'm');
    const m = readme.match(re);
    if (!m) return '';
    const start = m.index + m[0].length;
    const rest = readme.slice(start);
    const next = rest.search(/^### v\d+\S*\s*$/m);
    return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/** 摘取 README 的 pitch(首个 `**…**` 加粗引导段 + 其后的特性子弹列表)。 */
export function extractReadmePitch(readme) {
    if (!readme) return { lead: '', bullets: [] };
    // 引导段是「行首加粗、后接同段正文」的段落(README 现状:**lead.** One click
    // …),取整段并去掉加粗记号即可。
    const leadMatch = readme.match(/^\*\*.*$/m);
    const lead = leadMatch ? leadMatch[0].replace(/\*\*/g, '').trim() : '';
    const bullets = [];
    if (leadMatch) {
        const rest = readme.slice(leadMatch.index + leadMatch[0].length);
        for (const line of rest.split(/\r?\n/)) {
            if (/^- /.test(line)) bullets.push(line.slice(2).trim());
            else if (bullets.length) break;
        }
    }
    return { lead, bullets };
}

/** PNG 尺寸读取(IHDR 定长头);非 PNG 返回 null。 */
export function pngSize(buf) {
    if (!buf || buf.length < 24) return null;
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buf.subarray(0, 8).equals(sig)) return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** WebStore 图片规格(官方:截图 1280×800 或 640×400,marquee 1400×560)。 */
export const IMAGE_SPECS = [
    { label: 'screenshot 1280×800', width: 1280, height: 800 },
    { label: 'screenshot 640×400', width: 640, height: 400 },
    { label: 'marquee 1400×560', width: 1400, height: 560 },
    { label: 'small tile 440×280', width: 440, height: 280 }
];

function specMatch({ width, height }) {
    return IMAGE_SPECS.find(s => s.width === width && s.height === height)?.label ?? null;
}

/**
 * 生成 listing 更新草稿。输入全部来自仓库规范源;输出 JSON + 双语 Markdown
 * (可直接贴进 Dashboard 的 Store listing 标签)。
 */
export function buildProposal({ version, en, zh, changelogEn, changelogZh, pitchEn, pitchZh, assets }) {
    const shots = assets.map(a => ({
        file: a.file,
        width: a.size?.width ?? null,
        height: a.size?.height ?? null,
        spec: a.size ? specMatch(a.size) : null
    }));
    const json = {
        generatedAt: new Date().toISOString(),
        version,
        en,
        zh,
        whatsNew: { en: changelogEn, 'zh-CN': changelogZh },
        screenshots: shots
    };
    const fmt = (title, copy, changelog, pitch) => `# vBookmarks — Store listing proposal (${title}, v${version})

> 由 \`node scripts/webstore/publish.js listing-draft\` 生成。核对后把下列各栏
> 粘贴进 Developer Dashboard → 包 → Store listing;图片按清单手动上传。
> 线上现值用 \`node scripts/webstore/publish.js listing --yes\` 快照比对。

## Name

${copy.name}

## Summary (${copy.description.length}/132 chars)

${copy.description}

## Detailed description

**${pitch.lead}**

${pitch.bullets.map(b => `- ${b}`).join('\n')}

## What's new (v${version})

${changelog || '_(docs README 中未找到该版本的 changelog 节)_'}
`;
    const roster = shots.length
        ? shots.map(s => `- \`${s.file}\` — ${s.width ?? '?'}×${s.height ?? '?'}${s.spec ? ` ✓ ${s.spec}` : ' ⚠ 非标准尺寸'}`).join('\n')
        : '- _(assets/store/ 下没有图片)_';
    const mdEn = `${fmt('EN', en, changelogEn, pitchEn)}

## Screenshots to attach (assets/store/)

${roster}
`;
    const mdZh = `${fmt('zh-CN', zh, changelogZh, pitchZh)}

## 截图清单(assets/store/)

${roster}
`;
    return { json, mdEn, mdZh };
}

/** 抓取公开详情页(带 hl 语言参数;走 installProxyIfNeeded 的全局代理)。 */
export async function fetchDetailPage(extensionId, hl) {
    const url = `https://chromewebstore.google.com/detail/${extensionId}${hl ? `?hl=${hl}` : ''}`;
    const res = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept-Language': hl || 'en'
        },
        signal: AbortSignal.timeout(20000),
        redirect: 'follow'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return { url: res.url, html: await res.text() };
}

// ---------------------------------------------------------------------------
// 凭据 / 产物 / CLI
// ---------------------------------------------------------------------------

const extensionId = process.env.CWS_EXTENSION_ID ?? manifest.homepage_url?.split('/').pop();

function need(envKey, label) {
    if (!process.env[envKey]) {
        console.error(`✖ 缺少环境变量 ${envKey}(${label})。`);
        console.error(`  见 scripts/webstore/README.md「凭据准备」。`);
        process.exit(2);
    }
    return process.env[envKey];
}

function buildStore() {
    const publisherId = need('CWS_PUBLISHER_ID', '开发者账号 ID');
    need('CWS_CLIENT_ID', 'GCP OAuth Client ID');
    need('CWS_REFRESH_TOKEN', 'OAuth refresh_token');
    if (!extensionId) need('CWS_EXTENSION_ID', '扩展 ID');
    return chromeWebstoreUpload({
        extensionId,
        publisherId,
        clientId: process.env.CWS_CLIENT_ID,
        clientSecret: process.env.CWS_CLIENT_SECRET || undefined,
        refreshToken: process.env.CWS_REFRESH_TOKEN,
    });
}

/** listing 用:凭据缺失不致命(公开页抓取不凭据),返回 null 降级。 */
function tryBuildStore() {
    const ready = process.env.CWS_PUBLISHER_ID && process.env.CWS_CLIENT_ID
        && process.env.CWS_REFRESH_TOKEN
        && (process.env.CWS_EXTENSION_ID || extensionId);
    return ready ? buildStore() : null;
}

/** 候选产物路径(当前版本)。 */
function candidateZips() {
    return [
        `${REPO_ROOT}tmp/vBookmarks_${version}.zip`,
        `${REPO_ROOT}tmp/vBookmarks_edge_${version}.zip`,
    ];
}

/** 选择要上传的 zip:优先 --file;否则自动选 tmp/ 下当前版本产物。 */
function findZip(explicit) {
    if (explicit) {
        const abs = explicit.startsWith('/') ? explicit : `${REPO_ROOT}${explicit}`;
        if (!fs.existsSync(abs)) {
            console.error(`✖ --file 指定的文件不存在: ${abs}`);
            process.exit(2);
        }
        return abs;
    }
    const found = candidateZips().filter(p => fs.existsSync(p));
    if (!found.length) {
        console.error(`✖ 未找到 ${candidateZips()[0].split('/').pop()}。`);
        console.error(`  请先运行 python3 scripts/package.py,或用 --file 指定已有 zip。`);
        process.exit(2);
    }
    return found[0];
}

/** check 命令用:不 exit,返回第一个存在的候选,否则返回预期路径(供报告缺失)。 */
function checkZipPath() {
    return candidateZips().find(p => fs.existsSync(p)) ?? candidateZips()[0];
}

function parseArgs() {
    const argv = process.argv.slice(2);
    const cmd = argv[0] ?? 'help';
    const flags = {};
    for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--type') flags.type = argv[++i];
        else if (argv[i] === '--deploy') flags.deploy = Number(argv[++i]);
        else if (argv[i] === '--file') flags.file = argv[++i];
        else if (argv[i] === '--skip-check') flags.skipCheck = true;
        else if (argv[i] === '--yes') flags.yes = true;
    }
    if (flags.type && !PUBLISH_TYPES.has(flags.type)) {
        console.error(`✖ 未知 publishType: ${flags.type} (可选 ${[...PUBLISH_TYPES].join(' / ')})`);
        process.exit(2);
    }
    return { cmd, ...flags };
}

const METHODS = {
    check: { needStore: false, desc: 'git发布 前置校验(离线)' },
    status: { needStore: true, desc: '查询当前 item 状态' },
    upload: { needStore: true, desc: '上传 zip(不发布)' },
    publish: { needStore: true, desc: '发布草稿' },
    all: { needStore: true, desc: '上传并发布' },
    listing: { needStore: false, desc: '取回线上 listing 元信息(公开页快照 + item 状态;--yes 联网)' },
    'listing-draft': { needStore: false, desc: '生成 listing 更新草稿(离线,写 tmp/webstore/)' },
    help: { needStore: false, desc: '显示帮助' },
};

/** listing 输出目录。 */
const LISTING_DIR = `${REPO_ROOT}tmp/webstore`;

/** 读仓库语言文件里的商店文案。 */
function localeCopy(lang) {
    const p = `${REPO_ROOT}_locales/${lang}/messages.json`;
    return extractLocaleCopy(JSON.parse(fs.readFileSync(p, 'utf8')));
}

/**
 * listing — 「取回」:抓公开详情页(?hl=en / ?hl=zh-CN)解析 ld+json/og 元信息
 * 存快照;凭据齐时附带官方 item 状态;与仓库规范源(extName/extDesc)比对提示。
 * --yes 才联网;默认 dry-run 只打印将抓取的 URL。
 */
async function runListing(yes) {
    if (!extensionId) {
        console.error('✖ 无法推导 extensionId(manifest.homepage_url 缺失,且未设 CWS_EXTENSION_ID)。');
        process.exit(2);
    }
    console.log(`vBookmarks v${version} | extensionId=${extensionId}`);
    if (!yes) {
        console.log('\n[dry-run] 将执行:');
        console.log(`  - GET https://chromewebstore.google.com/detail/${extensionId}?hl=en    → 解析 → ${LISTING_DIR}/listing-current.en.json`);
        console.log(`  - GET https://chromewebstore.google.com/detail/${extensionId}?hl=zh-CN → 解析 → ${LISTING_DIR}/listing-current.zh-CN.json`);
        console.log('  - (凭据齐备时)items.fetchStatus 官方状态');
        console.log('加 --yes 真正执行。');
        return;
    }

    await installProxyIfNeeded();
    fs.mkdirSync(LISTING_DIR, { recursive: true });

    for (const hl of ['en', 'zh-CN']) {
        try {
            const { url, html } = await fetchDetailPage(extensionId, hl);
            const parsed = parseDetailPage(html);
            if (!parsed) {
                console.error(`⚠ ${hl}:详情页抓到了(${url})但解析不出 listing 元信息 — 页面结构可能已变,或被反爬页拦下。`);
                continue;
            }
            parsed.fetchedUrl = url;
            const out = `${LISTING_DIR}/listing-current.${hl}.json`;
            fs.writeFileSync(out, JSON.stringify(parsed, null, 2) + '\n');
            console.log(`\n[${hl}] ${parsed.name}`);
            console.log(`  描述(${parsed.description.length} 字符): ${parsed.description.slice(0, 100)}${parsed.description.length > 100 ? '…' : ''}`);
            console.log(`  版本: ${parsed.version || '?'} | 评分: ${parsed.ratingValue ?? '?'}(${parsed.ratingCount ?? '?'} 条)| 官方截图 ${parsed.screenshots.length} 张 · 页面图片直链 ${parsed.imageUrls.length} 条`);
            console.log(`  → 快照 ${out.replace(REPO_ROOT, '')}`);
        } catch (err) {
            console.error(`⚠ ${hl}:抓取失败: ${err.message}`);
            console.error('  (公开页偶尔要求人机验证;可浏览器打开详情页人工核对。)');
        }
    }

    const store = tryBuildStore();
    if (store) {
        try {
            const st = await store.get();
            const out = `${LISTING_DIR}/item-status.json`;
            fs.writeFileSync(out, JSON.stringify(st, null, 2) + '\n');
            console.log(`\n[status] uploadState=${st.lastAsyncUploadState ?? st.uploadState ?? '?'} → ${out.replace(REPO_ROOT, '')}`);
        } catch (err) {
            console.error(`⚠ item 状态查询失败: ${err.message}`);
        }
    } else {
        console.log('\n[status] 未配置 CWS_* 凭据,跳过官方 item 状态(只做了公开页快照)。');
    }

    // 与仓库规范源比对 — 名称/简介不一致即提示(发版常忘改商店文案)。
    const repo = localeCopy('en');
    const snapPath = `${LISTING_DIR}/listing-current.en.json`;
    if (fs.existsSync(snapPath)) {
        const live = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
        if (live.name && repo.name && live.name !== repo.name)
            console.log(`\n[diff] 名称不一致:线上「${live.name}」≠ 仓库 extName「${repo.name}」。`);
        if (live.description && repo.description && live.description !== repo.description)
            console.log(`[diff] 简介不一致:线上 ${live.description.length} 字符 ≠ 仓库 extDesc ${repo.description.length} 字符 — 若本次发版改了文案,记得同步 Dashboard(草稿见 listing-draft)。`);
    }
    console.log('\n完成。官方 API 不提供 listing 写端点 —— 更新请核对 listing-draft 产出后到 Dashboard 手动粘贴。');
}

/**
 * listing-draft — 「更新准备」(纯离线):从仓库规范源汇总双语文案 + 版本
 * what's-new + 截图册(带尺寸规格核对),生成可直接对照粘贴的草稿。
 */
function runListingDraft() {
    const manifestCopy = {
        name: manifest.name.startsWith('__MSG_') ? localeCopy('en').name : manifest.name,
        description: manifest.description.startsWith('__MSG_') ? localeCopy('en').description : manifest.description
    };
    const en = localeCopy('en');
    const zh = localeCopy('zh_CN');
    const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
    const readmeEn = read(`${REPO_ROOT}docs/README.md`);
    const readmeZh = read(`${REPO_ROOT}docs/README.zh.md`);
    const changelogEn = extractChangelogSection(readmeEn, version);
    const changelogZh = extractChangelogSection(readmeZh, version);
    const pitchEn = extractReadmePitch(readmeEn);
    const pitchZh = extractReadmePitch(readmeZh);
    const assets = fs.readdirSync(`${REPO_ROOT}assets/store`, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.png'))
        .map(e => {
            const size = pngSize(fs.readFileSync(`${REPO_ROOT}assets/store/${e.name}`));
            return { file: e.name, size };
        });

    const { json, mdEn, mdZh } = buildProposal({ version, en, zh, changelogEn, changelogZh, pitchEn, pitchZh, assets });

    fs.mkdirSync(LISTING_DIR, { recursive: true });
    fs.writeFileSync(`${LISTING_DIR}/listing-proposal.json`, JSON.stringify(json, null, 2) + '\n');
    fs.writeFileSync(`${LISTING_DIR}/listing-proposal.en.md`, mdEn);
    fs.writeFileSync(`${LISTING_DIR}/listing-proposal.zh-CN.md`, mdZh);

    console.log(`vBookmarks v${version} listing 更新草稿已生成:`);
    console.log(`  ${LISTING_DIR}/listing-proposal.en.md`);
    console.log(`  ${LISTING_DIR}/listing-proposal.zh-CN.md`);
    console.log(`  ${LISTING_DIR}/listing-proposal.json`);
    if (manifestCopy.description.length > 132)
        console.error(`⚠ extDesc ${manifestCopy.description.length}/132 字符,超出 manifest/CWS 上限 — 先修 _locales。`);
    for (const s of json.screenshots.filter(x => x.spec))
        console.log(`  ✓ ${s.file} ${s.width}×${s.height}(${s.spec})`);
    for (const s of json.screenshots.filter(x => !x.spec))
        console.log(`  ⚠ ${s.file} ${s.width ?? '?'}×${s.height ?? '?'} 非标准尺寸(截图规格 1280×800 / 640×400;marquee 1400×560;小图 440×280)`);
    console.log('\n人工核对后粘贴到 Developer Dashboard → Store listing;线上现值可用 listing --yes 快照比对。');
}

async function main() {
    const { cmd, type, deploy, file, skipCheck, yes } = parseArgs();
    if (!METHODS[cmd]) {
        console.error(`✖ 未知命令 ${cmd}`);
        console.error(await helpText());
        process.exit(2);
    }
    if (cmd === 'help') {
        console.log(await helpText());
        return;
    }

    // 变更类命令(上传/发布/全部)与 check 都要跑 git发布 前置校验;
    // --skip-check 时跳过整个校验(仅限显式上传草稿等场景,check 命令本身不受影响)。
    const needsCheck = ['upload', 'publish', 'all', 'check'].includes(cmd);
    if (needsCheck && !skipCheck) {
        const zip = cmd === 'check' ? checkZipPath() : findZip(file);
        const { issues, warnings } = await gitReleaseCheck(zip);
        for (const w of warnings) console.error(`[warn] ${w}`);
        if (issues.length) {
            console.error(`\n✖ 商店发布前置校验失败 — git发布 尚未完成:`);
            for (const i of issues) console.error(`  - ${i}`);
            console.error(`\n  请先完成「git发布」(版本跃进→changelog→commit→tag→package.py),`);
            console.error(`  或确认无误后加 --skip-check 跳过(仅限显式上传草稿等场景)。`);
            process.exit(3);
        }
        if (cmd === 'check') {
            console.log(`✔ git发布 已就绪: tag=${maxGitTag()} 与 manifest ${version} 一致,产物齐全。`);
            return;
        }
    }

    // listing 两命令不走产物 zip 路径(listing-draft 纯离线,listing 只读)。
    if (cmd === 'listing') return runListing(yes);
    if (cmd === 'listing-draft') return runListingDraft();

    const store = METHODS[cmd].needStore ? buildStore() : null;
    const zip = findZip(file);
    console.log(`vBookmarks v${version} | extensionId=${extensionId}`);
    console.log(`产物: ${zip}`);
    if (file) console.log(`(--file 指定)`);

    if (!yes) {
        console.log(`\n[dry-run] 将执行: ${METHODS[cmd].desc}`);
        if (cmd === 'publish') {
            const target = type ?? 'DEFAULT_PUBLISH';
            console.log(`          publishType=${target}${deploy ? `, deploy=${deploy}` : ''}`);
            console.log(`          ${publishTargetNote(type)}`);
            if (target === 'TRUSTED_TESTERS') printTestersHint();
        }
        if (cmd === 'all') console.log('          上传 zip → 发布(共用一次 access_token)');
        console.log('加 --yes 真正执行。');
        return;
    }

    await installProxyIfNeeded();

    try {
        if (cmd === 'status') {
            const res = await store.get();
            console.log('\n当前 item 状态:', JSON.stringify(res, null, 2));
        } else if (cmd === 'upload') {
            const res = await store.uploadExisting(zip, undefined, 120);
            console.log('\n上传结果:', JSON.stringify(res, null, 2));
        } else if (cmd === 'publish') {
            const target = type ?? 'DEFAULT_PUBLISH';
            if (target === 'TRUSTED_TESTERS') printTestersHint();
            const res = await store.publish(target, undefined, deploy);
            console.log('\n发布结果:', JSON.stringify(res, null, 2));
        } else if (cmd === 'all') {
            const token = await store.fetchToken();
            const up = await store.uploadExisting(zip, token, 120);
            console.log('\n上传结果:', JSON.stringify(up, null, 2));
            const target = type ?? 'DEFAULT_PUBLISH';
            if (target === 'TRUSTED_TESTERS') printTestersHint();
            const pub = await store.publish(target, token, deploy);
            console.log('\n发布结果:', JSON.stringify(pub, null, 2));
        }
        console.log('\n完成。下一次发版记得先 git发布(打新 tag)再商店发布。');
    } catch (err) {
        console.error('\n✖ 发布失败:', err?.message ?? err);
        process.exitCode = 1;
    }
}

async function helpText() {
    return `发布流程 = git发布 + 商店发布。本脚本是「商店发布」。

用法:
  node scripts/webstore/publish.js check                        git发布 前置校验(离线)
  node scripts/webstore/publish.js status                       查询当前状态
  node scripts/webstore/publish.js upload [--file 路径]         上传产物
  node scripts/webstore/publish.js publish [--type T] [--deploy N]
  node scripts/webstore/publish.js all [--deploy N] [--file 路径] 上传 + 发布
  node scripts/webstore/publish.js listing [--yes]              取回线上 listing 元信息快照
  node scripts/webstore/publish.js listing-draft                生成 listing 更新草稿(离线)
  node scripts/webstore/publish.js help

listing(元信息):
  官方 CWS API V2 不提供 listing(名称/简介/详述/截图)读写端点,因此:
  - listing       抓公开详情页(?hl=en / zh-CN)解析快照到 tmp/webstore/,
                  附官方 item 状态(需凭据),并与仓库 extName/extDesc 比对;
  - listing-draft 从规范源(_locales、docs README、assets/store)生成
                  listing-proposal.{en,zh-CN}.md + .json,人工核对后粘贴进
                  Developer Dashboard → Store listing。

参数:
  --file 路径  指定要上传的 zip(默认自动选 tmp/vBookmarks_<version>.zip)
  --type T     DEFAULT_PUBLISH(默认·发布给所有人) | TRUSTED_TESTERS(灰度给测试用户)
               | STAGED_PUBLISH(分阶段发布)
  --deploy N   灰度百分比(需 >10000 周活,V2 免重新审核;仅配 STAGED_PUBLISH)
  --skip-check 跳过 git发布 前置校验(仅限显式上传草稿等场景)
  --yes        真正执行(否则 dry-run)

测试用户灰度:
  publish --type TRUSTED_TESTERS  只发布给测试用户(恢复所有人用 --type DEFAULT_PUBLISH)
  测试用户列表来自 CWS_TRUSTED_TESTERS(逗号分隔邮箱),未配置时默认 windviki@gmail.com;
  发布时脚本打印列表供核对 —— CWS API 无法代管测试者邮箱,列表须在 Dashboard
  → Users and permissions → Testers 手动维护(Editor 角色可管理)。

凭据: 环境变量 CWS_* 优先,否则读仓库根 .env(git-ignored):
  CWS_PUBLISHER_ID CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN
  (CWS_EXTENSION_ID 可选,默认从 manifest.homepage_url 推导)
凭据申请与说明见 scripts/webstore/README.md。`;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    main().catch(e => {
        console.error('✖ 未捕获错误:', e);
        process.exit(1);
    });
}
