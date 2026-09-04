import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { build, embedIconFonts } from '../scripts/build.mjs';
import { compareVersions, repository } from '../scripts/lib.mjs';
import { extractPackage, verifyIntegrity } from '../scripts/update-eruda.mjs';

test('同一输入离线构建可复现，并包含完整源码、许可证及正确更新 URL', async () => {
  const output = await mkdtemp(join(tmpdir(), 'eruda-build-test-'));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('构建不得联网'); };
  try {
    const first = await build({ repo: 'example/mobile-debug', output });
    const source = await readFile(join(output, 'eruda-offline.user.js'), 'utf8');
    const second = await build({ repo: 'example/mobile-debug', output });
    assert.deepEqual(second, first);
    assert.ok(source.length > 400_000);
    assert.match(source, /Copyright \(c\) 2016-present liriliri/);
    assert.match(source, /@downloadURL\s+https:\/\/github.com\/example\/mobile-debug\/releases\/latest\/download\/eruda-offline.user.js/);
    assert.match(source, /@version\s+\d+\.\d+\.\d+\.\d+\.\d+\.\d+/);
    assert.match(source, /@grant\s+GM_unregisterMenuCommand/);
    assert.match(source, /@grant\s+GM\.unregisterMenuCommand/);
    assert.doesNotMatch(source, /^\/\/\s*@(require|resource)\s/m);
    assert.equal(/^\/\/[#@] sourceMappingURL=/m.test(source), false);
    assert.doesNotMatch(source, /ERUDA_VENDOR|ELEMENTS_EDITOR|ICON_FONTS|PAGE_MAIN|__SCRIPT_VERSION__|__ERUDA_VERSION__/);
    assert.doesNotMatch(source, /@font-face/);
    const meta = await readFile(join(output, 'eruda-offline.meta.js'), 'utf8');
    assert.ok(source.startsWith(meta));
  } finally { globalThis.fetch = originalFetch; }
});

test('提取全部上游字体并保留原始 WOFF 数据，未知格式拒绝构建', async () => {
  const source = await readFile(new URL('../vendor/eruda.js', import.meta.url), 'utf8');
  const { code, fonts } = embedIconFonts(source);
  const original = [...source.matchAll(/@font-face\{[^}]+\}/g)];
  assert.equal(fonts.length, original.length);
  assert.ok(fonts.some(({ family }) => family === 'eruda-offline-eruda-icon'));
  for (const [index, { family, data }] of fonts.entries()) {
    assert.ok(original[index][0].includes(data));
    assert.equal(Buffer.from(data, 'base64').subarray(0, 4).toString(), 'wOFF');
    assert.ok(code.includes(`font-family:${family}`));
  }
  assert.doesNotMatch(code, /@font-face|data:application\/x-font-woff/);
  assert.ok(code.includes('[class^=eruda-icon-]'), '字体改名不改变工具栏图标的 class 选择器');
  assert.throws(() => embedIconFonts(''), /未找到/);
  assert.throws(() => embedIconFonts('@font-face{font-family:changed;src:url(remote.woff)}'), /无法识别/);
});

test('版本按数字比较，拒绝预发布版本和不合法仓库', () => {
  assert.equal(compareVersions('3.10.0', '3.9.9'), 1);
  assert.equal(compareVersions('4.0.0', '3.99.99'), 1);
  assert.equal(compareVersions('3.4.3', '3.4.3'), 0);
  assert.throws(() => compareVersions('3.4.3-beta', '3.4.3'));
  assert.throws(() => repository('owner/repo\n// @require evil'));
});

test('SHA-512 校验能检测被修改的 npm 下载', () => {
  const bytes = Buffer.from('upstream');
  const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  verifyIntegrity(bytes, integrity);
  assert.throws(() => verifyIntegrity(Buffer.from('changed'), integrity));
  assert.throws(() => verifyIntegrity(bytes, 'sha1-ignored'));
});

function archive(entries) {
  const buffers = [];
  for (const [name, content] of entries) {
    const bytes = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    header[156] = 48;
    buffers.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...buffers, Buffer.alloc(1024)]));
}

test('归档只提取固定文件，忽略路径穿越并拒绝缺失、重复或损坏文件', () => {
  const entries = [['package/eruda.js', 'module.exports = {};'], ['package/package.json', '{}']];
  const result = extractPackage(archive([...entries, ['../../outside', 'ignored']]));
  assert.equal(result.size, 2);
  assert.equal(result.get('package/package.json').toString(), '{}');
  assert.throws(() => extractPackage(archive(entries.slice(0, 1))));
  assert.throws(() => extractPackage(archive([...entries, entries[0]])));
  assert.throws(() => extractPackage(Buffer.from('broken')));
});
