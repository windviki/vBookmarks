#!/usr/bin/env node
/**
 * upload-test.js — 验证 chrome-webstore-upload@6.0.0 (CWS V2 API) 发布机制。
 *
 * 全部离线运行:mock 全局 fetch,不触碰真实 CWS API,也不需要真实凭据。
 * 同时校验 vBookmarks 现有打包产物 tmp/vBookmarks_<ver>.zip 是否符合 CWS 上传要求。
 *
 * 运行:  node tmp/webstore/upload-test.js
 *
 * 说明: 本文件位于 git-ignored 的 tmp/ 下,机制不进入 repo。
 *       真实发布用 publish.js(需 CWS_V2_* 环境变量),见 webstore-publish-plan.md。
 */

import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import chromeWebstoreUpload from 'chrome-webstore-upload';

/** 仓库根 = 本文件 (tmp/webstore/upload-test.js) 上溯两级 */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// ---------------------------------------------------------------------------
// Mock fetch 工具
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const requests = [];
let nextResponses = [];

/** 把默认响应压入队列(按调用顺序出队); 未设置时返回 200 {} */
function queueResponse(status, body, ok = status >= 200 && status < 300) {
    nextResponses.push({
        status,
        ok,
        json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    });
}

function installMockFetch() {
    requests.length = 0;        // 重置跨测试状态
    nextResponses = [];
    globalThis.fetch = async (url, init = {}) => {
        const rec = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, bodyIsStream: typeof init.body === 'object' && init.body !== null && typeof init.body.pipe === 'function' };
        if (init.body && !rec.bodyIsStream) {
            rec.body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
        }
        requests.push(rec);
        const resp = nextResponses.shift() ?? { status: 200, ok: true, json: async () => ({}), text: async () => '{}' };
        return resp;
    };
}

function restoreFetch() {
    globalThis.fetch = realFetch;
}

const FAKE = {
    extensionId: 'odhjcodnoebmndcihdedenkmdmklpihb',
    publisherId: 'p12345678901234567890',
    clientId: 'abc.apps.googleusercontent.com',
    clientSecret: 's3cret',
    refreshToken: 'r3fr3sh',
};

function makeClient() {
    return chromeWebstoreUpload({ ...FAKE });
}

// ---------------------------------------------------------------------------
// 客户端构造与必填字段
// ---------------------------------------------------------------------------

describe('client 构造', () => {
    test('缺失必填字段时抛错', () => {
        for (const missing of ['extensionId', 'publisherId', 'clientId', 'refreshToken']) {
            const opts = { ...FAKE };
            delete opts[missing];
            assert.throws(() => chromeWebstoreUpload(opts), new RegExp(missing));
        }
    });

    test('clientSecret 可选(新 V2 流程允许 desktop/playground 场景)', () => {
        const { clientSecret, ...rest } = FAKE;
        const client = chromeWebstoreUpload(rest);
        assert.ok(client);
    });

    test('需要 Node 18.17+ (全局 fetch) —— 当前环境满足', () => {
        assert.equal(typeof fetch, 'function');
        const major = Number(process.versions.node.split('.')[0]);
        assert.ok(major >= 18, `Node ${process.versions.node} 太低`);
    });
});

// ---------------------------------------------------------------------------
// V2 端点 URL 构造
// ---------------------------------------------------------------------------

describe('CWS V2 端点 URL(v6.0.0 应指向 chromewebstore.googleapis.com)', () => {
    before(() => installMockFetch());
    after(() => restoreFetch());

    test('upload 端点: POST /upload/v2/publishers/{pub}/items/{ext}:upload', async () => {
        queueResponse(200, { uploadState: 'SUCCESS' });
        const client = makeClient();
        await client.uploadExisting(createReadStream('/dev/null'));
        const req = requests.find(r => r.url.includes(':upload'));
        assert.ok(req, '应发出 upload 请求');
        assert.equal(req.method, 'POST');
        assert.match(req.url, /^https:\/\/chromewebstore\.googleapis\.com\/upload\/v2\/publishers\/p12345678901234567890\/items\/odhjcodnoebmndcihdedenkmdmklpihb:upload$/);
    });

    test('publish 端点: POST /v2/publishers/{pub}/items/{ext}:publish', async () => {
        queueResponse(200, {});
        const client = makeClient();
        await client.publish();
        const req = requests.find(r => r.url.includes(':publish'));
        assert.ok(req);
        assert.match(req.url, /^https:\/\/chromewebstore\.googleapis\.com\/v2\/publishers\/p12345678901234567890\/items\/odhjcodnoebmndcihdedenkmdmklpihb:publish$/);
        assert.match(req.body, /"publishType":"DEFAULT_PUBLISH"/);
    });

    test('fetchStatus 端点: GET /v2/publishers/{pub}/items/{ext}:fetchStatus', async () => {
        queueResponse(200, {});
        const client = makeClient();
        await client.get();
        const req = requests.find(r => r.url.includes(':fetchStatus'));
        assert.ok(req);
        assert.equal(req.method, 'GET');
        assert.match(req.url, /^https:\/\/chromewebstore\.googleapis\.com\/v2\/publishers\/p12345678901234567890\/items\/odhjcodnoebmndcihdedenkmdmklpihb:fetchStatus$/);
    });

    test('setDeployPercentage 端点: ...:setPublishedDeployPercentage', async () => {
        queueResponse(200, {});
        const client = makeClient();
        await client.setDeployPercentage(50);
        const req = requests.find(r => r.url.includes(':setPublishedDeployPercentage'));
        assert.ok(req);
        assert.match(req.body, /"deployPercentage":50/);
    });
});

