#!/usr/bin/env node
/**
 * vBookmarks dist build — 4.1.0（docs/plan-4.1.0/build-and-performance-plan.md §2.5）
 *
 *   ESM 入口：esbuild bundle → Terser(minify, module:true) → dist 同名同路径
 *   经典脚本：Terser(minify, module:false, 不 bundle) → dist 同名同路径
 *   静态文件：原样复制（manifest / pages / css / images / meta / _locales）
 *
 * 构建即自检（§3.1）：任一检查失败即非零退出；CI 与本地共用同一入口。
 */
import { build } from 'esbuild';
import { minify } from 'terser';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const files = JSON.parse(readFileSync(join(ROOT, 'scripts', 'runtime-files.json'), 'utf8'));

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const mkdirp = p => mkdirSync(p, { recursive: true });
const walkRel = (base, dir) => {
  const out = [];
  const walk = d => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(base, p).split('\\').join('/'));
    }
  };
  walk(dir);
  return out;
};

// ---------- 0) 清空 dist ----------
rmSync(DIST, { recursive: true, force: true });

// ---------- 1) 静态文件复制 ----------
const staticFiles = ['manifest.json', ...files.html, ...files.css, ...files.images, ...files.meta];
for (const arc of staticFiles) {
  const src = join(ROOT, arc);
  check(existsSync(src), `source missing: ${arc}`);
  const dst = join(DIST, arc);
  mkdirp(dirname(dst));
  cpSync(src, dst);
}
cpSync(join(ROOT, '_locales'), join(DIST, '_locales'), { recursive: true });

// ---------- 2) ESM 入口：esbuild bundle → Terser ----------
for (const entry of files.esmEntries) {
  const result = await build({
    entryPoints: [join(ROOT, entry)],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    write: false,
    minify: false,
    logLevel: 'silent',
  });
  const { code } = await minify(result.outputFiles[0].text, {
    module: true, toplevel: false, compress: true, mangle: true,
    format: { comments: false },
  });
  const dst = join(DIST, entry);
  mkdirp(dirname(dst));
  writeFileSync(dst, code);
}

// ---------- 3) 经典脚本：Terser（不 bundle） ----------
for (const file of files.classicJs) {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const { code } = await minify(src, {
    module: false, toplevel: false, compress: true, mangle: true,
    format: { comments: false },
  });
  const dst = join(DIST, file);
  mkdirp(dirname(dst));
  writeFileSync(dst, code);
}

// ---------- 4) 构建即自检 ----------
// 4.1 manifest 契约：SW 指向存在且属于 esmEntries；dist/source 版本一致
const distManifest = JSON.parse(readFileSync(join(DIST, 'manifest.json'), 'utf8'));
const srcManifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const sw = distManifest.background && distManifest.background.service_worker;
check(typeof sw === 'string' && existsSync(join(DIST, sw)), `manifest service_worker missing in dist: ${sw}`);
check(files.esmEntries.includes(sw), `service_worker ${sw} not in esmEntries`);
check(distManifest.version === srcManifest.version, `manifest version mismatch: dist ${distManifest.version} vs src ${srcManifest.version}`);

// 4.2 清单交叉校验（§2.4）：classic/esm 无交集、无重复
const inter = files.classicJs.filter(f => files.esmEntries.includes(f));
check(inter.length === 0, `classicJs/esmEntries overlap: ${inter.join(', ')}`);
const allJs = new Set([...files.classicJs, ...files.esmEntries]);
check(allJs.size === files.classicJs.length + files.esmEntries.length, 'classicJs/esmEntries contains duplicates');

// 4.3 bundle 自包含：无 import/export 残留
const residueRe = /(^|[;{}])\s*(?:import|export)\s+(?:["'{*]|default|\{|\*)|import\s*\(\s*['"]/;
const residue = files.esmEntries.filter(entry => residueRe.test(readFileSync(join(DIST, entry), 'utf8')));
check(residue.length === 0, `import/export residue in bundles: ${residue.join(', ')}`);

// 4.4 全局契约属性名（近似静态检查，最终裁决在 dist 真机冒烟，见 §3.1 注记）
const contracts = ['store', 'getSetting', 'setSetting', 'removeSetting', 'VBMI18N', 'VBMSort', 'syncManager', 'VBMUsage', 'CodeMirror', 'VBMFuzzy'];
const allJsText = [...allJs].map(f => readFileSync(join(DIST, f), 'utf8')).join('\n');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const missingContracts = contracts.filter(n => !new RegExp(`\\b${esc(n)}\\b`).test(allJsText));
check(missingContracts.length === 0, `global contract names missing from dist JS: ${missingContracts.join(', ')}`);

// 4.5 dist 的 src/vendor 下只允许 15 个 JS（bundle 吞掉的内部模块不得残留）
const extraJs = [];
for (const dir of ['src', 'vendor']) {
  const abs = join(DIST, dir);
  if (!existsSync(abs)) continue;
  for (const name of readdirSync(abs)) {
    if (!name.endsWith('.js')) continue;
    const arc = dir + '/' + name;
    if (!allJs.has(arc)) extraJs.push(arc);
  }
}
check(extraJs.length === 0, `unexpected JS files in dist: ${extraJs.join(', ')}`);

// 4.6 静态文件与 _locales 完整性
for (const arc of staticFiles) check(existsSync(join(DIST, arc)), `dist missing: ${arc}`);
const srcLocales = walkRel(ROOT, join(ROOT, '_locales')).sort();
const distLocales = walkRel(DIST, join(DIST, '_locales')).sort();
check(srcLocales.length > 0 && srcLocales.length === distLocales.length && srcLocales.every((f, i) => f === distLocales[i]),
  `_locales mismatch: src ${srcLocales.length} vs dist ${distLocales.length}`);

// ---------- 5) 汇总 ----------
const totalFiles = walkRel(DIST, DIST).length;
console.log(`dist built: ${totalFiles} files, ${allJs.size} JS (${files.esmEntries.length} bundles + ${files.classicJs.length} classic)`);
if (totalFiles !== 79) console.log(`note: dist total files = ${totalFiles} (zip budget 79)`);

if (failures.length) {
  console.error(`\nBUILD SELF-CHECK FAILED (${failures.length}):`);
  for (const f of failures) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log('build self-check: PASS');
