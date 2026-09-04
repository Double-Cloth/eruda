import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { path } from '../scripts/lib.mjs';

function runWith(executable) {
  return spawnSync(process.execPath, [path('scripts/browser-check.mjs')], {
    cwd: path('.'), encoding: 'utf8', timeout: 10_000, windowsHide: true,
    env: { ...process.env, CHROME_PATH: executable },
  });
}

test('浏览器不存在时立即报告路径和启动错误', () => {
  const result = runWith(join(path('.'), 'missing-browser-executable'));
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /浏览器启动失败/);
  assert.match(result.stderr, /missing-browser-executable/);
  assert.match(result.stderr, /ENOENT/);
});

test('浏览器提前退出时显示 stderr，不伪装成端口超时', () => {
  // Node 不接受 Chrome 参数，使用真实子进程模拟启动后立即报错退出。
  const result = runWith(process.execPath);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /提前退出/);
  assert.match(result.stderr, /bad option.*--headless/);
  assert.doesNotMatch(result.stderr, /浏览器启动超时/);
});