// ---------------------------------------------------------------------------
// 认证(token 刷新)
// ---------------------------------------------------------------------------

describe('OAuth token 刷新', () => {
    before(() => installMockFetch());
    after(() => restoreFetch());

    test('向 oauth2/v4/token 发 refresh_token 请求,返回 access_token', async () => {
        queueResponse(200, { access_token: 'ACCESS-1', expires_in: 3600 });
        const client = makeClient();
        const token = await client.fetchToken();
        assert.equal(token, 'ACCESS-1');
        const req = requests[0];
        assert.match(req.url, /^https:\/\/www\.googleapis\.com\/oauth2\/v4\/token$/);
        assert.match(req.body, /"grant_type":"refresh_token"/);
        assert.match(req.body, /"client_id":"abc\.apps\.googleusercontent\.com"/);
    });

    test('无 clientSecret 时 token 请求体不含 client_secret', async () => {
        queueResponse(200, { access_token: 'ACCESS-2' });
        const { clientSecret, ...rest } = FAKE;
        const client = chromeWebstoreUpload(rest);
        await client.fetchToken();
        assert.ok(!requests.at(-1).body.includes('client_secret'));
    });
});

// ---------------------------------------------------------------------------
// 上传流程(含 IN_PROGRESS → fetchStatus 轮询)
// ---------------------------------------------------------------------------

describe('上传流程', () => {
    before(() => installMockFetch());
    after(() => restoreFetch());

    test('上传请求头含 raw 协议与文件名;body 为流', async () => {
        queueResponse(200, { access_token: 'ACCESS-1' });
        queueResponse(200, { uploadState: 'SUCCESS', itemId: 'ITEM1' });
        const client = makeClient();
        await client.uploadExisting(createReadStream('/dev/null'));
        const req = requests.find(r => r.url.includes(':upload'));
        assert.equal(req.headers['X-Goog-Upload-Protocol'], 'raw');
        assert.equal(req.headers['X-Goog-Upload-File-Name'], 'extension.zip');
        assert.ok(req.bodyIsStream, '上传 body 应是流(避免整包读入内存)');
        assert.equal(req.headers.Authorization, 'Bearer ACCESS-1');
    });

    test('IN_PROGRESS 时自动 fetchStatus 直至 SUCCESS', async () => {
        // token(主) → 上传 IN_PROGRESS → token(fetchStatus 再取一次) → fetchStatus SUCCESS
        queueResponse(200, { access_token: 'T1' });
        queueResponse(200, { uploadState: 'IN_PROGRESS', itemId: 'ITEM1', name: 'vBookmarks', crxVersion: '3.1' });
        queueResponse(200, { access_token: 'T2' });
        queueResponse(200, { lastAsyncUploadState: 'SUCCESS' });
        const client = makeClient();
        const res = await client.uploadExisting(createReadStream('/dev/null'), undefined, 10);
        assert.equal(res.uploadState, 'SUCCESS');
        assert.ok(requests.some(r => r.url.includes(':fetchStatus')), '应发生状态轮询');
    });

    test('非 2xx 抛 CWSError', async () => {
        queueResponse(403, { error: { message: 'forbidden' } }, false);
        const client = makeClient();
        await assert.rejects(() => client.uploadExisting(createReadStream('/dev/null')), /forbidden/);
    });
});

// ---------------------------------------------------------------------------
// 发布流程(publishType 归一化 / 分阶段发布 / 分阶段百分比)
// ---------------------------------------------------------------------------

describe('发布流程', () => {
    before(() => installMockFetch());
    after(() => restoreFetch());

    test("'default' → DEFAULT_PUBLISH (兼容 2022 文章写法)", async () => {
        queueResponse(200, {});
        const client = makeClient();
        await client.publish('default');
        assert.match(requests.at(-1).body, /"publishType":"DEFAULT_PUBLISH"/);
    });

    test("'trustedTesters' → TRUSTED_TESTERS", async () => {
        queueResponse(200, {});
        const client = makeClient();
        await client.publish('trustedTesters');
        assert.match(requests.at(-1).body, /"publishType":"TRUSTED_TESTERS"/);
    });

    test('STAGED_PUBLISH 原样透传(V2 新能力)', async () => {
        queueResponse(200, {});
        const client = makeClient();
        await client.publish('STAGED_PUBLISH');
        assert.match(requests.at(-1).body, /"publishType":"STAGED_PUBLISH"/);
    });

    test('指定 deployPercentage 时附带 deployInfos(V2:免重新审核改灰度)', async () => {
        queueResponse(200, {});
        const client = makeClient();
        await client.publish('DEFAULT_PUBLISH', undefined, 25);
        assert.match(requests.at(-1).body, /"deployInfos":\[\{"deployPercentage":25\}\]/);
    });
});

