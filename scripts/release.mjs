import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { path, readJson, sha256, repository } from './lib.mjs';

// 本地与 Actions 共用发布流程；gh 登录或 GH_TOKEN 由调用方提供。
function gh(args, options = {}) {
  return execFileSync('gh', args, { cwd: path(), encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

async function main() {
  const info = await readJson(path('dist/build-info.json'));
  const repo = repository();
  if (!repo || info.repository !== repo) throw new Error('请先为当前 GitHub 仓库重新执行 npm run build。');
  for (const [name, hash] of Object.entries(info.files)) {
    if (sha256(await readFile(path('dist', name))) !== hash) throw new Error(`产物校验失败：${name}`);
  }
  const tag = `v${info.version}`;
  let existing;
  try { existing = JSON.parse(gh(['api', `repos/${repo}/releases/tags/${tag}`])); }
  catch (error) {
    if (!String(error.stderr).includes('HTTP 404')) throw error;
  }
  if (existing && !existing.draft) {
    const asset = existing.assets.find((asset) => asset.name === 'build-info.json');
    if (!asset) throw new Error('已发布版本缺少清单；请提高 package.json 版本后重新发布。');
    const published = JSON.parse(gh(['api', '-H', 'Accept: application/octet-stream', `repos/${repo}/releases/assets/${asset.id}`]));
    if (JSON.stringify(published) !== JSON.stringify(info)) {
      throw new Error('相同版本的产物发生变化。请运行 npm version patch --no-git-tag-version 并提交，然后重试。');
    }
    console.log(`${tag} 已发布且产物一致，无需重复发布。`);
    return;
  }
  const notesDirectory = await mkdtemp(join(tmpdir(), 'eruda-release-'));
  const notesFile = join(notesDirectory, 'notes.md');
  await writeFile(notesFile, `内置 Eruda ${info.erudaVersion}，所有调试工具随脚本离线分发。\n\n安装附件 eruda-offline.user.js；已安装的发布版由脚本管理器自动检查更新。\n\nSHA-256 校验见 SHA256SUMS.txt。\n`);
  if (!existing) {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path(), encoding: 'utf8' }).trim();
    gh(['release', 'create', tag, '--repo', repo, '--target', commit, '--draft',
      '--title', `Eruda 离线调试 ${info.version}`, '--notes-file', notesFile]);
  }
  const assets = [...Object.keys(info.files), 'build-info.json', 'SHA256SUMS.txt'].map((name) => path('dist', name));
  gh(['release', 'upload', tag, ...assets, '--repo', repo, '--clobber']);
  // 所有附件齐备之后才发布，避免用户取得尚未上传完成的版本。
  gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
  console.log(`已发布 https://github.com/${repo}/releases/tag/${tag}`);
}

main().catch((error) => { console.error(error.stderr?.toString() || error.message); process.exitCode = 1; });
