import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const path = (...parts) => resolve(root, ...parts);
export const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
export const writeJson = (file, data) => writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

export function stableVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`只接受稳定版本 x.y.z：${value}`);
  return value;
}

export function compareVersions(left, right) {
  const a = stableVersion(left).split('.').map(Number);
  const b = stableVersion(right).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

export function repository(explicit) {
  let value = explicit || process.env.USERSCRIPT_REPOSITORY || process.env.GITHUB_REPOSITORY;
  if (!value) {
    try {
      const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      value = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
    } catch { /* 本地仓库尚未设置 origin 时仍可离线构建。 */ }
  }
  if (!value) return null;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('仓库必须为 owner/repo。');
  return value;
}