// ---------------------------------------------------------------------------
// 打包产物 CWS 合规校验(离线,读 tmp/vBookmarks_<ver>.zip)
// ---------------------------------------------------------------------------

describe('vBookmarks 打包产物 CWS 合规校验', () => {
    const manifest = JSON.parse(fs.readFileSync(`${REPO_ROOT}manifest.json`, 'utf8'));
    const version = manifest.version;
    const zipPath = `${REPO_ROOT}tmp/vBookmarks_${version}.zip`;
    const hasZip = fs.existsSync(zipPath);

    test('package.py 产物存在', () => {
        assert.ok(hasZip, `未找到 ${zipPath} — 请先运行 python3 scripts/package.py`);
    });

    test('zip 根目录含 manifest.json(非嵌套目录)', { skip: !hasZip }, async () => {
        const entries = await readZipEntries(zipPath);
        assert.ok(entries.includes('manifest.json'), `manifest.json 必须在 zip 根:${entries.slice(0, 20)}`);
        assert.ok(!entries.some(e => e.startsWith('package/')), '不应包进一层外层目录');
    });

    test('manifest 可解析且 version 与仓库一致', { skip: !hasZip }, async () => {
        const zipManifest = JSON.parse(await readZipText(zipPath, 'manifest.json'));
        assert.equal(zipManifest.version, version);
        assert.equal(zipManifest.manifest_version, 3);
        assert.ok(zipManifest.name, 'name 必填');
        assert.ok(zipManifest.icons && zipManifest.icons['128'], 'icons.128 必填');
    });

    test('description <= 132 字符(CWS 硬限制)', () => {
        const desc = manifest.description;
        if (desc.startsWith('__MSG_')) {
            const en = JSON.parse(fs.readFileSync(`${REPO_ROOT}_locales/en/messages.json`, 'utf8')).extDesc?.message ?? '';
            assert.ok(en.length <= 132, `en description ${en.length} 超 132`);
        } else {
            assert.ok(desc.length <= 132);
        }
    });

    test('图标文件存在于 zip', { skip: !hasZip }, async () => {
        const entries = await readZipEntries(zipPath);
        for (const icon of ['assets/icons/icon16.png', 'assets/icons/icon48.png', 'assets/icons/icon128.png']) {
            assert.ok(entries.includes(icon), `缺少图标 ${icon}`);
        }
    });

    test('权限清单快照(供审核自查,见方案文档 §合规清单)', () => {
        console.log('  permissions:', JSON.stringify(manifest.permissions));
        console.log('  host_permissions:', JSON.stringify(manifest.host_permissions));
        console.log('  optional_permissions:', JSON.stringify(manifest.optional_permissions));
        const flags = [];
        if (manifest.host_permissions?.includes('<all_urls>')) flags.push('⚠ <all_urls> — 审核高风险,需在 listing 给出理由');
        if (manifest.permissions?.includes('proxy')) flags.push('⚠ proxy — 不常用权限,需解释用途');
        if (manifest.permissions?.includes('tabs')) flags.push('ℹ tabs — 确认确实用到 url/title 读取');
        for (const f of flags) console.log('  ' + f);
        assert.ok(true);
    });
});

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

async function readZipEntries(zipPath) {
    const { default: yauzl } = await import('yauzl');
    return new Promise((resolve, reject) => {
        const entries = [];
        yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
            if (err) return reject(err);
            zip.readEntry();
            zip.on('entry', (entry) => {
                entries.push(entry.fileName);
                zip.readEntry();
            });
            zip.on('end', () => resolve(entries));
            zip.on('error', reject);
        });
    });
}

async function readZipText(zipPath, name) {
    const { default: yauzl } = await import('yauzl');
    return new Promise((resolve, reject) => {
        yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
            if (err) return reject(err);
            zip.readEntry();
            zip.on('entry', (entry) => {
                if (entry.fileName !== name) return zip.readEntry();
                zip.openReadStream(entry, (e, stream) => {
                    if (e) return reject(e);
                    let buf = '';
                    stream.setEncoding('utf8');
                    stream.on('data', (c) => (buf += c));
                    stream.on('end', () => resolve(buf));
                });
            });
            zip.on('error', reject);
        });
    });
}

// yauzl 用于离线读取本地 zip,不涉及 CWS API
