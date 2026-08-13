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
 *   node scripts/webstore/publish.js help
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
import { fileURLToPath } from 'node:url';
import chromeWebstoreUpload from 'chrome-webstore-upload';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(`${REPO_ROOT}manifest.json`, 'utf8'));
const version = manifest.version;

// ---------------------------------------------------------------------------
// .env 加载(与 scripts/i18n.py#load_dotenv 同规则:真实环境变量优先)
// ---------------------------------------------------------------------------

function loadDotenv() {
    try {
        const text = fs.readFileSync(`${REPO_ROOT}.env`, 'utf8');
        for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
            const idx = trimmed.indexOf('=');
            const key = trimmed.slice(0, idx).trim();
            const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            if (key && !(key in process.env)) process.env[key] = value;
        }
    } catch { /* .env 不存在时静默 */ }
}
loadDotenv();

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
    help: { needStore: false, desc: '显示帮助' },
};

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

    // 变更类命令(上传/发布/全部)与 check 都要跑 git发布 前置校验
    const needsCheck = ['upload', 'publish', 'all', 'check'].includes(cmd);
    if (needsCheck) {
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

    const store = METHODS[cmd].needStore ? buildStore() : null;
    const zip = cmd === 'check' ? null : findZip(file);
    console.log(`vBookmarks v${version} | extensionId=${extensionId}`);
    console.log(`产物: ${zip}`);
    if (file) console.log(`(--file 指定)`);

    if (!yes) {
        console.log(`\n[dry-run] 将执行: ${METHODS[cmd].desc}`);
        if (cmd === 'publish') console.log(`          publishType=${type ?? 'DEFAULT_PUBLISH'}${deploy ? `, deploy=${deploy}` : ''}`);
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
            const res = await store.publish(type ?? 'DEFAULT_PUBLISH', undefined, deploy);
            console.log('\n发布结果:', JSON.stringify(res, null, 2));
        } else if (cmd === 'all') {
            const token = await store.fetchToken();
            const up = await store.uploadExisting(zip, token, 120);
            console.log('\n上传结果:', JSON.stringify(up, null, 2));
            const pub = await store.publish(type ?? 'DEFAULT_PUBLISH', token, deploy);
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
  node scripts/webstore/publish.js help

参数:
  --file 路径  指定要上传的 zip(默认自动选 tmp/vBookmarks_<version>.zip)
  --type T     DEFAULT_PUBLISH(默认) | TRUSTED_TESTERS | STAGED_PUBLISH
  --deploy N   灰度百分比(需 >10000 周活,V2 免重新审核)
  --skip-check 跳过 git发布 前置校验(仅限显式上传草稿等场景)
  --yes        真正执行(否则 dry-run)

凭据: 环境变量 CWS_* 优先,否则读仓库根 .env(git-ignored):
  CWS_PUBLISHER_ID CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN
  (CWS_EXTENSION_ID 可选,默认从 manifest.homepage_url 推导)
凭据申请与说明见 scripts/webstore/README.md。`;
}

main().catch(e => {
    console.error('✖ 未捕获错误:', e);
    process.exit(1);
});
