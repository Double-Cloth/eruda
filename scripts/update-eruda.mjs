import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { path, readJson, writeJson, sha256, stableVersion, compareVersions } from './lib.mjs';

// 只提取两个已知文件，不把远端归档中的路径写入磁盘，也不执行 npm 生命周期脚本。
export function extractPackage(archive) {
  const tar = gunzipSync(archive, { maxOutputLength: 32 * 1024 * 1024 });
  const wanted = new Set(['package/eruda.js', 'package/package.json']);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString().replace(/\0.*$/s, '');
    const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0.*$/s, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) {
      throw new Error('无效的 npm tar 归档。');
    }
    const type = header[156];
    if (wanted.has(name) && (type === 0 || type === 48)) {
      if (files.has(name)) throw new Error(`归档文件重复：${name}`);
      files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  for (const name of wanted) if (!files.has(name)) throw new Error(`归档缺少 ${name}`);
  return files;
}

export function verifyIntegrity(bytes, integrity) {
  const match = /^sha512-([A-Za-z0-9+/]+=*)$/.exec(integrity || '');
  if (!match) throw new Error('npm 未提供可验证的 SHA-512 完整性信息。');
  const expected = Buffer.from(match[1], 'base64');
  const actual = createHash('sha512').update(bytes).digest();
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Eruda 下载完整性校验失败。');
  }
}

async function download(url, maxBytes) {
  const parsed = new URL(url);
  if (!['https://registry.npmjs.org', 'https://raw.githubusercontent.com'].includes(parsed.origin)) {
    throw new Error('只接受官方 npm registry 和 GitHub 原始文件下载。');
  }
  const response = await fetch(parsed, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (!response.ok) throw new Error(`下载失败：HTTP ${response.status} ${url}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('下载超过大小限制。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 2 && args[0] === '--version')) {
    throw new Error('用法：npm run update:eruda -- [--version x.y.z]');
  }
  const requested = args[1] ? stableVersion(args[1]) : 'latest';
  const metadata = JSON.parse((await download(`https://registry.npmjs.org/eruda/${requested}`, 2 * 1024 * 1024)).toString());
  if (metadata.name !== 'eruda') throw new Error('包名不匹配。');
  stableVersion(metadata.version);
  let previous;
  try { previous = await readJson(path('vendor/eruda.json')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous && compareVersions(metadata.version, previous.version) < 0) {
    throw new Error('拒绝自动降级 Eruda；回退请使用 Git 恢复历史版本并提高脚本版本。');
  }
  if (previous?.version === metadata.version) {
    const source = await readFile(path('vendor/eruda.js'));
    const license = await readFile(path('vendor/LICENSE.eruda'));
    if (sha256(source) !== previous.sha256 || sha256(license) !== previous.licenseSha256) {
      throw new Error('本地 vendor 校验失败，请从 Git 恢复后重试。');
    }
    console.log(`Eruda ${metadata.version} 已是目标版本。`);
    return;
  }
  const archive = await download(metadata.dist.tarball, 16 * 1024 * 1024);
  verifyIntegrity(archive, metadata.dist.integrity);
  const files = extractPackage(archive);
  const pkg = JSON.parse(files.get('package/package.json'));
  if (pkg.name !== 'eruda' || pkg.version !== metadata.version || pkg.license !== 'MIT') {
    throw new Error('归档包名、版本或许可证发生变化，请人工检查。');
  }
  const source = files.get('package/eruda.js');
  if (!/^[a-f0-9]{40}$/.test(metadata.gitHead || '')) throw new Error('npm 缺少上游提交标识。');
  const licenseUrl = `https://raw.githubusercontent.com/liriliri/eruda/${metadata.gitHead}/LICENSE`;
  const license = await download(licenseUrl, 64 * 1024);
  if (!license.toString().includes('MIT License')) throw new Error('上游 LICENSE 内容异常。');
  await mkdir(path('vendor'), { recursive: true });
  await writeFile(path('vendor/eruda.js'), source);
  await writeFile(path('vendor/LICENSE.eruda'), license);
  await writeJson(path('vendor/eruda.json'), {
    name: pkg.name, version: pkg.version, license: pkg.license,
    tarball: metadata.dist.tarball, integrity: metadata.dist.integrity, licenseUrl,
    sha256: sha256(source), licenseSha256: sha256(license),
  });
  console.log(`已下载并校验 Eruda ${pkg.version}（${source.length} 字节）。`);
}

if (process.argv[1] && path('scripts/update-eruda.mjs') === path(process.argv[1])) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
